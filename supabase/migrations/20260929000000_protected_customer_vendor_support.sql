-- LocalShore protected customer <-> vendor support bridge.
-- Keep support_tickets as the existing support-case source of truth.

ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS case_number text,
  ADD COLUMN IF NOT EXISTS vendor_id uuid REFERENCES public.sellers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delivery_partner_id uuid REFERENCES public.delivery_partners(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS issue_category text,
  ADD COLUMN IF NOT EXISTS affected_order_item_id uuid REFERENCES public.order_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolution_type text,
  ADD COLUMN IF NOT EXISTS response_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS escalation_notified_at timestamptz;

UPDATE public.support_tickets
SET case_number = 'LS' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
WHERE case_number IS NULL;

ALTER TABLE public.support_tickets
  ALTER COLUMN case_number SET DEFAULT ('LS' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  ALTER COLUMN case_number SET NOT NULL,
  ALTER COLUMN support_stage SET DEFAULT 'OPEN';

CREATE UNIQUE INDEX IF NOT EXISTS support_tickets_case_number_uidx
  ON public.support_tickets(case_number);
CREATE INDEX IF NOT EXISTS support_tickets_vendor_stage_idx
  ON public.support_tickets(vendor_id, support_stage, created_at DESC);
CREATE INDEX IF NOT EXISTS support_tickets_partner_idx
  ON public.support_tickets(delivery_partner_id, created_at DESC)
  WHERE delivery_partner_id IS NOT NULL;

-- Attach historic order-linked tickets to the actual shop/assigned partner so
-- they become visible to the correct protected participants.
UPDATE public.support_tickets t
SET vendor_id = o.seller_id,
    delivery_partner_id = COALESCE(t.delivery_partner_id, o.assigned_partner_id)
FROM public.orders o
WHERE t.order_id = o.id
  AND (t.vendor_id IS NULL OR (t.delivery_partner_id IS NULL AND o.assigned_partner_id IS NOT NULL));

ALTER TABLE public.support_tickets
  DROP CONSTRAINT IF EXISTS support_tickets_support_stage_check;
ALTER TABLE public.support_tickets
  ADD CONSTRAINT support_tickets_support_stage_check CHECK (support_stage IN (
    'OPEN', 'CUSTOMER_RESPONDED', 'WAITING_FOR_VENDOR', 'VENDOR_RESPONDED',
    'RESOLUTION_PROPOSED', 'CUSTOMER_CONFIRMATION', 'RESOLVED', 'ESCALATED',
    'CANCELLED', 'REOPENED',
    'submitted', 'under_review', 'awaiting_shop_response', 'approved',
    'rejected', 'refund_initiated', 'refunded', 'replacement_approved',
    'replacement_delivered'
  ));

ALTER TABLE public.ticket_messages
  ADD COLUMN IF NOT EXISTS sender_role text,
  ADD COLUMN IF NOT EXISTS attachments text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS visible_to_customer boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS visible_to_vendor boolean NOT NULL DEFAULT true;

UPDATE public.ticket_messages m
SET sender_role = CASE
  WHEN m.is_admin THEN 'customer_care'
  WHEN EXISTS (
    SELECT 1 FROM public.support_tickets t
    JOIN public.sellers s ON s.id = t.vendor_id
    WHERE t.id = m.ticket_id AND s.user_id = m.author_id
  ) THEN 'vendor'
  ELSE 'customer'
END
WHERE m.sender_role IS NULL;

ALTER TABLE public.ticket_messages
  ALTER COLUMN sender_role SET DEFAULT 'customer',
  ALTER COLUMN sender_role SET NOT NULL;
ALTER TABLE public.ticket_messages
  DROP CONSTRAINT IF EXISTS ticket_messages_sender_role_check;
ALTER TABLE public.ticket_messages
  ADD CONSTRAINT ticket_messages_sender_role_check CHECK (
    sender_role IN ('customer', 'vendor', 'customer_care', 'delivery_partner', 'system')
  );

ALTER TABLE public.support_case_events
  ADD COLUMN IF NOT EXISTS actor_role text,
  ADD COLUMN IF NOT EXISTS action text;
UPDATE public.support_case_events
SET actor_role = COALESCE(actor_role, 'customer_care'),
    action = COALESCE(action, 'status_changed');

-- Contact details typed into support messages are removed before persistence,
-- so a case conversation cannot be used to disclose private phone/email data.
CREATE OR REPLACE FUNCTION public.redact_support_contact_details(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT left(
    regexp_replace(
      regexp_replace(
        regexp_replace(COALESCE(p_value, ''),
          '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}', '[email hidden]', 'gi'),
        '(\+?[0-9][0-9[:space:]().-]{7,}[0-9])', '[phone hidden]', 'g'),
      '(?i)(password|one[- ]time code|otp|cvv|cvc|card number|bank account)[[:space:]]*[:#-]?[[:space:]]*[[:alnum:]-]+',
      '[private detail hidden]', 'g'),
    2000)
$$;

UPDATE public.ticket_messages
SET body = public.redact_support_contact_details(body)
WHERE body IS NOT NULL;

-- Preserve the original description in historic cases when they have no
-- thread yet. Do not duplicate tickets that already have a message history.
INSERT INTO public.ticket_messages(ticket_id, author_id, is_admin, sender_role, body, attachments)
SELECT t.id, t.user_id,
  public.has_role(t.user_id, 'admin'::public.app_role),
  CASE
    WHEN public.has_role(t.user_id, 'admin'::public.app_role) THEN 'customer_care'
    WHEN EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = t.vendor_id AND s.user_id = t.user_id) THEN 'vendor'
    ELSE 'customer'
  END,
  public.redact_support_contact_details(COALESCE(NULLIF(t.customer_comment, ''), t.body)),
  COALESCE(t.evidence_urls, '{}')
FROM public.support_tickets t
WHERE NULLIF(trim(COALESCE(t.customer_comment, t.body, '')), '') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.ticket_messages m WHERE m.ticket_id = t.id);

CREATE OR REPLACE FUNCTION public.is_protected_support_participant(p_ticket_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.support_tickets t
    WHERE t.id = p_ticket_id
      AND (
        t.user_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = t.vendor_id AND s.user_id = auth.uid())
        OR EXISTS (SELECT 1 FROM public.delivery_partners dp WHERE dp.id = t.delivery_partner_id AND dp.user_id = auth.uid())
        OR public.has_role(auth.uid(), 'admin'::public.app_role)
      )
  )
