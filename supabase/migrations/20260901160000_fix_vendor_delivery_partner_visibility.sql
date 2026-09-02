-- Migration: 20260901160000_fix_vendor_delivery_partner_visibility.sql
-- Fixes RLS policies to allow Vendors (sellers) and Customers to view delivery assignments and assigned delivery partners

-- 1. Helper function to check if a user is the seller or customer of an order
CREATE OR REPLACE FUNCTION public.user_can_access_order_delivery(_order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.id = _order_id
      AND (
        o.user_id = auth.uid()
        OR o.seller_id IN (
          SELECT s.id FROM public.sellers s WHERE s.user_id = auth.uid()
        )
        OR public.has_role(auth.uid(), 'admin'::public.app_role)
      )
  );
$$;

REVOKE ALL ON FUNCTION public.user_can_access_order_delivery(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_can_access_order_delivery(uuid) TO authenticated;

-- 2. Update delivery_assignment_visible_to_user to include sellers and customers
CREATE OR REPLACE FUNCTION public.delivery_assignment_visible_to_user(_assignment_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.delivery_assignments a
    LEFT JOIN public.delivery_partners p ON p.id = a.partner_id
    WHERE a.id = _assignment_id
      AND (
        p.user_id = auth.uid()
        OR public.has_role(auth.uid(), 'admin'::public.app_role)
        OR public.user_can_access_order_delivery(a.order_id)
      )
  );
$$;

REVOKE ALL ON FUNCTION public.delivery_assignment_visible_to_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delivery_assignment_visible_to_user(uuid) TO authenticated;

-- 3. Update delivery_partners RLS select policy so sellers and buyers can view assigned partner profiles
DROP POLICY IF EXISTS "partner reads own record" ON public.delivery_partners;
CREATE POLICY "partner reads own record" ON public.delivery_partners FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.assigned_partner_id = delivery_partners.id
        AND public.user_can_access_order_delivery(o.id)
    )
    OR EXISTS (
      SELECT 1 FROM public.delivery_assignments a
      WHERE a.partner_id = delivery_partners.id
        AND public.user_can_access_order_delivery(a.order_id)
    )
  );

-- 4. Update assignment access RLS policy
DROP POLICY IF EXISTS "assignment access" ON public.delivery_assignments;
CREATE POLICY "assignment access"
ON public.delivery_assignments
FOR ALL TO authenticated
USING (public.delivery_assignment_visible_to_user(id))
WITH CHECK (
  public.is_my_partner(partner_id)
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
);

-- 5. Enhanced advance_seller_order RPC to ensure dispatch triggers internal fallback if broadcast count is 0
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
  assign_id uuid;
BEGIN
  SELECT * INTO o
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

  IF o.status = 'ready_for_pickup' THEN
    dispatched := public.broadcast_delivery_request(o.id, 60);
    IF dispatched = 0 THEN
      assign_id := public.dispatch_delivery_for_order_internal(o.id, 60);
      IF assign_id IS NOT NULL THEN
        dispatched := 1;
      END IF;
    END IF;
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

  IF next_status IN ('accepted', 'ready_for_pickup') THEN
    dispatched := public.broadcast_delivery_request(o.id, 60);
    IF dispatched = 0 THEN
      assign_id := public.dispatch_delivery_for_order_internal(o.id, 60);
      IF assign_id IS NOT NULL THEN
        dispatched := 1;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('status', next_status::text, 'dispatched', dispatched);
END;
$$;

GRANT EXECUTE ON FUNCTION public.advance_seller_order(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
