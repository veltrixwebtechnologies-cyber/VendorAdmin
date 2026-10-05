-- Payment attempts and captured status are server-owned. The original migration
-- allowed authenticated clients to call a SECURITY DEFINER finalizer directly.
-- Apply after deploying the authenticated shopper payment handlers.
BEGIN;
REVOKE EXECUTE ON FUNCTION public.create_payment_attempt(text, numeric, integer, text, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.finalize_verified_payment(text, text, text, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_payment_attempt(text, numeric, integer, text, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_verified_payment(text, text, text, uuid, text)
  TO service_role;
COMMIT;
