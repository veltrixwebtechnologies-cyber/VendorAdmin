-- Phase B2: additive product/order Store links and legacy location compatibility.
-- This migration is prepared locally only; do not apply to production.
BEGIN;

DO $prerequisites$
BEGIN
  IF to_regclass('public.stores') IS NULL THEN
    RAISE EXCEPTION 'Phase B2 requires the Phase B1 public.stores table';
  END IF;
  IF to_regclass('public.products') IS NULL OR to_regclass('public.orders') IS NULL THEN
    RAISE EXCEPTION 'Phase B2 requires public.products and public.orders';
  END IF;
  IF to_regclass('public.shop_hours') IS NULL THEN
    RAISE EXCEPTION 'Phase B2 requires public.shop_hours to snapshot current operating hours';
  END IF;
END
$prerequisites$;

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS operating_hours jsonb;

-- Preserve the established normalized seller-hour records as a store snapshot.
-- The legacy shop_hours table remains authoritative until a later migration.
UPDATE public.stores st
SET operating_hours = (
  SELECT jsonb_agg(jsonb_build_object(
    'day_of_week', h.day_of_week,
    'is_open', h.is_open,
    'open_time', h.open_time,
    'close_time', h.close_time,
    'break_start', h.break_start,
    'break_end', h.break_end
  ) ORDER BY h.day_of_week) AS schedule
  FROM public.shop_hours h
  WHERE h.seller_id = st.seller_id
)
WHERE st.operating_hours IS NULL AND EXISTS (
  SELECT 1 FROM public.shop_hours h WHERE h.seller_id = st.seller_id
);

CREATE UNIQUE INDEX IF NOT EXISTS stores_seller_id_id_unique
  ON public.stores (seller_id, id);

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS store_id uuid;
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS store_id uuid;

UPDATE public.products p
SET store_id = st.id
FROM public.stores st
WHERE p.store_id IS NULL AND st.seller_id = p.seller_id AND st.is_default;

UPDATE public.orders o
SET store_id = st.id
FROM public.stores st
WHERE o.store_id IS NULL AND st.seller_id = o.seller_id AND st.is_default;

CREATE INDEX IF NOT EXISTS products_store_id_idx ON public.products (store_id)
  WHERE store_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_store_id_idx ON public.orders (store_id)
  WHERE store_id IS NOT NULL;

DO $relationship_constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_seller_store_fkey') THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_seller_store_fkey
      FOREIGN KEY (seller_id, store_id)
      REFERENCES public.stores (seller_id, id)
      ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_seller_store_fkey') THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_seller_store_fkey
      FOREIGN KEY (seller_id, store_id)
      REFERENCES public.stores (seller_id, id)
      ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED NOT VALID;
  END IF;
END
$relationship_constraints$;

ALTER TABLE public.products VALIDATE CONSTRAINT products_seller_store_fkey;
ALTER TABLE public.orders VALIDATE CONSTRAINT orders_seller_store_fkey;

-- The current checkout explicitly rejects carts spanning sellers. Since B2
-- records Store on the seller-owned order header, order_items do not need a
-- duplicate store_id. This avoids redundant and potentially inconsistent data.
COMMENT ON COLUMN public.products.seller_id IS 'Business ownership; store_id identifies the physical selling location.';
COMMENT ON COLUMN public.products.store_id IS 'Physical selling location; nullable during staged migration.';
COMMENT ON COLUMN public.orders.seller_id IS 'Business/financial ownership; store_id identifies fulfillment location.';
COMMENT ON COLUMN public.orders.store_id IS 'Physical fulfillment location; nullable during staged migration.';

CREATE OR REPLACE FUNCTION public.resolve_row_default_store()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  owner_seller_id uuid;
BEGIN
  IF NEW.store_id IS NULL THEN
    SELECT st.id INTO NEW.store_id
    FROM public.stores st
    WHERE st.seller_id = NEW.seller_id AND st.is_default
    LIMIT 1;
    RETURN NEW;
  END IF;

  SELECT st.seller_id INTO owner_seller_id
  FROM public.stores st WHERE st.id = NEW.store_id;
  IF owner_seller_id IS NULL OR owner_seller_id <> NEW.seller_id THEN
    RAISE EXCEPTION 'Store must belong to the same seller as the record'
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_row_default_store() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_products_resolve_store ON public.products;
CREATE TRIGGER trg_products_resolve_store
  BEFORE INSERT OR UPDATE OF seller_id, store_id ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.resolve_row_default_store();
