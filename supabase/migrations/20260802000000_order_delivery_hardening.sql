-- Canonical order workflow hardening.
-- Apply after 20260801090000_delivery_partner_shared_integration.sql.
-- This migration intentionally does not create or alter a second orders schema.

-- Compatibility helper used by the shared RLS policies and all transition RPCs.
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

-- Delivery partners never write orders or assignments directly. Every forward
-- transition is authorized against the authenticated partner and committed as
-- one transaction with its tracking event.
CREATE OR REPLACE FUNCTION public.advance_delivery_assignment(
  _assignment_id uuid,
  _next_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a record;
  o record;
  next_order_status public.order_status;
BEGIN
  SELECT * INTO a
  FROM public.delivery_assignments
  WHERE id = _assignment_id
  FOR UPDATE;

  IF a.id IS NULL OR NOT public.is_my_partner(a.partner_id) THEN
    RAISE EXCEPTION 'Delivery assignment not found';
  END IF;

  IF a.status IN ('delivered', 'cancelled', 'rejected', 'expired') THEN
    RAISE EXCEPTION 'Delivery assignment is already closed';
  END IF;

  IF NOT (
    (a.status = 'accepted' AND _next_status = 'navigating_to_vendor') OR
    (a.status = 'navigating_to_vendor' AND _next_status = 'reached_vendor') OR
    (a.status = 'reached_vendor' AND _next_status = 'picked_up') OR
    (a.status = 'picked_up' AND _next_status = 'out_for_delivery')
  ) THEN
    RAISE EXCEPTION 'Invalid delivery transition from % to %', a.status, _next_status;
  END IF;

  SELECT * INTO o
  FROM public.orders
  WHERE id = a.order_id
  FOR UPDATE;

  IF o.id IS NULL OR o.assigned_partner_id <> a.partner_id THEN
    RAISE EXCEPTION 'Order is not assigned to this partner';
  END IF;

  next_order_status := CASE
    WHEN _next_status = 'picked_up' THEN 'picked_up'::public.order_status
    WHEN _next_status = 'out_for_delivery' THEN 'out_for_delivery'::public.order_status
    ELSE 'assigned'::public.order_status
  END;

  UPDATE public.delivery_assignments
  SET status = _next_status,
      picked_up_at = CASE WHEN _next_status = 'picked_up' THEN COALESCE(picked_up_at, now()) ELSE picked_up_at END,
      updated_at = now()
  WHERE id = a.id;

  UPDATE public.orders
  SET status = next_order_status
  WHERE id = o.id;

  INSERT INTO public.delivery_tracking (assignment_id, status, note)
  VALUES (a.id, _next_status, 'Partner updated delivery status');

  RETURN jsonb_build_object(
    'assignment_id', a.id,
    'order_id', o.id,
    'assignment_status', _next_status,
    'order_status', next_order_status::text
  );
END;
$$;

-- Rejecting a request is also a server-side transition, so a partner cannot
-- reject another partner's request by changing an arbitrary row id.
CREATE OR REPLACE FUNCTION public.reject_delivery_request(_assignment_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE a record;
BEGIN
  SELECT * INTO a
  FROM public.delivery_assignments
  WHERE id = _assignment_id
  FOR UPDATE;

  IF a.id IS NULL OR NOT public.is_my_partner(a.partner_id) THEN
    RAISE EXCEPTION 'Delivery request not found';
  END IF;
  IF a.status <> 'pending' THEN
    RAISE EXCEPTION 'Delivery request is no longer available';
  END IF;

  UPDATE public.delivery_assignments
  SET status = 'rejected', responded_at = now(), updated_at = now()
  WHERE id = a.id;
  RETURN a.id;
END;
$$;

-- Completion is idempotent: a retry after a successful commit returns the
-- existing result and never creates a second earning or delivery count.
DROP FUNCTION IF EXISTS public.complete_delivery(uuid, text, text);
CREATE FUNCTION public.complete_delivery(
  _assignment_id uuid,
  _proof_type text,
  _proof_value text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a record;
  o record;
  fee numeric;
  inserted_earning boolean := false;
BEGIN
  SELECT * INTO a
  FROM public.delivery_assignments
  WHERE id = _assignment_id
  FOR UPDATE;

  IF a.id IS NULL OR NOT public.is_my_partner(a.partner_id) THEN
    RAISE EXCEPTION 'Delivery assignment not found';
  END IF;

  IF a.status = 'delivered' THEN
    RETURN jsonb_build_object(
      'assignment_id', a.id,
      'order_id', a.order_id,
      'status', 'delivered',
      'already_completed', true
    );
  END IF;

  IF a.status <> 'out_for_delivery' THEN
    RAISE EXCEPTION 'Delivery must be out for delivery before completion';
  END IF;

  SELECT * INTO o
  FROM public.orders
  WHERE id = a.order_id
  FOR UPDATE;

  IF o.id IS NULL OR o.assigned_partner_id <> a.partner_id THEN
    RAISE EXCEPTION 'Order is not assigned to this partner';
  END IF;
  IF _proof_type NOT IN ('otp', 'photo') OR coalesce(trim(_proof_value), '') = '' THEN
    RAISE EXCEPTION 'Delivery proof is required';
  END IF;
  IF _proof_type = 'otp' AND _proof_value <> coalesce(o.delivery_otp, '') THEN
    RAISE EXCEPTION 'Incorrect delivery OTP';
  END IF;

  fee := coalesce(a.estimated_earning, o.shipping_fee, 0);
  UPDATE public.delivery_assignments
  SET status = 'delivered', delivered_at = now(), proof_type = _proof_type,
      proof_value = _proof_value, updated_at = now()
  WHERE id = a.id;
  UPDATE public.orders
  SET status = 'delivered', delivered_at = now()
  WHERE id = o.id;

  INSERT INTO public.delivery_tracking (assignment_id, status, note)
  VALUES (a.id, 'delivered', 'Delivered to customer');

  SELECT EXISTS (
    SELECT 1 FROM public.delivery_earnings WHERE assignment_id = a.id
  ) INTO inserted_earning;
  IF NOT inserted_earning THEN
    INSERT INTO public.delivery_earnings (partner_id, assignment_id, amount, description)
    VALUES (a.partner_id, a.id, fee, 'Delivery ' || o.order_number);
    inserted_earning := true;
  END IF;

  IF inserted_earning THEN
    UPDATE public.delivery_partners
    SET total_deliveries = total_deliveries + 1, updated_at = now()
    WHERE id = a.partner_id;
  END IF;

  RETURN jsonb_build_object(
    'assignment_id', a.id,
    'order_id', o.id,
    'status', 'delivered',
    'already_completed', false
  );
END;
$$;

-- Seller dispatch and status progression happen in one locked transaction.
-- Calling this again when the order is already ready_for_pickup retries the
-- broadcast safely without advancing the status a second time.
CREATE OR REPLACE FUNCTION public.advance_seller_order(_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o record;
  next_status public.order_status;
  dispatched integer := 0;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = o.seller_id AND s.user_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'Not allowed to update this order';
  END IF;

  IF o.status = 'ready_for_pickup' THEN
    dispatched := public.broadcast_delivery_request(o.id, 60);
    RETURN jsonb_build_object('status', o.status::text, 'dispatched', dispatched);
  END IF;

  next_status := CASE o.status::text
    WHEN 'new' THEN 'accepted'::public.order_status
    WHEN 'accepted' THEN 'packed'::public.order_status
    WHEN 'packed' THEN 'ready_for_pickup'::public.order_status
    ELSE NULL
  END;
  IF next_status IS NULL THEN
    RAISE EXCEPTION 'Cannot advance order from status %', o.status;
  END IF;

  UPDATE public.orders SET status = next_status WHERE id = o.id;
  IF next_status = 'ready_for_pickup' THEN
    dispatched := public.broadcast_delivery_request(o.id, 60);
  END IF;
  RETURN jsonb_build_object('status', next_status::text, 'dispatched', dispatched);
END;
$$;

REVOKE ALL ON FUNCTION public.advance_delivery_assignment(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reject_delivery_request(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_delivery(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.advance_seller_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.advance_delivery_assignment(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_delivery_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_delivery(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.advance_seller_order(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
