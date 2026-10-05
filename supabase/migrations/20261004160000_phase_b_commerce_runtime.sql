-- Phase B runtime integration. Prepared locally only; database verification pending.
-- Seller remains the account/financial owner. Store is the fulfillment location.
BEGIN;

DO $requirements$
BEGIN
  IF to_regclass('public.stores') IS NULL
     OR to_regclass('public.store_service_zones') IS NULL
     OR to_regprocedure('public.place_order_once(uuid,text,text,text,jsonb,text,text,double precision,double precision)') IS NULL THEN
    RAISE EXCEPTION 'Commerce runtime requires the prepared Store, service-zone, and order RPC migrations';
  END IF;
  IF to_regclass('public.delivery_assignments') IS NULL OR to_regclass('public.order_items') IS NULL THEN
    RAISE EXCEPTION 'Commerce runtime requires delivery assignments and order items';
  END IF;
END
$requirements$;

-- Resolve explicit product Store first; use only the seller's unique default Store
-- for legacy rows. No arbitrary first-store selection is permitted.
CREATE OR REPLACE FUNCTION public.resolve_product_store(p_product_id uuid)
RETURNS TABLE(store_id uuid, seller_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_product_seller uuid; v_explicit_store uuid; v_default_store uuid; v_default_count integer;
BEGIN
  SELECT p.seller_id, p.store_id INTO v_product_seller, v_explicit_store
  FROM public.products p WHERE p.id = p_product_id;
  IF v_product_seller IS NULL THEN RETURN; END IF;
  IF v_explicit_store IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.stores s WHERE s.id = v_explicit_store AND s.seller_id = v_product_seller) THEN
      RAISE EXCEPTION 'Product Store does not belong to its seller' USING ERRCODE = '23503';
    END IF;
    store_id := v_explicit_store; seller_id := v_product_seller; RETURN NEXT; RETURN;
  END IF;
  SELECT count(*), (array_agg(s.id))[1] INTO v_default_count, v_default_store
  FROM public.stores s WHERE s.seller_id = v_product_seller AND s.is_default;
  IF v_default_count <> 1 THEN
    RAISE EXCEPTION 'Product fulfillment Store is missing or ambiguous' USING ERRCODE = 'P0001';
  END IF;
  store_id := v_default_store; seller_id := v_product_seller; RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION public.resolve_product_store(uuid) FROM PUBLIC, anon, authenticated;

