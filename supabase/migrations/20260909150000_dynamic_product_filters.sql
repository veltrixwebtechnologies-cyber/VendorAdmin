-- LocalShore Dynamic Product Filtering System Migration
-- Migration ID: 20260909150000_dynamic_product_filters.sql

-- 1. Extend products table with category hierarchy references & single source of truth JSONB attributes
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS subcategory_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS product_type_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS attributes jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Populate attributes from legacy specifications if attributes is empty
UPDATE public.products
SET attributes = specifications
WHERE (attributes = '{}'::jsonb OR attributes IS NULL) AND specifications IS NOT NULL AND specifications <> '{}'::jsonb;

-- Create GIN index for high-performance JSONB attribute queries
CREATE INDEX IF NOT EXISTS idx_products_attributes ON public.products USING gin (attributes);
CREATE INDEX IF NOT EXISTS idx_products_cat_sub_type ON public.products (category_id, subcategory_id, product_type_id);

-- 2. Filter Definitions Table
CREATE TABLE IF NOT EXISTS public.filter_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid REFERENCES public.categories(id) ON DELETE CASCADE,
  product_type_id uuid REFERENCES public.categories(id) ON DELETE CASCADE,
  key text NOT NULL,
  label text NOT NULL,
  type text NOT NULL CHECK (type IN ('single_select', 'multi_select', 'range', 'boolean', 'number', 'text', 'color', 'rating')),
  unit text,
  is_universal boolean NOT NULL DEFAULT false,
  is_required boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_filter_def UNIQUE (key, category_id, product_type_id)
);

CREATE INDEX IF NOT EXISTS idx_filter_defs_cat_type ON public.filter_definitions (category_id, product_type_id, is_active);

-- Grants & RLS for filter_definitions
GRANT SELECT ON public.filter_definitions TO anon, authenticated;
GRANT ALL ON public.filter_definitions TO service_role;
GRANT INSERT, UPDATE, DELETE ON public.filter_definitions TO authenticated;

ALTER TABLE public.filter_definitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone views active filter definitions" ON public.filter_definitions;
CREATE POLICY "Anyone views active filter definitions"
  ON public.filter_definitions FOR SELECT
  USING (is_active OR public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins manage filter definitions" ON public.filter_definitions;
CREATE POLICY "Admins manage filter definitions"
  ON public.filter_definitions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- 3. Filter Options Table
CREATE TABLE IF NOT EXISTS public.filter_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filter_id uuid NOT NULL REFERENCES public.filter_definitions(id) ON DELETE CASCADE,
  value text NOT NULL,
  label text NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_filter_opt UNIQUE (filter_id, value)
);

CREATE INDEX IF NOT EXISTS idx_filter_options_filter ON public.filter_options (filter_id, is_active);

-- Grants & RLS for filter_options
GRANT SELECT ON public.filter_options TO anon, authenticated;
GRANT ALL ON public.filter_options TO service_role;
GRANT INSERT, UPDATE, DELETE ON public.filter_options TO authenticated;

