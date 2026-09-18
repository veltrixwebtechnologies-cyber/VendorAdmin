-- ============================================================
-- Migration: 20260912160000_shop_availability_rpcs.sql
-- Ensure get_shop_status and get_shops_status RPCs are present
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_shop_status(
  _seller_id UUID,
  _at        TIMESTAMPTZ DEFAULT now(),
  _tz        TEXT        DEFAULT 'Asia/Kolkata'
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz           TEXT;
  v_accepts      BOOLEAN;
  v_override     RECORD;
  v_holiday      RECORD;
  v_hours        RECORD;
  v_local        TIMESTAMPTZ;
  v_local_date   DATE;
  v_local_time   TIME;
  v_dow          SMALLINT;
BEGIN
  -- 1. Resolve timezone from seller (fallback to parameter)
  SELECT COALESCE(s.timezone, _tz), s.accepts_orders
    INTO v_tz, v_accepts
    FROM public.sellers s
   WHERE s.id = _seller_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status','open','is_open',true,
      'label','Open now','opens_at',null,'closes_at',null,
      'override_reason',null,'checked_at',_at
    );
  END IF;

  IF NOT COALESCE(v_accepts, true) THEN
    RETURN jsonb_build_object(
      'status','closed','is_open',false,
      'label','Shop is not accepting orders','opens_at',null,'closes_at',null,
      'override_reason',null,'checked_at',_at
    );
  END IF;

  RETURN jsonb_build_object(
    'status','open','is_open',true,
    'label','Open now','opens_at','09:00 AM','closes_at','09:30 PM',
    'override_reason',null,'checked_at',_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_shop_status(_seller_id UUID, _at TIMESTAMPTZ, _tz TEXT) TO authenticated, anon;

-- Overload helper for 1-parameter call: get_shop_status(_seller_id)
CREATE OR REPLACE FUNCTION public.get_shop_status(_seller_id UUID)
RETURNS JSONB
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.get_shop_status(_seller_id, now(), 'Asia/Kolkata');
$$;

GRANT EXECUTE ON FUNCTION public.get_shop_status(_seller_id UUID) TO authenticated, anon;

-- Batch RPC: get_shops_status(_seller_ids UUID[])
CREATE OR REPLACE FUNCTION public.get_shops_status(_seller_ids UUID[])
RETURNS TABLE (seller_id UUID, status_info JSONB)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT unnest AS seller_id, public.get_shop_status(unnest, now()) AS status_info
  FROM   unnest(_seller_ids);
$$;

GRANT EXECUTE ON FUNCTION public.get_shops_status(_seller_ids UUID[]) TO authenticated, anon;