-- Safe customer preflight: reveals only storefront and eligibility fields, never
-- seller account/bank/admin-verification data. One physical Store per cart.
CREATE OR REPLACE FUNCTION public.resolve_customer_checkout(
  p_product_ids uuid[], p_customer_latitude double precision, p_customer_longitude double precision
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_product uuid; v_seller uuid; v_store uuid; v_first_seller uuid; v_first_store uuid;
  v_store_row record; v_seller_row record; v_zone_count integer; v_in_zone boolean;
  v_distance double precision; v_radius double precision; v_shop_status jsonb;
BEGIN
  IF p_product_ids IS NULL OR cardinality(p_product_ids) = 0 THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'EMPTY_CART');
  END IF;
  IF p_customer_latitude IS NULL OR p_customer_longitude IS NULL
    OR p_customer_latitude NOT BETWEEN -90 AND 90 OR p_customer_longitude NOT BETWEEN -180 AND 180
    OR (p_customer_latitude = 0 AND p_customer_longitude = 0) THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'CUSTOMER_LOCATION_INVALID');
  END IF;
  FOREACH v_product IN ARRAY p_product_ids LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.products p JOIN public.sellers s ON s.id=p.seller_id
      WHERE p.id=v_product AND p.status::text IN ('active','approved') AND p.stock > 0
        AND s.status::text='approved'
    ) THEN
      RETURN jsonb_build_object('eligible', false, 'reason', 'PRODUCT_UNAVAILABLE');
    END IF;
    SELECT r.seller_id, r.store_id INTO v_seller, v_store FROM public.resolve_product_store(v_product) r;
    IF v_seller IS NULL OR v_store IS NULL THEN RETURN jsonb_build_object('eligible', false, 'reason', 'STORE_UNAVAILABLE'); END IF;
    IF v_first_seller IS NULL THEN v_first_seller := v_seller; v_first_store := v_store;
    ELSIF v_first_seller <> v_seller OR v_first_store <> v_store THEN
      RETURN jsonb_build_object('eligible', false, 'reason', 'MULTIPLE_FULFILLMENT_STORES');
    END IF;
  END LOOP;
  SELECT st.*, s.status::text AS seller_status, s.accepts_orders AS seller_accepts_orders,
    s.lat AS legacy_latitude, s.lng AS legacy_longitude
  INTO v_store_row
  FROM public.stores st JOIN public.sellers s ON s.id = st.seller_id
  WHERE st.id = v_first_store AND s.id = v_first_seller;
  IF NOT FOUND THEN RETURN jsonb_build_object('eligible', false, 'reason', 'STORE_UNAVAILABLE'); END IF;
  IF lower(v_store_row.seller_status) <> 'approved' OR NOT v_store_row.seller_accepts_orders
     OR lower(v_store_row.status) NOT IN ('approved','active') OR NOT v_store_row.accepts_orders THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'STORE_UNAVAILABLE', 'store_id', v_first_store);
  END IF;
  v_shop_status := public.get_shop_status(v_first_seller);
  IF COALESCE((v_shop_status->>'is_open')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'STORE_CLOSED', 'store_id', v_first_store,
      'status', v_shop_status);
  END IF;
  IF COALESCE(v_store_row.latitude, v_store_row.legacy_latitude) NOT BETWEEN -90 AND 90
     OR COALESCE(v_store_row.longitude, v_store_row.legacy_longitude) NOT BETWEEN -180 AND 180
     OR (COALESCE(v_store_row.latitude, v_store_row.legacy_latitude)=0
         AND COALESCE(v_store_row.longitude, v_store_row.legacy_longitude)=0) THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'STORE_LOCATION_UNAVAILABLE');
  END IF;
  v_distance := public.delivery_distance_km(
    COALESCE(v_store_row.latitude, v_store_row.legacy_latitude),
    COALESCE(v_store_row.longitude, v_store_row.legacy_longitude),
    p_customer_latitude, p_customer_longitude);
  IF v_distance IS NULL THEN RETURN jsonb_build_object('eligible', false, 'reason', 'STORE_LOCATION_UNAVAILABLE'); END IF;
  SELECT count(*) INTO v_zone_count
  FROM public.store_service_zones a JOIN public.delivery_zones z ON z.id = a.zone_id
  WHERE a.store_id = v_first_store AND z.is_active;
  IF v_zone_count > 0 THEN
    SELECT EXISTS (
      SELECT 1 FROM public.store_service_zones a JOIN public.delivery_zones z ON z.id = a.zone_id
      WHERE a.store_id = v_first_store AND z.is_active
        AND z.latitude IS NOT NULL AND z.longitude IS NOT NULL AND z.radius_km >= 0
        AND public.delivery_distance_km(z.latitude, z.longitude, p_customer_latitude, p_customer_longitude) <= z.radius_km
    ) INTO v_in_zone;
    IF NOT v_in_zone THEN RETURN jsonb_build_object('eligible', false, 'reason', 'OUTSIDE_SERVICE_ZONE', 'store_id', v_first_store, 'distance_km', v_distance); END IF;
  ELSE
    v_radius := v_store_row.service_radius_km;
    IF v_radius IS NOT NULL AND v_distance > v_radius THEN
      RETURN jsonb_build_object('eligible', false, 'reason', 'OUTSIDE_DELIVERY_RADIUS', 'store_id', v_first_store, 'distance_km', v_distance);
    END IF;
  END IF;
  RETURN jsonb_build_object('eligible', true, 'reason', 'DELIVERABLE', 'store_id', v_first_store,
    'seller_id', v_first_seller, 'store_name', COALESCE(v_store_row.name, 'Local shop'), 'distance_km', v_distance);
