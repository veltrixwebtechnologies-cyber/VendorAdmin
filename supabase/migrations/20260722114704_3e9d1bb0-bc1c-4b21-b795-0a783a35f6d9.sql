
-- Lock down all SECURITY DEFINER functions: revoke default PUBLIC execute, then grant only where needed.

-- Trigger-only functions: not callable by anyone through the API
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_admins_new_product() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_seller_product_status() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_seller_application_status() FROM PUBLIC, anon, authenticated;

-- Helper used by RLS policies and app auth checks: signed-in users only
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

REVOKE ALL ON FUNCTION public.has_any_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_any_admin() TO authenticated;

-- First-admin claim: signed-in users only (uses auth.uid())
REVOKE ALL ON FUNCTION public.claim_first_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_first_admin() TO authenticated;

-- Demo order seeder: signed-in users only (uses auth.uid())
REVOKE ALL ON FUNCTION public.seed_demo_order() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seed_demo_order() TO authenticated;
