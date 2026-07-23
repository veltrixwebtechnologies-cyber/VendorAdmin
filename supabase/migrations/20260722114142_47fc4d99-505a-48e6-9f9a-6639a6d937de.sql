
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS rejection_reason text;

CREATE OR REPLACE FUNCTION public.notify_seller_product_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      body_text := '"' || NEW.name || '" was rejected by the admin.' ||
        COALESCE(E'\nReason: ' || NEW.rejection_reason, ' Please review and resubmit.');
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
END $function$;
