-- Run this query first and wait for it to complete before running
-- 20260801090000_delivery_partner_shared_integration.sql.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'delivery_partner';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'assigned';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'picked_up';
