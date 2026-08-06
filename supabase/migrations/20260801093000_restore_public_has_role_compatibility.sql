-- Compatibility helper for legacy RLS policies that still call public.has_role.
-- The canonical helper may also exist in private.has_role; this public wrapper
-- keeps older policies working without exposing user_roles to anonymous clients.
DO $$
BEGIN
  IF to_regtype('public.app_role') IS NULL THEN
    RAISE EXCEPTION 'public.app_role must exist before installing public.has_role';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  );
$$;

REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
