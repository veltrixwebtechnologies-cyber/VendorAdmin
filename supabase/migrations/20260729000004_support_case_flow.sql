-- Guided post-order support cases. The existing support_tickets table remains
-- the source of truth for the customer-care queue.
ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS issue_type text,
  ADD COLUMN IF NOT EXISTS support_stage text NOT NULL DEFAULT 'submitted',
  ADD COLUMN IF NOT EXISTS selected_product_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS evidence_urls text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS video_url text,
  ADD COLUMN IF NOT EXISTS customer_comment text,
  ADD COLUMN IF NOT EXISTS eligible boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS eligibility_reason text,
  ADD COLUMN IF NOT EXISTS decision text,
  ADD COLUMN IF NOT EXISTS refund_amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS replacement_approved boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reporting_deadline timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

ALTER TABLE public.support_tickets
  DROP CONSTRAINT IF EXISTS support_tickets_support_stage_check;
ALTER TABLE public.support_tickets
  ADD CONSTRAINT support_tickets_support_stage_check CHECK (
    support_stage IN (
      'submitted', 'under_review', 'awaiting_shop_response', 'approved',
      'rejected', 'refund_initiated', 'refunded', 'replacement_approved',
      'replacement_delivered'
    )
  );

CREATE INDEX IF NOT EXISTS support_tickets_user_order_idx
  ON public.support_tickets(user_id, order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS support_tickets_stage_idx
  ON public.support_tickets(support_stage, created_at DESC);

CREATE TABLE IF NOT EXISTS public.support_case_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  from_stage text,
  to_stage text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.support_case_events TO authenticated;
GRANT ALL ON public.support_case_events TO service_role;
ALTER TABLE public.support_case_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Customers view own support events" ON public.support_case_events;
CREATE POLICY "Customers view own support events" ON public.support_case_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.support_tickets t
      WHERE t.id = ticket_id AND t.user_id = auth.uid()
    )
    OR private.has_role(auth.uid(), 'admin'::public.app_role)
  );

DROP POLICY IF EXISTS "Vendors view related support cases" ON public.support_tickets;
CREATE POLICY "Vendors view related support cases" ON public.support_tickets
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      JOIN public.sellers s ON s.id = o.seller_id
      WHERE o.id = support_tickets.order_id AND s.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins create support events" ON public.support_case_events;
CREATE POLICY "Admins create support events" ON public.support_case_events
  FOR INSERT TO authenticated
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Vendors view related support messages" ON public.ticket_messages;
CREATE POLICY "Vendors view related support messages" ON public.ticket_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.support_tickets t
      JOIN public.orders o ON o.id = t.order_id
      JOIN public.sellers s ON s.id = o.seller_id
      WHERE t.id = ticket_id AND s.user_id = auth.uid()
    )
    OR private.has_role(auth.uid(), 'admin'::public.app_role)
  );

DROP POLICY IF EXISTS "Vendors add related support messages" ON public.ticket_messages;
CREATE POLICY "Vendors add related support messages" ON public.ticket_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = author_id AND EXISTS (
      SELECT 1 FROM public.support_tickets t
      JOIN public.orders o ON o.id = t.order_id
      JOIN public.sellers s ON s.id = o.seller_id
      WHERE t.id = ticket_id AND s.user_id = auth.uid()
    )
  );

INSERT INTO storage.buckets (id, name, public)
VALUES ('support-evidence', 'support-evidence', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "Customers upload support evidence" ON storage.objects;
CREATE POLICY "Customers upload support evidence" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'support-evidence'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Owners and admins view support evidence" ON storage.objects;
CREATE POLICY "Owners and admins view support evidence" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'support-evidence'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR private.has_role(auth.uid(), 'admin'::public.app_role)
    )
  );

DROP POLICY IF EXISTS "Owners delete support evidence" ON storage.objects;
CREATE POLICY "Owners delete support evidence" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'support-evidence'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
