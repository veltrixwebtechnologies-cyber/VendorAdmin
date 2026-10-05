BEGIN;

-- Refresh role grants to the reviewed least-privilege mapping. This table is
-- configuration only (no user-owned records or foreign keys depend on it).
DELETE FROM public.admin_role_permissions;
INSERT INTO public.admin_role_permissions (role, permission)
SELECT 'SUPER_ADMIN', permission FROM unnest(ARRAY[
  'dashboard.view','orders.view','orders.manage','sellers.view','sellers.approve','sellers.suspend','sellers.manage',
  'stores.view','stores.manage','products.view','products.moderate','products.manage','categories.view','categories.manage',
  'inventory.view','inventory.manage','customers.view','customers.manage','payments.view','refunds.view','refunds.manage',
  'payouts.view','payouts.manage','commissions.view','commissions.manage','reviews.view','reviews.moderate',
  'support.view','support.manage','promotions.view','promotions.manage','dispatch.view','dispatch.manage',
  'notifications.view','notifications.manage','analytics.view','reports.view','settings.view','settings.manage',
  'admins.view','admins.manage','audit.view','integrations.view','integrations.manage','platform_health.view'
]) AS permission;
INSERT INTO public.admin_role_permissions (role, permission)
SELECT role, permission FROM (VALUES
  ('OPERATIONS_ADMIN', ARRAY['dashboard.view','orders.view','orders.manage','sellers.view','stores.view','inventory.view','dispatch.view','dispatch.manage','support.view','analytics.view']),
  ('SELLER_MANAGER', ARRAY['dashboard.view','sellers.view','sellers.approve','sellers.suspend','sellers.manage','stores.view','stores.manage','products.view','orders.view']),
  ('CATALOG_MANAGER', ARRAY['dashboard.view','products.view','products.moderate','products.manage','categories.view','categories.manage','inventory.view','inventory.manage']),
  ('FINANCE_ADMIN', ARRAY['dashboard.view','orders.view','payments.view','refunds.view','refunds.manage','payouts.view','payouts.manage','commissions.view','commissions.manage','reports.view']),
  ('SUPPORT_AGENT', ARRAY['dashboard.view','orders.view','customers.view','reviews.view','support.view','support.manage']),
  ('MARKETING_ADMIN', ARRAY['dashboard.view','promotions.view','promotions.manage','notifications.view','notifications.manage','analytics.view']),
  ('ANALYST', ARRAY['dashboard.view','analytics.view','reports.view','orders.view','stores.view','products.view','categories.view','inventory.view','payments.view','payouts.view','reviews.view'])
) AS role_grants(role, permissions),
LATERAL unnest(role_grants.permissions) AS permission_rows(permission);

-- Make the database RBAC permission function the delegated-admin authority.
-- Historical has_role('admin') policies are constrained by the preceding
-- migration's compatibility shim to active SUPER_ADMIN assignments only.

-- Marketplace sellers and seller documents.
DROP POLICY IF EXISTS "Admin reads all sellers" ON public.sellers;
DROP POLICY IF EXISTS "Admin updates sellers" ON public.sellers;
CREATE POLICY "RBAC admins read sellers" ON public.sellers
  FOR SELECT TO authenticated USING (public.has_admin_permission('sellers.view'));
CREATE POLICY "RBAC admins update sellers" ON public.sellers
  FOR UPDATE TO authenticated
  USING (public.has_admin_permission('sellers.manage') OR public.has_admin_permission('sellers.approve') OR public.has_admin_permission('sellers.suspend'))
  WITH CHECK (public.has_admin_permission('sellers.manage') OR public.has_admin_permission('sellers.approve') OR public.has_admin_permission('sellers.suspend'));
DROP POLICY IF EXISTS "Admin reads all docs" ON public.seller_documents;
CREATE POLICY "RBAC admins read seller documents" ON public.seller_documents
  FOR SELECT TO authenticated USING (public.has_admin_permission('sellers.view'));

-- Product moderation. Existing seller ownership and active-public read rules remain intact.
DROP POLICY IF EXISTS "Admin reads all products" ON public.products;
DROP POLICY IF EXISTS "Admin updates products" ON public.products;
DROP POLICY IF EXISTS "Admin deletes products" ON public.products;
CREATE POLICY "RBAC admins read products" ON public.products
  FOR SELECT TO authenticated USING (public.has_admin_permission('products.view') OR public.has_admin_permission('inventory.view'));
CREATE POLICY "RBAC admins update products" ON public.products
  FOR UPDATE TO authenticated
  USING (public.has_admin_permission('products.manage') OR public.has_admin_permission('products.moderate'))
  WITH CHECK (public.has_admin_permission('products.manage') OR public.has_admin_permission('products.moderate'));

-- Categories and brands: preserve public active rows, grant inactive rows to viewers,
-- and split write operations. No admin DELETE capability is introduced.
DROP POLICY IF EXISTS "Anyone views active categories" ON public.categories;
DROP POLICY IF EXISTS "Admins manage categories" ON public.categories;
CREATE POLICY "Public active categories or permitted admin read" ON public.categories
  FOR SELECT USING (is_active OR (auth.uid() IS NOT NULL AND public.has_admin_permission('categories.view')));
CREATE POLICY "RBAC admins insert categories" ON public.categories
  FOR INSERT TO authenticated WITH CHECK (public.has_admin_permission('categories.manage'));
CREATE POLICY "RBAC admins update categories" ON public.categories
  FOR UPDATE TO authenticated USING (public.has_admin_permission('categories.manage'))
  WITH CHECK (public.has_admin_permission('categories.manage'));
