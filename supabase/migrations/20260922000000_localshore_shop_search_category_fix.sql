-- Let nearby shop search match the shop's product category as well as its name,
-- while retaining the authoritative 5,000m PostGIS visibility predicate.
CREATE OR REPLACE FUNCTION public.get_customer_visible_shops(
  p_lat double precision, p_lng double precision, p_query text DEFAULT NULL,
  p_category_slug text DEFAULT NULL, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid, shop_name text, business_type text, city text, state text, address_line1 text,
  category text, lat double precision, lng double precision, distance_km double precision,
  zone_code text, zone_name text, is_open boolean, is_verified boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH customer AS (
    SELECT ST_SetSRID(ST_MakePoint(p_lng,p_lat),4326)::geography AS point
  ), located AS (
    SELECT s.*,
      COALESCE(NULLIF(s.business_name,''), NULLIF(s.full_name,''), s.email, 'Local vendor') AS display_name,
      ST_SetSRID(ST_MakePoint(s.lng,s.lat),4326)::geography AS shop_point
    FROM public.sellers s
    WHERE s.status::text IN ('approved','active')
      AND s.lat IS NOT NULL AND s.lng IS NOT NULL
      AND p_lat BETWEEN -90 AND 90 AND p_lng BETWEEN -180 AND 180
      AND EXISTS (
        SELECT 1 FROM public.products p
        WHERE p.seller_id=s.id AND p.status::text IN ('active','approved') AND p.stock > 0
      )
  )
  SELECT l.id, l.display_name, l.business_type, l.city, l.state, l.address_line1,
    COALESCE((SELECT NULLIF(p.category,'') FROM public.products p WHERE p.seller_id=l.id AND p.stock>0 ORDER BY p.created_at DESC LIMIT 1),'grocery'),
    l.lat, l.lng, ST_Distance(l.shop_point,c.point)/1000.0,
    z.zone_code, z.zone_name, true, l.status::text='approved'
  FROM located l CROSS JOIN customer c
  LEFT JOIN LATERAL (
    SELECT oz.zone_code, oz.zone_name
    FROM public.operational_zones oz
    WHERE oz.is_active AND ST_DWithin(oz.hub_location,l.shop_point,7000)
    ORDER BY oz.hub_location <-> l.shop_point LIMIT 1
  ) z ON true
  WHERE ST_DWithin(l.shop_point,c.point,5000)
    AND (
      NULLIF(trim(p_query),'') IS NULL
      OR l.display_name ILIKE '%'||trim(p_query)||'%'
      OR l.business_type ILIKE '%'||trim(p_query)||'%'
      OR l.city ILIKE '%'||trim(p_query)||'%'
      OR EXISTS (
        SELECT 1 FROM public.products qp
        WHERE qp.seller_id=l.id AND qp.stock > 0
          AND (
            qp.category ILIKE '%'||regexp_replace(trim(p_query),'\s+(stores?|shops?)\s*$','')||'%'
            OR EXISTS (
              SELECT 1 FROM regexp_split_to_table(lower(trim(p_query)), '\s+') token
              WHERE length(token) >= 3 AND lower(COALESCE(qp.category,'')) LIKE '%'||token||'%'
            )
          )
      )
    )
    AND (
      NULLIF(trim(p_category_slug),'') IS NULL
      OR EXISTS (SELECT 1 FROM public.products cp WHERE cp.seller_id=l.id AND cp.category ILIKE '%'||trim(p_category_slug)||'%')
    )
  ORDER BY ST_Distance(l.shop_point,c.point), l.display_name
  LIMIT LEAST(GREATEST(p_limit,1),100) OFFSET GREATEST(p_offset,0);
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_visible_shops(double precision,double precision,text,text,integer,integer) TO anon, authenticated;
