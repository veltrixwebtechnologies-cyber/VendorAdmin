-- LocalShore Slikk-Style Category-Aware Dynamic Filter System Migration
-- Migration ID: 20260911140000_slikk_category_aware_filters.sql

-- 1. Ensure Indexing & Indexes for Fast Facet & Filter Evaluation
CREATE INDEX IF NOT EXISTS idx_products_attributes_gin ON public.products USING gin (attributes);
CREATE INDEX IF NOT EXISTS idx_products_status_stock ON public.products (status, stock);
CREATE INDEX IF NOT EXISTS idx_sellers_lat_lng_status ON public.sellers (status, lat, lng);

-- Dynamic cleanup of all existing overloaded function signatures to prevent Postgres 42725 error
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN 
    SELECT oid::regprocedure AS func_signature 
    FROM pg_proc 
    WHERE proname IN ('get_applicable_filters', 'get_marketplace_facets', 'filter_marketplace_products')
      AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.func_signature || ' CASCADE';
  END LOOP;
END $$;

-- 2. Enhanced PostgreSQL Function: get_applicable_filters
CREATE OR REPLACE FUNCTION public.get_applicable_filters(
  p_category_slug text DEFAULT NULL,
  p_subcategory_slug text DEFAULT NULL,
  p_product_type_slug text DEFAULT NULL,
  p_query text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cat_id uuid;
  v_sub_id uuid;
  v_type_id uuid;
  v_query_cat_slug text := NULL;
  v_result jsonb;
BEGIN
  -- Resolve Explicit Category Slugs
  IF p_category_slug IS NOT NULL AND p_category_slug <> '' AND p_category_slug <> 'all' AND p_category_slug <> 'all-shops' THEN
    SELECT c.id INTO v_cat_id FROM public.categories c WHERE lower(c.slug) = lower(p_category_slug) OR lower(c.name) = lower(p_category_slug) LIMIT 1;
  END IF;

  IF p_subcategory_slug IS NOT NULL AND p_subcategory_slug <> '' THEN
    SELECT c.id INTO v_sub_id FROM public.categories c WHERE lower(c.slug) = lower(p_subcategory_slug) OR lower(c.name) = lower(p_subcategory_slug) LIMIT 1;
  END IF;

  IF p_product_type_slug IS NOT NULL AND p_product_type_slug <> '' THEN
    SELECT c.id INTO v_type_id FROM public.categories c WHERE lower(c.slug) = lower(p_product_type_slug) OR lower(c.name) = lower(p_product_type_slug) LIMIT 1;
  END IF;

  -- Fallback Search Intent Intent Resolution when Category is omitted
  IF v_cat_id IS NULL AND p_query IS NOT NULL AND trim(p_query) <> '' THEN
    IF lower(p_query) ~ 'jean|denim|tshirt|shirt|pant|saree|kurti|dress|shoe|sneaker|wear|clothing|boutique' THEN
      v_query_cat_slug := 'fashion';
    ELSIF lower(p_query) ~ 'phone|mobile|smartphone|galaxy|iphone|redmi|oneplus|realme|ram|storage|5g|earbud' THEN
      v_query_cat_slug := 'mobile-accessories';
    ELSIF lower(p_query) ~ 'rice|dal|oil|atta|sugar|salt|grocery|masala' THEN
      v_query_cat_slug := 'grocery';
    ELSIF lower(p_query) ~ 'biryani|chicken|mutton|paneer|dosa|idli|restaurant|food|burger|pizza' THEN
      v_query_cat_slug := 'food-restaurants';
    ELSIF lower(p_query) ~ 'cake|sweet|puffs|mysurpa|bakery|bread' THEN
      v_query_cat_slug := 'bakery';
    ELSIF lower(p_query) ~ 'cream|serum|lotion|oil|shampoo|soap|face|beauty|skincare' THEN
      v_query_cat_slug := 'beauty';
    END IF;

    IF v_query_cat_slug IS NOT NULL THEN
      SELECT c.id INTO v_cat_id FROM public.categories c WHERE lower(c.slug) = lower(v_query_cat_slug) LIMIT 1;
    END IF;
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
    ORDER BY fd.key, (fd.product_type_id IS NOT NULL) DESC, (fd.category_id IS NOT NULL) DESC, fd.display_order ASC
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
            ORDER BY fo.display_order ASC, fo.label ASC
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

-- 3. Enhanced PostgreSQL Function: get_marketplace_facets
CREATE OR REPLACE FUNCTION public.get_marketplace_facets(
  p_category_slug text DEFAULT NULL,
  p_subcategory_slug text DEFAULT NULL,
  p_product_type_slug text DEFAULT NULL,
  p_query text DEFAULT NULL,
  p_min_price numeric DEFAULT NULL,
  p_max_price numeric DEFAULT NULL,
  p_brand_names text[] DEFAULT NULL,
  p_attributes jsonb DEFAULT '{}'::jsonb,
  p_lat double precision DEFAULT NULL,
  p_lng double precision DEFAULT NULL,
  p_max_distance_km numeric DEFAULT NULL
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
  v_brand_facets jsonb := '[]'::jsonb;
  v_shop_facets jsonb := '[]'::jsonb;
  v_attr_facets jsonb := '{}'::jsonb;
  v_attr_key text;
BEGIN
  IF p_category_slug IS NOT NULL AND p_category_slug <> '' AND p_category_slug <> 'all' AND p_category_slug <> 'all-shops' THEN
    SELECT c.id INTO v_cat_id FROM public.categories c WHERE lower(c.slug) = lower(p_category_slug) OR lower(c.name) = lower(p_category_slug) LIMIT 1;
  END IF;

  -- Create temporary table of currently matching products
  CREATE TEMP TABLE temp_filtered_products ON COMMIT DROP AS
  SELECT
    p.id,
    p.seller_id,
    COALESCE(NULLIF(b.name, ''), p.brand) AS brand_name,
    COALESCE(NULLIF(s.business_name, ''), NULLIF(s.full_name, ''), s.email, 'Local Shop') AS shop_name,
    CASE
      WHEN s.lat IS NOT NULL AND s.lng IS NOT NULL AND p_lat IS NOT NULL AND p_lng IS NOT NULL
      THEN ROUND((ST_DistanceSphere(ST_MakePoint(s.lng, s.lat), ST_MakePoint(p_lng, p_lat)) / 1000)::numeric, 2)
      ELSE 1.2
    END AS distance_km,
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
      p_brand_names IS NULL OR cardinality(p_brand_names) = 0
      OR lower(COALESCE(p.brand, b.name, '')) = ANY(SELECT lower(x) FROM unnest(p_brand_names) x)
    )
    AND (
      p_max_distance_km IS NULL
      OR (s.lat IS NOT NULL AND s.lng IS NOT NULL AND p_lat IS NOT NULL AND p_lng IS NOT NULL
          AND ST_DistanceSphere(ST_MakePoint(s.lng, s.lat), ST_MakePoint(p_lng, p_lat)) / 1000 <= p_max_distance_km)
    )
    AND (
      v_norm_query = ''
      OR public.search_normalize_text(concat_ws(' ', p.name, p.brand, b.name, p.category, p.description, s.business_name)) LIKE '%' || v_norm_query || '%'
    );

  -- 1. Summary Metrics
  SELECT COALESCE(MIN(effective_price), 0), COALESCE(MAX(effective_price), 10000), COUNT(*)
  INTO v_min_p, v_max_p, v_total_prod
  FROM temp_filtered_products;

  -- 2. Brand Facets with Counts
  SELECT jsonb_agg(jsonb_build_object('value', brand_name, 'label', brand_name, 'count', cnt))
  INTO v_brand_facets
  FROM (
    SELECT brand_name, COUNT(*) cnt
    FROM temp_filtered_products
    WHERE brand_name IS NOT NULL AND brand_name <> ''
    GROUP BY brand_name ORDER BY cnt DESC, brand_name ASC
  ) b_sub;

  -- 3. Shop Facets with Distance & Item Count
  SELECT jsonb_agg(jsonb_build_object(
    'id', seller_id,
    'name', shop_name,
    'distance_km', MIN(distance_km),
    'count', cnt
  ))
  INTO v_shop_facets
  FROM (
    SELECT seller_id, shop_name, MIN(distance_km) AS distance_km, COUNT(*) cnt
    FROM temp_filtered_products
    GROUP BY seller_id, shop_name ORDER BY cnt DESC
  ) s_sub;

  -- 4. Dynamic JSONB Attribute Facets
  FOR v_attr_key IN
    SELECT DISTINCT key
    FROM public.filter_definitions fd
    WHERE (v_cat_id IS NULL OR fd.category_id = v_cat_id OR fd.is_universal = true)
      AND fd.is_active = true
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
    'shop_facets', COALESCE(v_shop_facets, '[]'::jsonb),
    'attributes', v_attr_facets
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_marketplace_facets TO anon, authenticated;

-- 4. Additional Filter Definitions for All Categories
DO $$
DECLARE
  v_cat_fashion uuid;
  v_cat_mobile uuid;
  v_cat_beauty uuid;
  v_cat_grocery uuid;
  v_fdef uuid;
BEGIN
  SELECT id INTO v_cat_fashion FROM public.categories WHERE slug = 'fashion' LIMIT 1;
  SELECT id INTO v_cat_mobile FROM public.categories WHERE slug = 'mobile-accessories' LIMIT 1;
  SELECT id INTO v_cat_beauty FROM public.categories WHERE slug = 'beauty' LIMIT 1;
  SELECT id INTO v_cat_grocery FROM public.categories WHERE slug = 'grocery' LIMIT 1;

  -- Fashion: Fit Definitions
  IF v_cat_fashion IS NOT NULL THEN
    INSERT INTO public.filter_definitions (category_id, key, label, type, display_order)
    VALUES (v_cat_fashion, 'fit', 'Fit Type', 'single_select', 15)
    ON CONFLICT (key, category_id, product_type_id) DO UPDATE SET label = EXCLUDED.label RETURNING id INTO v_fdef;

    INSERT INTO public.filter_options (filter_id, value, label, display_order) VALUES
      (v_fdef, 'Slim', 'Slim Fit', 1),
      (v_fdef, 'Regular', 'Regular Fit', 2),
      (v_fdef, 'Relaxed', 'Relaxed Fit', 3),
      (v_fdef, 'Baggy', 'Baggy Fit', 4),
      (v_fdef, 'Oversized', 'Oversized Fit', 5)
    ON CONFLICT (filter_id, value) DO NOTHING;

    INSERT INTO public.filter_definitions (category_id, key, label, type, display_order)
    VALUES (v_cat_fashion, 'color', 'Color', 'color', 16)
    ON CONFLICT (key, category_id, product_type_id) DO UPDATE SET label = EXCLUDED.label RETURNING id INTO v_fdef;

    INSERT INTO public.filter_options (filter_id, value, label, display_order) VALUES
      (v_fdef, 'Black', 'Black', 1),
      (v_fdef, 'White', 'White', 2),
      (v_fdef, 'Grey', 'Grey', 3),
      (v_fdef, 'Blue', 'Blue', 4),
      (v_fdef, 'Red', 'Red', 5),
      (v_fdef, 'Green', 'Green', 6),
      (v_fdef, 'Gold', 'Gold', 7)
    ON CONFLICT (filter_id, value) DO NOTHING;
  END IF;

  -- Mobile: 5G & RAM Definitions
  IF v_cat_mobile IS NOT NULL THEN
    INSERT INTO public.filter_definitions (category_id, key, label, type, unit, display_order)
    VALUES (v_cat_mobile, 'ram', 'RAM Memory', 'multi_select', 'GB', 15)
    ON CONFLICT (key, category_id, product_type_id) DO UPDATE SET label = EXCLUDED.label RETURNING id INTO v_fdef;

    INSERT INTO public.filter_options (filter_id, value, label, display_order) VALUES
      (v_fdef, '4GB', '4 GB', 1), (v_fdef, '6GB', '6 GB', 2), (v_fdef, '8GB', '8 GB', 3), (v_fdef, '12GB', '12 GB', 4)
    ON CONFLICT (filter_id, value) DO NOTHING;

    INSERT INTO public.filter_definitions (category_id, key, label, type, unit, display_order)
    VALUES (v_cat_mobile, 'storage', 'Internal Storage', 'multi_select', 'GB', 16)
    ON CONFLICT (key, category_id, product_type_id) DO UPDATE SET label = EXCLUDED.label RETURNING id INTO v_fdef;

    INSERT INTO public.filter_options (filter_id, value, label, display_order) VALUES
      (v_fdef, '64GB', '64 GB', 1), (v_fdef, '128GB', '128 GB', 2), (v_fdef, '256GB', '256 GB', 3), (v_fdef, '512GB', '512 GB', 4)
    ON CONFLICT (filter_id, value) DO NOTHING;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
