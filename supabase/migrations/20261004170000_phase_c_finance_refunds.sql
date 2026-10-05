-- Phase C finance foundation. Prepared locally; do not apply to production.
-- Sellers remain financial beneficiaries; Store IDs are operational attribution only.
BEGIN;

DO $requirements$
BEGIN
  IF to_regclass('public.orders') IS NULL THEN
    RAISE EXCEPTION 'Missing public.orders (base marketplace migration prerequisite)';
  END IF;
  IF to_regclass('public.payment_attempts') IS NULL THEN
    RAISE EXCEPTION 'Missing public.payment_attempts; review/apply 20260909160000_razorpay_payment_integration.sql in the intended non-production environment first';
  END IF;
  IF to_regclass('public.settlements') IS NULL OR to_regtype('public.settlement_status') IS NULL THEN
    RAISE EXCEPTION 'Missing settlements/settlement_status (base seller settlement migration prerequisite)';
  END IF;
  IF to_regclass('public.support_tickets') IS NULL OR to_regclass('public.support_case_events') IS NULL THEN
    RAISE EXCEPTION 'Missing support tickets/events; review the support-case migrations before Phase C';
  END IF;
  IF to_regclass('public.admin_audit_logs') IS NULL OR to_regclass('public.admin_access_assignments') IS NULL
     OR to_regclass('public.admin_role_permissions') IS NULL
     OR to_regprocedure('public.has_admin_permission(text)') IS NULL THEN
    RAISE EXCEPTION 'Missing Phase A RBAC/audit objects; apply/verify Phase A prerequisites before Phase C';
  END IF;
  IF to_regclass('public.stores') IS NULL THEN
    RAISE EXCEPTION 'Missing public.stores; apply the Phase B1 Store foundation prerequisite before Phase C';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='orders' AND column_name='store_id'
  ) THEN
    RAISE EXCEPTION 'Missing orders.store_id; prerequisite is 20261004140000_phase_b_store_domain.sql (review only in the intended non-production environment)';
  END IF;
END
$requirements$;

-- Add the explicit approval permission without changing applied Phase A history.
INSERT INTO public.admin_role_permissions(role, permission)
VALUES ('SUPER_ADMIN','refunds.approve'), ('FINANCE_ADMIN','refunds.approve')
ON CONFLICT DO NOTHING;

ALTER TABLE public.settlements
  ADD COLUMN IF NOT EXISTS hold_reason text,
  ADD COLUMN IF NOT EXISTS held_at timestamptz,
  ADD COLUMN IF NOT EXISTS held_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS held_from_status text;
ALTER TYPE public.settlement_status ADD VALUE IF NOT EXISTS 'held';

