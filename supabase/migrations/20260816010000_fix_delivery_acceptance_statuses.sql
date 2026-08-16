-- Delivery dispatch can offer orders while they are accepted or packed.
-- The accept RPC must accept those same states; otherwise a visible offer
-- returns NULL even though no other partner won the order.
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

  IF o.assigned_partner_id = a.partner_id
     AND o.status::text IN ('delivered', 'cancelled') THEN
    UPDATE public.delivery_assignments
    SET status = 'expired', updated_at = now()
    WHERE order_id = a.order_id AND status IN ('pending', 'requested');
    RETURN NULL;
  END IF;

  -- Idempotent retry for the partner that already won this order.
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

  IF o.assigned_partner_id IS NOT NULL THEN
    UPDATE public.delivery_assignments
    SET status = 'expired', updated_at = now()
    WHERE order_id = a.order_id AND status IN ('pending', 'requested');
    RETURN NULL;
  END IF;

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
    AND status::text IN ('accepted', 'packed', 'ready_for_pickup', 'assigned');

  IF NOT FOUND THEN
    UPDATE public.delivery_assignments
    SET status = 'expired', updated_at = now()
    WHERE order_id = a.order_id AND status IN ('pending', 'requested');
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

REVOKE EXECUTE ON FUNCTION public.accept_delivery_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_delivery_request(uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
