
CREATE OR REPLACE FUNCTION public.notify_admins_new_product()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  seller_name text;
BEGIN
  SELECT COALESCE(business_name, full_name, email) INTO seller_name
    FROM public.sellers WHERE user_id = NEW.user_id LIMIT 1;
  IF seller_name IS NULL THEN
    SELECT COALESCE(display_name, email) INTO seller_name FROM public.profiles WHERE id = NEW.user_id;
  END IF;
  INSERT INTO public.notifications (user_id, title, body, kind, link)
  SELECT ur.user_id,
         'New product submitted',
         COALESCE(seller_name,'A seller') || ' added "' || NEW.name || '" (status: ' || NEW.status::text || ')',
         'product',
         '/admin/products'
    FROM public.user_roles ur WHERE ur.role = 'admin';
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_admins_new_product ON public.products;
CREATE TRIGGER trg_notify_admins_new_product
AFTER INSERT ON public.products
FOR EACH ROW EXECUTE FUNCTION public.notify_admins_new_product();
