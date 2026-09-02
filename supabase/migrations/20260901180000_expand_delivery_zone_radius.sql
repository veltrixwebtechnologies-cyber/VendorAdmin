-- Migration: 20260901180000_expand_delivery_zone_radius.sql
-- Expands delivery zone radius and provides helper RPC to sync partner zone to current location

-- 0. Ensure delivery_zones has updated_at column if referenced
ALTER TABLE public.delivery_zones ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- 1. Expand all delivery zones to at least 30 km radius to prevent out-of-zone blocks
UPDATE public.delivery_zones
SET radius_km = 30.0, updated_at = now()
WHERE radius_km < 30.0 OR radius_km IS NULL;

-- 2. Create function allowing partners to sync their assigned zone coordinates to their live location
CREATE OR REPLACE FUNCTION public.sync_partner_zone_to_current_location(
  _partner_id uuid,
  _lat double precision,
  _lng double precision
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target_zone_id uuid;
BEGIN
  -- Get assigned zone ID for partner
  SELECT zone_id INTO target_zone_id
  FROM public.delivery_partner_zones
  WHERE partner_id = _partner_id
  LIMIT 1;

  IF target_zone_id IS NOT NULL THEN
    UPDATE public.delivery_zones
    SET latitude = _lat,
        longitude = _lng,
        radius_km = GREATEST(radius_km, 30.0),
        updated_at = now()
    WHERE id = target_zone_id;
  END IF;

  -- Also update partner's current position and freshness
  UPDATE public.delivery_partners
  SET current_latitude = _lat,
      current_longitude = _lng,
      location_updated_at = now(),
      updated_at = now()
  WHERE id = _partner_id;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_partner_zone_to_current_location TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