DROP POLICY IF EXISTS "Anyone views active brands" ON public.brands;
DROP POLICY IF EXISTS "Admins manage brands" ON public.brands;
CREATE POLICY "Public active brands or permitted admin read" ON public.brands
  FOR SELECT USING (is_active OR (auth.uid() IS NOT NULL AND public.has_admin_permission('categories.view')));
CREATE POLICY "RBAC admins insert brands" ON public.brands
  FOR INSERT TO authenticated WITH CHECK (public.has_admin_permission('categories.manage'));
CREATE POLICY "RBAC admins update brands" ON public.brands
  FOR UPDATE TO authenticated USING (public.has_admin_permission('categories.manage'))
  WITH CHECK (public.has_admin_permission('categories.manage'));

-- Orders are read/managed by explicit order permissions; financial tables below
-- have separate permissions. Seller/customer and delivery ownership policies remain.
DROP POLICY IF EXISTS "Admin reads all orders" ON public.orders;
DROP POLICY IF EXISTS "Admin deletes orders" ON public.orders;
DROP POLICY IF EXISTS "Admin updates orders" ON public.orders;
CREATE POLICY "RBAC admins read orders" ON public.orders
  FOR SELECT TO authenticated USING (public.has_admin_permission('orders.view'));
CREATE POLICY "RBAC admins update orders" ON public.orders
  FOR UPDATE TO authenticated USING (public.has_admin_permission('orders.manage'))
  WITH CHECK (public.has_admin_permission('orders.manage'));
DROP POLICY IF EXISTS "Admin reads all order items" ON public.order_items;
DROP POLICY IF EXISTS "Admin updates order items" ON public.order_items;
DROP POLICY IF EXISTS "Admin deletes order items" ON public.order_items;
CREATE POLICY "RBAC admins read order items" ON public.order_items
  FOR SELECT TO authenticated USING (public.has_admin_permission('orders.view'));

-- Financial read and settlement management are separated. No DELETE or client
-- INSERT is granted for financial records.
DROP POLICY IF EXISTS "Admin reads settlements" ON public.settlements;
DROP POLICY IF EXISTS "Admin updates settlements" ON public.settlements;
DROP POLICY IF EXISTS "Admin inserts settlements" ON public.settlements;
CREATE POLICY "RBAC admins read settlements" ON public.settlements
  FOR SELECT TO authenticated USING (public.has_admin_permission('payouts.view'));
CREATE POLICY "RBAC admins update settlements" ON public.settlements
  FOR UPDATE TO authenticated USING (public.has_admin_permission('payouts.manage'))
  WITH CHECK (public.has_admin_permission('payouts.manage'));
DO $$ BEGIN
  IF to_regclass('public.payment_attempts') IS NOT NULL THEN
    EXECUTE 'CREATE POLICY "RBAC admins read payment attempts" ON public.payment_attempts FOR SELECT TO authenticated USING (public.has_admin_permission(''payments.view''))';
  END IF;
END $$;

-- Customer directory and status controls.
DROP POLICY IF EXISTS "Admins read all profiles" ON public.profiles;
CREATE POLICY "RBAC admins read customer profiles" ON public.profiles
  FOR SELECT TO authenticated USING (public.has_admin_permission('customers.view'));
DROP POLICY IF EXISTS "Admins read all user_status" ON public.user_status;
DROP POLICY IF EXISTS "Admins manage blocks" ON public.user_status;
CREATE POLICY "RBAC admins read customer status" ON public.user_status
  FOR SELECT TO authenticated USING (public.has_admin_permission('customers.view'));
CREATE POLICY "RBAC admins insert customer status" ON public.user_status
  FOR INSERT TO authenticated WITH CHECK (public.has_admin_permission('customers.manage'));
CREATE POLICY "RBAC admins update customer status" ON public.user_status
  FOR UPDATE TO authenticated USING (public.has_admin_permission('customers.manage'))
  WITH CHECK (public.has_admin_permission('customers.manage'));

-- Review visibility/moderation; customer-owned insert/update policies remain.
DROP POLICY IF EXISTS "Anyone views approved reviews" ON public.reviews;
DROP POLICY IF EXISTS "Admins moderate reviews" ON public.reviews;
CREATE POLICY "Public approved reviews or permitted admin read" ON public.reviews
  FOR SELECT USING (status = 'approved' OR user_id = auth.uid()
    OR (auth.uid() IS NOT NULL AND public.has_admin_permission('reviews.view')));
CREATE POLICY "RBAC admins moderate reviews" ON public.reviews
  FOR UPDATE TO authenticated USING (public.has_admin_permission('reviews.moderate'))
  WITH CHECK (public.has_admin_permission('reviews.moderate'));

-- Promotions. Public visibility of active offers/banners/coupons stays unchanged;
-- admin write access is split and irreversible DELETE is not granted.
DROP POLICY IF EXISTS "Anyone views active coupons" ON public.coupons;
DROP POLICY IF EXISTS "Admins manage coupons" ON public.coupons;
CREATE POLICY "Public active coupons or permitted admin read" ON public.coupons
  FOR SELECT USING (is_active OR (auth.uid() IS NOT NULL AND public.has_admin_permission('promotions.view')));
CREATE POLICY "RBAC admins insert coupons" ON public.coupons
  FOR INSERT TO authenticated WITH CHECK (public.has_admin_permission('promotions.manage'));
CREATE POLICY "RBAC admins update coupons" ON public.coupons
  FOR UPDATE TO authenticated USING (public.has_admin_permission('promotions.manage'))
  WITH CHECK (public.has_admin_permission('promotions.manage'));
