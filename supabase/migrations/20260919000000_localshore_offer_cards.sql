-- Admin-controlled cards shown in the LocalShore Specials section.
CREATE TABLE public.localshore_offer_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  validity TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL DEFAULT 'Explore shops',
  category TEXT NOT NULL DEFAULT 'all-shops',
  image_url TEXT NOT NULL,
  accent TEXT NOT NULL DEFAULT '#7c3aed',
  coupon TEXT NOT NULL DEFAULT '',
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.localshore_offer_cards TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.localshore_offer_cards TO authenticated;
GRANT ALL ON public.localshore_offer_cards TO service_role;
ALTER TABLE public.localshore_offer_cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone views active LocalShore offers"
  ON public.localshore_offer_cards FOR SELECT
  USING (is_active OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage LocalShore offers"
  ON public.localshore_offer_cards FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_localshore_offer_cards_updated
  BEFORE UPDATE ON public.localshore_offer_cards
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.localshore_offer_cards
  (title, description, validity, action, category, image_url, accent, coupon, sort_order)
VALUES
  ('Up to 40% Off\nat Local Shops', 'Support local. Shop local. Save more.', 'Valid till 31 Dec', 'Explore shops', 'all-shops', '/marketplace-ads/groceries-hero.png', '#7c3aed', 'LOCAL40', 0),
  ('Fresh Groceries\nat Best Prices', 'Daily essentials, better value.', 'Fresh picks nearby', 'Shop groceries', 'grocery', '/marketplace-ads/groceries-hero.png', '#16a34a', 'FRESH20', 1),
  ('Restaurant Offers\nYou’ll Love', 'Great food. Great local vibes.', 'Valid till 31 Dec', 'Order now', 'restaurants', 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&w=420&q=80', '#8b5cf6', 'DINE100', 2),
  ('Trendy Fashion\nUp to 50% Off', 'Look good. Feel local.', 'Valid till 31 Dec', 'Shop fashion', 'fashion', 'https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=420&q=80', '#ec4899', 'STYLE50', 3);
