-- Keep the order-status notification trigger compatible with the current
-- notifications schema, where audience is required and event_key is used for
-- duplicate-event protection. This is a forward-only repair; do not edit the
-- historical trigger migration.
CREATE OR REPLACE FUNCTION public.notify_customer_order_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  status_body text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  status_body := CASE NEW.status::text
    WHEN 'accepted' THEN 'Your order has been accepted.'
    WHEN 'vendor_accepted' THEN 'Your order has been accepted and is being prepared.'
    WHEN 'packed' THEN 'Your order has been packed.'
    WHEN 'ready_for_pickup' THEN 'Your order is ready for pickup.'
    WHEN 'out_for_delivery' THEN 'Your order is out for delivery.'
    WHEN 'shipped' THEN 'Your order is out for delivery.'
    WHEN 'delivered' THEN 'Your order has been delivered.'
    WHEN 'cancelled' THEN 'Your order has been cancelled.'
    WHEN 'cancelled_by_vendor' THEN 'The seller cancelled your order.'
    WHEN 'returned' THEN 'Your order has been returned.'
    ELSE 'Your order status is now ' || replace(NEW.status::text, '_', ' ') || '.'
  END;

  INSERT INTO public.notifications (
    user_id, title, body, kind, link, audience, event_key
  )
  VALUES (
    NEW.user_id,
    'Order ' || NEW.order_number || ' updated',
    status_body,
    'order',
    '/order/' || NEW.id::text,
    'all_users',
    'order_status:' || NEW.id::text || ':' || NEW.status::text
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
