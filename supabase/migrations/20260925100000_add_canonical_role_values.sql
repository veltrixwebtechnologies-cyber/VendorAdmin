-- LocalShore canonical role values.
-- `vendor` remains in the enum for backwards compatibility with older policies
-- and clients, but new code uses `seller`.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'customer';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'delivery_partner';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'seller';
