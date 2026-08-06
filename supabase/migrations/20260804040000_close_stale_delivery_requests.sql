-- Close duplicate pending requests when the order was already assigned.
-- This prevents the partner client from repeatedly reopening a stale popup.
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
    UPDATE public.delivery_assignments
    SET status = 'expired', updated_at = now()
    WHERE order_id = a.order_id
      AND status IN ('pending', 'requested');
    RAISE EXCEPTION 'Delivery request is no longer available';
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
