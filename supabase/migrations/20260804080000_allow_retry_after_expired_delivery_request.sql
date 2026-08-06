-- An expired request is a timeout, not a permanent rejection. Allow the
-- same eligible partner to receive the request again when the seller retries
-- dispatch. Explicitly rejected requests remain excluded.
CREATE OR REPLACE FUNCTION public.dispatch_delivery_for_order_internal(
  _order_id uuid,
  _timeout_seconds integer DEFAULT 60
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o record;
  selected_partner record;
  assignment_id uuid;
  max_radius_km numeric := 12;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;

  IF o.assigned_partner_id IS NOT NULL THEN
    SELECT id INTO assignment_id
    FROM public.delivery_assignments
    WHERE order_id = o.id
      AND partner_id = o.assigned_partner_id
      AND status NOT IN ('rejected', 'expired', 'cancelled')
    ORDER BY created_at DESC LIMIT 1;
    RETURN assignment_id;
  END IF;

  IF o.status::text NOT IN ('accepted', 'packed', 'ready_for_pickup', 'assigned') THEN
    RETURN NULL;
  END IF;

  UPDATE public.delivery_assignments
  SET status = 'expired', updated_at = now()
  WHERE order_id = o.id AND status IN ('pending', 'requested') AND expires_at <= now();

  SELECT id INTO assignment_id
  FROM public.delivery_assignments
  WHERE order_id = o.id AND status IN ('pending', 'requested') AND expires_at > now()
  ORDER BY created_at ASC LIMIT 1;
  IF assignment_id IS NOT NULL THEN RETURN assignment_id; END IF;

  SELECT p.id,
    public.delivery_distance_km(p.current_latitude, p.current_longitude,
      o.customer_latitude, o.customer_longitude) AS distance_km
  INTO selected_partner
  FROM public.delivery_partners p
  WHERE p.status = 'approved'
    AND p.availability = 'online'
    AND p.current_latitude IS NOT NULL
    AND p.current_longitude IS NOT NULL
    AND p.location_updated_at > now() - interval '30 minutes'
    AND NOT EXISTS (
      SELECT 1 FROM public.delivery_assignments active_a
      WHERE active_a.partner_id = p.id
        AND active_a.status IN ('accepted', 'navigating_to_vendor', 'reached_vendor',
                                'picked_up', 'out_for_delivery')
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.delivery_assignments prior
      WHERE prior.order_id = o.id AND prior.partner_id = p.id
        AND prior.status = 'rejected'
    )
    AND (
      NOT EXISTS (SELECT 1 FROM public.delivery_partner_zones z WHERE z.partner_id = p.id)
      OR EXISTS (
        SELECT 1
        FROM public.delivery_partner_zones z
        JOIN public.delivery_zones dz ON dz.id = z.zone_id
        WHERE z.partner_id = p.id AND dz.is_active = true
          AND (o.buyer_address ILIKE '%' || dz.name || '%' OR o.buyer_address ILIKE '%' || dz.city || '%')
      )
    )
    AND (
      o.customer_latitude IS NULL
      OR public.delivery_distance_km(p.current_latitude, p.current_longitude,
        o.customer_latitude, o.customer_longitude) <= max_radius_km
    )
  ORDER BY public.delivery_distance_km(p.current_latitude, p.current_longitude,
    o.customer_latitude, o.customer_longitude) ASC NULLS LAST,
    p.rating DESC, p.created_at ASC
  LIMIT 1;

  IF selected_partner.id IS NULL THEN RETURN NULL; END IF;

  INSERT INTO public.delivery_assignments (
    order_id, partner_id, distance_km, estimated_earning, expires_at
  ) VALUES (
    o.id, selected_partner.id, round(coalesce(selected_partner.distance_km, 0)::numeric, 2),
    coalesce(o.shipping_fee, 0), now() + make_interval(secs => greatest(_timeout_seconds, 30))
  )
  ON CONFLICT (order_id, partner_id) DO UPDATE
  SET status = 'pending', distance_km = EXCLUDED.distance_km,
      estimated_earning = EXCLUDED.estimated_earning,
      expires_at = EXCLUDED.expires_at, updated_at = now()
  WHERE public.delivery_assignments.status IN ('expired', 'rejected')
  RETURNING id INTO assignment_id;

  IF assignment_id IS NOT NULL THEN
    UPDATE public.delivery_partners
    SET total_requests = total_requests + 1, updated_at = now()
    WHERE id = selected_partner.id;
    PERFORM public.enqueue_delivery_notification(
      selected_partner.id, 'New delivery request',
      'A customer order is ready for pickup.', 'new_delivery',
      jsonb_build_object('order_id', o.id, 'assignment_id', assignment_id)
    );
  END IF;
  RETURN assignment_id;
END;
$$;

NOTIFY pgrst, 'reload schema';
