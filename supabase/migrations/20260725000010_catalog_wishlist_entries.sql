-- Wishlist support for catalog products that are not backed by a public.products UUID.
CREATE TABLE IF NOT EXISTS public.wishlist_entries (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_key text NOT NULL,
  product_name text NOT NULL,
  shop_name text NOT NULL,
  category text,
  price numeric(10,2) NOT NULL,
  image_url text,
  seller_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_key)
);

ALTER TABLE public.wishlist_entries ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON public.wishlist_entries TO authenticated;

DROP POLICY IF EXISTS "Users manage own catalog wishlist" ON public.wishlist_entries;
CREATE POLICY "Users manage own catalog wishlist"
ON public.wishlist_entries
FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

ALTER TABLE public.wishlist_entries REPLICA IDENTITY FULL;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.wishlist_entries;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

NOTIFY pgrst, 'reload schema';