ALTER TABLE public.filter_options ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone views active filter options" ON public.filter_options;
CREATE POLICY "Anyone views active filter options"
  ON public.filter_options FOR SELECT
  USING (is_active OR public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins manage filter options" ON public.filter_options;
CREATE POLICY "Admins manage filter options"
  ON public.filter_options FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- 4. Idempotent Seed Procedure for Category Tree & Filter Definitions
DO $$
DECLARE
  v_cat_grocery uuid;
  v_cat_fruits uuid;
  v_cat_meat uuid;
  v_cat_food uuid;
  v_cat_bakery uuid;
  v_cat_fashion uuid;
  v_cat_boutiques uuid;
  v_cat_footwear uuid;
  v_cat_jewellery uuid;
  v_cat_beauty uuid;
  v_cat_electronics uuid;
  v_cat_mobile uuid;
  v_cat_auto uuid;
  v_cat_home uuid;
  v_cat_furniture uuid;
  v_cat_hardware uuid;
  v_cat_books uuid;
  v_cat_sports uuid;
  v_cat_toys uuid;
  v_cat_gifts uuid;
  v_cat_flowers uuid;
  v_cat_pets uuid;
  v_cat_repair uuid;
  v_cat_services uuid;

  -- Subcategory & Product Type variables
  v_sub uuid;
  v_type uuid;
  v_fdef uuid;
BEGIN
  -- Top Level Categories
  INSERT INTO public.categories (name, slug, sort_order) VALUES ('Grocery', 'grocery', 1) ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id INTO v_cat_grocery;
  INSERT INTO public.categories (name, slug, sort_order) VALUES ('Fruits & Vegetables', 'fruits-vegetables', 2) ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id INTO v_cat_fruits;
  INSERT INTO public.categories (name, slug, sort_order) VALUES ('Meat & Fish', 'meat-fish', 3) ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id INTO v_cat_meat;
  INSERT INTO public.categories (name, slug, sort_order) VALUES ('Food & Restaurants', 'food-restaurants', 4) ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id INTO v_cat_food;
  INSERT INTO public.categories (name, slug, sort_order) VALUES ('Bakery & Sweets', 'bakery', 5) ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id INTO v_cat_bakery;
  INSERT INTO public.categories (name, slug, sort_order) VALUES ('Fashion & Clothing', 'fashion', 6) ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id INTO v_cat_fashion;
  INSERT INTO public.categories (name, slug, sort_order) VALUES ('Boutiques', 'boutiques', 7) ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id INTO v_cat_boutiques;
  INSERT INTO public.categories (name, slug, sort_order) VALUES ('Footwear', 'footwear', 8) ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id INTO v_cat_footwear;
  INSERT INTO public.categories (name, slug, sort_order) VALUES ('Jewellery & Watches', 'jewellery-watches', 9) ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id INTO v_cat_jewellery;
  INSERT INTO public.categories (name, slug, sort_order) VALUES ('Beauty & Care', 'beauty', 10) ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id INTO v_cat_beauty;
  INSERT INTO public.categories (name, slug, sort_order) VALUES ('Electronics', 'electronics', 11) ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id INTO v_cat_electronics;
  INSERT INTO public.categories (name, slug, sort_order) VALUES ('Mobile & Accessories', 'mobile-accessories', 12) ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id INTO v_cat_mobile;
  INSERT INTO public.categories (name, slug, sort_order) VALUES ('Auto & Bike', 'auto-bike', 13) ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id INTO v_cat_auto;
  INSERT INTO public.categories (name, slug, sort_order) VALUES ('Home & Kitchen', 'home-kitchen', 14) ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id INTO v_cat_home;
  INSERT INTO public.categories (name, slug, sort_order) VALUES ('Furniture & Home Decor', 'furniture-home-decor', 15) ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id INTO v_cat_furniture;
  INSERT INTO public.categories (name, slug, sort_order) VALUES ('Home & Hardware', 'hardware-electrical', 16) ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id INTO v_cat_hardware;
  INSERT INTO public.categories (name, slug, sort_order) VALUES ('Books & Stationery', 'books-stationery', 17) ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id INTO v_cat_books;
  INSERT INTO public.categories (name, slug, sort_order) VALUES ('Sports & Fitness', 'sports', 18) ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id INTO v_cat_sports;
  INSERT INTO public.categories (name, slug, sort_order) VALUES ('Toys & Baby', 'toys-baby', 19) ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id INTO v_cat_toys;
  INSERT INTO public.categories (name, slug, sort_order) VALUES ('Gift Shops', 'gift-shops', 20) ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id INTO v_cat_gifts;
  INSERT INTO public.categories (name, slug, sort_order) VALUES ('Flower Shops', 'flower-shops', 21) ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id INTO v_cat_flowers;
  INSERT INTO public.categories (name, slug, sort_order) VALUES ('Pet Shops', 'pet-shops', 22) ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id INTO v_cat_pets;
  INSERT INTO public.categories (name, slug, sort_order) VALUES ('Repair Shops', 'repair-shops', 23) ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id INTO v_cat_repair;
  INSERT INTO public.categories (name, slug, sort_order) VALUES ('Local Services', 'local-services', 24) ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id INTO v_cat_services;

  -- ==================== 1. UNIVERSAL FILTERS ====================
  INSERT INTO public.filter_definitions (key, label, type, is_universal, display_order)
  VALUES ('brand', 'Brand', 'multi_select', true, 1) ON CONFLICT (key, category_id, product_type_id) DO NOTHING;

  INSERT INTO public.filter_definitions (key, label, type, unit, is_universal, display_order)
  VALUES ('price', 'Price Range', 'range', '₹', true, 2) ON CONFLICT (key, category_id, product_type_id) DO NOTHING;

  INSERT INTO public.filter_definitions (key, label, type, is_universal, display_order)
  VALUES ('rating', 'Customer Rating', 'rating', true, 3) ON CONFLICT (key, category_id, product_type_id) DO NOTHING;

  INSERT INTO public.filter_definitions (key, label, type, is_universal, display_order)
  VALUES ('in_stock', 'In Stock Only', 'boolean', true, 4) ON CONFLICT (key, category_id, product_type_id) DO NOTHING;

  INSERT INTO public.filter_definitions (key, label, type, is_universal, display_order)
  VALUES ('on_sale', 'On Sale / Discounted', 'boolean', true, 5) ON CONFLICT (key, category_id, product_type_id) DO NOTHING;

  -- ==================== 2. FASHION & CLOTHING ====================
  INSERT INTO public.categories (name, slug, parent_id, sort_order)
  VALUES ('Men''s Clothing', 'mens-clothing', v_cat_fashion, 1)
  ON CONFLICT (slug) DO UPDATE SET parent_id = EXCLUDED.parent_id RETURNING id INTO v_sub;

  INSERT INTO public.categories (name, slug, parent_id, sort_order)
  VALUES ('T-Shirts', 't-shirts', v_sub, 1)
  ON CONFLICT (slug) DO UPDATE SET parent_id = EXCLUDED.parent_id RETURNING id INTO v_type;

  -- Fashion: Size Filter
  INSERT INTO public.filter_definitions (category_id, product_type_id, key, label, type, is_required, display_order)
  VALUES (v_cat_fashion, v_type, 'size', 'Size', 'multi_select', true, 10)
  ON CONFLICT (key, category_id, product_type_id) DO UPDATE SET label = EXCLUDED.label RETURNING id INTO v_fdef;

  INSERT INTO public.filter_options (filter_id, value, label, display_order) VALUES
    (v_fdef, 'XS', 'XS', 1), (v_fdef, 'S', 'S', 2), (v_fdef, 'M', 'M', 3),
    (v_fdef, 'L', 'L', 4), (v_fdef, 'XL', 'XL', 5), (v_fdef, 'XXL', 'XXL', 6), (v_fdef, 'XXXL', '3XL', 7)
  ON CONFLICT (filter_id, value) DO NOTHING;

  -- Fashion: Color Filter
  INSERT INTO public.filter_definitions (category_id, product_type_id, key, label, type, is_required, display_order)
  VALUES (v_cat_fashion, v_type, 'color', 'Color', 'color', true, 11)
  ON CONFLICT (key, category_id, product_type_id) DO UPDATE SET label = EXCLUDED.label RETURNING id INTO v_fdef;

  INSERT INTO public.filter_options (filter_id, value, label, display_order) VALUES
    (v_fdef, 'Black', 'Black', 1), (v_fdef, 'White', 'White', 2), (v_fdef, 'Blue', 'Navy Blue', 3),
    (v_fdef, 'Red', 'Red', 4), (v_fdef, 'Green', 'Olive Green', 5), (v_fdef, 'Yellow', 'Yellow', 6), (v_fdef, 'Grey', 'Grey', 7)
  ON CONFLICT (filter_id, value) DO NOTHING;

  -- Fashion: Fabric Filter
  INSERT INTO public.filter_definitions (category_id, product_type_id, key, label, type, display_order)
  VALUES (v_cat_fashion, v_type, 'fabric', 'Fabric', 'multi_select', 12)
  ON CONFLICT (key, category_id, product_type_id) DO UPDATE SET label = EXCLUDED.label RETURNING id INTO v_fdef;

  INSERT INTO public.filter_options (filter_id, value, label, display_order) VALUES
    (v_fdef, 'Cotton', 'Pure Cotton', 1), (v_fdef, 'Polyester', 'Polyester Blend', 2),
    (v_fdef, 'Linen', 'Linen', 3), (v_fdef, 'Denim', 'Denim', 4), (v_fdef, 'Silk', 'Silk', 5)
  ON CONFLICT (filter_id, value) DO NOTHING;

  -- Fashion: Fit Filter
  INSERT INTO public.filter_definitions (category_id, product_type_id, key, label, type, display_order)
  VALUES (v_cat_fashion, v_type, 'fit', 'Fit', 'single_select', 13)
  ON CONFLICT (key, category_id, product_type_id) DO UPDATE SET label = EXCLUDED.label RETURNING id INTO v_fdef;

  INSERT INTO public.filter_options (filter_id, value, label, display_order) VALUES
    (v_fdef, 'Regular', 'Regular Fit', 1), (v_fdef, 'Slim', 'Slim Fit', 2), (v_fdef, 'Oversized', 'Oversized Fit', 3)
  ON CONFLICT (filter_id, value) DO NOTHING;

  -- ==================== 3. MOBILE & ACCESSORIES ====================
  INSERT INTO public.categories (name, slug, parent_id, sort_order)
  VALUES ('Smartphones', 'smartphones', v_cat_mobile, 1)
  ON CONFLICT (slug) DO UPDATE SET parent_id = EXCLUDED.parent_id RETURNING id INTO v_type;

  -- Mobile: RAM Filter
  INSERT INTO public.filter_definitions (category_id, product_type_id, key, label, type, unit, display_order)
  VALUES (v_cat_mobile, v_type, 'ram', 'RAM', 'multi_select', 'GB', 10)
  ON CONFLICT (key, category_id, product_type_id) DO UPDATE SET label = EXCLUDED.label RETURNING id INTO v_fdef;

  INSERT INTO public.filter_options (filter_id, value, label, display_order) VALUES
    (v_fdef, '4GB', '4 GB', 1), (v_fdef, '6GB', '6 GB', 2), (v_fdef, '8GB', '8 GB', 3), (v_fdef, '12GB', '12 GB', 4), (v_fdef, '16GB', '16 GB', 5)
  ON CONFLICT (filter_id, value) DO NOTHING;

  -- Mobile: Storage Filter
  INSERT INTO public.filter_definitions (category_id, product_type_id, key, label, type, unit, display_order)
  VALUES (v_cat_mobile, v_type, 'storage', 'Internal Storage', 'multi_select', 'GB', 11)
  ON CONFLICT (key, category_id, product_type_id) DO UPDATE SET label = EXCLUDED.label RETURNING id INTO v_fdef;

  INSERT INTO public.filter_options (filter_id, value, label, display_order) VALUES
    (v_fdef, '64GB', '64 GB', 1), (v_fdef, '128GB', '128 GB', 2), (v_fdef, '256GB', '256 GB', 3), (v_fdef, '512GB', '512 GB', 4)
  ON CONFLICT (filter_id, value) DO NOTHING;

  -- Mobile: Network Filter
  INSERT INTO public.filter_definitions (category_id, product_type_id, key, label, type, display_order)
  VALUES (v_cat_mobile, v_type, 'network', 'Network Connectivity', 'single_select', 12)
  ON CONFLICT (key, category_id, product_type_id) DO UPDATE SET label = EXCLUDED.label RETURNING id INTO v_fdef;

  INSERT INTO public.filter_options (filter_id, value, label, display_order) VALUES
    (v_fdef, '5G', '5G Supported', 1), (v_fdef, '4G', '4G VoLTE', 2)
  ON CONFLICT (filter_id, value) DO NOTHING;

  -- ==================== 4. GROCERY ====================
  INSERT INTO public.categories (name, slug, parent_id, sort_order)
  VALUES ('Rice & Grains', 'rice-grains', v_cat_grocery, 1)
  ON CONFLICT (slug) DO UPDATE SET parent_id = EXCLUDED.parent_id RETURNING id INTO v_type;

  -- Grocery: Weight / Pack Size Filter
  INSERT INTO public.filter_definitions (category_id, product_type_id, key, label, type, display_order)
  VALUES (v_cat_grocery, v_type, 'pack_size', 'Pack Size / Weight', 'multi_select', 10)
  ON CONFLICT (key, category_id, product_type_id) DO UPDATE SET label = EXCLUDED.label RETURNING id INTO v_fdef;

  INSERT INTO public.filter_options (filter_id, value, label, display_order) VALUES
    (v_fdef, '500g', '500 g', 1), (v_fdef, '1kg', '1 kg', 2), (v_fdef, '5kg', '5 kg', 3), (v_fdef, '10kg', '10 kg', 4), (v_fdef, '25kg', '25 kg Bag', 5)
  ON CONFLICT (filter_id, value) DO NOTHING;

  -- Grocery: Organic Filter
  INSERT INTO public.filter_definitions (category_id, product_type_id, key, label, type, display_order)
  VALUES (v_cat_grocery, v_type, 'organic', 'Organic Product', 'boolean', 11)
  ON CONFLICT (key, category_id, product_type_id) DO UPDATE SET label = EXCLUDED.label RETURNING id INTO v_fdef;

  -- Grocery: Dietary Preference
  INSERT INTO public.filter_definitions (category_id, product_type_id, key, label, type, display_order)
  VALUES (v_cat_grocery, v_type, 'dietary', 'Dietary Preference', 'multi_select', 12)
  ON CONFLICT (key, category_id, product_type_id) DO UPDATE SET label = EXCLUDED.label RETURNING id INTO v_fdef;

  INSERT INTO public.filter_options (filter_id, value, label, display_order) VALUES
    (v_fdef, 'Vegetarian', 'Vegetarian', 1), (v_fdef, 'Vegan', 'Vegan', 2), (v_fdef, 'Gluten-Free', 'Gluten-Free', 3), (v_fdef, 'Sugar-Free', 'Sugar-Free', 4)
  ON CONFLICT (filter_id, value) DO NOTHING;

  -- ==================== 5. FOOD / RESTAURANTS ====================
  INSERT INTO public.filter_definitions (category_id, key, label, type, display_order)
  VALUES (v_cat_food, 'food_type', 'Dietary Type', 'single_select', 10)
  ON CONFLICT (key, category_id, product_type_id) DO UPDATE SET label = EXCLUDED.label RETURNING id INTO v_fdef;

  INSERT INTO public.filter_options (filter_id, value, label, display_order) VALUES
    (v_fdef, 'Veg', 'Pure Veg 🟢', 1), (v_fdef, 'Non-Veg', 'Non-Veg 🔴', 2), (v_fdef, 'Jain', 'Jain Special 🟡', 3)
  ON CONFLICT (filter_id, value) DO NOTHING;

  INSERT INTO public.filter_definitions (category_id, key, label, type, display_order)
  VALUES (v_cat_food, 'cuisine', 'Cuisine', 'multi_select', 11)
  ON CONFLICT (key, category_id, product_type_id) DO UPDATE SET label = EXCLUDED.label RETURNING id INTO v_fdef;

  INSERT INTO public.filter_options (filter_id, value, label, display_order) VALUES
    (v_fdef, 'South Indian', 'South Indian Tiffin & Meals', 1),
    (v_fdef, 'Chettinad', 'Chettinad Special', 2),
    (v_fdef, 'Biryani', 'Biryani Special', 3),
    (v_fdef, 'North Indian', 'North Indian', 4),
    (v_fdef, 'Chinese', 'Indo-Chinese', 5),
    (v_fdef, 'Fast Food', 'Burgers & Pizza', 6)
  ON CONFLICT (filter_id, value) DO NOTHING;

  -- ==================== 6. LOCAL SERVICES ====================
  INSERT INTO public.filter_definitions (category_id, key, label, type, display_order)
  VALUES (v_cat_services, 'service_mode', 'Service Mode', 'single_select', 10)
  ON CONFLICT (key, category_id, product_type_id) DO UPDATE SET label = EXCLUDED.label RETURNING id INTO v_fdef;

  INSERT INTO public.filter_options (filter_id, value, label, display_order) VALUES
    (v_fdef, 'On-Site', 'On-Site / Doorstep Service 🏠', 1),
    (v_fdef, 'Store Pickup', 'In-Store Service 🏪', 2),
    (v_fdef, 'Emergency', '24/7 Emergency Service ⚡', 3)
  ON CONFLICT (filter_id, value) DO NOTHING;

END $$;

-- 5. Core PostgreSQL Function: filter_marketplace_products
CREATE OR REPLACE FUNCTION public.filter_marketplace_products(
  p_category_slug text DEFAULT NULL,
  p_subcategory_slug text DEFAULT NULL,
  p_product_type_slug text DEFAULT NULL,
  p_query text DEFAULT NULL,
  p_min_price numeric DEFAULT NULL,
  p_max_price numeric DEFAULT NULL,
  p_min_rating numeric DEFAULT NULL,
  p_in_stock boolean DEFAULT NULL,
  p_on_sale boolean DEFAULT NULL,
  p_open_now boolean DEFAULT NULL,
  p_brand_names text[] DEFAULT NULL,
  p_shop_ids uuid[] DEFAULT NULL,
  p_attributes jsonb DEFAULT '{}'::jsonb,
  p_lat double precision DEFAULT NULL,
  p_lng double precision DEFAULT NULL,
  p_max_distance_km numeric DEFAULT NULL,
  p_sort_by text DEFAULT 'relevance',
  p_limit integer DEFAULT 24,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  seller_id uuid,
  name text,
  sku text,
  brand text,
  brand_id uuid,
  brand_name text,
  category text,
  category_id uuid,
  subcategory_id uuid,
  product_type_id uuid,
  description text,
  mrp numeric,
  selling_price numeric,
  discount_price numeric,
  stock integer,
  image_url text,
  images jsonb,
  weight text,
  attributes jsonb,
  shop_name text,
  distance_km numeric,
  rating numeric,
  review_count integer,
  is_open boolean,
  accepts_orders boolean,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_norm_query text := public.search_normalize_text(coalesce(p_query, ''));
  v_cat_id uuid;
  v_sub_id uuid;
  v_type_id uuid;
BEGIN
  -- Resolve Category UUIDs if slugs passed
  IF p_category_slug IS NOT NULL AND p_category_slug <> '' AND p_category_slug <> 'all' AND p_category_slug <> 'all-shops' THEN
    SELECT c.id INTO v_cat_id FROM public.categories c WHERE lower(c.slug) = lower(p_category_slug) OR lower(c.name) = lower(p_category_slug) LIMIT 1;
  END IF;

  IF p_subcategory_slug IS NOT NULL AND p_subcategory_slug <> '' THEN
    SELECT c.id INTO v_sub_id FROM public.categories c WHERE lower(c.slug) = lower(p_subcategory_slug) OR lower(c.name) = lower(p_subcategory_slug) LIMIT 1;
  END IF;

  IF p_product_type_slug IS NOT NULL AND p_product_type_slug <> '' THEN
    SELECT c.id INTO v_type_id FROM public.categories c WHERE lower(c.slug) = lower(p_product_type_slug) OR lower(c.name) = lower(p_product_type_slug) LIMIT 1;
  END IF;

  RETURN QUERY
  WITH filtered_base AS (
    SELECT
      p.id,
      p.seller_id,
      p.name,
      p.sku,
      p.brand,
      p.brand_id,
      COALESCE(NULLIF(b.name, ''), p.brand) AS brand_name,
      p.category,
      p.category_id,
      p.subcategory_id,
      p.product_type_id,
      p.description,
      p.mrp,
      p.selling_price,
      p.discount_price,
      p.stock,
      p.image_url,
      p.images,
      p.weight,
      COALESCE(NULLIF(p.attributes, '{}'::jsonb), p.specifications, '{}'::jsonb) AS attributes,
      COALESCE(NULLIF(s.business_name, ''), NULLIF(s.full_name, ''), s.email, 'Local vendor') AS shop_name,
      CASE
        WHEN s.lat IS NOT NULL AND s.lng IS NOT NULL AND p_lat IS NOT NULL AND p_lng IS NOT NULL
        THEN ROUND((ST_DistanceSphere(ST_MakePoint(s.lng, s.lat), ST_MakePoint(p_lng, p_lat)) / 1000)::numeric, 2)
        ELSE NULL
      END AS distance_km,
      COALESCE(pr.average_rating, 4.5)::numeric AS rating,
      COALESCE(pr.review_count, 12)::integer AS review_count,
      COALESCE((status_json->>'is_open')::boolean, true) AS is_open,
      COALESCE(s.accepts_orders, true) AS accepts_orders,
      p.created_at
    FROM public.products p
    JOIN public.sellers s ON s.id = p.seller_id AND s.status::text = 'approved'
    LEFT JOIN public.brands b ON b.id = p.brand_id
    LEFT JOIN LATERAL public.get_shop_status(s.id, now(), s.timezone) status_json ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(avg(r.rating), 0) average_rating, count(*)::integer review_count
      FROM public.reviews r WHERE r.product_id = p.id AND r.status = 'approved'
    ) pr ON true
    WHERE p.status::text IN ('active', 'approved')
      -- In-stock check
      AND (p_in_stock IS NOT TRUE OR p.stock > 0)
      -- Shop filter
      AND (p_shop_ids IS NULL OR cardinality(p_shop_ids) = 0 OR p.seller_id = ANY(p_shop_ids))
      -- Category hierarchy checks
      AND (v_cat_id IS NULL OR p.category_id = v_cat_id OR lower(p.category) LIKE '%' || lower(p_category_slug) || '%')
      AND (v_sub_id IS NULL OR p.subcategory_id = v_sub_id)
      AND (v_type_id IS NULL OR p.product_type_id = v_type_id)
      -- Price filter
      AND (p_min_price IS NULL OR COALESCE(p.discount_price, p.selling_price) >= p_min_price)
      AND (p_max_price IS NULL OR COALESCE(p.discount_price, p.selling_price) <= p_max_price)
      -- Rating filter
      AND (p_min_rating IS NULL OR COALESCE(pr.average_rating, 4.5) >= p_min_rating)
      -- Discount / On Sale filter
      AND (p_on_sale IS NOT TRUE OR (p.discount_price IS NOT NULL AND p.discount_price < p.selling_price))
      -- Shop Open filter
      AND (p_open_now IS NOT TRUE OR COALESCE((status_json->>'is_open')::boolean, true) = true)
      -- Brand filter
      AND (
        p_brand_names IS NULL OR cardinality(p_brand_names) = 0
        OR lower(coalesce(p.brand, b.name, '')) = ANY(SELECT lower(x) FROM unnest(p_brand_names) x)
      )
      -- Distance check
      AND (
        p_max_distance_km IS NULL
        OR (s.lat IS NOT NULL AND s.lng IS NOT NULL AND p_lat IS NOT NULL AND p_lng IS NOT NULL
            AND ST_DistanceSphere(ST_MakePoint(s.lng, s.lat), ST_MakePoint(p_lng, p_lat)) / 1000 <= p_max_distance_km)
      )
      -- Keyword query search
      AND (
        v_norm_query = ''
        OR public.search_normalize_text(concat_ws(' ', p.name, p.brand, b.name, p.category, p.description, s.business_name)) LIKE '%' || v_norm_query || '%'
      )
      -- Dynamic JSONB attributes matching: AND across keys, OR within key array
      AND (
        p_attributes IS NULL OR p_attributes = '{}'::jsonb
        OR NOT EXISTS (
          SELECT 1
          FROM jsonb_each(p_attributes) AS filter_entry(attr_key, attr_vals)
          WHERE jsonb_array_length(attr_vals) > 0
            AND NOT EXISTS (
              SELECT 1
              FROM jsonb_array_elements_text(attr_vals) AS target_val
              WHERE (
                jsonb_typeof(COALESCE(p.attributes -> attr_key, p.specifications -> attr_key)) = 'array'
                AND (COALESCE(p.attributes -> attr_key, p.specifications -> attr_key) ? target_val)
              )
              OR (
                lower(COALESCE(p.attributes ->> attr_key, p.specifications ->> attr_key, '')) = lower(target_val)
              )
            )
        )
      )
  ), counted AS (
    SELECT *, count(*) OVER () AS full_count FROM filtered_base
  )
  SELECT
    c.id, c.seller_id, c.name, c.sku, c.brand, c.brand_id, c.brand_name,
    c.category, c.category_id, c.subcategory_id, c.product_type_id,
    c.description, c.mrp, c.selling_price, c.discount_price, c.stock,
    c.image_url, c.images, c.weight, c.attributes, c.shop_name,
    c.distance_km, c.rating, c.review_count, c.is_open, c.accepts_orders,
    c.full_count
  FROM counted c
  ORDER BY
    CASE WHEN p_sort_by = 'price_asc' THEN COALESCE(c.discount_price, c.selling_price) END ASC,
    CASE WHEN p_sort_by = 'price_desc' THEN COALESCE(c.discount_price, c.selling_price) END DESC,
    CASE WHEN p_sort_by = 'rating_desc' THEN c.rating END DESC,
    CASE WHEN p_sort_by = 'newest' THEN c.created_at END DESC,
    CASE WHEN p_sort_by = 'discount_desc' THEN (c.mrp - COALESCE(c.discount_price, c.selling_price)) END DESC,
    CASE WHEN p_sort_by = 'distance_asc' THEN c.distance_km END ASC NULLS LAST,
    c.id ASC
  OFFSET GREATEST(p_offset, 0)
  LIMIT GREATEST(p_limit, 1);
END;
$$;

GRANT EXECUTE ON FUNCTION public.filter_marketplace_products TO anon, authenticated;

-- 6. Core PostgreSQL Function: get_marketplace_facets
CREATE OR REPLACE FUNCTION public.get_marketplace_facets(
  p_category_slug text DEFAULT NULL,
  p_subcategory_slug text DEFAULT NULL,
  p_product_type_slug text DEFAULT NULL,
  p_query text DEFAULT NULL,
  p_min_price numeric DEFAULT NULL,
  p_max_price numeric DEFAULT NULL,
  p_brand_names text[] DEFAULT NULL,
  p_attributes jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_norm_query text := public.search_normalize_text(coalesce(p_query, ''));
  v_cat_id uuid;
  v_min_p numeric := 0;
  v_max_p numeric := 0;
  v_total_prod bigint := 0;
  v_facets jsonb := '{}'::jsonb;
  v_brand_facets jsonb := '[]'::jsonb;
  v_attr_key text;
  v_attr_facets jsonb;
BEGIN
  IF p_category_slug IS NOT NULL AND p_category_slug <> '' AND p_category_slug <> 'all' AND p_category_slug <> 'all-shops' THEN
    SELECT c.id INTO v_cat_id FROM public.categories c WHERE lower(c.slug) = lower(p_category_slug) OR lower(c.name) = lower(p_category_slug) LIMIT 1;
  END IF;

  -- Create temporary result set of currently matching products
  CREATE TEMP TABLE temp_filtered_products ON COMMIT DROP AS
  SELECT
    p.id,
    COALESCE(NULLIF(b.name, ''), p.brand) AS brand_name,
    COALESCE(p.discount_price, p.selling_price) AS effective_price,
    COALESCE(NULLIF(p.attributes, '{}'::jsonb), p.specifications, '{}'::jsonb) AS attributes
  FROM public.products p
  JOIN public.sellers s ON s.id = p.seller_id AND s.status::text = 'approved'
  LEFT JOIN public.brands b ON b.id = p.brand_id
  WHERE p.status::text IN ('active', 'approved') AND p.stock > 0
    AND (v_cat_id IS NULL OR p.category_id = v_cat_id OR lower(p.category) LIKE '%' || lower(p_category_slug) || '%')
    AND (p_min_price IS NULL OR COALESCE(p.discount_price, p.selling_price) >= p_min_price)
    AND (p_max_price IS NULL OR COALESCE(p.discount_price, p.selling_price) <= p_max_price)
    AND (
      v_norm_query = ''
      OR public.search_normalize_text(concat_ws(' ', p.name, p.brand, b.name, p.category, p.description)) LIKE '%' || v_norm_query || '%'
    );

  -- Summary metrics
  SELECT COALESCE(MIN(effective_price), 0), COALESCE(MAX(effective_price), 10000), COUNT(*)
  INTO v_min_p, v_max_p, v_total_prod
  FROM temp_filtered_products;

  -- Brand facets
  SELECT jsonb_agg(jsonb_build_object('value', brand_name, 'label', brand_name, 'count', cnt))
  INTO v_brand_facets
  FROM (
    SELECT brand_name, COUNT(*) cnt
    FROM temp_filtered_products
    WHERE brand_name IS NOT NULL AND brand_name <> ''
    GROUP BY brand_name ORDER BY cnt DESC, brand_name ASC
  ) b_sub;

  -- Dynamic JSONB Attribute facets
  v_attr_facets := '{}'::jsonb;

  FOR v_attr_key IN
    SELECT DISTINCT key
    FROM public.filter_definitions fd
    WHERE (v_cat_id IS NULL OR fd.category_id = v_cat_id OR fd.is_universal = true)
      AND fd.is_active = true AND fd.type IN ('single_select', 'multi_select', 'color')
  LOOP
    WITH attr_counts AS (
      SELECT val, COUNT(*) cnt
      FROM (
        SELECT jsonb_array_elements_text(
          CASE
            WHEN jsonb_typeof(attributes -> v_attr_key) = 'array' THEN attributes -> v_attr_key
            WHEN attributes -> v_attr_key IS NOT NULL THEN jsonb_build_array(attributes ->> v_attr_key)
            ELSE '[]'::jsonb
          END
        ) AS val
        FROM temp_filtered_products
      ) sub
      WHERE val IS NOT NULL AND val <> ''
      GROUP BY val
    )
    SELECT jsonb_set(
      v_attr_facets,
      ARRAY[v_attr_key],
      COALESCE(
        (SELECT jsonb_agg(jsonb_build_object('value', val, 'label', val, 'count', cnt)) FROM attr_counts),
        '[]'::jsonb
      )
    ) INTO v_attr_facets;
  END LOOP;

  RETURN jsonb_build_object(
    'min_price', v_min_p,
    'max_price', v_max_p,
    'total_products', v_total_prod,
    'brand_facets', COALESCE(v_brand_facets, '[]'::jsonb),
    'attributes', v_attr_facets
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_marketplace_facets TO anon, authenticated;

-- 7. Core PostgreSQL Function: get_applicable_filters
CREATE OR REPLACE FUNCTION public.get_applicable_filters(
  p_category_slug text DEFAULT NULL,
  p_product_type_slug text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cat_id uuid;
  v_type_id uuid;
  v_result jsonb;
BEGIN
  IF p_category_slug IS NOT NULL AND p_category_slug <> '' AND p_category_slug <> 'all' AND p_category_slug <> 'all-shops' THEN
    SELECT c.id INTO v_cat_id FROM public.categories c WHERE lower(c.slug) = lower(p_category_slug) OR lower(c.name) = lower(p_category_slug) LIMIT 1;
  END IF;

  IF p_product_type_slug IS NOT NULL AND p_product_type_slug <> '' THEN
    SELECT c.id INTO v_type_id FROM public.categories c WHERE lower(c.slug) = lower(p_product_type_slug) OR lower(c.name) = lower(p_product_type_slug) LIMIT 1;
  END IF;

  WITH applicable_defs AS (
    SELECT DISTINCT ON (fd.key)
      fd.id,
      fd.key,
      fd.label,
      fd.type,
      fd.unit,
      fd.is_universal,
      fd.is_required,
      fd.display_order
    FROM public.filter_definitions fd
    WHERE fd.is_active = true
      AND (
        fd.is_universal = true
        OR (v_cat_id IS NOT NULL AND fd.category_id = v_cat_id)
        OR (v_type_id IS NOT NULL AND fd.product_type_id = v_type_id)
      )
    ORDER BY fd.key, (fd.product_type_id IS NOT NULL) DESC, (fd.category_id IS NOT NULL) DESC
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', ad.id,
      'key', ad.key,
      'label', ad.label,
      'type', ad.type,
      'unit', ad.unit,
      'is_universal', ad.is_universal,
      'is_required', ad.is_required,
      'display_order', ad.display_order,
      'options', COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object('id', fo.id, 'value', fo.value, 'label', fo.label, 'display_order', fo.display_order)
            ORDER BY fo.display_order ASC
          )
          FROM public.filter_options fo
          WHERE fo.filter_id = ad.id AND fo.is_active = true
        ),
        '[]'::jsonb
      )
    )
    ORDER BY ad.display_order ASC, ad.label ASC
  ) INTO v_result
  FROM applicable_defs ad;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_applicable_filters TO anon, authenticated;

