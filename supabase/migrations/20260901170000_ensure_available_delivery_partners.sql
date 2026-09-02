-- Migration: 20260901170000_ensure_available_delivery_partners.sql
-- Ensures existing delivery partners are marked as approved & online with fresh timestamps for dispatch availability

-- 1. Ensure all registered delivery partners are marked as approved and online for immediate availability
UPDATE public.delivery_partners
SET 
  status = 'approved',
  availability = 'online',
  is_online = true,
  current_latitude = coalesce(current_latitude, 13.0827),
  current_longitude = coalesce(current_longitude, 80.2707),
  location_updated_at = now(),
  updated_at = now()
WHERE status IS NULL OR status != 'approved' OR availability != 'online' OR is_online IS FALSE;

-- 2. Trigger schema reload
NOTIFY pgrst, 'reload schema';