DROP TRIGGER IF EXISTS trg_orders_resolve_store ON public.orders;
CREATE TRIGGER trg_orders_resolve_store
  BEFORE INSERT OR UPDATE OF seller_id, store_id ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.resolve_row_default_store();

CREATE OR REPLACE FUNCTION public.create_initial_store_for_seller()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.stores (
    seller_id, is_default, name, business_type, address_line1, address_line2,
    city, state, pincode, country, latitude, longitude, google_place_id,
    location_verified, location_verified_at, status, accepts_orders, timezone,
    estimated_prep_time_minutes
  ) VALUES (
    NEW.id, true, NEW.business_name, NEW.business_type,
    NEW.address_line1, NEW.address_line2, NEW.city, NEW.state, NEW.pincode, NEW.country,
    NEW.lat, NEW.lng, NEW.wizard_data->>'googlePlaceId',
    false, NULL, NEW.status::text, NEW.accepts_orders, NEW.timezone,
    NEW.estimated_prep_time_minutes
  ) ON CONFLICT (seller_id) WHERE is_default DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.create_initial_store_for_seller() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_create_initial_store_for_seller ON public.sellers;
CREATE TRIGGER trg_create_initial_store_for_seller
  AFTER INSERT ON public.sellers
  FOR EACH ROW EXECUTE FUNCTION public.create_initial_store_for_seller();

