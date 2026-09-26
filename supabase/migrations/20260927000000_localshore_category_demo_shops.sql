-- LocalShore category-complete demo marketplace
--
-- The previous coverage seed reused the same sellers for unrelated categories.
-- This migration creates only clearly marked demo sellers, and gives every
-- customer-facing category at least eight nearby category-specific shops per
-- operational zone. Real sellers and real inventory are not modified.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.products DISABLE TRIGGER trg_notify_admins_new_product;

DO $$
DECLARE
  zone_row record;
  category_row record;
  seller_no integer;
  missing_count integer;
  product_no integer;
  seller_uuid uuid;
  owner_uuid uuid;
  shop_name text;
  shop_email text;
  address_area text;
  bearing double precision;
  radius_km double precision;
  shop_lat double precision;
  shop_lng double precision;
  category_shop_count integer;
  product_names text[];
BEGIN
  FOR zone_row IN
    SELECT zone_code, city, zone_name, hub_lat, hub_lng
    FROM public.operational_zones
    WHERE is_active
    ORDER BY zone_code
  LOOP
    FOR category_row IN
      SELECT * FROM (VALUES
        ('fruits_veg', 'Fresh Produce', ARRAY['Tomatoes','Onions','Potatoes','Carrots'], 'https://images.unsplash.com/photo-1610832958506-aa56368176cf?auto=format&fit=crop&w=800&q=80'),
        ('meat_fish', 'Meat & Fish', ARRAY['Chicken','Mutton','Fish','Prawns'], 'https://images.unsplash.com/photo-1607623814075-e51df1bdc82f?auto=format&fit=crop&w=800&q=80'),
        ('bakery', 'Bakery & Sweets', ARRAY['Bread','Cakes','Puffs','Cookies'], 'https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=800&q=80'),
        ('grocery', 'Kirana & Grocery', ARRAY['Rice','Wheat Flour','Cooking Oil','Sugar'], 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=800&q=80'),
        ('supermarkets', 'Supermarket', ARRAY['Monthly Groceries','Dairy','Snacks','Household Essentials'], 'https://images.unsplash.com/photo-1578916171728-46686eac8d58?auto=format&fit=crop&w=800&q=80'),
        ('pharmacy', 'Pharmacy & Care', ARRAY['Paracetamol','Vitamins','First Aid Kit','Toothpaste'], 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?auto=format&fit=crop&w=800&q=80'),
        ('restaurants', 'Restaurants & Dining', ARRAY['Meals','Biryani','South Indian Thali','Fried Rice'], 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=800&q=80'),
        ('cafes', 'Cafes & Tea', ARRAY['Filter Coffee','Tea','Sandwiches','Pastries'], 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=800&q=80'),
        ('fashion', 'Fashion & Apparel', ARRAY['T-Shirts','Jeans','Shirts','Dresses'], 'https://images.unsplash.com/photo-1445205170230-053b83016050?auto=format&fit=crop&w=800&q=80'),
        ('boutiques', 'Boutiques', ARRAY['Sarees','Kurtis','Designer Wear','Ethnic Sets'], 'https://images.unsplash.com/photo-1558769132-cb1aea458c5e?auto=format&fit=crop&w=800&q=80'),
        ('footwear', 'Footwear', ARRAY['Running Shoes','Sandals','Slippers','Formal Shoes'], 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=800&q=80'),
        ('jewellery', 'Jewellery & Gifts', ARRAY['Earrings','Necklaces','Bangles','Gift Sets'], 'https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?auto=format&fit=crop&w=800&q=80'),
        ('electronics', 'Electronics', ARRAY['Televisions','Headphones','Speakers','Smart Watches'], 'https://images.unsplash.com/photo-1498049794561-7780e7231661?auto=format&fit=crop&w=800&q=80'),
        ('mobile', 'Mobile & Accessories', ARRAY['Smartphones','Phone Cases','Chargers','Screen Protectors'], 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=800&q=80'),
        ('beauty', 'Beauty & Personal Care', ARRAY['Face Wash','Lipstick','Shampoo','Skin Care Kit'], 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=800&q=80'),
        ('home_kitchen', 'Home & Kitchen', ARRAY['Cookware','Pressure Cooker','Dinner Sets','Water Bottles'], 'https://images.unsplash.com/photo-1556911220-e15b29be8c8f?auto=format&fit=crop&w=800&q=80'),
        ('furniture', 'Furniture & Decor', ARRAY['Sofa Sets','Dining Tables','Wall Decor','Lamps'], 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?auto=format&fit=crop&w=800&q=80'),
        ('hardware', 'Home & Hardware', ARRAY['Drills','Tool Kits','Screws','Hammers'], 'https://images.unsplash.com/photo-1504148455328-c376907d081c?auto=format&fit=crop&w=800&q=80'),
        ('books_stationery', 'Books & Stationery', ARRAY['Notebooks','Pens','School Books','Art Supplies'], 'https://images.unsplash.com/photo-1519682337058-a94d519337bc?auto=format&fit=crop&w=800&q=80'),
        ('sports', 'Sports & Fitness', ARRAY['Yoga Mats','Dumbbells','Cricket Bats','Sports Shoes'], 'https://images.unsplash.com/photo-1517649763962-0c623266010b?auto=format&fit=crop&w=800&q=80'),
        ('toys', 'Toys & Baby Care', ARRAY['Building Blocks','Dolls','Remote Cars','Baby Toys'], 'https://images.unsplash.com/photo-1596461404969-9ae70f2830c1?auto=format&fit=crop&w=800&q=80'),
        ('gifts', 'Gift Shops', ARRAY['Gift Hampers','Greeting Cards','Soft Toys','Photo Frames'], 'https://images.unsplash.com/photo-1513883049090-d0b7439799bf?auto=format&fit=crop&w=800&q=80'),
        ('flowers', 'Flower Shops', ARRAY['Roses','Bouquets','Jasmine','Marigold'], 'https://images.unsplash.com/photo-1490750967868-88aa4486c946?auto=format&fit=crop&w=800&q=80'),
        ('pet_shops', 'Pet Care & Shops', ARRAY['Dog Food','Cat Food','Pet Toys','Grooming Supplies'], 'https://images.unsplash.com/photo-1583337130417-3346a1be7dde?auto=format&fit=crop&w=800&q=80'),
        ('pooja', 'Pooja & Divine', ARRAY['Pooja Kits','Incense Sticks','Lamps','Camphor'], 'https://images.unsplash.com/photo-1604608672516-f1b9a3a57f3f?auto=format&fit=crop&w=800&q=80'),
        ('auto', 'Auto & Bike Spares', ARRAY['Engine Oil','Brake Pads','Helmets','Bike Accessories'], 'https://images.unsplash.com/photo-1558981806-ec527fa84c39?auto=format&fit=crop&w=800&q=80'),
        ('repair', 'Repair Shops', ARRAY['Phone Repair','Laptop Repair','Appliance Repair','Screen Replacement'], 'https://images.unsplash.com/photo-1520170354516-4f7d4f7b9f7d?auto=format&fit=crop&w=800&q=80'),
        ('local_services', 'Local Services', ARRAY['Printing','Tailoring','Home Cleaning','Event Services'], 'https://images.unsplash.com/photo-1450101499163-c8848c66ca85?auto=format&fit=crop&w=800&q=80')
      ) AS c(category, label, products, image_url)
    LOOP
      SELECT count(*)::integer
      INTO category_shop_count
      FROM public.sellers s
      WHERE s.status::text IN ('approved', 'active')
        AND s.business_type = category_row.category
        AND s.email ILIKE '%@localshore.test'
        AND s.lat IS NOT NULL AND s.lng IS NOT NULL
        AND ST_DWithin(
          ST_SetSRID(ST_MakePoint(s.lng, s.lat), 4326)::geography,
          ST_SetSRID(ST_MakePoint(zone_row.hub_lng, zone_row.hub_lat), 4326)::geography,
          5000
        );

      missing_count := GREATEST(0, 8 - category_shop_count);

      FOR seller_no IN 1..missing_count LOOP
        seller_uuid := md5('localshore-category-shop-v3-' || zone_row.zone_code || '-' || category_row.category || '-' || seller_no)::uuid;
        owner_uuid := md5('localshore-category-owner-v3-' || zone_row.zone_code || '-' || category_row.category || '-' || seller_no)::uuid;
        shop_name := 'LocalShore Demo ' || zone_row.zone_code || ' ' || category_row.label || ' Shop ' || lpad((category_shop_count + seller_no)::text, 2, '0');
        shop_email := lower(zone_row.zone_code) || '.' || category_row.category || '.demo' || seller_no || '@localshore.test';
        address_area := zone_row.zone_name || ' ' || category_row.label || ' Market, Unit ' || lpad((category_shop_count + seller_no)::text, 2, '0');
        bearing := radians(((category_shop_count + seller_no - 1) % 8) * 45.0);
        radius_km := 0.25 + (((category_shop_count + seller_no - 1) % 8) * 0.16);
        shop_lat := zone_row.hub_lat + (radius_km * cos(bearing)) / 111.32;
        shop_lng := zone_row.hub_lng + (radius_km * sin(bearing)) / (111.32 * cos(radians(zone_row.hub_lat)));

        INSERT INTO auth.users (
          instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
          raw_app_meta_data, raw_user_meta_data, created_at, updated_at
        ) VALUES (
          '00000000-0000-0000-0000-000000000000', owner_uuid, 'authenticated',
          'authenticated', shop_email, crypt('LocalShoreDemoOnly!', gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb,
          jsonb_build_object('display_name', shop_name, 'demo_account', true), now(), now()
        ) ON CONFLICT (id) DO NOTHING;

        INSERT INTO public.sellers (
          id, user_id, business_name, full_name, email, business_type, status,
          address_line1, city, state, country, lat, lng
        ) VALUES (
          seller_uuid, owner_uuid, shop_name, shop_name, shop_email, category_row.category,
          'approved', address_area || ', ' || zone_row.city || ', India', zone_row.city,
          CASE WHEN zone_row.city = 'Bengaluru' THEN 'Karnataka' ELSE 'Tamil Nadu' END,
          'India', shop_lat, shop_lng
        ) ON CONFLICT (id) DO UPDATE SET
          status = 'approved', business_name = EXCLUDED.business_name,
          business_type = EXCLUDED.business_type, address_line1 = EXCLUDED.address_line1,
          city = EXCLUDED.city, state = EXCLUDED.state, country = EXCLUDED.country,
          lat = EXCLUDED.lat, lng = EXCLUDED.lng;

        product_names := category_row.products;
        FOR product_no IN 1..array_length(product_names, 1) LOOP
          INSERT INTO public.products (
            id, seller_id, user_id, name, sku, category, description,
            mrp, selling_price, stock, status, image_url
          ) VALUES (
            md5('localshore-category-product-v3-' || seller_uuid::text || '-' || product_no)::uuid,
            seller_uuid, owner_uuid, product_names[product_no],
            upper(category_row.category) || '-DEMO-' || left(replace(seller_uuid::text, '-', ''), 8) || '-' || product_no,
            category_row.category,
            product_names[product_no] || ' from ' || shop_name || '.',
            999, 799, 20, 'active', category_row.image_url
          ) ON CONFLICT (id) DO UPDATE SET
            seller_id = EXCLUDED.seller_id, user_id = EXCLUDED.user_id,
            name = EXCLUDED.name, category = EXCLUDED.category,
            description = EXCLUDED.description, selling_price = EXCLUDED.selling_price,
            stock = EXCLUDED.stock, status = 'active', image_url = EXCLUDED.image_url;
        END LOOP;
      END LOOP;
    END LOOP;
  END LOOP;
END $$;

ALTER TABLE public.products ENABLE TRIGGER trg_notify_admins_new_product;

-- Confirm that each active zone/category has at least eight matching demo
-- shops. Real shops are intentionally excluded from this demo-data check.
DO $$
DECLARE
  missing record;
BEGIN
  SELECT z.zone_code, c.category
  INTO missing
  FROM public.operational_zones z
  CROSS JOIN (VALUES
    ('fruits_veg'), ('meat_fish'), ('bakery'), ('grocery'), ('supermarkets'),
    ('pharmacy'), ('restaurants'), ('cafes'), ('fashion'), ('boutiques'),
    ('footwear'), ('jewellery'), ('electronics'), ('mobile'), ('beauty'),
    ('home_kitchen'), ('furniture'), ('hardware'), ('books_stationery'),
    ('sports'), ('toys'), ('gifts'), ('flowers'), ('pet_shops'), ('pooja'),
    ('auto'), ('repair'), ('local_services')
  ) AS c(category)
  WHERE z.is_active
    AND (
      SELECT count(*)
      FROM public.sellers s
      WHERE s.status::text IN ('approved', 'active')
        AND s.business_type = c.category
        AND s.email ILIKE '%@localshore.test'
        AND ST_DWithin(
          ST_SetSRID(ST_MakePoint(s.lng, s.lat), 4326)::geography,
          ST_SetSRID(ST_MakePoint(z.hub_lng, z.hub_lat), 4326)::geography,
          5000
        )
    ) < 8
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Category demo coverage incomplete for zone %, category %', missing.zone_code, missing.category;
  END IF;
END $$;
