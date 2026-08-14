-- Secure pull fallback for missed realtime/server dispatch events. The partner
-- never reads the unassigned order directly; this SECURITY DEFINER function
-- selects and creates one short-lived assignment atomically.

CREATE OR REPLACE FUNCTION public.claim_next_delivery_offer()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  p record;
  o record;
  assignment_id uuid;
  distance_km numeric := 0;
BEGIN
  SELECT * INTO p
  FROM public.delivery_partners
  WHERE user_id = auth.uid()
  FOR UPDATE;

  IF p.id IS NULL OR p.status::text <> 'approved' OR p.availability::text <> 'online' THEN
    RETURN NULL;
  END IF;

  SELECT a.id INTO assignment_id
  FROM public.delivery_assignments a
  WHERE a.partner_id = p.id
    AND a.status IN ('pending', 'requested')
    AND a.expires_at > now()
  ORDER BY a.created_at ASC
  LIMIT 1;
  IF assignment_id IS NOT NULL THEN RETURN assignment_id; END IF;

  IF EXISTS (
    SELECT 1 FROM public.delivery_assignments a
    WHERE a.partner_id = p.id
      AND a.status IN ('accepted', 'navigating_to_vendor', 'reached_vendor', 'picked_up', 'out_for_delivery')
  ) THEN
    RETURN NULL;
  END IF;

  SELECT candidate.* INTO o
  FROM public.orders candidate
  WHERE candidate.status::text = 'ready_for_pickup'
    AND candidate.assigned_partner_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.delivery_assignments live_offer
      WHERE live_offer.order_id = candidate.id
        AND live_offer.status IN ('pending', 'requested')
        AND live_offer.expires_at > now()
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.delivery_assignments rejected
      WHERE rejected.order_id = candidate.id
        AND rejected.partner_id = p.id
        AND rejected.status = 'rejected'
    )
  ORDER BY
    CASE
      WHEN p.current_latitude IS NOT NULL AND p.current_longitude IS NOT NULL
        AND candidate.customer_latitude IS NOT NULL AND candidate.customer_longitude IS NOT NULL
      THEN public.delivery_distance_km(
        p.current_latitude, p.current_longitude,
        candidate.customer_latitude, candidate.customer_longitude
      )
      ELSE 0
    END,
    candidate.placed_at ASC
  LIMIT 1
  FOR UPDATE OF candidate SKIP LOCKED;

  IF o.id IS NULL THEN RETURN NULL; END IF;

  IF p.current_latitude IS NOT NULL AND p.current_longitude IS NOT NULL
     AND o.customer_latitude IS NOT NULL AND o.customer_longitude IS NOT NULL THEN
    distance_km := round(public.delivery_distance_km(
      p.current_latitude, p.current_longitude,
      o.customer_latitude, o.customer_longitude
    )::numeric, 2);
  END IF;

  INSERT INTO public.delivery_assignments (
    order_id, partner_id, status, distance_km, estimated_earning, expires_at
  ) VALUES (
    o.id, p.id, 'pending', distance_km, coalesce(o.shipping_fee, 0), now() + interval '3 minutes'
  )
  ON CONFLICT (order_id, partner_id) DO UPDATE
  SET status = 'pending',
      distance_km = EXCLUDED.distance_km,
      estimated_earning = EXCLUDED.estimated_earning,
      expires_at = EXCLUDED.expires_at,
      responded_at = NULL,
      updated_at = now()
  WHERE public.delivery_assignments.status IN ('expired', 'rejected')
  RETURNING id INTO assignment_id;

  IF assignment_id IS NOT NULL THEN
    UPDATE public.delivery_partners
    SET total_requests = total_requests + 1, updated_at = now()
    WHERE id = p.id;

    PERFORM public.enqueue_delivery_notification(
      p.id,
      'New delivery request',
      'A customer order is ready for pickup.',
      'new_delivery',
      jsonb_build_object('order_id', o.id, 'assignment_id', assignment_id)
    );
  END IF;

  RETURN assignment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_delivery_offer() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_next_delivery_offer() TO authenticated;

NOTIFY pgrst, 'reload schema';
