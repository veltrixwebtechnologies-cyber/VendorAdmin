-- ============================================================
-- MIGRATION: 20260831180000_smart_delivery_dispatch_system.sql
-- LocalShore Production-Grade Delivery Dispatch & Lifecycle System
-- ============================================================

-- 1. Order Status Enum & Schema Enhancements
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'preparing';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'rider_assigned';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'rider_accepted';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'rider_at_shop';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'at_customer';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'assignment_failed';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'delivery_failed';

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS reassignment_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dispatch_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estimated_prep_minutes integer DEFAULT 15,
  ADD COLUMN IF NOT EXISTS dispatch_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS rider_assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS rider_at_shop_at timestamptz,
  ADD COLUMN IF NOT EXISTS picked_up_at timestamptz,
  ADD COLUMN IF NOT EXISTS out_for_delivery_at timestamptz,
  ADD COLUMN IF NOT EXISTS arrived_at_customer_at timestamptz;

ALTER TABLE public.delivery_partners
  ADD COLUMN IF NOT EXISTS max_concurrent_orders integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS vehicle_type text NOT NULL DEFAULT 'bike';

ALTER TABLE public.delivery_assignments
  ADD COLUMN IF NOT EXISTS arrived_at_customer_at timestamptz;

-- 2. Controlled State Machine Transition Validator
DROP FUNCTION IF EXISTS public.validate_order_status_transition(text, text) CASCADE;
CREATE OR REPLACE FUNCTION public.validate_order_status_transition(
  p_old_status text,
  p_new_status text
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_old_status = p_new_status THEN
    RETURN true;
  END IF;

  -- Terminal states cannot be changed
  IF p_old_status IN ('delivered', 'cancelled', 'delivery_failed') THEN
    RETURN false;
  END IF;

  RETURN CASE p_old_status
    WHEN 'new' THEN p_new_status IN ('accepted', 'preparing', 'packed', 'cancelled')
    WHEN 'accepted' THEN p_new_status IN ('preparing', 'packed', 'ready_for_pickup', 'assigned', 'rider_assigned', 'cancelled')
    WHEN 'preparing' THEN p_new_status IN ('packed', 'ready_for_pickup', 'assigned', 'rider_assigned', 'cancelled')
    WHEN 'packed' THEN p_new_status IN ('ready_for_pickup', 'assigned', 'rider_assigned', 'cancelled')
    WHEN 'ready_for_pickup' THEN p_new_status IN ('assigned', 'rider_assigned', 'assignment_failed', 'cancelled')
    WHEN 'assigned' THEN p_new_status IN ('rider_accepted', 'accepted', 'rider_at_shop', 'picked_up', 'ready_for_pickup', 'assignment_failed', 'cancelled')
    WHEN 'rider_assigned' THEN p_new_status IN ('rider_accepted', 'accepted', 'rider_at_shop', 'picked_up', 'ready_for_pickup', 'assignment_failed', 'cancelled')
    WHEN 'rider_accepted' THEN p_new_status IN ('rider_at_shop', 'picked_up', 'out_for_delivery', 'ready_for_pickup', 'cancelled')
    WHEN 'rider_at_shop' THEN p_new_status IN ('picked_up', 'out_for_delivery', 'cancelled')
    WHEN 'picked_up' THEN p_new_status IN ('out_for_delivery', 'at_customer', 'delivered', 'delivery_failed', 'cancelled')
    WHEN 'out_for_delivery' THEN p_new_status IN ('at_customer', 'delivered', 'delivery_failed', 'cancelled')
    WHEN 'at_customer' THEN p_new_status IN ('delivered', 'delivery_failed', 'cancelled')
    WHEN 'assignment_failed' THEN p_new_status IN ('ready_for_pickup', 'assigned', 'rider_assigned', 'cancelled')
    ELSE false
  END;
END;
$$;

-- 3. Configurable Multi-Factor Rider Ranking System
DROP FUNCTION IF EXISTS public.calculate_rider_dispatch_score(double precision, double precision, integer, double precision, integer, double precision) CASCADE;
CREATE OR REPLACE FUNCTION public.calculate_rider_dispatch_score(
  p_distance_to_shop_km double precision,
  p_eta_minutes double precision,
  p_active_orders_count integer,
  p_rating double precision,
  p_prep_minutes integer,
  p_location_age_seconds double precision
)
RETURNS double precision
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_dist_score double precision;
  v_eta_score double precision;
  v_workload_score double precision;
  v_rating_score double precision;
  v_readiness_score double precision;
  v_freshness_score double precision;

  -- Configurable weights (sum = 1.00)
  w_distance double precision := 0.30;
  w_eta double precision      := 0.25;
  w_workload double precision := 0.15;
  w_rating double precision   := 0.15;
  w_readiness double precision:= 0.10;
  w_freshness double precision:= 0.05;
BEGIN
  -- 1. Distance score (100 = 0km, 0 = >= 15km)
  v_dist_score := greatest(0.0, 100.0 - (coalesce(p_distance_to_shop_km, 99.0) * 6.66));

  -- 2. ETA score (100 = < 3 min, decreasing to 0 at 30 min)
  v_eta_score := greatest(0.0, 100.0 - (coalesce(p_eta_minutes, 30.0) * 3.33));

  -- 3. Workload score (100 = 0 active orders, 40 = 1 active order, 0 = > 1)
  v_workload_score := CASE coalesce(p_active_orders_count, 0)
    WHEN 0 THEN 100.0
    WHEN 1 THEN 40.0
    ELSE 0.0
  END;

  -- 4. Rating score (normalized 0-100)
  v_rating_score := (greatest(1.0, least(5.0, coalesce(p_rating, 5.0))) / 5.0) * 100.0;

  -- 5. Readiness score (Rider arrival synced with order ready time)
  v_readiness_score := CASE
    WHEN abs(coalesce(p_eta_minutes, 10.0) - coalesce(p_prep_minutes, 15.0)) <= 3 THEN 100.0
    ELSE greatest(0.0, 100.0 - abs(coalesce(p_eta_minutes, 10.0) - coalesce(p_prep_minutes, 15.0)) * 5.0)
  END;

  -- 6. Location freshness score (100 = updated in last 60s, 0 = 15 mins)
  v_freshness_score := greatest(0.0, 100.0 - (coalesce(p_location_age_seconds, 900.0) / 9.0));

  RETURN (v_dist_score * w_distance) +
         (v_eta_score * w_eta) +
         (v_workload_score * w_workload) +
         (v_rating_score * w_rating) +
         (v_readiness_score * w_readiness) +
         (v_freshness_score * w_freshness);
END;
$$;

-- 4. Production Dispatch Engine with Atomic Locking
DROP FUNCTION IF EXISTS public.dispatch_delivery_for_order_internal(uuid, integer) CASCADE;
DROP FUNCTION IF EXISTS public.dispatch_delivery_for_order_internal(uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.dispatch_delivery_for_order_internal(
  _order_id uuid,
  _timeout_seconds integer DEFAULT 45
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
DECLARE
  o record;
  seller_row record;
  selected_partner record;
  assignment_id uuid;
  has_active boolean;
  shop_lat double precision;
  shop_lng double precision;
  max_radius_km double precision := 15.0;
BEGIN
  -- Lock order row atomically
  SELECT * INTO o FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF o.id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  -- If order already has an assigned active partner, return existing assignment
  IF o.assigned_partner_id IS NOT NULL THEN
    SELECT id INTO assignment_id
    FROM public.delivery_assignments
    WHERE order_id = o.id AND partner_id = o.assigned_partner_id
      AND status NOT IN ('rejected', 'expired', 'cancelled')
    ORDER BY created_at DESC
    LIMIT 1;
    IF assignment_id IS NOT NULL THEN
      RETURN assignment_id;
    END IF;
  END IF;

  -- Dispatch is active for accepted, preparing, packed, ready_for_pickup, or assigned states
  IF o.status::text NOT IN ('accepted', 'preparing', 'packed', 'ready_for_pickup', 'assigned', 'rider_assigned') THEN
    RETURN NULL;
  END IF;

  -- Expire stale pending requests for this order
  UPDATE public.delivery_assignments
  SET status = 'expired', updated_at = now()
  WHERE order_id = o.id AND status IN ('pending', 'requested') AND expires_at <= now();

  -- Reuse unexpired pending offer if one is currently active
  SELECT id INTO assignment_id
  FROM public.delivery_assignments
  WHERE order_id = o.id AND status IN ('pending', 'requested') AND expires_at > now()
  ORDER BY created_at ASC
  LIMIT 1;

  IF assignment_id IS NOT NULL THEN
    RETURN assignment_id;
  END IF;

  -- Fetch shop coordinates
  SELECT lat, lng, wizard_data INTO seller_row
  FROM public.sellers WHERE id = o.seller_id;

  shop_lat := coalesce(seller_row.lat, (seller_row.wizard_data->>'lat')::double precision, 13.0827);
  shop_lng := coalesce(seller_row.lng, (seller_row.wizard_data->>'lng')::double precision, 80.2707);

  -- Rank eligible riders using multi-factor scoring
  SELECT
    p.id,
    public.delivery_distance_km(p.current_latitude, p.current_longitude, shop_lat, shop_lng) AS dist_to_shop_km,
    ((public.delivery_distance_km(p.current_latitude, p.current_longitude, shop_lat, shop_lng) / 22.0) * 60.0) AS eta_min,
    extract(epoch FROM (now() - p.location_updated_at)) AS loc_age_sec,
    public.calculate_rider_dispatch_score(
      public.delivery_distance_km(p.current_latitude, p.current_longitude, shop_lat, shop_lng),
      ((public.delivery_distance_km(p.current_latitude, p.current_longitude, shop_lat, shop_lng) / 22.0) * 60.0),
      (SELECT count(*)::integer FROM public.delivery_assignments active_a
       WHERE active_a.partner_id = p.id AND active_a.status IN ('accepted', 'navigating_to_vendor', 'reached_vendor', 'picked_up', 'out_for_delivery')),
      p.rating,
      coalesce(o.estimated_prep_minutes, 15),
      extract(epoch FROM (now() - p.location_updated_at))
    ) AS score
  INTO selected_partner
  FROM public.delivery_partners p
  WHERE p.status = 'approved'
    AND p.availability = 'online'
    AND p.current_latitude IS NOT NULL
    AND p.current_longitude IS NOT NULL
    AND p.location_updated_at > now() - interval '20 minutes'
    -- Check concurrency capacity
    AND (
      SELECT count(*) FROM public.delivery_assignments active_a
      WHERE active_a.partner_id = p.id
        AND active_a.status IN ('accepted', 'navigating_to_vendor', 'reached_vendor', 'picked_up', 'out_for_delivery')
    ) < coalesce(p.max_concurrent_orders, 1)
    -- Exclude partners that already rejected/expired this order
    AND NOT EXISTS (
      SELECT 1 FROM public.delivery_assignments prior
      WHERE prior.order_id = o.id AND prior.partner_id = p.id AND prior.status IN ('rejected', 'expired')
    )
    -- Maximum delivery radius check
    AND public.delivery_distance_km(p.current_latitude, p.current_longitude, shop_lat, shop_lng) <= max_radius_km
  ORDER BY score DESC, p.rating DESC, p.created_at ASC
  LIMIT 1;

  IF selected_partner.id IS NULL THEN
    -- If max attempts reached and no riders found, update order status to assignment_failed
    IF o.dispatch_attempts >= 5 THEN
      UPDATE public.orders
      SET status = 'assignment_failed', updated_at = now()
      WHERE id = o.id AND status::text IN ('ready_for_pickup', 'assigned');
    END IF;
    RETURN NULL;
  END IF;

  -- Transaction level advisory lock for atomicity
  PERFORM pg_advisory_xact_lock(hashtextextended(selected_partner.id::text, 0));

  SELECT EXISTS (
    SELECT 1 FROM public.delivery_assignments a
    WHERE a.partner_id = selected_partner.id
      AND a.status IN ('accepted', 'navigating_to_vendor', 'reached_vendor', 'picked_up', 'out_for_delivery')
  ) INTO has_active;

  IF has_active AND coalesce(selected_partner.id, '00000000-0000-0000-0000-000000000000'::uuid) <> o.assigned_partner_id THEN
    -- Partner gained active assignment concurrently
    RETURN NULL;
  END IF;

  -- Upsert offer assignment
  INSERT INTO public.delivery_assignments (
    order_id, partner_id, distance_km, estimated_earning, expires_at
  )
  VALUES (
    o.id,
    selected_partner.id,
    round(coalesce(selected_partner.dist_to_shop_km, 0)::numeric, 2),
    coalesce(o.shipping_fee, 25.0),
    now() + make_interval(secs => greatest(_timeout_seconds, 30))
  )
  ON CONFLICT (order_id, partner_id) DO UPDATE
  SET status = 'pending',
      distance_km = EXCLUDED.distance_km,
      estimated_earning = EXCLUDED.estimated_earning,
      expires_at = EXCLUDED.expires_at,
      responded_at = NULL,
      updated_at = now()
  WHERE public.delivery_assignments.status IN ('expired', 'rejected')
  RETURNING id INTO assignment_id;

  IF assignment_id IS NOT NULL THEN
    UPDATE public.orders
    SET dispatch_attempts = dispatch_attempts + 1,
        dispatch_started_at = coalesce(dispatch_started_at, now()),
        updated_at = now()
    WHERE id = o.id;

    UPDATE public.delivery_partners
    SET total_requests = total_requests + 1, updated_at = now()
    WHERE id = selected_partner.id;

    PERFORM public.enqueue_delivery_notification(
      selected_partner.id,
      'New delivery request',
      'A customer order is ready for pickup.',
      'new_delivery',
      jsonb_build_object('order_id', o.id, 'assignment_id', assignment_id)
    );

    INSERT INTO public.delivery_tracking (assignment_id, status, note)
    VALUES (assignment_id, 'offered', 'Delivery request offered to partner');
  END IF;

  RETURN assignment_id;
END;
$$;

-- 5. Automated Reassignment & Expiration Maintenance Routine
DROP FUNCTION IF EXISTS public.expire_and_redispatch_assignments() CASCADE;
CREATE OR REPLACE FUNCTION public.expire_and_redispatch_assignments()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec record;
  processed_count integer := 0;
BEGIN
  -- Mark all expired pending offers as expired
  FOR rec IN
    UPDATE public.delivery_assignments
    SET status = 'expired', updated_at = now()
    WHERE status IN ('pending', 'requested')
      AND expires_at <= now()
    RETURNING order_id, partner_id
  LOOP
    processed_count := processed_count + 1;

    INSERT INTO public.delivery_tracking (assignment_id, status, note)
    SELECT id, 'expired', 'Offer expired due to timeout'
    FROM public.delivery_assignments
    WHERE order_id = rec.order_id AND partner_id = rec.partner_id;

    UPDATE public.orders
    SET reassignment_count = reassignment_count + 1
    WHERE id = rec.order_id;

    -- Immediately attempt dispatch to next best candidate
    PERFORM public.dispatch_delivery_for_order_internal(rec.order_id, 45);
  END LOOP;

  RETURN processed_count;
END;
$$;

-- 6. Atomic Partner Accept Function
DROP FUNCTION IF EXISTS public.accept_delivery_request(uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.accept_delivery_request(_assignment_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a record;
  o record;
  target_order_status public.order_status;
BEGIN
  SELECT * INTO a
  FROM public.delivery_assignments
  WHERE id = _assignment_id
  FOR UPDATE;

  IF a.id IS NULL OR NOT public.is_my_partner(a.partner_id) THEN
    RAISE EXCEPTION 'Delivery request not found';
  END IF;

  SELECT * INTO o
  FROM public.orders
  WHERE id = a.order_id
  FOR UPDATE;

  IF o.id IS NULL THEN
    UPDATE public.delivery_assignments SET status = 'expired', updated_at = now() WHERE id = a.id;
    RETURN NULL;
  END IF;

  -- Idempotent check for partner who already won this assignment
  IF o.assigned_partner_id = a.partner_id THEN
    UPDATE public.delivery_assignments
    SET status = 'accepted', responded_at = coalesce(responded_at, now()), updated_at = now()
    WHERE id = a.id;
    RETURN a.id;
  END IF;

  IF o.assigned_partner_id IS NOT NULL THEN
    UPDATE public.delivery_assignments SET status = 'expired', updated_at = now() WHERE order_id = a.order_id AND status IN ('pending', 'requested');
    RETURN NULL;
  END IF;

  IF a.status NOT IN ('pending', 'requested') OR a.expires_at < now() THEN
    UPDATE public.delivery_assignments SET status = 'expired', updated_at = now() WHERE id = a.id AND status IN ('pending', 'requested');
    RETURN NULL;
  END IF;

  target_order_status := 'assigned'::public.order_status;

  UPDATE public.orders
  SET status = target_order_status,
      assigned_partner_id = a.partner_id,
      rider_assigned_at = now(),
      updated_at = now()
  WHERE id = a.order_id
    AND assigned_partner_id IS NULL;

  IF NOT FOUND THEN
    UPDATE public.delivery_assignments SET status = 'expired', updated_at = now() WHERE order_id = a.order_id AND status IN ('pending', 'requested');
    RETURN NULL;
  END IF;

  UPDATE public.delivery_assignments
  SET status = 'accepted', responded_at = now(), accepted_at = now(), updated_at = now()
  WHERE id = a.id;

  -- Expire offers sent to other candidates
  UPDATE public.delivery_assignments
  SET status = 'expired', updated_at = now()
  WHERE order_id = a.order_id AND id <> a.id AND status IN ('pending', 'requested');

  UPDATE public.delivery_partners
  SET accepted_requests = accepted_requests + 1,
      availability = 'busy', updated_at = now()
  WHERE id = a.partner_id;

  INSERT INTO public.delivery_tracking (assignment_id, status, note)
  VALUES (a.id, 'accepted', 'Partner accepted delivery request');

  RETURN a.id;
END;
$$;

-- 7. Partner Rejection RPC with Immediate Redispatch
DROP FUNCTION IF EXISTS public.reject_delivery_request(uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.reject_delivery_request(_assignment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a record;
BEGIN
  SELECT * INTO a
  FROM public.delivery_assignments
  WHERE id = _assignment_id
  FOR UPDATE;

  IF a.id IS NULL OR NOT public.is_my_partner(a.partner_id) THEN
    RAISE EXCEPTION 'Delivery request not found';
  END IF;

  UPDATE public.delivery_assignments
  SET status = 'rejected', rejected_at = now(), responded_at = now(), updated_at = now()
  WHERE id = a.id;

  INSERT INTO public.delivery_tracking (assignment_id, status, note)
  VALUES (a.id, 'rejected', 'Partner rejected delivery request');

  UPDATE public.orders
  SET reassignment_count = reassignment_count + 1
  WHERE id = a.order_id;

  -- Instantly trigger dispatch for next best candidate
  PERFORM public.dispatch_delivery_for_order_internal(a.order_id, 45);
END;
$$;

-- 8. Granular Rider Delivery Status Advancement
DROP FUNCTION IF EXISTS public.advance_delivery_assignment(uuid, text) CASCADE;
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
    RAISE EXCEPTION 'Delivery assignment is closed';
  END IF;

  IF NOT (
    (a.status = 'accepted' AND _next_status = 'navigating_to_vendor') OR
    (a.status = 'navigating_to_vendor' AND _next_status = 'reached_vendor') OR
    (a.status = 'reached_vendor' AND _next_status = 'picked_up') OR
    (a.status = 'picked_up' AND _next_status = 'out_for_delivery') OR
    (a.status = 'out_for_delivery' AND _next_status = 'at_customer')
  ) THEN
    RAISE EXCEPTION 'Invalid delivery status transition from % to %', a.status, _next_status;
  END IF;

  SELECT * INTO o
  FROM public.orders
  WHERE id = a.order_id
  FOR UPDATE;

  IF o.id IS NULL OR o.assigned_partner_id <> a.partner_id THEN
    RAISE EXCEPTION 'Order is not assigned to this delivery partner';
  END IF;

  IF o.status::text = 'cancelled' THEN
    RAISE EXCEPTION 'Order was cancelled';
  END IF;

  next_order_status := CASE _next_status
    WHEN 'reached_vendor' THEN 'rider_at_shop'::public.order_status
    WHEN 'picked_up' THEN 'picked_up'::public.order_status
    WHEN 'out_for_delivery' THEN 'out_for_delivery'::public.order_status
    WHEN 'at_customer' THEN 'at_customer'::public.order_status
    ELSE 'assigned'::public.order_status
  END;

  UPDATE public.delivery_assignments
  SET status = _next_status,
      pickup_at = CASE WHEN _next_status = 'reached_vendor' THEN coalesce(pickup_at, now()) ELSE pickup_at END,
      picked_up_at = CASE WHEN _next_status = 'picked_up' THEN coalesce(picked_up_at, now()) ELSE picked_up_at END,
      out_for_delivery_at = CASE WHEN _next_status = 'out_for_delivery' THEN coalesce(out_for_delivery_at, now()) ELSE out_for_delivery_at END,
      arrived_at_customer_at = CASE WHEN _next_status = 'at_customer' THEN coalesce(arrived_at_customer_at, now()) ELSE arrived_at_customer_at END,
      updated_at = now()
  WHERE id = a.id;

  UPDATE public.orders
  SET status = next_order_status,
      rider_at_shop_at = CASE WHEN _next_status = 'reached_vendor' THEN coalesce(rider_at_shop_at, now()) ELSE rider_at_shop_at END,
      picked_up_at = CASE WHEN _next_status = 'picked_up' THEN coalesce(picked_up_at, now()) ELSE picked_up_at END,
      out_for_delivery_at = CASE WHEN _next_status = 'out_for_delivery' THEN coalesce(out_for_delivery_at, now()) ELSE out_for_delivery_at END,
      arrived_at_customer_at = CASE WHEN _next_status = 'at_customer' THEN coalesce(arrived_at_customer_at, now()) ELSE arrived_at_customer_at END,
      updated_at = now()
  WHERE id = o.id;

  INSERT INTO public.delivery_tracking (assignment_id, status, note)
  VALUES (a.id, _next_status, 'Partner advanced delivery status to ' || _next_status);

  RETURN jsonb_build_object(
    'assignment_id', a.id,
    'order_id', o.id,
    'assignment_status', _next_status,
    'order_status', next_order_status::text
  );
END;
$$;

-- 9. Verified Shop Pickup Confirmation RPC
DROP FUNCTION IF EXISTS public.confirm_shop_pickup(uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.confirm_shop_pickup(_assignment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.advance_delivery_assignment(_assignment_id, 'picked_up');
END;
$$;

-- 10. Verified Delivery Completion RPC
DROP FUNCTION IF EXISTS public.complete_delivery(uuid, text, text) CASCADE;
CREATE OR REPLACE FUNCTION public.complete_delivery(
  _assignment_id uuid,
  _proof_type text,
  _proof_value text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
DECLARE
  a record;
  o record;
  fee numeric;
  earning_row_count integer := 0;
BEGIN
  SELECT * INTO a FROM public.delivery_assignments WHERE id = _assignment_id FOR UPDATE;
  IF a.id IS NULL OR NOT public.is_my_partner(a.partner_id) THEN
    RAISE EXCEPTION 'Delivery assignment not found';
  END IF;

  IF a.status = 'delivered' THEN
    RETURN;
  END IF;

  IF a.status NOT IN ('out_for_delivery', 'at_customer') THEN
    RAISE EXCEPTION 'Delivery must be out for delivery or at customer before completion';
  END IF;

  SELECT * INTO o FROM public.orders WHERE id = a.order_id FOR UPDATE;
  IF o.id IS NULL OR o.assigned_partner_id <> a.partner_id THEN
    RAISE EXCEPTION 'Order is not assigned to this partner';
  END IF;

  IF o.status::text = 'cancelled' THEN
    RAISE EXCEPTION 'Cannot complete a cancelled order';
  END IF;

  IF _proof_type NOT IN ('otp', 'photo') OR coalesce(trim(_proof_value), '') = '' THEN
    RAISE EXCEPTION 'Delivery proof is required';
  END IF;

  IF _proof_type = 'otp' AND _proof_value <> coalesce(o.delivery_otp, '') THEN
    RAISE EXCEPTION 'Incorrect delivery OTP';
  END IF;

  IF _proof_type = 'photo' AND NOT EXISTS (
    SELECT 1 FROM storage.objects so
    WHERE so.bucket_id = 'delivery-docs' AND so.name = _proof_value
      AND so.name LIKE (auth.uid()::text || '/%')
  ) THEN
    RAISE EXCEPTION 'Delivery proof photo was not uploaded by this partner';
  END IF;

  fee := coalesce(a.estimated_earning, o.shipping_fee, 25.0);

  UPDATE public.delivery_assignments
  SET status = 'delivered', delivered_at = now(), proof_type = _proof_type,
      proof_value = _proof_value, updated_at = now()
  WHERE id = a.id;

  UPDATE public.orders
  SET status = 'delivered', delivered_at = now(), updated_at = now()
  WHERE id = o.id;

  INSERT INTO public.delivery_tracking (assignment_id, status, note)
  VALUES (a.id, 'delivered', 'Order successfully delivered to customer');

  INSERT INTO public.delivery_earnings (partner_id, assignment_id, amount, description)
  VALUES (a.partner_id, a.id, fee, 'Delivery ' || o.order_number)
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS earning_row_count = ROW_COUNT;
  IF earning_row_count > 0 THEN
    INSERT INTO public.delivery_wallets (partner_id, pending_balance) VALUES (a.partner_id, fee)
    ON CONFLICT (partner_id) DO UPDATE SET pending_balance = public.delivery_wallets.pending_balance + EXCLUDED.pending_balance, updated_at = now();

    INSERT INTO public.delivery_wallet_transactions (partner_id, assignment_id, type, amount, reference)
    VALUES (a.partner_id, a.id, 'delivery_earning', fee, o.order_number);

    UPDATE public.delivery_partners
    SET total_deliveries = total_deliveries + 1, availability = 'online', updated_at = now()
    WHERE id = a.partner_id;
  END IF;
END;
$$;

-- 11. Admin Maintenance & Exception Resolution RPCs
DROP FUNCTION IF EXISTS public.admin_reassign_delivery(uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.admin_reassign_delivery(_assignment_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a record;
  new_assignment_id uuid;
BEGIN
  IF NOT (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'admin'
    ) OR EXISTS (
      SELECT 1 FROM public.app_admins aa
      WHERE aa.user_id = auth.uid()
    )
  ) THEN
    RAISE EXCEPTION 'Admin privileges required';
  END IF;

  SELECT * INTO a FROM public.delivery_assignments WHERE id = _assignment_id FOR UPDATE;
  IF a.id IS NULL THEN
    RAISE EXCEPTION 'Assignment not found';
  END IF;

  UPDATE public.delivery_assignments
  SET status = 'reassigned', updated_at = now()
  WHERE id = a.id;

  UPDATE public.orders
  SET assigned_partner_id = NULL, updated_at = now()
  WHERE id = a.order_id;

  IF a.partner_id IS NOT NULL THEN
    UPDATE public.delivery_partners
    SET availability = 'online', updated_at = now()
    WHERE id = a.partner_id;
  END IF;

  INSERT INTO public.delivery_tracking (assignment_id, status, note)
  VALUES (a.id, 'reassigned', 'Delivery reassigned by admin');

  new_assignment_id := public.dispatch_delivery_for_order_internal(a.order_id, 45);

  RETURN coalesce(new_assignment_id::text, 'Reassignment queued for available candidates');
END;
$$;

DROP FUNCTION IF EXISTS public.resolve_delivery_exception(uuid, text, text) CASCADE;
CREATE OR REPLACE FUNCTION public.resolve_delivery_exception(
  _exception_id uuid,
  _status text,
  _note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'admin'
    ) OR EXISTS (
      SELECT 1 FROM public.app_admins aa
      WHERE aa.user_id = auth.uid()
    )
  ) THEN
    RAISE EXCEPTION 'Admin privileges required';
  END IF;

  UPDATE public.delivery_exceptions
  SET resolution_status = _status,
      resolution_note = _note,
      updated_at = now()
  WHERE id = _exception_id;
END;
$$;

-- 12. Security & Grant Controls
GRANT EXECUTE ON FUNCTION public.validate_order_status_transition(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_rider_dispatch_score(double precision, double precision, integer, double precision, integer, double precision) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_delivery_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_delivery_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.advance_delivery_assignment(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_shop_pickup(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_delivery(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reassign_delivery(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_delivery_exception(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.expire_and_redispatch_assignments() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
