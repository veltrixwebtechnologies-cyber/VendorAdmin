-- PostGIS Spatial Indexing and Bounding-Box Discovery for Sellers
CREATE EXTENSION IF NOT EXISTS postgis;

-- Ensure lat and lng columns exist on sellers table for high-performance indexing
ALTER TABLE public.sellers
  ADD COLUMN IF NOT EXISTS lat double precision,
  ADD COLUMN IF NOT EXISTS lng double precision;

-- Create spatial index for fast geographical distance and viewport queries
CREATE INDEX IF NOT EXISTS sellers_lat_lng_idx ON public.sellers (lat, lng) WHERE lat IS NOT NULL AND lng IS NOT NULL;

-- Drop function and view dependencies cleanly to avoid Postgres 42P16 column structure conflict
DROP FUNCTION IF EXISTS public.get_shops_in_bounding_box(double precision, double precision, double precision, double precision);
DROP VIEW IF EXISTS public.approved_vendor_catalog CASCADE;

-- Update approved_vendor_catalog to preserve all storefront media columns and include coordinates
CREATE VIEW public.approved_vendor_catalog AS
SELECT
  s.id,
  COALESCE(NULLIF(s.business_name, ''), NULLIF(s.full_name, ''), s.email, 'Local vendor') AS shop_name,
  s.business_type,
  s.city,
  s.state,
  s.address_line1,
  COALESCE((
    SELECT NULLIF(p.category, '')
    FROM public.products p
    WHERE p.seller_id = s.id
    ORDER BY p.created_at DESC
    LIMIT 1
  ), 'grocery') AS category,
  logo.file_url AS shop_logo_path,
  banner.file_url AS shop_banner_path,
  COALESCE(s.lat, (s.wizard_data->>'lat')::double precision, 13.0827) AS lat,
  COALESCE(s.lng, (s.wizard_data->>'lng')::double precision, 80.2707) AS lng
FROM public.sellers s
LEFT JOIN LATERAL (
  SELECT d.file_url
  FROM public.seller_documents d
  WHERE d.seller_id = s.id AND d.doc_type = 'shopLogo'
  ORDER BY d.created_at DESC
  LIMIT 1
) logo ON true
LEFT JOIN LATERAL (
  SELECT d.file_url
  FROM public.seller_documents d
  WHERE d.seller_id = s.id AND d.doc_type = 'shopBanner'
  ORDER BY d.created_at DESC
  LIMIT 1
) banner ON true
WHERE s.status::text = 'approved';

GRANT SELECT ON public.approved_vendor_catalog TO anon, authenticated;

-- Function for bounding box shop discovery (Search this area)
CREATE FUNCTION public.get_shops_in_bounding_box(
  min_lat double precision,
  min_lng double precision,
  max_lat double precision,
  max_lng double precision
)
RETURNS TABLE (
  id uuid,
  shop_name text,
  business_type text,
  city text,
  state text,
  address_line1 text,
  category text,
  shop_logo_path text,
  shop_banner_path text,
  lat double precision,
  lng double precision
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT
    v.id, v.shop_name, v.business_type, v.city, v.state, v.address_line1, v.category, v.shop_logo_path, v.shop_banner_path, v.lat, v.lng
  FROM public.approved_vendor_catalog v
  WHERE v.lat BETWEEN min_lat AND max_lat
    AND v.lng BETWEEN min_lng AND max_lng;
$$;

GRANT EXECUTE ON FUNCTION public.get_shops_in_bounding_box(double precision, double precision, double precision, double precision) TO anon, authenticated;
