-- ============================================================
-- MIGRATION: 20260909160000_razorpay_payment_integration.sql
-- Implement Razorpay Payment Gateway Data Models & RLS Policies
-- ============================================================

-- 1. Create payment_attempts table
CREATE TABLE IF NOT EXISTS public.payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'razorpay',
  provider_order_id text NOT NULL,
  provider_payment_id text,
  provider_signature text,
  amount numeric(10,2) NOT NULL,
  amount_paise integer NOT NULL CHECK (amount_paise > 0),
  currency text NOT NULL DEFAULT 'INR',
  status text NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'pending', 'authorized', 'captured', 'failed', 'cancelled', 'refunded')),
  failure_reason text,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_attempts_provider_order_id_key UNIQUE (provider_order_id)
);

-- Indexing for fast lookups
CREATE INDEX IF NOT EXISTS idx_payment_attempts_user_id ON public.payment_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_order_id ON public.payment_attempts(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_provider_order_id ON public.payment_attempts(provider_order_id);

-- 2. Row Level Security (RLS)
ALTER TABLE public.payment_attempts ENABLE ROW LEVEL SECURITY;

-- Customers can view their own payment attempts
DROP POLICY IF EXISTS "Users view own payment attempts" ON public.payment_attempts;
CREATE POLICY "Users view own payment attempts"
  ON public.payment_attempts
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Direct inserts/updates from authenticated role disabled (must use secure RPCs / service role)
REVOKE INSERT, UPDATE, DELETE ON public.payment_attempts FROM authenticated, anon;
GRANT ALL ON public.payment_attempts TO service_role;

-- 3. Security Definer Helper RPC: Record Payment Attempt
CREATE OR REPLACE FUNCTION public.create_payment_attempt(
  p_provider_order_id text,
  p_amount numeric,
  p_amount_paise integer,
  p_currency text DEFAULT 'INR',
  p_raw_payload jsonb DEFAULT NULL
)
RETURNS public.payment_attempts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  created_attempt public.payment_attempts;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to create payment attempt';
  END IF;

  IF p_provider_order_id IS NULL OR btrim(p_provider_order_id) = '' THEN
    RAISE EXCEPTION 'Provider order ID required';
  END IF;

  IF p_amount_paise IS NULL OR p_amount_paise <= 0 THEN
    RAISE EXCEPTION 'Invalid payment amount';
  END IF;

  INSERT INTO public.payment_attempts (
    user_id,
    provider,
    provider_order_id,
    amount,
    amount_paise,
    currency,
    status,
    raw_payload
  ) VALUES (
    current_user_id,
    'razorpay',
    p_provider_order_id,
    p_amount,
    p_amount_paise,
    COALESCE(p_currency, 'INR'),
    'created',
    p_raw_payload
  )
  ON CONFLICT (provider_order_id) DO UPDATE
    SET amount = excluded.amount,
        amount_paise = excluded.amount_paise,
        raw_payload = excluded.raw_payload,
        updated_at = now()
  RETURNING * INTO created_attempt;

  RETURN created_attempt;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_payment_attempt(text, numeric, integer, text, jsonb) TO authenticated;

-- 4. Security Definer Helper RPC: Finalize Verified Payment
CREATE OR REPLACE FUNCTION public.finalize_verified_payment(
  p_provider_order_id text,
  p_provider_payment_id text,
  p_provider_signature text,
  p_order_id uuid,
  p_status text DEFAULT 'captured'
)
RETURNS public.payment_attempts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  attempt public.payment_attempts;
  target_order public.orders;
BEGIN
  SELECT * INTO attempt FROM public.payment_attempts
    WHERE provider_order_id = p_provider_order_id FOR UPDATE;

  IF attempt.id IS NULL THEN
    RAISE EXCEPTION 'Payment attempt not found for order ID %', p_provider_order_id;
  END IF;

  -- Ensure attempt belongs to user if authenticated call
  IF current_user_id IS NOT NULL AND attempt.user_id <> current_user_id AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized payment attempt modification';
  END IF;

  -- Update payment attempt record
  UPDATE public.payment_attempts
  SET provider_payment_id = p_provider_payment_id,
      provider_signature = p_provider_signature,
      order_id = COALESCE(p_order_id, attempt.order_id),
      status = p_status,
      updated_at = now()
  WHERE id = attempt.id
  RETURNING * INTO attempt;

  -- If an order exists, update its payment_status and payment_reference
  IF p_order_id IS NOT NULL THEN
    UPDATE public.orders
    SET payment_status = CASE WHEN p_status = 'captured' THEN 'paid' ELSE p_status END,
        payment_reference = p_provider_payment_id,
        updated_at = now()
    WHERE id = p_order_id;
  END IF;

  RETURN attempt;
END;
$$;

GRANT EXECUTE ON FUNCTION public.finalize_verified_payment(text, text, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_verified_payment(text, text, text, uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';
