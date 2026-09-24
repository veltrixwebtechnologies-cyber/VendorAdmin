-- Give the eight demo shops in each zone one distinct category and ten matching
-- browseable products each. Images are Unsplash stock photos, used as demo
-- imagery only; replace with seller-submitted catalog photos before production.
ALTER TABLE public.products DISABLE TRIGGER trg_notify_admins_new_product;

WITH desired_categories(shop_no, category) AS (
  VALUES
    (1, 'fruits_veg'),
    (2, 'meat_fish'),
    (3, 'bakery'),
    (4, 'grocery'),
    (5, 'pharmacy'),
    (6, 'fashion'),
    (7, 'electronics'),
    (8, 'home_kitchen')
)
UPDATE public.sellers s
SET business_type = d.category
FROM desired_categories d
WHERE s.email ILIKE '%@localshore.test'
  AND s.business_name ILIKE 'LocalShore%Shop%'
  AND substring(s.business_name FROM 'Shop ([0-9]+)$')::integer = d.shop_no;

-- Retire the earlier generic/mixed-category rows from these demo shops before
-- rebuilding their catalog. Keep the rows for audit/recovery; they are not
-- deleted, and the named products below are reactivated on every run.
UPDATE public.products p
SET status = 'inactive', stock = 0
FROM public.sellers s
WHERE p.seller_id = s.id
  AND s.email ILIKE '%@localshore.test'
  AND s.business_name ILIKE 'LocalShore%Shop%'
  AND substring(s.business_name FROM 'Shop ([0-9]+)$') IS NOT NULL
  AND substring(s.business_name FROM 'Shop ([0-9]+)$')::integer BETWEEN 1 AND 8;

