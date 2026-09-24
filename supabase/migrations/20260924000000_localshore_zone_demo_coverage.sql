-- Clearly labeled test catalog: ensure every operational hub has at least
-- eight nearby demo shops when real approved inventory is not yet available.
-- Demo coordinates are clustered within 1.4 km of each hub; the customer
-- visibility RPC remains authoritative at <= 5,000 m from the confirmed user.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Prevent the legacy admin-notification trigger from generating duplicate
-- product_submitted events while creating this test catalog.
ALTER TABLE public.products DISABLE TRIGGER trg_notify_admins_new_product;

DO $$
DECLARE
  z record;
  shop_no integer;
  product_no integer;
  missing_count integer;
  seller_uuid uuid;
  owner_uuid uuid;
  shop_name text;
  shop_email text;
  category_name text;
  product_categories text[] := ARRAY[
    'grocery', 'bakery', 'meat_fish', 'pharmacy',
    'fashion', 'restaurants', 'electronics', 'books_stationery'
  ];
  product_labels text[] := ARRAY[
    'Daily Essentials', 'Fresh Bakery', 'Meat and Fish', 'Pharmacy',
    'Fashion', 'Restaurant', 'Electronics', 'Books and Stationery'
  ];
  address_area text;
  bearing double precision;
  radius_km double precision;
  shop_lat double precision;
  shop_lng double precision;
BEGIN
  FOR z IN
    SELECT zone_code, city, zone_name, hub_name, hub_lat, hub_lng
    FROM public.operational_zones
    WHERE is_active
    ORDER BY zone_code
  LOOP
    SELECT GREATEST(0, 8 - count(*)::integer)
      INTO missing_count
    FROM public.sellers s
    WHERE s.status::text IN ('approved', 'active')
      AND s.lat IS NOT NULL AND s.lng IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.products p
        WHERE p.seller_id = s.id AND p.status::text IN ('active', 'approved') AND p.stock > 0
      )
      AND ST_DWithin(
        ST_SetSRID(ST_MakePoint(s.lng, s.lat), 4326)::geography,
        ST_SetSRID(ST_MakePoint(z.hub_lng, z.hub_lat), 4326)::geography,
        5000
      )
      AND (
        SELECT oz.zone_code
        FROM public.operational_zones oz
        WHERE oz.is_active
        ORDER BY oz.hub_location <-> ST_SetSRID(ST_MakePoint(s.lng, s.lat), 4326)::geography
        LIMIT 1
      ) = z.zone_code;

    IF missing_count > 0 THEN
      FOR shop_no IN 1..missing_count LOOP
        seller_uuid := md5('localshore-zone-demo-v2-' || z.zone_code || '-' || shop_no)::uuid;
        owner_uuid := md5('localshore-zone-demo-owner-v2-' || z.zone_code || '-' || shop_no)::uuid;
        shop_name := 'LocalShore Demo ' || z.zone_code || ' Shop ' || lpad(shop_no::text, 2, '0');
        shop_email := lower(z.zone_code) || '.coverage' || shop_no || '@localshore.test';
        address_area := z.zone_name || ' Demo Market, Unit ' || lpad(shop_no::text, 2, '0');

        -- Evenly distribute the demo addresses around the actual hub point.
        bearing := radians((shop_no - 1) * 45.0);
        radius_km := 0.25 + (shop_no - 1) * 0.16;
        shop_lat := z.hub_lat + (radius_km * cos(bearing)) / 111.32;
        shop_lng := z.hub_lng + (radius_km * sin(bearing)) /
          (111.32 * cos(radians(z.hub_lat)));

        INSERT INTO auth.users (
          instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
          raw_app_meta_data, raw_user_meta_data, created_at, updated_at
        ) VALUES (
          '00000000-0000-0000-0000-000000000000', owner_uuid,
          'authenticated', 'authenticated', shop_email,
          crypt('LocalShoreDemoOnly!', gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb,
          jsonb_build_object('display_name', shop_name, 'demo_account', true), now(), now()
        ) ON CONFLICT (id) DO NOTHING;

        INSERT INTO public.sellers (
          id, user_id, business_name, full_name, email, business_type, status,
          address_line1, city, state, country, lat, lng
        ) VALUES (
          seller_uuid, owner_uuid, shop_name, shop_name, shop_email,
          product_categories[shop_no], 'approved',
          address_area || ', ' || z.city || ', India', z.city,
          CASE WHEN z.city = 'Bengaluru' THEN 'Karnataka' ELSE 'Tamil Nadu' END,
          'India', shop_lat, shop_lng
        ) ON CONFLICT (id) DO UPDATE SET
          status = 'approved', business_name = EXCLUDED.business_name,
          business_type = EXCLUDED.business_type, address_line1 = EXCLUDED.address_line1,
          city = EXCLUDED.city, state = EXCLUDED.state, country = EXCLUDED.country,
          lat = EXCLUDED.lat, lng = EXCLUDED.lng;

        -- Every demo shop has one in-stock demo item per supported category,
        -- so category-filtered discovery can still verify the full 8-shop hub
        -- coverage without widening the spatial visibility radius.
        FOR product_no IN 1..array_length(product_categories, 1) LOOP
          category_name := product_categories[product_no];
          INSERT INTO public.products (
            id, seller_id, user_id, name, sku, category, description,
            mrp, selling_price, stock, status, image_url
          ) VALUES (
            md5('localshore-zone-demo-product-v2-' || z.zone_code || '-' || shop_no || '-' || product_no)::uuid,
            seller_uuid, owner_uuid,
            shop_name || ' ' || product_labels[product_no],
            z.zone_code || '-COVERAGE-' || lpad(shop_no::text, 2, '0') || '-' || lpad(product_no::text, 2, '0'),
            category_name,
            'Demo inventory for testing LocalShore nearby discovery. Not a real shop or product.',
            999, 799, 20, 'active',
            'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=600&q=75'
          ) ON CONFLICT (id) DO UPDATE SET
            seller_id = EXCLUDED.seller_id, user_id = EXCLUDED.user_id,
            category = EXCLUDED.category, stock = EXCLUDED.stock, status = EXCLUDED.status;
        END LOOP;
      END LOOP;
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.products ENABLE TRIGGER trg_notify_admins_new_product;

-- Fail the migration rather than silently leave a hub without its minimum
-- demo coverage. This counts approved shops within 5 km of each hub.
DO $$
DECLARE uncovered_zones text;
BEGIN
  SELECT string_agg(z.zone_code, ', ' ORDER BY z.zone_code)
    INTO uncovered_zones
  FROM public.operational_zones z
  WHERE z.is_active
    AND (
      SELECT count(*)
      FROM public.sellers s
      WHERE s.status::text IN ('approved', 'active')
        AND s.lat IS NOT NULL AND s.lng IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.products p
          WHERE p.seller_id = s.id AND p.status::text IN ('active', 'approved') AND p.stock > 0
        )
        AND ST_DWithin(
          ST_SetSRID(ST_MakePoint(s.lng, s.lat), 4326)::geography,
          z.hub_location,
          5000
        )
        AND (
          SELECT oz.zone_code
          FROM public.operational_zones oz
          WHERE oz.is_active
          ORDER BY oz.hub_location <-> ST_SetSRID(ST_MakePoint(s.lng, s.lat), 4326)::geography
          LIMIT 1
        ) = z.zone_code
    ) < 8;

  IF uncovered_zones IS NOT NULL THEN
    RAISE EXCEPTION 'Fewer than 8 approved shops within hub visibility radius for zones: %', uncovered_zones;
  END IF;
END $$;
