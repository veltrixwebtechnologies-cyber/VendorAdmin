-- One authoritative checkout contract for the current simulated-payment flow.
-- Prices, seller ownership and stock are always read from the database.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'cod'
  CHECK (payment_method IN ('upi', 'card', 'cod'));

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

-- Remove stale overloads so PostgREST resolves one unambiguous function.
DROP FUNCTION IF EXISTS public.place_order(text, text, text, jsonb, text, boolean);
DROP FUNCTION IF EXISTS public.place_order(text, text, text, jsonb, text);
DROP FUNCTION IF EXISTS public.place_order(text, text, text, jsonb);

CREATE FUNCTION public.place_order(
  p_buyer_name text,
  p_buyer_phone text,
  p_buyer_address text,
  p_items jsonb,
  p_payment_method text,
  p_is_demo boolean
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
  calculated_shipping numeric(10,2) := 0;
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

  -- Validate and aggregate duplicate product entries before checking stock.
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
      RAISE EXCEPTION USING
        MESSAGE = format('Insufficient stock for product %s', product_row.name),
        ERRCODE = 'P0001';
    END IF;

    IF order_seller_id IS NULL THEN
      order_seller_id := product_row.seller_id;
    ELSIF order_seller_id <> product_row.seller_id THEN
      RAISE EXCEPTION USING
        MESSAGE = 'Cart items must come from one approved shop',
        ERRCODE = '22023';
    END IF;

    calculated_subtotal :=
      calculated_subtotal + (product_row.selling_price * requested_quantity);
  END LOOP;

  IF calculated_subtotal > 0 THEN
    calculated_shipping := 25;
  END IF;

  INSERT INTO public.orders (
    seller_id,
    user_id,
    buyer_name,
    buyer_phone,
    buyer_address,
    payment_method,
    is_demo,
    status,
    subtotal,
    shipping_fee,
    total
  )
  VALUES (
    order_seller_id,
    current_user_id,
    COALESCE(NULLIF(trim(p_buyer_name), ''), 'Customer'),
    NULLIF(trim(p_buyer_phone), ''),
    trim(p_buyer_address),
    p_payment_method,
    COALESCE(p_is_demo, false),
    'new',
    calculated_subtotal,
    calculated_shipping,
    calculated_subtotal + calculated_shipping
  )
  RETURNING * INTO created_order;

  FOR item IN SELECT jsonb_build_object('product_id', key, 'qty', value)
              FROM jsonb_each_text(requested_items)
  LOOP
    requested_product_id := (item->>'product_id')::uuid;
    requested_quantity := (item->>'qty')::integer;

    SELECT p.id, p.name, p.sku, p.selling_price
      INTO product_row
    FROM public.products p
    WHERE p.id = requested_product_id
    FOR UPDATE;

    INSERT INTO public.order_items (
      order_id,
      product_id,
      user_id,
      product_name,
      sku,
      qty,
      unit_price,
      line_total
    )
    VALUES (
      created_order.id,
      product_row.id,
      current_user_id,
      product_row.name,
      product_row.sku,
      requested_quantity,
      product_row.selling_price,
      product_row.selling_price * requested_quantity
    );

    UPDATE public.products
    SET stock = stock - requested_quantity
    WHERE id = requested_product_id;
  END LOOP;

  RETURN created_order;
END;
$$;

REVOKE ALL ON FUNCTION public.place_order(text, text, text, jsonb, text, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_order(text, text, text, jsonb, text, boolean)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.advance_demo_order(p_order_id uuid)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  current_order public.orders;
  next_status public.order_status;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Authentication required', ERRCODE = '28000';
  END IF;

  SELECT *
    INTO current_order
  FROM public.orders
  WHERE id = p_order_id
    AND user_id = current_user_id
    AND is_demo = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'Demo order not found', ERRCODE = 'P0002';
  END IF;

  next_status := CASE current_order.status::text
    WHEN 'new' THEN 'accepted'::public.order_status
    WHEN 'accepted' THEN 'packed'::public.order_status
    WHEN 'packed' THEN 'ready_for_pickup'::public.order_status
    WHEN 'ready_for_pickup' THEN 'out_for_delivery'::public.order_status
    WHEN 'out_for_delivery' THEN 'delivered'::public.order_status
    WHEN 'shipped' THEN 'delivered'::public.order_status
    ELSE NULL
  END;

  IF next_status IS NULL THEN
    RETURN current_order;
  END IF;

  UPDATE public.orders
  SET
    status = next_status,
    delivered_at = CASE
      WHEN next_status::text = 'delivered' THEN now()
      ELSE delivered_at
    END
  WHERE id = p_order_id
  RETURNING * INTO current_order;

  RETURN current_order;
END;
$$;

REVOKE ALL ON FUNCTION public.advance_demo_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.advance_demo_order(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
