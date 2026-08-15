-- Compatibility overload for older deployed customer bundles that still send
-- p_is_demo. The flag is deliberately ignored; payment/demo state is never
-- trusted from the browser. The canonical 7-argument function remains the
-- source of all order calculations and status assignment.

CREATE OR REPLACE FUNCTION public.place_order_once(
  p_request_id uuid,
  p_buyer_name text,
  p_buyer_phone text,
  p_buyer_address text,
  p_items jsonb,
  p_payment_method text,
  p_is_demo boolean,
  p_coupon_code text DEFAULT NULL
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public.place_order_once(
    p_request_id,
    p_buyer_name,
    p_buyer_phone,
    p_buyer_address,
    p_items,
    p_payment_method,
    p_coupon_code
  );
END;
$$;

REVOKE ALL ON FUNCTION public.place_order_once(uuid, text, text, text, jsonb, text, boolean, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_order_once(uuid, text, text, text, jsonb, text, boolean, text)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
