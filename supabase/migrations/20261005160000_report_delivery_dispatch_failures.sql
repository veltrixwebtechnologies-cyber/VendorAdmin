-- Keep an order ready for pickup even if dispatch fails, but return the failure
-- to Seller Hub instead of silently reporting a successful broadcast.
CREATE OR REPLACE FUNCTION public.vendor_mark_ready_for_pickup(_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  o public.orders;
  s_id uuid;
  dispatched_count integer := 0;
  assignment_id uuid;
  dispatch_error text;
BEGIN
  SELECT id INTO s_id
  FROM public.sellers
  WHERE user_id = auth.uid()
  LIMIT 1;

  IF s_id IS NULL THEN
    RAISE EXCEPTION 'Vendor profile required';
  END IF;

  SELECT * INTO o
  FROM public.orders
  WHERE id = _order_id
  FOR UPDATE;

  IF o.id IS NULL OR o.seller_id <> s_id THEN
    RAISE EXCEPTION 'Order not found or unauthorized';
  END IF;

  IF o.status::text NOT IN ('vendor_accepted', 'accepted', 'preparing', 'packed') THEN
    RAISE EXCEPTION 'Order must be accepted by vendor before marking ready (current status: %)', o.status;
  END IF;

  UPDATE public.orders
  SET status = 'ready_for_pickup'::public.order_status,
      updated_at = now()
  WHERE id = _order_id
  RETURNING * INTO o;

  BEGIN
    dispatched_count := COALESCE(public.broadcast_delivery_request(_order_id, 60), 0);
    IF dispatched_count = 0 THEN
      assignment_id := public.dispatch_delivery_for_order_internal(_order_id, 60);
      IF assignment_id IS NOT NULL THEN
        dispatched_count := 1;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS dispatch_error = MESSAGE_TEXT;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'ready_for_pickup',
    'dispatched_count', dispatched_count,
    'dispatch_error', dispatch_error
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.vendor_mark_ready_for_pickup(uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