DROP POLICY IF EXISTS "Anyone views active banners" ON public.banners;
DROP POLICY IF EXISTS "Admins manage banners" ON public.banners;
CREATE POLICY "Public active banners or permitted admin read" ON public.banners
  FOR SELECT USING (is_active OR (auth.uid() IS NOT NULL AND public.has_admin_permission('promotions.view')));
CREATE POLICY "RBAC admins insert banners" ON public.banners
  FOR INSERT TO authenticated WITH CHECK (public.has_admin_permission('promotions.manage'));
CREATE POLICY "RBAC admins update banners" ON public.banners
  FOR UPDATE TO authenticated USING (public.has_admin_permission('promotions.manage'))
  WITH CHECK (public.has_admin_permission('promotions.manage'));
-- This storefront feature is optional and may not yet exist in every project.
DO $rbac_localshore_offer_cards$
BEGIN
  IF to_regclass('public.localshore_offer_cards') IS NOT NULL THEN
    EXECUTE $policy$DROP POLICY IF EXISTS "Anyone views active LocalShore offers" ON public.localshore_offer_cards$policy$;
    EXECUTE $policy$DROP POLICY IF EXISTS "Admins manage LocalShore offers" ON public.localshore_offer_cards$policy$;
    EXECUTE $policy$CREATE POLICY "Public active LocalShore offers or permitted admin read" ON public.localshore_offer_cards
      FOR SELECT USING (is_active OR (auth.uid() IS NOT NULL AND public.has_admin_permission('promotions.view')))$policy$;
    EXECUTE $policy$CREATE POLICY "RBAC admins insert LocalShore offers" ON public.localshore_offer_cards
      FOR INSERT TO authenticated WITH CHECK (public.has_admin_permission('promotions.manage') AND created_by = auth.uid())$policy$;
    EXECUTE $policy$CREATE POLICY "RBAC admins update LocalShore offers" ON public.localshore_offer_cards
      FOR UPDATE TO authenticated USING (public.has_admin_permission('promotions.manage'))
      WITH CHECK (public.has_admin_permission('promotions.manage'))$policy$;
  END IF;
END
$rbac_localshore_offer_cards$;

-- Platform settings are public-readable by existing design; only settings.manage
-- may update them. The earlier broad FOR ALL policy is removed.
DROP POLICY IF EXISTS "Admins update settings" ON public.platform_settings;
CREATE POLICY "RBAC admins update settings" ON public.platform_settings
  FOR UPDATE TO authenticated USING (public.has_admin_permission('settings.manage') OR public.has_admin_permission('commissions.manage'))
  WITH CHECK (public.has_admin_permission('settings.manage') OR public.has_admin_permission('commissions.manage'));

-- RLS is row-scoped, so this trigger prevents a commission-only role from
-- changing unrelated marketplace settings on the same singleton row.
CREATE OR REPLACE FUNCTION public.guard_admin_platform_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  commission_changed boolean := NEW.commission_percent IS DISTINCT FROM OLD.commission_percent;
  other_setting_changed boolean :=
    NEW.marketplace_name IS DISTINCT FROM OLD.marketplace_name OR
    NEW.logo_url IS DISTINCT FROM OLD.logo_url OR
    NEW.shipping_flat IS DISTINCT FROM OLD.shipping_flat OR
    NEW.tax_percent IS DISTINCT FROM OLD.tax_percent OR
    NEW.return_policy IS DISTINCT FROM OLD.return_policy OR
    NEW.privacy_policy IS DISTINCT FROM OLD.privacy_policy OR
    NEW.terms_conditions IS DISTINCT FROM OLD.terms_conditions OR
    NEW.payment_gateway IS DISTINCT FROM OLD.payment_gateway;
BEGIN
  IF commission_changed AND NOT public.has_admin_permission('commissions.manage') THEN
    RAISE EXCEPTION 'You do not have permission to change commission settings' USING ERRCODE = '42501';
  END IF;
  IF other_setting_changed AND NOT public.has_admin_permission('settings.manage') THEN
    RAISE EXCEPTION 'You do not have permission to change platform settings' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_admin_platform_settings ON public.platform_settings;
CREATE TRIGGER trg_guard_admin_platform_settings BEFORE UPDATE ON public.platform_settings
FOR EACH ROW EXECUTE FUNCTION public.guard_admin_platform_settings();

-- Existing business rules used legacy admin predicates in triggers/RPCs. Preserve
-- those rules while making delegated seller/catalog/order permissions effective.
CREATE OR REPLACE FUNCTION public.prevent_vendor_approval_field_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.role() = 'service_role'
    OR public.has_admin_permission('sellers.manage')
    OR public.has_admin_permission('sellers.approve')
    OR public.has_admin_permission('sellers.suspend') THEN
    RETURN NEW;
  END IF;
  IF auth.uid() = OLD.user_id
    AND OLD.status::text IN ('draft','rejected','more_info')
    AND NEW.status::text = 'pending'
    AND NEW.reviewed_by IS NOT DISTINCT FROM OLD.reviewed_by
    AND NEW.reviewed_at IS NOT DISTINCT FROM OLD.reviewed_at
    AND NEW.admin_notes IS NOT DISTINCT FROM OLD.admin_notes THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
    OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
    OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
    OR NEW.admin_notes IS DISTINCT FROM OLD.admin_notes THEN
    RAISE EXCEPTION 'You do not have permission to change seller review fields' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_seller_product_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.role() = 'service_role' THEN RETURN NEW; END IF;
  IF public.has_admin_permission('products.manage') OR public.has_admin_permission('products.moderate') THEN
    NEW.user_id := OLD.user_id;
    NEW.seller_id := OLD.seller_id;
    RETURN NEW;
  END IF;
  NEW.user_id := OLD.user_id;
  NEW.seller_id := OLD.seller_id;
  NEW.status := OLD.status;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_advance_order(_order_id uuid, _next_status text)
