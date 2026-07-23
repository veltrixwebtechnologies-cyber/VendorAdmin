CREATE OR REPLACE VIEW public.approved_vendor_catalog AS
SELECT
  s.id,
  COALESCE(NULLIF(s.business_name, ''), NULLIF(s.full_name, ''), s.email, 'Local vendor') AS shop_name,
  s.business_type,
  s.city,
  s.state,
  s.address_line1,
  COALESCE(s.wizard_data->>'category', 'grocery') AS category
FROM public.sellers AS s
WHERE s.status = 'approved';

GRANT SELECT ON public.approved_vendor_catalog TO anon, authenticated;
