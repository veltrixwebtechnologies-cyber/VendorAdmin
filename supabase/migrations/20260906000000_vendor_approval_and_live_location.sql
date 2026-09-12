-- ============================================================
-- MIGRATION: 20260906000000_vendor_approval_and_live_location.sql
-- Implement complete Vendor Approval + Live Vendor Location +
-- Delivery Partner Pickup Workflow for LocalShore.
-- ============================================================

-- 1. Extend order_status enum values safely
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'vendor_accepted';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'cancelled_by_vendor';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'delivery_partner_assigned';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'going_to_vendor';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'arrived_at_vendor';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'going_to_customer';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'arrived_at_customer';

-- 2. Ensure verified location columns on sellers table
ALTER TABLE public.sellers
  ADD COLUMN IF NOT EXISTS shop_latitude double precision,
  ADD COLUMN IF NOT EXISTS shop_longitude double precision,
  ADD COLUMN IF NOT EXISTS location_verified boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS location_verified_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS estimated_prep_time_minutes integer DEFAULT 20;

-- Backfill shop_latitude and shop_longitude from existing lat/lng/current_latitude columns if missing
UPDATE public.sellers
SET shop_latitude = COALESCE(shop_latitude, lat, current_latitude, (wizard_data->>'lat')::double precision, 13.0827),
    shop_longitude = COALESCE(shop_longitude, lng, current_longitude, (wizard_data->>'lng')::double precision, 80.2707)
WHERE shop_latitude IS NULL OR shop_longitude IS NULL;

-- 3. Create temporary vendor live location table
CREATE TABLE IF NOT EXISTS public.vendor_order_live_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES public.sellers(id) ON DELETE CASCADE,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  heading double precision,
  speed double precision,
  accuracy double precision,
  is_active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vendor_order_live_locations_order_unique UNIQUE (order_id)
);

ALTER TABLE public.vendor_order_live_locations ENABLE ROW LEVEL SECURITY;

