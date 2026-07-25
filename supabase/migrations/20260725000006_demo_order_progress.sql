-- Temporary automatic fulfillment for the current dummy-payment environment.
-- Razorpay-backed production orders must be created with is_demo = false.
ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.advance_demo_order(p_order_id uuid)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  current_order public.orders;
  next_status public.order_status;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT *
  INTO current_order
  FROM public.orders
  WHERE id = p_order_id
    AND user_id = current_user_id
    AND is_demo = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demo order not found';
  END IF;

  next_status := CASE current_order.status::text
    WHEN 'new' THEN 'accepted'::public.order_status
    WHEN 'accepted' THEN 'packed'::public.order_status
    WHEN 'packed' THEN 'ready_for_pickup'::public.order_status
    WHEN 'ready_for_pickup' THEN 'out_for_delivery'::public.order_status
    WHEN 'out_for_delivery' THEN 'delivered'::public.order_status
    WHEN 'shipped' THEN 'delivered'::public.order_status
    ELSE NULL
  END;

  IF next_status IS NULL THEN
    RETURN current_order;
  END IF;

  UPDATE public.orders
  SET
    status = next_status,
    delivered_at = CASE WHEN next_status::text = 'delivered' THEN now() ELSE delivered_at END
  WHERE id = p_order_id
  RETURNING * INTO current_order;

  RETURN current_order;
END;
$$;

REVOKE ALL ON FUNCTION public.advance_demo_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.advance_demo_order(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
