-- OTP requests create auth.users rows before verification. Do not treat those
-- unconfirmed rows as registered accounts in the customer login/signup flow.
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
    SELECT 1 FROM public.profiles
    WHERE ((p_email IS NOT NULL AND lower(email) = lower(trim(p_email)))
       OR (p_phone IS NOT NULL AND phone = trim(p_phone)))
      AND EXISTS (
        SELECT 1 FROM auth.users u
        WHERE u.id = profiles.id
          AND ((p_email IS NULL OR u.email_confirmed_at IS NOT NULL)
           AND (p_phone IS NULL OR u.phone_confirmed_at IS NOT NULL))
      )
  ) OR EXISTS (
    SELECT 1 FROM auth.users
    WHERE ((p_email IS NOT NULL AND lower(email) = lower(trim(p_email)))
       OR (p_phone IS NOT NULL AND phone = trim(p_phone)))
      AND ((p_email IS NULL OR email_confirmed_at IS NOT NULL)
       AND (p_phone IS NULL OR phone_confirmed_at IS NOT NULL))
  );
$$;

REVOKE ALL ON FUNCTION public.account_exists(text, text) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