WITH catalog(slug, name, category, description, price, image_url) AS (
  VALUES
    ('tomato', 'Tomato', 'fruits_veg', 'Fresh, ripe tomatoes.', 38, 'https://images.unsplash.com/photo-1546094096-0df4bcaaa337?auto=format&fit=crop&w=640&q=80'),
    ('onion', 'Onion', 'fruits_veg', 'Everyday fresh onions.', 42, 'https://images.unsplash.com/photo-1508747703725-719777637510?auto=format&fit=crop&w=640&q=80'),
    ('potato', 'Potato', 'fruits_veg', 'Fresh potatoes for daily cooking.', 36, 'https://images.unsplash.com/photo-1518977676601-b53f82aba655?auto=format&fit=crop&w=640&q=80'),
    ('carrot', 'Carrot', 'fruits_veg', 'Crunchy fresh carrots.', 52, 'https://images.unsplash.com/photo-1445282768818-728615cc910a?auto=format&fit=crop&w=640&q=80'),
    ('banana', 'Banana', 'fruits_veg', 'Sweet ripe bananas.', 48, 'https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?auto=format&fit=crop&w=640&q=80'),
    ('apple', 'Apple', 'fruits_veg', 'Crisp seasonal apples.', 160, 'https://images.unsplash.com/photo-1560806887-1e4cd0b6cbd6?auto=format&fit=crop&w=640&q=80'),
    ('orange', 'Orange', 'fruits_veg', 'Juicy fresh oranges.', 90, 'https://images.unsplash.com/photo-1547514701-42782101795e?auto=format&fit=crop&w=640&q=80'),
    ('mango', 'Mango', 'fruits_veg', 'Seasonal sweet mangoes.', 120, 'https://images.unsplash.com/photo-1553279768-865429fa0078?auto=format&fit=crop&w=640&q=80'),
    ('spinach', 'Spinach', 'fruits_veg', 'Fresh leafy spinach.', 28, 'https://images.unsplash.com/photo-1576045057995-568f588f82fb?auto=format&fit=crop&w=640&q=80'),
    ('coconut', 'Coconut', 'fruits_veg', 'Tender, fresh coconut.', 55, 'https://images.unsplash.com/photo-1610832958506-aa56368176cf?auto=format&fit=crop&w=640&q=80'),

    ('chicken', 'Chicken', 'meat_fish', 'Fresh chicken, cleaned to order.', 240, 'https://images.unsplash.com/photo-1604503468506-a8da13d82791?auto=format&fit=crop&w=640&q=80'),
    ('mutton', 'Mutton', 'meat_fish', 'Fresh-cut mutton.', 780, 'https://images.unsplash.com/photo-1607623814075-e51df1bdc82f?auto=format&fit=crop&w=640&q=80'),
    ('fish', 'Fish', 'meat_fish', 'Fresh catch of the day.', 280, 'https://images.unsplash.com/photo-1510130387422-82bed34b37e9?auto=format&fit=crop&w=640&q=80'),
    ('prawns', 'Prawns', 'meat_fish', 'Fresh cleaned prawns.', 420, 'https://images.unsplash.com/photo-1565680018434-b513d5e5fd47?auto=format&fit=crop&w=640&q=80'),
    ('eggs', 'Eggs', 'meat_fish', 'Farm-fresh eggs.', 90, 'https://images.unsplash.com/photo-1518569656558-1f25e69d93d7?auto=format&fit=crop&w=640&q=80'),
    ('chicken-breast', 'Chicken Breast', 'meat_fish', 'Boneless chicken breast portions.', 300, 'https://images.unsplash.com/photo-1604503468506-a8da13d82791?auto=format&fit=crop&w=640&q=80'),
    ('chicken-leg', 'Chicken Leg', 'meat_fish', 'Fresh chicken leg pieces.', 260, 'https://images.unsplash.com/photo-1626082927389-6cd097cdc6ec?auto=format&fit=crop&w=640&q=80'),
    ('seer-fish', 'Seer Fish', 'meat_fish', 'Fresh seer fish steaks.', 850, 'https://images.unsplash.com/photo-1510130387422-82bed34b37e9?auto=format&fit=crop&w=640&q=80'),
    ('rohu-fish', 'Rohu Fish', 'meat_fish', 'Fresh rohu fish cuts.', 240, 'https://images.unsplash.com/photo-1510130387422-82bed34b37e9?auto=format&fit=crop&w=640&q=80'),
    ('crab', 'Crab', 'meat_fish', 'Fresh crab, cleaned on request.', 360, 'https://images.unsplash.com/photo-1559737558-2f5a35f4523b?auto=format&fit=crop&w=640&q=80'),

    ('birthday-cake', 'Birthday Cake', 'bakery', 'Celebration cake made fresh by the bakery.', 650, 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=640&q=80'),
    ('black-forest-cake', 'Black Forest Cake', 'bakery', 'Chocolate and cream Black Forest cake.', 720, 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=640&q=80'),
    ('chocolate-cake', 'Chocolate Cake', 'bakery', 'Rich chocolate cake.', 680, 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=640&q=80'),
    ('bread', 'Bread', 'bakery', 'Freshly baked bread loaf.', 45, 'https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=640&q=80'),
    ('bun', 'Bun', 'bakery', 'Soft bakery buns.', 12, 'https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=640&q=80'),
    ('puffs', 'Puffs', 'bakery', 'Flaky savory bakery puffs.', 25, 'https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=640&q=80'),
    ('cookies', 'Cookies', 'bakery', 'Freshly baked cookies.', 80, 'https://images.unsplash.com/photo-1499636136210-6f4ee915583e?auto=format&fit=crop&w=640&q=80'),
    ('samosa', 'Samosa', 'bakery', 'Crisp, savory samosas.', 18, 'https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=640&q=80'),
    ('gulab-jamun', 'Gulab Jamun', 'bakery', 'Traditional syrup-soaked gulab jamun.', 140, 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=640&q=80'),
    ('mysore-pak', 'Mysore Pak', 'bakery', 'Traditional Mysore Pak sweets.', 220, 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=640&q=80'),

    ('rice', 'Rice', 'grocery', 'Everyday cooking rice.', 72, 'https://images.unsplash.com/photo-1586201375761-83865001e31c?auto=format&fit=crop&w=640&q=80'),
    ('wheat-flour', 'Wheat Flour', 'grocery', 'Fresh whole-wheat flour.', 58, 'https://images.unsplash.com/photo-1627485937980-221c88ac04f9?auto=format&fit=crop&w=640&q=80'),
    ('cooking-oil', 'Cooking Oil', 'grocery', 'Cooking oil for everyday meals.', 155, 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?auto=format&fit=crop&w=640&q=80'),
    ('sugar', 'Sugar', 'grocery', 'Fine granulated sugar.', 48, 'https://images.unsplash.com/photo-1581441363689-1f3c3c414635?auto=format&fit=crop&w=640&q=80'),
    ('salt', 'Salt', 'grocery', 'Iodized table salt.', 22, 'https://images.unsplash.com/photo-1532336414038-cf19250c5757?auto=format&fit=crop&w=640&q=80'),
    ('dal', 'Dal', 'grocery', 'Daily-use split lentils.', 110, 'https://images.unsplash.com/photo-1515543904379-3d757afe72e4?auto=format&fit=crop&w=640&q=80'),
    ('atta', 'Atta', 'grocery', 'Whole-wheat chakki atta.', 62, 'https://images.unsplash.com/photo-1586201375761-83865001e31c?auto=format&fit=crop&w=640&q=80'),
    ('spices', 'Spices', 'grocery', 'Aromatic everyday cooking spices.', 95, 'https://images.unsplash.com/photo-1532336414038-cf19250c5757?auto=format&fit=crop&w=640&q=80'),
    ('biscuits', 'Biscuits', 'grocery', 'Tea-time biscuits.', 35, 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?auto=format&fit=crop&w=640&q=80'),
    ('tea', 'Tea', 'grocery', 'Aromatic tea leaves.', 125, 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?auto=format&fit=crop&w=640&q=80'),

    ('paracetamol', 'Paracetamol', 'pharmacy', 'Common OTC pain and fever relief. Use as directed.', 25, 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?auto=format&fit=crop&w=640&q=80'),
    ('vitamins', 'Vitamins', 'pharmacy', 'Daily multivitamin supplement.', 220, 'https://images.unsplash.com/photo-1571781926291-c477ebfd024b?auto=format&fit=crop&w=640&q=80'),
    ('face-wash', 'Face Wash', 'pharmacy', 'Gentle daily face cleanser.', 160, 'https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?auto=format&fit=crop&w=640&q=80'),
    ('shampoo', 'Shampoo', 'pharmacy', 'Everyday shampoo for hair care.', 180, 'https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?auto=format&fit=crop&w=640&q=80'),
    ('toothpaste', 'Toothpaste', 'pharmacy', 'Daily fluoride toothpaste.', 95, 'https://images.unsplash.com/photo-1609840114035-3c981b782dfe?auto=format&fit=crop&w=640&q=80'),
    ('toothbrush', 'Toothbrush', 'pharmacy', 'Soft-bristle toothbrush.', 55, 'https://images.unsplash.com/photo-1609840114035-3c981b782dfe?auto=format&fit=crop&w=640&q=80'),
    ('hand-sanitizer', 'Hand Sanitizer', 'pharmacy', 'Portable hand sanitizer.', 65, 'https://images.unsplash.com/photo-1584483766114-2cea6facdf57?auto=format&fit=crop&w=640&q=80'),
    ('first-aid-kit', 'First Aid Kit', 'pharmacy', 'Basic home first aid kit.', 350, 'https://images.unsplash.com/photo-1603398938378-e54eab446dde?auto=format&fit=crop&w=640&q=80'),
    ('bandages', 'Bandages', 'pharmacy', 'Adhesive bandages for minor cuts.', 45, 'https://images.unsplash.com/photo-1603398938378-e54eab446dde?auto=format&fit=crop&w=640&q=80'),
    ('baby-care-products', 'Baby Care Products', 'pharmacy', 'Gentle everyday baby-care essentials.', 240, 'https://images.unsplash.com/photo-1604917877934-07d8d248d396?auto=format&fit=crop&w=640&q=80'),

    ('t-shirts', 'T-Shirts', 'fashion', 'Comfortable everyday cotton T-shirts.', 399, 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=640&q=80'),
    ('jeans', 'Jeans', 'fashion', 'Everyday denim jeans.', 999, 'https://images.unsplash.com/photo-1542272604-787c3835535d?auto=format&fit=crop&w=640&q=80'),
    ('shirts', 'Shirts', 'fashion', 'Casual button-down shirt.', 699, 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?auto=format&fit=crop&w=640&q=80'),
    ('sarees', 'Sarees', 'fashion', 'Traditional saree for festive and daily wear.', 1499, 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=640&q=80'),
    ('kurtis', 'Kurtis', 'fashion', 'Everyday printed kurti.', 799, 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=640&q=80'),
    ('chudidars', 'Chudidars', 'fashion', 'Traditional chudidar set.', 1199, 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=640&q=80'),
    ('leggings', 'Leggings', 'fashion', 'Stretch-fit everyday leggings.', 399, 'https://images.unsplash.com/photo-1445205170230-053b83016050?auto=format&fit=crop&w=640&q=80'),
    ('dresses', 'Dresses', 'fashion', 'Casual day dress.', 1299, 'https://images.unsplash.com/photo-1595777457583-95e059d581b8?auto=format&fit=crop&w=640&q=80'),
    ('innerwear', 'Innerwear', 'fashion', 'Comfort-fit innerwear essentials.', 299, 'https://images.unsplash.com/photo-1576566588028-4147f3842f27?auto=format&fit=crop&w=640&q=80'),
    ('kids-wear', 'Kids Wear', 'fashion', 'Soft everyday clothing for kids.', 499, 'https://images.unsplash.com/photo-1519238263530-99bdd11df2ea?auto=format&fit=crop&w=640&q=80'),

    ('smartphones', 'Smartphones', 'electronics', 'Demo smartphone listing.', 12999, 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=640&q=80'),
    ('earbuds', 'Earbuds', 'electronics', 'Wireless earbuds with charging case.', 1499, 'https://images.unsplash.com/photo-1606220945770-b5b6c2c55bf1?auto=format&fit=crop&w=640&q=80'),
    ('bluetooth-speakers', 'Bluetooth Speakers', 'electronics', 'Portable Bluetooth speaker.', 1999, 'https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?auto=format&fit=crop&w=640&q=80'),
    ('chargers', 'Chargers', 'electronics', 'USB phone charger.', 499, 'https://images.unsplash.com/photo-1614399113305-a127bb2ca893?auto=format&fit=crop&w=640&q=80'),
    ('power-banks', 'Power Banks', 'electronics', 'Portable power bank.', 1299, 'https://images.unsplash.com/photo-1614399113305-a127bb2ca893?auto=format&fit=crop&w=640&q=80'),
    ('usb-cables', 'USB Cables', 'electronics', 'USB charging and data cable.', 199, 'https://images.unsplash.com/photo-1614399113305-a127bb2ca893?auto=format&fit=crop&w=640&q=80'),
    ('smart-watches', 'Smart Watches', 'electronics', 'Smart watch with activity tracking.', 2499, 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=640&q=80'),
    ('phone-cases', 'Phone Cases', 'electronics', 'Protective smartphone case.', 299, 'https://images.unsplash.com/photo-1603313011101-320f26a4f6f6?auto=format&fit=crop&w=640&q=80'),
    ('screen-protectors', 'Screen Protectors', 'electronics', 'Tempered-glass screen protector.', 149, 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=640&q=80'),
    ('headphones', 'Headphones', 'electronics', 'Over-ear headphones.', 1799, 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=640&q=80'),

    ('cookware', 'Cookware', 'home_kitchen', 'Everyday cookware set.', 1299, 'https://images.unsplash.com/photo-1556911220-e15b29be8c8f?auto=format&fit=crop&w=640&q=80'),
    ('pressure-cooker', 'Pressure Cooker', 'home_kitchen', 'Stovetop pressure cooker.', 1899, 'https://images.unsplash.com/photo-1612476930934-b7ef769cbae9?auto=format&fit=crop&w=640&q=80'),
    ('non-stick-pan', 'Non-Stick Pan', 'home_kitchen', 'Non-stick frying pan.', 799, 'https://images.unsplash.com/photo-1556911220-e15b29be8c8f?auto=format&fit=crop&w=640&q=80'),
    ('dinner-sets', 'Dinner Sets', 'home_kitchen', 'Reusable everyday dinner set.', 1499, 'https://images.unsplash.com/photo-1603199506016-b9a594b593c0?auto=format&fit=crop&w=640&q=80'),
    ('water-bottles', 'Water Bottles', 'home_kitchen', 'Reusable water bottle.', 299, 'https://images.unsplash.com/photo-1602143407151-7111542de6e8?auto=format&fit=crop&w=640&q=80'),
    ('storage-containers', 'Storage Containers', 'home_kitchen', 'Kitchen storage container set.', 499, 'https://images.unsplash.com/photo-1603199506016-b9a594b593c0?auto=format&fit=crop&w=640&q=80'),
    ('mixer-grinder', 'Mixer Grinder', 'home_kitchen', 'Kitchen mixer grinder.', 2799, 'https://images.unsplash.com/photo-1585515320310-259814833e62?auto=format&fit=crop&w=640&q=80'),
    ('kitchen-knives', 'Kitchen Knives', 'home_kitchen', 'Kitchen knife set.', 699, 'https://images.unsplash.com/photo-1593618998160-e34014e67546?auto=format&fit=crop&w=640&q=80'),
    ('bedsheets', 'Bedsheets', 'home_kitchen', 'Soft cotton bedsheet set.', 999, 'https://images.unsplash.com/photo-1631049307264-da0ec9d70304?auto=format&fit=crop&w=640&q=80'),
    ('cleaning-supplies', 'Cleaning Supplies', 'home_kitchen', 'Household cleaning essentials.', 249, 'https://images.unsplash.com/photo-1563453392212-326f5e854473?auto=format&fit=crop&w=640&q=80')
), demo_sellers AS (
  SELECT s.id, s.user_id, s.business_name, d.category
  FROM public.sellers AS s
  JOIN (VALUES
    (1, 'fruits_veg'),
    (2, 'meat_fish'),
    (3, 'bakery'),
    (4, 'grocery'),
    (5, 'pharmacy'),
    (6, 'fashion'),
    (7, 'electronics'),
    (8, 'home_kitchen')
  ) AS d(shop_no, category)
    ON substring(s.business_name FROM 'Shop ([0-9]+)$')::integer = d.shop_no
  WHERE s.status::text IN ('approved', 'active')
    AND s.email ILIKE '%@localshore.test'
    AND s.business_name ILIKE 'LocalShore%Shop%'
)
INSERT INTO public.products (
  id, seller_id, user_id, name, sku, category, description,
  mrp, selling_price, stock, status, image_url
)
SELECT
  md5('localshore-named-demo-v1-' || s.id::text || '-' || c.slug)::uuid,
  s.id,
  s.user_id,
  c.name,
  upper(left(regexp_replace(c.slug, '[^a-zA-Z0-9]+', '-', 'g'), 24)) || '-' || left(replace(s.id::text, '-', ''), 8),
  c.category,
  c.description || ' Demo listing at ' || s.business_name || '.',
  round(c.price * 1.15, 2),
  c.price,
  20,
  'active',
  c.image_url
FROM demo_sellers s
JOIN catalog c ON c.category = s.category
ON CONFLICT (id) DO UPDATE SET
  seller_id = EXCLUDED.seller_id,
  user_id = EXCLUDED.user_id,
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  description = EXCLUDED.description,
  mrp = EXCLUDED.mrp,
  selling_price = EXCLUDED.selling_price,
  stock = EXCLUDED.stock,
  status = 'active',
  image_url = EXCLUDED.image_url;

UPDATE public.sellers s
SET business_name =
  'LocalShore ' || substring(s.business_name FROM '(CBE-[0-9]{2}|BLR-[0-9]{2})') || ' ' ||
  CASE s.business_type
    WHEN 'fruits_veg' THEN 'Fresh Produce'
    WHEN 'meat_fish' THEN 'Meat & Fish'
    WHEN 'bakery' THEN 'Bakery & Sweets'
    WHEN 'grocery' THEN 'Kirana & Grocery'
    WHEN 'pharmacy' THEN 'Pharmacy & Care'
    WHEN 'fashion' THEN 'Fashion & Apparel'
    WHEN 'electronics' THEN 'Electronics & Mobiles'
    WHEN 'home_kitchen' THEN 'Home & Kitchen'
    ELSE 'Neighborhood'
  END || ' Shop ' || lpad(substring(s.business_name FROM 'Shop ([0-9]+)$'), 2, '0')
WHERE s.email ILIKE '%@localshore.test'
  AND s.business_name ILIKE 'LocalShore%Shop%'
  AND substring(s.business_name FROM '(CBE-[0-9]{2}|BLR-[0-9]{2})') IS NOT NULL;

ALTER TABLE public.products ENABLE TRIGGER trg_notify_admins_new_product;
