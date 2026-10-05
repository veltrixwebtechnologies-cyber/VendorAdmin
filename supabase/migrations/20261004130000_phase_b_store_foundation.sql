-- Phase B1: introduce Store as a physical location while keeping sellers as
-- the business/account and financial owner. Legacy seller columns remain the
-- compatibility source until later subphases migrate their consumers.
BEGIN;

DO $store_prerequisites$
DECLARE
  required_column text;
BEGIN
  IF to_regclass('public.sellers') IS NULL THEN
    RAISE EXCEPTION 'Phase B1 requires public.sellers';
  END IF;
  IF to_regclass('public.admin_access_assignments') IS NULL
     OR to_regprocedure('public.has_admin_permission(text)') IS NULL THEN
    RAISE EXCEPTION 'Phase B1 requires the installed Phase A RBAC migration';
  END IF;

  FOREACH required_column IN ARRAY ARRAY[
    'id','user_id','status','business_name','business_type','address_line1',
    'address_line2','city','state','pincode','country','lat','lng',
    'location_verified','location_verified_at',
    'estimated_prep_time_minutes','timezone','accepts_orders','wizard_data',
    'created_at','updated_at'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'sellers'
        AND column_name = required_column
    ) THEN
      RAISE EXCEPTION 'Phase B1 requires public.sellers.%', required_column;
    END IF;
  END LOOP;
END
$store_prerequisites$;

CREATE TABLE public.stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES public.sellers(id) ON DELETE CASCADE,
  is_default boolean NOT NULL DEFAULT false,

  -- Store-facing values copied from the existing seller row / wizard payload.
  name text,
  business_type text,
  description text,
  category text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  pincode text,
  country text,
  latitude double precision,
  longitude double precision,
  google_place_id text,

  -- Unknown historic source remains NULL; migration does not claim a source.
  location_source text CHECK (location_source IS NULL OR location_source IN (
    'GOOGLE_PLACE','SELLER_GPS','ADMIN_SELECTED','MANUAL'
  )),
  location_verified boolean DEFAULT false,
  location_verified_at timestamptz,
  location_verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  -- No per-seller radius currently exists; NULL means unspecified, not zero.
  service_radius_km numeric(7,2) CHECK (service_radius_km IS NULL OR service_radius_km >= 0),

  -- status mirrors seller onboarding status during the transition. Live open /
  -- pause behavior remains accepts_orders + existing hours/override functions.
  status text NOT NULL DEFAULT 'draft',
  accepts_orders boolean NOT NULL DEFAULT true,
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  estimated_prep_time_minutes integer,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stores_coordinates_valid CHECK (
    (latitude IS NULL AND longitude IS NULL) OR
    (latitude IS NOT NULL AND longitude IS NOT NULL
      AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
  ),
  CONSTRAINT stores_prep_time_nonnegative CHECK (
    estimated_prep_time_minutes IS NULL OR estimated_prep_time_minutes > 0
  )
);

CREATE UNIQUE INDEX stores_one_default_per_seller_idx
  ON public.stores (seller_id) WHERE is_default;
