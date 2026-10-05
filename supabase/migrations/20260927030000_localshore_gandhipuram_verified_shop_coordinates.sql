-- Update the exact Gandhipuram seller coordinates supplied for these shops.
-- Match by shop name, Coimbatore zone and compatible assigned business type;
-- this intentionally does not create synthetic seller accounts or products.

WITH provided_locations(shop_name, category_key, lat, lng, zone_code) AS (
  VALUES
    ('Selvasingh Stores', 'grocery',      11.0172700::double precision, 76.9655810::double precision, 'CBE-01'),
    ('K K Store',         'grocery',      11.0171308::double precision, 76.9625115::double precision, 'CBE-01'),
    ('Abi Store',         'grocery',      11.0222124::double precision, 76.9693347::double precision, 'CBE-01'),
    ('Classic Footwear',  'footwear',     11.0170250::double precision, 76.9630730::double precision, 'CBE-01'),
    ('Om Gayathries (Craft & Fancy Store)', 'gifts_fancy', 11.0169546::double precision, 76.9650423::double precision, 'CBE-01')
), matched_sellers AS (
  SELECT s.id, locations.lat, locations.lng
  FROM public.sellers AS s
  JOIN provided_locations AS locations
    ON lower(trim(s.business_name)) = lower(locations.shop_name)
  JOIN public.operational_zones AS zone
    ON zone.zone_code = locations.zone_code
   AND zone.city = s.city
   AND zone.is_active
  WHERE CASE locations.category_key
    WHEN 'grocery' THEN regexp_replace(lower(trim(COALESCE(s.business_type, ''))), '[^a-z0-9]+', '_', 'g') IN ('grocery', 'kirana_grocery')
    WHEN 'footwear' THEN regexp_replace(lower(trim(COALESCE(s.business_type, ''))), '[^a-z0-9]+', '_', 'g') = 'footwear'
    WHEN 'gifts_fancy' THEN regexp_replace(lower(trim(COALESCE(s.business_type, ''))), '[^a-z0-9]+', '_', 'g') IN ('gifts_fancy', 'gifts', 'gift_shops', 'jewellery')
    ELSE false
  END
)
UPDATE public.sellers AS seller
SET lat = matched.lat,
    lng = matched.lng
FROM matched_sellers AS matched
WHERE seller.id = matched.id;

-- Verification query (run after migration):
-- SELECT business_name, business_type, lat, lng, city
-- FROM public.sellers
-- WHERE lower(trim(business_name)) IN (
--   'selvasingh stores', 'k k store', 'abi store', 'classic footwear',
--   'om gayathries (craft & fancy store)'
-- )
-- ORDER BY business_name;
