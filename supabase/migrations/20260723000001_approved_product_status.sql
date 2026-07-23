-- Add the requested public product status after the shared backend migration has committed.
ALTER TYPE public.product_status ADD VALUE IF NOT EXISTS 'approved';

DROP POLICY IF EXISTS "Anyone views approved vendor products" ON public.products;
CREATE POLICY "Anyone views approved vendor products" ON public.products FOR SELECT USING (
  status IN ('active', 'approved') AND EXISTS (
    SELECT 1 FROM public.sellers s WHERE s.id = products.seller_id AND s.status = 'approved'
  )
);
