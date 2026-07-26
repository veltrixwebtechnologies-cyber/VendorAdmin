-- Additive marketplace merchandising and customer-feature schema.
-- Existing products, brands, categories, orders, order_items, coupons and reviews are reused.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS brand_id uuid REFERENCES public.brands(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS discount_price numeric(10,2),
  ADD COLUMN IF NOT EXISTS discount_starts_at timestamptz,
  ADD COLUMN IF NOT EXISTS discount_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS clearance boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS weight text,
  ADD COLUMN IF NOT EXISTS specifications jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS products_merchandising_idx ON public.products(status, clearance, created_at DESC);
CREATE INDEX IF NOT EXISTS products_discount_idx ON public.products(discount_starts_at, discount_ends_at)
  WHERE discount_price IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.wishlist (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, product_id)
);
ALTER TABLE public.wishlist ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON public.wishlist TO authenticated;
DROP POLICY IF EXISTS "Users manage own wishlist" ON public.wishlist;
CREATE POLICY "Users manage own wishlist" ON public.wishlist FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.recently_viewed (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, product_id)
);
ALTER TABLE public.recently_viewed ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recently_viewed TO authenticated;
DROP POLICY IF EXISTS "Users manage own recently viewed" ON public.recently_viewed;
CREATE POLICY "Users manage own recently viewed" ON public.recently_viewed FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.product_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id text,
  event_type text NOT NULL DEFAULT 'view' CHECK (event_type IN ('view','add_to_cart','wishlist')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_views_product_event_idx ON public.product_views(product_id, event_type, created_at DESC);
ALTER TABLE public.product_views ENABLE ROW LEVEL SECURITY;
GRANT INSERT ON public.product_views TO anon, authenticated;
GRANT SELECT ON public.product_views TO authenticated;
DROP POLICY IF EXISTS "Public records product engagement" ON public.product_views;
CREATE POLICY "Public records product engagement" ON public.product_views FOR INSERT TO anon, authenticated
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());
DROP POLICY IF EXISTS "Users read own product engagement" ON public.product_views;
CREATE POLICY "Users read own product engagement" ON public.product_views FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR private.has_role(auth.uid(), 'admin'::public.app_role));

