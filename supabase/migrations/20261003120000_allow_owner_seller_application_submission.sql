-- Let a seller submit or resubmit their own application without allowing
-- client-side approval, rejection, or edits to administrator review metadata.
CREATE OR REPLACE FUNCTION public.prevent_vendor_approval_field_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  is_admin boolean := private.has_role(auth.uid(), 'admin'::public.app_role);
  is_owner_submission boolean :=
    auth.uid() = OLD.user_id
    AND OLD.status::text IN ('draft', 'rejected', 'more_info')
    AND NEW.status::text = 'pending'
    AND NEW.reviewed_by IS NOT DISTINCT FROM OLD.reviewed_by
    AND NEW.reviewed_at IS NOT DISTINCT FROM OLD.reviewed_at
    AND NEW.admin_notes IS NOT DISTINCT FROM OLD.admin_notes;
BEGIN
  IF auth.role() = 'service_role' OR is_admin THEN
    RETURN NEW;
  END IF;

  IF is_owner_submission THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
     OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
     OR NEW.admin_notes IS DISTINCT FROM OLD.admin_notes THEN
    RAISE EXCEPTION 'Only administrators can change vendor approval fields';
  END IF;

  RETURN NEW;
END;
$$;

-- Keep admin decisions visible to the seller. The original trigger referenced
-- a nonexistent review_note column; the actual seller table uses admin_notes.
CREATE OR REPLACE FUNCTION public.notify_seller_application_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  title_text text;
  body_text text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status::text = 'approved' THEN
    title_text := 'Application approved';
    body_text := 'Your seller application has been approved. You can now start selling!';
  ELSIF NEW.status::text = 'rejected' THEN
    title_text := 'Application rejected';
    body_text := COALESCE(NULLIF(trim(NEW.admin_notes), ''), 'Your seller application was rejected.');
  ELSIF NEW.status::text = 'more_info' THEN
    title_text := 'More information requested';
    body_text := COALESCE(NULLIF(trim(NEW.admin_notes), ''), 'The admin has requested additional information for your application.');
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (user_id, title, body, kind, link)
  VALUES (NEW.user_id, title_text, body_text, 'application', '/seller');
  RETURN NEW;
END;
$$;

-- Admin product approvals use the canonical `approved` status, while older
-- catalog records may use `active`; notify for either visible state.
CREATE OR REPLACE FUNCTION public.notify_seller_product_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  title_text text;
  body_text text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status::text IN ('active', 'approved') THEN
    title_text := 'Product approved';
    body_text := '"' || NEW.name || '" is now live on the marketplace.';
  ELSIF NEW.status::text = 'rejected' THEN
    title_text := 'Product rejected';
    body_text := '"' || NEW.name || '" was rejected by the admin. Please review and resubmit.';
  ELSIF NEW.status::text = 'inactive' THEN
    title_text := 'Product hidden';
    body_text := '"' || NEW.name || '" has been hidden from the marketplace by the admin.';
  ELSIF NEW.status::text = 'pending' THEN
    title_text := 'Product pending review';
    body_text := '"' || NEW.name || '" is pending admin review.';
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (user_id, title, body, kind, link)
  VALUES (NEW.user_id, title_text, body_text, 'product', '/seller/products');
  RETURN NEW;
END;
$$;
