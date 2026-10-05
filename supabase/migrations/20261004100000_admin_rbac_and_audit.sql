-- Admin RBAC and append-only audit foundation.
-- Existing active user_roles.admin identities are preserved as SUPER_ADMIN.

BEGIN;

CREATE TABLE IF NOT EXISTS public.admin_role_permissions (
  role text NOT NULL CHECK (role IN (
    'SUPER_ADMIN', 'OPERATIONS_ADMIN', 'SELLER_MANAGER', 'CATALOG_MANAGER',
    'FINANCE_ADMIN', 'SUPPORT_AGENT', 'MARKETING_ADMIN', 'ANALYST'
  )),
  permission text NOT NULL,
  PRIMARY KEY (role, permission)
);

INSERT INTO public.admin_role_permissions (role, permission)
SELECT 'SUPER_ADMIN', permission
FROM unnest(ARRAY[
  'dashboard.view', 'orders.view', 'orders.manage', 'sellers.view', 'sellers.approve',
  'sellers.suspend', 'sellers.manage', 'stores.view', 'stores.manage', 'products.view',
  'products.moderate', 'products.manage', 'categories.view', 'categories.manage',
  'inventory.view', 'inventory.manage', 'customers.view', 'customers.manage',
  'payments.view', 'refunds.view', 'refunds.manage', 'payouts.view', 'payouts.manage',
  'commissions.view', 'commissions.manage', 'reviews.view', 'reviews.moderate',
  'support.view', 'support.manage', 'promotions.view', 'promotions.manage',
  'dispatch.view', 'dispatch.manage', 'notifications.view', 'notifications.manage',
  'analytics.view', 'reports.view', 'settings.view', 'settings.manage', 'admins.view',
  'admins.manage', 'audit.view', 'integrations.view', 'integrations.manage',
  'platform_health.view'
]) AS permission
ON CONFLICT DO NOTHING;

INSERT INTO public.admin_role_permissions (role, permission)
SELECT role, permission
FROM (VALUES
  ('OPERATIONS_ADMIN', ARRAY['dashboard.view','orders.view','orders.manage','sellers.view','stores.view','inventory.view','dispatch.view','dispatch.manage','support.view','analytics.view']),
  ('SELLER_MANAGER', ARRAY['dashboard.view','sellers.view','sellers.approve','sellers.suspend','stores.view','stores.manage','products.view','orders.view']),
  ('CATALOG_MANAGER', ARRAY['dashboard.view','products.view','products.moderate','products.manage','categories.view','categories.manage','inventory.view','inventory.manage']),
  ('FINANCE_ADMIN', ARRAY['dashboard.view','orders.view','payments.view','refunds.view','refunds.manage','payouts.view','payouts.manage','commissions.view','commissions.manage','reports.view']),
  ('SUPPORT_AGENT', ARRAY['dashboard.view','orders.view','customers.view','reviews.view','support.view','support.manage']),
  ('MARKETING_ADMIN', ARRAY['dashboard.view','promotions.view','promotions.manage','notifications.view','notifications.manage','analytics.view']),
  ('ANALYST', ARRAY['dashboard.view','analytics.view','reports.view','orders.view','stores.view','products.view','categories.view','inventory.view','payments.view','payouts.view','reviews.view'])
) AS role_grants(role, permissions),
LATERAL unnest(role_grants.permissions) AS permission_rows(permission)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.admin_access_assignments (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN (
    'SUPER_ADMIN', 'OPERATIONS_ADMIN', 'SELLER_MANAGER', 'CATALOG_MANAGER',
    'FINANCE_ADMIN', 'SUPPORT_AGENT', 'MARKETING_ADMIN', 'ANALYST'
  )),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_access_role_status_idx
  ON public.admin_access_assignments (role, status);

ALTER TABLE public.admin_role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_access_assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_role_permissions FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.admin_access_assignments FROM anon, authenticated;
GRANT SELECT ON public.admin_access_assignments TO authenticated;

