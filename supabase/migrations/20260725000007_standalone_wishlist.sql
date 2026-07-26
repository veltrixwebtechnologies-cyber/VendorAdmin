-- Standalone wishlist support. This intentionally has no dependency on admin
-- role helper functions, so it can be applied to the current shared project.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS brand_id uuid REFERENCES public.brands(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS discount_price numeric(10,2),
  ADD COLUMN IF NOT EXISTS discount_starts_at timestamptz,
  ADD COLUMN IF NOT EXISTS discount_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS clearance boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.wishlist (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, product_id)
);

ALTER TABLE public.wishlist ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON public.wishlist TO authenticated;

DROP POLICY IF EXISTS "Users manage own wishlist" ON public.wishlist;
CREATE POLICY "Users manage own wishlist"
ON public.wishlist
FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE VIEW public.public_merchandising_products AS
SELECT
  p.id,
  p.seller_id,
  p.name,
  p.brand,
  p.brand_id,
  p.category,
  p.selling_price,
  p.mrp,
  p.discount_price,
  p.discount_starts_at,
  p.discount_ends_at,
  p.clearance,
  p.stock,
  p.image_url,
  p.created_at,
  p.brand AS brand_name,
  0::numeric(4,2) AS average_rating,
  0::integer AS review_count,
  COALESCE(NULLIF(s.business_name, ''), NULLIF(s.full_name, ''), s.email, 'Local vendor') AS shop_name
FROM public.products p
JOIN public.sellers s ON s.id = p.seller_id
WHERE p.status::text IN ('active', 'approved')
  AND s.status::text = 'approved'
  AND p.stock > 0;

GRANT SELECT ON public.public_merchandising_products TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
