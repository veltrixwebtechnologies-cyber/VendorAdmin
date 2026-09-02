-- ============================================================
-- MIGRATION: 20260902000000_automatic_immediate_order_dispatch.sql
-- Fixes place_order function presence & enables immediate, automatic
-- assignment of available delivery partners upon order creation.
-- ============================================================

-- Drop functions first to handle any parameter signature or return type changes cleanly
DROP FUNCTION IF EXISTS public.claim_next_delivery_offer();
DROP FUNCTION IF EXISTS public.accept_delivery_request(uuid);
DROP FUNCTION IF EXISTS public.broadcast_delivery_request(uuid, integer);
DROP FUNCTION IF EXISTS public.dispatch_delivery_for_order_internal(uuid, integer);
DROP FUNCTION IF EXISTS public.place_order(text, text, text, jsonb, text, boolean, text, double precision, double precision);
DROP FUNCTION IF EXISTS public.place_order(text, text, text, jsonb, text, boolean, text);
DROP FUNCTION IF EXISTS public.place_order_once(uuid, text, text, text, jsonb, text, text, double precision, double precision);
DROP FUNCTION IF EXISTS public.place_order_once(uuid, text, text, text, jsonb, text, text);

-- 1. Update accept_delivery_request to allow 'new' and 'preparing' order statuses
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
     AND o.status::text IN ('delivered', 'cancelled') THEN
    UPDATE public.delivery_assignments
    SET status = 'expired', updated_at = now()
    WHERE order_id = a.order_id AND status IN ('pending', 'requested');
    RETURN NULL;
  END IF;

  -- Idempotent retry for the partner that already won this order.
  IF o.assigned_partner_id = a.partner_id THEN
    SELECT id INTO existing_assignment_id
    FROM public.delivery_assignments
    WHERE order_id = a.order_id
      AND partner_id = a.partner_id
      AND status IN ('accepted', 'navigating_to_vendor', 'reached_vendor',
                     'picked_up', 'out_for_delivery')
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

  UPDATE public.orders
  SET status = 'assigned', assigned_partner_id = a.partner_id
  WHERE id = a.order_id
    AND assigned_partner_id IS NULL
    AND status::text IN ('new', 'accepted', 'preparing', 'packed', 'ready_for_pickup', 'assigned');

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

-- 2. Update broadcast_delivery_request to allow 'new', 'accepted', 'preparing', 'packed', 'ready_for_pickup'
CREATE OR REPLACE FUNCTION public.broadcast_delivery_request(_order_id uuid, _timeout_seconds int default 60)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _v record;
  _count int := 0;
  _p record;
  _dist numeric;
  _vlat double precision;
  _vlng double precision;
  _shop_name text;
  _fee numeric;
BEGIN
  SELECT o.* INTO _v FROM public.orders o WHERE o.id = _order_id;
  IF _v IS NULL OR _v.status::text NOT IN ('new', 'accepted', 'preparing', 'packed', 'ready_for_pickup') OR _v.assigned_partner_id IS NOT NULL THEN
    RETURN 0;
  END IF;

  BEGIN
    SELECT latitude, longitude, shop_name INTO _vlat, _vlng, _shop_name
    FROM public.vendors WHERE id = _v.vendor_id;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  IF _vlat IS NULL AND _v.seller_id IS NOT NULL THEN
    BEGIN
      SELECT current_latitude, current_longitude, COALESCE(store_name, business_name, full_name, 'Shop')
      INTO _vlat, _vlng, _shop_name
      FROM public.sellers WHERE id = _v.seller_id;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  _vlat := COALESCE(_vlat, 12.9716);
  _vlng := COALESCE(_vlng, 77.5946);
  _shop_name := COALESCE(_shop_name, 'LocalShop');
  _fee := COALESCE(_v.shipping_fee, 25.00);

  FOR _p IN
    SELECT p.id,
      (6371 * acos(LEAST(1.0, GREATEST(-1.0,
        cos(radians(_vlat)) * cos(radians(COALESCE(p.current_latitude, _vlat))) *
        cos(radians(COALESCE(p.current_longitude, _vlng)) - radians(_vlng)) +
        sin(radians(_vlat)) * sin(radians(COALESCE(p.current_latitude, _vlat)))
      )))) AS distance_km,
      p.rating,
      (SELECT count(*) FROM public.delivery_assignments a
        WHERE a.partner_id = p.id AND a.status IN ('accepted','navigating_to_vendor','reached_vendor','picked_up','out_for_delivery')) AS active_orders
    FROM public.delivery_partners p
    WHERE p.status = 'approved' AND p.availability = 'online'
    ORDER BY distance_km ASC, active_orders ASC, p.rating DESC
    LIMIT 10
  LOOP
    _dist := round(_p.distance_km::numeric, 2);
    INSERT INTO public.delivery_assignments (order_id, partner_id, distance_km, estimated_earning, expires_at, status)
    VALUES (_order_id, _p.id, _dist, round(_fee + (_dist * 4), 2), now() + make_interval(secs => _timeout_seconds), 'pending')
    ON CONFLICT (order_id, partner_id) DO NOTHING;

    IF FOUND THEN
      INSERT INTO public.delivery_notifications (partner_id, title, body, kind)
      VALUES (_p.id, 'New delivery request', 'Pickup from ' || _shop_name, 'new_delivery');
      UPDATE public.delivery_partners SET total_requests = total_requests + 1 WHERE id = _p.id;
      _count := _count + 1;
    END IF;
  END LOOP;

  RETURN _count;
