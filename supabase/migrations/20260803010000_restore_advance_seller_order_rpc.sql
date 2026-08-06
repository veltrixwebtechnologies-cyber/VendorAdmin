-- Restore the canonical seller order transition RPC.
-- This is intentionally a compatibility migration for projects where
-- 20260802000000_order_delivery_hardening.sql was not deployed.

DO $$
BEGIN
  IF to_regtype('public.order_status') IS NULL THEN
    RAISE EXCEPTION 'Required type public.order_status is missing';
  END IF;
  IF to_regprocedure('public.broadcast_delivery_request(uuid,integer)') IS NULL THEN
    RAISE EXCEPTION 'Required function public.broadcast_delivery_request(uuid,integer) is missing; deploy the delivery dispatch migration first';
  END IF;
END
$$;

-- The function is recreated with the existing signature and return contract.
-- DROP is transactional and only handles an incompatible legacy return type.
DROP FUNCTION IF EXISTS public.advance_seller_order(uuid);

CREATE FUNCTION public.advance_seller_order(_order_id uuid)
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
  SELECT *
  INTO o
  FROM public.orders
  WHERE id = _order_id
  FOR UPDATE;

  IF o.id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR EXISTS (
      SELECT 1
      FROM public.sellers s
      WHERE s.id = o.seller_id
        AND s.user_id = auth.uid()
    )
  ) THEN
    RAISE EXCEPTION 'Not allowed to update this order';
  END IF;

  -- A retry at ready_for_pickup only retries dispatch. It does not advance
  -- the order twice or create duplicate assignments.
  IF o.status = 'ready_for_pickup' THEN
    dispatched := public.broadcast_delivery_request(o.id, 60);
    RETURN jsonb_build_object(
      'status', o.status::text,
      'dispatched', dispatched
    );
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

  UPDATE public.orders
  SET status = next_status
  WHERE id = o.id;

  IF next_status = 'ready_for_pickup' THEN
    dispatched := public.broadcast_delivery_request(o.id, 60);
  END IF;

  RETURN jsonb_build_object(
    'status', next_status::text,
    'dispatched', dispatched
  );
END;
$$;

REVOKE ALL ON FUNCTION public.advance_seller_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.advance_seller_order(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
