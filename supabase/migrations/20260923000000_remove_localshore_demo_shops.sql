-- Remove only the LocalShore demo coverage sellers. Real vendor records are untouched.
-- After this migration, customer results contain only real approved sellers with
-- real coordinates and active products within the strict 5 km radius.
CREATE TEMP TABLE _localshore_demo_sellers ON COMMIT DROP AS
SELECT id, user_id
FROM public.sellers
WHERE email ILIKE '%.demo%@localshore.test'
   OR business_name ILIKE 'LocalShore CBE-% Shop %'
   OR business_name ILIKE 'LocalShore BLR-% Shop %';

DELETE FROM public.products
WHERE seller_id IN (SELECT id FROM _localshore_demo_sellers);

DELETE FROM public.sellers
WHERE id IN (SELECT id FROM _localshore_demo_sellers);

DELETE FROM auth.users
WHERE id IN (SELECT user_id FROM _localshore_demo_sellers);
