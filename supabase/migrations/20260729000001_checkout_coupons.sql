-- Connect admin-managed coupons to checkout without trusting client prices.

ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS vendor_id uuid REFERENCES public.sellers(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.categories(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS first_order_only boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS per_user_limit integer;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS coupon_id uuid REFERENCES public.coupons(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS coupon_code text,
  ADD COLUMN IF NOT EXISTS discount_amount numeric(10,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.coupon_usages (
  coupon_id uuid NOT NULL REFERENCES public.coupons(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  used_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (coupon_id, user_id)
);

ALTER TABLE public.coupon_usages
  ADD COLUMN IF NOT EXISTS use_count integer NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION public.quote_coupon(
  p_code text,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  coupon_row public.coupons;
  item jsonb;
  product_row record;
  requested_product_id uuid;
  requested_quantity integer;
  order_seller_id uuid;
  category_name text;
  calculated_subtotal numeric(10,2) := 0;
  eligible_subtotal numeric(10,2) := 0;
  calculated_shipping numeric(10,2) := 25;
  calculated_discount numeric(10,2) := 0;
  previous_uses integer := 0;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Authentication required', ERRCODE = '28000';
  END IF;

  IF p_code IS NULL OR length(trim(p_code)) = 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'Enter a coupon code', ERRCODE = '22023';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'Your cart is empty', ERRCODE = '22023';
  END IF;

  SELECT *
    INTO coupon_row
  FROM public.coupons
  WHERE upper(code) = upper(trim(p_code));

  IF NOT FOUND OR NOT coupon_row.is_active THEN
    RAISE EXCEPTION USING MESSAGE = 'This coupon is invalid or inactive', ERRCODE = 'P0001';
  END IF;
  IF coupon_row.starts_at IS NOT NULL AND coupon_row.starts_at > now() THEN
    RAISE EXCEPTION USING MESSAGE = 'This coupon is not active yet', ERRCODE = 'P0001';
  END IF;
  IF coupon_row.expires_at IS NOT NULL AND coupon_row.expires_at <= now() THEN
    RAISE EXCEPTION USING MESSAGE = 'This coupon has expired', ERRCODE = 'P0001';
  END IF;
  IF coupon_row.usage_limit IS NOT NULL AND coupon_row.used_count >= coupon_row.usage_limit THEN
    RAISE EXCEPTION USING MESSAGE = 'This coupon usage limit has been reached', ERRCODE = 'P0001';
  END IF;

  IF coupon_row.category_id IS NOT NULL THEN
    SELECT name INTO category_name FROM public.categories WHERE id = coupon_row.category_id;
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    IF jsonb_typeof(item) <> 'object'
       OR COALESCE(item->>'product_id', '') !~
          '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
       OR COALESCE(item->>'qty', '') !~ '^[1-9][0-9]*$' THEN
      RAISE EXCEPTION USING MESSAGE = 'Invalid cart item', ERRCODE = '22023';
    END IF;

    requested_product_id := (item->>'product_id')::uuid;
    requested_quantity := (item->>'qty')::integer;

    SELECT p.seller_id, p.selling_price, p.stock, p.category
      INTO product_row
    FROM public.products p
    JOIN public.sellers s ON s.id = p.seller_id
    WHERE p.id = requested_product_id
      AND p.status::text IN ('active', 'approved')
      AND s.status::text = 'approved';

    IF NOT FOUND OR COALESCE(product_row.stock, 0) < requested_quantity THEN
      RAISE EXCEPTION USING MESSAGE = 'One or more products are unavailable', ERRCODE = 'P0001';
    END IF;

    IF order_seller_id IS NULL THEN
      order_seller_id := product_row.seller_id;
    ELSIF order_seller_id <> product_row.seller_id THEN
      RAISE EXCEPTION USING MESSAGE = 'Cart items must come from one approved shop', ERRCODE = '22023';
    END IF;

    calculated_subtotal := calculated_subtotal + product_row.selling_price * requested_quantity;
    IF coupon_row.category_id IS NULL
       OR lower(COALESCE(product_row.category, '')) = lower(COALESCE(category_name, '')) THEN
      eligible_subtotal := eligible_subtotal + product_row.selling_price * requested_quantity;
    END IF;
  END LOOP;

  IF coupon_row.vendor_id IS NOT NULL AND coupon_row.vendor_id <> order_seller_id THEN
    RAISE EXCEPTION USING MESSAGE = 'This coupon is not valid for this shop', ERRCODE = 'P0001';
  END IF;
  IF coupon_row.category_id IS NOT NULL AND eligible_subtotal = 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'This coupon is not valid for the products in your cart', ERRCODE = 'P0001';
  END IF;
  IF calculated_subtotal < coupon_row.min_order THEN
    RAISE EXCEPTION USING
      MESSAGE = format('Add ₹%s more to use this coupon', ceil(coupon_row.min_order - calculated_subtotal)),
      ERRCODE = 'P0001';
  END IF;
  IF coupon_row.first_order_only
     AND EXISTS (SELECT 1 FROM public.orders WHERE user_id = current_user_id) THEN
    RAISE EXCEPTION USING MESSAGE = 'This coupon is only valid on your first order', ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE((
    SELECT use_count
    FROM public.coupon_usages
    WHERE coupon_id = coupon_row.id AND user_id = current_user_id
  ), 0)
  INTO previous_uses;

  IF coupon_row.per_user_limit IS NOT NULL AND previous_uses >= coupon_row.per_user_limit THEN
    RAISE EXCEPTION USING MESSAGE = 'You have already used this coupon', ERRCODE = 'P0001';
  END IF;

  IF coupon_row.discount_type = 'percent' THEN
    calculated_discount := round(eligible_subtotal * coupon_row.discount_value / 100, 2);
    IF coupon_row.max_discount IS NOT NULL THEN
      calculated_discount := least(calculated_discount, coupon_row.max_discount);
    END IF;
  ELSIF coupon_row.discount_type = 'flat' THEN
    calculated_discount := least(eligible_subtotal, coupon_row.discount_value);
  ELSIF coupon_row.discount_type = 'free_shipping' THEN
    calculated_discount := calculated_shipping;
    calculated_shipping := 0;
  END IF;

  RETURN jsonb_build_object(
    'coupon_id', coupon_row.id,
    'code', upper(coupon_row.code),
    'discount_type', coupon_row.discount_type,
    'discount_amount', calculated_discount,
    'subtotal', calculated_subtotal,
    'shipping_fee', calculated_shipping,
    'total', greatest(0, calculated_subtotal - CASE WHEN coupon_row.discount_type = 'free_shipping' THEN 0 ELSE calculated_discount END + calculated_shipping)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.quote_coupon(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.quote_coupon(text, jsonb) TO authenticated;

DROP FUNCTION IF EXISTS public.place_order(text, text, text, jsonb, text, boolean, text);
DROP FUNCTION IF EXISTS public.place_order(text, text, text, jsonb, text, boolean);

CREATE FUNCTION public.place_order(
  p_buyer_name text,
  p_buyer_phone text,
  p_buyer_address text,
  p_items jsonb,
  p_payment_method text,
  p_is_demo boolean,
  p_coupon_code text DEFAULT NULL
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
    payment_method, is_demo, status, subtotal, shipping_fee, total,
    coupon_id, coupon_code, discount_amount
  )
  VALUES (
    order_seller_id, current_user_id,
    COALESCE(NULLIF(trim(p_buyer_name), ''), 'Customer'),
    NULLIF(trim(p_buyer_phone), ''), trim(p_buyer_address),
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

  RETURN created_order;
END;
$$;

REVOKE ALL ON FUNCTION public.place_order(text, text, text, jsonb, text, boolean, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_order(text, text, text, jsonb, text, boolean, text)
  TO authenticated;
