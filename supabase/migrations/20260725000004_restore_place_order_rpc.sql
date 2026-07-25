-- Standalone checkout RPC. This migration intentionally has no dependency on
-- storage policies or admin role helpers, so it can be applied independently.
CREATE OR REPLACE FUNCTION public.place_order(
  p_buyer_name text,
  p_buyer_phone text,
  p_buyer_address text,
  p_items jsonb
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  item jsonb;
  product_row record;
  created_order public.orders;
  order_seller_id uuid;
  requested_product_id uuid;
  requested_quantity integer;
  calculated_subtotal numeric(10,2) := 0;
  calculated_shipping numeric(10,2) := 0;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_buyer_address IS NULL OR length(trim(p_buyer_address)) = 0 THEN
    RAISE EXCEPTION 'Delivery address is required';
  END IF;

  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Order must contain at least one item';
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    requested_product_id := (item->>'product_id')::uuid;
    requested_quantity := (item->>'qty')::integer;

    IF requested_quantity IS NULL OR requested_quantity < 1 THEN
      RAISE EXCEPTION 'Invalid item quantity';
    END IF;

    SELECT p.id, p.seller_id, p.name, p.sku, p.selling_price, p.stock
    INTO product_row
    FROM public.products p
    JOIN public.sellers s ON s.id = p.seller_id
    WHERE p.id = requested_product_id
      AND p.status::text IN ('active', 'approved')
      AND s.status::text = 'approved'
    FOR UPDATE OF p;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product is not available';
    END IF;

    IF product_row.stock < requested_quantity THEN
      RAISE EXCEPTION 'Insufficient stock for product %', product_row.name;
    END IF;

    IF order_seller_id IS NULL THEN
      order_seller_id := product_row.seller_id;
    ELSIF order_seller_id <> product_row.seller_id THEN
      RAISE EXCEPTION 'Cart items must come from one approved shop';
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
    status,
    subtotal,
    shipping_fee,
    total
  )
  VALUES (
    order_seller_id,
    current_user_id,
    p_buyer_name,
    p_buyer_phone,
    p_buyer_address,
    'new',
    calculated_subtotal,
    calculated_shipping,
    calculated_subtotal + calculated_shipping
  )
  RETURNING * INTO created_order;

  FOR item IN SELECT value FROM jsonb_array_elements(p_items)
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

REVOKE ALL ON FUNCTION public.place_order(text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_order(text, text, text, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