END;
$$;

-- 3. Update dispatch_delivery_for_order_internal to include 'new' state
CREATE OR REPLACE FUNCTION public.dispatch_delivery_for_order_internal(
  _order_id uuid,
  _timeout_seconds integer DEFAULT 60
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  o record;
  p record;
  best_partner_id uuid;
  assignment_id uuid;
  v_vendor_lat double precision;
  v_vendor_lng double precision;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF o IS NULL THEN RETURN NULL; END IF;

  IF o.assigned_partner_id IS NOT NULL THEN
    SELECT id INTO assignment_id FROM public.delivery_assignments
    WHERE order_id = _order_id AND partner_id = o.assigned_partner_id
    ORDER BY created_at DESC LIMIT 1;
    RETURN assignment_id;
  END IF;

  IF o.status::text NOT IN ('new', 'accepted', 'preparing', 'packed', 'ready_for_pickup', 'assigned', 'rider_assigned') THEN
    RETURN NULL;
  END IF;

  BEGIN
    SELECT latitude, longitude INTO v_vendor_lat, v_vendor_lng FROM public.vendors WHERE id = o.vendor_id;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  IF v_vendor_lat IS NULL AND o.seller_id IS NOT NULL THEN
    BEGIN
      SELECT current_latitude, current_longitude INTO v_vendor_lat, v_vendor_lng FROM public.sellers WHERE id = o.seller_id;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  v_vendor_lat := COALESCE(v_vendor_lat, 12.9716);
  v_vendor_lng := COALESCE(v_vendor_lng, 77.5946);

  SELECT dp.id INTO best_partner_id
  FROM public.delivery_partners dp
  WHERE dp.status = 'approved'
    AND dp.availability = 'online'
  ORDER BY
    (6371 * acos(LEAST(1.0, GREATEST(-1.0,
      cos(radians(v_vendor_lat)) * cos(radians(COALESCE(dp.current_latitude, v_vendor_lat))) *
      cos(radians(COALESCE(dp.current_longitude, v_vendor_lng)) - radians(v_vendor_lng)) +
      sin(radians(v_vendor_lat)) * sin(radians(COALESCE(dp.current_latitude, v_vendor_lat)))
    )))) ASC,
    dp.rating DESC
  LIMIT 1;

  IF best_partner_id IS NULL THEN
    SELECT dp.id INTO best_partner_id
    FROM public.delivery_partners dp
    WHERE dp.status = 'approved' AND dp.availability = 'online'
    LIMIT 1;
  END IF;

  IF best_partner_id IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.delivery_assignments (
    order_id, partner_id, status, distance_km, estimated_earning, expires_at
  ) VALUES (
    _order_id, best_partner_id, 'pending', 2.5, COALESCE(o.shipping_fee, 25.00) + 10.00,
    now() + make_interval(secs => _timeout_seconds)
  )
  ON CONFLICT (order_id, partner_id) DO UPDATE
    SET status = 'pending', expires_at = excluded.expires_at
  RETURNING id INTO assignment_id;

  INSERT INTO public.delivery_notifications (partner_id, title, body, kind)
  VALUES (best_partner_id, 'New Delivery Request', 'You have a new delivery request', 'new_delivery');

  RETURN assignment_id;
END;
$$;

-- 4. Update claim_next_delivery_offer to include 'new', 'accepted', 'preparing', 'packed', 'ready_for_pickup'
CREATE OR REPLACE FUNCTION public.claim_next_delivery_offer()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  p_id uuid;
  o record;
  a record;
BEGIN
  SELECT id INTO p_id
  FROM public.delivery_partners
  WHERE user_id = auth.uid()
    AND status = 'approved'
    AND availability = 'online';

  IF p_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'Partner not active or online');
  END IF;

  SELECT * INTO a FROM public.delivery_assignments
  WHERE partner_id = p_id
    AND status IN ('pending', 'accepted', 'navigating_to_vendor', 'reached_vendor', 'picked_up', 'out_for_delivery')
  ORDER BY created_at DESC LIMIT 1;

  IF a IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'assignment_id', a.id, 'status', a.status);
  END IF;

  SELECT candidate.* INTO o FROM public.orders candidate
  WHERE candidate.status::text IN ('new', 'accepted', 'preparing', 'packed', 'ready_for_pickup')
    AND candidate.assigned_partner_id IS NULL
  ORDER BY candidate.created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF o.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'No orders available');
  END IF;

  INSERT INTO public.delivery_assignments (
    order_id, partner_id, status, distance_km, estimated_earning, expires_at
  ) VALUES (
    o.id, p_id, 'pending', 2.0, COALESCE(o.shipping_fee, 25.00) + 10.00,
    now() + interval '5 minutes'
  )
  ON CONFLICT (order_id, partner_id) DO UPDATE
    SET status = 'pending', expires_at = excluded.expires_at
  RETURNING * INTO a;

  RETURN jsonb_build_object('success', true, 'assignment_id', a.id, 'order_id', o.id, 'status', 'pending');
