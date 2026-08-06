-- Keep live partner location usable on browsers that report coarse accuracy.
-- This migration is idempotent and changes only the validation threshold.
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
  elapsed_hours double precision;
  speed_kmh double precision;
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
    distance_km := public.delivery_distance_km(
      last_loc.latitude, last_loc.longitude, _latitude, _longitude
    );
    elapsed_hours := extract(epoch FROM (
      _captured_at - coalesce(last_loc.captured_at, last_loc.created_at)
    )) / 3600.0;
    IF elapsed_hours > 0 THEN
      speed_kmh := distance_km / elapsed_hours;
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

  RETURN jsonb_build_object(
    'partner_id', p.id,
    'accepted', true,
    'speed_kmh', coalesce(speed_kmh, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_partner_location(
  double precision, double precision, double precision, timestamptz
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_partner_location(
  double precision, double precision, double precision, timestamptz
) TO authenticated;
