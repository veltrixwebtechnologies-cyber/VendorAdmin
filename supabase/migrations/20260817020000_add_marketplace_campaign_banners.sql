-- Add the additional marketplace campaigns to the shared admin/public banner catalog.
-- Local assets are committed to public/marketplace-ads and are safe to serve without storage access.
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
VALUES
  (
    '10000000-0000-4000-8000-000000000007'::uuid,
    'Everyday pharmacy essentials',
    'Cough care, personal wellness and trusted essentials from nearby stores.',
    '/marketplace-ads/pharmacy.png',
    '/?category=pharmacy',
    'hero',
    7,
    true
  ),
  (
    '10000000-0000-4000-8000-000000000008'::uuid,
    'Pet care supplies at your door',
    'Food, treats, toys and care essentials for every kind of companion.',
    '/marketplace-ads/pet-care.png',
    '/?category=grocery',
    'hero',
    8,
    true
  ),
  (
    '10000000-0000-4000-8000-000000000009'::uuid,
    'Baby care when you need it',
    'Diapers, bath care and everyday essentials delivered from local sellers.',
    '/marketplace-ads/baby-care.png',
    '/?category=grocery',
    'hero',
    9,
    true
  )
ON CONFLICT (id) DO NOTHING;
