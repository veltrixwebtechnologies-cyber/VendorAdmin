-- Phase B5: make the existing delivery_zones table the configurable Service
-- Zone model. No duplicate zone catalog or location seed data is introduced.
BEGIN;

DO $prerequisites$
BEGIN
  IF to_regclass('public.delivery_zones') IS NULL OR to_regclass('public.stores') IS NULL THEN
    RAISE EXCEPTION 'Service Zones require existing delivery_zones and Phase B1 stores';
  END IF;
  IF to_regclass('public.admin_role_permissions') IS NULL
     OR to_regprocedure('public.has_admin_permission(text)') IS NULL THEN
    RAISE EXCEPTION 'Service Zones require Phase A RBAC';
  END IF;
END
$prerequisites$;

-- Add database permissions through the existing canonical permission mapping.
INSERT INTO public.admin_role_permissions (role, permission)
VALUES
  ('SUPER_ADMIN', 'service_zones.view'),
  ('SUPER_ADMIN', 'service_zones.manage'),
  ('OPERATIONS_ADMIN', 'service_zones.view'),
  ('OPERATIONS_ADMIN', 'service_zones.manage'),
  ('SELLER_MANAGER', 'service_zones.view'),
  ('ANALYST', 'service_zones.view')
ON CONFLICT DO NOTHING;

ALTER TABLE public.delivery_zones
  ADD COLUMN IF NOT EXISTS zone_type text NOT NULL DEFAULT 'radius';
DO $zone_type_constraint$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'delivery_zones_zone_type_check') THEN
    ALTER TABLE public.delivery_zones ADD CONSTRAINT delivery_zones_zone_type_check
      CHECK (zone_type = 'radius') NOT VALID;
  END IF;
END
$zone_type_constraint$;

CREATE INDEX IF NOT EXISTS delivery_zones_active_city_idx
  ON public.delivery_zones (city, is_active);
