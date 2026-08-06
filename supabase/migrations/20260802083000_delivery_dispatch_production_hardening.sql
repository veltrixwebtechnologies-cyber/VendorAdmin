-- Production hardening for LocalShoree delivery dispatch.
-- This migration keeps the existing shared orders schema and adds safer RPCs
-- used by Seller Hub, Shoreline Shopper, and Delivery Partner Hub.

CREATE OR REPLACE FUNCTION public.delivery_distance_km(
  lat1 double precision,
  lng1 double precision,
  lat2 double precision,
  lng2 double precision
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN lat1 IS NULL OR lng1 IS NULL OR lat2 IS NULL OR lng2 IS NULL THEN NULL
    ELSE (
      6371 * 2 * asin(
        least(1, sqrt(
          power(sin(radians((lat2 - lat1) / 2)), 2) +
          cos(radians(lat1)) * cos(radians(lat2)) *
          power(sin(radians((lng2 - lng1) / 2)), 2)
        ))
      )
    )
  END
$$;

DO $$
DECLARE
  missing_tables text[];
BEGIN
  SELECT array_agg(table_name)
  INTO missing_tables
  FROM (
    VALUES
      ('public.orders'),
      ('public.sellers'),
      ('public.delivery_partners'),
      ('public.delivery_assignments'),
      ('public.delivery_earnings'),
      ('public.delivery_notifications'),
      ('public.delivery_locations'),
      ('public.delivery_tracking'),
      ('public.delivery_partner_zones'),
      ('public.delivery_zones')
  ) AS required(table_name)
  WHERE to_regclass(required.table_name) IS NULL;

  IF missing_tables IS NOT NULL THEN
    RAISE EXCEPTION 'Preflight failed: required canonical tables are missing: %', array_to_string(missing_tables, ', ');
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  partner_id uuid REFERENCES public.delivery_partners(id) ON DELETE SET NULL,
  channel text NOT NULL DEFAULT 'in_app',
  kind text NOT NULL DEFAULT 'general',
  title text NOT NULL,
  body text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage notification outbox" ON public.notification_outbox;
CREATE POLICY "Admins manage notification outbox"
ON public.notification_outbox FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE TABLE IF NOT EXISTS public.delivery_wallets (
  partner_id uuid PRIMARY KEY REFERENCES public.delivery_partners(id) ON DELETE CASCADE,
  pending_balance numeric(10,2) NOT NULL DEFAULT 0,
  available_balance numeric(10,2) NOT NULL DEFAULT 0,
  settled_balance numeric(10,2) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.delivery_wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.delivery_partners(id) ON DELETE CASCADE,
  assignment_id uuid REFERENCES public.delivery_assignments(id) ON DELETE SET NULL,
  type text NOT NULL,
  amount numeric(10,2) NOT NULL,
  reference text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.delivery_withdrawal_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.delivery_partners(id) ON DELETE CASCADE,
  amount numeric(10,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'requested',
  payment_reference text,
  admin_note text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

ALTER TABLE public.delivery_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_withdrawal_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "partner wallet access" ON public.delivery_wallets;
CREATE POLICY "partner wallet access" ON public.delivery_wallets FOR SELECT TO authenticated
USING (public.is_my_partner(partner_id) OR public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "partner wallet transaction access" ON public.delivery_wallet_transactions;
CREATE POLICY "partner wallet transaction access" ON public.delivery_wallet_transactions FOR SELECT TO authenticated
USING (public.is_my_partner(partner_id) OR public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "partner withdrawal access" ON public.delivery_withdrawal_requests;
CREATE POLICY "partner withdrawal access" ON public.delivery_withdrawal_requests FOR SELECT TO authenticated
USING (public.is_my_partner(partner_id) OR public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "partner creates withdrawal" ON public.delivery_withdrawal_requests;
CREATE POLICY "partner creates withdrawal" ON public.delivery_withdrawal_requests FOR INSERT TO authenticated
WITH CHECK (public.is_my_partner(partner_id));

DROP POLICY IF EXISTS "admin updates withdrawal" ON public.delivery_withdrawal_requests;
CREATE POLICY "admin updates withdrawal" ON public.delivery_withdrawal_requests FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

ALTER TABLE public.delivery_locations
  ADD COLUMN IF NOT EXISTS accuracy_m double precision,
  ADD COLUMN IF NOT EXISTS captured_at timestamptz,
  ADD COLUMN IF NOT EXISTS speed_kmh double precision;

ALTER TABLE public.delivery_partners
  ADD COLUMN IF NOT EXISTS total_earnings numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_ratings integer NOT NULL DEFAULT 0;

ALTER TABLE public.delivery_assignments
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS pickup_at timestamptz,
  ADD COLUMN IF NOT EXISTS out_for_delivery_at timestamptz;

DO $$
DECLARE
  missing_order_columns text[];
  missing_seller_columns text[];
  missing_partner_columns text[];
  missing_assignment_columns text[];
  missing_earning_columns text[];
  missing_notification_columns text[];
  missing_tracking_columns text[];
  missing_location_columns text[];
  missing_partner_zone_columns text[];
  missing_zone_columns text[];
  missing_outbox_columns text[];
  missing_wallet_columns text[];
  missing_wallet_transaction_columns text[];
  missing_withdrawal_columns text[];
BEGIN
  SELECT array_agg(column_name)
  INTO missing_order_columns
  FROM unnest(ARRAY[
    'id',
    'user_id',
    'seller_id',
    'status',
    'assigned_partner_id',
    'buyer_address',
    'customer_latitude',
    'customer_longitude',
    'shipping_fee',
    'delivery_otp',
    'delivered_at',
    'order_number'
  ]) AS required(column_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'orders'
      AND c.column_name = required.column_name
  );

  IF missing_order_columns IS NOT NULL THEN
    RAISE EXCEPTION 'Preflight failed: public.orders is missing required columns: %', array_to_string(missing_order_columns, ', ');
  END IF;

  SELECT array_agg(column_name)
  INTO missing_seller_columns
  FROM unnest(ARRAY['id', 'user_id']) AS required(column_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'sellers'
      AND c.column_name = required.column_name
  );

  IF missing_seller_columns IS NOT NULL THEN
    RAISE EXCEPTION 'Preflight failed: public.sellers is missing required columns: %', array_to_string(missing_seller_columns, ', ');
  END IF;

  SELECT array_agg(column_name)
  INTO missing_partner_columns
  FROM unnest(ARRAY[
    'id',
    'user_id',
    'status',
    'availability',
    'current_latitude',
    'current_longitude',
    'location_updated_at',
    'rating',
    'created_at',
    'total_requests',
    'total_deliveries',
    'total_earnings',
    'total_ratings',
    'updated_at'
  ]) AS required(column_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'delivery_partners'
      AND c.column_name = required.column_name
  );

  IF missing_partner_columns IS NOT NULL THEN
    RAISE EXCEPTION 'Preflight failed: public.delivery_partners is missing required columns: %', array_to_string(missing_partner_columns, ', ');
  END IF;

  SELECT array_agg(column_name)
  INTO missing_assignment_columns
  FROM unnest(ARRAY[
    'id',
    'order_id',
    'partner_id',
    'status',
    'expires_at',
    'distance_km',
    'estimated_earning',
    'accepted_at',
    'rejected_at',
    'pickup_at',
    'picked_up_at',
    'out_for_delivery_at',
    'delivered_at',
    'proof_type',
    'proof_value',
    'created_at',
    'updated_at'
  ]) AS required(column_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'delivery_assignments'
      AND c.column_name = required.column_name
  );

  IF missing_assignment_columns IS NOT NULL THEN
    RAISE EXCEPTION 'Preflight failed: public.delivery_assignments is missing required columns: %', array_to_string(missing_assignment_columns, ', ');
  END IF;

  SELECT array_agg(column_name)
  INTO missing_earning_columns
  FROM unnest(ARRAY['partner_id', 'assignment_id', 'amount', 'description']) AS required(column_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'delivery_earnings'
      AND c.column_name = required.column_name
  );

  IF missing_earning_columns IS NOT NULL THEN
    RAISE EXCEPTION 'Preflight failed: public.delivery_earnings is missing required columns: %', array_to_string(missing_earning_columns, ', ');
  END IF;

  SELECT array_agg(column_name)
  INTO missing_notification_columns
  FROM unnest(ARRAY['partner_id', 'title', 'body', 'kind']) AS required(column_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'delivery_notifications'
      AND c.column_name = required.column_name
  );

  IF missing_notification_columns IS NOT NULL THEN
    RAISE EXCEPTION 'Preflight failed: public.delivery_notifications is missing required columns: %', array_to_string(missing_notification_columns, ', ');
  END IF;

  SELECT array_agg(column_name)
  INTO missing_tracking_columns
  FROM unnest(ARRAY['assignment_id', 'status', 'note']) AS required(column_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'delivery_tracking'
      AND c.column_name = required.column_name
  );

  IF missing_tracking_columns IS NOT NULL THEN
    RAISE EXCEPTION 'Preflight failed: public.delivery_tracking is missing required columns: %', array_to_string(missing_tracking_columns, ', ');
  END IF;

  SELECT array_agg(column_name)
  INTO missing_location_columns
  FROM unnest(ARRAY['partner_id', 'assignment_id', 'latitude', 'longitude', 'accuracy_m', 'captured_at', 'speed_kmh']) AS required(column_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'delivery_locations'
      AND c.column_name = required.column_name
  );

  IF missing_location_columns IS NOT NULL THEN
    RAISE EXCEPTION 'Preflight failed: public.delivery_locations is missing required columns: %', array_to_string(missing_location_columns, ', ');
  END IF;

  SELECT array_agg(column_name)
  INTO missing_partner_zone_columns
  FROM unnest(ARRAY['partner_id', 'zone_id']) AS required(column_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'delivery_partner_zones'
      AND c.column_name = required.column_name
  );

  IF missing_partner_zone_columns IS NOT NULL THEN
    RAISE EXCEPTION 'Preflight failed: public.delivery_partner_zones is missing required columns: %', array_to_string(missing_partner_zone_columns, ', ');
  END IF;

  SELECT array_agg(column_name)
  INTO missing_zone_columns
  FROM unnest(ARRAY['id', 'name', 'city', 'is_active']) AS required(column_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'delivery_zones'
      AND c.column_name = required.column_name
  );

  IF missing_zone_columns IS NOT NULL THEN
    RAISE EXCEPTION 'Preflight failed: public.delivery_zones is missing required columns: %', array_to_string(missing_zone_columns, ', ');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'delivery_assignments'
      AND constraint_type = 'UNIQUE'
      AND constraint_name IN (
        SELECT tc.constraint_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage k1 ON k1.constraint_name = tc.constraint_name
          AND k1.table_schema = tc.table_schema
          AND k1.table_name = tc.table_name
          AND k1.column_name = 'order_id'
        JOIN information_schema.key_column_usage k2 ON k2.constraint_name = tc.constraint_name
          AND k2.table_schema = tc.table_schema
          AND k2.table_name = tc.table_name
          AND k2.column_name = 'partner_id'
        WHERE tc.table_schema = 'public'
          AND tc.table_name = 'delivery_assignments'
      )
  ) THEN
    RAISE EXCEPTION 'Preflight failed: public.delivery_assignments must have a UNIQUE(order_id, partner_id) constraint before dispatch hardening';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.delivery_earnings
    WHERE assignment_id IS NOT NULL
    GROUP BY assignment_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Preflight failed: duplicate public.delivery_earnings.assignment_id rows exist. Resolve duplicates before adding delivery_earnings_one_per_assignment_idx.';
  END IF;

  SELECT array_agg(column_name)
  INTO missing_outbox_columns
  FROM unnest(ARRAY[
    'id',
    'recipient_user_id',
    'partner_id',
    'channel',
    'kind',
    'title',
    'body',
    'payload',
    'status',
    'attempts',
    'next_attempt_at',
    'sent_at',
    'last_error',
    'created_at',
    'updated_at'
  ]) AS required(column_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'notification_outbox'
      AND c.column_name = required.column_name
  );

  IF missing_outbox_columns IS NOT NULL THEN
    RAISE EXCEPTION 'Preflight failed: public.notification_outbox is missing required columns: %', array_to_string(missing_outbox_columns, ', ');
  END IF;

  SELECT array_agg(column_name)
  INTO missing_wallet_columns
  FROM unnest(ARRAY['partner_id', 'pending_balance', 'available_balance', 'settled_balance', 'updated_at']) AS required(column_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'delivery_wallets'
      AND c.column_name = required.column_name
  );

  IF missing_wallet_columns IS NOT NULL THEN
    RAISE EXCEPTION 'Preflight failed: public.delivery_wallets is missing required columns: %', array_to_string(missing_wallet_columns, ', ');
  END IF;

  SELECT array_agg(column_name)
  INTO missing_wallet_transaction_columns
  FROM unnest(ARRAY['id', 'partner_id', 'assignment_id', 'type', 'amount', 'reference', 'metadata', 'created_at']) AS required(column_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'delivery_wallet_transactions'
      AND c.column_name = required.column_name
  );

  IF missing_wallet_transaction_columns IS NOT NULL THEN
    RAISE EXCEPTION 'Preflight failed: public.delivery_wallet_transactions is missing required columns: %', array_to_string(missing_wallet_transaction_columns, ', ');
  END IF;

  SELECT array_agg(column_name)
  INTO missing_withdrawal_columns
  FROM unnest(ARRAY['id', 'partner_id', 'amount', 'status', 'payment_reference', 'admin_note', 'requested_at', 'processed_at']) AS required(column_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'delivery_withdrawal_requests'
      AND c.column_name = required.column_name
  );

  IF missing_withdrawal_columns IS NOT NULL THEN
    RAISE EXCEPTION 'Preflight failed: public.delivery_withdrawal_requests is missing required columns: %', array_to_string(missing_withdrawal_columns, ', ');
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS delivery_earnings_one_per_assignment_idx
ON public.delivery_earnings(assignment_id)
WHERE assignment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS delivery_assignments_pending_idx
ON public.delivery_assignments(order_id, status, expires_at);

CREATE INDEX IF NOT EXISTS delivery_partners_dispatch_idx
ON public.delivery_partners(status, availability, location_updated_at);

CREATE OR REPLACE FUNCTION public.enqueue_delivery_notification(
  _partner_id uuid,
  _title text,
  _body text,
  _kind text DEFAULT 'general',
  _payload jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  notification_id uuid;
  partner_user_id uuid;
BEGIN
  SELECT user_id INTO partner_user_id
  FROM public.delivery_partners
  WHERE id = _partner_id;

  INSERT INTO public.delivery_notifications (partner_id, title, body, kind)
  VALUES (_partner_id, _title, _body, _kind)
  RETURNING id INTO notification_id;

  INSERT INTO public.notification_outbox (
    recipient_user_id, partner_id, channel, kind, title, body, payload
  )
  VALUES (
    partner_user_id,
    _partner_id,
    'in_app',
    _kind,
    _title,
    _body,
    coalesce(_payload, '{}'::jsonb)
  );

  RETURN notification_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.dispatch_delivery_for_order_internal(
  _order_id uuid,
  _timeout_seconds integer DEFAULT 60
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o record;
  selected_partner record;
  assignment_id uuid;
  max_radius_km numeric := 12;
BEGIN
  SELECT * INTO o
  FROM public.orders
  WHERE id = _order_id
  FOR UPDATE;

  IF o.id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF o.assigned_partner_id IS NOT NULL THEN
    SELECT id INTO assignment_id
    FROM public.delivery_assignments
    WHERE order_id = o.id
      AND partner_id = o.assigned_partner_id
      AND status NOT IN ('rejected', 'expired', 'cancelled')
    ORDER BY created_at DESC
    LIMIT 1;
    RETURN assignment_id;
  END IF;

  IF o.status::text NOT IN ('accepted', 'packed', 'ready_for_pickup', 'assigned') THEN
    RETURN NULL;
  END IF;

  UPDATE public.delivery_assignments
  SET status = 'expired', updated_at = now()
  WHERE order_id = o.id
    AND status IN ('pending', 'requested')
    AND expires_at <= now();

  SELECT id INTO assignment_id
  FROM public.delivery_assignments
  WHERE order_id = o.id
    AND status IN ('pending', 'requested')
    AND expires_at > now()
  ORDER BY created_at ASC
  LIMIT 1;

  IF assignment_id IS NOT NULL THEN
    RETURN assignment_id;
  END IF;

  SELECT
    p.id,
    public.delivery_distance_km(
      p.current_latitude,
      p.current_longitude,
      o.customer_latitude,
      o.customer_longitude
    ) AS distance_km
  INTO selected_partner
  FROM public.delivery_partners p
  WHERE p.status = 'approved'
    AND p.availability = 'online'
    AND p.current_latitude IS NOT NULL
    AND p.current_longitude IS NOT NULL
    AND p.location_updated_at > now() - interval '10 minutes'
    AND NOT EXISTS (
      SELECT 1
      FROM public.delivery_assignments active_a
      WHERE active_a.partner_id = p.id
        AND active_a.status IN (
          'accepted',
          'navigating_to_vendor',
          'reached_vendor',
          'picked_up',
          'out_for_delivery'
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.delivery_assignments prior
      WHERE prior.order_id = o.id
        AND prior.partner_id = p.id
        AND prior.status IN ('rejected', 'expired')
    )
    AND (
      NOT EXISTS (SELECT 1 FROM public.delivery_partner_zones z WHERE z.partner_id = p.id)
      OR EXISTS (
        SELECT 1
        FROM public.delivery_partner_zones z
        JOIN public.delivery_zones dz ON dz.id = z.zone_id
        WHERE z.partner_id = p.id
          AND dz.is_active = true
          AND (
            o.buyer_address ILIKE '%' || dz.name || '%'
            OR o.buyer_address ILIKE '%' || dz.city || '%'
          )
      )
    )
    AND (
      o.customer_latitude IS NULL
      OR public.delivery_distance_km(
        p.current_latitude,
        p.current_longitude,
        o.customer_latitude,
        o.customer_longitude
      ) <= max_radius_km
    )
  ORDER BY
    public.delivery_distance_km(
      p.current_latitude,
      p.current_longitude,
      o.customer_latitude,
      o.customer_longitude
    ) ASC NULLS LAST,
    p.rating DESC,
    p.created_at ASC
  LIMIT 1;

  IF selected_partner.id IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.delivery_assignments (
    order_id,
    partner_id,
    distance_km,
    estimated_earning,
    expires_at
  )
  VALUES (
    o.id,
    selected_partner.id,
    round(coalesce(selected_partner.distance_km, 0)::numeric, 2),
    coalesce(o.shipping_fee, 0),
    now() + make_interval(secs => greatest(_timeout_seconds, 30))
  )
  ON CONFLICT (order_id, partner_id) DO UPDATE
  SET status = 'pending',
      distance_km = EXCLUDED.distance_km,
      estimated_earning = EXCLUDED.estimated_earning,
      expires_at = EXCLUDED.expires_at,
      updated_at = now()
  WHERE public.delivery_assignments.status IN ('expired', 'rejected')
  RETURNING id INTO assignment_id;

  IF assignment_id IS NOT NULL THEN
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
  END IF;

  RETURN assignment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.broadcast_delivery_request(
  _order_id uuid,
  _timeout_seconds integer DEFAULT 60
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o record;
  assignment_id uuid;
BEGIN
  SELECT * INTO o
  FROM public.orders
  WHERE id = _order_id;

  IF o.id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF auth.role() <> 'service_role'
     AND NOT public.has_role(auth.uid(), 'admin'::public.app_role)
     AND NOT EXISTS (
       SELECT 1
       FROM public.sellers s
       WHERE s.id = o.seller_id
         AND s.user_id = auth.uid()
     ) THEN
    RAISE EXCEPTION 'Not allowed to dispatch this order';
  END IF;

  assignment_id := public.dispatch_delivery_for_order_internal(_order_id, _timeout_seconds);
  IF assignment_id IS NULL THEN
    RETURN 0;
  END IF;
  RETURN 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.dispatch_delivery_for_order(
  _order_id uuid,
  _timeout_seconds integer DEFAULT 60
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o record;
BEGIN
  SELECT * INTO o
  FROM public.orders
  WHERE id = _order_id;

  IF o.id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF auth.role() <> 'service_role'
     AND NOT public.has_role(auth.uid(), 'admin'::public.app_role)
     AND NOT EXISTS (
       SELECT 1
       FROM public.sellers s
       WHERE s.id = o.seller_id
         AND s.user_id = auth.uid()
     ) THEN
    RAISE EXCEPTION 'Not allowed to dispatch this order';
  END IF;

  RETURN public.dispatch_delivery_for_order_internal(_order_id, _timeout_seconds);
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_delivery_assignments()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  expired_order record;
  expired_count integer := 0;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Only service role jobs can expire delivery assignments';
  END IF;

  FOR expired_order IN
    UPDATE public.delivery_assignments
    SET status = 'expired', updated_at = now()
    WHERE status IN ('pending', 'requested')
      AND expires_at <= now()
    RETURNING order_id
  LOOP
    expired_count := expired_count + 1;
    PERFORM public.dispatch_delivery_for_order_internal(expired_order.order_id, 60);
  END LOOP;
  RETURN expired_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_delivery_request(_assignment_id uuid)
RETURNS uuid
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

  IF a.status NOT IN ('pending', 'requested') OR a.expires_at < now() THEN
    UPDATE public.delivery_assignments
    SET status = 'expired', updated_at = now()
    WHERE id = a.id AND status IN ('pending', 'requested');
    PERFORM public.dispatch_delivery_for_order_internal(a.order_id, 60);
    RAISE EXCEPTION 'Delivery request is no longer available';
  END IF;

  UPDATE public.orders
  SET status = 'assigned', assigned_partner_id = a.partner_id
  WHERE id = a.order_id
    AND assigned_partner_id IS NULL
    AND status::text IN ('ready_for_pickup', 'assigned');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order already assigned';
  END IF;

  UPDATE public.delivery_assignments
  SET status = 'accepted', responded_at = now(), updated_at = now()
  WHERE id = a.id;

  UPDATE public.delivery_assignments
  SET status = 'expired', updated_at = now()
  WHERE order_id = a.order_id
    AND id <> a.id
    AND status IN ('pending', 'requested');

  UPDATE public.delivery_partners
  SET accepted_requests = accepted_requests + 1,
      availability = 'busy',
      updated_at = now()
  WHERE id = a.partner_id;

  INSERT INTO public.delivery_tracking (assignment_id, status, note)
  VALUES (a.id, 'accepted', 'Partner accepted the delivery');

  RETURN a.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_delivery_request(_assignment_id uuid)
RETURNS uuid
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

  IF a.status NOT IN ('pending', 'requested') THEN
    RAISE EXCEPTION 'Delivery request is no longer available';
  END IF;

  UPDATE public.delivery_assignments
  SET status = 'rejected', responded_at = now(), updated_at = now()
  WHERE id = a.id;

  PERFORM public.dispatch_delivery_for_order_internal(a.order_id, 60);

  RETURN a.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_delivery(
  _assignment_id uuid,
  _proof_type text,
  _proof_value text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a record;
  o record;
  fee numeric;
  earning_row_count integer := 0;
BEGIN
  SELECT * INTO a
  FROM public.delivery_assignments
  WHERE id = _assignment_id
  FOR UPDATE;

  IF a.id IS NULL OR NOT public.is_my_partner(a.partner_id) THEN
    RAISE EXCEPTION 'Delivery assignment not found';
  END IF;

  IF a.status = 'delivered' THEN
    RETURN;
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
  SET status = 'delivered',
      delivered_at = now(),
      proof_type = _proof_type,
      proof_value = _proof_value,
      updated_at = now()
  WHERE id = a.id;

  UPDATE public.orders
  SET status = 'delivered', delivered_at = now()
  WHERE id = o.id;

  INSERT INTO public.delivery_tracking (assignment_id, status, note)
  VALUES (a.id, 'delivered', 'Delivered to customer');

  INSERT INTO public.delivery_earnings (partner_id, assignment_id, amount, description)
  VALUES (a.partner_id, a.id, fee, 'Delivery ' || o.order_number)
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS earning_row_count = ROW_COUNT;

  IF earning_row_count > 0 THEN
    INSERT INTO public.delivery_wallets (partner_id, pending_balance)
    VALUES (a.partner_id, fee)
    ON CONFLICT (partner_id) DO UPDATE
    SET pending_balance = public.delivery_wallets.pending_balance + EXCLUDED.pending_balance,
        updated_at = now();

    INSERT INTO public.delivery_wallet_transactions (
      partner_id,
      assignment_id,
      type,
      amount,
      reference
    )
    VALUES (a.partner_id, a.id, 'delivery_earning', fee, o.order_number);

    UPDATE public.delivery_partners
    SET total_deliveries = total_deliveries + 1,
        availability = 'online',
        updated_at = now()
    WHERE id = a.partner_id;
  END IF;

  RETURN;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_partner_location(
  _latitude double precision,
  _longitude double precision,
  _accuracy_m double precision DEFAULT NULL,
  _captured_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p record;
  last_loc record;
  active_assignment_id uuid;
  distance_km double precision;
  elapsed_hours double precision;
  speed_kmh double precision;
BEGIN
  SELECT * INTO p
  FROM public.delivery_partners
  WHERE user_id = auth.uid()
  FOR UPDATE;

  IF p.id IS NULL THEN
    RAISE EXCEPTION 'Delivery partner profile not found';
  END IF;

  IF p.status <> 'approved' THEN
    RAISE EXCEPTION 'Only approved delivery partners can update live location';
  END IF;

  IF p.availability NOT IN ('online', 'busy') THEN
    RAISE EXCEPTION 'Go online before sharing live location';
  END IF;

  IF _latitude IS NULL OR _longitude IS NULL
     OR _latitude < -90 OR _latitude > 90
     OR _longitude < -180 OR _longitude > 180 THEN
    RAISE EXCEPTION 'Invalid GPS coordinates';
  END IF;

  -- Browser geolocation on laptops and some mobile networks can report
  -- coarse accuracy. Keep a bounded sanity check without blocking valid
  -- partner locations in those environments.
  IF _accuracy_m IS NOT NULL AND _accuracy_m > 10000 THEN
    RAISE EXCEPTION 'GPS accuracy is too low';
  END IF;

  IF _captured_at < now() - interval '5 minutes'
     OR _captured_at > now() + interval '2 minutes' THEN
    RAISE EXCEPTION 'GPS timestamp is not valid';
  END IF;

  SELECT *
  INTO last_loc
  FROM public.delivery_locations
  WHERE partner_id = p.id
  ORDER BY coalesce(captured_at, created_at) DESC
  LIMIT 1;

  IF last_loc.id IS NOT NULL THEN
    distance_km := public.delivery_distance_km(
      last_loc.latitude,
      last_loc.longitude,
      _latitude,
      _longitude
    );
    elapsed_hours := extract(epoch FROM (_captured_at - coalesce(last_loc.captured_at, last_loc.created_at))) / 3600.0;
    IF elapsed_hours > 0 THEN
      speed_kmh := distance_km / elapsed_hours;
      IF speed_kmh > 140 THEN
        RAISE EXCEPTION 'GPS movement is not realistic';
      END IF;
    END IF;
  END IF;

  SELECT id INTO active_assignment_id
  FROM public.delivery_assignments
  WHERE partner_id = p.id
    AND status IN ('accepted', 'navigating_to_vendor', 'reached_vendor', 'picked_up', 'out_for_delivery')
  ORDER BY created_at DESC
  LIMIT 1;

  INSERT INTO public.delivery_locations (
    partner_id,
    assignment_id,
    latitude,
    longitude,
    accuracy_m,
    captured_at,
    speed_kmh
  )
  VALUES (
    p.id,
    active_assignment_id,
    _latitude,
    _longitude,
    _accuracy_m,
    _captured_at,
    speed_kmh
  );

  UPDATE public.delivery_partners
  SET current_latitude = _latitude,
      current_longitude = _longitude,
      location_updated_at = now(),
      updated_at = now()
  WHERE id = p.id;

  RETURN jsonb_build_object(
    'partner_id', p.id,
    'accepted', true,
    'speed_kmh', coalesce(speed_kmh, 0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.request_delivery_contact(
  _assignment_id uuid,
  _party text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a record;
BEGIN
  SELECT *
  INTO a
  FROM public.delivery_assignments
  WHERE id = _assignment_id;

  IF a.id IS NULL OR NOT public.is_my_partner(a.partner_id) THEN
    RAISE EXCEPTION 'Delivery assignment not found';
  END IF;

  IF a.status NOT IN ('accepted', 'navigating_to_vendor', 'reached_vendor', 'picked_up', 'out_for_delivery') THEN
    RAISE EXCEPTION 'Contact is available only for active deliveries';
  END IF;

  RETURN jsonb_build_object(
    'call_available', false,
    'masked_number', 'LocalShoree support line',
    'message', 'Direct phone numbers are protected. Proxy calling is not configured yet.'
  );
END;
$$;

CREATE TABLE IF NOT EXISTS public.delivery_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES public.delivery_assignments(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  partner_id uuid NOT NULL REFERENCES public.delivery_partners(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assignment_id),
  UNIQUE (order_id, user_id)
);

DO $$
DECLARE
  missing_rating_columns text[];
BEGIN
  SELECT array_agg(column_name)
  INTO missing_rating_columns
  FROM unnest(ARRAY[
    'id',
    'assignment_id',
    'order_id',
    'partner_id',
    'user_id',
    'rating',
    'comment',
    'created_at'
  ]) AS required(column_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'delivery_ratings'
      AND c.column_name = required.column_name
  );

  IF missing_rating_columns IS NOT NULL THEN
    RAISE EXCEPTION 'Preflight failed: public.delivery_ratings exists with an incompatible schema. Missing columns: %', array_to_string(missing_rating_columns, ', ');
  END IF;
END;
$$;

ALTER TABLE public.delivery_ratings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "customers read own delivery ratings" ON public.delivery_ratings;
CREATE POLICY "customers read own delivery ratings" ON public.delivery_ratings FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.is_my_partner(partner_id) OR public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE OR REPLACE FUNCTION public.rate_delivery(
  _assignment_id uuid,
  _rating integer,
  _comment text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a record;
  o record;
  rating_id uuid;
BEGIN
  SELECT * INTO a
  FROM public.delivery_assignments
  WHERE id = _assignment_id;

  IF a.id IS NULL OR a.status <> 'delivered' THEN
    RAISE EXCEPTION 'Delivery is not completed';
  END IF;

  SELECT * INTO o
  FROM public.orders
  WHERE id = a.order_id;

  IF o.id IS NULL OR o.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'You can rate only your own delivered order';
  END IF;

  IF _rating < 1 OR _rating > 5 THEN
    RAISE EXCEPTION 'Rating must be between 1 and 5';
  END IF;

  INSERT INTO public.delivery_ratings (
    assignment_id,
    order_id,
    partner_id,
    user_id,
    rating,
    comment
  )
  VALUES (a.id, o.id, a.partner_id, auth.uid(), _rating, nullif(trim(_comment), ''))
  RETURNING id INTO rating_id;

  UPDATE public.delivery_partners p
  SET rating = sub.avg_rating,
      updated_at = now()
  FROM (
    SELECT partner_id, avg(rating)::numeric(3,2) AS avg_rating
    FROM public.delivery_ratings
    WHERE partner_id = a.partner_id
    GROUP BY partner_id
  ) sub
  WHERE p.id = sub.partner_id;

  RETURN rating_id;
END;
$$;

-- Staged rollout safety: keep legacy direct order updates in place for older
-- clients. Current clients should use the server-side delivery transition RPCs.

REVOKE ALL ON FUNCTION public.dispatch_delivery_for_order(uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.expire_delivery_assignments() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_delivery_notification(uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dispatch_delivery_for_order_internal(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_partner_location(double precision, double precision, double precision, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.request_delivery_contact(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rate_delivery(uuid, integer, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.broadcast_delivery_request(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_delivery_for_order(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_delivery_for_order(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_delivery_notification(uuid, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.dispatch_delivery_for_order_internal(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_delivery_assignments() TO service_role;
GRANT EXECUTE ON FUNCTION public.accept_delivery_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_delivery_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_delivery(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_partner_location(double precision, double precision, double precision, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_delivery_contact(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rate_delivery(uuid, integer, text) TO authenticated;
