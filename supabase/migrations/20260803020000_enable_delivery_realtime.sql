-- Make delivery alerts available through the shared Supabase Realtime channel.
-- Safe to rerun: only adds tables that are not already published.

DO $$
BEGIN
  IF to_regclass('public.delivery_assignments') IS NULL THEN
    RAISE EXCEPTION 'Required table public.delivery_assignments is missing';
  END IF;
  IF to_regclass('public.delivery_notifications') IS NULL THEN
    RAISE EXCEPTION 'Required table public.delivery_notifications is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'delivery_assignments'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.delivery_assignments';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'delivery_notifications'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.delivery_notifications';
  END IF;
END
$$;

ALTER TABLE public.delivery_assignments REPLICA IDENTITY FULL;
ALTER TABLE public.delivery_notifications REPLICA IDENTITY FULL;
