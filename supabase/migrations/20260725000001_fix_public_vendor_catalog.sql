-- The shared sellers table does not contain wizard_data. Keep the public
-- vendor catalog compatible with the actual shared schema.
CREATE OR REPLACE VIEW public.approved_vendor_catalog AS
SELECT
  s.id,
  COALESCE(NULLIF(s.business_name, ''), NULLIF(s.full_name, ''), s.email, 'Local vendor') AS shop_name,
  s.business_type,
  s.city,
  s.state,
  s.address_line1,
  'grocery'::text AS category
FROM public.sellers AS s
WHERE s.status::text = 'approved';

GRANT SELECT ON public.approved_vendor_catalog TO anon, authenticated;