CREATE TABLE IF NOT EXISTS public.featured_brands (
  brand_id uuid PRIMARY KEY REFERENCES public.brands(id) ON DELETE CASCADE,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.featured_brands ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.featured_brands TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.featured_brands TO authenticated;
CREATE POLICY "Anyone views featured brands" ON public.featured_brands FOR SELECT USING (true);
CREATE POLICY "Admins manage featured brands" ON public.featured_brands FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

CREATE TABLE IF NOT EXISTS public.gift_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text,
  image_url text,
  is_active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.gift_collection_products (
  collection_id uuid NOT NULL REFERENCES public.gift_collections(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  PRIMARY KEY (collection_id, product_id)
);
ALTER TABLE public.gift_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gift_collection_products ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.gift_collections, public.gift_collection_products TO anon, authenticated;
GRANT ALL ON public.gift_collections, public.gift_collection_products TO authenticated;
CREATE POLICY "Anyone views active gift collections" ON public.gift_collections FOR SELECT USING (is_active OR private.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "Anyone views gift collection products" ON public.gift_collection_products FOR SELECT USING (true);
CREATE POLICY "Admins manage gift collections" ON public.gift_collections FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "Admins manage gift collection products" ON public.gift_collection_products FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

CREATE TABLE IF NOT EXISTS public.seasonal_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text,
  image_url text,
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.seasonal_collection_products (
  collection_id uuid NOT NULL REFERENCES public.seasonal_collections(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  PRIMARY KEY (collection_id, product_id)
);
ALTER TABLE public.seasonal_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seasonal_collection_products ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.seasonal_collections, public.seasonal_collection_products TO anon, authenticated;
GRANT ALL ON public.seasonal_collections, public.seasonal_collection_products TO authenticated;
DROP POLICY IF EXISTS "Anyone views active seasonal collections" ON public.seasonal_collections;
CREATE POLICY "Anyone views active seasonal collections" ON public.seasonal_collections FOR SELECT USING (
  (is_active AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at > now()))
  OR private.has_role(auth.uid(), 'admin'::public.app_role)
);
CREATE POLICY "Anyone views seasonal collection products" ON public.seasonal_collection_products FOR SELECT USING (true);
CREATE POLICY "Admins manage seasonal collections" ON public.seasonal_collections FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "Admins manage seasonal collection products" ON public.seasonal_collection_products FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

CREATE TABLE IF NOT EXISTS public.flash_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  discount_type text NOT NULL CHECK (discount_type IN ('percent','flat')),
  discount_value numeric(10,2) NOT NULL CHECK (discount_value >= 0),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE TABLE IF NOT EXISTS public.flash_sale_products (
  flash_sale_id uuid NOT NULL REFERENCES public.flash_sales(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  PRIMARY KEY (flash_sale_id, product_id)
);
ALTER TABLE public.flash_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flash_sale_products ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.flash_sales, public.flash_sale_products TO anon, authenticated;
GRANT ALL ON public.flash_sales, public.flash_sale_products TO authenticated;
DROP POLICY IF EXISTS "Anyone views active flash sales" ON public.flash_sales;
CREATE POLICY "Anyone views active flash sales" ON public.flash_sales FOR SELECT USING (
  (is_active AND starts_at <= now() AND ends_at > now()) OR private.has_role(auth.uid(), 'admin'::public.app_role)
);
CREATE POLICY "Anyone views flash sale products" ON public.flash_sale_products FOR SELECT USING (true);
CREATE POLICY "Admins manage flash sales" ON public.flash_sales FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "Admins manage flash sale products" ON public.flash_sale_products FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS vendor_id uuid REFERENCES public.sellers(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.categories(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS first_order_only boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS per_user_limit integer;
DROP POLICY IF EXISTS "Anyone views active coupons" ON public.coupons;
CREATE POLICY "Anyone views active coupons" ON public.coupons FOR SELECT USING (
  (is_active AND (starts_at IS NULL OR starts_at <= now()) AND (expires_at IS NULL OR expires_at > now()))
  OR private.has_role(auth.uid(), 'admin'::public.app_role)
);
CREATE TABLE IF NOT EXISTS public.coupon_usages (
  coupon_id uuid NOT NULL REFERENCES public.coupons(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  used_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (coupon_id, user_id)
);
ALTER TABLE public.coupon_usages ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.coupon_usages TO authenticated;
CREATE POLICY "Users read own coupon usage" ON public.coupon_usages FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users create own coupon usage" ON public.coupon_usages FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Admins manage coupon usage" ON public.coupon_usages FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

CREATE TABLE IF NOT EXISTS public.product_comparisons (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, product_id)
);
ALTER TABLE public.product_comparisons ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON public.product_comparisons TO authenticated;
CREATE POLICY "Users manage own comparisons" ON public.product_comparisons FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS image_urls text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS verified_purchase boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS reviews_one_per_user_product_idx ON public.reviews(user_id, product_id)
  WHERE user_id IS NOT NULL AND product_id IS NOT NULL;

DROP POLICY IF EXISTS "Users create own reviews" ON public.reviews;
CREATE POLICY "Verified buyers create own reviews" ON public.reviews FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid() AND EXISTS (
      SELECT 1 FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
      WHERE oi.product_id = reviews.product_id
        AND o.user_id = auth.uid()
        AND o.status::text IN ('delivered', 'completed')
    )
  );

CREATE OR REPLACE FUNCTION public.mark_verified_review()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  NEW.verified_purchase := EXISTS (
    SELECT 1 FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE oi.product_id = NEW.product_id
      AND o.user_id = NEW.user_id
      AND o.status::text IN ('delivered', 'completed')
  );
  IF NOT NEW.verified_purchase THEN
    RAISE EXCEPTION 'Only verified purchasers can review products';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS reviews_verified_purchase_trigger ON public.reviews;
CREATE TRIGGER reviews_verified_purchase_trigger
  BEFORE INSERT OR UPDATE OF user_id, product_id ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.mark_verified_review();

DROP VIEW IF EXISTS public.public_merchandising_products;
CREATE VIEW public.public_merchandising_products AS
SELECT
  p.id, p.seller_id, p.name, p.sku, p.brand, p.brand_id, p.category, p.description,
  p.mrp, p.selling_price, p.stock, p.image_url, p.images, p.created_at,
  p.discount_price, p.discount_starts_at, p.discount_ends_at, p.clearance,
  p.weight, p.specifications,
  COALESCE(NULLIF(b.name, ''), p.brand) AS brand_name,
  COALESCE(avg(r.rating), 0)::numeric(4,2) AS average_rating,
  count(r.id)::integer AS review_count,
  COALESCE(NULLIF(s.business_name, ''), s.full_name, s.email, 'Local vendor') AS shop_name
FROM public.products p
JOIN public.sellers s ON s.id = p.seller_id AND s.status::text = 'approved'
LEFT JOIN public.brands b ON b.id = p.brand_id
LEFT JOIN public.reviews r ON r.product_id = p.id AND r.status = 'approved'
WHERE p.status::text IN ('active','approved') AND p.stock > 0
GROUP BY p.id, b.name, s.business_name, s.full_name, s.email;
GRANT SELECT ON public.public_merchandising_products TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_best_sellers(p_period text DEFAULT 'all_time')
RETURNS TABLE(product_id uuid, quantity_sold bigint, average_rating numeric, review_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT oi.product_id, sum(oi.qty)::bigint, COALESCE(avg(r.rating),0)::numeric(4,2), count(r.id)::bigint
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id AND o.status::text IN ('delivered','completed')
  JOIN public.products p ON p.id = oi.product_id
  JOIN public.sellers s ON s.id = p.seller_id AND s.status::text = 'approved'
  LEFT JOIN public.reviews r ON r.product_id = p.id AND r.status = 'approved'
  WHERE p.status::text IN ('active','approved') AND p.stock > 0
    AND (p_period = 'all_time' OR
      (p_period = 'today' AND o.created_at >= date_trunc('day', now())) OR
      (p_period = 'this_week' AND o.created_at >= date_trunc('week', now())) OR
      (p_period = 'this_month' AND o.created_at >= date_trunc('month', now())))
  GROUP BY oi.product_id ORDER BY sum(oi.qty) DESC, avg(r.rating) DESC NULLS LAST;
$$;
GRANT EXECUTE ON FUNCTION public.get_best_sellers(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_trending_products(p_limit integer DEFAULT 12)
RETURNS TABLE(product_id uuid, trending_score numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.id,
    (count(*) FILTER (WHERE v.event_type = 'view') * 1.0 +
     count(*) FILTER (WHERE v.event_type = 'add_to_cart') * 4.0 +
     count(*) FILTER (WHERE v.event_type = 'wishlist') * 3.0 +
     COALESCE((SELECT sum(oi.qty) FROM public.order_items oi JOIN public.orders o ON o.id=oi.order_id
       WHERE oi.product_id=p.id AND o.status::text IN ('delivered','completed')), 0) * 6.0)::numeric AS score
  FROM public.products p
  JOIN public.sellers s ON s.id=p.seller_id AND s.status::text='approved'
  LEFT JOIN public.product_views v ON v.product_id=p.id AND v.created_at >= now() - interval '30 days'
  WHERE p.status::text IN ('active','approved') AND p.stock > 0
  GROUP BY p.id ORDER BY score DESC LIMIT greatest(p_limit, 1);
$$;
GRANT EXECUTE ON FUNCTION public.get_trending_products(integer) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_recent_product_view(p_product_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  INSERT INTO public.recently_viewed(user_id, product_id, viewed_at)
  VALUES (auth.uid(), p_product_id, now())
  ON CONFLICT (user_id, product_id) DO UPDATE SET viewed_at = excluded.viewed_at;
  DELETE FROM public.recently_viewed
  WHERE user_id = auth.uid() AND product_id IN (
    SELECT product_id FROM public.recently_viewed WHERE user_id = auth.uid()
    ORDER BY viewed_at DESC OFFSET 30
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.record_recent_product_view(uuid) TO authenticated;