-- Helper security functions
CREATE OR REPLACE FUNCTION public.is_order_assigned_partner(_order_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.orders o
    JOIN public.delivery_partners p ON p.id = o.assigned_partner_id
    WHERE o.id = _order_id
      AND p.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_order_seller(_order_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.orders o
    JOIN public.sellers s ON s.id = o.seller_id
    WHERE o.id = _order_id
      AND s.user_id = auth.uid()
  );
$$;

-- RLS Policies for vendor_order_live_locations
DROP POLICY IF EXISTS "Sellers can manage their live location" ON public.vendor_order_live_locations;
CREATE POLICY "Sellers can manage their live location"
  ON public.vendor_order_live_locations
  FOR ALL
  TO authenticated
  USING (
    seller_id IN (SELECT id FROM public.sellers WHERE user_id = auth.uid())
  )
  WITH CHECK (
    seller_id IN (SELECT id FROM public.sellers WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Assigned partners can read vendor live location" ON public.vendor_order_live_locations;
CREATE POLICY "Assigned partners can read vendor live location"
  ON public.vendor_order_live_locations
  FOR SELECT
  TO authenticated
  USING (
    public.is_order_assigned_partner(order_id)
  );

-- Realtime Publication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
      AND schemaname = 'public' 
      AND tablename = 'vendor_order_live_locations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.vendor_order_live_locations;
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 4. Vendor Workflow RPCs

-- Vendor Accept Order
CREATE OR REPLACE FUNCTION public.vendor_accept_order(
  _order_id uuid,
  _estimated_prep_minutes integer DEFAULT 20
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o public.orders;
  s_id uuid;
BEGIN
  SELECT id INTO s_id FROM public.sellers WHERE user_id = auth.uid() LIMIT 1;
  IF s_id IS NULL THEN
    RAISE EXCEPTION 'Vendor profile required';
  END IF;

  SELECT * INTO o FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF o.id IS NULL OR o.seller_id <> s_id THEN
    RAISE EXCEPTION 'Order not found or unauthorized';
  END IF;

  IF o.status::text NOT IN ('new', 'pending') THEN
    RAISE EXCEPTION 'Order is not in pending state (current status: %)', o.status;
  END IF;

  UPDATE public.orders
  SET status = 'vendor_accepted'::public.order_status,
      updated_at = now()
  WHERE id = _order_id
  RETURNING * INTO o;

  -- Create customer notification
  INSERT INTO public.customer_notifications (user_id, title, body, kind, order_id)
  VALUES (
    o.user_id,
    'Order Accepted! 🍳',
    'The vendor has accepted your order and is preparing it. Estimated time: ' || COALESCE(_estimated_prep_minutes, 20) || ' mins.',
    'order_status',
    o.id
  );

  RETURN o;
END;
$$;

-- Vendor Reject Order
CREATE OR REPLACE FUNCTION public.vendor_reject_order(
  _order_id uuid,
  _reason text DEFAULT 'Cancelled by vendor'
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o public.orders;
  s_id uuid;
BEGIN
  SELECT id INTO s_id FROM public.sellers WHERE user_id = auth.uid() LIMIT 1;
  IF s_id IS NULL THEN
    RAISE EXCEPTION 'Vendor profile required';
  END IF;

  SELECT * INTO o FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF o.id IS NULL OR o.seller_id <> s_id THEN
    RAISE EXCEPTION 'Order not found or unauthorized';
  END IF;

  IF o.status::text IN ('delivered', 'cancelled', 'cancelled_by_vendor', 'picked_up') THEN
    RAISE EXCEPTION 'Order cannot be rejected in current status: %', o.status;
  END IF;

  UPDATE public.orders
  SET status = 'cancelled_by_vendor'::public.order_status,
      updated_at = now()
  WHERE id = _order_id
  RETURNING * INTO o;

  -- Restore product stocks
  UPDATE public.products p
  SET stock = p.stock + oi.qty
  FROM public.order_items oi
  WHERE oi.order_id = _order_id AND oi.product_id = p.id;

  -- Notify customer
  INSERT INTO public.customer_notifications (user_id, title, body, kind, order_id)
  VALUES (
    o.user_id,
    'Order Cancelled by Vendor ❌',
    COALESCE(_reason, 'The vendor was unable to accept your order.'),
    'order_cancelled',
    o.id
  );

  RETURN o;
END;
$$;

-- Vendor Mark Ready for Pickup
CREATE OR REPLACE FUNCTION public.vendor_mark_ready_for_pickup(
  _order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o public.orders;
  s_id uuid;
  dispatched_count integer := 0;
BEGIN
  SELECT id INTO s_id FROM public.sellers WHERE user_id = auth.uid() LIMIT 1;
  IF s_id IS NULL THEN
    RAISE EXCEPTION 'Vendor profile required';
  END IF;

  SELECT * INTO o FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF o.id IS NULL OR o.seller_id <> s_id THEN
    RAISE EXCEPTION 'Order not found or unauthorized';
  END IF;

  IF o.status::text NOT IN ('vendor_accepted', 'accepted', 'preparing', 'packed') THEN
    RAISE EXCEPTION 'Order must be accepted by vendor before marking ready (current status: %)', o.status;
  END IF;

  UPDATE public.orders
  SET status = 'ready_for_pickup'::public.order_status,
      updated_at = now()
  WHERE id = _order_id
  RETURNING * INTO o;

  -- ONLY NOW start delivery partner assignment broadcast!
  BEGIN
    dispatched_count := public.broadcast_delivery_request(_order_id, 60);
    IF COALESCE(dispatched_count, 0) = 0 THEN
      PERFORM public.dispatch_delivery_for_order_internal(_order_id, 60);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'ready_for_pickup',
    'dispatched_count', dispatched_count
  );
END;
$$;

-- Vendor Live Location RPCs
CREATE OR REPLACE FUNCTION public.update_vendor_live_location(
  _order_id uuid,
  _lat double precision,
  _lng double precision,
  _heading double precision DEFAULT NULL,
  _speed double precision DEFAULT NULL,
  _accuracy double precision DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o public.orders;
  s_id uuid;
BEGIN
  SELECT id INTO s_id FROM public.sellers WHERE user_id = auth.uid() LIMIT 1;
  IF s_id IS NULL THEN
    RAISE EXCEPTION 'Vendor profile required';
  END IF;

  SELECT * INTO o FROM public.orders WHERE id = _order_id;
  IF o.id IS NULL OR o.seller_id <> s_id THEN
    RAISE EXCEPTION 'Order not found or unauthorized';
  END IF;

  IF o.status::text IN ('picked_up', 'out_for_delivery', 'going_to_customer', 'arrived_at_customer', 'delivered', 'cancelled', 'cancelled_by_vendor') THEN
    -- Deactivate live sharing if order has progressed past pickup
    UPDATE public.vendor_order_live_locations
    SET is_active = false, updated_at = now()
    WHERE order_id = _order_id;
    RETURN false;
  END IF;

  INSERT INTO public.vendor_order_live_locations (
    order_id, seller_id, latitude, longitude, heading, speed, accuracy, is_active, updated_at
  ) VALUES (
    _order_id, s_id, _lat, _lng, _heading, _speed, _accuracy, true, now()
  )
  ON CONFLICT (order_id) DO UPDATE SET
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    heading = excluded.heading,
    speed = excluded.speed,
    accuracy = excluded.accuracy,
    is_active = true,
    updated_at = now();

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.stop_vendor_live_location(_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s_id uuid;
BEGIN
  SELECT id INTO s_id FROM public.sellers WHERE user_id = auth.uid() LIMIT 1;
  IF s_id IS NULL THEN
    RAISE EXCEPTION 'Vendor profile required';
  END IF;

  UPDATE public.vendor_order_live_locations
  SET is_active = false, updated_at = now()
  WHERE order_id = _order_id AND seller_id = s_id;

  RETURN true;
END;
$$;

-- 5. Update place_order to prevent immediate dispatch
CREATE OR REPLACE FUNCTION public.place_order(
  p_buyer_name text,
  p_buyer_phone text,
  p_buyer_address text,
  p_items jsonb,
  p_payment_method text,
  p_is_demo boolean DEFAULT false,
  p_coupon_code text DEFAULT NULL,
  p_customer_latitude double precision DEFAULT NULL,
  p_customer_longitude double precision DEFAULT NULL
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  item jsonb;
  requested_items jsonb := '{}'::jsonb;
  requested_product_id uuid;
  requested_quantity integer;
  product_row record;
  created_order public.orders;
  order_seller_id uuid;
  calculated_subtotal numeric(10,2) := 0;
  calculated_shipping numeric(10,2) := 25;
  calculated_discount numeric(10,2) := 0;
  calculated_total numeric(10,2) := 0;
  coupon_quote jsonb;
  selected_coupon_id uuid;
  v_shop_status jsonb;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Authentication required', ERRCODE = '28000';
  END IF;
  IF p_buyer_address IS NULL OR length(trim(p_buyer_address)) = 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'Delivery address is required', ERRCODE = '22023';
  END IF;
  IF p_payment_method IS NULL OR p_payment_method NOT IN ('upi', 'card', 'cod') THEN
    RAISE EXCEPTION USING MESSAGE = 'Invalid payment method', ERRCODE = '22023';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'Order must contain at least one item', ERRCODE = '22023';
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    IF jsonb_typeof(item) <> 'object'
       OR COALESCE(item->>'product_id', '') !~
          '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
       OR COALESCE(item->>'qty', '') !~ '^[1-9][0-9]*$' THEN
      RAISE EXCEPTION USING MESSAGE = 'Invalid order item', ERRCODE = '22023';
    END IF;
    requested_product_id := (item->>'product_id')::uuid;
    requested_quantity := (item->>'qty')::integer;
    requested_items := jsonb_set(
      requested_items,
      ARRAY[requested_product_id::text],
      to_jsonb(COALESCE((requested_items->>requested_product_id::text)::integer, 0) + requested_quantity),
      true
    );
  END LOOP;

  FOR item IN SELECT jsonb_build_object('product_id', key, 'qty', value)
              FROM jsonb_each_text(requested_items)
  LOOP
    requested_product_id := (item->>'product_id')::uuid;
    requested_quantity := (item->>'qty')::integer;
    SELECT p.id, p.seller_id, p.name, p.sku, p.selling_price, p.stock
      INTO product_row
    FROM public.products p
    JOIN public.sellers s ON s.id = p.seller_id
    WHERE p.id = requested_product_id
      AND p.status::text IN ('active', 'approved')
      AND s.status::text = 'approved'
    FOR UPDATE OF p;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING MESSAGE = 'Product is not available', ERRCODE = 'P0001';
    END IF;
    IF COALESCE(product_row.stock, 0) < requested_quantity THEN
      RAISE EXCEPTION USING MESSAGE = format('Insufficient stock for product %s', product_row.name), ERRCODE = 'P0001';
    END IF;
    IF order_seller_id IS NULL THEN
      order_seller_id := product_row.seller_id;
    ELSIF order_seller_id <> product_row.seller_id THEN
      RAISE EXCEPTION USING MESSAGE = 'Cart items must come from one approved shop', ERRCODE = '22023';
    END IF;
    calculated_subtotal := calculated_subtotal + product_row.selling_price * requested_quantity;
  END LOOP;

  IF order_seller_id IS NOT NULL THEN
    BEGIN
      v_shop_status := public.get_shop_status(order_seller_id);
      IF v_shop_status IS NOT NULL AND NOT COALESCE((v_shop_status->>'is_open')::boolean, true) THEN
        RAISE EXCEPTION USING
          MESSAGE = COALESCE(NULLIF(v_shop_status->>'label', ''), 'Shop is currently closed or not accepting orders'),
          ERRCODE = 'P0001';
      END IF;
    EXCEPTION
      WHEN SQLSTATE 'P0001' THEN
        RAISE;
      WHEN OTHERS THEN
        NULL;
    END;
  END IF;

  IF p_coupon_code IS NOT NULL AND length(trim(p_coupon_code)) > 0 THEN
    PERFORM 1 FROM public.coupons WHERE upper(code) = upper(trim(p_coupon_code)) FOR UPDATE;
    coupon_quote := public.quote_coupon(p_coupon_code, p_items);
    selected_coupon_id := (coupon_quote->>'coupon_id')::uuid;
    calculated_shipping := (coupon_quote->>'shipping_fee')::numeric;
    calculated_discount := (coupon_quote->>'discount_amount')::numeric;
    calculated_total := (coupon_quote->>'total')::numeric;
  ELSE
    calculated_total := calculated_subtotal + calculated_shipping;
  END IF;

  INSERT INTO public.orders (
    seller_id, user_id, buyer_name, buyer_phone, buyer_address,
    customer_latitude, customer_longitude,
    payment_method, is_demo, status, subtotal, shipping_fee, total,
    coupon_id, coupon_code, discount_amount
  )
  VALUES (
    order_seller_id, current_user_id,
    COALESCE(NULLIF(trim(p_buyer_name), ''), 'Customer'),
    NULLIF(trim(p_buyer_phone), ''), trim(p_buyer_address),
    p_customer_latitude, p_customer_longitude,
    p_payment_method, COALESCE(p_is_demo, false), 'new',
    calculated_subtotal, calculated_shipping, calculated_total,
    selected_coupon_id,
    CASE WHEN selected_coupon_id IS NULL THEN NULL ELSE upper(trim(p_coupon_code)) END,
    calculated_discount
  )
  RETURNING * INTO created_order;

  FOR item IN SELECT jsonb_build_object('product_id', key, 'qty', value)
              FROM jsonb_each_text(requested_items)
  LOOP
    requested_product_id := (item->>'product_id')::uuid;
    requested_quantity := (item->>'qty')::integer;
    SELECT p.id, p.name, p.sku, p.selling_price INTO product_row
    FROM public.products p WHERE p.id = requested_product_id FOR UPDATE;

    INSERT INTO public.order_items (
      order_id, product_id, user_id, product_name, sku, qty, unit_price, line_total
    ) VALUES (
      created_order.id, product_row.id, current_user_id, product_row.name,
      product_row.sku, requested_quantity, product_row.selling_price,
      product_row.selling_price * requested_quantity
    );
    UPDATE public.products SET stock = stock - requested_quantity WHERE id = requested_product_id;
  END LOOP;

  IF selected_coupon_id IS NOT NULL THEN
    UPDATE public.coupons SET used_count = used_count + 1 WHERE id = selected_coupon_id;
    INSERT INTO public.coupon_usages (coupon_id, user_id, order_id, use_count, used_at)
    VALUES (selected_coupon_id, current_user_id, created_order.id, 1, now())
    ON CONFLICT (coupon_id, user_id) DO UPDATE
      SET use_count = public.coupon_usages.use_count + 1,
          order_id = excluded.order_id,
          used_at = excluded.used_at;
  END IF;

  -- NOTE: Order is created in 'new' status. Delivery partner dispatch will ONLY occur after vendor accepts and marks ready!

  RETURN created_order;
END;
$$;

-- 6. Update accept_delivery_request to require 'ready_for_pickup' status
CREATE OR REPLACE FUNCTION public.accept_delivery_request(_assignment_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a record;
  o record;
  existing_assignment_id uuid;
BEGIN
  SELECT * INTO a
  FROM public.delivery_assignments
  WHERE id = _assignment_id
  FOR UPDATE;

  IF a.id IS NULL OR NOT public.is_my_partner(a.partner_id) THEN
    RAISE EXCEPTION 'Delivery request not found';
  END IF;

  SELECT * INTO o
  FROM public.orders
  WHERE id = a.order_id
  FOR UPDATE;

  IF o.id IS NULL THEN
    UPDATE public.delivery_assignments
    SET status = 'expired', updated_at = now()
    WHERE id = a.id;
    RETURN NULL;
  END IF;

  IF o.assigned_partner_id = a.partner_id
     AND o.status::text IN ('delivered', 'cancelled', 'cancelled_by_vendor') THEN
    UPDATE public.delivery_assignments
    SET status = 'expired', updated_at = now()
    WHERE order_id = a.order_id AND status IN ('pending', 'requested');
    RETURN NULL;
  END IF;

  -- Idempotent retry for partner
  IF o.assigned_partner_id = a.partner_id THEN
    SELECT id INTO existing_assignment_id
    FROM public.delivery_assignments
    WHERE order_id = a.order_id
      AND partner_id = a.partner_id
      AND status IN ('accepted', 'going_to_vendor', 'navigating_to_vendor', 'reached_vendor', 'arrived_at_vendor',
                     'picked_up', 'going_to_customer', 'out_for_delivery', 'arrived_at_customer')
    ORDER BY created_at DESC
    LIMIT 1;

    UPDATE public.delivery_assignments
    SET status = CASE
          WHEN id = coalesce(existing_assignment_id, a.id) THEN 'accepted'
          ELSE 'expired'
        END,
        responded_at = CASE
          WHEN id = coalesce(existing_assignment_id, a.id) THEN coalesce(responded_at, now())
          ELSE responded_at
        END,
        updated_at = now()
    WHERE order_id = a.order_id
      AND partner_id = a.partner_id
      AND status IN ('pending', 'requested');

    RETURN coalesce(existing_assignment_id, a.id);
  END IF;

  IF o.assigned_partner_id IS NOT NULL THEN
    UPDATE public.delivery_assignments
    SET status = 'expired', updated_at = now()
    WHERE order_id = a.order_id AND status IN ('pending', 'requested');
    RETURN NULL;
  END IF;

  IF a.status NOT IN ('pending', 'requested') OR a.expires_at < now() THEN
    UPDATE public.delivery_assignments
    SET status = 'expired', updated_at = now()
    WHERE id = a.id AND status IN ('pending', 'requested');
    RETURN NULL;
  END IF;

  -- ENFORCE: Vendor MUST have marked order 'ready_for_pickup' before delivery partner can accept!
  IF o.status::text NOT IN ('ready_for_pickup', 'assigned', 'delivery_partner_assigned') THEN
    RAISE EXCEPTION 'Vendor has not marked order ready for pickup yet (current status: %)', o.status;
  END IF;

  UPDATE public.orders
  SET status = 'delivery_partner_assigned'::public.order_status,
      assigned_partner_id = a.partner_id,
      updated_at = now()
  WHERE id = a.order_id
    AND (assigned_partner_id IS NULL OR assigned_partner_id = a.partner_id);

  IF NOT FOUND THEN
    UPDATE public.delivery_assignments
    SET status = 'expired', updated_at = now()
    WHERE order_id = a.order_id AND status IN ('pending', 'requested');
    RETURN NULL;
  END IF;

  UPDATE public.delivery_assignments
  SET status = 'accepted', responded_at = now(), updated_at = now()
  WHERE id = a.id;

  UPDATE public.delivery_assignments
  SET status = 'expired', updated_at = now()
  WHERE order_id = a.order_id AND id <> a.id AND status IN ('pending', 'requested');

  UPDATE public.delivery_partners
  SET availability = 'busy', updated_at = now()
  WHERE id = a.partner_id;

  INSERT INTO public.delivery_tracking (assignment_id, status, note)
  VALUES (a.id, 'accepted', 'Partner accepted delivery request');

  RETURN a.id;
END;
$$;

-- 7. Update advance_delivery_assignment with state machine and live location auto-stop
CREATE OR REPLACE FUNCTION public.advance_delivery_assignment(
  _assignment_id uuid,
  _next_status text
)
RETURNS public.delivery_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.delivery_assignments;
  o public.orders;
  target_assignment_status text;
  target_order_status public.order_status;
BEGIN
  SELECT * INTO a FROM public.delivery_assignments WHERE id = _assignment_id FOR UPDATE;

  IF a.id IS NULL OR NOT public.is_my_partner(a.partner_id) THEN
    RAISE EXCEPTION 'Delivery assignment not found or unauthorized';
  END IF;

  SELECT * INTO o FROM public.orders WHERE id = a.order_id FOR UPDATE;

  target_assignment_status := CASE _next_status
    WHEN 'going_to_vendor' THEN 'going_to_vendor'
    WHEN 'navigating_to_vendor' THEN 'going_to_vendor'
    WHEN 'arrived_at_vendor' THEN 'reached_vendor'
    WHEN 'reached_vendor' THEN 'reached_vendor'
    WHEN 'picked_up' THEN 'picked_up'
    WHEN 'going_to_customer' THEN 'out_for_delivery'
    WHEN 'out_for_delivery' THEN 'out_for_delivery'
    WHEN 'arrived_at_customer' THEN 'at_customer'
    WHEN 'at_customer' THEN 'at_customer'
    WHEN 'delivered' THEN 'delivered'
    ELSE 'accepted'
  END;

  target_order_status := CASE target_assignment_status
    WHEN 'going_to_vendor' THEN 'going_to_vendor'::public.order_status
    WHEN 'reached_vendor' THEN 'arrived_at_vendor'::public.order_status
    WHEN 'picked_up' THEN 'picked_up'::public.order_status
    WHEN 'out_for_delivery' THEN 'going_to_customer'::public.order_status
    WHEN 'at_customer' THEN 'arrived_at_customer'::public.order_status
    WHEN 'delivered' THEN 'delivered'::public.order_status
    ELSE 'delivery_partner_assigned'::public.order_status
  END;

  -- If status is picked_up, automatically stop vendor live location sharing!
  IF target_assignment_status = 'picked_up' THEN
    UPDATE public.vendor_order_live_locations
    SET is_active = false, updated_at = now()
    WHERE order_id = a.order_id;
  END IF;

  UPDATE public.delivery_assignments
  SET status = target_assignment_status, updated_at = now()
  WHERE id = a.id
  RETURNING * INTO a;

  UPDATE public.orders
  SET status = target_order_status, updated_at = now()
  WHERE id = a.order_id;

  INSERT INTO public.delivery_tracking (assignment_id, status, note)
  VALUES (a.id, target_assignment_status, 'Delivery progress updated to ' || target_assignment_status);

  RETURN a;
END;
$$;

-- Permissions Grants
GRANT EXECUTE ON FUNCTION public.vendor_accept_order(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vendor_reject_order(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vendor_mark_ready_for_pickup(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_vendor_live_location(uuid, double precision, double precision, double precision, double precision, double precision) TO authenticated;
GRANT EXECUTE ON FUNCTION public.stop_vendor_live_location(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
