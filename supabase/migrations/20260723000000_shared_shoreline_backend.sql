-- Shared backend contract for Shoreline Shopper and Seller Hub.
-- Keep the existing `sellers` names used by Seller Hub; compatibility views expose
-- the requested vendor names without copying data between applications.

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'customer';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'vendor';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'ready_for_pickup';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'out_for_delivery';

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'customer'
  CHECK (role IN ('customer', 'vendor', 'admin'));

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name, role)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)), 'customer')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'customer') ON CONFLICT (user_id, role) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.is_approved_vendor(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.sellers WHERE user_id = _user_id AND status = 'approved');
$$;
REVOKE ALL ON FUNCTION private.is_approved_vendor(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_approved_vendor(uuid) TO authenticated;

UPDATE public.profiles p SET role = CASE
  WHEN EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id AND r.role = 'admin') THEN 'admin'
  WHEN EXISTS (SELECT 1 FROM public.sellers s WHERE s.user_id = p.id AND s.status = 'approved') THEN 'vendor'
  ELSE 'customer' END;

CREATE OR REPLACE FUNCTION public.sync_vendor_profile_role()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.profiles SET role = CASE WHEN NEW.status = 'approved' THEN 'vendor' ELSE role END WHERE id = NEW.user_id;
  IF NEW.status = 'approved' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.user_id, 'vendor') ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_sync_vendor_profile_role ON public.sellers;
CREATE TRIGGER trg_sync_vendor_profile_role AFTER INSERT OR UPDATE OF status ON public.sellers
FOR EACH ROW EXECUTE FUNCTION public.sync_vendor_profile_role();

CREATE OR REPLACE VIEW public.vendors AS SELECT * FROM public.sellers;
CREATE OR REPLACE VIEW public.vendor_documents AS SELECT * FROM public.seller_documents;
GRANT SELECT ON public.vendors, public.vendor_documents TO authenticated;

DROP POLICY IF EXISTS "Anyone views active products" ON public.products;
CREATE POLICY "Anyone views approved vendor products" ON public.products FOR SELECT USING (
  status = 'active' AND EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = products.seller_id AND s.status = 'approved')
);

DROP POLICY IF EXISTS "Seller manages own products" ON public.products;
CREATE POLICY "Approved vendors manage own products" ON public.products FOR ALL TO authenticated
  USING (auth.uid() = user_id AND private.is_approved_vendor(auth.uid()))
  WITH CHECK (auth.uid() = user_id AND private.is_approved_vendor(auth.uid()));

DROP POLICY IF EXISTS "Seller manages own orders" ON public.orders;
DROP POLICY IF EXISTS "Seller reads own orders" ON public.orders;
DROP POLICY IF EXISTS "Seller inserts own orders" ON public.orders;
DROP POLICY IF EXISTS "Seller updates own orders" ON public.orders;
CREATE POLICY "Customers read own orders" ON public.orders FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Vendors read store orders" ON public.orders FOR SELECT TO authenticated USING (
  private.is_approved_vendor(auth.uid()) AND EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = orders.seller_id AND s.user_id = auth.uid())
);
CREATE POLICY "Customers create own orders" ON public.orders FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Vendors update store orders" ON public.orders FOR UPDATE TO authenticated
  USING (private.is_approved_vendor(auth.uid()) AND EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = orders.seller_id AND s.user_id = auth.uid()))
  WITH CHECK (private.is_approved_vendor(auth.uid()) AND EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = orders.seller_id AND s.user_id = auth.uid()));

DROP POLICY IF EXISTS "Seller manages own order items" ON public.order_items;
DROP POLICY IF EXISTS "Seller reads own order items" ON public.order_items;
DROP POLICY IF EXISTS "Seller inserts own order items" ON public.order_items;
CREATE POLICY "Order participants read items" ON public.order_items FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_items.order_id AND (
    o.user_id = auth.uid() OR (private.is_approved_vendor(auth.uid()) AND EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = o.seller_id AND s.user_id = auth.uid()))
  ))
);
CREATE POLICY "Customers create own order items" ON public.order_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_items.order_id AND o.user_id = auth.uid()));

INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', false), ('seller-docs', 'seller-docs', false)
ON CONFLICT (id) DO NOTHING;
