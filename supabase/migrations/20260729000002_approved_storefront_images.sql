-- Expose only approved storefront media. Legal/vendor documents remain private.

CREATE OR REPLACE FUNCTION public.is_approved_storefront_image(object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.seller_documents d
    JOIN public.sellers s ON s.id = d.seller_id
    WHERE d.file_url = object_name
      AND d.doc_type IN ('shopLogo', 'shopBanner')
      AND s.status::text = 'approved'
  )
$$;

REVOKE ALL ON FUNCTION public.is_approved_storefront_image(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_approved_storefront_image(text) TO anon, authenticated;

DROP POLICY IF EXISTS "Public reads approved storefront images" ON storage.objects;
CREATE POLICY "Public reads approved storefront images"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (
  bucket_id = 'seller-docs'
  AND public.is_approved_storefront_image(name)
);

CREATE OR REPLACE VIEW public.approved_vendor_catalog AS
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
  banner.file_url AS shop_banner_path
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