END $$;
REVOKE ALL ON FUNCTION public.resolve_customer_checkout(uuid[],double precision,double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_customer_checkout(uuid[],double precision,double precision) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_customer_storefront(p_seller_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_store record; v_status jsonb;
BEGIN
  SELECT st.id, st.seller_id, st.name, st.description, st.address_line1, st.address_line2,
    st.city, st.state, st.pincode, st.latitude, st.longitude, st.google_place_id,
    st.service_radius_km, st.status, st.accepts_orders, s.status::text AS seller_status,
    s.accepts_orders AS seller_accepts_orders
  INTO v_store
  FROM public.stores st JOIN public.sellers s ON s.id=st.seller_id
  WHERE st.seller_id=p_seller_id AND st.is_default AND s.status::text='approved';
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_status := public.get_shop_status(p_seller_id);
  RETURN jsonb_build_object(
    'id',v_store.id,'seller_id',v_store.seller_id,'name',COALESCE(v_store.name,'Local shop'),
    'description',v_store.description,'address_line1',v_store.address_line1,'address_line2',v_store.address_line2,
    'city',v_store.city,'state',v_store.state,'pincode',v_store.pincode,
    'latitude',v_store.latitude,'longitude',v_store.longitude,'google_place_id',v_store.google_place_id,
    'service_radius_km',v_store.service_radius_km,'status',v_store.status,
    'can_browse',lower(v_store.status) IN ('active','approved'),
    'can_order',lower(v_store.status) IN ('active','approved') AND v_store.accepts_orders
      AND v_store.seller_accepts_orders AND COALESCE((v_status->>'is_open')::boolean,false),
    'availability',v_status
  );
END $$;
REVOKE ALL ON FUNCTION public.get_customer_storefront(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_customer_storefront(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_customer_order_storefronts(p_order_ids uuid[])
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'order_id',o.id,'store_id',st.id,'name',COALESCE(st.name,s.business_name,'Local shop'),
    'address_line1',COALESCE(st.address_line1,s.address_line1),'city',COALESCE(st.city,s.city),
    'latitude',COALESCE(st.latitude,s.lat),'longitude',COALESCE(st.longitude,s.lng)
  )), '[]'::jsonb)
  FROM public.orders o JOIN public.sellers s ON s.id=o.seller_id
  LEFT JOIN public.stores st ON st.id=o.store_id AND st.seller_id=o.seller_id
  WHERE o.user_id=auth.uid() AND o.id=ANY(COALESCE(p_order_ids,'{}'::uuid[]))
$$;
REVOKE ALL ON FUNCTION public.get_customer_order_storefronts(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_customer_order_storefronts(uuid[]) TO authenticated;

-- Final server-side invariant at item insertion protects COD and payment RPC
-- order creation alike. Existing architecture is one seller per order; we now
-- also require one physical fulfillment Store per order.
CREATE OR REPLACE FUNCTION public.enforce_order_item_store_commerce()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_order public.orders%ROWTYPE; v_seller uuid; v_store uuid; v_check jsonb;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = NEW.order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF NEW.product_id IS NULL THEN RAISE EXCEPTION 'Order item product is required'; END IF;
  SELECT r.seller_id, r.store_id INTO v_seller, v_store FROM public.resolve_product_store(NEW.product_id) r;
  IF v_seller IS DISTINCT FROM v_order.seller_id THEN
    RAISE EXCEPTION 'Order items must belong to the order seller' USING ERRCODE = '23503';
  END IF;
  IF EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.order_id=NEW.order_id)
     AND v_order.store_id IS DISTINCT FROM v_store THEN
    RAISE EXCEPTION 'An order cannot contain items from multiple Stores' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.order_id=NEW.order_id)
     AND v_order.store_id IS DISTINCT FROM v_store THEN
    UPDATE public.orders SET store_id = v_store WHERE id = NEW.order_id;
  END IF;
  IF v_order.customer_latitude IS NULL OR v_order.customer_longitude IS NULL THEN
    RAISE EXCEPTION 'Customer delivery location is required' USING ERRCODE = 'P0001';
  END IF;
  v_check := public.resolve_customer_checkout(ARRAY[NEW.product_id], v_order.customer_latitude, v_order.customer_longitude);
  IF COALESCE((v_check->>'eligible')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Checkout is not eligible: %', COALESCE(v_check->>'reason','STORE_UNAVAILABLE') USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enforce_order_item_store_commerce() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_enforce_order_item_store_commerce ON public.order_items;
CREATE TRIGGER trg_enforce_order_item_store_commerce BEFORE INSERT ON public.order_items
FOR EACH ROW EXECUTE FUNCTION public.enforce_order_item_store_commerce();

-- Reusable dispatch pickup resolver; no invented coordinates. Existing callers
-- can fall back to the established seller GPS when an order predates Store IDs.
CREATE OR REPLACE FUNCTION public.resolve_order_pickup_location(p_order_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'store_id', st.id,
    'name', COALESCE(st.name, s.business_name),
    'address', concat_ws(', ', COALESCE(st.address_line1,s.address_line1), COALESCE(st.address_line2,s.address_line2), COALESCE(st.city,s.city), COALESCE(st.state,s.state), COALESCE(st.pincode,s.pincode)),
    'latitude', COALESCE(st.latitude,s.lat), 'longitude', COALESCE(st.longitude,s.lng),
    'source', CASE WHEN st.latitude IS NOT NULL AND st.longitude IS NOT NULL THEN 'store' ELSE 'seller-legacy' END
  )
  FROM public.orders o JOIN public.sellers s ON s.id=o.seller_id
  LEFT JOIN public.stores st ON st.id=o.store_id AND st.seller_id=o.seller_id
  WHERE o.id=p_order_id
$$;
REVOKE ALL ON FUNCTION public.resolve_order_pickup_location(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_order_pickup_location(uuid) FROM anon, authenticated;

ALTER TABLE public.delivery_assignments
  ADD COLUMN IF NOT EXISTS pickup_store_name text,
  ADD COLUMN IF NOT EXISTS pickup_address text;

CREATE OR REPLACE FUNCTION public.capture_store_pickup_snapshot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_pickup jsonb;
BEGIN
  v_pickup := public.resolve_order_pickup_location(NEW.order_id);
  IF v_pickup IS NOT NULL THEN
    NEW.pickup_store_name := v_pickup->>'name';
    NEW.pickup_address := v_pickup->>'address';
    NEW.pickup_latitude := NULLIF(v_pickup->>'latitude','')::double precision;
    NEW.pickup_longitude := NULLIF(v_pickup->>'longitude','')::double precision;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.capture_store_pickup_snapshot() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_capture_store_pickup_snapshot ON public.delivery_assignments;
CREATE TRIGGER trg_capture_store_pickup_snapshot
BEFORE INSERT OR UPDATE OF order_id ON public.delivery_assignments
FOR EACH ROW EXECUTE FUNCTION public.capture_store_pickup_snapshot();

-- Refine Phase B's existing audit trigger to use specific event names for
-- hours and delivery settings while continuing to write only to Phase A logs.
CREATE OR REPLACE FUNCTION public.capture_store_admin_audit_log()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor uuid := auth.uid(); actor_role text; actor_name_value text; actor_email_value text;
  event_action text; before_value jsonb; after_value jsonb;
  audit_reason text := NULLIF(current_setting('app.admin_audit_reason', true), '');
  row_old jsonb := CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  row_new jsonb := CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END;
BEGIN
  IF actor IS NULL OR NOT public.has_admin_permission('stores.manage') THEN RETURN NULL; END IF;
  IF TG_OP='INSERT' THEN event_action := 'STORE_CREATED';
  ELSIF TG_OP='DELETE' THEN event_action := 'STORE_DELETED';
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
    AND row_new->>'location_verified'='true' THEN event_action := 'STORE_LOCATION_VERIFIED';
  ELSIF row_old->>'status' IS DISTINCT FROM row_new->>'status' THEN event_action := 'STORE_STATUS_CHANGED';
  ELSIF row_old->'operating_hours' IS DISTINCT FROM row_new->'operating_hours' THEN event_action := 'STORE_HOURS_UPDATED';
  ELSIF row_old->>'service_radius_km' IS DISTINCT FROM row_new->>'service_radius_km'
     OR row_old->>'accepts_orders' IS DISTINCT FROM row_new->>'accepts_orders' THEN
    event_action := 'STORE_DELIVERY_SETTINGS_UPDATED';
  ELSE event_action := 'STORE_UPDATED'; END IF;

  before_value := CASE WHEN row_old IS NULL THEN NULL ELSE jsonb_build_object(
    'id',row_old->'id','seller_id',row_old->'seller_id','name',row_old->'name',
    'address_line1',row_old->'address_line1','address_line2',row_old->'address_line2',
    'city',row_old->'city','state',row_old->'state','pincode',row_old->'pincode',
    'latitude',row_old->'latitude','longitude',row_old->'longitude','google_place_id',row_old->'google_place_id',
    'location_source',row_old->'location_source','location_verified',row_old->'location_verified',
    'location_verified_at',row_old->'location_verified_at','location_verified_by',row_old->'location_verified_by',
    'operating_hours',row_old->'operating_hours','service_radius_km',row_old->'service_radius_km',
    'status',row_old->'status','accepts_orders',row_old->'accepts_orders') END;
  after_value := CASE WHEN row_new IS NULL THEN NULL ELSE jsonb_build_object(
    'id',row_new->'id','seller_id',row_new->'seller_id','name',row_new->'name',
    'address_line1',row_new->'address_line1','address_line2',row_new->'address_line2',
    'city',row_new->'city','state',row_new->'state','pincode',row_new->'pincode',
    'latitude',row_new->'latitude','longitude',row_new->'longitude','google_place_id',row_new->'google_place_id',
    'location_source',row_new->'location_source','location_verified',row_new->'location_verified',
    'location_verified_at',row_new->'location_verified_at','location_verified_by',row_new->'location_verified_by',
    'operating_hours',row_new->'operating_hours','service_radius_km',row_new->'service_radius_km',
    'status',row_new->'status','accepts_orders',row_new->'accepts_orders') END;
  SELECT a.role INTO actor_role FROM public.admin_access_assignments a
    WHERE a.user_id=actor AND a.status='active';
  SELECT COALESCE(p.display_name,u.email),u.email INTO actor_name_value,actor_email_value
    FROM auth.users u LEFT JOIN public.profiles p ON p.id=u.id WHERE u.id=actor;
  INSERT INTO public.admin_audit_logs(actor_id,actor_name,actor_email,actor_role,action,resource_type,
    resource_id,previous_value,new_value,reason,metadata)
  VALUES(actor,actor_name_value,actor_email_value,COALESCE(actor_role,'SUPER_ADMIN'),event_action,'stores',
    COALESCE(row_new->>'id',row_old->>'id'),before_value,after_value,audit_reason,jsonb_build_object('operation',TG_OP));
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.capture_store_admin_audit_log() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
