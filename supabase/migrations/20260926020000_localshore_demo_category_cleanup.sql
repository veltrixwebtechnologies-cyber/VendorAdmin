-- LocalShore demo category cleanup
--
-- The earlier demo coverage migrations added every category to every demo
-- seller. That made a Flowers or Hardware result open a Meat & Fish shop.
-- Keep the rows for audit/recovery, but make only category-matching demo
-- inventory visible to customers.
--
-- Real sellers are excluded by the explicit localshore.test/demo-name guard.

UPDATE public.products AS p
SET
  status = 'inactive',
  stock = 0
FROM public.sellers AS s
WHERE p.seller_id = s.id
  AND s.email ILIKE '%@localshore.test'
  AND s.business_name ILIKE 'LocalShore%'
  AND s.business_type IS NOT NULL
  AND p.status::text IN ('active', 'approved')
  AND lower(trim(coalesce(p.category, ''))) <> lower(trim(s.business_type));

-- Keep the migration self-checking. If a demo seller still exposes a product
-- from another category, fail instead of silently leaving the marketplace
-- inconsistent.
DO $$
DECLARE
  mismatch_count integer;
BEGIN
  SELECT count(*)
  INTO mismatch_count
  FROM public.products AS p
  JOIN public.sellers AS s ON s.id = p.seller_id
  WHERE s.email ILIKE '%@localshore.test'
    AND s.business_name ILIKE 'LocalShore%'
    AND s.business_type IS NOT NULL
    AND p.status::text IN ('active', 'approved')
    AND p.stock > 0
    AND lower(trim(coalesce(p.category, ''))) <> lower(trim(s.business_type));

  IF mismatch_count > 0 THEN
    RAISE EXCEPTION
      'LocalShore demo category cleanup failed: % mismatched active products remain',
      mismatch_count;
  END IF;
END $$;

-- Verification query for Supabase SQL Editor:
-- SELECT s.business_name, s.business_type, p.category, count(*) AS active_products
-- FROM public.sellers s
-- JOIN public.products p ON p.seller_id = s.id
-- WHERE s.email ILIKE '%@localshore.test'
--   AND s.business_name ILIKE 'LocalShore%'
--   AND p.status::text IN ('active', 'approved')
--   AND p.stock > 0
-- GROUP BY s.business_name, s.business_type, p.category
-- ORDER BY s.business_name, p.category;
