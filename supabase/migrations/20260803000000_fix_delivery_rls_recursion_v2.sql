-- Remove remaining orders <-> delivery policy recursion.
-- This migration only changes policy predicates and helper functions. It does
-- not alter data or the canonical orders/delivery schema.

CREATE OR REPLACE FUNCTION public.delivery_partner_can_access_order(_order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.delivery_assignments a
    JOIN public.delivery_partners p ON p.id = a.partner_id
    WHERE a.order_id = _order_id
      AND p.user_id = auth.uid()
      AND a.status::text IN (
        'pending', 'requested', 'assigned', 'accepted',
        'navigating_to_vendor', 'reached_vendor', 'picked_up',
        'out_for_delivery', 'delivered'
      )
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
    WHERE a.id = _assignment_id
      AND (
        p.user_id = auth.uid()
        OR public.has_role(auth.uid(), 'admin'::public.app_role)
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.delivery_partner_can_access_seller(_seller_id uuid)
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
    WHERE o.seller_id = _seller_id
      AND p.user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.delivery_partner_can_access_order(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delivery_assignment_visible_to_user(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delivery_partner_can_access_seller(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delivery_partner_can_access_order(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delivery_assignment_visible_to_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delivery_partner_can_access_seller(uuid) TO authenticated;

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
USING (public.delivery_partner_can_access_order(id));

DROP POLICY IF EXISTS "Delivery partners update assigned orders" ON public.orders;
CREATE POLICY "Delivery partners update assigned orders"
ON public.orders
FOR UPDATE TO authenticated
USING (public.delivery_partner_can_access_order(id))
WITH CHECK (public.delivery_partner_can_access_order(id));

DROP POLICY IF EXISTS "Delivery partners read assigned sellers" ON public.sellers;
CREATE POLICY "Delivery partners read assigned sellers"
ON public.sellers
FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.delivery_partner_can_access_seller(id)
);

DROP POLICY IF EXISTS "Delivery partners read assigned order items" ON public.order_items;
CREATE POLICY "Delivery partners read assigned order items"
ON public.order_items
FOR SELECT TO authenticated
USING (public.delivery_partner_can_access_order(order_id));