CREATE INDEX stores_seller_id_idx ON public.stores (seller_id);
CREATE INDEX stores_status_idx ON public.stores (status);
CREATE INDEX stores_coordinates_idx ON public.stores (latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

-- The application currently prefers wizard_data.shopCoordinates, then sellers
-- lat/lng. Copy a complete coordinate pair from those established sources;
-- shop_latitude/shop_longitude are retained on sellers but are not preferred by
-- current discovery/UI code. No fallback coordinates or geocoding are applied.
WITH seller_values AS (
  SELECT s.*,
    COALESCE(s.wizard_data->'shopCoordinates'->>'lat','') AS wizard_shop_lat,
    COALESCE(s.wizard_data->'shopCoordinates'->>'lng','') AS wizard_shop_lng,
    COALESCE(s.wizard_data->>'lat','') AS wizard_lat,
    COALESCE(s.wizard_data->>'lng','') AS wizard_lng
  FROM public.sellers s
),
resolved AS (
  SELECT sv.*,
    CASE
      WHEN wizard_shop_lat ~ '^-?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
       AND wizard_shop_lng ~ '^-?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
        THEN wizard_shop_lat::double precision
      WHEN lat IS NOT NULL AND lng IS NOT NULL THEN lat
      WHEN wizard_lat ~ '^-?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
       AND wizard_lng ~ '^-?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
        THEN wizard_lat::double precision
      ELSE NULL
    END AS store_latitude,
    CASE
      WHEN wizard_shop_lat ~ '^-?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
       AND wizard_shop_lng ~ '^-?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
        THEN wizard_shop_lng::double precision
      WHEN lat IS NOT NULL AND lng IS NOT NULL THEN lng
      WHEN wizard_lat ~ '^-?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
       AND wizard_lng ~ '^-?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
        THEN wizard_lng::double precision
      ELSE NULL
    END AS store_longitude
  FROM seller_values sv
)
INSERT INTO public.stores (
  seller_id, is_default, name, business_type, description, category,
  address_line1, address_line2, city, state, pincode, country,
  latitude, longitude, google_place_id, location_verified,
  location_verified_at, status, accepts_orders, timezone,
  estimated_prep_time_minutes, created_at, updated_at
)
SELECT r.id, true, r.business_name, r.business_type,
  r.wizard_data->>'description', r.wizard_data->>'category',
  r.address_line1, r.address_line2, r.city, r.state, r.pincode, r.country,
  r.store_latitude, r.store_longitude, r.wizard_data->>'googlePlaceId',
  r.location_verified, r.location_verified_at, r.status::text,
  r.accepts_orders, r.timezone, r.estimated_prep_time_minutes,
  r.created_at, r.updated_at
FROM resolved r
WHERE NOT EXISTS (SELECT 1 FROM public.stores existing WHERE existing.seller_id = r.id);

-- Backfill safety assertions: exactly one default for every seller and no
-- source seller without an initial store. Transaction rollback protects data.
DO $store_backfill_assertions$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.sellers s
    LEFT JOIN public.stores st ON st.seller_id = s.id AND st.is_default
    GROUP BY s.id HAVING count(st.id) <> 1
  ) THEN
    RAISE EXCEPTION 'Store backfill did not produce exactly one default store per seller';
  END IF;
END
$store_backfill_assertions$;

ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stores FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.stores TO authenticated;
GRANT ALL ON public.stores TO service_role;

CREATE POLICY "Sellers read their own stores" ON public.stores
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sellers s WHERE s.id = seller_id AND s.user_id = auth.uid()
  ));
CREATE POLICY "RBAC admins read stores" ON public.stores
  FOR SELECT TO authenticated
  USING (public.has_admin_permission('stores.view'));
CREATE POLICY "Sellers create their own stores" ON public.stores
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.sellers s WHERE s.id = seller_id AND s.user_id = auth.uid()
  ));
CREATE POLICY "Sellers update their own stores" ON public.stores
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sellers s WHERE s.id = seller_id AND s.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.sellers s WHERE s.id = seller_id AND s.user_id = auth.uid()
  ));
CREATE POLICY "RBAC admins create stores" ON public.stores
  FOR INSERT TO authenticated WITH CHECK (public.has_admin_permission('stores.manage'));
CREATE POLICY "RBAC admins update stores" ON public.stores
  FOR UPDATE TO authenticated
  USING (public.has_admin_permission('stores.manage'))
  WITH CHECK (public.has_admin_permission('stores.manage'));

CREATE TRIGGER trg_stores_updated
  BEFORE UPDATE ON public.stores
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.protect_store_identity_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NOT NULL AND NOT public.has_admin_permission('stores.manage') THEN
      -- Seller-submitted stores begin in draft and cannot claim an admin verifier.
      NEW.status := 'draft';
      NEW.location_verified_by := NULL;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.seller_id IS DISTINCT FROM OLD.seller_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Store identity and ownership fields cannot be changed'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.has_admin_permission('stores.manage')
     AND (NEW.status IS DISTINCT FROM OLD.status
       OR NEW.location_verified_by IS DISTINCT FROM OLD.location_verified_by) THEN
    RAISE EXCEPTION 'Only an authorized store manager may change store status or verifier'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.protect_store_identity_fields() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_protect_store_identity_fields
  BEFORE INSERT OR UPDATE ON public.stores
  FOR EACH ROW EXECUTE FUNCTION public.protect_store_identity_fields();

-- Store audit events share Phase A's append-only admin_audit_logs table. Only
-- authorized admin changes are written; sensitive account/payment fields are
-- never included in store snapshots.
CREATE OR REPLACE FUNCTION public.capture_store_admin_audit_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor uuid := auth.uid();
  actor_role text;
  actor_name_value text;
  actor_email_value text;
  event_action text;
  before_value jsonb;
  after_value jsonb;
  audit_reason text := NULLIF(current_setting('app.admin_audit_reason', true), '');
  row_old jsonb := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  row_new jsonb := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
