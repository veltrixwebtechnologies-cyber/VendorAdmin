-- Enable Realtime subscriptions for products, shop overrides, shop hours, and sellers tables.
-- Safe to rerun: only adds tables if they are not already in the supabase_realtime publication.

DO $$
BEGIN
  IF to_regclass('public.products') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'products'
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.products';
    END IF;
    ALTER TABLE public.products REPLICA IDENTITY FULL;
  END IF;

  IF to_regclass('public.sellers') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'sellers'
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.sellers';
    END IF;
    ALTER TABLE public.sellers REPLICA IDENTITY FULL;
  END IF;

  IF to_regclass('public.shop_overrides') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'shop_overrides'
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.shop_overrides';
    END IF;
    ALTER TABLE public.shop_overrides REPLICA IDENTITY FULL;
  END IF;

  IF to_regclass('public.shop_hours') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'shop_hours'
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.shop_hours';
    END IF;
    ALTER TABLE public.shop_hours REPLICA IDENTITY FULL;
  END IF;
END
$$;
