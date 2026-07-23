-- Keep vendor approval fields controlled by administrators.
CREATE OR REPLACE FUNCTION public.prevent_vendor_approval_field_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') AND (
    NEW.status IS DISTINCT FROM OLD.status OR
    NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by OR
    NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at OR
    NEW.admin_notes IS DISTINCT FROM OLD.admin_notes
  ) THEN
    RAISE EXCEPTION 'Only administrators can change vendor approval fields';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_vendor_approval_fields ON public.sellers;
CREATE TRIGGER trg_protect_vendor_approval_fields
BEFORE UPDATE ON public.sellers
FOR EACH ROW
EXECUTE FUNCTION public.prevent_vendor_approval_field_changes();

-- Compatibility views must not expose seller document metadata to every user.
REVOKE ALL ON public.vendor_documents FROM anon, authenticated;
GRANT SELECT ON public.vendor_documents TO service_role;

-- Product images and seller documents remain private. Access is controlled by
-- storage RLS, including a public read rule only for approved catalog images.
UPDATE storage.buckets
SET public = false
WHERE id IN ('product-images', 'seller-docs');

DROP POLICY IF EXISTS "Public reads product images" ON storage.objects;
DROP POLICY IF EXISTS "Public reads approved product images" ON storage.objects;
CREATE POLICY "Public reads approved product images"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (
  bucket_id = 'product-images'
  AND EXISTS (
    SELECT 1
    FROM public.products p
    JOIN public.sellers s ON s.id = p.seller_id
    WHERE p.image_url = name
      AND p.status::text IN ('active', 'approved')
      AND s.status::text = 'approved'
  )
);

DROP POLICY IF EXISTS "Sellers read own product images" ON storage.objects;
CREATE POLICY "Sellers read own product images"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'product-images'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

DROP POLICY IF EXISTS "Admins read all product images" ON storage.objects;
CREATE POLICY "Admins read all product images"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'product-images' AND public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Sellers read own docs" ON storage.objects;
CREATE POLICY "Sellers read own docs"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'seller-docs' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Admins read all seller docs" ON storage.objects;
CREATE POLICY "Admins read all seller docs"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'seller-docs' AND public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Sellers update own docs" ON storage.objects;
CREATE POLICY "Sellers update own docs"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'seller-docs' AND auth.uid()::text = (storage.foldername(name))[1])
WITH CHECK (bucket_id = 'seller-docs' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Sellers delete own docs" ON storage.objects;
CREATE POLICY "Sellers delete own docs"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'seller-docs' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Order totals and item prices are calculated from approved database rows.
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
  uid uuid := auth.uid();
  item jsonb;
  product_row record;
  created_order public.orders;
  seller_id uuid;
  product_id uuid;
  quantity integer;
  subtotal numeric(10,2) := 0;
  shipping_fee numeric(10,2) := 0;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Order must contain at least one item';
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    product_id := (item->>'product_id')::uuid;
    quantity := (item->>'qty')::integer;
    IF quantity IS NULL OR quantity < 1 THEN
      RAISE EXCEPTION 'Invalid item quantity';
    END IF;

    SELECT p.id, p.seller_id, p.name, p.sku, p.selling_price, p.stock
    INTO product_row
    FROM public.products p
    JOIN public.sellers s ON s.id = p.seller_id
    WHERE p.id = product_id
      AND p.status::text IN ('active', 'approved')
      AND s.status::text = 'approved'
    FOR UPDATE OF p;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product is not available';
    END IF;
    IF product_row.stock < quantity THEN
      RAISE EXCEPTION 'Insufficient stock for product %', product_row.name;
    END IF;
    IF seller_id IS NULL THEN
      seller_id := product_row.seller_id;
    ELSIF seller_id <> product_row.seller_id THEN
      RAISE EXCEPTION 'Cart items must come from one approved shop';
    END IF;

    subtotal := subtotal + (product_row.selling_price * quantity);
  END LOOP;

  IF subtotal > 0 THEN
    shipping_fee := 25;
  END IF;

  INSERT INTO public.orders (
    seller_id, user_id, buyer_name, buyer_phone, buyer_address,
    status, subtotal, shipping_fee, total
  )
  VALUES (
    seller_id, uid, p_buyer_name, p_buyer_phone, p_buyer_address,
    'new', subtotal, shipping_fee, subtotal + shipping_fee
  )
  RETURNING * INTO created_order;

  FOR item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    product_id := (item->>'product_id')::uuid;
    quantity := (item->>'qty')::integer;

    SELECT p.id, p.name, p.sku, p.selling_price
    INTO product_row
    FROM public.products p
    WHERE p.id = product_id
    FOR UPDATE;

    INSERT INTO public.order_items (
      order_id, product_id, user_id, product_name, sku,
      qty, unit_price, line_total
    )
    VALUES (
      created_order.id, product_row.id, uid, product_row.name, product_row.sku,
      quantity, product_row.selling_price, product_row.selling_price * quantity
    );

    UPDATE public.products
    SET stock = stock - quantity
    WHERE id = product_id;
  END LOOP;

  RETURN created_order;
END;
$$;

REVOKE ALL ON FUNCTION public.place_order(text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_order(text, text, text, jsonb) TO authenticated;