END;
$$;

-- 5. Create place_order RPC with immediate dispatch logic
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
  dispatched_count int;
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

  -- Trigger immediate dispatch to online delivery partners
  BEGIN
    dispatched_count := public.broadcast_delivery_request(created_order.id, 60);
    IF COALESCE(dispatched_count, 0) = 0 THEN
      PERFORM public.dispatch_delivery_for_order_internal(created_order.id, 60);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN created_order;
END;
$$;

-- 6. Create place_order_once wrapper
CREATE OR REPLACE FUNCTION public.place_order_once(
  p_request_id uuid,
  p_buyer_name text,
  p_buyer_phone text,
  p_buyer_address text,
  p_items jsonb,
  p_payment_method text,
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
  uid uuid := auth.uid();
  existing_order public.orders;
  created public.orders;
  existing_order_id uuid;
BEGIN
  IF uid IS NULL OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'Authentication and request id required';
  END IF;

  INSERT INTO public.checkout_requests(user_id, request_id) VALUES (uid, p_request_id)
  ON CONFLICT (user_id, request_id) DO NOTHING;

  SELECT r.order_id INTO existing_order_id
    FROM public.checkout_requests r
   WHERE r.user_id = uid AND r.request_id = p_request_id
     FOR UPDATE;

  SELECT o.* INTO existing_order FROM public.orders o
   WHERE o.id = existing_order_id;

  IF existing_order.id IS NOT NULL THEN
    RETURN existing_order;
  END IF;

  created := public.place_order(
    p_buyer_name, p_buyer_phone, p_buyer_address, p_items, p_payment_method,
    false, p_coupon_code, p_customer_latitude, p_customer_longitude
  );

  UPDATE public.checkout_requests
     SET order_id = created.id
   WHERE user_id = uid AND request_id = p_request_id;

  RETURN created;
END;
$$;

-- Permissions Grants
GRANT EXECUTE ON FUNCTION public.accept_delivery_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.broadcast_delivery_request(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_delivery_for_order_internal(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_delivery_offer() TO authenticated;
GRANT EXECUTE ON FUNCTION public.place_order(text, text, text, jsonb, text, boolean, text, double precision, double precision) TO authenticated;
GRANT EXECUTE ON FUNCTION public.place_order_once(uuid, text, text, text, jsonb, text, text, double precision, double precision) TO authenticated;

-- 7. Update delivery_partner_can_read_unassigned_order RLS helper to allow reading early stage unassigned orders
CREATE OR REPLACE FUNCTION public.delivery_partner_can_read_unassigned_order(_order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.orders o
    JOIN public.delivery_partners p ON p.user_id = auth.uid()
    WHERE o.id = _order_id
      AND o.status::text IN ('new', 'accepted', 'preparing', 'packed', 'ready_for_pickup')
      AND o.assigned_partner_id IS NULL
      AND p.status::text = 'approved'
      AND p.availability::text = 'online'
  );
$$;

REVOKE ALL ON FUNCTION public.delivery_partner_can_read_unassigned_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delivery_partner_can_read_unassigned_order(uuid) TO authenticated;

-- Ensure FK constraint exists between orders.assigned_partner_id and delivery_partners.id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'orders_assigned_partner_id_fkey'
      AND table_name = 'orders'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_assigned_partner_id_fkey
      FOREIGN KEY (assigned_partner_id)
      REFERENCES public.delivery_partners(id)
      ON DELETE SET NULL;
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

NOTIFY pgrst, 'reload schema';


