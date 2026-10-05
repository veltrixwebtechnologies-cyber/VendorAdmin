-- LocalShore nearby shop discovery: selectable radius with adjacent-zone fallback.
-- The existing get_customer_visible_shops RPC remains unchanged for older clients.
-- Distances are PostGIS geography distances in metres, returned in kilometres.

-- operational_zones is LocalShore's existing zone registry. Maintain the
-- nearest three same-city zone IDs there so fallback order is data-driven.
ALTER TABLE public.operational_zones
  ADD COLUMN IF NOT EXISTS nearby_zone_ids uuid[] NOT NULL DEFAULT '{}';

CREATE OR REPLACE FUNCTION public.refresh_operational_zone_neighbors()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE public.operational_zones AS origin
  SET nearby_zone_ids = COALESCE((
    SELECT array_agg(neighbor.id ORDER BY ST_Distance(origin.hub_location, neighbor.hub_location), neighbor.zone_code)
    FROM (
      SELECT candidate.id, candidate.zone_code, candidate.hub_location
      FROM public.operational_zones AS candidate
      WHERE candidate.id <> origin.id
        AND candidate.city = origin.city
        AND candidate.is_active
      ORDER BY candidate.hub_location <-> origin.hub_location, candidate.zone_code
      LIMIT 3
    ) AS neighbor
  ), '{}');
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS operational_zones_refresh_neighbors_insert_delete ON public.operational_zones;
CREATE TRIGGER operational_zones_refresh_neighbors_insert_delete
AFTER INSERT OR DELETE
ON public.operational_zones
FOR EACH ROW EXECUTE FUNCTION public.refresh_operational_zone_neighbors();

DROP TRIGGER IF EXISTS operational_zones_refresh_neighbors_update ON public.operational_zones;
CREATE TRIGGER operational_zones_refresh_neighbors_update
AFTER UPDATE OF city, hub_location, is_active
ON public.operational_zones
FOR EACH ROW EXECUTE FUNCTION public.refresh_operational_zone_neighbors();

-- Backfill the new relationship for existing zones.
UPDATE public.operational_zones AS origin
SET nearby_zone_ids = COALESCE((
  SELECT array_agg(neighbor.id ORDER BY ST_Distance(origin.hub_location, neighbor.hub_location), neighbor.zone_code)
  FROM (
    SELECT candidate.id, candidate.zone_code, candidate.hub_location
    FROM public.operational_zones AS candidate
    WHERE candidate.id <> origin.id
      AND candidate.city = origin.city
      AND candidate.is_active
    ORDER BY candidate.hub_location <-> origin.hub_location, candidate.zone_code
    LIMIT 3
  ) AS neighbor
), '{}');

