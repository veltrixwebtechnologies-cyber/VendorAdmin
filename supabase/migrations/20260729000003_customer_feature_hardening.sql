-- Enforce customer feature limits and keep review media private.

CREATE OR REPLACE FUNCTION public.enforce_compare_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (SELECT count(*) FROM public.product_comparisons WHERE user_id = NEW.user_id) >= 4 THEN
    RAISE EXCEPTION 'You can compare up to four products';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS product_comparisons_limit ON public.product_comparisons;
CREATE TRIGGER product_comparisons_limit
  BEFORE INSERT ON public.product_comparisons
  FOR EACH ROW EXECUTE FUNCTION public.enforce_compare_limit();

INSERT INTO storage.buckets (id, name, public)
VALUES ('review-images', 'review-images', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "Customers upload own review images" ON storage.objects;
CREATE POLICY "Customers upload own review images"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'review-images' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Customers view own review images" ON storage.objects;
CREATE POLICY "Customers view own review images"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'review-images'
  AND ((storage.foldername(name))[1] = auth.uid()::text OR private.has_role(auth.uid(), 'admin'::public.app_role))
);

DROP POLICY IF EXISTS "Customers manage own review images" ON storage.objects;
CREATE POLICY "Customers manage own review images"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'review-images'
  AND ((storage.foldername(name))[1] = auth.uid()::text OR private.has_role(auth.uid(), 'admin'::public.app_role))
);
