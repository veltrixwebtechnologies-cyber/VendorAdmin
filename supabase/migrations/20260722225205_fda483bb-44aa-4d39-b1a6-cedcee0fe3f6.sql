
-- Fix 1: Hide admin_notes and rejection_reason from anonymous public reads via column-level grants.
-- Authenticated users still see all columns (RLS restricts rows to owner/admin).
REVOKE SELECT ON public.products FROM anon;
GRANT SELECT (
  id, seller_id, user_id, name, sku, brand, category, description,
  mrp, selling_price, stock, low_stock_threshold, hsn, tax_rate,
  image_url, images, status, created_at, updated_at
) ON public.products TO anon;

-- Fix 2: Allow sellers to update/delete their own documents in the seller-docs bucket.
CREATE POLICY "Sellers update own seller-docs"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'seller-docs' AND auth.uid()::text = (storage.foldername(name))[1])
WITH CHECK (bucket_id = 'seller-docs' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Sellers delete own seller-docs"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'seller-docs' AND auth.uid()::text = (storage.foldername(name))[1]);
