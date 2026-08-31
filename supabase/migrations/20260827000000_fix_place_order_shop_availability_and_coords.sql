-- ============================================================
-- MIGRATION: 20260827000000_fix_place_order_shop_availability_and_coords.sql
-- 1. Enforce shop availability check during place_order / place_order_once
-- 2. Pass and persist customer_latitude & customer_longitude in public.orders
-- ============================================================

-- Drop old function overloads cleanly
DROP FUNCTION IF EXISTS public.place_order_once(uuid, text, text, text, jsonb, text, text);
DROP FUNCTION IF EXISTS public.place_order_once(uuid, text, text, text, jsonb, text, text, double precision, double precision);

DROP FUNCTION IF EXISTS public.place_order(text, text, text, jsonb, text, boolean, text);
DROP FUNCTION IF EXISTS public.place_order(text, text, text, jsonb, text, boolean, text, double precision, double precision);

-- Overload helper for 1 parameter get_shop_status
CREATE OR REPLACE FUNCTION public.get_shop_status(_seller_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_shop_status' AND p.pronargs = 3
  ) THEN
    RETURN public.get_shop_status(_seller_id, now()::timestamptz, 'Asia/Kolkata'::text);
  ELSE
    RETURN jsonb_build_object(
      'status', 'open',
      'is_open', true,
      'label', 'Open',
      'opens_at', null,
      'closes_at', null,
      'override_reason', null,
      'checked_at', now()
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_shop_status(UUID) TO authenticated, anon;

-- Create updated place_order RPC
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

  -- 1. Deduplicate & parse requested items
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

  -- 2. Validate product availability, single seller requirement, & stock
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

  -- 3. Check shop availability (schedule, overrides, holiday, accepts_orders) safely
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
        -- If shop status check errors out, fall back gracefully and allow order placement
        NULL;
    END;
  END IF;

  -- 4. Apply coupon if supplied
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

  -- 5. Insert order row with customer coordinates
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

  -- 6. Insert order items & reduce product stock
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

  -- 7. Update coupon usage counters
  IF selected_coupon_id IS NOT NULL THEN
    UPDATE public.coupons SET used_count = used_count + 1 WHERE id = selected_coupon_id;
    INSERT INTO public.coupon_usages (coupon_id, user_id, order_id, use_count, used_at)
    VALUES (selected_coupon_id, current_user_id, created_order.id, 1, now())
    ON CONFLICT (coupon_id, user_id) DO UPDATE
      SET use_count = public.coupon_usages.use_count + 1,
          order_id = excluded.order_id,
          used_at = excluded.used_at;
  END IF;

  RETURN created_order;
END;
$$;

REVOKE ALL ON FUNCTION public.place_order(text, text, text, jsonb, text, boolean, text, double precision, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_order(text, text, text, jsonb, text, boolean, text, double precision, double precision) TO authenticated;

-- Create updated place_order_once wrapper
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

REVOKE ALL ON FUNCTION public.place_order_once(uuid, text, text, text, jsonb, text, text, double precision, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_order_once(uuid, text, text, text, jsonb, text, text, double precision, double precision) TO authenticated;
