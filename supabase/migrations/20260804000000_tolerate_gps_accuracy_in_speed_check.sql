-- Avoid rejecting valid partner locations when GPS accuracy or callback
-- timing makes a small coordinate jump appear faster than it really is.
CREATE OR REPLACE FUNCTION public.submit_partner_location(
  _latitude double precision,
  _longitude double precision,
  _accuracy_m double precision DEFAULT NULL,
  _captured_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p record;
  last_loc record;
  active_assignment_id uuid;
  distance_km double precision;
  adjusted_distance_km double precision;
  elapsed_hours double precision;
  speed_kmh double precision;
  ready_order record;
BEGIN
  SELECT * INTO p
  FROM public.delivery_partners
  WHERE user_id = auth.uid()
  FOR UPDATE;

  IF p.id IS NULL THEN
    RAISE EXCEPTION 'Delivery partner profile not found';
  END IF;
  IF p.status <> 'approved' THEN
    RAISE EXCEPTION 'Only approved delivery partners can update live location';
  END IF;
  IF p.availability NOT IN ('online', 'busy') THEN
    RAISE EXCEPTION 'Go online before sharing live location';
  END IF;
  IF _latitude IS NULL OR _longitude IS NULL
     OR _latitude < -90 OR _latitude > 90
     OR _longitude < -180 OR _longitude > 180 THEN
    RAISE EXCEPTION 'Invalid GPS coordinates';
  END IF;
  IF _accuracy_m IS NOT NULL AND (_accuracy_m < 0 OR _accuracy_m > 10000) THEN
    RAISE EXCEPTION 'GPS accuracy is too low';
  END IF;
  IF _captured_at < now() - interval '5 minutes'
     OR _captured_at > now() + interval '2 minutes' THEN
    RAISE EXCEPTION 'GPS timestamp is not valid';
  END IF;

  SELECT * INTO last_loc
  FROM public.delivery_locations
  WHERE partner_id = p.id
  ORDER BY coalesce(captured_at, created_at) DESC
  LIMIT 1;

  IF last_loc.id IS NOT NULL THEN
    elapsed_hours := extract(epoch FROM (
      _captured_at - coalesce(last_loc.captured_at, last_loc.created_at)
    )) / 3600.0;

    -- GPS fixes received within a few seconds are too noisy for a speed
    -- check. For longer intervals, remove both fixes' uncertainty radii
    -- before calculating speed.
    IF elapsed_hours >= (10.0 / 3600.0) THEN
      distance_km := public.delivery_distance_km(
        last_loc.latitude, last_loc.longitude, _latitude, _longitude
      );
      adjusted_distance_km := greatest(
        0,
        distance_km
          - coalesce(last_loc.accuracy_m, 0) / 1000.0
          - coalesce(_accuracy_m, 0) / 1000.0
      );
      speed_kmh := adjusted_distance_km / elapsed_hours;
      IF speed_kmh > 140 THEN
        RAISE EXCEPTION 'GPS movement is not realistic';
      END IF;
    END IF;
  END IF;

  SELECT id INTO active_assignment_id
  FROM public.delivery_assignments
  WHERE partner_id = p.id
    AND status IN ('accepted', 'navigating_to_vendor', 'reached_vendor',
                   'picked_up', 'out_for_delivery')
  ORDER BY created_at DESC
  LIMIT 1;

  INSERT INTO public.delivery_locations (
    partner_id, assignment_id, latitude, longitude, accuracy_m,
    captured_at, speed_kmh
  ) VALUES (
    p.id, active_assignment_id, _latitude, _longitude, _accuracy_m,
    _captured_at, speed_kmh
  );

  UPDATE public.delivery_partners
  SET current_latitude = _latitude,
      current_longitude = _longitude,
      location_updated_at = now(),
      updated_at = now()
  WHERE id = p.id;

  -- A partner can come online before the seller marks an order ready, or the
  -- first dispatch can happen before the partner's GPS fix arrives. Retry
  -- eligible open orders after this fresh location is stored.
  FOR ready_order IN
    SELECT id
    FROM public.orders
    WHERE status::text IN ('accepted', 'packed', 'ready_for_pickup')
      AND assigned_partner_id IS NULL
  LOOP
    PERFORM public.dispatch_delivery_for_order_internal(ready_order.id, 60);
  END LOOP;

  RETURN jsonb_build_object(
    'partner_id', p.id,
    'accepted', true,
    'speed_kmh', coalesce(speed_kmh, 0)
  );
END;
$$;
