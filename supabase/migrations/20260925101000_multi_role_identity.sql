-- One Supabase Auth identity may hold multiple LocalShore roles.
-- Admin is deliberately preserved as a database-controlled role and is never
-- granted by signup or a client-callable onboarding flow.

ALTER TABLE public.user_roles
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

ALTER TABLE public.user_roles
  DROP CONSTRAINT IF EXISTS user_roles_status_check;
ALTER TABLE public.user_roles
  ADD CONSTRAINT user_roles_status_check
  CHECK (status IN ('pending', 'active', 'suspended', 'revoked'));

CREATE INDEX IF NOT EXISTS user_roles_user_status_idx
  ON public.user_roles (user_id, status);
CREATE INDEX IF NOT EXISTS user_roles_role_status_idx
  ON public.user_roles (role, status);

-- Move the legacy compatibility role into the canonical role name without
-- dropping the unique (user_id, role) guarantee.
INSERT INTO public.user_roles (user_id, role, status)
SELECT user_id, 'seller'::public.app_role, status
FROM public.user_roles
WHERE role = 'vendor'::public.app_role
ON CONFLICT (user_id, role) DO UPDATE SET status = EXCLUDED.status;
DELETE FROM public.user_roles WHERE role = 'vendor'::public.app_role;

-- Every existing Auth identity is a LocalShore customer. Existing seller and
-- delivery records add their role to the same identity; no Auth users are
-- created or deleted by this migration.
INSERT INTO public.profiles (id, email, display_name)
SELECT u.id, u.email, COALESCE(u.raw_user_meta_data->>'display_name', split_part(u.email, '@', 1))
FROM auth.users u
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role, status)
SELECT u.id, 'customer'::public.app_role, 'active'
FROM auth.users u
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO public.user_roles (user_id, role, status)
SELECT s.user_id, 'seller'::public.app_role,
       CASE WHEN s.status = 'approved' THEN 'active' ELSE 'pending' END
FROM public.sellers s
ON CONFLICT (user_id, role) DO UPDATE SET status = EXCLUDED.status;

INSERT INTO public.user_roles (user_id, role, status)
SELECT d.user_id, 'delivery_partner'::public.app_role,
       CASE WHEN lower(d.status) = 'approved' THEN 'active' ELSE 'pending' END
FROM public.delivery_partners d
ON CONFLICT (user_id, role) DO UPDATE SET status = EXCLUDED.status;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

-- Normalize legacy single-role values before adding the canonical constraint.
-- The role column is only a compatibility projection; user_roles is the
-- authoritative multi-role source.
UPDATE public.profiles p
SET role = CASE
  WHEN lower(COALESCE(p.role, '')) = 'admin'
    OR EXISTS (
      SELECT 1 FROM public.user_roles r
      WHERE r.user_id = p.id AND r.role = 'admin'::public.app_role AND r.status = 'active'
    ) THEN 'admin'
  WHEN lower(COALESCE(p.role, '')) IN ('seller', 'vendor', 'shop_owner')
    OR EXISTS (
      SELECT 1 FROM public.user_roles r
      WHERE r.user_id = p.id AND r.role = 'seller'::public.app_role
    ) THEN 'seller'
  WHEN lower(COALESCE(p.role, '')) IN ('delivery_partner', 'rider', 'driver')
    OR EXISTS (
      SELECT 1 FROM public.user_roles r
      WHERE r.user_id = p.id AND r.role = 'delivery_partner'::public.app_role
    ) THEN 'delivery_partner'
  ELSE 'customer'
END;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('customer', 'seller', 'delivery_partner', 'admin'));

-- Legacy single-role column is retained for old clients only. It is a
-- projection, never the authorization source.
CREATE OR REPLACE FUNCTION public.refresh_legacy_profile_role(_user_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.profiles p
  SET role = CASE
    WHEN EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _user_id AND r.role = 'admin' AND r.status = 'active') THEN 'admin'
    WHEN EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _user_id AND r.role = 'seller' AND r.status = 'active') THEN 'seller'
    WHEN EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _user_id AND r.role = 'delivery_partner' AND r.status = 'active') THEN 'delivery_partner'
    ELSE 'customer'
  END
  WHERE p.id = _user_id;
$$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles r
    WHERE r.user_id = _user_id
      AND r.status = 'active'
      AND (r.role = _role OR (_role = 'seller'::public.app_role AND r.role = 'vendor'::public.app_role))
  );
$$;

CREATE OR REPLACE FUNCTION public.has_active_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles r
    WHERE r.user_id = _user_id
      AND r.status = 'active'
      AND (r.role = _role OR (_role = 'seller'::public.app_role AND r.role = 'vendor'::public.app_role))
  );
$$;

REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
REVOKE ALL ON FUNCTION public.has_active_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_active_role(uuid, public.app_role) TO authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(COALESCE(NEW.email, ''), '@', 1)))
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role, status)
  VALUES (NEW.id, 'customer', 'active')
  ON CONFLICT (user_id, role) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Replace the old email-based admin bootstrap. Existing admin rows remain;
-- ordinary users cannot call a function to make themselves admin.
CREATE OR REPLACE FUNCTION public.claim_first_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$ SELECT false; $$;
REVOKE EXECUTE ON FUNCTION public.claim_first_admin() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_seller_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE role_status text := CASE WHEN NEW.status = 'approved' THEN 'active' ELSE 'pending' END;
BEGIN
  INSERT INTO public.user_roles (user_id, role, status)
  VALUES (NEW.user_id, 'seller', role_status)
  ON CONFLICT (user_id, role) DO UPDATE SET status = EXCLUDED.status;
  PERFORM public.refresh_legacy_profile_role(NEW.user_id);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_sync_vendor_profile_role ON public.sellers;
DROP TRIGGER IF EXISTS trg_sync_seller_role ON public.sellers;
CREATE TRIGGER trg_sync_seller_role
AFTER INSERT OR UPDATE OF status ON public.sellers
FOR EACH ROW EXECUTE FUNCTION public.sync_seller_role();

CREATE OR REPLACE FUNCTION public.sync_delivery_partner_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE role_status text := CASE WHEN lower(NEW.status) = 'approved' THEN 'active' ELSE 'pending' END;
BEGIN
  INSERT INTO public.user_roles (user_id, role, status)
  VALUES (NEW.user_id, 'delivery_partner', role_status)
  ON CONFLICT (user_id, role) DO UPDATE SET status = EXCLUDED.status;
  PERFORM public.refresh_legacy_profile_role(NEW.user_id);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_sync_delivery_partner_role ON public.delivery_partners;
CREATE TRIGGER trg_sync_delivery_partner_role
AFTER INSERT OR UPDATE OF status ON public.delivery_partners
FOR EACH ROW EXECUTE FUNCTION public.sync_delivery_partner_role();

-- Reconcile the legacy projection after the backfill.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.profiles LOOP
    PERFORM public.refresh_legacy_profile_role(r.id);
  END LOOP;
END;
$$;

-- user_roles is readable by the owner, but role assignment is server/database
-- controlled. No authenticated INSERT/UPDATE/DELETE policy is granted.
REVOKE INSERT, UPDATE, DELETE ON public.user_roles FROM authenticated, anon;
