-- Unified marketplace search for LocalShore.
-- Adds search normalization, configurable synonyms, expression indexes, and a
-- single RPC that ranks products, shops, brands, and categories together.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE TABLE IF NOT EXISTS public.search_synonyms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_term text NOT NULL,
  synonym text NOT NULL,
  search_scope text NOT NULL DEFAULT 'all',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lower(canonical_term), lower(synonym), search_scope)
);

ALTER TABLE public.search_synonyms ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.search_synonyms TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.search_synonyms TO authenticated;

DROP POLICY IF EXISTS "Public reads active search synonyms" ON public.search_synonyms;
CREATE POLICY "Public reads active search synonyms"
  ON public.search_synonyms FOR SELECT
  USING (is_active);

DROP POLICY IF EXISTS "Admins manage search synonyms" ON public.search_synonyms;
CREATE POLICY "Admins manage search synonyms"
  ON public.search_synonyms FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE OR REPLACE FUNCTION public.search_normalize_text(input_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(
    regexp_replace(
      regexp_replace(
        lower(coalesce(input_text, '')),
        '[^a-z0-9]+',
        ' ',
        'g'
      ),
      '([a-z0-9])\1{1,}',
      '\1',
      'g'
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.search_apply_synonyms(input_text text)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_text text := ' ' || public.search_normalize_text(coalesce(input_text, '')) || ' ';
  v_row record;
BEGIN
  FOR v_row IN
    SELECT canonical_term, synonym
    FROM public.search_synonyms
    WHERE is_active
    ORDER BY length(synonym) DESC, length(canonical_term) DESC
  LOOP
    v_text := replace(
      v_text,
      ' ' || public.search_normalize_text(v_row.synonym) || ' ',
      ' ' || public.search_normalize_text(v_row.canonical_term) || ' '
    );
  END LOOP;

  RETURN trim(regexp_replace(v_text, '\s+', ' ', 'g'));
END;
$$;

CREATE OR REPLACE FUNCTION public.search_match_score(candidate_text text, query_text text)
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT
    CASE
      WHEN public.search_normalize_text(coalesce(query_text, '')) = '' THEN 0
      ELSE
        CASE
          WHEN public.search_normalize_text(coalesce(candidate_text, '')) = public.search_normalize_text(query_text) THEN 120
          WHEN public.search_normalize_text(coalesce(candidate_text, '')) LIKE public.search_normalize_text(query_text) || '%' THEN 95
          WHEN public.search_normalize_text(coalesce(candidate_text, '')) LIKE '%' || public.search_normalize_text(query_text) || '%' THEN 70
          ELSE 0
        END
        + similarity(
            public.search_normalize_text(coalesce(candidate_text, '')),
            public.search_normalize_text(query_text)
          ) * 45
    END;
$$;

CREATE INDEX IF NOT EXISTS products_search_trgm_idx
  ON public.products
  USING gin (
    public.search_normalize_text(
      concat_ws(
        ' ',
        coalesce(name, ''),
        coalesce(sku, ''),
        coalesce(brand, ''),
        coalesce(category, ''),
        coalesce(description, ''),
        coalesce(weight, ''),
        coalesce(specifications::text, '')
      )
    ) gin_trgm_ops
  );

CREATE INDEX IF NOT EXISTS products_search_fts_idx
  ON public.products
  USING gin (
    to_tsvector(
      'simple',
      public.search_normalize_text(
        concat_ws(
          ' ',
          coalesce(name, ''),
          coalesce(sku, ''),
          coalesce(brand, ''),
          coalesce(category, ''),
          coalesce(description, ''),
          coalesce(weight, ''),
          coalesce(specifications::text, '')
        )
      )
    )
  );

CREATE INDEX IF NOT EXISTS sellers_search_trgm_idx
  ON public.sellers
  USING gin (
    public.search_normalize_text(
      concat_ws(
        ' ',
        coalesce(business_name, ''),
        coalesce(full_name, ''),
        coalesce(business_type, ''),
        coalesce(city, ''),
        coalesce(state, ''),
        coalesce(address_line1, ''),
        coalesce(address_line2, ''),
        coalesce(pincode, '')
      )
    ) gin_trgm_ops
  );

CREATE INDEX IF NOT EXISTS sellers_search_fts_idx
  ON public.sellers
  USING gin (
    to_tsvector(
      'simple',
      public.search_normalize_text(
        concat_ws(
          ' ',
          coalesce(business_name, ''),
          coalesce(full_name, ''),
          coalesce(business_type, ''),
          coalesce(city, ''),
          coalesce(state, ''),
          coalesce(address_line1, ''),
          coalesce(address_line2, ''),
          coalesce(pincode, '')
        )
      )
    )
  );

CREATE INDEX IF NOT EXISTS brands_search_trgm_idx
  ON public.brands
  USING gin (
    public.search_normalize_text(concat_ws(' ', coalesce(name, ''), coalesce(slug, ''))) gin_trgm_ops
  );

CREATE INDEX IF NOT EXISTS categories_search_trgm_idx
  ON public.categories
  USING gin (
    public.search_normalize_text(concat_ws(' ', coalesce(name, ''), coalesce(slug, ''), coalesce(description, ''))) gin_trgm_ops
  );

INSERT INTO public.search_synonyms (canonical_term, synonym, search_scope)
VALUES
  ('t shirt', 'tshirt', 'all'),
  ('t shirt', 't-shirt', 'all'),
  ('t shirt', 't shirt', 'all'),
  ('mobile', 'phone', 'all'),
  ('mobile', 'smartphone', 'all'),
  ('mobile', 'moblie', 'all'),
  ('iphone', 'iphnoe', 'all'),
  ('samsung', 'samsng', 'all'),
  ('nike', 'nik', 'all'),
  ('shoes', 'footwear', 'all'),
  ('shoes', 'sneakers', 'all'),
  ('shoes', 'shooes', 'all'),
  ('refrigerator', 'fridge', 'all'),
  ('headphones', 'headfone', 'all')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.search_marketplace_catalog(
  p_query text,
  p_lat double precision DEFAULT NULL,
  p_lng double precision DEFAULT NULL,
  p_limit integer DEFAULT 8,
  p_offset integer DEFAULT 0,
  p_scope text DEFAULT 'all',
  p_shop_id uuid DEFAULT NULL,
  p_open_now boolean DEFAULT NULL,
  p_min_price numeric DEFAULT NULL,
  p_max_price numeric DEFAULT NULL,
  p_max_distance_km numeric DEFAULT NULL,
  p_city text DEFAULT NULL
)
RETURNS TABLE (
  result_kind text,
  result_id uuid,
  title text,
  subtitle text,
  description text,
  image_url text,
  url text,
  shop_id uuid,
  shop_name text,
  brand_id uuid,
  brand_name text,
  category_id uuid,
  category_name text,
  category_slug text,
  price numeric,
  discount_price numeric,
  stock integer,
  available_shop_count integer,
  distance_km numeric,
  rating numeric,
  review_count integer,
  is_open boolean,
  delivery_available boolean,
  match_score numeric,
  metadata jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_query text := public.search_apply_synonyms(coalesce(p_query, ''));
  v_norm_query text := public.search_normalize_text(v_query);
BEGIN
  IF v_norm_query = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH settings AS (
    SELECT v_norm_query AS normalized_query, websearch_to_tsquery('simple', v_norm_query) AS tsq
  ), product_base AS (
    SELECT p.id, p.seller_id, p.name, p.description, p.image_url, p.selling_price, p.discount_price,
      p.stock, p.brand_id, COALESCE(NULLIF(b.name, ''), p.brand) AS brand_name, p.category,
      COALESCE(NULLIF(s.business_name, ''), NULLIF(s.full_name, ''), s.email, 'Local shop') AS shop_name,
      s.business_type, s.lat, s.lng, s.timezone, COALESCE(s.accepts_orders, true) AS accepts_orders,
      COALESCE((status_json->>'is_open')::boolean, false) AS is_open,
      COALESCE(pr.average_rating, 0)::numeric AS rating, COALESCE(pr.review_count, 0)::integer AS review_count,
      CASE WHEN s.lat IS NOT NULL AND s.lng IS NOT NULL AND p_lat IS NOT NULL AND p_lng IS NOT NULL
        THEN ROUND((ST_DistanceSphere(ST_MakePoint(s.lng, s.lat), ST_MakePoint(p_lng, p_lat)) / 1000)::numeric, 2) END AS distance_km
    FROM public.public_merchandising_products p
    JOIN public.sellers s ON s.id = p.seller_id AND s.status::text = 'approved'
    LEFT JOIN public.brands b ON b.id = p.brand_id
    LEFT JOIN LATERAL public.get_shop_status(s.id, now(), s.timezone) status_json ON true
    LEFT JOIN LATERAL (SELECT COALESCE(avg(r.rating), 0) average_rating, count(*)::integer review_count FROM public.reviews r WHERE r.product_id = p.id AND r.status = 'approved') pr ON true
    CROSS JOIN settings
    WHERE p.stock > 0 AND p_scope IN ('all', 'products') AND (p_shop_id IS NULL OR p.seller_id = p_shop_id)
      AND (p_min_price IS NULL OR COALESCE(p.discount_price, p.selling_price) >= p_min_price)
      AND (p_max_price IS NULL OR COALESCE(p.discount_price, p.selling_price) <= p_max_price)
      AND (p_open_now IS NULL OR COALESCE((status_json->>'is_open')::boolean, false) = p_open_now)
      AND (p_city IS NULL OR lower(coalesce(s.city, '')) LIKE '%' || lower(p_city) || '%')
      AND (p_max_distance_km IS NULL OR (s.lat IS NOT NULL AND s.lng IS NOT NULL AND p_lat IS NOT NULL AND p_lng IS NOT NULL AND ST_DistanceSphere(ST_MakePoint(s.lng, s.lat), ST_MakePoint(p_lng, p_lat)) / 1000 <= p_max_distance_km)
      AND (to_tsvector('simple', public.search_normalize_text(concat_ws(' ', p.name, p.brand, b.name, p.category, p.description, s.business_name, s.business_type))) @@ settings.tsq OR similarity(public.search_normalize_text(concat_ws(' ', p.name, p.brand, b.name, p.category, s.business_name)), settings.normalized_query) > 0.08)
  ), product_ranked AS (
    SELECT pb.*, public.search_match_score(concat_ws(' ', pb.name, pb.brand_name, pb.category, pb.shop_name, pb.business_type), v_norm_query)
      + CASE WHEN public.search_normalize_text(pb.name) = v_norm_query THEN 55 ELSE 0 END
      + CASE WHEN pb.is_open THEN 12 ELSE -5 END + LEAST(12, pb.rating * 2) AS score,
      count(*) OVER (PARTITION BY public.search_normalize_text(concat_ws(' ', pb.name, pb.brand_name)))::integer AS shop_count,
      row_number() OVER (PARTITION BY public.search_normalize_text(concat_ws(' ', pb.name, pb.brand_name)) ORDER BY pb.distance_km ASC NULLS LAST, pb.selling_price ASC) AS rn
    FROM product_base pb
  ), product_results AS (
    SELECT 'product'::text kind, pr.id, pr.name title, pr.shop_name subtitle, pr.description, pr.image_url,
      '/product/' || pr.id::text url, pr.seller_id shop_id, pr.shop_name, pr.brand_id, pr.brand_name,
      NULL::uuid category_id, pr.category category_name, NULL::text category_slug, pr.selling_price price, pr.discount_price,
      pr.stock, pr.shop_count, pr.distance_km, pr.rating, pr.review_count, pr.is_open, pr.accepts_orders,
      pr.score, jsonb_build_object('search_kind','product','available_shop_count',pr.shop_count) metadata
    FROM product_ranked pr WHERE pr.rn = 1
  ), shop_results AS (
    SELECT 'shop'::text kind, s.id, COALESCE(NULLIF(s.business_name,''), NULLIF(s.full_name,''), s.email, 'Local shop') title,
      COALESCE(s.business_type, s.city, 'Local shop') subtitle, NULL::text description, NULL::text image_url,
      '/store/' || s.id::text url, s.id shop_id, COALESCE(NULLIF(s.business_name,''), NULLIF(s.full_name,''), s.email, 'Local shop') shop_name,
      NULL::uuid brand_id, NULL::text brand_name, NULL::uuid category_id, s.business_type category_name, NULL::text category_slug,
      NULL::numeric price, NULL::numeric discount_price, NULL::integer stock, COALESCE(pc.product_count,0)::integer shop_count,
      CASE WHEN s.lat IS NOT NULL AND s.lng IS NOT NULL AND p_lat IS NOT NULL AND p_lng IS NOT NULL THEN ROUND((ST_DistanceSphere(ST_MakePoint(s.lng,s.lat),ST_MakePoint(p_lng,p_lat))/1000)::numeric,2) END distance_km,
      0::numeric rating, 0::integer review_count, COALESCE((status_json->>'is_open')::boolean,false) is_open, COALESCE(s.accepts_orders,true) accepts_orders,
      public.search_match_score(concat_ws(' ',s.business_name,s.full_name,s.business_type,s.city,s.state,s.address_line1),v_norm_query) + CASE WHEN COALESCE((status_json->>'is_open')::boolean,false) THEN 10 ELSE -5 END score,
      jsonb_build_object('search_kind','shop','product_count',COALESCE(pc.product_count,0)) metadata
    FROM public.sellers s LEFT JOIN LATERAL public.get_shop_status(s.id,now(),s.timezone) status_json ON true
      LEFT JOIN LATERAL (SELECT count(*) product_count FROM public.public_merchandising_products p WHERE p.seller_id=s.id AND p.stock>0) pc ON true CROSS JOIN settings
    WHERE s.status::text='approved' AND p_scope IN ('all','shops') AND (p_shop_id IS NULL OR s.id=p_shop_id)
      AND (p_open_now IS NULL OR COALESCE((status_json->>'is_open')::boolean,false)=p_open_now)
      AND (p_city IS NULL OR lower(coalesce(s.city,'')) LIKE '%'||lower(p_city)||'%')
      AND (to_tsvector('simple',public.search_normalize_text(concat_ws(' ',s.business_name,s.full_name,s.business_type,s.city,s.state,s.address_line1))) @@ settings.tsq OR similarity(public.search_normalize_text(concat_ws(' ',s.business_name,s.full_name,s.business_type,s.city,s.state)),settings.normalized_query)>0.08)
  ), brand_results AS (
    SELECT 'brand'::text kind, b.id, b.name title, 'Brand'::text subtitle, NULL::text description, b.logo_url image_url, '/brand/'||b.id::text url,
      NULL::uuid shop_id, NULL::text shop_name, b.id brand_id, b.name brand_name, NULL::uuid category_id, NULL::text category_name, NULL::text category_slug,
      NULL::numeric price, NULL::numeric discount_price, NULL::integer stock, count(p.id)::integer shop_count, NULL::numeric distance_km, NULL::numeric rating, NULL::integer review_count, NULL::boolean is_open, NULL::boolean accepts_orders,
      public.search_match_score(concat_ws(' ',b.name,b.slug),v_norm_query)+CASE WHEN public.search_normalize_text(b.name)=v_norm_query THEN 75 ELSE 0 END score,
      jsonb_build_object('search_kind','brand','product_count',count(p.id)) metadata
    FROM public.brands b LEFT JOIN public.products p ON p.brand_id=b.id AND p.stock>0 CROSS JOIN settings
    WHERE b.is_active AND p_scope IN ('all','brands') AND (to_tsvector('simple',public.search_normalize_text(concat_ws(' ',b.name,b.slug))) @@ settings.tsq OR similarity(public.search_normalize_text(concat_ws(' ',b.name,b.slug)),settings.normalized_query)>0.08)
    GROUP BY b.id,b.name,b.slug,b.logo_url
  ), category_results AS (
    SELECT 'category'::text kind, c.id, c.name title, 'Category'::text subtitle, c.description, c.image_url, '/search?q='||replace(c.name,' ','+') url,
      NULL::uuid shop_id, NULL::text shop_name, NULL::uuid brand_id, NULL::text brand_name, c.id category_id, c.name category_name, c.slug category_slug,
      NULL::numeric price, NULL::numeric discount_price, NULL::integer stock, count(p.id)::integer shop_count, NULL::numeric distance_km, NULL::numeric rating, NULL::integer review_count, NULL::boolean is_open, NULL::boolean accepts_orders,
      public.search_match_score(concat_ws(' ',c.name,c.slug,c.description),v_norm_query)+CASE WHEN public.search_normalize_text(c.name)=v_norm_query THEN 65 ELSE 0 END score,
      jsonb_build_object('search_kind','category','product_count',count(p.id)) metadata
    FROM public.categories c LEFT JOIN public.products p ON public.search_normalize_text(coalesce(p.category,'')) IN (public.search_normalize_text(c.name),public.search_normalize_text(c.slug)) CROSS JOIN settings
    WHERE c.is_active AND p_scope IN ('all','categories') AND (to_tsvector('simple',public.search_normalize_text(concat_ws(' ',c.name,c.slug,c.description))) @@ settings.tsq OR similarity(public.search_normalize_text(concat_ws(' ',c.name,c.slug,c.description)),settings.normalized_query)>0.08)
    GROUP BY c.id,c.name,c.slug,c.description,c.image_url
  ), combined AS (SELECT * FROM product_results UNION ALL SELECT * FROM shop_results UNION ALL SELECT * FROM brand_results UNION ALL SELECT * FROM category_results)
  SELECT kind, id, title, subtitle, description, image_url, url, shop_id, shop_name, brand_id, brand_name, category_id, category_name, category_slug, price, discount_price, stock, shop_count, distance_km, rating, review_count, is_open, accepts_orders, score, metadata
  FROM combined
  ORDER BY
    score DESC,
    CASE kind
      WHEN 'product' THEN 1
      WHEN 'shop' THEN 2
      WHEN 'brand' THEN 3
      ELSE 4
    END,
    distance_km ASC NULLS LAST,
    title ASC
  OFFSET GREATEST(p_offset, 0)
  LIMIT GREATEST(p_limit, 1);
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_marketplace_catalog(
  text,
  double precision,
  double precision,
  integer,
  integer,
  text,
  uuid,
  boolean,
  numeric,
  numeric,
  numeric,
  text
) TO anon, authenticated;
