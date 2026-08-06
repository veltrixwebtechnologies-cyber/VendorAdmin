-- Pending requests are invalid once an order already has a partner.
-- This removes stale rows that otherwise keep reopening in the partner UI.
CREATE OR REPLACE FUNCTION public.expire_requests_after_order_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.assigned_partner_id IS NOT NULL
     AND (OLD.assigned_partner_id IS DISTINCT FROM NEW.assigned_partner_id) THEN
    UPDATE public.delivery_assignments
    SET status = 'expired', updated_at = now()
    WHERE order_id = NEW.id
      AND status IN ('pending', 'requested')
      AND partner_id <> NEW.assigned_partner_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_expire_requests_after_order_assignment ON public.orders;
CREATE TRIGGER trg_expire_requests_after_order_assignment
AFTER UPDATE OF assigned_partner_id ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.expire_requests_after_order_assignment();

UPDATE public.delivery_assignments a
SET status = 'expired', updated_at = now()
FROM public.orders o
WHERE o.id = a.order_id
  AND o.assigned_partner_id IS NOT NULL
  AND a.partner_id <> o.assigned_partner_id
  AND a.status IN ('pending', 'requested');

NOTIFY pgrst, 'reload schema';
