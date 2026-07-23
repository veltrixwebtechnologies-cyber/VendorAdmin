
-- 1) Remove hardcoded admin backdoor from new-user trigger
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email,'@',1)));
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'seller')
    ON CONFLICT (user_id, role) DO NOTHING;
  RETURN NEW;
END; $function$;

-- 2) Neutralize the public claim_first_admin RPC. Admin bootstrap must be done
--    out-of-band (service role) going forward.
CREATE OR REPLACE FUNCTION private.claim_first_admin()
RETURNS boolean
LANGUAGE sql
SET search_path TO 'public'
AS $function$ SELECT false; $function$;

CREATE OR REPLACE FUNCTION public.claim_first_admin()
RETURNS boolean
LANGUAGE sql
SET search_path TO 'public'
AS $function$ SELECT false; $function$;

REVOKE EXECUTE ON FUNCTION public.claim_first_admin() FROM anon, authenticated;

-- 3) Enforce is_blocked at the DB layer via a trigger-based guard.
CREATE OR REPLACE FUNCTION private.assert_not_blocked()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_status
    WHERE user_id = auth.uid() AND is_blocked = true
  ) THEN
    RAISE EXCEPTION 'Account is blocked' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $function$;

DROP TRIGGER IF EXISTS trg_block_guard_orders ON public.orders;
CREATE TRIGGER trg_block_guard_orders
  BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION private.assert_not_blocked();

DROP TRIGGER IF EXISTS trg_block_guard_order_items ON public.order_items;
CREATE TRIGGER trg_block_guard_order_items
  BEFORE INSERT OR UPDATE ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION private.assert_not_blocked();

DROP TRIGGER IF EXISTS trg_block_guard_products ON public.products;
CREATE TRIGGER trg_block_guard_products
  BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION private.assert_not_blocked();

DROP TRIGGER IF EXISTS trg_block_guard_reviews ON public.reviews;
CREATE TRIGGER trg_block_guard_reviews
  BEFORE INSERT OR UPDATE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION private.assert_not_blocked();

DROP TRIGGER IF EXISTS trg_block_guard_support_tickets ON public.support_tickets;
CREATE TRIGGER trg_block_guard_support_tickets
  BEFORE INSERT OR UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION private.assert_not_blocked();

DROP TRIGGER IF EXISTS trg_block_guard_ticket_messages ON public.ticket_messages;
CREATE TRIGGER trg_block_guard_ticket_messages
  BEFORE INSERT OR UPDATE ON public.ticket_messages
  FOR EACH ROW EXECUTE FUNCTION private.assert_not_blocked();
