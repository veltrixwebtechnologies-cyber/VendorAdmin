-- Extend nearby demo coverage to the remaining category cards.
-- Additive and limited to the clearly marked LocalShore demo sellers.

ALTER TABLE public.products DISABLE TRIGGER trg_notify_admins_new_product;

WITH demo_categories(category, label) AS (
  VALUES
    ('mobile', 'Mobile & Accessories'),
    ('beauty', 'Beauty & Personal Care'),
    ('home_kitchen', 'Home & Kitchen'),
    ('furniture', 'Furniture & Decor'),
    ('hardware', 'Home & Hardware'),
    ('books_stationery', 'Books & Stationery'),
    ('sports', 'Sports & Fitness'),
    ('toys', 'Toys & Baby Care'),
    ('gifts', 'Gift Shops'),
    ('flowers', 'Flower Shops'),
    ('pet_shops', 'Pet Care & Shops'),
    ('pooja', 'Pooja & Divine'),
    ('auto', 'Auto & Bike Spares'),
    ('repair', 'Repair Shops'),
    ('local_services', 'Local Services')
  )
INSERT INTO public.products (
  id, seller_id, user_id, name, sku, category, description,
  mrp, selling_price, stock, status, image_url
)
SELECT
  md5('localshore-extended-category-coverage-v1-' || s.id::text || '-' || c.category)::uuid,
  s.id,
  s.user_id,
  c.label || ' from ' || s.business_name,
  upper(left(regexp_replace(c.category, '[^a-zA-Z0-9]+', '-', 'g'), 18)) ||
    '-EXT-COVERAGE-' || left(replace(s.id::text, '-', ''), 8),
  c.category,
  'Demo category coverage listing for ' || s.business_name || '.',
  999,
  799,
  20,
  'active',
  'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?auto=format&fit=crop&w=640&q=75'
FROM public.sellers s
CROSS JOIN demo_categories c
WHERE s.status::text IN ('approved', 'active')
  AND s.email ILIKE '%@localshore.test'
  AND s.business_name ILIKE 'LocalShore%Shop%'
ON CONFLICT (id) DO UPDATE SET
  seller_id = EXCLUDED.seller_id,
  user_id = EXCLUDED.user_id,
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  description = EXCLUDED.description,
  mrp = EXCLUDED.mrp,
  selling_price = EXCLUDED.selling_price,
  stock = EXCLUDED.stock,
  status = EXCLUDED.status,
  image_url = EXCLUDED.image_url;

ALTER TABLE public.products ENABLE TRIGGER trg_notify_admins_new_product;