BEGIN
  IF actor IS NULL OR NOT public.has_admin_permission('stores.manage') THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    event_action := 'STORE_CREATED';
  ELSIF TG_OP = 'DELETE' THEN
    event_action := 'STORE_DELETED';
  ELSIF row_old->>'latitude' IS DISTINCT FROM row_new->>'latitude'
     OR row_old->>'longitude' IS DISTINCT FROM row_new->>'longitude'
     OR row_old->>'address_line1' IS DISTINCT FROM row_new->>'address_line1'
     OR row_old->>'address_line2' IS DISTINCT FROM row_new->>'address_line2'
     OR row_old->>'city' IS DISTINCT FROM row_new->>'city'
     OR row_old->>'state' IS DISTINCT FROM row_new->>'state'
     OR row_old->>'pincode' IS DISTINCT FROM row_new->>'pincode'
     OR row_old->>'google_place_id' IS DISTINCT FROM row_new->>'google_place_id'
     OR row_old->>'location_source' IS DISTINCT FROM row_new->>'location_source' THEN
    event_action := 'STORE_LOCATION_UPDATED';
  ELSIF row_old->>'location_verified' IS DISTINCT FROM row_new->>'location_verified'
    AND row_new->>'location_verified' = 'true' THEN
    event_action := 'STORE_LOCATION_VERIFIED';
  ELSIF row_old->>'status' IS DISTINCT FROM row_new->>'status' THEN
    event_action := 'STORE_STATUS_CHANGED';
  ELSE
    event_action := 'STORE_UPDATED';
  END IF;

  before_value := CASE WHEN row_old IS NULL THEN NULL ELSE jsonb_build_object(
    'id', row_old->'id', 'seller_id', row_old->'seller_id', 'name', row_old->'name',
    'address_line1', row_old->'address_line1', 'address_line2', row_old->'address_line2',
    'city', row_old->'city', 'state', row_old->'state', 'pincode', row_old->'pincode',
    'latitude', row_old->'latitude', 'longitude', row_old->'longitude',
    'google_place_id', row_old->'google_place_id', 'location_source', row_old->'location_source',
    'location_verified', row_old->'location_verified', 'location_verified_at', row_old->'location_verified_at',
    'location_verified_by', row_old->'location_verified_by',
    'service_radius_km', row_old->'service_radius_km', 'status', row_old->'status',
    'accepts_orders', row_old->'accepts_orders'
  ) END;
  after_value := CASE WHEN row_new IS NULL THEN NULL ELSE jsonb_build_object(
    'id', row_new->'id', 'seller_id', row_new->'seller_id', 'name', row_new->'name',
    'address_line1', row_new->'address_line1', 'address_line2', row_new->'address_line2',
    'city', row_new->'city', 'state', row_new->'state', 'pincode', row_new->'pincode',
    'latitude', row_new->'latitude', 'longitude', row_new->'longitude',
    'google_place_id', row_new->'google_place_id', 'location_source', row_new->'location_source',
    'location_verified', row_new->'location_verified', 'location_verified_at', row_new->'location_verified_at',
    'location_verified_by', row_new->'location_verified_by',
    'service_radius_km', row_new->'service_radius_km', 'status', row_new->'status',
    'accepts_orders', row_new->'accepts_orders'
  ) END;

  SELECT assignment.role INTO actor_role
  FROM public.admin_access_assignments assignment
  WHERE assignment.user_id = actor AND assignment.status = 'active';
  SELECT COALESCE(profile.display_name, account.email), account.email
  INTO actor_name_value, actor_email_value
  FROM auth.users account
  LEFT JOIN public.profiles profile ON profile.id = account.id
  WHERE account.id = actor;

  INSERT INTO public.admin_audit_logs (
    actor_id, actor_name, actor_email, actor_role, action, resource_type,
    resource_id, previous_value, new_value, reason, metadata
  ) VALUES (
    actor, actor_name_value, actor_email_value, COALESCE(actor_role, 'SUPER_ADMIN'),
    event_action, 'stores', COALESCE(row_new->>'id', row_old->>'id'),
    before_value, after_value, audit_reason,
    jsonb_build_object('operation', TG_OP)
  );
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.capture_store_admin_audit_log() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_audit_admin_stores
  AFTER INSERT OR UPDATE OR DELETE ON public.stores
  FOR EACH ROW EXECUTE FUNCTION public.capture_store_admin_audit_log();

COMMIT;
