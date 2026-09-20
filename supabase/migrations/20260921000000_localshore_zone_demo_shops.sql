-- Development/demo coverage seed: 8 shops per operational zone (104 total).
-- These are ordinary approved sellers with real coordinates and active products,
-- so they exercise the same customer visibility RPC as real vendor accounts.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- The existing product trigger predates the required notifications.audience
-- column. Keep admin notifications working while this seed inserts products.
CREATE OR REPLACE FUNCTION public.notify_admins_new_product()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE seller_name text;
BEGIN
  SELECT COALESCE(business_name, full_name, email) INTO seller_name
  FROM public.sellers WHERE user_id = NEW.user_id LIMIT 1;
  INSERT INTO public.notifications (user_id, title, body, kind, link, audience, event_key)
  SELECT ur.user_id, 'New product submitted',
    COALESCE(seller_name,'A seller') || ' added "' || NEW.name || '" (status: ' || NEW.status::text || ')',
    'product', '/admin/products', 'all_users',
    'product_submitted:' || NEW.id::text || ':' || ur.user_id::text
  FROM public.user_roles ur WHERE ur.role = 'admin';
  RETURN NEW;
END $$;

DO $$
DECLARE
  z record;
  i integer;
  seller_uuid uuid;
  owner_uuid uuid;
  shop_name text;
  category text;
  categories text[] := ARRAY['grocery','bakery','pharmacy','fashion','electronics','restaurants','home decor','stationery'];
BEGIN
  FOR z IN SELECT zone_code, city, zone_name, hub_lat, hub_lng FROM public.operational_zones WHERE is_active ORDER BY zone_code LOOP
    FOR i IN 1..8 LOOP
      seller_uuid := md5('localshore-demo-seller-' || z.zone_code || '-' || i)::uuid;
      owner_uuid := md5('localshore-demo-owner-' || z.zone_code || '-' || i)::uuid;
      shop_name := 'LocalShore ' || z.zone_code || ' Shop ' || lpad(i::text, 2, '0');
      category := categories[i];

      -- The auth owner is only a technical owner for this seed dataset. Replace
      -- these demo sellers with real vendor accounts before production launch.
      INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at
      ) VALUES (
        '00000000-0000-0000-0000-000000000000', owner_uuid, 'authenticated', 'authenticated',
        lower(z.zone_code) || '.demo' || i || '@localshore.test',
        crypt('LocalShoreDemoOnly!', gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('display_name', shop_name), now(), now()
      ) ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.sellers (
        id, user_id, business_name, full_name, email, business_type, status,
        address_line1, city, state, country, lat, lng
      ) VALUES (
        seller_uuid, owner_uuid, shop_name, shop_name,
        lower(z.zone_code) || '.demo' || i || '@localshore.test', category, 'approved',
        z.zone_name || ' local market',
        CASE WHEN z.city = 'Bengaluru' THEN 'Bengaluru' ELSE 'Coimbatore' END,
        CASE WHEN z.city = 'Bengaluru' THEN 'Karnataka' ELSE 'Tamil Nadu' END,
        'India',
        z.hub_lat + (((i - 1) % 4) - 1.5) * 0.006,
        z.hub_lng + (((i - 1) / 4) - 0.5) * 0.008
      )
      ON CONFLICT (id) DO UPDATE SET
        status = 'approved', business_name = EXCLUDED.business_name,
        business_type = EXCLUDED.business_type, lat = EXCLUDED.lat, lng = EXCLUDED.lng,
        city = EXCLUDED.city, state = EXCLUDED.state;

      INSERT INTO public.products (
        id, seller_id, user_id, name, sku, category, description,
        mrp, selling_price, stock, status, image_url
      ) VALUES (
        md5('localshore-demo-product-' || z.zone_code || '-' || i)::uuid,
        seller_uuid, owner_uuid,
        shop_name || ' ' || initcap(category) || ' Pick',
        z.zone_code || '-DEMO-' || lpad(i::text, 2, '0'),
        category, 'Demo product used to verify LocalShore zone coverage and distance visibility.',
        999, 799, 25, 'active',
        'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=600&q=75'
      )
      ON CONFLICT (id) DO UPDATE SET
        seller_id = EXCLUDED.seller_id, user_id = EXCLUDED.user_id,
        category = EXCLUDED.category, stock = 25, status = 'active';
    END LOOP;
  END LOOP;
END $$;

-- Verification helper: every active zone should have at least eight seeded shops.
-- This does not alter visibility; the customer RPC still requires <= 5,000m.
DO $$
DECLARE missing_zones integer;
BEGIN
  SELECT count(*) INTO missing_zones
  FROM public.operational_zones z
  WHERE z.is_active AND (
    SELECT count(*) FROM public.sellers s
    WHERE s.status::text IN ('approved','active')
      AND s.lat IS NOT NULL AND s.lng IS NOT NULL
      AND ST_DWithin(
        ST_SetSRID(ST_MakePoint(s.lng,s.lat),4326)::geography,
        z.hub_location, 5000
      )
  ) < 8;
  IF missing_zones > 0 THEN
    RAISE EXCEPTION 'LocalShore zone coverage seed incomplete: % zones have fewer than 8 shops', missing_zones;
  END IF;
END $$;
