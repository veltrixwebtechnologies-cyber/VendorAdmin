
ALTER TABLE public.sellers ADD COLUMN IF NOT EXISTS wizard_data JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Function to seed a demo order for the calling seller (uses one of their products).
CREATE OR REPLACE FUNCTION public.seed_demo_order()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  uid uuid := auth.uid();
  sid uuid;
  pid uuid;
  pname text;
  psku text;
  pprice numeric;
  new_order_id uuid;
  buyers text[] := ARRAY['Rhea Kapoor','Vikram Rao','Neha Iyer','Amit Sen','Arjun Mehta','Isha Verma','Karan Bhatia','Sana Ali'];
  cities text[] := ARRAY['Mumbai','Bengaluru','Chennai','Kolkata','Pune','Hyderabad','Delhi','Ahmedabad'];
  states text[] := ARRAY['Maharashtra','Karnataka','Tamil Nadu','West Bengal','Maharashtra','Telangana','Delhi','Gujarat'];
  pincodes text[] := ARRAY['400001','560001','600002','700016','411001','500001','110001','380001'];
  idx int;
  pay text;
  ship numeric;
  qty int;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT id INTO sid FROM public.sellers WHERE user_id=uid;
  IF sid IS NULL THEN RAISE EXCEPTION 'no seller record'; END IF;
  SELECT id, name, COALESCE(sku,''), selling_price INTO pid, pname, psku, pprice
    FROM public.products WHERE user_id=uid ORDER BY random() LIMIT 1;
  IF pid IS NULL THEN RAISE EXCEPTION 'no products to sell'; END IF;
  idx := 1 + floor(random()*8)::int;
  pay := CASE WHEN random() < 0.5 THEN 'Prepaid' ELSE 'COD' END;
  ship := CASE WHEN pay='COD' THEN 40 ELSE 0 END;
  qty := 1 + floor(random()*3)::int;

  INSERT INTO public.orders(seller_id, user_id, buyer_name, buyer_phone, buyer_address,
      subtotal, shipping_fee, total, status)
    VALUES (sid, uid, buyers[idx], '9' || (100000000 + floor(random()*899999999))::bigint,
      idx || ' Main Street, ' || cities[idx] || ', ' || states[idx] || ' - ' || pincodes[idx],
      pprice*qty, ship, pprice*qty + ship, 'new')
    RETURNING id INTO new_order_id;

  INSERT INTO public.order_items(order_id, product_id, user_id, product_name, sku, qty, unit_price, line_total)
    VALUES (new_order_id, pid, uid, pname, psku, qty, pprice, pprice*qty);

  INSERT INTO public.notifications(user_id, title, body, kind, link)
    VALUES (uid, 'New order received',
      'Order for ' || pname || ' from ' || buyers[idx] || ' (' || pay || ' ₹' || (pprice*qty+ship)::int || ')',
      'order', '/seller/orders');

  RETURN new_order_id;
END $$;
GRANT EXECUTE ON FUNCTION public.seed_demo_order() TO authenticated;
