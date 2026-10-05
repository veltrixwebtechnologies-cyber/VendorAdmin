-- Correct the legacy product guard so delegated RBAC product moderators can
-- approve/reject listings. The later guard_seller_product_columns trigger
-- already uses products.manage/products.moderate; this older trigger also
-- runs and previously restored OLD.status for every non-SUPER_ADMIN user.
-- New migration only: do not rewrite an already-applied migration.

CREATE OR REPLACE FUNCTION public.guard_product_ownership_and_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.user_id := auth.uid();
    SELECT seller.id
      INTO NEW.seller_id
      FROM public.sellers AS seller
     WHERE seller.user_id = auth.uid();

    IF NEW.seller_id IS NULL THEN
      RAISE EXCEPTION 'Seller profile not found';
    END IF;

    NEW.status := 'pending';
    RETURN NEW;
  END IF;

  -- Ownership is immutable after creation. Product moderators may change the
  -- workflow status through the existing permission-guarded Admin operation.
  NEW.user_id := OLD.user_id;
  NEW.seller_id := OLD.seller_id;

  IF public.has_admin_permission('products.manage')
     OR public.has_admin_permission('products.moderate')
     OR public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;

  NEW.status := OLD.status;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_product_ownership_and_status() FROM PUBLIC, anon, authenticated;

