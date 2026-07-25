-- Keep customer, seller, and admin order screens synchronized.
ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'cod'
CHECK (payment_method IN ('upi', 'card', 'cod'));

ALTER TABLE public.orders REPLICA IDENTITY FULL;
ALTER TABLE public.order_items REPLICA IDENTITY FULL;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.order_items;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE OR REPLACE FUNCTION public.place_order(
  p_buyer_name text,
  p_buyer_phone text,
  p_buyer_address text,
  p_items jsonb,
  p_payment_method text
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

  IF p_payment_method NOT IN ('upi', 'card', 'cod') THEN
    RAISE EXCEPTION 'Invalid payment method';
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

    calculated_subtotal := calculated_subtotal + (product_row.selling_price * requested_quantity);
  END LOOP;

  IF calculated_subtotal > 0 THEN
    calculated_shipping := 25;
  END IF;

  INSERT INTO public.orders (
    seller_id, user_id, buyer_name, buyer_phone, buyer_address, payment_method,
    status, subtotal, shipping_fee, total
  )
  VALUES (
    order_seller_id, current_user_id, p_buyer_name, p_buyer_phone, p_buyer_address,
    p_payment_method, 'new', calculated_subtotal, calculated_shipping,
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
      order_id, product_id, user_id, product_name, sku, qty, unit_price, line_total
    )
    VALUES (
      created_order.id, product_row.id, current_user_id, product_row.name,
      product_row.sku, requested_quantity, product_row.selling_price,
      product_row.selling_price * requested_quantity
    );

    UPDATE public.products
    SET stock = stock - requested_quantity
    WHERE id = requested_product_id;
  END LOOP;

  RETURN created_order;
END;
$$;

REVOKE ALL ON FUNCTION public.place_order(text, text, text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_order(text, text, text, jsonb, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.notify_customer_order_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.notifications (user_id, title, body, kind, link)
    VALUES (
      NEW.user_id,
      'Order ' || NEW.order_number || ' updated',
      CASE NEW.status::text
        WHEN 'accepted' THEN 'Your order has been accepted.'
        WHEN 'packed' THEN 'Your order has been packed.'
        WHEN 'ready_for_pickup' THEN 'Your order is ready for pickup.'
        WHEN 'out_for_delivery' THEN 'Your order is out for delivery.'
        WHEN 'shipped' THEN 'Your order is out for delivery.'
        WHEN 'delivered' THEN 'Your order has been delivered.'
        WHEN 'cancelled' THEN 'Your order has been cancelled.'
        WHEN 'returned' THEN 'Your order has been returned.'
        ELSE 'Your order status is now ' || replace(NEW.status::text, '_', ' ') || '.'
      END,
      'order',
      '/order/' || NEW.id::text
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_customer_order_status ON public.orders;
CREATE TRIGGER trg_notify_customer_order_status
AFTER UPDATE OF status ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.notify_customer_order_status();

NOTIFY pgrst, 'reload schema';
