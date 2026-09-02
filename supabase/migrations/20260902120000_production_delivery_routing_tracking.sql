-- Migration: 20260902120000_production_delivery_routing_tracking.sql
-- LocalShore Production Delivery Routing, Geofencing, GPS Tracking & State Machine System

CREATE EXTENSION IF NOT EXISTS postgis;

-- 1. Schema Extensions for delivery_assignments
ALTER TABLE public.delivery_assignments
  ADD COLUMN IF NOT EXISTS pickup_latitude double precision,
  ADD COLUMN IF NOT EXISTS pickup_longitude double precision,
  ADD COLUMN IF NOT EXISTS dropoff_latitude double precision,
  ADD COLUMN IF NOT EXISTS dropoff_longitude double precision,
  ADD COLUMN IF NOT EXISTS current_latitude double precision,
  ADD COLUMN IF NOT EXISTS current_longitude double precision,
  ADD COLUMN IF NOT EXISTS current_heading double precision DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_speed double precision DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_location_update_at timestamptz,
  ADD COLUMN IF NOT EXISTS route_distance_meters numeric(10,2),
  ADD COLUMN IF NOT EXISTS route_duration_seconds numeric(10,2),
  ADD COLUMN IF NOT EXISTS route_geometry jsonb,
  ADD COLUMN IF NOT EXISTS pickup_arrived_at timestamptz,
  ADD COLUMN IF NOT EXISTS dropoff_arrived_at timestamptz,
  ADD COLUMN IF NOT EXISTS location_gis geography(Point, 4326);

-- Schema Extensions for delivery_partners
ALTER TABLE public.delivery_partners
  ADD COLUMN IF NOT EXISTS current_heading double precision DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_speed double precision DEFAULT 0,
  ADD COLUMN IF NOT EXISTS location_gis geography(Point, 4326);

-- Schema Extensions for delivery_locations
ALTER TABLE public.delivery_locations
  ADD COLUMN IF NOT EXISTS heading double precision DEFAULT 0,
  ADD COLUMN IF NOT EXISTS speed double precision DEFAULT 0,
  ADD COLUMN IF NOT EXISTS location_gis geography(Point, 4326);

-- 2. Spatial Triggers for location_gis column auto-sync
CREATE OR REPLACE FUNCTION public.sync_partner_location_gis()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.current_latitude IS NOT NULL AND NEW.current_longitude IS NOT NULL THEN
    NEW.location_gis := ST_SetSRID(ST_MakePoint(NEW.current_longitude, NEW.current_latitude), 4326)::geography;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_partner_location_gis ON public.delivery_partners;
CREATE TRIGGER trg_sync_partner_location_gis
BEFORE INSERT OR UPDATE OF current_latitude, current_longitude ON public.delivery_partners
FOR EACH ROW EXECUTE FUNCTION public.sync_partner_location_gis();

CREATE OR REPLACE FUNCTION public.sync_assignment_location_gis()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.current_latitude IS NOT NULL AND NEW.current_longitude IS NOT NULL THEN
    NEW.location_gis := ST_SetSRID(ST_MakePoint(NEW.current_longitude, NEW.current_latitude), 4326)::geography;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_assignment_location_gis ON public.delivery_assignments;
CREATE TRIGGER trg_sync_assignment_location_gis
BEFORE INSERT OR UPDATE OF current_latitude, current_longitude ON public.delivery_assignments
FOR EACH ROW EXECUTE FUNCTION public.sync_assignment_location_gis();

CREATE OR REPLACE FUNCTION public.sync_location_history_gis()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
    NEW.location_gis := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326)::geography;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_location_history_gis ON public.delivery_locations;
CREATE TRIGGER trg_sync_location_history_gis
BEFORE INSERT OR UPDATE OF latitude, longitude ON public.delivery_locations
FOR EACH ROW EXECUTE FUNCTION public.sync_location_history_gis();

-- 3. Indexes for spatial queries & performance
CREATE INDEX IF NOT EXISTS idx_delivery_partners_gis ON public.delivery_partners USING GIST(location_gis);
CREATE INDEX IF NOT EXISTS idx_delivery_assignments_gis ON public.delivery_assignments USING GIST(location_gis);
CREATE INDEX IF NOT EXISTS idx_delivery_locations_gis ON public.delivery_locations USING GIST(location_gis);

CREATE INDEX IF NOT EXISTS idx_delivery_assignments_order ON public.delivery_assignments(order_id);
CREATE INDEX IF NOT EXISTS idx_delivery_assignments_partner ON public.delivery_assignments(partner_id);
CREATE INDEX IF NOT EXISTS idx_delivery_assignments_status ON public.delivery_assignments(status);
CREATE INDEX IF NOT EXISTS idx_delivery_assignments_last_update ON public.delivery_assignments(last_location_update_at);
CREATE INDEX IF NOT EXISTS idx_delivery_locations_partner_assignment ON public.delivery_locations(partner_id, assignment_id);