CREATE OR REPLACE FUNCTION public.discover_nearby_shops(
  p_lat double precision,
  p_lng double precision,
  p_query text DEFAULT NULL,
  p_category_slug text DEFAULT NULL,
  p_radius_km double precision DEFAULT 7,
  p_min_results integer DEFAULT 3,
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid,
  shop_name text,
  business_type text,
  city text,
  state text,
  address_line1 text,
  category text,
  lat double precision,
  lng double precision,
  distance_km double precision,
  zone_code text,
  zone_name text,
  is_open boolean,
  is_verified boolean,
  accepts_orders boolean,
  is_fallback boolean,
  fallback_zone_name text,
  primary_zone_name text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH input AS (
    SELECT
      ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography AS customer_point,
      CASE COALESCE(p_radius_km, 7)
        WHEN 5 THEN 5000.0
        WHEN 10 THEN 10000.0
        ELSE 7000.0
      END AS radius_m,
      NULLIF(regexp_replace(lower(trim(COALESCE(p_category_slug, ''))), '[^a-z0-9]+', '_', 'g'), '') AS category_key,
      NULLIF(trim(p_query), '') AS query_text
    WHERE p_lat BETWEEN -90 AND 90 AND p_lng BETWEEN -180 AND 180
  ), primary_zone AS (
    SELECT z.id, z.city, z.zone_code, z.zone_name, z.hub_location, z.nearby_zone_ids
    FROM public.operational_zones z CROSS JOIN input i
    WHERE z.is_active
      AND ST_DWithin(z.hub_location, i.customer_point, 7000)
    ORDER BY z.hub_location <-> i.customer_point
    LIMIT 1
  ), adjacent_zones AS (
    -- Persisted adjacency retains nearest-zone priority from the zone table.
    SELECT adjacent.zone_code,
      neighbors.ordinality AS zone_order
    FROM primary_zone origin
    CROSS JOIN LATERAL unnest(origin.nearby_zone_ids) WITH ORDINALITY AS neighbors(zone_id, ordinality)
    JOIN public.operational_zones adjacent ON adjacent.id = neighbors.zone_id
    WHERE adjacent.is_active
  ), eligible_shops AS (
    SELECT
      s.id,
      COALESCE(NULLIF(s.business_name, ''), NULLIF(s.full_name, ''), s.email, 'Local shop') AS shop_name,
      s.business_type,
      s.city,
      s.state,
      s.address_line1,
      COALESCE(
        NULLIF(regexp_replace(lower(trim(COALESCE(s.business_type, ''))), '[^a-z0-9]+', '_', 'g'), ''),
        (SELECT p.category FROM public.products p
          WHERE p.seller_id = s.id AND p.status::text IN ('active', 'approved') AND p.stock > 0
          ORDER BY p.created_at DESC LIMIT 1),
        'general'
      ) AS category,
      s.lat,
      s.lng,
      ST_SetSRID(ST_MakePoint(s.lng, s.lat), 4326)::geography AS shop_point,
      s.status::text AS seller_status,
      COALESCE((status_info->>'is_open')::boolean, false) AS shop_is_open,
      COALESCE(s.accepts_orders, false) AS accepts_orders,
      nearest.zone_code,
      nearest.zone_name
    FROM public.sellers s
    CROSS JOIN input i
    LEFT JOIN LATERAL (
      SELECT z.zone_code, z.zone_name
      FROM public.operational_zones z
      WHERE z.is_active
      ORDER BY z.hub_location <-> ST_SetSRID(ST_MakePoint(s.lng, s.lat), 4326)::geography
      LIMIT 1
    ) nearest ON true
    LEFT JOIN LATERAL public.get_shop_status(s.id, now(), s.timezone) status_info ON true
    WHERE s.status::text IN ('approved', 'active')
      AND s.lat BETWEEN -90 AND 90 AND s.lng BETWEEN -180 AND 180
      AND EXISTS (
        SELECT 1 FROM public.products available
        WHERE available.seller_id = s.id
          AND available.status::text IN ('active', 'approved')
          AND available.stock > 0
      )
      AND (
        i.category_key IS NULL
        OR (
          (
            NULLIF(trim(COALESCE(s.business_type, '')), '') IS NULL
            OR regexp_replace(lower(trim(s.business_type)), '[^a-z0-9]+', '_', 'g') = i.category_key
          )
          AND EXISTS (
          SELECT 1 FROM public.products categorized
          WHERE categorized.seller_id = s.id
            AND categorized.status::text IN ('active', 'approved')
            AND categorized.stock > 0
            AND regexp_replace(lower(trim(COALESCE(categorized.category, ''))), '[^a-z0-9]+', '_', 'g') = i.category_key
          )
        )
      )
      AND (
        i.query_text IS NULL
        OR COALESCE(s.business_name, '') ILIKE '%' || i.query_text || '%'
        OR COALESCE(s.business_type, '') ILIKE '%' || i.query_text || '%'
        OR COALESCE(s.city, '') ILIKE '%' || i.query_text || '%'
        OR EXISTS (
          SELECT 1 FROM public.products queried
          WHERE queried.seller_id = s.id
            AND queried.status::text IN ('active', 'approved')
            AND queried.stock > 0
            AND (queried.name ILIKE '%' || i.query_text || '%' OR queried.category ILIKE '%' || i.query_text || '%')
        )
      )
  ), measured AS (
    SELECT e.*, ST_Distance(e.shop_point, i.customer_point) / 1000.0 AS distance_km
    FROM eligible_shops e CROSS JOIN input i
  ), primary_results AS (
    SELECT m.* FROM measured m CROSS JOIN input i
    WHERE m.distance_km <= i.radius_m / 1000.0
  ), primary_count AS (
    SELECT count(*)::integer AS total FROM primary_results
  ), fallback_ranked AS (
    SELECT m.*, ROW_NUMBER() OVER (ORDER BY az.zone_order, m.distance_km, m.shop_name) AS fallback_order
    FROM measured m
    CROSS JOIN input i
    CROSS JOIN primary_count pc
    JOIN adjacent_zones az ON az.zone_code = m.zone_code
    WHERE pc.total < GREATEST(COALESCE(p_min_results, 3), 1)
      AND m.distance_km > i.radius_m / 1000.0
  ), results AS (
    SELECT
      p.id, p.shop_name, p.business_type, p.city, p.state, p.address_line1,
      p.category, p.lat, p.lng, p.distance_km, p.zone_code, p.zone_name,
      p.shop_is_open AS is_open, p.seller_status = 'approved' AS is_verified,
      p.accepts_orders,
      false AS is_fallback, NULL::text AS fallback_zone_name
    FROM primary_results p
    UNION ALL
    SELECT
      f.id, f.shop_name, f.business_type, f.city, f.state, f.address_line1,
      f.category, f.lat, f.lng, f.distance_km, f.zone_code, f.zone_name,
      f.shop_is_open AS is_open, f.seller_status = 'approved' AS is_verified,
      f.accepts_orders,
      true AS is_fallback, f.zone_name AS fallback_zone_name
    FROM fallback_ranked f
    WHERE f.fallback_order <= LEAST(10, GREATEST(COALESCE(p_limit, 100), 1))
  )
  SELECT
    r.id, r.shop_name, r.business_type, r.city, r.state, r.address_line1,
    r.category, r.lat, r.lng, r.distance_km, r.zone_code, r.zone_name,
    r.is_open, r.is_verified, r.accepts_orders, r.is_fallback, r.fallback_zone_name,
    (SELECT origin.zone_name FROM primary_zone origin)
  FROM results r
  ORDER BY r.distance_km, r.shop_name
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 100)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

GRANT EXECUTE ON FUNCTION public.discover_nearby_shops(
  double precision, double precision, text, text, double precision, integer, integer, integer
) TO anon, authenticated;
