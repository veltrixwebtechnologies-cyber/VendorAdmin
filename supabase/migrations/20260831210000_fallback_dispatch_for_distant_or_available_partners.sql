-- ============================================================
-- MIGRATION: 20260831210000_fallback_dispatch_for_distant_or_available_partners.sql
-- Ensures delivery orders fall back to ANY available online partner if none are within immediate radius
-- ============================================================

CREATE OR REPLACE FUNCTION public.dispatch_delivery_for_order_internal(
  _order_id uuid,
  _timeout_seconds integer DEFAULT 45
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
DECLARE
  o record;
  seller_row record;
  selected_partner record;
  assignment_id uuid;
  has_active boolean;
  shop_lat double precision;
  shop_lng double precision;
  max_radius_km double precision := 15.0;
BEGIN
  -- Lock order row atomically
  SELECT * INTO o FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF o.id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  -- If order already has an assigned active partner, return existing assignment
  IF o.assigned_partner_id IS NOT NULL THEN
    SELECT id INTO assignment_id
    FROM public.delivery_assignments
    WHERE order_id = o.id AND partner_id = o.assigned_partner_id
      AND status NOT IN ('rejected', 'expired', 'cancelled')
    ORDER BY created_at DESC
    LIMIT 1;
    IF assignment_id IS NOT NULL THEN
      RETURN assignment_id;
    END IF;
  END IF;

  -- Dispatch is active for accepted, preparing, packed, ready_for_pickup, or assigned states
  IF o.status::text NOT IN ('accepted', 'preparing', 'packed', 'ready_for_pickup', 'assigned', 'rider_assigned') THEN
    RETURN NULL;
  END IF;

  -- Expire stale pending requests for this order
  UPDATE public.delivery_assignments
  SET status = 'expired', updated_at = now()
  WHERE order_id = o.id AND status IN ('pending', 'requested') AND expires_at <= now();

  -- Reuse unexpired pending offer if one is currently active
  SELECT id INTO assignment_id
  FROM public.delivery_assignments
  WHERE order_id = o.id AND status IN ('pending', 'requested') AND expires_at > now()
  ORDER BY created_at ASC
  LIMIT 1;

  IF assignment_id IS NOT NULL THEN
    RETURN assignment_id;
  END IF;

  -- Fetch shop coordinates
  SELECT lat, lng, wizard_data INTO seller_row
  FROM public.sellers WHERE id = o.seller_id;

  shop_lat := coalesce(seller_row.lat, (seller_row.wizard_data->>'lat')::double precision, 13.0827);
  shop_lng := coalesce(seller_row.lng, (seller_row.wizard_data->>'lng')::double precision, 80.2707);

  -- 1. Primary query: Rank eligible riders within max_radius_km (15km) and fresh GPS
  SELECT
    p.id,
    public.delivery_distance_km(p.current_latitude, p.current_longitude, shop_lat, shop_lng) AS dist_to_shop_km,
    ((public.delivery_distance_km(p.current_latitude, p.current_longitude, shop_lat, shop_lng) / 22.0) * 60.0) AS eta_min,
    extract(epoch FROM (now() - p.location_updated_at)) AS loc_age_sec,
    public.calculate_rider_dispatch_score(
      public.delivery_distance_km(p.current_latitude, p.current_longitude, shop_lat, shop_lng),
      ((public.delivery_distance_km(p.current_latitude, p.current_longitude, shop_lat, shop_lng) / 22.0) * 60.0),
      (SELECT count(*)::integer FROM public.delivery_assignments active_a
       WHERE active_a.partner_id = p.id AND active_a.status IN ('accepted', 'navigating_to_vendor', 'reached_vendor', 'picked_up', 'out_for_delivery')),
      p.rating,
      coalesce(o.estimated_prep_minutes, 15),
      extract(epoch FROM (now() - p.location_updated_at))
    ) AS score
  INTO selected_partner
  FROM public.delivery_partners p
  WHERE p.status = 'approved'
    AND p.availability = 'online'
    AND p.current_latitude IS NOT NULL
    AND p.current_longitude IS NOT NULL
    AND p.location_updated_at > now() - interval '20 minutes'
    -- Check concurrency capacity
    AND (
      SELECT count(*) FROM public.delivery_assignments active_a
      WHERE active_a.partner_id = p.id
        AND active_a.status IN ('accepted', 'navigating_to_vendor', 'reached_vendor', 'picked_up', 'out_for_delivery')
    ) < coalesce(p.max_concurrent_orders, 1)
    -- Exclude partners that already rejected/expired this order
    AND NOT EXISTS (
      SELECT 1 FROM public.delivery_assignments prior
      WHERE prior.order_id = o.id AND prior.partner_id = p.id AND prior.status IN ('rejected', 'expired')
    )
    -- Maximum delivery radius check
    AND public.delivery_distance_km(p.current_latitude, p.current_longitude, shop_lat, shop_lng) <= max_radius_km
  ORDER BY score DESC, p.rating DESC, p.created_at ASC
  LIMIT 1;

  -- 2. Fallback query: If no nearby partner found, select ANY available online partner
  IF selected_partner.id IS NULL THEN
    SELECT
      p.id,
      coalesce(public.delivery_distance_km(p.current_latitude, p.current_longitude, shop_lat, shop_lng), 0.0) AS dist_to_shop_km,
      ((coalesce(public.delivery_distance_km(p.current_latitude, p.current_longitude, shop_lat, shop_lng), 0.0) / 22.0) * 60.0) AS eta_min,
      extract(epoch FROM (now() - coalesce(p.location_updated_at, p.updated_at, p.created_at))) AS loc_age_sec,
      public.calculate_rider_dispatch_score(
        coalesce(public.delivery_distance_km(p.current_latitude, p.current_longitude, shop_lat, shop_lng), 50.0),
        ((coalesce(public.delivery_distance_km(p.current_latitude, p.current_longitude, shop_lat, shop_lng), 50.0) / 22.0) * 60.0),
        (SELECT count(*)::integer FROM public.delivery_assignments active_a
         WHERE active_a.partner_id = p.id AND active_a.status IN ('accepted', 'navigating_to_vendor', 'reached_vendor', 'picked_up', 'out_for_delivery')),
        p.rating,
        coalesce(o.estimated_prep_minutes, 15),
        extract(epoch FROM (now() - coalesce(p.location_updated_at, p.updated_at, p.created_at)))
      ) AS score
    INTO selected_partner
    FROM public.delivery_partners p
    WHERE p.status = 'approved'
      AND p.availability = 'online'
      -- Check concurrency capacity
      AND (
        SELECT count(*) FROM public.delivery_assignments active_a
        WHERE active_a.partner_id = p.id
          AND active_a.status IN ('accepted', 'navigating_to_vendor', 'reached_vendor', 'picked_up', 'out_for_delivery')
      ) < coalesce(p.max_concurrent_orders, 1)
      -- Exclude partners that already rejected/expired this order
      AND NOT EXISTS (
        SELECT 1 FROM public.delivery_assignments prior
        WHERE prior.order_id = o.id AND prior.partner_id = p.id AND prior.status IN ('rejected', 'expired')
      )
    ORDER BY score DESC, p.rating DESC, p.created_at ASC
    LIMIT 1;
  END IF;

  IF selected_partner.id IS NULL THEN
    -- If max attempts reached and no riders found anywhere, update order status to assignment_failed
    IF o.dispatch_attempts >= 5 THEN
      UPDATE public.orders
      SET status = 'assignment_failed', updated_at = now()
      WHERE id = o.id AND status::text IN ('ready_for_pickup', 'assigned');
    END IF;
    RETURN NULL;
  END IF;

  -- Transaction level advisory lock for atomicity
  PERFORM pg_advisory_xact_lock(hashtextextended(selected_partner.id::text, 0));

  SELECT EXISTS (
    SELECT 1 FROM public.delivery_assignments a
    WHERE a.partner_id = selected_partner.id
      AND a.status IN ('accepted', 'navigating_to_vendor', 'reached_vendor', 'picked_up', 'out_for_delivery')
  ) INTO has_active;

  IF has_active AND coalesce(selected_partner.id, '00000000-0000-0000-0000-000000000000'::uuid) <> o.assigned_partner_id THEN
    -- Partner gained active assignment concurrently
    RETURN NULL;
  END IF;

  -- Upsert offer assignment
  INSERT INTO public.delivery_assignments (
    order_id, partner_id, distance_km, estimated_earning, expires_at
  )
  VALUES (
    o.id,
    selected_partner.id,
    round(coalesce(selected_partner.dist_to_shop_km, 0)::numeric, 2),
    coalesce(o.shipping_fee, 25.0),
    now() + make_interval(secs => greatest(_timeout_seconds, 30))
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
    UPDATE public.orders
    SET dispatch_attempts = dispatch_attempts + 1,
        dispatch_started_at = coalesce(dispatch_started_at, now()),
        updated_at = now()
    WHERE id = o.id;

    UPDATE public.delivery_partners
    SET total_requests = total_requests + 1, updated_at = now()
    WHERE id = selected_partner.id;

    PERFORM public.enqueue_delivery_notification(
      selected_partner.id,
      'New delivery request',
      'A customer order is ready for pickup.',
      'new_delivery',
      jsonb_build_object('order_id', o.id, 'assignment_id', assignment_id)
    );

    INSERT INTO public.delivery_tracking (assignment_id, status, note)
    VALUES (assignment_id, 'offered', 'Delivery request offered to partner');
  END IF;

  RETURN assignment_id;
END;
$$;

NOTIFY pgrst, 'reload schema';
