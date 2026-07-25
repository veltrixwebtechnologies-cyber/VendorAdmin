-- Minimal account lookup used by the passwordless customer auth flow.
-- The client receives only a boolean and never raw table/query errors.
CREATE OR REPLACE FUNCTION public.account_exists(
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE (p_email IS NOT NULL AND lower(email) = lower(trim(p_email)))
       OR (p_phone IS NOT NULL AND phone = trim(p_phone))
  );
$$;

REVOKE ALL ON FUNCTION public.account_exists(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.account_exists(text, text) TO anon, authenticated;
