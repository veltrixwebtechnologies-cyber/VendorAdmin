-- LocalShore operational zones and strict customer visibility.
-- Zones are planning metadata only. Customer visibility is always <= 5,000m.
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS public.operational_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_code text NOT NULL UNIQUE,
  city text NOT NULL,
  zone_name text NOT NULL,
  hub_name text NOT NULL,
  planning_radius_m integer NOT NULL DEFAULT 7000 CHECK (planning_radius_m = 7000),
  visibility_radius_m integer NOT NULL DEFAULT 5000 CHECK (visibility_radius_m = 5000),
  hub_lat double precision NOT NULL CHECK (hub_lat BETWEEN -90 AND 90),
  hub_lng double precision NOT NULL CHECK (hub_lng BETWEEN -180 AND 180),
  focus_areas text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  hub_location geography(Point, 4326) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS operational_zones_location_gix
  ON public.operational_zones USING gist (hub_location);

INSERT INTO public.operational_zones
  (zone_code, city, zone_name, hub_name, hub_lat, hub_lng, focus_areas, hub_location)
VALUES
  ('CBE-01','Coimbatore','Gandhipuram','Gandhipuram',11.0183,76.9725,ARRAY['Gandhipuram','RS Puram','Town Hall','Ukkadam','Saibaba Colony'],ST_SetSRID(ST_MakePoint(76.9725,11.0183),4326)::geography),
  ('CBE-02','Coimbatore','Saravanampatti','Saravanampatti',11.0810,77.0010,ARRAY['Ganapathy','Saravanampatti','Thudiyalur','Kovilmedu'],ST_SetSRID(ST_MakePoint(77.0010,11.0810),4326)::geography),
  ('CBE-03','Coimbatore','Peelamedu','Peelamedu',11.0300,77.0250,ARRAY['Hope College','Kalapatti','Vilankurichi','Uppilipalayam','Chinniampalayam'],ST_SetSRID(ST_MakePoint(77.0250,11.0300),4326)::geography),
  ('CBE-04','Coimbatore','Singanallur','Singanallur',10.9980,77.0320,ARRAY['Ramanathapuram','Ondipudur','Trichy Road','Podanur','Sundarapuram'],ST_SetSRID(ST_MakePoint(77.0320,10.9980),4326)::geography),
  ('CBE-05','Coimbatore','Vadavalli','Vadavalli',11.0240,76.8950,ARRAY['Vadavalli','Marudamalai Road','Perur','Kovaipudur','Kuniyamuthur'],ST_SetSRID(ST_MakePoint(76.8950,11.0240),4326)::geography),
  ('BLR-01','Bengaluru','Central','Majestic / Kempegowda',12.9767,77.5713,ARRAY['Majestic','Shivajinagar','MG Road','Richmond Town','Vasanth Nagar'],ST_SetSRID(ST_MakePoint(77.5713,12.9767),4326)::geography),
  ('BLR-02','Bengaluru','East','Whitefield',12.9698,77.7499,ARRAY['Whitefield','Hoodi','ITPL','Kadugodi','Mahadevapura'],ST_SetSRID(ST_MakePoint(77.7499,12.9698),4326)::geography),
  ('BLR-03','Bengaluru','South-East','Marathahalli / Bellandur',12.9569,77.7011,ARRAY['Bellandur','Marathahalli','HSR Layout','Sarjapur Road','Koramangala'],ST_SetSRID(ST_MakePoint(77.7011,12.9569),4326)::geography),
  ('BLR-04','Bengaluru','South','Jayanagar',12.9250,77.5938,ARRAY['Jayanagar','JP Nagar','Banashankari','Basavanagudi','Kumaraswamy Layout'],ST_SetSRID(ST_MakePoint(77.5938,12.9250),4326)::geography),
  ('BLR-05','Bengaluru','South-West','Rajarajeshwari Nagar',12.9121,77.5190,ARRAY['RR Nagar','Kengeri','Uttarahalli','Nagarbhavi','Mysore Road corridor'],ST_SetSRID(ST_MakePoint(77.5190,12.9121),4326)::geography),
  ('BLR-06','Bengaluru','West','Rajajinagar',12.9910,77.5530,ARRAY['Rajajinagar','Vijayanagar','Basaveshwaranagar','Peenya','Magadi Road'],ST_SetSRID(ST_MakePoint(77.5530,12.9910),4326)::geography),
  ('BLR-07','Bengaluru','North','Yelahanka',13.1007,77.5963,ARRAY['Yelahanka','Hebbal','Jakkur','Vidyaranyapura','Thanisandra'],ST_SetSRID(ST_MakePoint(77.5963,13.1007),4326)::geography),
  ('BLR-08','Bengaluru','North-East','Hennur / Kalyan Nagar',13.0358,77.6408,ARRAY['Hennur','Banaswadi','Kalyan Nagar','Horamavu','Ramamurthy Nagar'],ST_SetSRID(ST_MakePoint(77.6408,13.0358),4326)::geography)
