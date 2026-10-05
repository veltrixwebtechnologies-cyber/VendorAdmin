-- Phase C extension: customer refund eligibility and seller-side refund adjustments.
-- PREPARED — DATABASE VERIFICATION PENDING. Apply only after Phase C 20261004170000.
BEGIN;

DO $requirements$
BEGIN
  IF to_regclass('public.refunds') IS NULL OR to_regclass('public.payment_attempts') IS NULL
     OR to_regclass('public.settlements') IS NULL OR to_regclass('public.admin_audit_logs') IS NULL THEN
    RAISE EXCEPTION 'Phase C refunds, payment attempts, settlements, and audit log are required first';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.refunds
    WHERE status IN ('requested','reviewing','approved','processing')
    GROUP BY order_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Multiple open refund requests exist for an order; review data before adding the one-open-request guard';
  END IF;
  IF to_regclass('public.delivery_assignments') IS NULL OR to_regclass('public.delivery_tracking') IS NULL THEN
    RAISE EXCEPTION 'Delivery assignment/tracking schema is required for the persisted dispute timeline';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='delivery_assignments' AND column_name='accepted_at'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='delivery_assignments' AND column_name='out_for_delivery_at'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='delivery_assignments' AND column_name='picked_up_at'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='delivery_assignments' AND column_name='created_at'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='orders' AND column_name='delivered_at'
  ) THEN
    RAISE EXCEPTION 'Persisted delivery/order timeline columns are missing; review delivery-dispatch migrations before applying Phase C';
  END IF;
END
$requirements$;

ALTER TYPE public.settlement_status ADD VALUE IF NOT EXISTS 'failed';

CREATE UNIQUE INDEX IF NOT EXISTS refunds_one_open_request_per_order
  ON public.refunds(order_id)
  WHERE status IN ('requested','reviewing','approved','processing');

CREATE TABLE IF NOT EXISTS public.seller_financial_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES public.sellers(id) ON DELETE RESTRICT,
  settlement_id uuid REFERENCES public.settlements(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  refund_id uuid NOT NULL UNIQUE REFERENCES public.refunds(id) ON DELETE RESTRICT,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  adjustment_type text NOT NULL DEFAULT 'refund_deduction' CHECK (adjustment_type = 'refund_deduction'),
  status text NOT NULL CHECK (status IN ('deduct_before_payout','recovery_due','unallocated','recovered')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolution_note text
);
CREATE INDEX IF NOT EXISTS seller_financial_adjustments_settlement_idx
  ON public.seller_financial_adjustments(settlement_id, status);
CREATE INDEX IF NOT EXISTS seller_financial_adjustments_seller_idx
  ON public.seller_financial_adjustments(seller_id, status, created_at DESC);

ALTER TABLE public.seller_financial_adjustments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seller_financial_adjustments FROM anon, authenticated;
GRANT SELECT ON public.seller_financial_adjustments TO authenticated;
DROP POLICY IF EXISTS "Seller reads own financial adjustments" ON public.seller_financial_adjustments;
DROP POLICY IF EXISTS "Finance admins read financial adjustments" ON public.seller_financial_adjustments;
CREATE POLICY "Seller reads own financial adjustments" ON public.seller_financial_adjustments
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.sellers s WHERE s.id=seller_id AND s.user_id=auth.uid())
  );
CREATE POLICY "Finance admins read financial adjustments" ON public.seller_financial_adjustments
  FOR SELECT TO authenticated USING (public.has_admin_permission('payouts.view'));

CREATE TABLE IF NOT EXISTS public.refund_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_id uuid NOT NULL REFERENCES public.refunds(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN (
    'requested','reviewing','approved','processing','refunded','partially_refunded','failed','rejected','cancelled'
  )),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (refund_id,status)
);
CREATE INDEX IF NOT EXISTS refund_status_events_order_idx
  ON public.refund_status_events(order_id, created_at DESC);
