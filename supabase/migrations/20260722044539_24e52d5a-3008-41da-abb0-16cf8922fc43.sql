
-- Helper: check if any admin exists
CREATE OR REPLACE FUNCTION public.has_any_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE role='admin')
$$;
GRANT EXECUTE ON FUNCTION public.has_any_admin() TO anon, authenticated;

-- Bootstrap: allow the first authenticated user to claim admin if none exists
CREATE OR REPLACE FUNCTION public.claim_first_admin()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM public.user_roles WHERE role='admin') THEN RETURN false; END IF;
  INSERT INTO public.user_roles(user_id, role) VALUES (uid, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  RETURN true;
END $$;
GRANT EXECUTE ON FUNCTION public.claim_first_admin() TO authenticated;

-- Ensure the trigger for new users exists on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Uniqueness for settlement cycles
CREATE UNIQUE INDEX IF NOT EXISTS settlements_seller_cycle_idx
  ON public.settlements(seller_id, cycle_start);

-- Allow admins to view all products (they already can) and additionally allow anon/authenticated to view active only (existing).
-- Grants (safe to re-run)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

-- Realtime nice-to-have (optional)
