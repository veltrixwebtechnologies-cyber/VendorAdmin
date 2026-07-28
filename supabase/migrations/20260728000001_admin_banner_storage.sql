-- Public storefront campaign artwork. Only admins may modify objects.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'banner-images',
  'banner-images',
  true,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
ON CONFLICT (id) DO UPDATE SET
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

DROP POLICY IF EXISTS "Public reads banner images" ON storage.objects;
CREATE POLICY "Public reads banner images"
ON storage.objects FOR SELECT
USING (bucket_id = 'banner-images');

DROP POLICY IF EXISTS "Admins insert banner images" ON storage.objects;
CREATE POLICY "Admins insert banner images"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'banner-images'
  AND EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = auth.uid() AND role::text = 'admin'
  )
);

DROP POLICY IF EXISTS "Admins update banner images" ON storage.objects;
CREATE POLICY "Admins update banner images"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'banner-images'
  AND EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = auth.uid() AND role::text = 'admin'
  )
)
WITH CHECK (
  bucket_id = 'banner-images'
  AND EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = auth.uid() AND role::text = 'admin'
  )
);

DROP POLICY IF EXISTS "Admins delete banner images" ON storage.objects;
CREATE POLICY "Admins delete banner images"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'banner-images'
  AND EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = auth.uid() AND role::text = 'admin'
  )
);

-- Make the six initial storefront campaigns editable in Admin > Banner Management.
-- Existing hero banners are never overwritten.
INSERT INTO public.banners (
  id,
  title,
  subtitle,
  image_url,
  link_url,
  placement,
  sort_order,
  is_active
)
SELECT *
FROM (
  VALUES
    (
      '10000000-0000-4000-8000-000000000001'::uuid,
      'Daily essentials, picked nearby',
      'Produce, staples and dairy from approved neighborhood sellers.',
      'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=1200&q=82',
      '/?category=fresh',
      'hero',
      1,
      true
    ),
    (
      '10000000-0000-4000-8000-000000000002'::uuid,
      'Snacks and meals without the wait',
      'Find instant food, beverages and ready-to-cook favorites.',
      'https://images.unsplash.com/photo-1621939514649-280e2ee25f60?auto=format&fit=crop&w=1200&q=82',
      '/?category=ready',
      'hero',
      2,
      true
    ),
    (
      '10000000-0000-4000-8000-000000000003'::uuid,
      'Restock your home in a few taps',
      'Cleaning, personal care and everyday household essentials.',
      'https://images.unsplash.com/photo-1583947215259-38e31be8751f?auto=format&fit=crop&w=1200&q=82',
      '/?category=home',
      'hero',
      3,
      true
    ),
    (
      '10000000-0000-4000-8000-000000000004'::uuid,
      'Everyday care, all in one place',
      'Skincare, grooming and personal essentials from trusted local stores.',
      'https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=1200&q=82',
      '/?category=personal',
      'hero',
      4,
      true
    ),
    (
      '10000000-0000-4000-8000-000000000005'::uuid,
      'Tech upgrades for everyday life',
      'Useful accessories and small electronics delivered from nearby sellers.',
      'https://images.unsplash.com/photo-1498049794561-7780e7231661?auto=format&fit=crop&w=1200&q=82',
      '/?category=electronics',
      'hero',
      5,
      true
    ),
    (
      '10000000-0000-4000-8000-000000000006'::uuid,
      'Fresh styles from stores near you',
      'Discover clothing, accessories and seasonal favorites in one place.',
      'https://images.unsplash.com/photo-1445205170230-053b83016050?auto=format&fit=crop&w=1200&q=82',
      '/?category=fashion',
      'hero',
      6,
      true
    )
) AS seed (
  id,
  title,
  subtitle,
  image_url,
  link_url,
  placement,
  sort_order,
  is_active
)
WHERE NOT EXISTS (
  SELECT 1 FROM public.banners WHERE placement = 'hero'
);
