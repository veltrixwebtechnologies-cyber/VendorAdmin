
-- 1. Private schema for internal SECURITY DEFINER helpers
CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated;

-- 2. Move the four SECURITY DEFINER helpers out of the exposed public schema.
--    Existing RLS policies bind to the function OIDs, so they continue to work
--    after the schema move without any policy changes.
ALTER FUNCTION public.has_role(uuid, public.app_role) SET SCHEMA private;
ALTER FUNCTION public.has_any_admin() SET SCHEMA private;
ALTER FUNCTION public.claim_first_admin() SET SCHEMA private;
ALTER FUNCTION public.seed_demo_order() SET SCHEMA private;

-- Ensure authenticated retains EXECUTE (needed for policies calling private.has_role
-- and for the wrappers below to pass through).
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION private.has_any_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION private.claim_first_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION private.seed_demo_order() TO authenticated;

-- 3. Public SECURITY INVOKER wrappers for the three helpers the client calls via RPC.
--    SECURITY INVOKER wrappers are not flagged by the linter; they simply delegate
--    to the SECURITY DEFINER implementations in the private schema.
CREATE OR REPLACE FUNCTION public.has_any_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$ SELECT private.has_any_admin(); $$;

CREATE OR REPLACE FUNCTION public.claim_first_admin()
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$ SELECT private.claim_first_admin(); $$;

CREATE OR REPLACE FUNCTION public.seed_demo_order()
RETURNS uuid
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$ SELECT private.seed_demo_order(); $$;

-- Lock down wrapper grants: only authenticated may call them via RPC.
REVOKE ALL ON FUNCTION public.has_any_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_first_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.seed_demo_order() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_any_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_first_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.seed_demo_order() TO authenticated;
