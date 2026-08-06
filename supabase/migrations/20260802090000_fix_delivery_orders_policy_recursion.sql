-- Break the orders <-> delivery_assignments RLS recursion.
--
-- The original policies queried delivery_assignments from orders and orders
-- from delivery_assignments. PostgreSQL evaluates both policies recursively
-- and rejects otherwise valid partner reads. These narrowly-scoped helpers
-- perform the relationship checks with the function owner privileges and are
-- still restricted by auth.uid() inside the function.

CREATE OR REPLACE FUNCTION public.delivery_partner_can_access_order(_order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.orders o
    JOIN public.delivery_assignments a ON a.order_id = o.id
    JOIN public.delivery_partners p ON p.id = a.partner_id
    WHERE o.id = _order_id
      AND p.user_id = auth.uid()
      AND a.status::text IN (
        'pending', 'requested', 'assigned', 'accepted',
        'navigating_to_vendor', 'reached_vendor', 'picked_up',
        'out_for_delivery', 'delivered'
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.delivery_partner_can_read_unassigned_order(_order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.orders o
    JOIN public.delivery_partners p ON p.user_id = auth.uid()
    WHERE o.id = _order_id
      AND o.status::text = 'ready_for_pickup'
      AND o.assigned_partner_id IS NULL
      AND p.status::text = 'approved'
      AND p.availability::text = 'online'
  );
$$;

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
    LEFT JOIN public.orders o ON o.id = a.order_id
    WHERE a.id = _assignment_id
      AND (
        p.user_id = auth.uid()
        OR o.user_id = auth.uid()
        OR public.has_role(auth.uid(), 'admin'::public.app_role)
      )
  );
$$;

REVOKE ALL ON FUNCTION public.delivery_partner_can_access_order(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delivery_partner_can_read_unassigned_order(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delivery_assignment_visible_to_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delivery_partner_can_access_order(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delivery_partner_can_read_unassigned_order(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delivery_assignment_visible_to_user(uuid) TO authenticated;

DROP POLICY IF EXISTS "assignment access" ON public.delivery_assignments;
CREATE POLICY "assignment access"
ON public.delivery_assignments
FOR ALL TO authenticated
USING (public.delivery_assignment_visible_to_user(id))
WITH CHECK (
  public.is_my_partner(partner_id)
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
);

DROP POLICY IF EXISTS "Delivery partners read assigned orders" ON public.orders;
CREATE POLICY "Delivery partners read assigned orders"
ON public.orders
FOR SELECT TO authenticated
USING (
  public.delivery_partner_can_access_order(id)
  OR public.delivery_partner_can_read_unassigned_order(id)
);

DROP POLICY IF EXISTS "Delivery partners update assigned orders" ON public.orders;
CREATE POLICY "Delivery partners update assigned orders"
ON public.orders
FOR UPDATE TO authenticated
USING (public.delivery_partner_can_access_order(id))
WITH CHECK (public.delivery_partner_can_access_order(id));

DROP POLICY IF EXISTS "Delivery partners read assigned order items" ON public.order_items;
CREATE POLICY "Delivery partners read assigned order items"
ON public.order_items
FOR SELECT TO authenticated
USING (public.delivery_partner_can_access_order(order_id));