CREATE TABLE IF NOT EXISTS public.refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  payment_attempt_id uuid REFERENCES public.payment_attempts(id) ON DELETE RESTRICT,
  seller_id uuid NOT NULL REFERENCES public.sellers(id) ON DELETE RESTRICT,
  store_id uuid REFERENCES public.stores(id) ON DELETE SET NULL,
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  reason_code text NOT NULL CHECK (reason_code IN (
    'CUSTOMER_CANCELLATION','SELLER_CANCELLATION','OUT_OF_STOCK','DAMAGED_ITEM',
    'WRONG_ITEM','MISSING_ITEM','DELIVERY_FAILURE','DUPLICATE_PAYMENT','OTHER'
  )),
  reason text,
  decision_reason text,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN (
    'requested','reviewing','approved','processing','refunded','partially_refunded',
    'failed','rejected','cancelled'
  )),
  payment_method text NOT NULL CHECK (payment_method IN ('upi','card','cod')),
  execution_method text NOT NULL CHECK (execution_method IN ('gateway','manual')),
  gateway_provider text,
  gateway_refund_id text UNIQUE,
  manual_reference text,
  idempotency_key uuid NOT NULL,
  failure_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  processed_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT refunds_request_idempotency_key UNIQUE (requested_by, idempotency_key),
  CONSTRAINT refunds_manual_gateway_reference CHECK (
    (execution_method = 'gateway' AND manual_reference IS NULL)
    OR (execution_method = 'manual' AND gateway_refund_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS refunds_status_requested_idx ON public.refunds(status, requested_at DESC);
CREATE INDEX IF NOT EXISTS refunds_order_idx ON public.refunds(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS refunds_seller_idx ON public.refunds(seller_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS refunds_store_idx ON public.refunds(store_id) WHERE store_id IS NOT NULL;

ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.refunds FROM anon, authenticated;
GRANT SELECT ON public.refunds TO authenticated;
DROP POLICY IF EXISTS "Customers read own refund requests" ON public.refunds;
DROP POLICY IF EXISTS "Finance admins read refunds" ON public.refunds;
CREATE POLICY "Customers read own refund requests" ON public.refunds
  FOR SELECT TO authenticated USING (requested_by = auth.uid());
CREATE POLICY "Finance admins read refunds" ON public.refunds
  FOR SELECT TO authenticated USING (public.has_admin_permission('refunds.view'));

CREATE OR REPLACE FUNCTION public.request_order_refund(
  p_order_id uuid,
  p_amount numeric,
  p_reason_code text,
  p_reason text,
  p_idempotency_key uuid
) RETURNS public.refunds
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_attempt public.payment_attempts%ROWTYPE;
  v_reserved numeric(12,2);
  v_refundable_total numeric(12,2);
  v_row public.refunds%ROWTYPE;
  v_method text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount <> round(p_amount, 2) THEN
    RAISE EXCEPTION 'Enter a valid refund amount';
  END IF;
  IF p_idempotency_key IS NULL THEN RAISE EXCEPTION 'Request idempotency key is required'; END IF;
  IF p_reason_code NOT IN ('CUSTOMER_CANCELLATION','SELLER_CANCELLATION','OUT_OF_STOCK',
    'DAMAGED_ITEM','WRONG_ITEM','MISSING_ITEM','DELIVERY_FAILURE','DUPLICATE_PAYMENT','OTHER') THEN
    RAISE EXCEPTION 'Invalid refund reason';
  END IF;

  SELECT * INTO v_order FROM public.orders o
  WHERE o.id=p_order_id AND o.user_id=auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_row FROM public.refunds r
  WHERE r.requested_by=auth.uid() AND r.idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_row.order_id <> p_order_id OR v_row.amount <> p_amount THEN
      RAISE EXCEPTION 'Idempotency key was already used for a different refund request';
    END IF;
    RETURN v_row;
  END IF;

  v_method := lower(COALESCE(v_order.payment_method,'cod'));
  IF v_method NOT IN ('upi','card','cod') THEN RAISE EXCEPTION 'Unsupported payment method'; END IF;
  IF v_method = 'cod' THEN
    IF v_order.status::text <> 'delivered' THEN
      RAISE EXCEPTION 'COD reimbursement can only be requested after delivery';
    END IF;
    v_attempt := NULL;
  ELSE
    IF v_order.payment_status <> 'paid' THEN RAISE EXCEPTION 'Only captured payments can be refunded'; END IF;
    SELECT * INTO v_attempt FROM public.payment_attempts pa
    WHERE pa.order_id=v_order.id AND pa.status='captured'
    ORDER BY pa.updated_at DESC LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Captured gateway payment was not found'; END IF;
    v_refundable_total := v_attempt.amount;
  END IF;
  IF v_method='cod' THEN v_refundable_total := v_order.total; END IF;

  SELECT COALESCE(sum(r.amount),0) INTO v_reserved FROM public.refunds r
  WHERE r.order_id=v_order.id AND r.status NOT IN ('rejected','cancelled','failed');
  IF p_amount > GREATEST(0, v_refundable_total - v_reserved) THEN
    RAISE EXCEPTION 'Refund amount exceeds the remaining refundable balance';
  END IF;
  INSERT INTO public.refunds(order_id,payment_attempt_id,seller_id,store_id,requested_by,
    amount,reason_code,reason,payment_method,execution_method,gateway_provider,idempotency_key)
  VALUES(v_order.id, CASE WHEN v_method='cod' THEN NULL ELSE v_attempt.id END,
    v_order.seller_id, v_order.store_id, auth.uid(), p_amount, p_reason_code,
    left(NULLIF(trim(p_reason),''),1000), v_method,
    CASE WHEN v_method='cod' THEN 'manual' ELSE 'gateway' END,
    CASE WHEN v_method='cod' THEN NULL ELSE v_attempt.provider END, p_idempotency_key)
  RETURNING * INTO v_row;
  RETURN v_row;
END $$;
REVOKE ALL ON FUNCTION public.request_order_refund(uuid,numeric,text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_order_refund(uuid,numeric,text,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_transition_refund(
  p_refund_id uuid, p_action text, p_reason text DEFAULT NULL
) RETURNS public.refunds
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_row public.refunds%ROWTYPE; v_next text;
BEGIN
  IF NOT public.has_admin_permission('refunds.manage') THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_row FROM public.refunds WHERE id=p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Refund request not found'; END IF;
  IF p_action='review' AND v_row.status='requested' THEN v_next := 'reviewing';
  ELSIF p_action='approve' AND v_row.status IN ('requested','reviewing') THEN
    IF NOT public.has_admin_permission('refunds.approve') THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
    v_next := 'approved';
  ELSIF p_action='reject' AND v_row.status IN ('requested','reviewing') THEN v_next := 'rejected';
  ELSE RAISE EXCEPTION 'Invalid refund status transition'; END IF;
  IF v_next='rejected' AND NULLIF(trim(p_reason),'') IS NULL THEN
    RAISE EXCEPTION 'A reason is required to reject a refund';
  END IF;
  UPDATE public.refunds SET status=v_next,
    approved_by=CASE WHEN v_next='approved' THEN auth.uid() ELSE approved_by END,
    approved_at=CASE WHEN v_next='approved' THEN now() ELSE approved_at END,
    decision_reason=left(NULLIF(trim(p_reason),''),1000),
    failure_reason=CASE WHEN v_next='rejected' THEN left(NULLIF(trim(p_reason),''),1000) ELSE NULL END,
    updated_at=now()
  WHERE id=p_refund_id RETURNING * INTO v_row;
  RETURN v_row;
END $$;
REVOKE ALL ON FUNCTION public.admin_transition_refund(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_transition_refund(uuid,text,text) TO authenticated;

-- COD reimbursement is manual: an administrator must enter a real external reference.
CREATE OR REPLACE FUNCTION public.record_manual_cod_refund(p_refund_id uuid, p_reference text)
RETURNS public.refunds
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_row public.refunds%ROWTYPE; v_total numeric(12,2); v_order_total numeric(12,2);
BEGIN
  IF NOT public.has_admin_permission('refunds.manage') OR NOT public.has_admin_permission('refunds.approve') THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501';
  END IF;
  IF NULLIF(trim(p_reference),'') IS NULL THEN RAISE EXCEPTION 'Enter the verified manual reimbursement reference'; END IF;
  SELECT * INTO v_row FROM public.refunds WHERE id=p_refund_id FOR UPDATE;
  IF NOT FOUND OR v_row.payment_method <> 'cod' OR v_row.execution_method <> 'manual' OR v_row.status <> 'approved' THEN
    RAISE EXCEPTION 'Only approved COD reimbursements can be recorded';
  END IF;
  UPDATE public.refunds SET manual_reference=left(trim(p_reference),160), status='refunded',
    processed_at=now(), updated_at=now() WHERE id=p_refund_id RETURNING * INTO v_row;
  SELECT COALESCE(sum(amount),0) INTO v_total FROM public.refunds
  WHERE order_id=v_row.order_id AND status IN ('refunded','partially_refunded');
  SELECT total INTO v_order_total FROM public.orders WHERE id=v_row.order_id;
  IF v_total >= v_order_total THEN
    UPDATE public.orders SET payment_status='refunded', updated_at=now() WHERE id=v_row.order_id;
  END IF;
  RETURN v_row;
END $$;
REVOKE ALL ON FUNCTION public.record_manual_cod_refund(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_manual_cod_refund(uuid,text) TO authenticated;

-- Gateway completion is only callable by trusted server/service-role code.
-- No Razorpay refund endpoint is wired in this phase; approval never implies success.
CREATE OR REPLACE FUNCTION public.complete_gateway_refund(
  p_refund_id uuid, p_gateway_refund_id text, p_succeeded boolean, p_failure_reason text DEFAULT NULL
) RETURNS public.refunds
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_row public.refunds%ROWTYPE; v_total numeric(12,2); v_refundable_total numeric(12,2);
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Trusted refund processor required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_row FROM public.refunds WHERE id=p_refund_id FOR UPDATE;
  IF NOT FOUND OR v_row.execution_method <> 'gateway' THEN RAISE EXCEPTION 'Gateway refund not found'; END IF;
  IF v_row.status IN ('refunded','partially_refunded','failed') THEN RETURN v_row; END IF;
  IF v_row.status <> 'approved' AND v_row.status <> 'processing' THEN RAISE EXCEPTION 'Refund is not approved for processing'; END IF;
  IF p_succeeded AND NULLIF(trim(p_gateway_refund_id),'') IS NULL THEN RAISE EXCEPTION 'Gateway refund reference is required'; END IF;
  IF p_succeeded AND v_row.gateway_refund_id IS NOT NULL AND v_row.gateway_refund_id <> trim(p_gateway_refund_id) THEN
    RAISE EXCEPTION 'Refund already has a different gateway reference';
  END IF;
  IF p_succeeded THEN
    UPDATE public.refunds SET gateway_refund_id=trim(p_gateway_refund_id),status='processing',processed_at=now(),updated_at=now()
    WHERE id=p_refund_id RETURNING * INTO v_row;
    SELECT COALESCE(sum(amount),0) INTO v_total FROM public.refunds
    WHERE order_id=v_row.order_id AND status IN ('refunded','partially_refunded','processing');
    SELECT amount INTO v_refundable_total FROM public.payment_attempts WHERE id=v_row.payment_attempt_id;
    UPDATE public.refunds SET status=CASE WHEN v_total >= v_refundable_total THEN 'refunded' ELSE 'partially_refunded' END,
      updated_at=now() WHERE id=p_refund_id RETURNING * INTO v_row;
    IF v_total >= v_refundable_total THEN
      UPDATE public.orders SET payment_status='refunded',updated_at=now() WHERE id=v_row.order_id;
      UPDATE public.payment_attempts SET status='refunded',updated_at=now() WHERE id=v_row.payment_attempt_id;
    END IF;
  ELSE
    UPDATE public.refunds SET status='failed',failed_at=now(),failure_reason=left(NULLIF(trim(p_failure_reason),''),1000),updated_at=now()
    WHERE id=p_refund_id RETURNING * INTO v_row;
  END IF;
  RETURN v_row;
END $$;
REVOKE ALL ON FUNCTION public.complete_gateway_refund(uuid,text,boolean,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_gateway_refund(uuid,text,boolean,text) TO service_role;

-- Audit writes are trigger-only; clients cannot forge or edit financial history.
CREATE OR REPLACE FUNCTION public.audit_finance_refund()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_old jsonb; v_new jsonb; v_action text; v_actor uuid := auth.uid(); v_role text;
BEGIN
  v_old := CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  v_new := CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  IF TG_OP='INSERT' THEN v_action := 'REFUND_REQUESTED';
  ELSIF v_old->>'status' IS DISTINCT FROM v_new->>'status' THEN
    v_action := CASE v_new->>'status'
      WHEN 'approved' THEN 'REFUND_APPROVED' WHEN 'rejected' THEN 'REFUND_REJECTED'
      WHEN 'processing' THEN 'REFUND_PROCESSING_STARTED' WHEN 'refunded' THEN 'REFUND_COMPLETED'
      WHEN 'partially_refunded' THEN 'REFUND_COMPLETED' WHEN 'failed' THEN 'REFUND_FAILED'
      ELSE 'REFUND_STATUS_CHANGED' END;
  ELSE v_action := 'REFUND_UPDATED'; END IF;
  SELECT role INTO v_role FROM public.admin_access_assignments WHERE user_id=v_actor AND status='active';
  INSERT INTO public.admin_audit_logs(actor_id,actor_name,actor_email,actor_role,action,resource_type,resource_id,
    previous_value,new_value,reason,metadata)
  SELECT v_actor,COALESCE(p.display_name,u.email),u.email,COALESCE(v_role,CASE WHEN v_actor IS NULL THEN 'SYSTEM' ELSE 'CUSTOMER' END),
    v_action,'refunds',COALESCE(v_new->>'id',v_old->>'id'),
    CASE WHEN v_old IS NULL THEN NULL ELSE jsonb_build_object('status',v_old->'status','amount',v_old->'amount') END,
    CASE WHEN v_new IS NULL THEN NULL ELSE jsonb_build_object('status',v_new->'status','amount',v_new->'amount','order_id',v_new->'order_id','seller_id',v_new->'seller_id') END,
    COALESCE(v_new->>'decision_reason',v_new->>'failure_reason',v_new->>'reason'),jsonb_build_object('payment_method',COALESCE(v_new->>'payment_method',v_old->>'payment_method'))
  FROM (SELECT 1) seed LEFT JOIN auth.users u ON u.id=v_actor LEFT JOIN public.profiles p ON p.id=u.id;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.audit_finance_refund() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_audit_finance_refund ON public.refunds;
CREATE TRIGGER trg_audit_finance_refund AFTER INSERT OR UPDATE ON public.refunds
FOR EACH ROW EXECUTE FUNCTION public.audit_finance_refund();

-- Restrict settlement writes to reason-bearing RPCs. Sellers retain their existing SELECT policy.
REVOKE INSERT, UPDATE, DELETE ON public.settlements FROM authenticated, anon;

CREATE OR REPLACE FUNCTION public.get_payout_eligibility(p_settlement_id uuid)
RETURNS TABLE(eligible boolean, reasons jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_settlement public.settlements%ROWTYPE; v_seller public.sellers%ROWTYPE; v_reasons jsonb := '[]'::jsonb;
BEGIN
  IF NOT (public.has_admin_permission('payouts.view') OR public.has_admin_permission('payouts.manage')) THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_settlement FROM public.settlements WHERE id=p_settlement_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Settlement not found'; END IF;
  SELECT * INTO v_seller FROM public.sellers WHERE id=v_settlement.seller_id;
  IF v_settlement.status::text='paid' THEN v_reasons := v_reasons || jsonb_build_array('ALREADY_PAID'); END IF;
  IF v_settlement.status::text='held' THEN v_reasons := v_reasons || jsonb_build_array('PAYOUT_ON_HOLD'); END IF;
  IF v_settlement.net_payout <= 0 THEN v_reasons := v_reasons || jsonb_build_array('NON_POSITIVE_PAYOUT'); END IF;
  IF NULLIF(trim(v_seller.bank_account_name),'') IS NULL
     OR NULLIF(trim(v_seller.bank_account_number),'') IS NULL
     OR NULLIF(trim(v_seller.bank_ifsc),'') IS NULL THEN
    v_reasons := v_reasons || jsonb_build_array('SELLER_BANK_DETAILS_INCOMPLETE');
  END IF;
  IF EXISTS (SELECT 1 FROM public.refunds r WHERE r.seller_id=v_settlement.seller_id AND r.status IN ('approved','processing')) THEN
    v_reasons := v_reasons || jsonb_build_array('REFUND_REQUIRES_FINANCE_REVIEW');
  END IF;
  IF EXISTS (SELECT 1 FROM public.support_tickets t
    WHERE t.vendor_id=v_settlement.seller_id
      AND lower(COALESCE(t.issue_category,'')) IN ('payment','refund')
      AND t.support_stage NOT IN ('RESOLVED','CANCELLED','refunded')) THEN
    v_reasons := v_reasons || jsonb_build_array('FINANCIAL_DISPUTE_OPEN');
  END IF;
  RETURN QUERY SELECT jsonb_array_length(v_reasons)=0, v_reasons;
END $$;
REVOKE ALL ON FUNCTION public.get_payout_eligibility(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_payout_eligibility(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.manage_settlement_hold(p_settlement_id uuid,p_action text,p_reason text DEFAULT NULL)
RETURNS public.settlements
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_row public.settlements%ROWTYPE; v_eligibility record;
BEGIN
  IF NOT public.has_admin_permission('payouts.manage') THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_row FROM public.settlements WHERE id=p_settlement_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Settlement not found'; END IF;
  PERFORM set_config('app.admin_audit_reason',COALESCE(NULLIF(trim(p_reason),''),p_action),true);
  IF p_action='hold' THEN
    IF v_row.status::text='paid' THEN RAISE EXCEPTION 'Paid settlements cannot be held'; END IF;
    IF NULLIF(trim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'A reason is required to hold a payout'; END IF;
    UPDATE public.settlements SET held_from_status=CASE WHEN status::text='held' THEN held_from_status ELSE status::text END,
      status='held',hold_reason=left(trim(p_reason),1000),held_at=now(),held_by=auth.uid(),updated_at=now()
    WHERE id=p_settlement_id RETURNING * INTO v_row;
  ELSIF p_action='release' THEN
    IF v_row.status::text<>'held' THEN RAISE EXCEPTION 'Settlement is not on hold'; END IF;
    SELECT * INTO v_eligibility FROM public.get_payout_eligibility(p_settlement_id);
    IF (v_eligibility.reasons - 'PAYOUT_ON_HOLD') <> '[]'::jsonb THEN
      RAISE EXCEPTION 'Payout is not eligible: %',v_eligibility.reasons;
    END IF;
    UPDATE public.settlements SET status=COALESCE(NULLIF(held_from_status,'held')::public.settlement_status,'pending'),
      hold_reason=NULL,held_at=NULL,held_by=NULL,held_from_status=NULL,updated_at=now()
    WHERE id=p_settlement_id RETURNING * INTO v_row;
  ELSE RAISE EXCEPTION 'Unsupported payout action'; END IF;
  RETURN v_row;
END $$;
REVOKE ALL ON FUNCTION public.manage_settlement_hold(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manage_settlement_hold(uuid,text,text) TO authenticated;

-- Disputes remain existing order-linked support tickets; expose only safe case
-- summaries/timeline to support.view admins instead of creating another system.
CREATE OR REPLACE FUNCTION public.get_admin_order_disputes()
RETURNS TABLE(ticket_id uuid, case_number text, order_id uuid, order_number text,
  seller_id uuid, store_id uuid, subject text, issue_category text,
  issue_type text, support_stage text, ticket_status text, priority text,
  created_at timestamptz, updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.has_admin_permission('support.view') THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
  SELECT t.id,t.case_number,t.order_id,o.order_number,
    COALESCE(t.vendor_id,o.seller_id),o.store_id,t.subject,t.issue_category,t.issue_type,
    t.support_stage,t.status,t.priority,t.created_at,t.updated_at
  FROM public.support_tickets t
  LEFT JOIN public.orders o ON o.id=t.order_id
  WHERE t.order_id IS NOT NULL AND (t.issue_category IS NOT NULL OR t.issue_type IS NOT NULL)
  ORDER BY t.updated_at DESC LIMIT 500;
END $$;
REVOKE ALL ON FUNCTION public.get_admin_order_disputes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_order_disputes() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_admin_dispute_timeline(p_ticket_id uuid)
RETURNS TABLE(event_at timestamptz, event_type text, description text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_order_id uuid;
BEGIN
  IF NOT public.has_admin_permission('support.view') THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501';
  END IF;
  SELECT order_id INTO v_order_id FROM public.support_tickets
  WHERE id=p_ticket_id AND order_id IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order dispute not found'; END IF;
  RETURN QUERY
  SELECT t.created_at,'CASE_OPENED'::text,left(t.subject,200)
    FROM public.support_tickets t WHERE t.id=p_ticket_id
  UNION ALL
  SELECT e.created_at,'SUPPORT_' || upper(e.action),left(COALESCE(e.note,e.to_stage),200)
    FROM public.support_case_events e WHERE e.ticket_id=p_ticket_id
  UNION ALL
  SELECT o.placed_at,'ORDER_PLACED'::text,'Order placed'
    FROM public.orders o WHERE o.id=v_order_id AND o.placed_at IS NOT NULL
  UNION ALL
  SELECT o.delivered_at,'ORDER_DELIVERED'::text,'Order marked delivered'
    FROM public.orders o WHERE o.id=v_order_id AND o.delivered_at IS NOT NULL
  UNION ALL
  SELECT pa.created_at,'PAYMENT_' || upper(pa.status),'Payment attempt ' || pa.status
    FROM public.payment_attempts pa WHERE pa.order_id=v_order_id
  UNION ALL
  SELECT r.requested_at,'REFUND_REQUESTED','Refund request · INR ' || r.amount::text
    FROM public.refunds r WHERE r.order_id=v_order_id
  UNION ALL
  SELECT r.approved_at,'REFUND_APPROVED','Refund approved · INR ' || r.amount::text
    FROM public.refunds r WHERE r.order_id=v_order_id AND r.approved_at IS NOT NULL
  UNION ALL
  SELECT r.processed_at,CASE WHEN r.status='processing' THEN 'REFUND_PROCESSING_STARTED' ELSE 'REFUND_COMPLETED' END,
    'Refund ' || r.status || ' · INR ' || r.amount::text
    FROM public.refunds r WHERE r.order_id=v_order_id AND r.processed_at IS NOT NULL
  UNION ALL
  SELECT r.failed_at,'REFUND_FAILED','Refund failed · INR ' || r.amount::text
    FROM public.refunds r WHERE r.order_id=v_order_id AND r.failed_at IS NOT NULL
  UNION ALL
  SELECT r.updated_at,'REFUND_REJECTED','Refund rejected · INR ' || r.amount::text
    FROM public.refunds r WHERE r.order_id=v_order_id AND r.status='rejected'
  ORDER BY 1 DESC NULLS LAST LIMIT 100;
END $$;
REVOKE ALL ON FUNCTION public.get_admin_dispute_timeline(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_dispute_timeline(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