RETURNS public.orders LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE current_order public.orders; target public.order_status;
BEGIN
  IF NOT public.has_admin_permission('orders.manage') THEN
    RAISE EXCEPTION 'You do not have permission to manage orders' USING ERRCODE = '42501';
  END IF;
  target := _next_status::public.order_status;
  SELECT * INTO current_order FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF current_order.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF NOT (
    (current_order.status::text = 'new' AND target IN ('accepted','cancelled')) OR
    (current_order.status::text = 'accepted' AND target IN ('packed','cancelled')) OR
    (current_order.status::text = 'packed' AND target IN ('ready_for_pickup','cancelled')) OR
    (current_order.status::text = 'ready_for_pickup' AND target IN ('assigned','cancelled')) OR
    (current_order.status::text = 'assigned' AND target IN ('picked_up','cancelled')) OR
    (current_order.status::text = 'picked_up' AND target IN ('out_for_delivery','cancelled')) OR
    (current_order.status::text = 'out_for_delivery' AND target = 'delivered') OR
    (current_order.status::text = 'delivered' AND target = 'returned')
  ) THEN RAISE EXCEPTION 'Invalid order transition' USING ERRCODE = '22023'; END IF;
  UPDATE public.orders SET status = target,
    delivered_at = CASE WHEN target = 'delivered' THEN now() ELSE delivered_at END,
    updated_at = now()
  WHERE id = current_order.id RETURNING * INTO current_order;
  RETURN current_order;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_advance_order(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_advance_order(uuid,text) TO authenticated;

-- Protected support remains participant-scoped; delegated support staff are
-- authorized only through support.view/support.manage, not generic admin role.
CREATE OR REPLACE FUNCTION public.is_protected_support_participant(p_ticket_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.support_tickets t WHERE t.id = p_ticket_id AND (
      t.user_id = auth.uid()
      OR EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = t.vendor_id AND s.user_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.delivery_partners dp WHERE dp.id = t.delivery_partner_id AND dp.user_id = auth.uid())
      OR public.has_admin_permission('support.view')
    )
  )
$$;

CREATE OR REPLACE FUNCTION public.get_protected_support_cases()
RETURNS TABLE (
  id uuid, case_number text, order_id uuid, order_number text, shop_name text,
  subject text, issue_category text, issue_type text, affected_item_name text,
  support_stage text, status text, resolution_type text, created_at timestamptz,
  updated_at timestamptz, response_due_at timestamptz, viewer_role text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000'; END IF;
  RETURN QUERY
  SELECT t.id, t.case_number, t.order_id, o.order_number,
    CASE WHEN t.user_id = auth.uid() THEN s.business_name ELSE NULL END,
    t.subject, t.issue_category, t.issue_type, oi.product_name,
    t.support_stage, t.status, t.resolution_type, t.created_at, t.updated_at,
    t.response_due_at,
    CASE WHEN public.has_admin_permission('support.view') THEN 'customer_care'
      WHEN t.user_id = auth.uid() THEN 'customer'
      WHEN EXISTS (SELECT 1 FROM public.sellers sx WHERE sx.id = t.vendor_id AND sx.user_id = auth.uid()) THEN 'vendor'
      ELSE 'delivery_partner' END
  FROM public.support_tickets t
  LEFT JOIN public.orders o ON o.id = t.order_id
  LEFT JOIN public.sellers s ON s.id = t.vendor_id
  LEFT JOIN public.order_items oi ON oi.id = t.affected_order_item_id
  WHERE t.user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.sellers sx WHERE sx.id = t.vendor_id AND sx.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.delivery_partners dp WHERE dp.id = t.delivery_partner_id AND dp.user_id = auth.uid())
    OR public.has_admin_permission('support.view')
  ORDER BY t.updated_at DESC;
END
$$;

-- Keep the established seller/customer RPC signature untouched: deployed
-- environments may have a different RETURNS TABLE shape. The admin console
-- uses this additive RPC so delegated support access is permission-checked.
CREATE OR REPLACE FUNCTION public.admin_get_protected_support_messages(p_ticket_id uuid)
RETURNS TABLE (id uuid, sender_role text, body text, attachments text[], created_at timestamptz,
  visible_to_customer boolean, visible_to_vendor boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_admin_permission('support.view') THEN
    RAISE EXCEPTION 'You do not have permission to view support messages' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.id = p_ticket_id) THEN
    RAISE EXCEPTION 'Support case not found or access denied' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT m.id, m.sender_role, m.body, m.attachments, m.created_at, m.visible_to_customer, m.visible_to_vendor
  FROM public.ticket_messages m
  WHERE m.ticket_id = p_ticket_id
  ORDER BY m.created_at ASC;
END
$$;

