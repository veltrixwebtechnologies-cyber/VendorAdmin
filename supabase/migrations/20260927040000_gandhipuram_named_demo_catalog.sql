-- Five demo storefronts using coordinates supplied by the marketplace owner.
-- Product selections, prices and quantities are sample inventory, not claims
-- about the real businesses. Deterministic IDs make reruns duplicate-safe.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  shop record;
  item record;
  owner_id uuid;
  shop_id uuid;
  demo_email text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.operational_zones WHERE zone_code = 'CBE-01' AND is_active) THEN
    RAISE EXCEPTION 'Active Gandhipuram zone CBE-01 is required';
  END IF;

  FOR shop IN SELECT * FROM (VALUES
    ('selvasingh', 'Selvasingh Stores', 'grocery', 11.0172700, 76.9655810),
    ('kk', 'K K Store', 'grocery', 11.0171308, 76.9625115),
    ('abi', 'Abi Store', 'grocery', 11.0222124, 76.9693347),
    ('classic', 'Classic Footwear', 'footwear', 11.0170250, 76.9630730),
    ('gayathries', 'Om Gayathries (Craft & Fancy Store)', 'gifts', 11.0169546, 76.9650423)
  ) AS shops(shop_key, shop_name, category, lat, lng)
  LOOP
    owner_id := md5('gandhipuram-named-demo-owner-' || shop.shop_key)::uuid;
    shop_id := md5('gandhipuram-named-demo-shop-' || shop.shop_key)::uuid;
    demo_email := 'cbe-01.named.' || shop.shop_key || '@localshore.test';

    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', owner_id, 'authenticated', 'authenticated',
      demo_email, crypt(encode(gen_random_bytes(32), 'hex'), gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('display_name', shop.shop_name || ' (Demo)', 'demo_account', true), now(), now()
    ) ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.sellers (
      id, user_id, email, business_name, full_name, business_type, status,
      address_line1, city, state, country, lat, lng, accepts_orders, admin_notes
    ) VALUES (
      shop_id, owner_id, demo_email, shop.shop_name || ' (Demo)', shop.shop_name || ' (Demo)',
      shop.category, 'approved', 'Gandhipuram — supplied demo location',
      'Coimbatore', 'Tamil Nadu', 'India', shop.lat, shop.lng, true,
      'Demo catalog at owner-supplied coordinates for CBE-01; prices and inventory are illustrative.'
    ) ON CONFLICT (id) DO NOTHING;

    FOR item IN SELECT * FROM (VALUES
      ('grocery', 'rice', 'Rice — 1 kg', 75, 68),
      ('grocery', 'flour', 'Wheat Flour — 1 kg', 65, 58),
      ('grocery', 'dal', 'Toor Dal — 500 g', 95, 85),
      ('grocery', 'sugar', 'Sugar — 1 kg', 55, 48),
      ('grocery', 'salt', 'Iodised Salt — 1 kg', 30, 25),
      ('grocery', 'oil', 'Sunflower Oil — 1 litre', 175, 155),
      ('footwear', 'sandals', 'Everyday Sandals', 699, 549),
      ('footwear', 'slippers', 'Everyday Slippers', 299, 249),
      ('footwear', 'sneakers', 'Casual Sneakers', 1299, 999),
      ('footwear', 'formal', 'Formal Shoes', 1699, 1399),
      ('footwear', 'kids', 'Kids Shoes', 799, 649),
      ('footwear', 'socks', 'Cotton Socks — 3 pairs', 249, 199),
      ('gifts', 'cards', 'Greeting Card Set', 149, 99),
      ('gifts', 'frame', 'Photo Frame', 399, 299),
      ('gifts', 'wrap', 'Gift Wrapping Paper Set', 129, 99),
      ('gifts', 'ribbon', 'Decorative Ribbon Set', 179, 139),
      ('gifts', 'craft', 'Paper Craft Kit', 349, 279),
      ('gifts', 'keyring', 'Decorative Keyring', 149, 119)
    ) AS catalog(category, item_key, item_name, mrp, price)
    WHERE catalog.category = shop.category
    LOOP
      INSERT INTO public.products (
        id, seller_id, user_id, name, sku, category, description,
        mrp, selling_price, stock, status, image_url, admin_notes
      ) VALUES (
        md5('gandhipuram-named-demo-item-' || shop.shop_key || '-' || item.item_key)::uuid,
        shop_id, owner_id, item.item_name,
        'CBE01-NAMED-' || upper(shop.shop_key) || '-' || upper(item.item_key),
        shop.category, 'Sample inventory for ' || shop.shop_name || ' (Demo). Price and availability are illustrative.',
        item.mrp, item.price, 20, 'active', NULL,
        'Demo product; no verified product photograph supplied.'
      ) ON CONFLICT (id) DO NOTHING;
    END LOOP;
  END LOOP;
END $$;

-- Return the five storefronts and their available sample catalog counts.
SELECT s.business_name, s.business_type, s.lat, s.lng,
  count(p.id) FILTER (WHERE p.status::text = 'active' AND p.stock > 0) AS available_products
FROM public.sellers s
LEFT JOIN public.products p ON p.seller_id = s.id
WHERE s.email IN (
  'cbe-01.named.selvasingh@localshore.test', 'cbe-01.named.kk@localshore.test',
  'cbe-01.named.abi@localshore.test', 'cbe-01.named.classic@localshore.test',
  'cbe-01.named.gayathries@localshore.test'
)
GROUP BY s.id, s.business_name, s.business_type, s.lat, s.lng
ORDER BY s.business_name;
COMMIT;
