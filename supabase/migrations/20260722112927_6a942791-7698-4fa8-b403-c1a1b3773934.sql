
-- Notify seller on product status change
CREATE OR REPLACE FUNCTION public.notify_seller_product_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  title_text text;
  body_text text;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'active' THEN
      title_text := 'Product approved';
      body_text := '"' || NEW.name || '" is now live on the marketplace.';
    ELSIF NEW.status = 'rejected' THEN
      title_text := 'Product rejected';
      body_text := '"' || NEW.name || '" was rejected by the admin. Please review and resubmit.';
    ELSIF NEW.status = 'inactive' THEN
      title_text := 'Product hidden';
      body_text := '"' || NEW.name || '" has been hidden from the marketplace by the admin.';
    ELSIF NEW.status = 'pending' THEN
      title_text := 'Product pending review';
      body_text := '"' || NEW.name || '" is pending admin review.';
    ELSE
      RETURN NEW;
    END IF;
    INSERT INTO public.notifications (user_id, title, body, kind, link)
    VALUES (NEW.user_id, title_text, body_text, 'product', '/seller/products');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_seller_product_status ON public.products;
CREATE TRIGGER trg_notify_seller_product_status
AFTER UPDATE OF status ON public.products
FOR EACH ROW EXECUTE FUNCTION public.notify_seller_product_status();

-- Notify seller on vendor application status change
CREATE OR REPLACE FUNCTION public.notify_seller_application_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  title_text text;
  body_text text;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'approved' THEN
      title_text := 'Application approved';
      body_text := 'Your seller application has been approved. You can now start selling!';
    ELSIF NEW.status = 'rejected' THEN
      title_text := 'Application rejected';
      body_text := COALESCE('Reason: ' || NEW.review_note, 'Your seller application was rejected.');
    ELSIF NEW.status = 'more_info' THEN
      title_text := 'More information requested';
      body_text := COALESCE(NEW.review_note, 'The admin has requested additional information for your application.');
    ELSE
      RETURN NEW;
    END IF;
    INSERT INTO public.notifications (user_id, title, body, kind, link)
    VALUES (NEW.user_id, title_text, body_text, 'application', '/seller');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_seller_application_status ON public.sellers;
CREATE TRIGGER trg_notify_seller_application_status
AFTER UPDATE OF status ON public.sellers
FOR EACH ROW EXECUTE FUNCTION public.notify_seller_application_status();