ALTER TABLE public.refund_status_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.refund_status_events FROM anon, authenticated;
GRANT SELECT ON public.refund_status_events TO authenticated;
DROP POLICY IF EXISTS "Customers read own refund status events" ON public.refund_status_events;
DROP POLICY IF EXISTS "Finance admins read refund status events" ON public.refund_status_events;
CREATE POLICY "Customers read own refund status events" ON public.refund_status_events
  FOR SELECT TO authenticated USING (user_id=auth.uid());
CREATE POLICY "Finance admins read refund status events" ON public.refund_status_events
  FOR SELECT TO authenticated USING (public.has_admin_permission('refunds.view'));

CREATE OR REPLACE FUNCTION public.record_refund_status_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.refund_status_events(refund_id,order_id,user_id,status,created_at)
    VALUES(NEW.id,NEW.order_id,NEW.requested_by,NEW.status,COALESCE(NEW.updated_at,now()))
    ON CONFLICT (refund_id,status) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.record_refund_status_event() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_record_refund_status_event ON public.refunds;
CREATE TRIGGER trg_record_refund_status_event
  AFTER INSERT OR UPDATE OF status ON public.refunds
  FOR EACH ROW EXECUTE FUNCTION public.record_refund_status_event();

-- Preserve a truthful baseline for requests that predate this event ledger.
INSERT INTO public.refund_status_events(refund_id,order_id,user_id,status,created_at)
SELECT id,order_id,requested_by,status,
  CASE WHEN status='requested' THEN requested_at ELSE COALESCE(updated_at,requested_at) END
FROM public.refunds
ON CONFLICT (refund_id,status) DO NOTHING;

CREATE OR REPLACE FUNCTION public.create_refund_seller_adjustment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_settlement public.settlements%ROWTYPE;
  v_match_count integer;
  v_adjustment_status text;
BEGIN
  IF NEW.status NOT IN ('refunded','partially_refunded')
     OR (TG_OP='UPDATE' AND OLD.status IN ('refunded','partially_refunded')) THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id=NEW.order_id;
  SELECT count(*) INTO v_match_count FROM public.settlements s
  WHERE s.seller_id=NEW.seller_id
    AND v_order.placed_at::date BETWEEN s.cycle_start AND s.cycle_end;

  IF v_match_count <> 1 THEN
    v_adjustment_status := 'unallocated';
    v_settlement.id := NULL;
  ELSE
    SELECT * INTO v_settlement FROM public.settlements s
    WHERE s.seller_id=NEW.seller_id
      AND v_order.placed_at::date BETWEEN s.cycle_start AND s.cycle_end
    LIMIT 1;
    v_adjustment_status := CASE WHEN v_settlement.status::text='paid'
      THEN 'recovery_due' ELSE 'deduct_before_payout' END;
  END IF;

  INSERT INTO public.seller_financial_adjustments(
    seller_id,settlement_id,order_id,refund_id,amount,status
  ) VALUES (NEW.seller_id,v_settlement.id,NEW.order_id,NEW.id,NEW.amount,v_adjustment_status)
  ON CONFLICT (refund_id) DO NOTHING;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.create_refund_seller_adjustment() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_create_refund_seller_adjustment ON public.refunds;
CREATE TRIGGER trg_create_refund_seller_adjustment
  AFTER INSERT OR UPDATE OF status ON public.refunds
  FOR EACH ROW EXECUTE FUNCTION public.create_refund_seller_adjustment();

-- Idempotently cover refunds that completed after 1700 was installed but before
-- this adjustment ledger existed. Ambiguous/missing cycle matches stay unallocated.
WITH completed AS (
  SELECT r.seller_id,r.order_id,r.id AS refund_id,r.amount,
    count(s.id) AS matched_cycles,
    (array_agg(s.id) FILTER (WHERE s.id IS NOT NULL))[1] AS settlement_id,
    bool_or(s.status::text='paid') AS has_paid_cycle
  FROM public.refunds r
  JOIN public.orders o ON o.id=r.order_id
  LEFT JOIN public.settlements s ON s.seller_id=r.seller_id
    AND o.placed_at::date BETWEEN s.cycle_start AND s.cycle_end
  WHERE r.status IN ('refunded','partially_refunded')
  GROUP BY r.seller_id,r.order_id,r.id,r.amount
)
INSERT INTO public.seller_financial_adjustments(seller_id,settlement_id,order_id,refund_id,amount,status)
SELECT seller_id,
  CASE WHEN matched_cycles=1 THEN settlement_id ELSE NULL END,
  order_id,refund_id,amount,
  CASE WHEN matched_cycles<>1 THEN 'unallocated'
       WHEN has_paid_cycle THEN 'recovery_due'
       ELSE 'deduct_before_payout' END
