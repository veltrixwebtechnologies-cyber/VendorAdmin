-- Stale requests must be closed without raising an exception. An exception
-- rolls back the expiry update, which causes partner polling to show the row
-- again. NULL means the request was closed but not accepted.
CREATE OR REPLACE FUNCTION public.accept_delivery_request(_assignment_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a record;
  o record;
  existing_assignment_id uuid;
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
    UPDATE public.delivery_assignments
    SET status = 'expired', updated_at = now()
    WHERE id = a.id;
    RETURN NULL;
  END IF;

  -- A completed/cancelled order cannot be accepted again, even if an old
  -- pending assignment row remains for this same partner.
  IF o.assigned_partner_id = a.partner_id
     AND o.status::text IN ('delivered', 'cancelled') THEN
    UPDATE public.delivery_assignments
    SET status = 'expired', updated_at = now()
    WHERE order_id = a.order_id
      AND status IN ('pending', 'requested');
    RETURN NULL;
  END IF;

  -- Idempotent retry: this partner already owns the order.
  IF o.assigned_partner_id = a.partner_id THEN
    SELECT id INTO existing_assignment_id
    FROM public.delivery_assignments
    WHERE order_id = a.order_id
      AND partner_id = a.partner_id
      AND status IN ('accepted', 'navigating_to_vendor', 'reached_vendor',
                     'picked_up', 'out_for_delivery')
    ORDER BY created_at DESC
    LIMIT 1;

    UPDATE public.delivery_assignments
    SET status = CASE
          WHEN id = coalesce(existing_assignment_id, a.id) THEN 'accepted'
          ELSE 'expired'
        END,
        responded_at = CASE
          WHEN id = coalesce(existing_assignment_id, a.id) THEN coalesce(responded_at, now())
          ELSE responded_at
        END,
        updated_at = now()
    WHERE order_id = a.order_id
      AND partner_id = a.partner_id
      AND status IN ('pending', 'requested');

    RETURN coalesce(existing_assignment_id, a.id);
  END IF;

  -- Another partner owns the order. Expire this stale request and finish
  -- successfully so the cleanup is committed.
  IF o.assigned_partner_id IS NOT NULL THEN
    UPDATE public.delivery_assignments
    SET status = 'expired', updated_at = now()
    WHERE order_id = a.order_id
      AND status IN ('pending', 'requested');
    RETURN NULL;
  END IF;

  -- Expired/non-pending requests are stale. Close them without redispatching
  -- from the partner accept path; the scheduler/admin flow owns redispatch.
  IF a.status NOT IN ('pending', 'requested') OR a.expires_at < now() THEN
    UPDATE public.delivery_assignments
    SET status = 'expired', updated_at = now()
    WHERE id = a.id AND status IN ('pending', 'requested');
    RETURN NULL;
  END IF;

  UPDATE public.orders
  SET status = 'assigned', assigned_partner_id = a.partner_id
  WHERE id = a.order_id
    AND assigned_partner_id IS NULL
    AND status::text IN ('ready_for_pickup', 'assigned');

  IF NOT FOUND THEN
    UPDATE public.delivery_assignments
    SET status = 'expired', updated_at = now()
    WHERE order_id = a.order_id
      AND status IN ('pending', 'requested');
    RETURN NULL;
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
      availability = 'busy', updated_at = now()
  WHERE id = a.partner_id;

  INSERT INTO public.delivery_tracking (assignment_id, status, note)
  VALUES (a.id, 'accepted', 'Partner accepted the delivery');

  RETURN a.id;
END;
$$;

NOTIFY pgrst, 'reload schema';
