-- Security hardening. Apply manually after reviewing against production.

-- Customers must create orders through the authoritative checkout RPC only.
REVOKE INSERT, UPDATE, DELETE ON public.orders FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.order_items FROM authenticated;

-- Sellers may create products only for their own seller record. Status and
-- ownership are server/admin controlled.
DROP POLICY IF EXISTS "Approved vendors manage own products" ON public.products;
DROP POLICY IF EXISTS "Seller manages own products" ON public.products;
CREATE POLICY "Approved vendors manage own products" ON public.products
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id AND private.is_approved_vendor(auth.uid()));
CREATE POLICY "Approved vendors create pending products" ON public.products
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND seller_id = (SELECT s.id FROM public.sellers s WHERE s.user_id = auth.uid())
    AND private.is_approved_vendor(auth.uid())
    AND status = 'pending'
  );
CREATE POLICY "Approved vendors update own products" ON public.products
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND private.is_approved_vendor(auth.uid()))
  WITH CHECK (auth.uid() = user_id AND private.is_approved_vendor(auth.uid()));
CREATE POLICY "Approved vendors delete own products" ON public.products
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND private.is_approved_vendor(auth.uid()));

CREATE OR REPLACE FUNCTION public.guard_product_ownership_and_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    NEW.user_id := OLD.user_id;
    NEW.seller_id := OLD.seller_id;
    NEW.status := OLD.status;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_product_ownership_and_status ON public.products;
CREATE TRIGGER trg_guard_product_ownership_and_status
BEFORE UPDATE ON public.products FOR EACH ROW
EXECUTE FUNCTION public.guard_product_ownership_and_status();

-- Seller documents must always belong to the authenticated seller identity.
UPDATE storage.buckets SET
  public = false,
  file_size_limit = 10 * 1024 * 1024,
  allowed_mime_types = ARRAY['application/pdf','image/jpeg','image/png','image/webp']
WHERE id IN ('seller-docs', 'delivery-docs');

CREATE OR REPLACE FUNCTION public.guard_seller_document_ownership()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE expected_seller uuid;
BEGIN
  IF auth.role() = 'service_role' OR public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;
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

-- Atomic coupon accounting. The checkout RPC must lock the coupon row before
-- quoting and applying it; the unique key prevents duplicate user records.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coupon_usages_nonnegative_count') THEN
    ALTER TABLE public.coupon_usages ADD CONSTRAINT coupon_usages_nonnegative_count CHECK (use_count > 0);
  END IF;
END $$;

-- Server-generated seller email verification codes. No client read policy.
CREATE TABLE IF NOT EXISTS public.seller_verification_otps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE (user_id, email)
);
ALTER TABLE public.seller_verification_otps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seller_verification_otps FROM anon, authenticated;
GRANT ALL ON public.seller_verification_otps TO service_role;

-- Prevent fake paid status. Only service-role payment webhooks may mark paid.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS payment_reference text,
  ADD COLUMN IF NOT EXISTS payment_currency text NOT NULL DEFAULT 'INR';
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_payment_status_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_payment_status_check
  CHECK (payment_status IN ('pending', 'authorized', 'paid', 'failed', 'refunded'));
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_payment_currency_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_payment_currency_check CHECK (payment_currency = 'INR');
CREATE UNIQUE INDEX IF NOT EXISTS orders_payment_reference_unique
  ON public.orders(payment_reference) WHERE payment_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.checkout_requests (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, request_id)
);
ALTER TABLE public.checkout_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.checkout_requests FROM anon, authenticated;
GRANT ALL ON public.checkout_requests TO service_role;

CREATE OR REPLACE FUNCTION public.place_order_once(
  p_request_id uuid,
  p_buyer_name text,
  p_buyer_phone text,
  p_buyer_address text,
  p_items jsonb,
  p_payment_method text,
  p_coupon_code text DEFAULT NULL
)
RETURNS public.orders LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE uid uuid := auth.uid(); existing_order public.orders; created public.orders;
BEGIN
  IF uid IS NULL OR p_request_id IS NULL THEN RAISE EXCEPTION 'Authentication and request id required'; END IF;
  INSERT INTO public.checkout_requests(user_id, request_id) VALUES (uid, p_request_id)
  ON CONFLICT (user_id, request_id) DO NOTHING;
  SELECT o.* INTO existing_order FROM public.checkout_requests r JOIN public.orders o ON o.id = r.order_id
    WHERE r.user_id = uid AND r.request_id = p_request_id;
  IF existing_order.id IS NOT NULL THEN RETURN existing_order; END IF;
  created := public.place_order(p_buyer_name, p_buyer_phone, p_buyer_address, p_items, p_payment_method, false, p_coupon_code);
  UPDATE public.checkout_requests SET order_id = created.id WHERE user_id = uid AND request_id = p_request_id;
  RETURN created;
END;
$$;
REVOKE ALL ON FUNCTION public.place_order_once(uuid,text,text,text,jsonb,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_order_once(uuid,text,text,text,jsonb,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_payment_webhook(
  p_order_id uuid, p_transaction_id text, p_amount numeric, p_currency text, p_status text
)
RETURNS public.orders LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE result public.orders;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Only payment webhooks may call this function'; END IF;
  IF p_currency <> 'INR' OR p_status NOT IN ('authorized','paid','failed','refunded') OR p_amount <= 0 THEN RAISE EXCEPTION 'Invalid payment event'; END IF;
  SELECT * INTO result FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF result.id IS NULL OR result.total <> p_amount THEN RAISE EXCEPTION 'Payment amount/order mismatch'; END IF;
  IF result.payment_reference IS NOT NULL THEN
    IF result.payment_reference <> p_transaction_id OR result.payment_status <> p_status THEN RAISE EXCEPTION 'Payment already recorded'; END IF;
    RETURN result;
  END IF;
  UPDATE public.orders SET payment_reference = p_transaction_id, payment_currency = p_currency, payment_status = p_status, updated_at = now()
    WHERE id = p_order_id RETURNING * INTO result;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.record_payment_webhook(uuid,text,numeric,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_payment_webhook(uuid,text,numeric,text,text) TO service_role;

-- Withdrawal requests are created only by this balance-checked RPC.
REVOKE INSERT ON public.delivery_withdrawal_requests FROM authenticated;
CREATE OR REPLACE FUNCTION public.request_delivery_withdrawal(_amount numeric)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_partner_id uuid; available numeric; pending numeric; request_id uuid;
BEGIN
  SELECT id INTO v_partner_id FROM public.delivery_partners WHERE user_id = auth.uid() FOR UPDATE;
  IF v_partner_id IS NULL OR _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Invalid withdrawal'; END IF;
  SELECT COALESCE(w.available_balance, 0) INTO available FROM public.delivery_wallets w WHERE w.partner_id = v_partner_id FOR UPDATE;
  SELECT COALESCE(sum(dwr.amount), 0) INTO pending FROM public.delivery_withdrawal_requests dwr WHERE dwr.partner_id = v_partner_id AND dwr.status IN ('requested','processing');
  IF _amount > available - pending THEN RAISE EXCEPTION 'Insufficient available balance'; END IF;
  INSERT INTO public.delivery_withdrawal_requests(partner_id, amount) VALUES (v_partner_id, _amount) RETURNING id INTO request_id;
  RETURN request_id;
END;
$$;
REVOKE ALL ON FUNCTION public.request_delivery_withdrawal(numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_delivery_withdrawal(numeric) TO authenticated;