$$;
REVOKE ALL ON FUNCTION public.is_protected_support_participant(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_protected_support_participant(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_customer_support_case(
  p_order_id uuid DEFAULT NULL,
  p_issue_category text DEFAULT 'other',
  p_issue_type text DEFAULT 'other',
  p_affected_order_item_id uuid DEFAULT NULL,
  p_initial_message text DEFAULT '',
  p_evidence_paths text[] DEFAULT '{}'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, storage, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_vendor_id uuid;
  v_partner_id uuid;
  v_order_number text;
  v_order_item_name text;
  v_ticket_id uuid;
  v_body text;
  v_subject text;
  v_stage text;
  v_path text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Sign in to contact Customer Care'; END IF;
  IF length(COALESCE(p_issue_category, '')) > 80 OR length(COALESCE(p_issue_type, '')) > 80 THEN
    RAISE EXCEPTION 'Invalid support issue';
  END IF;
  IF cardinality(COALESCE(p_evidence_paths, '{}')) > 6 THEN RAISE EXCEPTION 'Attach up to six files'; END IF;

  IF p_order_id IS NOT NULL THEN
    SELECT o.seller_id, o.order_number, o.assigned_partner_id
      INTO v_vendor_id, v_order_number, v_partner_id
    FROM public.orders o
    WHERE o.id = p_order_id AND o.user_id = v_user_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Order not found for your account'; END IF;
    IF p_affected_order_item_id IS NOT NULL THEN
      SELECT oi.product_name INTO v_order_item_name
      FROM public.order_items oi
      WHERE oi.id = p_affected_order_item_id AND oi.order_id = p_order_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'That item does not belong to this order'; END IF;
    END IF;
  ELSIF p_affected_order_item_id IS NOT NULL THEN
    RAISE EXCEPTION 'Choose an order before selecting an item';
  END IF;

  FOREACH v_path IN ARRAY COALESCE(p_evidence_paths, '{}') LOOP
    IF (storage.foldername(v_path))[1] IS DISTINCT FROM v_user_id::text THEN
      RAISE EXCEPTION 'Evidence must belong to your account';
    END IF;
  END LOOP;

  v_body := public.redact_support_contact_details(trim(COALESCE(p_initial_message, '')));
  IF length(v_body) < 3 THEN RAISE EXCEPTION 'Add a short description of the issue'; END IF;
  v_subject := left(initcap(replace(COALESCE(NULLIF(p_issue_category, ''), 'other'), '_', ' ')) ||
    CASE WHEN v_order_number IS NULL THEN '' ELSE ' · ' || v_order_number END, 180);
  -- A new customer message is private to Customer Care until staff forwards it.
  v_stage := 'OPEN';

  INSERT INTO public.support_tickets (
    user_id, raised_by, subject, body, priority, status, order_id, issue_category,
    issue_type, affected_order_item_id, vendor_id, delivery_partner_id,
    support_stage, selected_product_ids, evidence_urls, customer_comment,
    response_due_at
  ) VALUES (
    v_user_id, 'customer', v_subject, v_body,
    CASE WHEN p_issue_category IN ('payment', 'refund') THEN 'high' ELSE 'normal' END,
    'open', p_order_id, COALESCE(NULLIF(p_issue_category, ''), 'other'),
    COALESCE(NULLIF(p_issue_type, ''), 'other'), p_affected_order_item_id,
    v_vendor_id, v_partner_id, v_stage, '{}', COALESCE(p_evidence_paths, '{}'),
    v_body, now() + interval '4 hours'
  ) RETURNING id INTO v_ticket_id;

  INSERT INTO public.ticket_messages(ticket_id, author_id, is_admin, sender_role, body, attachments,
    visible_to_customer, visible_to_vendor)
  VALUES (v_ticket_id, v_user_id, false, 'customer', v_body, COALESCE(p_evidence_paths, '{}'), true, false);

  INSERT INTO public.support_case_events(ticket_id, actor_id, actor_role, action, to_stage, note)
  VALUES (v_ticket_id, v_user_id, 'customer', 'case_created', v_stage,
    concat_ws(' · ', v_order_number, v_order_item_name, p_issue_type));
  RETURN v_ticket_id;
END
$$;

CREATE OR REPLACE FUNCTION public.get_protected_support_cases()
RETURNS TABLE (
  id uuid, case_number text, order_id uuid, order_number text, shop_name text,
  subject text, issue_category text, issue_type text, affected_item_name text,
  support_stage text, status text, resolution_type text, created_at timestamptz,
  updated_at timestamptz, response_due_at timestamptz, viewer_role text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  RETURN QUERY
  SELECT t.id, t.case_number, t.order_id, o.order_number,
    CASE WHEN t.user_id = auth.uid() THEN s.business_name ELSE NULL END,
    t.subject, t.issue_category, t.issue_type, oi.product_name,
    t.support_stage, t.status, t.resolution_type, t.created_at, t.updated_at,
    t.response_due_at,
    CASE WHEN public.has_role(auth.uid(), 'admin'::public.app_role) THEN 'customer_care'
      WHEN t.user_id = auth.uid() THEN 'customer'
      WHEN EXISTS (SELECT 1 FROM public.sellers sx WHERE sx.id = t.vendor_id AND sx.user_id = auth.uid()) THEN 'vendor'
      ELSE 'delivery_partner' END
  FROM public.support_tickets t
  LEFT JOIN public.orders o ON o.id = t.order_id
  LEFT JOIN public.sellers s ON s.id = t.vendor_id
  LEFT JOIN public.order_items oi ON oi.id = t.affected_order_item_id
  WHERE t.user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.sellers sx WHERE sx.id = t.vendor_id AND sx.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.delivery_partners dp WHERE dp.id = t.delivery_partner_id AND dp.user_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  ORDER BY t.updated_at DESC;
END
$$;

DROP FUNCTION IF EXISTS public.get_protected_support_messages(uuid);
CREATE FUNCTION public.get_protected_support_messages(p_ticket_id uuid)
RETURNS TABLE (id uuid, sender_role text, body text, attachments text[], created_at timestamptz,
  visible_to_customer boolean, visible_to_vendor boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
BEGIN
  IF NOT public.is_protected_support_participant(p_ticket_id) THEN
    RAISE EXCEPTION 'Support case not found or access denied';
  END IF;
  RETURN QUERY
  SELECT m.id, m.sender_role, m.body, m.attachments, m.created_at,
    m.visible_to_customer, m.visible_to_vendor
  FROM public.ticket_messages m
  WHERE m.ticket_id = p_ticket_id
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR (m.sender_role = 'customer' AND m.visible_to_customer)
      OR (m.sender_role IN ('vendor', 'delivery_partner') AND m.visible_to_vendor)
      OR (m.sender_role IN ('customer_care', 'system') AND (
        m.visible_to_customer OR m.visible_to_vendor OR public.has_role(auth.uid(), 'admin'::public.app_role)
      ))
    )
  ORDER BY m.created_at ASC;
END
$$;

CREATE OR REPLACE FUNCTION public.forward_protected_support_message(
  p_ticket_id uuid, p_message_id uuid, p_target_role text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_message public.ticket_messages%ROWTYPE;
  v_ticket public.support_tickets%ROWTYPE;
  v_from_stage text;
  v_to_stage text;
BEGIN
  IF v_user_id IS NULL OR NOT public.has_role(v_user_id, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Customer Care staff access required';
  END IF;
  IF p_target_role NOT IN ('customer', 'vendor') THEN RAISE EXCEPTION 'Invalid message recipient'; END IF;
  SELECT * INTO v_message FROM public.ticket_messages
    WHERE id = p_message_id AND ticket_id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Support message not found'; END IF;
  SELECT * INTO v_ticket FROM public.support_tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Support case not found'; END IF;
  IF p_target_role = 'customer' THEN
    IF v_message.sender_role NOT IN ('vendor', 'delivery_partner') THEN
      RAISE EXCEPTION 'Only a shop or assigned delivery partner message can be shared with the customer';
    END IF;
    UPDATE public.ticket_messages SET visible_to_customer = true WHERE id = p_message_id;
    v_to_stage := CASE WHEN v_ticket.support_stage = 'RESOLUTION_PROPOSED'
      THEN 'CUSTOMER_CONFIRMATION' ELSE v_ticket.support_stage END;
    IF v_to_stage <> v_ticket.support_stage THEN
      UPDATE public.support_tickets SET support_stage = v_to_stage, updated_at = now() WHERE id = p_ticket_id;
    END IF;
  ELSE
    IF v_ticket.vendor_id IS NULL THEN RAISE EXCEPTION 'This support case has no linked shop'; END IF;
    IF v_message.sender_role <> 'customer' THEN
      RAISE EXCEPTION 'Only a customer message can be shared with the shop';
    END IF;
    UPDATE public.ticket_messages SET visible_to_vendor = true WHERE id = p_message_id;
    v_to_stage := CASE WHEN v_ticket.support_stage IN ('OPEN', 'CUSTOMER_RESPONDED')
      THEN 'WAITING_FOR_VENDOR' ELSE v_ticket.support_stage END;
    IF v_to_stage <> v_ticket.support_stage THEN
      UPDATE public.support_tickets SET support_stage = v_to_stage,
        response_due_at = CASE WHEN v_to_stage = 'WAITING_FOR_VENDOR' THEN now() + interval '4 hours' ELSE response_due_at END,
        updated_at = now() WHERE id = p_ticket_id;
    END IF;
  END IF;
  v_from_stage := v_ticket.support_stage;
  INSERT INTO public.support_case_events(ticket_id, actor_id, actor_role, action, from_stage, to_stage, note)
  VALUES (p_ticket_id, v_user_id, 'customer_care', 'message_forwarded_to_' || p_target_role,
    v_from_stage, v_to_stage, 'Message shared by LocalShore Customer Care.');
END
$$;

CREATE OR REPLACE FUNCTION public.send_protected_support_message(p_ticket_id uuid, p_body text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_role text;
  v_user_id uuid := auth.uid();
  v_stage text;
  v_message_id uuid;
  v_ticket public.support_tickets%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_ticket FROM public.support_tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Support case not found'; END IF;
  IF public.has_role(v_user_id, 'admin'::public.app_role) THEN
    v_role := 'customer_care';
  ELSIF v_ticket.user_id = v_user_id THEN
    v_role := 'customer';
  ELSIF EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = v_ticket.vendor_id AND s.user_id = v_user_id) THEN
    v_role := 'vendor';
  ELSIF EXISTS (SELECT 1 FROM public.delivery_partners dp WHERE dp.id = v_ticket.delivery_partner_id AND dp.user_id = v_user_id) THEN
    v_role := 'delivery_partner';
  ELSE
    RAISE EXCEPTION 'Support case not found or access denied';
  END IF;
  IF v_ticket.status IN ('resolved', 'closed') OR v_ticket.support_stage IN ('RESOLVED', 'CANCELLED') THEN
    RAISE EXCEPTION 'This support case is closed';
  END IF;
  IF length(trim(COALESCE(p_body, ''))) < 1 THEN RAISE EXCEPTION 'Message cannot be empty'; END IF;
  INSERT INTO public.ticket_messages(ticket_id, author_id, is_admin, sender_role, body,
    visible_to_customer, visible_to_vendor)
  VALUES (p_ticket_id, v_user_id, v_role = 'customer_care', v_role,
    public.redact_support_contact_details(trim(p_body)),
    v_role IN ('customer', 'customer_care'),
    v_role IN ('vendor', 'delivery_partner', 'customer_care'))
  RETURNING id INTO v_message_id;
  v_stage := CASE v_role
    WHEN 'customer' THEN 'CUSTOMER_RESPONDED'
    WHEN 'vendor' THEN 'VENDOR_RESPONDED'
    WHEN 'delivery_partner' THEN 'VENDOR_RESPONDED'
    ELSE CASE WHEN v_ticket.support_stage = 'WAITING_FOR_VENDOR' THEN 'UNDER_REVIEW' ELSE v_ticket.support_stage END
  END;
  IF v_stage = 'UNDER_REVIEW' THEN v_stage := 'under_review'; END IF;
  UPDATE public.support_tickets SET support_stage = v_stage, status = 'pending', updated_at = now()
  WHERE id = p_ticket_id;
  INSERT INTO public.support_case_events(ticket_id, actor_id, actor_role, action, from_stage, to_stage)
  VALUES (p_ticket_id, v_user_id, v_role, 'message_sent', v_ticket.support_stage, v_stage);
  RETURN v_message_id;
END
$$;

CREATE OR REPLACE FUNCTION public.propose_protected_support_resolution(
  p_ticket_id uuid, p_resolution_type text, p_note text DEFAULT ''
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_ticket public.support_tickets%ROWTYPE;
  v_role text;
  v_body text;
  v_user_id uuid := auth.uid();
BEGIN
  SELECT * INTO v_ticket FROM public.support_tickets WHERE id = p_ticket_id FOR UPDATE;
  IF v_user_id IS NULL OR NOT FOUND THEN RAISE EXCEPTION 'Support case not found'; END IF;
  IF EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = v_ticket.vendor_id AND s.user_id = v_user_id) THEN
    v_role := 'vendor';
  ELSIF public.has_role(v_user_id, 'admin'::public.app_role) THEN
    v_role := 'customer_care';
  ELSE
    RAISE EXCEPTION 'Only the shop or Customer Care may propose a resolution';
  END IF;
  IF p_resolution_type NOT IN ('replacement', 'resend', 'partial_refund_request', 'refund_request',
      'store_credit_request', 'delivery_investigation', 'payment_investigation') THEN
    RAISE EXCEPTION 'Unsupported resolution option';
  END IF;
  UPDATE public.support_tickets
  SET resolution_type = p_resolution_type, support_stage = 'RESOLUTION_PROPOSED', status = 'pending', updated_at = now()
  WHERE id = p_ticket_id;
  v_body := public.redact_support_contact_details(trim(COALESCE(p_note, '')));
  IF v_body = '' THEN v_body := 'Resolution proposed: ' || replace(p_resolution_type, '_', ' '); END IF;
  INSERT INTO public.ticket_messages(ticket_id, author_id, is_admin, sender_role, body,
    visible_to_customer, visible_to_vendor)
  VALUES (p_ticket_id, v_user_id, v_role = 'customer_care', v_role, v_body,
    v_role = 'customer_care', true);
  INSERT INTO public.support_case_events(ticket_id, actor_id, actor_role, action, from_stage, to_stage, note)
  VALUES (p_ticket_id, v_user_id, v_role, 'resolution_proposed', v_ticket.support_stage,
    'RESOLUTION_PROPOSED', p_resolution_type);
END
$$;

CREATE OR REPLACE FUNCTION public.respond_to_protected_support_resolution(
  p_ticket_id uuid, p_accept boolean, p_note text DEFAULT ''
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_ticket public.support_tickets%ROWTYPE;
  v_stage text;
  v_body text;
  v_user_id uuid := auth.uid();
BEGIN
  SELECT * INTO v_ticket FROM public.support_tickets WHERE id = p_ticket_id FOR UPDATE;
  IF v_user_id IS NULL OR NOT FOUND OR v_ticket.user_id <> v_user_id THEN
    RAISE EXCEPTION 'Support case not found or access denied';
  END IF;
  IF v_ticket.support_stage <> 'CUSTOMER_CONFIRMATION' THEN RAISE EXCEPTION 'No resolution is awaiting your response'; END IF;
  v_stage := CASE WHEN p_accept THEN 'CUSTOMER_RESPONDED' ELSE 'OPEN' END;
  UPDATE public.support_tickets SET support_stage = v_stage, status = 'pending', updated_at = now()
  WHERE id = p_ticket_id;
  v_body := CASE WHEN p_accept THEN 'I accept the proposed resolution.' ELSE 'I need more help with the proposed resolution.' END;
  IF trim(COALESCE(p_note, '')) <> '' THEN v_body := v_body || ' ' || public.redact_support_contact_details(p_note); END IF;
  INSERT INTO public.ticket_messages(ticket_id, author_id, is_admin, sender_role, body,
    visible_to_customer, visible_to_vendor)
  VALUES (p_ticket_id, v_user_id, false, 'customer', v_body, true, false);
  INSERT INTO public.support_case_events(ticket_id, actor_id, actor_role, action, from_stage, to_stage)
  VALUES (p_ticket_id, v_user_id, 'customer', CASE WHEN p_accept THEN 'resolution_accepted' ELSE 'resolution_declined' END,
    v_ticket.support_stage, v_stage);
END
$$;

CREATE OR REPLACE FUNCTION public.manage_protected_support_case(
  p_ticket_id uuid, p_action text, p_note text DEFAULT ''
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_ticket public.support_tickets%ROWTYPE;
  v_stage text;
  v_status text;
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL OR NOT public.has_role(v_user_id, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Customer Care staff access required';
  END IF;
  SELECT * INTO v_ticket FROM public.support_tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Support case not found'; END IF;
  CASE p_action
    WHEN 'escalate' THEN v_stage := 'ESCALATED'; v_status := 'pending';
    WHEN 'wait_vendor' THEN v_stage := 'WAITING_FOR_VENDOR'; v_status := 'pending';
    WHEN 'reopen' THEN v_stage := 'REOPENED'; v_status := 'open';
    WHEN 'resolve' THEN v_stage := 'RESOLVED'; v_status := 'resolved';
    WHEN 'cancel' THEN v_stage := 'CANCELLED'; v_status := 'closed';
    ELSE RAISE EXCEPTION 'Unsupported support action';
  END CASE;
  UPDATE public.support_tickets SET support_stage = v_stage, status = v_status,
    response_due_at = CASE WHEN p_action = 'wait_vendor' THEN now() + interval '4 hours' ELSE response_due_at END,
    resolved_at = CASE WHEN v_stage IN ('RESOLVED', 'CANCELLED') THEN now() ELSE NULL END,
    escalation_notified_at = CASE WHEN v_stage = 'ESCALATED' THEN now() ELSE escalation_notified_at END,
    updated_at = now()
  WHERE id = p_ticket_id;
  INSERT INTO public.ticket_messages(ticket_id, author_id, is_admin, sender_role, body)
  VALUES (p_ticket_id, v_user_id, true, 'system',
    CASE p_action WHEN 'escalate' THEN 'LocalShore Customer Care escalated this case.'
      WHEN 'wait_vendor' THEN 'LocalShore Customer Care contacted the shop for an update.'
      WHEN 'resolve' THEN 'LocalShore Customer Care marked this case resolved.'
      WHEN 'cancel' THEN 'LocalShore Customer Care closed this case.'
      ELSE 'LocalShore Customer Care reopened this case.' END);
  INSERT INTO public.support_case_events(ticket_id, actor_id, actor_role, action, from_stage, to_stage, note)
  VALUES (p_ticket_id, v_user_id, 'customer_care', p_action, v_ticket.support_stage, v_stage,
    public.redact_support_contact_details(p_note));
END
$$;

CREATE OR REPLACE FUNCTION public.escalate_vendor_support_case(p_ticket_id uuid, p_note text DEFAULT '')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_ticket public.support_tickets%ROWTYPE;
  v_user_id uuid := auth.uid();
BEGIN
  SELECT * INTO v_ticket FROM public.support_tickets WHERE id = p_ticket_id FOR UPDATE;
  IF v_user_id IS NULL OR NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.sellers s WHERE s.id = v_ticket.vendor_id AND s.user_id = v_user_id
  ) THEN RAISE EXCEPTION 'Support case not found or access denied'; END IF;
  UPDATE public.support_tickets SET support_stage = 'ESCALATED', status = 'pending', updated_at = now()
  WHERE id = p_ticket_id;
  INSERT INTO public.ticket_messages(ticket_id, author_id, is_admin, sender_role, body)
  VALUES (p_ticket_id, v_user_id, false, 'vendor',
    'The shop requested LocalShore Customer Care assistance.');
  INSERT INTO public.support_case_events(ticket_id, actor_id, actor_role, action, from_stage, to_stage, note)
  VALUES (p_ticket_id, v_user_id, 'vendor', 'vendor_escalated', v_ticket.support_stage,
    'ESCALATED', public.redact_support_contact_details(p_note));
END
$$;

-- Storage authorization uses a definer helper because callers intentionally
-- have no direct SELECT privilege on support_tickets.
CREATE OR REPLACE FUNCTION public.can_access_support_evidence(p_path text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.support_tickets t
    WHERE p_path = ANY(t.evidence_urls)
      AND public.is_protected_support_participant(t.id)
  )
$$;

CREATE OR REPLACE FUNCTION public.escalate_overdue_support_cases()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_ticket public.support_tickets%ROWTYPE;
  v_count integer := 0;
BEGIN
  FOR v_ticket IN
    SELECT * FROM public.support_tickets
    WHERE support_stage = 'WAITING_FOR_VENDOR'
      AND response_due_at IS NOT NULL AND response_due_at <= now()
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.support_tickets
    SET support_stage = 'ESCALATED', escalation_notified_at = now(), updated_at = now(), status = 'pending'
    WHERE id = v_ticket.id;
    INSERT INTO public.ticket_messages(ticket_id, author_id, is_admin, sender_role, body)
    VALUES (v_ticket.id, NULL, true, 'system',
      'The shop has not responded within the support window. LocalShore Customer Care is following up.');
    INSERT INTO public.support_case_events(ticket_id, actor_id, actor_role, action, from_stage, to_stage, note)
    VALUES (v_ticket.id, NULL, 'system', 'automatic_vendor_timeout_escalation',
      v_ticket.support_stage, 'ESCALATED', 'Vendor response deadline passed.');
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END
$$;

REVOKE ALL ON FUNCTION public.escalate_overdue_support_cases() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.escalate_overdue_support_cases() TO service_role;

-- Configure the recurring escalation only if this project has pg_cron enabled.
-- If it is not installed, staff can still invoke the function from a trusted
-- scheduled Edge Function using the service role; no client can call it.
DO $$
DECLARE
  v_cron_schema text;
BEGIN
  SELECT n.nspname INTO v_cron_schema
  FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pg_cron';
  IF v_cron_schema IS NOT NULL THEN
    EXECUTE format('SELECT %I.unschedule(jobid) FROM %I.job WHERE jobname = %L',
      v_cron_schema, v_cron_schema, 'localshore-support-case-escalation');
    EXECUTE format('SELECT %I.schedule(%L, %L, %L)',
      v_cron_schema, 'localshore-support-case-escalation', '*/10 * * * *',
      'SELECT public.escalate_overdue_support_cases();');
  END IF;
END
$$;

-- RLS remains the database guard for evidence. The RPCs above derive all
-- participant IDs from auth.uid() and the existing orders/sellers/assignments.
DROP POLICY IF EXISTS "Users create own tickets" ON public.support_tickets;
DROP POLICY IF EXISTS "Vendors view related support cases" ON public.support_tickets;
DROP POLICY IF EXISTS "Ticket participants view messages" ON public.ticket_messages;
DROP POLICY IF EXISTS "Ticket participants add messages" ON public.ticket_messages;
DROP POLICY IF EXISTS "Vendors view related support messages" ON public.ticket_messages;
DROP POLICY IF EXISTS "Vendors add related support messages" ON public.ticket_messages;

CREATE POLICY "Protected support cases participant read" ON public.support_tickets
  FOR SELECT TO authenticated USING (public.is_protected_support_participant(id));
CREATE POLICY "Protected support messages participant read" ON public.ticket_messages
  FOR SELECT TO authenticated USING (public.is_protected_support_participant(ticket_id));

REVOKE ALL ON public.support_tickets, public.ticket_messages, public.support_case_events FROM anon, authenticated;
GRANT ALL ON public.support_tickets, public.ticket_messages, public.support_case_events TO service_role;

REVOKE ALL ON FUNCTION public.create_customer_support_case(uuid,text,text,uuid,text,text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_protected_support_cases() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_protected_support_messages(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.forward_protected_support_message(uuid,uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.send_protected_support_message(uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.propose_protected_support_resolution(uuid,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.respond_to_protected_support_resolution(uuid,boolean,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.manage_protected_support_case(uuid,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.escalate_vendor_support_case(uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_access_support_evidence(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_customer_support_case(uuid,text,text,uuid,text,text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_protected_support_cases() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_protected_support_messages(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.forward_protected_support_message(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_protected_support_message(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.propose_protected_support_resolution(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_to_protected_support_resolution(uuid,boolean,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.manage_protected_support_case(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.escalate_vendor_support_case(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_support_evidence(text) TO authenticated;

DROP POLICY IF EXISTS "Customers upload support evidence" ON storage.objects;
CREATE POLICY "Customers upload support evidence" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'support-evidence'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND lower(COALESCE(metadata->>'mimetype', metadata->>'contentType', ''))
      IN ('image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime')
  );
DROP POLICY IF EXISTS "Support participants view case evidence" ON storage.objects;
CREATE POLICY "Support participants view case evidence" ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id = 'support-evidence'
    AND public.can_access_support_evidence(name)
  );
UPDATE storage.buckets SET public = false, file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','video/mp4','video/webm','video/quicktime']
WHERE id = 'support-evidence';

COMMENT ON FUNCTION public.create_customer_support_case(uuid,text,text,uuid,text,text[]) IS
  'Creates an authenticated customer support case; derives customer, vendor, delivery partner, order and item relationships server-side.';
COMMENT ON FUNCTION public.send_protected_support_message(uuid,text) IS
  'Writes a privacy-redacted support message after verifying the authenticated participant role.';