FROM completed
ON CONFLICT (refund_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.audit_seller_financial_adjustment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid := auth.uid(); v_role text;
BEGIN
  SELECT role INTO v_role FROM public.admin_access_assignments
  WHERE user_id=v_actor AND status='active';
  INSERT INTO public.admin_audit_logs(actor_id,actor_role,action,resource_type,resource_id,
    new_value,reason,metadata)
  VALUES(v_actor,COALESCE(v_role,CASE WHEN v_actor IS NULL THEN 'SYSTEM' ELSE 'USER' END),
    CASE WHEN TG_OP='INSERT' THEN 'FINANCIAL_ADJUSTMENT_CREATED' ELSE 'FINANCIAL_ADJUSTMENT_CHANGED' END,
    'seller_financial_adjustments',NEW.id::text,
    jsonb_build_object('seller_id',NEW.seller_id,'settlement_id',NEW.settlement_id,
      'order_id',NEW.order_id,'refund_id',NEW.refund_id,'amount',NEW.amount,'status',NEW.status),
    NEW.resolution_note,jsonb_build_object('adjustment_type',NEW.adjustment_type));
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.audit_seller_financial_adjustment() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_audit_seller_financial_adjustment ON public.seller_financial_adjustments;
CREATE TRIGGER trg_audit_seller_financial_adjustment
  AFTER INSERT OR UPDATE ON public.seller_financial_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.audit_seller_financial_adjustment();

CREATE OR REPLACE FUNCTION public.get_customer_refund_eligibility(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_method text;
  v_basis numeric(12,2) := 0;
  v_reserved numeric(12,2) := 0;
  v_open_count integer := 0;
  v_mode text;
  v_reasons jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_order FROM public.orders o
  WHERE o.id=p_order_id AND o.user_id=auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found' USING ERRCODE='42501'; END IF;

  v_method := lower(COALESCE(v_order.payment_method,'cod'));
  IF v_method='cod' THEN
    v_mode := 'manual';
    IF v_order.status::text='delivered' THEN v_basis := v_order.total;
    ELSE v_reasons := v_reasons || jsonb_build_array('COD_REIMBURSEMENT_AFTER_DELIVERY_ONLY'); END IF;
  ELSIF v_method IN ('upi','card') THEN
    v_mode := 'gateway';
    IF v_order.payment_status='paid' THEN
      SELECT pa.amount INTO v_basis FROM public.payment_attempts pa
      WHERE pa.order_id=v_order.id AND pa.status='captured'
      ORDER BY pa.updated_at DESC LIMIT 1;
      IF v_basis IS NULL THEN
        v_basis := 0;
        v_reasons := v_reasons || jsonb_build_array('CAPTURED_PAYMENT_NOT_FOUND');
      END IF;
      IF v_order.status::text NOT IN ('delivered','returned','cancelled','cancelled_by_vendor','delivery_failed') THEN
        v_reasons := v_reasons || jsonb_build_array('ORDER_NOT_REFUND_ELIGIBLE_STATE');
      END IF;
    ELSE
      v_reasons := v_reasons || jsonb_build_array('PAYMENT_NOT_CAPTURED');
    END IF;
  ELSE
    v_mode := NULL;
    v_reasons := v_reasons || jsonb_build_array('UNSUPPORTED_PAYMENT_METHOD');
  END IF;

  SELECT COALESCE(sum(r.amount),0) INTO v_reserved FROM public.refunds r
  WHERE r.order_id=v_order.id AND r.status NOT IN ('rejected','cancelled','failed');
  SELECT count(*) INTO v_open_count FROM public.refunds r
  WHERE r.order_id=v_order.id AND r.status IN ('requested','reviewing','approved','processing');
  IF v_open_count > 0 THEN v_reasons := v_reasons || jsonb_build_array('OPEN_REFUND_EXISTS'); END IF;
  IF GREATEST(0,v_basis-v_reserved) <= 0 THEN v_reasons := v_reasons || jsonb_build_array('NO_REFUNDABLE_BALANCE'); END IF;

  RETURN jsonb_build_object('eligible',jsonb_array_length(v_reasons)=0,
    'mode',v_mode,'refundableAmount',GREATEST(0,v_basis-v_reserved),'reasons',v_reasons);
END $$;
REVOKE ALL ON FUNCTION public.get_customer_refund_eligibility(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_customer_refund_eligibility(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_payout_eligibility(p_settlement_id uuid)
RETURNS TABLE(eligible boolean, reasons jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_settlement public.settlements%ROWTYPE;
  v_seller public.sellers%ROWTYPE;
  v_adjustments numeric(12,2) := 0;
  v_reasons jsonb := '[]'::jsonb;
BEGIN
  IF NOT (public.has_admin_permission('payouts.view') OR public.has_admin_permission('payouts.manage')) THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_settlement FROM public.settlements WHERE id=p_settlement_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Settlement not found'; END IF;
  SELECT * INTO v_seller FROM public.sellers WHERE id=v_settlement.seller_id;
  SELECT COALESCE(sum(amount),0) INTO v_adjustments FROM public.seller_financial_adjustments
    WHERE settlement_id=v_settlement.id AND status='deduct_before_payout';
  IF v_settlement.status::text='paid' THEN v_reasons := v_reasons || jsonb_build_array('ALREADY_PAID'); END IF;
  IF v_settlement.status::text='held' THEN v_reasons := v_reasons || jsonb_build_array('PAYOUT_ON_HOLD'); END IF;
  IF v_settlement.status::text='failed' THEN v_reasons := v_reasons || jsonb_build_array('PAYOUT_FAILED_REQUIRES_REVIEW'); END IF;
  IF v_settlement.net_payout-v_adjustments <= 0 THEN v_reasons := v_reasons || jsonb_build_array('NON_POSITIVE_PAYOUT_AFTER_REFUNDS'); END IF;
  IF v_seller.status::text <> 'approved' THEN v_reasons := v_reasons || jsonb_build_array('SELLER_NOT_ACTIVE'); END IF;
  IF NULLIF(trim(v_seller.bank_account_name),'') IS NULL
     OR NULLIF(trim(v_seller.bank_account_number),'') IS NULL
     OR NULLIF(trim(v_seller.bank_ifsc),'') IS NULL THEN
    v_reasons := v_reasons || jsonb_build_array('SELLER_BANK_DETAILS_INCOMPLETE');
  END IF;
  IF EXISTS (SELECT 1 FROM public.refunds r WHERE r.seller_id=v_settlement.seller_id AND r.status IN ('approved','processing')) THEN
    v_reasons := v_reasons || jsonb_build_array('REFUND_REQUIRES_FINANCE_REVIEW');
  END IF;
  IF EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.vendor_id=v_settlement.seller_id
    AND lower(COALESCE(t.issue_category,'')) IN ('payment','refund')
    AND t.support_stage NOT IN ('RESOLVED','CANCELLED','refunded')) THEN
    v_reasons := v_reasons || jsonb_build_array('FINANCIAL_DISPUTE_OPEN');
  END IF;
  IF EXISTS (SELECT 1 FROM public.seller_financial_adjustments a WHERE a.seller_id=v_settlement.seller_id
    AND a.status IN ('unallocated','recovery_due')) THEN
    v_reasons := v_reasons || jsonb_build_array('REFUND_ADJUSTMENT_REQUIRES_FINANCE_REVIEW');
  END IF;
  RETURN QUERY SELECT jsonb_array_length(v_reasons)=0,v_reasons;
END $$;
REVOKE ALL ON FUNCTION public.get_payout_eligibility(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_payout_eligibility(uuid) TO authenticated;

CREATE TABLE IF NOT EXISTS public.razorpay_refund_webhook_events (
  event_id text PRIMARY KEY,
  refund_id uuid NOT NULL REFERENCES public.refunds(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('refund.created','refund.processed','refund.failed')),
  gateway_refund_id text NOT NULL,
  payload_sha256 text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.razorpay_refund_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.razorpay_refund_webhook_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.razorpay_refund_webhook_events TO service_role;

CREATE OR REPLACE FUNCTION public.begin_gateway_refund(p_refund_id uuid,p_gateway_refund_id text)
RETURNS public.refunds LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_row public.refunds%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Trusted refund processor required' USING ERRCODE='42501'; END IF;
  IF NULLIF(trim(p_gateway_refund_id),'') IS NULL THEN RAISE EXCEPTION 'Gateway refund reference is required'; END IF;
  SELECT * INTO v_row FROM public.refunds WHERE id=p_refund_id FOR UPDATE;
  IF NOT FOUND OR v_row.execution_method <> 'gateway' THEN RAISE EXCEPTION 'Gateway refund not found'; END IF;
  IF v_row.status='processing' AND v_row.gateway_refund_id=trim(p_gateway_refund_id) THEN RETURN v_row; END IF;
  IF v_row.status <> 'approved' THEN RAISE EXCEPTION 'Only approved refunds can begin processing'; END IF;
  UPDATE public.refunds SET status='processing',gateway_refund_id=trim(p_gateway_refund_id),
    processed_at=now(),updated_at=now() WHERE id=p_refund_id RETURNING * INTO v_row;
  RETURN v_row;
END $$;
REVOKE ALL ON FUNCTION public.begin_gateway_refund(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_gateway_refund(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.apply_razorpay_refund_webhook(
  p_event_id text,p_event_type text,p_gateway_refund_id text,p_payload_sha256 text DEFAULT NULL,
  p_failure_reason text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_refund public.refunds%ROWTYPE;
  v_payment_amount numeric(12,2);
  v_completed numeric(12,2);
  v_next_status text;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Trusted webhook processor required' USING ERRCODE='42501'; END IF;
  IF NULLIF(trim(p_event_id),'') IS NULL OR NULLIF(trim(p_gateway_refund_id),'') IS NULL
     OR p_event_type NOT IN ('refund.created','refund.processed','refund.failed') THEN
    RAISE EXCEPTION 'Invalid refund webhook event';
  END IF;
  SELECT * INTO v_refund FROM public.refunds
  WHERE gateway_refund_id=trim(p_gateway_refund_id) FOR UPDATE;
  IF NOT FOUND OR v_refund.execution_method <> 'gateway' THEN RAISE EXCEPTION 'Refund reference not found'; END IF;
  INSERT INTO public.razorpay_refund_webhook_events(event_id,refund_id,event_type,gateway_refund_id,payload_sha256)
  VALUES(p_event_id,v_refund.id,p_event_type,p_gateway_refund_id,p_payload_sha256)
  ON CONFLICT (event_id) DO NOTHING;
  IF NOT FOUND THEN RETURN jsonb_build_object('applied',false,'duplicate',true); END IF;
  IF v_refund.status IN ('refunded','partially_refunded','failed','rejected','cancelled') THEN
    RETURN jsonb_build_object('applied',false,'duplicate',false,'final',true);
  END IF;

  IF p_event_type='refund.created' THEN
    IF v_refund.status NOT IN ('approved','processing') THEN RAISE EXCEPTION 'Refund is not approved for processing'; END IF;
    v_next_status := 'processing';
  ELSIF p_event_type='refund.failed' THEN
    IF v_refund.status NOT IN ('approved','processing') THEN RAISE EXCEPTION 'Refund is not in a failure-eligible state'; END IF;
    v_next_status := 'failed';
  ELSE
    IF v_refund.status NOT IN ('approved','processing') THEN RAISE EXCEPTION 'Refund is not in a completion-eligible state'; END IF;
    SELECT pa.amount INTO v_payment_amount FROM public.payment_attempts pa WHERE pa.id=v_refund.payment_attempt_id;
    SELECT COALESCE(sum(r.amount),0) INTO v_completed FROM public.refunds r
    WHERE r.payment_attempt_id=v_refund.payment_attempt_id AND r.id<>v_refund.id
      AND r.status IN ('refunded','partially_refunded');
    v_next_status := CASE WHEN v_completed+v_refund.amount >= COALESCE(v_payment_amount,0)
      THEN 'refunded' ELSE 'partially_refunded' END;
  END IF;

  UPDATE public.refunds SET status=v_next_status,
    failed_at=CASE WHEN v_next_status='failed' THEN now() ELSE failed_at END,
    failure_reason=CASE WHEN v_next_status='failed' THEN left(NULLIF(trim(p_failure_reason),''),1000) ELSE failure_reason END,
    updated_at=now() WHERE id=v_refund.id;
  IF v_next_status='refunded' THEN
    UPDATE public.orders SET payment_status='refunded',updated_at=now() WHERE id=v_refund.order_id;
    UPDATE public.payment_attempts SET status='refunded',updated_at=now() WHERE id=v_refund.payment_attempt_id;
  END IF;
  RETURN jsonb_build_object('applied',true,'duplicate',false,'status',v_next_status);
END $$;
REVOKE ALL ON FUNCTION public.apply_razorpay_refund_webhook(text,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_razorpay_refund_webhook(text,text,text,text,text) TO service_role;

-- Extend the existing dispute timeline with persisted dispatch/assignment and
-- audited order-status timestamps only; no inferred milestones are added.
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
  SELECT e.created_at,'SUPPORT_STAGE_' || upper(e.to_stage),left(COALESCE(e.note,e.to_stage),200)
    FROM public.support_case_events e WHERE e.ticket_id=p_ticket_id
  UNION ALL
  SELECT o.placed_at,'ORDER_PLACED'::text,'Order placed'
    FROM public.orders o WHERE o.id=v_order_id AND o.placed_at IS NOT NULL
  UNION ALL
  SELECT o.delivered_at,'ORDER_DELIVERED'::text,'Order marked delivered'
    FROM public.orders o WHERE o.id=v_order_id AND o.delivered_at IS NOT NULL
  UNION ALL
  SELECT l.created_at,'ORDER_STATUS_' || upper(COALESCE(l.new_value->>'status','changed')),
    'Order status changed to ' || COALESCE(l.new_value->>'status','unknown')
    FROM public.admin_audit_logs l WHERE l.resource_type='orders'
      AND l.resource_id=v_order_id::text AND l.action='ORDER_STATUS_CHANGED'
  UNION ALL
  SELECT da.created_at,'DISPATCH_CREATED'::text,'Delivery assignment created'
    FROM public.delivery_assignments da WHERE da.order_id=v_order_id
  UNION ALL
  SELECT da.accepted_at,'DELIVERY_ACCEPTED'::text,'Delivery partner accepted assignment'
    FROM public.delivery_assignments da WHERE da.order_id=v_order_id AND da.accepted_at IS NOT NULL
  UNION ALL
  SELECT da.picked_up_at,'ORDER_PICKED_UP'::text,'Order picked up from the Store'
    FROM public.delivery_assignments da WHERE da.order_id=v_order_id AND da.picked_up_at IS NOT NULL
  UNION ALL
  SELECT da.out_for_delivery_at,'OUT_FOR_DELIVERY'::text,'Order marked out for delivery'
    FROM public.delivery_assignments da WHERE da.order_id=v_order_id AND da.out_for_delivery_at IS NOT NULL
  UNION ALL
  SELECT dt.created_at,'DELIVERY_' || upper(dt.status),left(COALESCE(dt.note,dt.status),200)
    FROM public.delivery_tracking dt JOIN public.delivery_assignments da ON da.id=dt.assignment_id
    WHERE da.order_id=v_order_id
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

-- Refund completion is driven by verified webhook events below. Retire the
-- older direct-result helper so an API response cannot be mistaken for a final
-- bank refund or bypass webhook idempotency/status reconciliation.
REVOKE ALL ON FUNCTION public.complete_gateway_refund(uuid,text,boolean,text)
  FROM PUBLIC, anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
