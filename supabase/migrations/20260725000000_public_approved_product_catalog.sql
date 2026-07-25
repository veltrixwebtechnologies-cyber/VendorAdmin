-- Public catalog used by Shoreline Shopper before a customer signs in.
-- Only products and sellers approved by Admin are exposed.
CREATE OR REPLACE VIEW public.approved_product_catalog AS
SELECT
  p.id,
  p.seller_id,
  p.name,
  p.category,
  p.selling_price,
  p.image_url,
  p.stock,
  p.created_at,
  COALESCE(NULLIF(s.business_name, ''), NULLIF(s.full_name, ''), s.email, 'Local vendor') AS shop_name,
  s.business_type,
  s.city,
  s.state,
  s.address_line1
FROM public.products AS p
JOIN public.sellers AS s ON s.id = p.seller_id
WHERE p.status::text IN ('active', 'approved')
  AND s.status::text = 'approved';

GRANT SELECT ON public.approved_product_catalog TO anon, authenticated;
