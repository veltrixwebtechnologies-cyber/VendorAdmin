-- Prevent admin UI shortcuts from bypassing the canonical order workflow.
CREATE OR REPLACE FUNCTION public.admin_advance_order(_order_id uuid, _next_status text)
RETURNS public.orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE current_order public.orders; target public.order_status;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN RAISE EXCEPTION 'Admin access required'; END IF;
  target := _next_status::public.order_status;
  SELECT * INTO current_order FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF current_order.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF NOT (
    (current_order.status::text = 'new' AND target IN ('accepted','cancelled')) OR
    (current_order.status::text = 'accepted' AND target IN ('packed','cancelled')) OR
    (current_order.status::text = 'packed' AND target IN ('ready_for_pickup','cancelled')) OR
    (current_order.status::text = 'ready_for_pickup' AND target IN ('assigned','cancelled')) OR
    (current_order.status::text = 'assigned' AND target IN ('picked_up','cancelled')) OR
    (current_order.status::text = 'picked_up' AND target IN ('out_for_delivery','cancelled')) OR
    (current_order.status::text = 'out_for_delivery' AND target = 'delivered') OR
    (current_order.status::text = 'delivered' AND target = 'returned')
  ) THEN RAISE EXCEPTION 'Invalid order transition from % to %', current_order.status, target; END IF;
  UPDATE public.orders SET status = target, delivered_at = CASE WHEN target = 'delivered' THEN now() ELSE delivered_at END, updated_at = now()
    WHERE id = current_order.id RETURNING * INTO current_order;
  RETURN current_order;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_advance_order(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_advance_order(uuid,text) TO authenticated;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.products WHERE stock < 0 OR low_stock_threshold < 0) THEN
    RAISE EXCEPTION 'Cannot add inventory constraints while negative stock values exist';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_stock_nonnegative') THEN
    ALTER TABLE public.products ADD CONSTRAINT products_stock_nonnegative CHECK (stock >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_low_stock_threshold_nonnegative') THEN
    ALTER TABLE public.products ADD CONSTRAINT products_low_stock_threshold_nonnegative CHECK (low_stock_threshold >= 0);
  END IF;
END $$;
