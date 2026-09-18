-- Migration: 20260912150000_stale_location_guard_and_timestamp_ordering.sql
-- LocalShore Production Out-of-Order Location Guard & Dual-Timestamp Tracking

-- 1. Schema Extensions for dual timestamp tracking
ALTER TABLE public.delivery_assignments
  ADD COLUMN IF NOT EXISTS last_captured_at timestamptz;

ALTER TABLE public.delivery_partners
  ADD COLUMN IF NOT EXISTS last_captured_at timestamptz;

ALTER TABLE public.delivery_locations
  ADD COLUMN IF NOT EXISTS captured_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS accuracy_m double precision;

-- 2. Enhanced update_delivery_location RPC with Out-of-Order protection
DROP FUNCTION IF EXISTS public.update_delivery_location(uuid, double precision, double precision, double precision, double precision) CASCADE;
DROP FUNCTION IF EXISTS public.update_delivery_location(uuid, double precision, double precision, double precision, double precision, timestamptz) CASCADE;
DROP FUNCTION IF EXISTS public.update_delivery_location(uuid, double precision, double precision, double precision, double precision, timestamptz, double precision) CASCADE;
DROP FUNCTION IF EXISTS public.update_delivery_location(uuid, double precision, double precision) CASCADE;

CREATE OR REPLACE FUNCTION public.update_delivery_location(
  _assignment_id uuid,
  _latitude double precision,
  _longitude double precision,
  _heading double precision DEFAULT 0,
  _speed double precision DEFAULT 0,
  _captured_at timestamptz DEFAULT now(),
  _accuracy_m double precision DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assignment record;
  v_partner_id uuid;
  v_pickup_dist double precision;
  v_dropoff_dist double precision;
  v_geofence_arrival text := null;
  v_now timestamptz := now();
  v_captured timestamptz := COALESCE(_captured_at, v_now);
  v_is_latest boolean := false;
BEGIN
  -- Input Validation: Coordinates
  IF _latitude IS NULL OR _longitude IS NULL OR _latitude < -90 OR _latitude > 90 OR _longitude < -180 OR _longitude > 180 THEN
    RAISE EXCEPTION 'Invalid coordinates: lat %, lng %', _latitude, _longitude;
  END IF;

  -- Input Validation: Timestamp range check (reject updates older than 10 mins or >2 mins in future)
  IF v_captured < (v_now - interval '10 minutes') OR v_captured > (v_now + interval '2 minutes') THEN
    RETURN jsonb_build_object('status', 'rejected', 'reason', 'Timestamp out of acceptable window', 'captured_at', v_captured);
  END IF;

  -- Locate active assignment & verify authorization
  SELECT a.*, o.seller_id, s.lat as shop_lat, s.lng as shop_lng, o.customer_latitude, o.customer_longitude
  INTO v_assignment
  FROM public.delivery_assignments a
  JOIN public.orders o ON o.id = a.order_id
  LEFT JOIN public.sellers s ON s.id = o.seller_id
  WHERE a.id = _assignment_id
  FOR UPDATE OF a;

  IF v_assignment.id IS NULL THEN
    RAISE EXCEPTION 'Delivery assignment % not found', _assignment_id;
  END IF;

  v_partner_id := v_assignment.partner_id;

  -- Enforce security: user must be the assigned delivery partner or admin
  IF NOT (public.is_my_partner(v_partner_id) OR public.has_role(auth.uid(), 'admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Unauthorized location update for partner %', v_partner_id;
  END IF;

  -- Ensure delivery assignment is active
  IF v_assignment.status IN ('delivered', 'cancelled', 'rejected', 'expired') THEN
    RETURN jsonb_build_object('status', 'ignored', 'reason', 'Delivery closed');
  END IF;

  -- Always log the location fix to delivery_locations history table for auditing
  INSERT INTO public.delivery_locations (
    partner_id, assignment_id, latitude, longitude, heading, speed, accuracy_m, captured_at, created_at
  )
  VALUES (
    v_partner_id, _assignment_id, _latitude, _longitude, coalesce(_heading, 0), coalesce(_speed, 0), _accuracy_m, v_captured, v_now
  );

  -- OUT-OF-ORDER CHECK: Determine if this update is newer than the recorded last_captured_at
  IF v_assignment.last_captured_at IS NULL OR v_captured >= v_assignment.last_captured_at THEN
    v_is_latest := true;
  END IF;

  -- Only update current live coordinates if this location fix is the latest chronologically
  IF v_is_latest THEN
    -- Update delivery partner current location
    UPDATE public.delivery_partners
    SET current_latitude = _latitude,
        current_longitude = _longitude,
        current_heading = coalesce(_heading, 0),
        current_speed = coalesce(_speed, 0),
        last_captured_at = v_captured,
        location_updated_at = v_now,
        updated_at = v_now
    WHERE id = v_partner_id;

    -- Update active delivery assignment location
    UPDATE public.delivery_assignments
    SET current_latitude = _latitude,
        current_longitude = _longitude,
        current_heading = coalesce(_heading, 0),
        current_speed = coalesce(_speed, 0),
        last_captured_at = v_captured,
        last_location_update_at = v_now,
        updated_at = v_now
    WHERE id = _assignment_id;

    -- Geofencing Check: Pickup Shop vs Dropoff Customer (only for latest location)
    -- Pickup proximity check (<= 50 meters)
    IF v_assignment.shop_lat IS NOT NULL AND v_assignment.shop_lng IS NOT NULL THEN
      v_pickup_dist := ST_Distance(
        ST_SetSRID(ST_MakePoint(_longitude, _latitude), 4326)::geography,
        ST_SetSRID(ST_MakePoint(v_assignment.shop_lng, v_assignment.shop_lat), 4326)::geography
      );

      IF v_pickup_dist <= 50.0 THEN
        v_geofence_arrival := 'reached_vendor';
        IF v_assignment.pickup_arrived_at IS NULL THEN
          UPDATE public.delivery_assignments
          SET pickup_arrived_at = v_now
          WHERE id = _assignment_id;
        END IF;
      END IF;
    END IF;

    -- Dropoff proximity check (<= 50 meters)
    IF v_assignment.customer_latitude IS NOT NULL AND v_assignment.customer_longitude IS NOT NULL THEN
      v_dropoff_dist := ST_Distance(
        ST_SetSRID(ST_MakePoint(_longitude, _latitude), 4326)::geography,
        ST_SetSRID(ST_MakePoint(v_assignment.customer_longitude, v_assignment.customer_latitude), 4326)::geography
      );

      IF v_dropoff_dist <= 50.0 THEN
        v_geofence_arrival := 'at_customer';
        IF v_assignment.dropoff_arrived_at IS NULL THEN
          UPDATE public.delivery_assignments
          SET dropoff_arrived_at = v_now
          WHERE id = _assignment_id;
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'status', CASE WHEN v_is_latest THEN 'ok' ELSE 'out_of_order_logged' END,
    'assignment_id', _assignment_id,
    'latitude', _latitude,
    'longitude', _longitude,
    'is_latest', v_is_latest,
    'captured_at', v_captured,
    'server_received_at', v_now,
    'geofence_arrival', v_geofence_arrival
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_delivery_location(uuid, double precision, double precision, double precision, double precision, timestamptz, double precision) TO authenticated;

NOTIFY pgrst, 'reload schema';