ON CONFLICT (zone_code) DO UPDATE SET
  city = EXCLUDED.city, zone_name = EXCLUDED.zone_name, hub_name = EXCLUDED.hub_name,
  hub_lat = EXCLUDED.hub_lat, hub_lng = EXCLUDED.hub_lng, focus_areas = EXCLUDED.focus_areas,
  hub_location = EXCLUDED.hub_location, updated_at = now(), is_active = true;

CREATE INDEX IF NOT EXISTS sellers_location_gix ON public.sellers USING gist
  ((ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography))
  WHERE lat IS NOT NULL AND lng IS NOT NULL;

-- Never invent a location for a seller. Unlocated sellers stay out of nearby
-- results until an admin/vendor supplies real coordinates.
CREATE OR REPLACE VIEW public.approved_vendor_catalog AS
SELECT s.id,
  COALESCE(NULLIF(s.business_name,''), NULLIF(s.full_name,''), s.email, 'Local vendor') AS shop_name,
  s.business_type, s.city, s.state, s.address_line1,
  COALESCE((SELECT NULLIF(p.category,'') FROM public.products p WHERE p.seller_id=s.id ORDER BY p.created_at DESC LIMIT 1),'grocery') AS category,
  logo.file_url AS shop_logo_path, banner.file_url AS shop_banner_path, s.lat, s.lng
FROM public.sellers s
LEFT JOIN LATERAL (SELECT d.file_url FROM public.seller_documents d WHERE d.seller_id=s.id AND d.doc_type='shopLogo' ORDER BY d.created_at DESC LIMIT 1) logo ON true
LEFT JOIN LATERAL (SELECT d.file_url FROM public.seller_documents d WHERE d.seller_id=s.id AND d.doc_type='shopBanner' ORDER BY d.created_at DESC LIMIT 1) banner ON true
WHERE s.status::text='approved';

DROP FUNCTION IF EXISTS public.get_customer_operational_zone(double precision, double precision);
CREATE FUNCTION public.get_customer_operational_zone(p_lat double precision, p_lng double precision)
RETURNS TABLE(zone_code text, zone_name text, city text, hub_name text, distance_km double precision)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT z.zone_code, z.zone_name, z.city, z.hub_name,
    ST_Distance(z.hub_location, ST_SetSRID(ST_MakePoint(p_lng,p_lat),4326)::geography) / 1000.0
  FROM public.operational_zones z
  WHERE z.is_active AND p_lat BETWEEN -90 AND 90 AND p_lng BETWEEN -180 AND 180
    AND ST_DWithin(z.hub_location, ST_SetSRID(ST_MakePoint(p_lng,p_lat),4326)::geography, 7000)
  ORDER BY z.hub_location <-> ST_SetSRID(ST_MakePoint(p_lng,p_lat),4326)::geography
  LIMIT 1;
$$;

