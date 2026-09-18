-- ============================================================================
-- LocalShore Faceted Search & Local Discovery RPC Migration
-- Creates search_localshore_products RPC and optimized GIN/B-tree indexes
-- ============================================================================

-- 1. Optimized Expression & Composite Indexes on Products and Sellers
CREATE INDEX IF NOT EXISTS idx_products_category ON public.products(category);
CREATE INDEX IF NOT EXISTS idx_products_price ON public.products(selling_price);
CREATE INDEX IF NOT EXISTS idx_products_brand ON public.products(brand);
CREATE INDEX IF NOT EXISTS idx_products_attributes_gin ON public.products USING GIN (attributes);
CREATE INDEX IF NOT EXISTS idx_products_seller_id ON public.products(seller_id);

-- 2. LocalShore Search & Dynamic Faceting RPC
CREATE OR REPLACE FUNCTION public.search_localshore_products(
  p_search_query TEXT DEFAULT NULL,
  p_category TEXT DEFAULT NULL,
  p_subcategory TEXT DEFAULT NULL,
  p_product_type TEXT DEFAULT NULL,
  p_min_price NUMERIC DEFAULT NULL,
  p_max_price NUMERIC DEFAULT NULL,
  p_min_rating NUMERIC DEFAULT NULL,
  p_max_distance_km NUMERIC DEFAULT NULL,
  p_user_lat NUMERIC DEFAULT NULL,
  p_user_lng NUMERIC DEFAULT NULL,
  p_open_now BOOLEAN DEFAULT FALSE,
  p_in_stock BOOLEAN DEFAULT FALSE,
  p_verified_shop_only BOOLEAN DEFAULT FALSE,
  p_local_favorite_only BOOLEAN DEFAULT FALSE,
  p_attribute_filters JSONB DEFAULT '{}'::jsonb,
  p_sort_by TEXT DEFAULT 'relevance',
  p_page INT DEFAULT 1,
  p_page_size INT DEFAULT 20
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_offset INT;
  v_total INT;
  v_products_json JSONB;
  v_facets_json JSONB;
BEGIN
  v_offset := GREATEST(0, (p_page - 1) * p_page_size);

  -- Temporary table of candidate product & shop records with computed spatial distance
  CREATE TEMP TABLE temp_filtered_products ON COMMIT DROP AS
  SELECT 
    p.id AS product_id,
    p.seller_id,
    p.name AS product_name,
    p.brand,
    p.category,
    p.selling_price,
    p.mrp,
    p.stock,
    p.image_url,
    p.attributes,
    s.shop_name,
    s.rating AS shop_rating,
    s.is_open,
    s.is_verified,
    s.is_favorite,
    s.latitude,
    s.longitude,
    (
      CASE 
        WHEN p_user_lat IS NOT NULL AND p_user_lng IS NOT NULL AND s.latitude IS NOT NULL AND s.longitude IS NOT NULL THEN
          6371 * acos(
            LEAST(1.0, GREATEST(-1.0,
              cos(radians(p_user_lat)) * cos(radians(s.latitude)) *
              cos(radians(s.longitude) - radians(p_user_lng)) +
              sin(radians(p_user_lat)) * sin(radians(s.latitude))
            ))
          )
        ELSE NULL
      END
    ) AS distance_km
  FROM public.products p
  JOIN public.sellers s ON s.id = p.seller_id
  WHERE
    (p_search_query IS NULL OR p_search_query = '' OR (
      p.name ILIKE '%' || p_search_query || '%' OR
      p.category ILIKE '%' || p_search_query || '%' OR
      p.brand ILIKE '%' || p_search_query || '%' OR
      s.shop_name ILIKE '%' || p_search_query || '%'
    ))
    AND (p_category IS NULL OR p_category = 'all' OR p.category ILIKE '%' || p_category || '%')
    AND (p_min_price IS NULL OR p.selling_price >= p_min_price)
    AND (p_max_price IS NULL OR p.selling_price <= p_max_price)
    AND (p_min_rating IS NULL OR s.rating >= p_min_rating)
    AND (NOT p_open_now OR s.is_open = TRUE)
    AND (NOT p_in_stock OR p.stock > 0)
    AND (NOT p_verified_shop_only OR s.is_verified = TRUE)
    AND (NOT p_local_favorite_only OR s.is_favorite = TRUE)
    AND (
      p_user_lat IS NULL OR p_user_lng IS NULL OR p_max_distance_km IS NULL OR
      (
        6371 * acos(
          LEAST(1.0, GREATEST(-1.0,
            cos(radians(p_user_lat)) * cos(radians(s.latitude)) *
            cos(radians(s.longitude) - radians(p_user_lng)) +
            sin(radians(p_user_lat)) * sin(radians(s.latitude))
          ))
        ) <= p_max_distance_km
      )
    );

  -- Count total candidate matches
  SELECT COUNT(*) INTO v_total FROM temp_filtered_products;

  -- Build paginated product results
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_products_json
  FROM (
    SELECT * FROM temp_filtered_products
    ORDER BY
      CASE WHEN p_sort_by = 'price_asc' THEN selling_price END ASC,
      CASE WHEN p_sort_by = 'price_desc' THEN selling_price END DESC,
      CASE WHEN p_sort_by = 'rating_desc' THEN shop_rating END DESC,
      CASE WHEN p_sort_by = 'distance_asc' THEN distance_km END ASC NULLS LAST,
      product_name ASC
    LIMIT p_page_size OFFSET v_offset
  ) t;

  -- Build aggregated facet summaries
  SELECT jsonb_build_object(
    'min_price', COALESCE(MIN(selling_price), 0),
    'max_price', COALESCE(MAX(selling_price), 10000),
    'total_count', v_total
  ) INTO v_facets_json
  FROM temp_filtered_products;

  RETURN jsonb_build_object(
    'products', v_products_json,
    'total', v_total,
    'facets', v_facets_json,
    'page', p_page,
    'page_size', p_page_size
  );
END;
$$;
