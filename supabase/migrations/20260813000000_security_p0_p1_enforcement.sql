-- Canonical security enforcement migration. Apply only from SellerHub's
-- migration tree. This migration is intentionally fail-closed.

-- P0: order writes are RPC-only for customers.
REVOKE INSERT, UPDATE, DELETE ON public.orders FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.order_items FROM authenticated;
REVOKE ALL ON FUNCTION public.seed_demo_order() FROM authenticated, anon, PUBLIC;

-- Remove legacy customer write policies even if an older migration recreated them.
DROP POLICY IF EXISTS "Customers create own orders" ON public.orders;
DROP POLICY IF EXISTS "Customers create own order items" ON public.order_items;

-- P1: coupon usage is created only inside the checkout transaction.
REVOKE INSERT, UPDATE, DELETE ON public.coupon_usages FROM authenticated;
DROP POLICY IF EXISTS "Users create own coupon usage" ON public.coupon_usages;

-- P1: delivery workflow tables are read-only from PostgREST. All writes go
-- through accept/reject/advance/complete/location SECURITY DEFINER RPCs.
REVOKE INSERT, UPDATE, DELETE ON public.delivery_assignments FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.delivery_tracking FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.delivery_locations FROM authenticated;
DROP POLICY IF EXISTS "assignment access" ON public.delivery_assignments;
DROP POLICY IF EXISTS "tracking access" ON public.delivery_tracking;
DROP POLICY IF EXISTS "location access" ON public.delivery_locations;
CREATE POLICY "assignment read access" ON public.delivery_assignments
  FOR SELECT TO authenticated
  USING (public.is_my_partner(partner_id)
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
    OR EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_id AND o.user_id = auth.uid()));
CREATE POLICY "tracking read access" ON public.delivery_tracking
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.delivery_assignments a
    WHERE a.id = assignment_id AND (public.is_my_partner(a.partner_id)
      OR public.has_role(auth.uid(), 'admin'::public.app_role))));
CREATE POLICY "location read access" ON public.delivery_locations
  FOR SELECT TO authenticated
  USING (public.is_my_partner(partner_id)
    OR public.has_role(auth.uid(), 'admin'::public.app_role));

-- Do not expose the full unassigned order row (which contains customer PII).
CREATE OR REPLACE FUNCTION public.delivery_partner_can_read_unassigned_order(_order_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT false;
$$;
REVOKE ALL ON FUNCTION public.delivery_partner_can_read_unassigned_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delivery_partner_can_read_unassigned_order(uuid) TO authenticated;

-- Minimal dispatch offers are the only pre-claim data surface. A dispatcher
-- (service role) inserts rows; a partner can read only their own offer.
CREATE TABLE IF NOT EXISTS public.delivery_dispatch_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES public.delivery_assignments(id) ON DELETE CASCADE,
  partner_id uuid NOT NULL REFERENCES public.delivery_partners(id) ON DELETE CASCADE,
  zone_label text,
  estimated_distance_km numeric(8,2),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assignment_id, partner_id)
);
ALTER TABLE public.delivery_dispatch_offers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.delivery_dispatch_offers FROM anon, authenticated;
GRANT SELECT ON public.delivery_dispatch_offers TO authenticated;
DROP POLICY IF EXISTS "partners read own dispatch offers" ON public.delivery_dispatch_offers;
CREATE POLICY "partners read own dispatch offers" ON public.delivery_dispatch_offers
  FOR SELECT TO authenticated
  USING (public.is_my_partner(partner_id) AND expires_at > now());
GRANT ALL ON public.delivery_dispatch_offers TO service_role;

-- Seller product ownership/approval remains database-controlled on every path.
CREATE OR REPLACE FUNCTION public.guard_product_ownership_and_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    IF TG_OP = 'INSERT' THEN
      NEW.user_id := auth.uid();
      SELECT id INTO NEW.seller_id FROM public.sellers WHERE user_id = auth.uid();
      NEW.status := 'pending';
      IF NEW.seller_id IS NULL THEN RAISE EXCEPTION 'Seller profile not found'; END IF;
    ELSE
      NEW.user_id := OLD.user_id;
      NEW.seller_id := OLD.seller_id;
      NEW.status := OLD.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_product_ownership_and_status ON public.products;
CREATE TRIGGER trg_guard_product_ownership_and_status
BEFORE INSERT OR UPDATE ON public.products FOR EACH ROW
EXECUTE FUNCTION public.guard_product_ownership_and_status();

-- Seller documents are bound to the authenticated seller, never client IDs.
CREATE OR REPLACE FUNCTION public.guard_seller_document_ownership()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE expected_seller uuid;
BEGIN
  IF auth.role() = 'service_role' OR public.has_role(auth.uid(), 'admin'::public.app_role) THEN RETURN NEW; END IF;
  SELECT id INTO expected_seller FROM public.sellers WHERE user_id = auth.uid();
  IF expected_seller IS NULL OR NEW.user_id <> auth.uid() OR NEW.seller_id <> expected_seller THEN
    RAISE EXCEPTION 'Seller document ownership mismatch';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_seller_document_ownership ON public.seller_documents;
CREATE TRIGGER trg_guard_seller_document_ownership
BEFORE INSERT OR UPDATE ON public.seller_documents FOR EACH ROW
EXECUTE FUNCTION public.guard_seller_document_ownership();

NOTIFY pgrst, 'reload schema';

-- Durable seller OTP throttling. The server function calls this RPC before
-- sending mail; row locking keeps limits consistent across replicas.
CREATE TABLE IF NOT EXISTS public.seller_otp_rate_limits (
  account_key text NOT NULL,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  locked_until timestamptz,
  PRIMARY KEY (account_key)
);
ALTER TABLE public.seller_otp_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seller_otp_rate_limits FROM anon, authenticated;
GRANT ALL ON public.seller_otp_rate_limits TO service_role;
CREATE OR REPLACE FUNCTION public.consume_seller_otp_rate_limit(_account_key text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.seller_otp_rate_limits; now_ts timestamptz := now();
BEGIN
  INSERT INTO public.seller_otp_rate_limits(account_key) VALUES (lower(trim(_account_key)))
  ON CONFLICT (account_key) DO NOTHING;
  SELECT * INTO r FROM public.seller_otp_rate_limits
    WHERE account_key = lower(trim(_account_key)) FOR UPDATE;
  IF r.locked_until IS NOT NULL AND r.locked_until > now_ts THEN RETURN false; END IF;
  IF r.window_started_at < now_ts - interval '15 minutes' THEN
    UPDATE public.seller_otp_rate_limits SET window_started_at = now_ts, request_count = 1, locked_until = NULL
      WHERE account_key = r.account_key;
    RETURN true;
  END IF;
  IF r.request_count >= 5 THEN
    UPDATE public.seller_otp_rate_limits SET locked_until = now_ts + interval '30 minutes'
      WHERE account_key = r.account_key;
    RETURN false;
  END IF;
  UPDATE public.seller_otp_rate_limits SET request_count = request_count + 1 WHERE account_key = r.account_key;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.consume_seller_otp_rate_limit(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_seller_otp_rate_limit(text) TO service_role;
