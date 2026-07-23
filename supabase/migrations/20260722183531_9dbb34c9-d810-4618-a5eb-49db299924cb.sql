
-- Orders: split ALL policy into SELECT/INSERT/UPDATE; DELETE admin-only
DROP POLICY IF EXISTS "Seller manages own orders" ON public.orders;
CREATE POLICY "Seller reads own orders" ON public.orders
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Seller inserts own orders" ON public.orders
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Seller updates own orders" ON public.orders
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admin deletes orders" ON public.orders
  FOR DELETE TO authenticated USING (private.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admin updates orders" ON public.orders
  FOR UPDATE TO authenticated USING (private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));

-- Order items: SELECT/INSERT for owner; no owner UPDATE/DELETE
DROP POLICY IF EXISTS "Seller manages own order items" ON public.order_items;
CREATE POLICY "Seller reads own order items" ON public.order_items
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Seller inserts own order items" ON public.order_items
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admin updates order items" ON public.order_items
  FOR UPDATE TO authenticated USING (private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admin deletes order items" ON public.order_items
  FOR DELETE TO authenticated USING (private.has_role(auth.uid(), 'admin'::app_role));

-- Settlements: remove seller INSERT, add admin INSERT
DROP POLICY IF EXISTS "Seller inserts own settlements" ON public.settlements;
CREATE POLICY "Admin inserts settlements" ON public.settlements
  FOR INSERT TO authenticated WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));

-- Platform settings: restrict SELECT to admins only
DROP POLICY IF EXISTS "Anyone reads settings" ON public.platform_settings;
CREATE POLICY "Admin reads settings" ON public.platform_settings
  FOR SELECT TO authenticated USING (private.has_role(auth.uid(), 'admin'::app_role));
REVOKE SELECT ON public.platform_settings FROM anon;