DROP FUNCTION IF EXISTS public.get_customer_visible_shops(double precision,double precision,text,text,integer,integer);
CREATE FUNCTION public.get_customer_visible_shops(
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
  WITH customer AS (SELECT ST_SetSRID(ST_MakePoint(p_lng,p_lat),4326)::geography AS point),
  located AS (
    SELECT s.*, COALESCE(NULLIF(s.business_name,''), NULLIF(s.full_name,''), s.email, 'Local vendor') AS display_name,
      ST_SetSRID(ST_MakePoint(s.lng,s.lat),4326)::geography AS shop_point
    FROM public.sellers s
    WHERE s.status::text IN ('approved','active') AND s.lat IS NOT NULL AND s.lng IS NOT NULL
      AND p_lat BETWEEN -90 AND 90 AND p_lng BETWEEN -180 AND 180
      AND EXISTS (SELECT 1 FROM public.products p WHERE p.seller_id=s.id AND p.status::text IN ('active','approved') AND p.stock > 0)
  )
  SELECT l.id, l.display_name, l.business_type, l.city, l.state, l.address_line1,
    COALESCE((SELECT NULLIF(p.category,'') FROM public.products p WHERE p.seller_id=l.id AND p.stock>0 ORDER BY p.created_at DESC LIMIT 1),'grocery'),
    l.lat, l.lng, ST_Distance(l.shop_point,c.point)/1000.0,
    z.zone_code, z.zone_name, true, l.status::text='approved'
  FROM located l CROSS JOIN customer c
  LEFT JOIN LATERAL (SELECT oz.zone_code, oz.zone_name FROM public.operational_zones oz WHERE oz.is_active AND ST_DWithin(oz.hub_location,l.shop_point,7000) ORDER BY oz.hub_location <-> l.shop_point LIMIT 1) z ON true
  WHERE ST_DWithin(l.shop_point,c.point,5000)
    AND (NULLIF(trim(p_query),'') IS NULL OR l.display_name ILIKE '%'||trim(p_query)||'%' OR l.business_type ILIKE '%'||trim(p_query)||'%' OR l.city ILIKE '%'||trim(p_query)||'%')
    AND (NULLIF(trim(p_category_slug),'') IS NULL OR EXISTS (SELECT 1 FROM public.products p WHERE p.seller_id=l.id AND p.category ILIKE '%'||trim(p_category_slug)||'%'))
  ORDER BY ST_Distance(l.shop_point,c.point), l.display_name
  LIMIT LEAST(GREATEST(p_limit,1),100) OFFSET GREATEST(p_offset,0);
$$;

DROP FUNCTION IF EXISTS public.get_customer_visible_products(double precision,double precision,text,text,integer,integer);
CREATE FUNCTION public.get_customer_visible_products(
  p_lat double precision, p_lng double precision, p_query text DEFAULT NULL,
  p_category_slug text DEFAULT NULL, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0
)
RETURNS TABLE(id uuid, seller_id uuid, name text, category text, selling_price numeric, image_url text, stock integer, shop_name text, business_type text, city text, state text, address_line1 text, distance_km double precision, zone_code text, zone_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p.id,p.seller_id,p.name,p.category,p.selling_price,p.image_url,p.stock,
    COALESCE(NULLIF(s.business_name,''),NULLIF(s.full_name,''),s.email,'Local vendor'),s.business_type,s.city,s.state,s.address_line1,
    ST_Distance(ST_SetSRID(ST_MakePoint(s.lng,s.lat),4326)::geography,ST_SetSRID(ST_MakePoint(p_lng,p_lat),4326)::geography)/1000.0,
    z.zone_code,z.zone_name
  FROM public.products p JOIN public.sellers s ON s.id=p.seller_id
  LEFT JOIN LATERAL (SELECT oz.zone_code,oz.zone_name FROM public.operational_zones oz WHERE oz.is_active AND ST_DWithin(oz.hub_location,ST_SetSRID(ST_MakePoint(s.lng,s.lat),4326)::geography,7000) ORDER BY oz.hub_location <-> ST_SetSRID(ST_MakePoint(s.lng,s.lat),4326)::geography LIMIT 1) z ON true
  WHERE p.status::text IN ('active','approved') AND p.stock>0 AND s.status::text IN ('approved','active') AND s.lat IS NOT NULL AND s.lng IS NOT NULL
    AND p_lat BETWEEN -90 AND 90 AND p_lng BETWEEN -180 AND 180
    AND ST_DWithin(ST_SetSRID(ST_MakePoint(s.lng,s.lat),4326)::geography,ST_SetSRID(ST_MakePoint(p_lng,p_lat),4326)::geography,5000)
    AND (NULLIF(trim(p_query),'') IS NULL OR p.name ILIKE '%'||trim(p_query)||'%' OR p.category ILIKE '%'||trim(p_query)||'%')
    AND (NULLIF(trim(p_category_slug),'') IS NULL OR p.category ILIKE '%'||trim(p_category_slug)||'%')
  ORDER BY ST_Distance(ST_SetSRID(ST_MakePoint(s.lng,s.lat),4326)::geography,ST_SetSRID(ST_MakePoint(p_lng,p_lat),4326)::geography),p.created_at DESC
  LIMIT LEAST(GREATEST(p_limit,1),100) OFFSET GREATEST(p_offset,0);
$$;

GRANT SELECT ON public.operational_zones TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_customer_operational_zone(double precision,double precision) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_customer_visible_shops(double precision,double precision,text,text,integer,integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_customer_visible_products(double precision,double precision,text,text,integer,integer) TO anon, authenticated;