-- Replace the existing seller location RPC with an atomic dual-write while
-- preserving the old Seller Hub contract and all established seller columns.
CREATE OR REPLACE FUNCTION public.confirm_seller_store_location(
  p_address_line1 text,
  p_address_line2 text,
  p_city text,
  p_state text,
  p_pincode text,
  p_latitude double precision,
  p_longitude double precision,
  p_google_place_id text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_seller_id uuid;
  v_store_id uuid;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_latitude IS NULL OR p_latitude::text IN ('NaN', 'Infinity', '-Infinity')
     OR p_latitude NOT BETWEEN -90 AND 90 THEN
    RAISE EXCEPTION 'Latitude must be between -90 and 90';
  END IF;
  IF p_longitude IS NULL OR p_longitude::text IN ('NaN', 'Infinity', '-Infinity')
     OR p_longitude NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'Longitude must be between -180 and 180';
  END IF;
  IF NULLIF(trim(p_address_line1), '') IS NULL OR length(trim(p_address_line1)) < 4 THEN
    RAISE EXCEPTION 'Enter a complete store address';
  END IF;
  IF NULLIF(trim(p_city), '') IS NULL OR NULLIF(trim(p_state), '') IS NULL THEN
    RAISE EXCEPTION 'City and state are required';
  END IF;
  IF trim(COALESCE(p_pincode, '')) !~ '^[0-9]{6}$' THEN
    RAISE EXCEPTION 'Enter a valid 6-digit pincode';
  END IF;

  UPDATE public.sellers s
  SET address_line1 = trim(p_address_line1),
      address_line2 = NULLIF(trim(COALESCE(p_address_line2, '')), ''),
      city = trim(p_city), state = trim(p_state), pincode = trim(p_pincode),
      lat = p_latitude, lng = p_longitude,
      shop_latitude = p_latitude, shop_longitude = p_longitude,
      location_verified = true, location_verified_at = now(),
      wizard_data = COALESCE(s.wizard_data, '{}'::jsonb) || jsonb_build_object(
        'lat', p_latitude, 'lng', p_longitude,
        'shopCoordinates', jsonb_build_object('lat', p_latitude, 'lng', p_longitude),
        'googlePlaceId', NULLIF(trim(COALESCE(p_google_place_id, '')), ''),
        'locationConfirmationRequired', false
      ) || CASE WHEN COALESCE(s.wizard_data->>'pickupSame', 'true') = 'true'
        THEN jsonb_build_object(
          'pickupLat', p_latitude, 'pickupLng', p_longitude,
          'pickupCoordinates', jsonb_build_object('lat', p_latitude, 'lng', p_longitude)
        ) ELSE '{}'::jsonb END
  WHERE s.user_id = v_user_id
  RETURNING s.id INTO v_seller_id;
  IF v_seller_id IS NULL THEN RAISE EXCEPTION 'No seller profile is linked to this account'; END IF;

  IF to_regclass('public.stores') IS NOT NULL THEN
    SELECT st.id INTO v_store_id FROM public.stores st
    WHERE st.seller_id = v_seller_id AND st.is_default;
    IF v_store_id IS NOT NULL THEN
      PERFORM set_config('app.confirming_store_location', 'on', true);
      UPDATE public.stores
      SET address_line1 = trim(p_address_line1),
          address_line2 = NULLIF(trim(COALESCE(p_address_line2, '')), ''),
          city = trim(p_city), state = trim(p_state), pincode = trim(p_pincode),
          latitude = p_latitude, longitude = p_longitude,
          google_place_id = NULLIF(trim(COALESCE(p_google_place_id, '')), ''),
          location_source = CASE WHEN NULLIF(trim(COALESCE(p_google_place_id, '')), '') IS NOT NULL
            THEN 'GOOGLE_PLACE' ELSE 'SELLER_GPS' END,
          location_verified = true, location_verified_at = now()
      WHERE id = v_store_id;
      PERFORM set_config('app.confirming_store_location', '', true);
    END IF;
  END IF;
  RETURN v_seller_id;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_seller_store_location(
  text, text, text, text, text, double precision, double precision, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_seller_store_location(
  text, text, text, text, text, double precision, double precision, text
) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_update_store_location(
  p_store_id uuid,
  p_address_line1 text,
  p_address_line2 text,
  p_city text,
  p_state text,
  p_pincode text,
  p_latitude double precision,
  p_longitude double precision,
  p_google_place_id text,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  updated_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_admin_permission('stores.manage') THEN
    RAISE EXCEPTION 'Insufficient permission to manage Store locations' USING ERRCODE = '42501';
  END IF;
  IF p_latitude IS NULL OR p_latitude::text IN ('NaN', 'Infinity', '-Infinity')
     OR p_latitude NOT BETWEEN -90 AND 90 OR p_longitude IS NULL
     OR p_longitude::text IN ('NaN', 'Infinity', '-Infinity')
     OR p_longitude NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'Enter valid map coordinates';
  END IF;
  IF NULLIF(trim(p_address_line1), '') IS NULL OR NULLIF(trim(p_city), '') IS NULL
     OR NULLIF(trim(p_state), '') IS NULL OR trim(COALESCE(p_pincode, '')) !~ '^[0-9]{6}$' THEN
    RAISE EXCEPTION 'Complete address, city, state, and six-digit pincode are required';
  END IF;
  IF length(trim(COALESCE(p_reason, ''))) < 4 THEN
    RAISE EXCEPTION 'Provide a brief reason for this location correction';
  END IF;
  PERFORM set_config('app.admin_audit_reason', left(trim(p_reason), 500), true);
  UPDATE public.stores SET
    address_line1 = trim(p_address_line1),
    address_line2 = NULLIF(trim(COALESCE(p_address_line2, '')), ''),
    city = trim(p_city), state = trim(p_state), pincode = trim(p_pincode),
    latitude = p_latitude, longitude = p_longitude,
    google_place_id = NULLIF(trim(COALESCE(p_google_place_id, '')), ''),
    location_source = CASE WHEN NULLIF(trim(COALESCE(p_google_place_id, '')), '') IS NOT NULL
      THEN 'GOOGLE_PLACE' ELSE 'ADMIN_SELECTED' END,
    location_verified = true, location_verified_at = now(), location_verified_by = auth.uid()
  WHERE id = p_store_id RETURNING id INTO updated_id;
  IF updated_id IS NULL THEN RAISE EXCEPTION 'Store not found'; END IF;
  RETURN updated_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_update_store_location(
  uuid, text, text, text, text, text, double precision, double precision, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_store_location(
  uuid, text, text, text, text, text, double precision, double precision, text, text
) TO authenticated;

-- Store verification flags may only be changed by the trusted seller-location
-- RPC or a stores.manage admin; direct client writes cannot self-verify.
CREATE OR REPLACE FUNCTION public.protect_store_identity_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NOT NULL AND NOT public.has_admin_permission('stores.manage') THEN
      NEW.status := 'draft';
      NEW.location_verified := false;
      NEW.location_verified_at := NULL;
      NEW.location_verified_by := NULL;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.seller_id IS DISTINCT FROM OLD.seller_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Store identity and ownership fields cannot be changed' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_admin_permission('stores.manage')
     AND (NEW.status IS DISTINCT FROM OLD.status
       OR NEW.location_verified_by IS DISTINCT FROM OLD.location_verified_by
       OR ((NEW.location_verified IS DISTINCT FROM OLD.location_verified
         OR NEW.location_verified_at IS DISTINCT FROM OLD.location_verified_at)
         AND current_setting('app.confirming_store_location', true) IS DISTINCT FROM 'on')) THEN
    RAISE EXCEPTION 'Only authorized Store verification workflows may change status or verification' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