-- 8. Idempotent Mock Catalog Seed for Marketplace Products
DO $$
DECLARE
  v_seller_id uuid;
BEGIN
  -- Ensure an approved mock seller exists
  INSERT INTO public.sellers (id, business_name, email, status, lat, lng)
  VALUES ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Trendz Fashion & Superstore', 'seller@localshore.com', 'approved', 11.0028, 77.0865)
  ON CONFLICT (id) DO UPDATE SET status = 'approved'
  RETURNING id INTO v_seller_id;

  IF v_seller_id IS NULL THEN
    v_seller_id := 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  END IF;

  -- Grant public read permissions on public.products table
  GRANT SELECT ON public.products TO anon, authenticated;

  -- Insert sample marketplace products
  INSERT INTO public.products (id, seller_id, name, sku, category, brand, description, mrp, selling_price, discount_price, stock, status, attributes, image_url)
  VALUES
    (
      'b1111111-1111-1111-1111-111111111111', v_seller_id, 'Men Oversized Cotton T-Shirt', 'TSHIRT-NIKE-01', 'Fashion & Clothing', 'Nike',
      'Premium heavy-weight 240 GSM pure cotton oversized crewneck t-shirt.', 1499, 799, 799, 25, 'approved',
      '{"color": ["Black", "Blue"], "size": ["M", "L", "XL"], "fabric": "Cotton", "fit": "Oversized"}'::jsonb,
      'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=600&q=75'
    ),
    (
      'b2222222-2222-2222-2222-222222222222', v_seller_id, 'Classic Solid Crewneck T-Shirt', 'TSHIRT-ADI-02', 'Fashion & Clothing', 'Adidas',
      'Breathable sports performance cotton t-shirt with classic stripes.', 1299, 699, 699, 18, 'approved',
      '{"color": ["White", "Black"], "size": ["S", "M", "L"], "fabric": "Cotton", "fit": "Regular"}'::jsonb,
      'https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?auto=format&fit=crop&w=600&q=75'
    ),
    (
      'b3333333-3333-3333-3333-333333333333', v_seller_id, 'Polo Collar Slim Fit T-Shirt', 'TSHIRT-PUMA-03', 'Fashion & Clothing', 'Puma',
      'Smart casual polo collar t-shirt with rib cuffs and button placket.', 1699, 899, 899, 30, 'approved',
      '{"color": ["Blue", "Red"], "size": ["M", "L", "XXL"], "fabric": "Polyester", "fit": "Slim"}'::jsonb,
      'https://images.unsplash.com/photo-1618354691373-d851c5c3a990?auto=format&fit=crop&w=600&q=75'
    ),
    (
      'b4444444-4444-4444-4444-444444444444', v_seller_id, 'Galaxy 5G Smartphone 128GB', 'PHONE-SAMSUNG-01', 'Mobile & Accessories', 'Samsung',
      '6.7 inch AMOLED 120Hz display with 50MP camera and 5000mAh battery.', 24999, 18999, 18999, 15, 'approved',
      '{"ram": "8GB", "storage": "128GB", "network": "5G"}'::jsonb,
      'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=600&q=75'
    ),
    (
      'b5555555-5555-5555-5555-555555555555', v_seller_id, 'Organic Sona Masoori Rice 5kg', 'RICE-ORGANIC-05', 'Grocery', 'Organic India',
      'Unpolished pesticide-free organic Sona Masoori raw rice.', 550, 450, 450, 50, 'approved',
      '{"pack_size": "5kg", "organic": true, "dietary": ["Vegetarian", "Vegan"]}'::jsonb,
      'https://images.unsplash.com/photo-1586201375761-83865001e31c?auto=format&fit=crop&w=600&q=75'
    )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    selling_price = EXCLUDED.selling_price,
    attributes = EXCLUDED.attributes,
    status = 'approved';
END $$;

NOTIFY pgrst, 'reload schema';
