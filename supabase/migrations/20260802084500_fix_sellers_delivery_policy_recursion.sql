-- Fix RLS recursion caused by the delivery partner seller-read policy.
-- The old policy queried public.orders directly from a public.sellers policy.
-- Existing order policies also inspect public.sellers for vendor ownership, which
-- can make Postgres re-enter sellers RLS and fail with:
--   infinite recursion detected in policy for relation "sellers"

CREATE OR REPLACE FUNCTION public.delivery_partner_can_read_seller(_seller_id uuid)
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
      AND a.status::text IN (
        'assigned',
        'pending',
        'accepted',
        'navigating_to_vendor',
        'reached_vendor',
        'picked_up',
        'out_for_delivery',
        'delivered'
      )
  );
$$;

REVOKE ALL ON FUNCTION public.delivery_partner_can_read_seller(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delivery_partner_can_read_seller(uuid) TO authenticated;

DROP POLICY IF EXISTS "Delivery partners read assigned sellers" ON public.sellers;
CREATE POLICY "Delivery partners read assigned sellers"
ON public.sellers
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.delivery_partner_can_read_seller(id)
);
