-- Keep delivery state in sync when a customer or seller cancels an order.
-- Otherwise a cancelled order can leave its partner permanently marked busy.
CREATE OR REPLACE FUNCTION public.release_cancelled_delivery_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status::text = 'cancelled' AND OLD.status::text <> 'cancelled' THEN
    UPDATE public.delivery_assignments
    SET status = 'cancelled', updated_at = now()
    WHERE order_id = NEW.id
      AND status IN ('pending', 'requested', 'accepted', 'navigating_to_vendor',
                     'reached_vendor', 'picked_up', 'out_for_delivery');

    UPDATE public.delivery_partners p
    SET availability = 'online', updated_at = now()
    WHERE p.id = NEW.assigned_partner_id
      AND p.availability = 'busy'
      AND NOT EXISTS (
        SELECT 1
        FROM public.delivery_assignments a
        WHERE a.partner_id = p.id
          AND a.status IN ('accepted', 'navigating_to_vendor', 'reached_vendor',
                           'picked_up', 'out_for_delivery')
      );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_release_cancelled_delivery ON public.orders;
CREATE TRIGGER trg_release_cancelled_delivery
AFTER UPDATE OF status ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.release_cancelled_delivery_assignment();

-- Repair already-cancelled orders created before this trigger existed.
UPDATE public.delivery_assignments a
SET status = 'cancelled', updated_at = now()
FROM public.orders o
WHERE o.id = a.order_id
  AND o.status::text = 'cancelled'
  AND a.status IN ('pending', 'requested', 'accepted', 'navigating_to_vendor',
                   'reached_vendor', 'picked_up', 'out_for_delivery');

UPDATE public.delivery_partners p
SET availability = 'online', updated_at = now()
WHERE p.availability = 'busy'
  AND NOT EXISTS (
    SELECT 1
    FROM public.delivery_assignments a
    WHERE a.partner_id = p.id
      AND a.status IN ('accepted', 'navigating_to_vendor', 'reached_vendor',
                       'picked_up', 'out_for_delivery')
  );

NOTIFY pgrst, 'reload schema';