CREATE OR REPLACE FUNCTION public.has_admin_permission(p_permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    WHEN EXISTS (
      SELECT 1 FROM public.admin_access_assignments assignment
      WHERE assignment.user_id = auth.uid()
    ) THEN EXISTS (
      SELECT 1
      FROM public.admin_access_assignments assignment
      JOIN public.admin_role_permissions grant_row USING (role)
      WHERE assignment.user_id = auth.uid()
        AND assignment.status = 'active'
        AND grant_row.permission = p_permission
    )
    ELSE p_permission IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.user_roles legacy
      WHERE legacy.user_id = auth.uid()
        AND legacy.role = 'admin'::public.app_role
        AND legacy.status = 'active'
    ) AND EXISTS (
      SELECT 1 FROM public.admin_role_permissions grant_row
      WHERE grant_row.role = 'SUPER_ADMIN' AND grant_row.permission = p_permission
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.has_admin_permission(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_admin_permission(text) TO authenticated;

CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_name text,
  actor_email text,
  actor_role text NOT NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  previous_value jsonb,
  new_value jsonb,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_audit_logs_created_idx
  ON public.admin_audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_logs_actor_idx
  ON public.admin_audit_logs (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_logs_action_idx
  ON public.admin_audit_logs (action, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_logs_resource_idx
  ON public.admin_audit_logs (resource_type, resource_id);

ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_audit_logs FROM anon, authenticated;
GRANT SELECT ON public.admin_audit_logs TO authenticated;
CREATE POLICY "Admins with audit permission can read audit logs"
  ON public.admin_audit_logs FOR SELECT TO authenticated
  USING (public.has_admin_permission('audit.view'));

CREATE OR REPLACE FUNCTION public.admin_access_snapshot(p_row jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE safe_row jsonb;
BEGIN
  safe_row := jsonb_build_object(
    'user_id', p_row->'user_id', 'role', p_row->'role', 'status', p_row->'status'
  );
  RETURN safe_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_audit_snapshot(p_table text, p_row jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  CASE p_table
    WHEN 'sellers' THEN
      RETURN p_row - ARRAY[
        'bank_account_name','bank_account_number','bank_ifsc','bank_name',
        'gstin','pan','phone','email','full_name','wizard_data','admin_notes'
      ];
    WHEN 'products' THEN
      RETURN p_row - ARRAY['description','images'];
    WHEN 'orders' THEN
      RETURN jsonb_build_object(
        'id', p_row->'id', 'order_number', p_row->'order_number',
        'status', p_row->'status', 'payment_status', p_row->'payment_status'
      );
    WHEN 'user_status' THEN
      RETURN jsonb_build_object(
        'user_id', p_row->'user_id', 'is_blocked', p_row->'is_blocked'
      );
    WHEN 'platform_settings' THEN
      RETURN jsonb_build_object(
        'id', p_row->'id', 'marketplace_name', p_row->'marketplace_name',
        'commission_percent', p_row->'commission_percent',
        'shipping_flat', p_row->'shipping_flat', 'tax_percent', p_row->'tax_percent',
        'payment_gateway', p_row->'payment_gateway'
      );
    WHEN 'support_tickets' THEN
      RETURN jsonb_build_object('id', p_row->'id', 'status', p_row->'status',
        'support_stage', p_row->'support_stage', 'resolution_type', p_row->'resolution_type');
    WHEN 'delivery_assignments' THEN
      RETURN jsonb_build_object('id', p_row->'id', 'status', p_row->'status',
        'order_id', p_row->'order_id', 'partner_id', p_row->'partner_id');
    WHEN 'delivery_exceptions' THEN
      RETURN jsonb_build_object('id', p_row->'id', 'resolution_status', p_row->'resolution_status');
    ELSE
      RETURN jsonb_build_object('id', p_row->'id');
  END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION public.capture_admin_audit_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor uuid := auth.uid();
  actor_role text;
  action_name text;
  permission_name text;
  resource_key text;
  actor_name_value text;
  actor_email_value text;
  actor_was_authorized boolean := false;
  old_safe jsonb;
  new_safe jsonb;
  row_old jsonb;
  row_new jsonb;
  audit_reason text := NULLIF(current_setting('app.admin_audit_reason', true), '');
BEGIN
  row_old := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  row_new := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;

  IF TG_TABLE_NAME = 'admin_access_assignments' THEN
    permission_name := 'admins.manage';
    resource_key := COALESCE(row_new->>'user_id', row_old->>'user_id');
    IF TG_OP = 'INSERT' THEN
      action_name := 'ADMIN_CREATED';
    ELSIF TG_OP = 'DELETE' THEN
      action_name := 'ADMIN_DELETED';
    ELSIF row_old->>'role' IS DISTINCT FROM row_new->>'role' THEN
      action_name := 'ADMIN_ROLE_CHANGED';
    ELSIF row_old->>'status' IS DISTINCT FROM row_new->>'status' AND row_new->>'status' = 'active' THEN
      action_name := 'ADMIN_ACTIVATED';
    ELSIF row_old->>'status' IS DISTINCT FROM row_new->>'status' AND row_new->>'status' = 'suspended' THEN
      action_name := 'ADMIN_DEACTIVATED';
    ELSE
      action_name := 'ADMIN_STATUS_CHANGED';
    END IF;
    old_safe := CASE WHEN row_old IS NULL THEN NULL ELSE public.admin_access_snapshot(row_old) END;
    new_safe := CASE WHEN row_new IS NULL THEN NULL ELSE public.admin_access_snapshot(row_new) END;
  ELSE
    resource_key := COALESCE(row_new->>'id', row_old->>'id');
    CASE TG_TABLE_NAME
      WHEN 'sellers' THEN
        IF row_old IS NOT NULL AND row_old->>'status' IS DISTINCT FROM row_new->>'status' THEN
          action_name := CASE row_new->>'status'
            WHEN 'approved' THEN 'SELLER_APPROVED'
            WHEN 'rejected' THEN 'SELLER_REJECTED'
            WHEN 'suspended' THEN 'SELLER_SUSPENDED'
            WHEN 'active' THEN 'SELLER_UNSUSPENDED'
            ELSE 'SELLER_STATUS_CHANGED' END;
          permission_name := CASE row_new->>'status'
            WHEN 'approved' THEN 'sellers.approve'
            WHEN 'rejected' THEN 'sellers.approve'
            WHEN 'active' THEN 'sellers.suspend'
            ELSE 'sellers.suspend' END;
        ELSE
          action_name := 'STORE_UPDATED';
          permission_name := 'stores.manage';
        END IF;
      WHEN 'products' THEN
        permission_name := 'products.moderate';
        action_name := CASE
          WHEN row_old IS NOT NULL AND row_old->>'status' IS DISTINCT FROM row_new->>'status'
            AND row_new->>'status' IN ('active','approved') THEN 'PRODUCT_APPROVED'
          WHEN row_old IS NOT NULL AND row_old->>'status' IS DISTINCT FROM row_new->>'status'
            AND row_new->>'status' = 'rejected' THEN 'PRODUCT_REJECTED'
          WHEN row_old IS NOT NULL AND row_old->>'status' IS DISTINCT FROM row_new->>'status'
            AND row_new->>'status' = 'inactive' THEN 'PRODUCT_UNPUBLISHED'
          ELSE 'PRODUCT_UPDATED' END;
      WHEN 'orders' THEN
        permission_name := 'orders.manage';
        action_name := 'ORDER_STATUS_CHANGED';
      WHEN 'user_status' THEN
        permission_name := 'customers.manage';
        action_name := CASE WHEN row_new->>'is_blocked' = 'true'
          THEN 'CUSTOMER_BLOCKED' ELSE 'CUSTOMER_UNBLOCKED' END;
        resource_key := row_new->>'user_id';
      WHEN 'platform_settings' THEN
        permission_name := CASE
          WHEN row_old IS NOT NULL AND row_old->>'commission_percent' IS DISTINCT FROM row_new->>'commission_percent'
            THEN 'commissions.manage'
          ELSE 'settings.manage' END;
        action_name := CASE WHEN permission_name = 'commissions.manage'
          THEN 'COMMISSION_CHANGED' ELSE 'SETTING_CHANGED' END;
      WHEN 'settlements' THEN
        permission_name := 'payouts.manage';
        action_name := 'PAYOUT_STATUS_CHANGED';
      WHEN 'support_tickets' THEN
        permission_name := 'support.manage';
        action_name := 'SUPPORT_CASE_UPDATED';
      WHEN 'delivery_assignments' THEN
        permission_name := 'dispatch.manage';
        action_name := 'DISPATCH_ASSIGNMENT_UPDATED';
      WHEN 'delivery_exceptions' THEN
        permission_name := 'dispatch.manage';
        action_name := 'DISPATCH_EXCEPTION_UPDATED';
      ELSE
        RETURN NULL;
    END CASE;

    IF actor IS NULL OR NOT public.has_admin_permission(permission_name) THEN
      RETURN NULL;
    END IF;

    old_safe := CASE WHEN row_old IS NULL THEN NULL ELSE public.admin_audit_snapshot(TG_TABLE_NAME, row_old) END;
    new_safe := CASE WHEN row_new IS NULL THEN NULL ELSE public.admin_audit_snapshot(TG_TABLE_NAME, row_new) END;
    IF audit_reason IS NULL THEN
      audit_reason := NULLIF(row_new->>'rejection_reason', '');
    END IF;
    IF audit_reason IS NULL THEN
      audit_reason := NULLIF(row_new->>'admin_notes', '');
    END IF;
  END IF;

  IF actor IS NOT NULL
    AND TG_TABLE_NAME = 'admin_access_assignments'
    AND actor::text = COALESCE(row_old->>'user_id', '')
    AND row_old->>'status' = 'active' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.admin_role_permissions grant_row
      WHERE grant_row.role = row_old->>'role'
        AND grant_row.permission = permission_name
    ) INTO actor_was_authorized;
  ELSE
    actor_was_authorized := actor IS NOT NULL AND public.has_admin_permission(permission_name);
  END IF;

  IF NOT actor_was_authorized THEN
    RETURN NULL;
  END IF;

  IF TG_TABLE_NAME = 'admin_access_assignments' AND actor::text = COALESCE(row_old->>'user_id', '') THEN
    actor_role := row_old->>'role';
  ELSE
    SELECT assignment.role INTO actor_role
    FROM public.admin_access_assignments assignment
    WHERE assignment.user_id = actor AND assignment.status = 'active';
  END IF;
  IF actor_role IS NULL THEN
    actor_role := 'SUPER_ADMIN';
  END IF;

  SELECT COALESCE(profile.display_name, account.email), account.email
  INTO actor_name_value, actor_email_value
  FROM auth.users account
  LEFT JOIN public.profiles profile ON profile.id = account.id
  WHERE account.id = actor;

  INSERT INTO public.admin_audit_logs (
    actor_id, actor_name, actor_email, actor_role, action, resource_type, resource_id,
    previous_value, new_value, reason, metadata
  ) VALUES (
    actor, actor_name_value, actor_email_value, actor_role, action_name, TG_TABLE_NAME, resource_key,
    old_safe, new_safe, audit_reason,
    jsonb_build_object('operation', TG_OP)
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_admin_access ON public.admin_access_assignments;
CREATE TRIGGER trg_audit_admin_access
AFTER INSERT OR UPDATE OR DELETE ON public.admin_access_assignments
FOR EACH ROW EXECUTE FUNCTION public.capture_admin_audit_log();

CREATE OR REPLACE FUNCTION public.prevent_last_active_super_admin_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE remaining_super_admins integer;
BEGIN
  IF OLD.role = 'SUPER_ADMIN' AND OLD.status = 'active' THEN
    PERFORM pg_advisory_xact_lock(721401, 1);
    SELECT count(*) INTO remaining_super_admins
    FROM public.admin_access_assignments
    WHERE role = 'SUPER_ADMIN' AND status = 'active' AND user_id <> OLD.user_id;
    IF remaining_super_admins = 0 THEN
      RAISE EXCEPTION 'Cannot delete the last active SUPER_ADMIN assignment' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.prevent_last_active_super_admin_delete() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_protect_last_super_admin_delete ON public.admin_access_assignments;
CREATE TRIGGER trg_protect_last_super_admin_delete
BEFORE DELETE ON public.admin_access_assignments
FOR EACH ROW EXECUTE FUNCTION public.prevent_last_active_super_admin_delete();

DROP TRIGGER IF EXISTS trg_audit_admin_sellers ON public.sellers;
CREATE TRIGGER trg_audit_admin_sellers
AFTER UPDATE ON public.sellers
FOR EACH ROW EXECUTE FUNCTION public.capture_admin_audit_log();

DROP TRIGGER IF EXISTS trg_audit_admin_products ON public.products;
CREATE TRIGGER trg_audit_admin_products
AFTER UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.capture_admin_audit_log();

DROP TRIGGER IF EXISTS trg_audit_admin_orders ON public.orders;
CREATE TRIGGER trg_audit_admin_orders
AFTER UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.capture_admin_audit_log();

DROP TRIGGER IF EXISTS trg_audit_admin_customers ON public.user_status;
CREATE TRIGGER trg_audit_admin_customers
AFTER INSERT OR UPDATE ON public.user_status
FOR EACH ROW EXECUTE FUNCTION public.capture_admin_audit_log();

DROP TRIGGER IF EXISTS trg_audit_admin_settings ON public.platform_settings;
CREATE TRIGGER trg_audit_admin_settings
AFTER UPDATE ON public.platform_settings
FOR EACH ROW EXECUTE FUNCTION public.capture_admin_audit_log();

DROP TRIGGER IF EXISTS trg_audit_admin_settlements ON public.settlements;
CREATE TRIGGER trg_audit_admin_settlements
AFTER UPDATE ON public.settlements
FOR EACH ROW EXECUTE FUNCTION public.capture_admin_audit_log();

DROP TRIGGER IF EXISTS trg_audit_admin_support_tickets ON public.support_tickets;
CREATE TRIGGER trg_audit_admin_support_tickets
AFTER UPDATE ON public.support_tickets
FOR EACH ROW EXECUTE FUNCTION public.capture_admin_audit_log();

DROP TRIGGER IF EXISTS trg_audit_admin_delivery_assignments ON public.delivery_assignments;
CREATE TRIGGER trg_audit_admin_delivery_assignments
AFTER UPDATE ON public.delivery_assignments
FOR EACH ROW EXECUTE FUNCTION public.capture_admin_audit_log();

DROP TRIGGER IF EXISTS trg_audit_admin_delivery_exceptions ON public.delivery_exceptions;
CREATE TRIGGER trg_audit_admin_delivery_exceptions
AFTER UPDATE ON public.delivery_exceptions
FOR EACH ROW EXECUTE FUNCTION public.capture_admin_audit_log();

INSERT INTO public.admin_access_assignments (user_id, role, status)
SELECT user_id, 'SUPER_ADMIN', 'active'
FROM public.user_roles
WHERE role = 'admin'::public.app_role AND status = 'active'
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_my_admin_access()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'role', COALESCE(assignment.role, 'SUPER_ADMIN'),
    'status', COALESCE(assignment.status, 'active'),
    'permissions', COALESCE(
      (SELECT jsonb_agg(grant_row.permission ORDER BY grant_row.permission)
       FROM public.admin_role_permissions grant_row
       WHERE grant_row.role = COALESCE(assignment.role, 'SUPER_ADMIN')),
      '[]'::jsonb
    )
  )
  FROM (SELECT auth.uid() AS user_id) current_user_row
  LEFT JOIN public.admin_access_assignments assignment
    ON assignment.user_id = current_user_row.user_id
  WHERE current_user_row.user_id IS NOT NULL
    AND ((assignment.user_id IS NOT NULL AND assignment.status = 'active') OR
      (assignment.user_id IS NULL AND EXISTS (
        SELECT 1 FROM public.user_roles legacy
        WHERE legacy.user_id = current_user_row.user_id
          AND legacy.role = 'admin'::public.app_role AND legacy.status = 'active'
      )));
$$;

-- Keep historical RLS/function call sites safe during rollout: legacy
-- has_role(..., 'admin') now means active SUPER_ADMIN only. Delegated admins
-- must pass the explicit permission check for their operation.
CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN _role = 'admin'::public.app_role THEN
      CASE WHEN EXISTS (
        SELECT 1 FROM public.admin_access_assignments assignment
        WHERE assignment.user_id = _user_id
      ) THEN EXISTS (
        SELECT 1 FROM public.admin_access_assignments assignment
        WHERE assignment.user_id = _user_id
          AND assignment.role = 'SUPER_ADMIN'
          AND assignment.status = 'active'
      ) ELSE EXISTS (
        SELECT 1 FROM public.user_roles legacy
        WHERE legacy.user_id = _user_id
          AND legacy.role = 'admin'::public.app_role
          AND legacy.status = 'active'
      ) END
    ELSE EXISTS (
      SELECT 1 FROM public.user_roles role_row
      WHERE role_row.user_id = _user_id
        AND role_row.role = _role
        AND role_row.status = 'active'
    )
  END;
$$;
REVOKE ALL ON FUNCTION private.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$ SELECT private.has_role(_user_id, _role); $$;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_admin_users()
RETURNS TABLE (
  user_id uuid, email text, display_name text, role text, status text,
  assigned_by uuid, created_at timestamptz, last_sign_in_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.has_admin_permission('admins.view') THEN
    RAISE EXCEPTION 'Admin user management permission required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT a.user_id, u.email::text, p.display_name, a.role, a.status,
         a.assigned_by, a.created_at, u.last_sign_in_at
  FROM public.admin_access_assignments a
  JOIN auth.users u ON u.id = a.user_id
  LEFT JOIN public.profiles p ON p.id = a.user_id
  ORDER BY a.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.find_admin_account(p_email text)
RETURNS TABLE (user_id uuid, email text, display_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.has_admin_permission('admins.manage')
    OR NOT public.has_admin_permission('admins.view') THEN
    RAISE EXCEPTION 'Admin user management permission required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT u.id, u.email::text, p.display_name
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE lower(u.email) = lower(trim(p_email))
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_admin_access(
  p_user_id uuid,
  p_role text,
  p_status text,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  existing_role text;
  existing_status text;
  active_super_admin_count integer;
BEGIN
  IF NOT public.has_admin_permission('admins.manage')
    OR NOT public.has_admin_permission('admins.view') THEN
    RAISE EXCEPTION 'Admin user management permission required' USING ERRCODE = '42501';
  END IF;
  IF p_role NOT IN (
    'SUPER_ADMIN','OPERATIONS_ADMIN','SELLER_MANAGER','CATALOG_MANAGER',
    'FINANCE_ADMIN','SUPPORT_AGENT','MARKETING_ADMIN','ANALYST'
  ) THEN
    RAISE EXCEPTION 'Invalid admin role' USING ERRCODE = '22023';
  END IF;
  IF p_status NOT IN ('active','suspended') THEN
    RAISE EXCEPTION 'Invalid admin status' USING ERRCODE = '22023';
  END IF;
  IF length(trim(COALESCE(p_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'Provide a reason for this admin access change' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Account not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT role, status INTO existing_role, existing_status
  FROM public.admin_access_assignments WHERE user_id = p_user_id FOR UPDATE;

  PERFORM pg_advisory_xact_lock(721401, 1);

  IF NOT public.has_admin_permission('admins.manage')
    OR NOT public.has_admin_permission('admins.view') THEN
    RAISE EXCEPTION 'Only a privileged administrator may assign admin roles' USING ERRCODE = '42501';
  END IF;

  IF existing_role = 'SUPER_ADMIN' AND existing_status = 'active'
    AND (p_role <> 'SUPER_ADMIN' OR p_status <> 'active') THEN
    SELECT count(*) INTO active_super_admin_count
    FROM public.admin_access_assignments
    WHERE role = 'SUPER_ADMIN' AND status = 'active';
    IF active_super_admin_count <= 1 THEN
      RAISE EXCEPTION 'Cannot remove or suspend the last active SUPER_ADMIN' USING ERRCODE = '23514';
    END IF;
  END IF;

  PERFORM set_config('app.admin_audit_reason', trim(p_reason), true);
  INSERT INTO public.admin_access_assignments (user_id, role, status, assigned_by)
  VALUES (p_user_id, p_role, p_status, auth.uid())
  ON CONFLICT (user_id) DO UPDATE SET
    role = EXCLUDED.role,
    status = EXCLUDED.status,
    assigned_by = auth.uid(),
    updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.list_admin_audit_logs(
  p_actor_search text DEFAULT NULL,
  p_action text DEFAULT NULL,
  p_resource_type text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid, actor_id uuid, actor_name text, actor_email text, actor_role text,
  action text, resource_type text, resource_id text, previous_value jsonb,
  new_value jsonb, reason text, metadata jsonb, created_at timestamptz,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.has_admin_permission('audit.view') THEN
    RAISE EXCEPTION 'Audit log permission required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT log.id, log.actor_id, log.actor_name, log.actor_email, log.actor_role,
         log.action, log.resource_type, log.resource_id, log.previous_value,
         log.new_value, log.reason, log.metadata, log.created_at,
         count(*) OVER () AS total_count
  FROM public.admin_audit_logs log
  WHERE (p_actor_search IS NULL OR trim(p_actor_search) = ''
    OR log.actor_id::text ILIKE '%' || trim(p_actor_search) || '%'
    OR COALESCE(log.actor_name, '') ILIKE '%' || trim(p_actor_search) || '%'
    OR COALESCE(log.actor_email, '') ILIKE '%' || trim(p_actor_search) || '%')
    AND (p_action IS NULL OR p_action = '' OR log.action = p_action)
    AND (p_resource_type IS NULL OR p_resource_type = '' OR log.resource_type = p_resource_type)
    AND (p_from IS NULL OR log.created_at >= p_from)
    AND (p_to IS NULL OR log.created_at < p_to)
    AND (p_search IS NULL OR trim(p_search) = ''
      OR log.action ILIKE '%' || trim(p_search) || '%'
      OR log.resource_type ILIKE '%' || trim(p_search) || '%'
      OR COALESCE(log.resource_id, '') ILIKE '%' || trim(p_search) || '%'
      OR COALESCE(log.reason, '') ILIKE '%' || trim(p_search) || '%')
  ORDER BY log.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_admin_access() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_admin_users() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.find_admin_account(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_admin_access(uuid, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_admin_audit_logs(text, text, text, timestamptz, timestamptz, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_admin_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_admin_users() TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_admin_account(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_admin_access(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_admin_audit_logs(text, text, text, timestamptz, timestamptz, text, integer, integer) TO authenticated;

CREATE POLICY "Admins can read their own assignment or manage assignments"
  ON public.admin_access_assignments FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_admin_permission('admins.manage'));

COMMIT;