-- 4. Production-grade update_delivery_location RPC with Geofencing
DROP FUNCTION IF EXISTS public.update_delivery_location(uuid, double precision, double precision, double precision, double precision) CASCADE;
DROP FUNCTION IF EXISTS public.update_delivery_location(uuid, double precision, double precision) CASCADE;

CREATE OR REPLACE FUNCTION public.update_delivery_location(
  _assignment_id uuid,
  _latitude double precision,
  _longitude double precision,
  _heading double precision DEFAULT 0,
  _speed double precision DEFAULT 0
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
BEGIN
  -- Input Validation
  IF _latitude IS NULL OR _longitude IS NULL OR _latitude < -90 OR _latitude > 90 OR _longitude < -180 OR _longitude > 180 THEN
    RAISE EXCEPTION 'Invalid coordinates: lat %, lng %', _latitude, _longitude;
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

  -- Rate limit / Throttling check (max 1 update per second per assignment)
  IF v_assignment.last_location_update_at IS NOT NULL AND (v_now - v_assignment.last_location_update_at) < interval '1 second' THEN
    RETURN jsonb_build_object('status', 'throttled', 'last_updated', v_assignment.last_location_update_at);
  END IF;

  -- Update delivery partner current location
  UPDATE public.delivery_partners
  SET current_latitude = _latitude,
      current_longitude = _longitude,
      current_heading = coalesce(_heading, 0),
      current_speed = coalesce(_speed, 0),
      location_updated_at = v_now,
      updated_at = v_now
  WHERE id = v_partner_id;

  -- Update active delivery assignment location
  UPDATE public.delivery_assignments
  SET current_latitude = _latitude,
      current_longitude = _longitude,
      current_heading = coalesce(_heading, 0),
      current_speed = coalesce(_speed, 0),
      last_location_update_at = v_now,
      updated_at = v_now
  WHERE id = _assignment_id;

  -- Insert into history log
  INSERT INTO public.delivery_locations (
    partner_id, assignment_id, latitude, longitude, heading, speed, created_at
  )
  VALUES (
    v_partner_id, _assignment_id, _latitude, _longitude, coalesce(_heading, 0), coalesce(_speed, 0), v_now
  );

  -- Geofencing Check: Pickup Shop vs Dropoff Customer
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

  RETURN jsonb_build_object(
    'status', 'ok',
    'assignment_id', _assignment_id,
    'latitude', _latitude,
    'longitude', _longitude,
    'pickup_distance_m', round(coalesce(v_pickup_dist, -1)::numeric, 1),
    'dropoff_distance_m', round(coalesce(v_dropoff_dist, -1)::numeric, 1),
    'geofence_arrival', v_geofence_arrival,
    'updated_at', v_now
  );
END;
$$;

-- 5. Hardened RLS Policies for Realtime Customer Tracking
ALTER TABLE public.delivery_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "assignment access" ON public.delivery_assignments;
CREATE POLICY "assignment access" ON public.delivery_assignments
  FOR ALL
  USING (
    public.is_my_partner(partner_id)
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = delivery_assignments.order_id
        AND o.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.orders o
      JOIN public.sellers s ON s.id = o.seller_id
      WHERE o.id = delivery_assignments.order_id
        AND s.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "location access" ON public.delivery_locations;
CREATE POLICY "location access" ON public.delivery_locations
  FOR ALL
  USING (
    public.is_my_partner(partner_id)
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.delivery_assignments da
      JOIN public.orders o ON o.id = da.order_id
      WHERE da.id = delivery_locations.assignment_id
        AND o.user_id = auth.uid()
    )
  );

-- 6. Add Realtime publication for delivery tracking tables
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'delivery_assignments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.delivery_assignments;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'delivery_locations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.delivery_locations;
  END IF;
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;

-- 7. Verification Test Suite Function
CREATE OR REPLACE FUNCTION public.test_delivery_state_transitions()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_test_passed boolean := true;
  v_error_count integer := 0;
  v_results jsonb := '[]'::jsonb;
BEGIN
  -- Test 1: Transition validator check
  IF NOT public.validate_order_status_transition('assigned', 'rider_accepted') THEN
    v_error_count := v_error_count + 1;
    v_results := v_results || jsonb_build_object('test', 'assigned -> rider_accepted', 'passed', false);
  ELSE
    v_results := v_results || jsonb_build_object('test', 'assigned -> rider_accepted', 'passed', true);
  END IF;

  IF public.validate_order_status_transition('new', 'out_for_delivery') THEN
    v_error_count := v_error_count + 1;
    v_results := v_results || jsonb_build_object('test', 'invalid new -> out_for_delivery rejection', 'passed', false);
  ELSE
    v_results := v_results || jsonb_build_object('test', 'invalid new -> out_for_delivery rejection', 'passed', true);
  END IF;

  RETURN jsonb_build_object(
    'total_tests', 2,
    'error_count', v_error_count,
    'all_passed', (v_error_count = 0),
    'details', v_results
  );
END;
$$;