CREATE INDEX IF NOT EXISTS delivery_zones_location_idx
  ON public.delivery_zones (latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.store_service_zones (
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  zone_id uuid NOT NULL REFERENCES public.delivery_zones(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (store_id, zone_id)
);
CREATE INDEX IF NOT EXISTS store_service_zones_zone_idx
  ON public.store_service_zones (zone_id, store_id);

GRANT SELECT, INSERT, UPDATE ON public.delivery_zones TO authenticated;
REVOKE DELETE ON public.delivery_zones FROM authenticated, anon;
ALTER TABLE public.delivery_zones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "delivery zones readable" ON public.delivery_zones;
DROP POLICY IF EXISTS "Service zones public active read" ON public.delivery_zones;
DROP POLICY IF EXISTS "Service zones admin read" ON public.delivery_zones;
DROP POLICY IF EXISTS "Service zones admin create" ON public.delivery_zones;
DROP POLICY IF EXISTS "Service zones admin update" ON public.delivery_zones;
CREATE POLICY "Service zones public active read" ON public.delivery_zones
  FOR SELECT USING (is_active);
CREATE POLICY "Service zones admin read" ON public.delivery_zones
  FOR SELECT TO authenticated USING (public.has_admin_permission('service_zones.view'));
CREATE POLICY "Service zones admin create" ON public.delivery_zones
  FOR INSERT TO authenticated WITH CHECK (public.has_admin_permission('service_zones.manage'));
CREATE POLICY "Service zones admin update" ON public.delivery_zones
  FOR UPDATE TO authenticated
  USING (public.has_admin_permission('service_zones.manage'))
  WITH CHECK (public.has_admin_permission('service_zones.manage'));

ALTER TABLE public.store_service_zones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.store_service_zones FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.store_service_zones TO authenticated;
DROP POLICY IF EXISTS "Service zone admins read store assignments" ON public.store_service_zones;
DROP POLICY IF EXISTS "Service zone admins manage store assignments" ON public.store_service_zones;
CREATE POLICY "Service zone admins read store assignments" ON public.store_service_zones
  FOR SELECT TO authenticated USING (public.has_admin_permission('service_zones.view'));
CREATE POLICY "Service zone admins manage store assignments" ON public.store_service_zones
  FOR ALL TO authenticated
  USING (public.has_admin_permission('service_zones.manage'))
  WITH CHECK (public.has_admin_permission('service_zones.manage'));

CREATE OR REPLACE FUNCTION public.capture_service_zone_admin_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor uuid := auth.uid();
  actor_role text;
  actor_name text;
  actor_email text;
  old_row jsonb := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  new_row jsonb := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  action_name text;
BEGIN
  IF actor IS NULL OR NOT public.has_admin_permission('service_zones.manage') THEN RETURN NULL; END IF;
  IF TG_OP = 'INSERT' THEN action_name := 'SERVICE_ZONE_CREATED';
  ELSIF TG_OP = 'DELETE' THEN action_name := 'SERVICE_ZONE_DELETED';
  ELSIF old_row->>'is_active' IS DISTINCT FROM new_row->>'is_active'
       AND new_row->>'is_active' = 'false' THEN action_name := 'SERVICE_ZONE_DISABLED';
  ELSE action_name := 'SERVICE_ZONE_UPDATED'; END IF;

  SELECT assignment.role INTO actor_role
  FROM public.admin_access_assignments assignment
  WHERE assignment.user_id = actor AND assignment.status = 'active';
  SELECT COALESCE(profile.display_name, account.email), account.email
  INTO actor_name, actor_email
  FROM auth.users account LEFT JOIN public.profiles profile ON profile.id = account.id
  WHERE account.id = actor;

  INSERT INTO public.admin_audit_logs (
    actor_id, actor_name, actor_email, actor_role, action, resource_type,
    resource_id, previous_value, new_value, reason, metadata
  ) VALUES (
    actor, actor_name, actor_email, COALESCE(actor_role, 'SUPER_ADMIN'),
    action_name, 'delivery_zones', COALESCE(new_row->>'id', old_row->>'id'),
    CASE WHEN old_row IS NULL THEN NULL ELSE jsonb_build_object(
      'id', old_row->'id', 'name', old_row->'name', 'city', old_row->'city',
      'latitude', old_row->'latitude', 'longitude', old_row->'longitude',
      'radius_km', old_row->'radius_km', 'is_active', old_row->'is_active',
      'zone_type', old_row->'zone_type'
    ) END,
    CASE WHEN new_row IS NULL THEN NULL ELSE jsonb_build_object(
      'id', new_row->'id', 'name', new_row->'name', 'city', new_row->'city',
      'latitude', new_row->'latitude', 'longitude', new_row->'longitude',
      'radius_km', new_row->'radius_km', 'is_active', new_row->'is_active',
      'zone_type', new_row->'zone_type'
    ) END,
    NULLIF(current_setting('app.admin_audit_reason', true), ''),
    jsonb_build_object('operation', TG_OP)
  );
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.capture_service_zone_admin_audit() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_audit_service_zones ON public.delivery_zones;
CREATE TRIGGER trg_audit_service_zones
  AFTER INSERT OR UPDATE OR DELETE ON public.delivery_zones
  FOR EACH ROW EXECUTE FUNCTION public.capture_service_zone_admin_audit();

CREATE OR REPLACE FUNCTION public.capture_store_service_zone_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor uuid := auth.uid();
  actor_role text;
  actor_name text;
  actor_email text;
  store_key uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.store_id ELSE NEW.store_id END;
  zone_key uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.zone_id ELSE NEW.zone_id END;
BEGIN
  IF actor IS NULL OR NOT public.has_admin_permission('service_zones.manage') THEN
    RETURN NULL;
  END IF;

  SELECT assignment.role INTO actor_role
  FROM public.admin_access_assignments assignment
  WHERE assignment.user_id = actor AND assignment.status = 'active';
  SELECT COALESCE(profile.display_name, account.email), account.email
  INTO actor_name, actor_email
  FROM auth.users account LEFT JOIN public.profiles profile ON profile.id = account.id
  WHERE account.id = actor;

  INSERT INTO public.admin_audit_logs (
    actor_id, actor_name, actor_email, actor_role, action, resource_type,
    resource_id, previous_value, new_value, reason, metadata
  ) VALUES (
    actor, actor_name, actor_email, COALESCE(actor_role, 'SUPER_ADMIN'), 'SERVICE_ZONE_CHANGED',
    'store_service_zones', store_key::text,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE jsonb_build_object('store_id', OLD.store_id, 'zone_id', OLD.zone_id) END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE jsonb_build_object('store_id', NEW.store_id, 'zone_id', NEW.zone_id) END,
    NULLIF(current_setting('app.admin_audit_reason', true), ''),
    jsonb_build_object('zone_id', zone_key, 'operation', TG_OP)
  );
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.capture_store_service_zone_audit() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_audit_store_service_zone_assignments ON public.store_service_zones;
CREATE TRIGGER trg_audit_store_service_zone_assignments
  AFTER INSERT OR DELETE ON public.store_service_zones
  FOR EACH ROW EXECUTE FUNCTION public.capture_store_service_zone_audit();

NOTIFY pgrst, 'reload schema';
COMMIT;