CREATE OR REPLACE FUNCTION public.manage_protected_support_case(p_ticket_id uuid, p_action text, p_note text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ticket public.support_tickets%ROWTYPE;
  v_stage text;
  v_status text;
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL OR NOT public.has_admin_permission('support.manage') THEN
    RAISE EXCEPTION 'You do not have permission to manage support cases' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_ticket FROM public.support_tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Support case not found'; END IF;
  CASE p_action
    WHEN 'escalate' THEN v_stage := 'ESCALATED'; v_status := 'pending';
    WHEN 'wait_vendor' THEN v_stage := 'WAITING_FOR_VENDOR'; v_status := 'pending';
    WHEN 'reopen' THEN v_stage := 'REOPENED'; v_status := 'open';
    WHEN 'resolve' THEN v_stage := 'RESOLVED'; v_status := 'resolved';
    WHEN 'cancel' THEN v_stage := 'CANCELLED'; v_status := 'closed';
    ELSE RAISE EXCEPTION 'Unsupported support action' USING ERRCODE = '22023';
  END CASE;
  UPDATE public.support_tickets SET support_stage = v_stage, status = v_status,
    response_due_at = CASE WHEN p_action = 'wait_vendor' THEN now() + interval '4 hours' ELSE response_due_at END,
    resolved_at = CASE WHEN v_stage IN ('RESOLVED','CANCELLED') THEN now() ELSE NULL END,
    escalation_notified_at = CASE WHEN v_stage = 'ESCALATED' THEN now() ELSE escalation_notified_at END,
    updated_at = now() WHERE id = p_ticket_id;
  INSERT INTO public.ticket_messages(ticket_id, author_id, is_admin, sender_role, body)
  VALUES (p_ticket_id, v_user_id, true, 'system',
    CASE p_action WHEN 'escalate' THEN 'LocalShore Customer Care escalated this case.'
      WHEN 'wait_vendor' THEN 'LocalShore Customer Care contacted the shop for an update.'
      WHEN 'resolve' THEN 'LocalShore Customer Care marked this case resolved.'
      WHEN 'cancel' THEN 'LocalShore Customer Care closed this case.'
      ELSE 'LocalShore Customer Care reopened this case.' END);
  INSERT INTO public.support_case_events(ticket_id, actor_id, actor_role, action, from_stage, to_stage, note)
  VALUES (p_ticket_id, v_user_id, 'customer_care', p_action, v_ticket.support_stage, v_stage,
    public.redact_support_contact_details(p_note));
END
$$;

CREATE OR REPLACE FUNCTION public.forward_protected_support_message(p_ticket_id uuid, p_message_id uuid, p_target_role text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_message public.ticket_messages%ROWTYPE;
  v_ticket public.support_tickets%ROWTYPE;
  v_from_stage text;
  v_to_stage text;
BEGIN
  IF v_user_id IS NULL OR NOT public.has_admin_permission('support.manage') THEN
    RAISE EXCEPTION 'You do not have permission to share support messages' USING ERRCODE = '42501';
  END IF;
  IF p_target_role NOT IN ('customer','vendor') THEN RAISE EXCEPTION 'Invalid message recipient' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_message FROM public.ticket_messages WHERE id = p_message_id AND ticket_id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Support message not found'; END IF;
  SELECT * INTO v_ticket FROM public.support_tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Support case not found'; END IF;
  IF p_target_role = 'customer' THEN
    IF v_message.sender_role NOT IN ('vendor','delivery_partner') THEN RAISE EXCEPTION 'Only a shop or delivery message can be shared with the customer'; END IF;
    UPDATE public.ticket_messages SET visible_to_customer = true WHERE id = p_message_id;
    v_to_stage := CASE WHEN v_ticket.support_stage = 'RESOLUTION_PROPOSED' THEN 'CUSTOMER_CONFIRMATION' ELSE v_ticket.support_stage END;
  ELSE
    IF v_ticket.vendor_id IS NULL OR v_message.sender_role <> 'customer' THEN RAISE EXCEPTION 'Only a customer message for a linked shop can be shared'; END IF;
    UPDATE public.ticket_messages SET visible_to_vendor = true WHERE id = p_message_id;
    v_to_stage := CASE WHEN v_ticket.support_stage IN ('OPEN','CUSTOMER_RESPONDED') THEN 'WAITING_FOR_VENDOR' ELSE v_ticket.support_stage END;
  END IF;
  IF v_to_stage <> v_ticket.support_stage THEN
    UPDATE public.support_tickets SET support_stage = v_to_stage,
      response_due_at = CASE WHEN v_to_stage = 'WAITING_FOR_VENDOR' THEN now() + interval '4 hours' ELSE response_due_at END,
      updated_at = now() WHERE id = p_ticket_id;
  END IF;
  v_from_stage := v_ticket.support_stage;
  INSERT INTO public.support_case_events(ticket_id, actor_id, actor_role, action, from_stage, to_stage, note)
  VALUES (p_ticket_id, v_user_id, 'customer_care', 'message_forwarded_to_' || p_target_role,
    v_from_stage, v_to_stage, 'Message shared by LocalShore Customer Care.');
END
$$;

CREATE OR REPLACE FUNCTION public.send_protected_support_message(p_ticket_id uuid, p_body text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_role text;
  v_user_id uuid := auth.uid();
  v_stage text;
  v_message_id uuid;
  v_ticket public.support_tickets%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000'; END IF;
  SELECT * INTO v_ticket FROM public.support_tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Support case not found'; END IF;
  IF public.has_admin_permission('support.manage') THEN v_role := 'customer_care';
  ELSIF v_ticket.user_id = v_user_id THEN v_role := 'customer';
  ELSIF EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = v_ticket.vendor_id AND s.user_id = v_user_id) THEN v_role := 'vendor';
  ELSIF EXISTS (SELECT 1 FROM public.delivery_partners dp WHERE dp.id = v_ticket.delivery_partner_id AND dp.user_id = v_user_id) THEN v_role := 'delivery_partner';
  ELSE RAISE EXCEPTION 'Support case not found or access denied' USING ERRCODE = '42501'; END IF;
  IF v_ticket.status IN ('resolved','closed') OR v_ticket.support_stage IN ('RESOLVED','CANCELLED') THEN RAISE EXCEPTION 'This support case is closed'; END IF;
  IF length(trim(COALESCE(p_body,''))) < 1 OR length(p_body) > 2000 THEN RAISE EXCEPTION 'Message is empty or too long' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.ticket_messages(ticket_id, author_id, is_admin, sender_role, body, visible_to_customer, visible_to_vendor)
  VALUES (p_ticket_id, v_user_id, v_role = 'customer_care', v_role,
    public.redact_support_contact_details(trim(p_body)),
    v_role IN ('customer','customer_care'), v_role IN ('vendor','delivery_partner','customer_care'))
  RETURNING id INTO v_message_id;
  v_stage := CASE v_role WHEN 'customer' THEN 'CUSTOMER_RESPONDED' WHEN 'vendor' THEN 'VENDOR_RESPONDED'
    WHEN 'delivery_partner' THEN 'VENDOR_RESPONDED'
    ELSE CASE WHEN v_ticket.support_stage = 'WAITING_FOR_VENDOR' THEN 'UNDER_REVIEW' ELSE v_ticket.support_stage END END;
  IF v_stage = 'UNDER_REVIEW' THEN v_stage := 'under_review'; END IF;
  UPDATE public.support_tickets SET support_stage = v_stage, status = 'pending', updated_at = now() WHERE id = p_ticket_id;
  INSERT INTO public.support_case_events(ticket_id, actor_id, actor_role, action, from_stage, to_stage)
  VALUES (p_ticket_id, v_user_id, v_role, 'message_sent', v_ticket.support_stage, v_stage);
  RETURN v_message_id;
END
$$;

REVOKE ALL ON FUNCTION public.is_protected_support_participant(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_protected_support_cases() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_get_protected_support_messages(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.manage_protected_support_case(uuid,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.forward_protected_support_message(uuid,uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.send_protected_support_message(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_protected_support_participant(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_protected_support_cases() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_protected_support_messages(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.manage_protected_support_case(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.forward_protected_support_message(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_protected_support_message(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.resolve_delivery_exception(_exception_id uuid, _status text, _note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE e public.delivery_exceptions%ROWTYPE;
BEGIN
  IF NOT public.has_admin_permission('dispatch.manage') THEN
    RAISE EXCEPTION 'You do not have permission to resolve dispatch exceptions' USING ERRCODE = '42501';
  END IF;
  IF _status NOT IN ('in_review','resolved','dismissed') THEN RAISE EXCEPTION 'Invalid resolution status' USING ERRCODE = '22023'; END IF;
  UPDATE public.delivery_exceptions SET resolution_status = _status,
    resolution_note = nullif(trim(_note), ''), resolved_by = auth.uid(),
    resolved_at = CASE WHEN _status IN ('resolved','dismissed') THEN now() ELSE NULL END, updated_at = now()
  WHERE id = _exception_id RETURNING * INTO e;
  IF e.id IS NULL THEN RAISE EXCEPTION 'Exception not found'; END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.admin_reassign_delivery(_assignment_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.delivery_assignments%ROWTYPE; next_assignment uuid;
BEGIN
  IF NOT public.has_admin_permission('dispatch.manage') THEN
    RAISE EXCEPTION 'You do not have permission to reassign deliveries' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO a FROM public.delivery_assignments WHERE id = _assignment_id FOR UPDATE;
  IF a.id IS NULL OR a.status IN ('delivered','cancelled','rejected','expired','reassigned') THEN
    RAISE EXCEPTION 'Assignment cannot be reassigned' USING ERRCODE = '22023';
  END IF;
  UPDATE public.delivery_assignments SET status = 'reassigned', updated_at = now() WHERE id = a.id;
  INSERT INTO public.delivery_tracking(assignment_id, status, note)
  VALUES (a.id, 'reassigned', 'Admin reassigned delivery');
  UPDATE public.orders SET assigned_partner_id = NULL,
    status = CASE WHEN status::text IN ('out_for_delivery','picked_up','assigned')
      THEN 'ready_for_pickup'::public.order_status ELSE status END,
    updated_at = now() WHERE id = a.order_id;
  next_assignment := public.dispatch_delivery_for_order_internal(a.order_id, 60);
  RETURN COALESCE(next_assignment::text, 'Reassignment queued for available candidates');
END
$$;
REVOKE ALL ON FUNCTION public.resolve_delivery_exception(uuid,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_reassign_delivery(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_delivery_exception(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reassign_delivery(uuid) TO authenticated;

-- Mapping-specific authorization is also checked by the database workflow RPCs.
CREATE POLICY "RBAC admins read delivery exceptions" ON public.delivery_exceptions
  FOR SELECT TO authenticated USING (public.has_admin_permission('dispatch.view'));

-- Admin broadcasts and outbox are notification workflows, not general settings.
DROP POLICY IF EXISTS "Admins manage broadcasts" ON public.admin_broadcasts;
CREATE POLICY "RBAC admins read broadcasts" ON public.admin_broadcasts
  FOR SELECT TO authenticated USING (public.has_admin_permission('notifications.view'));
CREATE POLICY "RBAC admins create broadcasts" ON public.admin_broadcasts
  FOR INSERT TO authenticated WITH CHECK (public.has_admin_permission('notifications.manage') AND sent_by = auth.uid());
DROP POLICY IF EXISTS "Admins manage notification outbox" ON public.notification_outbox;
CREATE POLICY "RBAC admins read notification outbox" ON public.notification_outbox
  FOR SELECT TO authenticated USING (public.has_admin_permission('notifications.view'));

-- Dispatch read access is restricted to dispatch operators; customer, seller,
-- and rider participant policies continue to apply independently.
CREATE POLICY "RBAC admins read dispatch assignments" ON public.delivery_assignments
  FOR SELECT TO authenticated USING (public.has_admin_permission('dispatch.view'));
CREATE POLICY "RBAC admins read dispatch tracking" ON public.delivery_tracking
  FOR SELECT TO authenticated USING (public.has_admin_permission('dispatch.view'));
CREATE POLICY "RBAC admins read dispatch exceptions" ON public.delivery_exceptions
  FOR SELECT TO authenticated USING (public.has_admin_permission('dispatch.view'));
CREATE POLICY "RBAC admins resolve dispatch exceptions" ON public.delivery_exceptions
  FOR UPDATE TO authenticated USING (public.has_admin_permission('dispatch.manage'))
  WITH CHECK (public.has_admin_permission('dispatch.manage'));
CREATE POLICY "RBAC admins read dispatch partners" ON public.delivery_partners
  FOR SELECT TO authenticated USING (public.has_admin_permission('dispatch.view'));
CREATE POLICY "RBAC admins read dispatch earnings" ON public.delivery_earnings
  FOR SELECT TO authenticated USING (public.has_admin_permission('dispatch.view'));

-- Search merchandising and dynamic filters.
-- These catalog/search enhancements are optional across deployed projects.
-- Guard every reference dynamically so an older schema can still receive the
-- core RBAC policy update without manufacturing unrelated feature tables.
DO $rbac_optional_search_tables$
BEGIN
  IF to_regclass('public.search_synonyms') IS NOT NULL THEN
    EXECUTE $policy$DROP POLICY IF EXISTS "Admins manage search synonyms" ON public.search_synonyms$policy$;
    EXECUTE $policy$CREATE POLICY "RBAC admins read search synonyms" ON public.search_synonyms
      FOR SELECT TO authenticated USING (public.has_admin_permission('promotions.view'))$policy$;
    EXECUTE $policy$CREATE POLICY "RBAC admins insert search synonyms" ON public.search_synonyms
      FOR INSERT TO authenticated WITH CHECK (public.has_admin_permission('promotions.manage'))$policy$;
    EXECUTE $policy$CREATE POLICY "RBAC admins update search synonyms" ON public.search_synonyms
      FOR UPDATE TO authenticated USING (public.has_admin_permission('promotions.manage'))
      WITH CHECK (public.has_admin_permission('promotions.manage'))$policy$;
  END IF;

  IF to_regclass('public.filter_definitions') IS NOT NULL THEN
    EXECUTE $policy$DROP POLICY IF EXISTS "Admins manage filter definitions" ON public.filter_definitions$policy$;
    EXECUTE $policy$CREATE POLICY "RBAC admins read inactive filter definitions" ON public.filter_definitions
      FOR SELECT TO authenticated USING (public.has_admin_permission('categories.view'))$policy$;
    EXECUTE $policy$CREATE POLICY "RBAC admins insert filter definitions" ON public.filter_definitions
      FOR INSERT TO authenticated WITH CHECK (public.has_admin_permission('categories.manage'))$policy$;
    EXECUTE $policy$CREATE POLICY "RBAC admins update filter definitions" ON public.filter_definitions
      FOR UPDATE TO authenticated USING (public.has_admin_permission('categories.manage'))
      WITH CHECK (public.has_admin_permission('categories.manage'))$policy$;
  END IF;

  IF to_regclass('public.filter_options') IS NOT NULL THEN
    EXECUTE $policy$DROP POLICY IF EXISTS "Admins manage filter options" ON public.filter_options$policy$;
    EXECUTE $policy$CREATE POLICY "RBAC admins read inactive filter options" ON public.filter_options
      FOR SELECT TO authenticated USING (public.has_admin_permission('categories.view'))$policy$;
    EXECUTE $policy$CREATE POLICY "RBAC admins insert filter options" ON public.filter_options
      FOR INSERT TO authenticated WITH CHECK (public.has_admin_permission('categories.manage'))$policy$;
    EXECUTE $policy$CREATE POLICY "RBAC admins update filter options" ON public.filter_options
      FOR UPDATE TO authenticated USING (public.has_admin_permission('categories.manage'))
      WITH CHECK (public.has_admin_permission('categories.manage'))$policy$;
  END IF;
END
$rbac_optional_search_tables$;
DROP POLICY IF EXISTS "Admins manage featured brands" ON public.featured_brands;
DROP POLICY IF EXISTS "Admins manage gift collections" ON public.gift_collections;
DROP POLICY IF EXISTS "Admins manage gift collection products" ON public.gift_collection_products;
DROP POLICY IF EXISTS "Admins manage seasonal collections" ON public.seasonal_collections;
DROP POLICY IF EXISTS "Admins manage seasonal collection products" ON public.seasonal_collection_products;
DROP POLICY IF EXISTS "Admins manage flash sales" ON public.flash_sales;
DROP POLICY IF EXISTS "Admins manage flash sale products" ON public.flash_sale_products;
DROP POLICY IF EXISTS "Admins manage coupon usage" ON public.coupon_usages;
CREATE POLICY "RBAC admins manage featured brands" ON public.featured_brands
  FOR SELECT TO authenticated USING (public.has_admin_permission('promotions.view'));
CREATE POLICY "RBAC admins insert featured brands" ON public.featured_brands
  FOR INSERT TO authenticated WITH CHECK (public.has_admin_permission('promotions.manage'));
CREATE POLICY "RBAC admins update featured brands" ON public.featured_brands
  FOR UPDATE TO authenticated USING (public.has_admin_permission('promotions.manage')) WITH CHECK (public.has_admin_permission('promotions.manage'));
CREATE POLICY "RBAC admins manage gift collections" ON public.gift_collections
  FOR SELECT TO authenticated USING (public.has_admin_permission('promotions.view'));
CREATE POLICY "RBAC admins insert gift collections" ON public.gift_collections
  FOR INSERT TO authenticated WITH CHECK (public.has_admin_permission('promotions.manage'));
CREATE POLICY "RBAC admins update gift collections" ON public.gift_collections
  FOR UPDATE TO authenticated USING (public.has_admin_permission('promotions.manage')) WITH CHECK (public.has_admin_permission('promotions.manage'));
CREATE POLICY "RBAC admins manage gift collection products" ON public.gift_collection_products
  FOR SELECT TO authenticated USING (public.has_admin_permission('promotions.view'));
CREATE POLICY "RBAC admins insert gift collection products" ON public.gift_collection_products
  FOR INSERT TO authenticated WITH CHECK (public.has_admin_permission('promotions.manage'));
CREATE POLICY "RBAC admins update gift collection products" ON public.gift_collection_products
  FOR UPDATE TO authenticated USING (public.has_admin_permission('promotions.manage')) WITH CHECK (public.has_admin_permission('promotions.manage'));
CREATE POLICY "RBAC admins manage seasonal collections" ON public.seasonal_collections
  FOR SELECT TO authenticated USING (public.has_admin_permission('promotions.view'));
CREATE POLICY "RBAC admins insert seasonal collections" ON public.seasonal_collections
  FOR INSERT TO authenticated WITH CHECK (public.has_admin_permission('promotions.manage'));
CREATE POLICY "RBAC admins update seasonal collections" ON public.seasonal_collections
  FOR UPDATE TO authenticated USING (public.has_admin_permission('promotions.manage')) WITH CHECK (public.has_admin_permission('promotions.manage'));
CREATE POLICY "RBAC admins manage seasonal collection products" ON public.seasonal_collection_products
  FOR SELECT TO authenticated USING (public.has_admin_permission('promotions.view'));
CREATE POLICY "RBAC admins insert seasonal collection products" ON public.seasonal_collection_products
  FOR INSERT TO authenticated WITH CHECK (public.has_admin_permission('promotions.manage'));
CREATE POLICY "RBAC admins update seasonal collection products" ON public.seasonal_collection_products
  FOR UPDATE TO authenticated USING (public.has_admin_permission('promotions.manage')) WITH CHECK (public.has_admin_permission('promotions.manage'));
CREATE POLICY "RBAC admins manage flash sales" ON public.flash_sales
  FOR SELECT TO authenticated USING (public.has_admin_permission('promotions.view'));
CREATE POLICY "RBAC admins insert flash sales" ON public.flash_sales
  FOR INSERT TO authenticated WITH CHECK (public.has_admin_permission('promotions.manage'));
CREATE POLICY "RBAC admins update flash sales" ON public.flash_sales
  FOR UPDATE TO authenticated USING (public.has_admin_permission('promotions.manage')) WITH CHECK (public.has_admin_permission('promotions.manage'));
CREATE POLICY "RBAC admins manage flash sale products" ON public.flash_sale_products
  FOR SELECT TO authenticated USING (public.has_admin_permission('promotions.view'));
CREATE POLICY "RBAC admins insert flash sale products" ON public.flash_sale_products
  FOR INSERT TO authenticated WITH CHECK (public.has_admin_permission('promotions.manage'));
CREATE POLICY "RBAC admins update flash sale products" ON public.flash_sale_products
  FOR UPDATE TO authenticated USING (public.has_admin_permission('promotions.manage')) WITH CHECK (public.has_admin_permission('promotions.manage'));
CREATE POLICY "RBAC admins read coupon usage" ON public.coupon_usages
  FOR SELECT TO authenticated USING (public.has_admin_permission('promotions.view'));

-- Storage management remains owner-scoped; admins only receive read access
-- needed by product moderation and seller onboarding review.
DROP POLICY IF EXISTS "Admins read all product images" ON storage.objects;
DROP POLICY IF EXISTS "Admins read all seller docs" ON storage.objects;
DROP POLICY IF EXISTS "Admins insert banner images" ON storage.objects;
DROP POLICY IF EXISTS "Admins update banner images" ON storage.objects;
DROP POLICY IF EXISTS "Admins delete banner images" ON storage.objects;
CREATE POLICY "RBAC admins read product images" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'product-images' AND public.has_admin_permission('products.view'));
CREATE POLICY "RBAC admins read seller docs" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'seller-docs' AND public.has_admin_permission('sellers.view'));
CREATE POLICY "RBAC admins insert banner images" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'banner-images' AND public.has_admin_permission('promotions.manage'));
CREATE POLICY "RBAC admins update banner images" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'banner-images' AND public.has_admin_permission('promotions.manage'))
  WITH CHECK (bucket_id = 'banner-images' AND public.has_admin_permission('promotions.manage'));

-- Admin assignment changes are RPC-only; direct audit writes and mutation remain revoked.
REVOKE INSERT, UPDATE, DELETE ON public.admin_access_assignments FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.admin_audit_logs FROM authenticated, anon;

COMMIT;
