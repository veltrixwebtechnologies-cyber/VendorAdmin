-- Serialize partner selection across dispatch paths and require real photo proof.

CREATE OR REPLACE FUNCTION public.dispatch_delivery_for_order_internal(
  _order_id uuid,
  _timeout_seconds integer DEFAULT 180
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
DECLARE
  o record;
  selected_partner record;
  assignment_id uuid;
  has_active boolean;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF o.assigned_partner_id IS NOT NULL THEN
    SELECT id INTO assignment_id FROM public.delivery_assignments
    WHERE order_id = o.id AND partner_id = o.assigned_partner_id
      AND status NOT IN ('rejected', 'expired', 'cancelled')
    ORDER BY created_at DESC LIMIT 1;
    RETURN assignment_id;
  END IF;
  IF o.status::text NOT IN ('accepted', 'packed', 'ready_for_pickup', 'assigned') THEN RETURN NULL; END IF;

  UPDATE public.delivery_assignments
  SET status = 'expired', updated_at = now()
  WHERE order_id = o.id AND status IN ('pending', 'requested') AND expires_at <= now();

  SELECT id INTO assignment_id FROM public.delivery_assignments
  WHERE order_id = o.id AND status IN ('pending', 'requested') AND expires_at > now()
  ORDER BY created_at ASC LIMIT 1;
  IF assignment_id IS NOT NULL THEN RETURN assignment_id; END IF;

  SELECT p.id,
    CASE WHEN p.current_latitude IS NOT NULL AND p.current_longitude IS NOT NULL
      AND o.customer_latitude IS NOT NULL AND o.customer_longitude IS NOT NULL
      THEN public.delivery_distance_km(p.current_latitude, p.current_longitude,
        o.customer_latitude, o.customer_longitude) ELSE NULL END AS distance_km
  INTO selected_partner
  FROM public.delivery_partners p
  WHERE p.status = 'approved' AND p.availability = 'online'
    AND NOT EXISTS (SELECT 1 FROM public.delivery_assignments a
      WHERE a.partner_id = p.id AND a.status IN
        ('accepted', 'navigating_to_vendor', 'reached_vendor', 'picked_up', 'out_for_delivery'))
    AND NOT EXISTS (SELECT 1 FROM public.delivery_assignments prior
      WHERE prior.order_id = o.id AND prior.partner_id = p.id AND prior.status = 'rejected')
  ORDER BY
    CASE WHEN p.current_latitude IS NOT NULL AND p.current_longitude IS NOT NULL
      AND p.location_updated_at > now() - interval '30 minutes' THEN 0 ELSE 1 END,
    CASE WHEN p.current_latitude IS NOT NULL AND p.current_longitude IS NOT NULL
      AND o.customer_latitude IS NOT NULL AND o.customer_longitude IS NOT NULL
      THEN public.delivery_distance_km(p.current_latitude, p.current_longitude,
        o.customer_latitude, o.customer_longitude) ELSE 999999 END,
    p.rating DESC, p.created_at ASC
  LIMIT 1;
  IF selected_partner.id IS NULL THEN RETURN NULL; END IF;

  -- Both server dispatch and partner pull use this same lock key.
  PERFORM pg_advisory_xact_lock(hashtextextended(selected_partner.id::text, 0));
  SELECT EXISTS (SELECT 1 FROM public.delivery_assignments a
    WHERE a.partner_id = selected_partner.id AND a.status IN
      ('accepted', 'navigating_to_vendor', 'reached_vendor', 'picked_up', 'out_for_delivery'))
  INTO has_active;
  IF has_active THEN RETURN NULL; END IF;

  INSERT INTO public.delivery_assignments
    (order_id, partner_id, distance_km, estimated_earning, expires_at)
  VALUES (o.id, selected_partner.id, round(coalesce(selected_partner.distance_km, 0)::numeric, 2),
    coalesce(o.shipping_fee, 0), now() + make_interval(secs => greatest(_timeout_seconds, 120)))
  ON CONFLICT (order_id, partner_id) DO UPDATE
  SET status = 'pending', distance_km = EXCLUDED.distance_km,
      estimated_earning = EXCLUDED.estimated_earning, expires_at = EXCLUDED.expires_at,
      responded_at = NULL, updated_at = now()
  WHERE public.delivery_assignments.status IN ('expired', 'rejected')
  RETURNING id INTO assignment_id;

  IF assignment_id IS NOT NULL THEN
    UPDATE public.delivery_partners SET total_requests = total_requests + 1, updated_at = now()
    WHERE id = selected_partner.id;
    PERFORM public.enqueue_delivery_notification(selected_partner.id, 'New delivery request',
      'A customer order is ready for pickup.', 'new_delivery',
      jsonb_build_object('order_id', o.id, 'assignment_id', assignment_id));
  END IF;
  RETURN assignment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_next_delivery_offer()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE p record; o record; assignment_id uuid; distance_km numeric := 0;
BEGIN
  SELECT * INTO p FROM public.delivery_partners WHERE user_id = auth.uid() FOR UPDATE;
  IF p.id IS NULL OR p.status::text <> 'approved' OR p.availability::text <> 'online' THEN RETURN NULL; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p.id::text, 0));
  IF EXISTS (SELECT 1 FROM public.delivery_assignments a WHERE a.partner_id = p.id
    AND a.status IN ('accepted', 'navigating_to_vendor', 'reached_vendor', 'picked_up', 'out_for_delivery')) THEN RETURN NULL; END IF;
  SELECT candidate.* INTO o FROM public.orders candidate
  WHERE candidate.status::text = 'ready_for_pickup' AND candidate.assigned_partner_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.delivery_assignments a WHERE a.order_id = candidate.id
      AND a.status IN ('pending', 'requested') AND a.expires_at > now())
    AND NOT EXISTS (SELECT 1 FROM public.delivery_assignments r WHERE r.order_id = candidate.id
      AND r.partner_id = p.id AND r.status = 'rejected')
  ORDER BY candidate.placed_at ASC LIMIT 1 FOR UPDATE OF candidate SKIP LOCKED;
  IF o.id IS NULL THEN RETURN NULL; END IF;
  IF p.current_latitude IS NOT NULL AND p.current_longitude IS NOT NULL
    AND o.customer_latitude IS NOT NULL AND o.customer_longitude IS NOT NULL THEN
    distance_km := round(public.delivery_distance_km(p.current_latitude, p.current_longitude,
      o.customer_latitude, o.customer_longitude)::numeric, 2);
  END IF;
  INSERT INTO public.delivery_assignments
    (order_id, partner_id, status, distance_km, estimated_earning, expires_at)
  VALUES (o.id, p.id, 'pending', distance_km, coalesce(o.shipping_fee, 0), now() + interval '3 minutes')
  ON CONFLICT (order_id, partner_id) DO UPDATE
  SET status = 'pending', distance_km = EXCLUDED.distance_km,
      estimated_earning = EXCLUDED.estimated_earning, expires_at = EXCLUDED.expires_at,
      responded_at = NULL, updated_at = now()
  WHERE public.delivery_assignments.status IN ('expired', 'rejected')
  RETURNING id INTO assignment_id;
  IF assignment_id IS NOT NULL THEN
    UPDATE public.delivery_partners SET total_requests = total_requests + 1, updated_at = now() WHERE id = p.id;
    PERFORM public.enqueue_delivery_notification(p.id, 'New delivery request',
      'A customer order is ready for pickup.', 'new_delivery',
      jsonb_build_object('order_id', o.id, 'assignment_id', assignment_id));
  END IF;
  RETURN assignment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_delivery(_assignment_id uuid, _proof_type text, _proof_value text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, storage, pg_temp AS $$
DECLARE a record; o record; fee numeric; earning_row_count integer := 0;
BEGIN
  SELECT * INTO a FROM public.delivery_assignments WHERE id = _assignment_id FOR UPDATE;
  IF a.id IS NULL OR NOT public.is_my_partner(a.partner_id) THEN RAISE EXCEPTION 'Delivery assignment not found'; END IF;
  IF a.status = 'delivered' THEN RETURN; END IF;
  IF a.status <> 'out_for_delivery' THEN RAISE EXCEPTION 'Delivery must be out for delivery before completion'; END IF;
  SELECT * INTO o FROM public.orders WHERE id = a.order_id FOR UPDATE;
  IF o.id IS NULL OR o.assigned_partner_id <> a.partner_id THEN RAISE EXCEPTION 'Order is not assigned to this partner'; END IF;
  IF _proof_type NOT IN ('otp', 'photo') OR coalesce(trim(_proof_value), '') = '' THEN RAISE EXCEPTION 'Delivery proof is required'; END IF;
  IF _proof_type = 'otp' AND _proof_value <> coalesce(o.delivery_otp, '') THEN RAISE EXCEPTION 'Incorrect delivery OTP'; END IF;
  IF _proof_type = 'photo' AND NOT EXISTS (
    SELECT 1 FROM storage.objects so
    WHERE so.bucket_id = 'delivery-docs' AND so.name = _proof_value
      AND so.name LIKE (auth.uid()::text || '/%')
  ) THEN RAISE EXCEPTION 'Delivery proof photo was not uploaded by this partner'; END IF;
  fee := coalesce(a.estimated_earning, o.shipping_fee, 0);
  UPDATE public.delivery_assignments SET status = 'delivered', delivered_at = now(), proof_type = _proof_type,
    proof_value = _proof_value, updated_at = now() WHERE id = a.id;
  UPDATE public.orders SET status = 'delivered', delivered_at = now() WHERE id = o.id;
  INSERT INTO public.delivery_tracking (assignment_id, status, note) VALUES (a.id, 'delivered', 'Delivered to customer');
  INSERT INTO public.delivery_earnings (partner_id, assignment_id, amount, description)
    VALUES (a.partner_id, a.id, fee, 'Delivery ' || o.order_number) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS earning_row_count = ROW_COUNT;
  IF earning_row_count > 0 THEN
    INSERT INTO public.delivery_wallets (partner_id, pending_balance) VALUES (a.partner_id, fee)
      ON CONFLICT (partner_id) DO UPDATE SET pending_balance = public.delivery_wallets.pending_balance + EXCLUDED.pending_balance, updated_at = now();
    INSERT INTO public.delivery_wallet_transactions (partner_id, assignment_id, type, amount, reference)
      VALUES (a.partner_id, a.id, 'delivery_earning', fee, o.order_number);
    UPDATE public.delivery_partners SET total_deliveries = total_deliveries + 1, availability = 'online', updated_at = now() WHERE id = a.partner_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_delivery(uuid, text, text), public.claim_next_delivery_offer() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_delivery_for_order_internal(uuid, integer) TO service_role;
NOTIFY pgrst, 'reload schema';
