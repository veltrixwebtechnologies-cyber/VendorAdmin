UPDATE storage.buckets
SET public = true
WHERE id = 'product-images';

DROP POLICY IF EXISTS "Public reads product images" ON storage.objects;
CREATE POLICY "Public reads product images"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'product-images');
