-- Keep automatic demo fulfillment opt-in. Production orders must not be
-- customer-advanceable by default.
ALTER TABLE public.orders
  ALTER COLUMN is_demo SET DEFAULT false;

CREATE OR REPLACE FUNCTION public.place_order(
  p_buyer_name text,
  p_buyer_phone text,
  p_buyer_address text,
  p_items jsonb,
  p_payment_method text,
  p_is_demo boolean
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  created_order public.orders;
BEGIN
  -- Reuse the authoritative pricing and stock validation in the existing RPC.
  created_order := public.place_order(
    p_buyer_name,
    p_buyer_phone,
    p_buyer_address,
    p_items,
    p_payment_method
  );

  UPDATE public.orders
  SET is_demo = p_is_demo
  WHERE id = created_order.id
  RETURNING * INTO created_order;

  RETURN created_order;
END;
$$;

REVOKE ALL ON FUNCTION public.place_order(text, text, text, jsonb, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_order(text, text, text, jsonb, text, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';
