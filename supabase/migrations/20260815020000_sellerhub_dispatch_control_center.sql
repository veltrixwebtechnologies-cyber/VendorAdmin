-- SellerHub dispatch operations: structured exceptions, actor-aware timeline,
-- and an admin-only reassignment primitive. No client-side writes are added.

ALTER TABLE public.delivery_tracking
  ADD COLUMN IF NOT EXISTS actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS actor_role text;

CREATE OR REPLACE FUNCTION public.stamp_delivery_tracking_actor()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.actor_user_id IS NULL THEN NEW.actor_user_id := auth.uid(); END IF;
  IF NEW.actor_role IS NULL THEN
    NEW.actor_role := CASE
      WHEN public.has_role(auth.uid(), 'admin'::public.app_role) THEN 'admin'
      WHEN EXISTS (SELECT 1 FROM public.delivery_assignments a JOIN public.delivery_partners p ON p.id = a.partner_id WHERE a.id = NEW.assignment_id AND p.user_id = auth.uid()) THEN 'rider'
      ELSE 'system'
    END;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_stamp_delivery_tracking_actor ON public.delivery_tracking;
CREATE TRIGGER trg_stamp_delivery_tracking_actor BEFORE INSERT ON public.delivery_tracking
FOR EACH ROW EXECUTE FUNCTION public.stamp_delivery_tracking_actor();

CREATE TABLE IF NOT EXISTS public.delivery_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES public.delivery_assignments(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  partner_id uuid NOT NULL REFERENCES public.delivery_partners(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (reason IN ('customer_unavailable','wrong_address','restaurant_closed','item_unavailable','vehicle_breakdown','weather_issue','delivery_refused','other')),
  notes text,
  photo_path text,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  resolution_status text NOT NULL DEFAULT 'open' CHECK (resolution_status IN ('open','in_review','resolved','dismissed')),
  resolution_note text,
  resolved_by uuid REFERENCES auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS delivery_exceptions_assignment_idx ON public.delivery_exceptions(assignment_id, created_at DESC);
ALTER TABLE public.delivery_exceptions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.delivery_exceptions TO authenticated;
DROP POLICY IF EXISTS "delivery exceptions access" ON public.delivery_exceptions;
CREATE POLICY "delivery exceptions access" ON public.delivery_exceptions FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.is_my_partner(partner_id));
DROP POLICY IF EXISTS "delivery exceptions write" ON public.delivery_exceptions;
CREATE POLICY "delivery exceptions write" ON public.delivery_exceptions FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role) OR (public.is_my_partner(partner_id) AND created_by = auth.uid()));
DROP POLICY IF EXISTS "delivery exceptions resolve" ON public.delivery_exceptions;
CREATE POLICY "delivery exceptions resolve" ON public.delivery_exceptions FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE OR REPLACE FUNCTION public.create_delivery_exception(
  _assignment_id uuid, _reason text, _notes text DEFAULT NULL, _photo_path text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a record; exception_id uuid;
BEGIN
  SELECT * INTO a FROM public.delivery_assignments WHERE id = _assignment_id FOR UPDATE;
  IF a.id IS NULL OR (NOT public.is_my_partner(a.partner_id) AND NOT public.has_role(auth.uid(), 'admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Delivery assignment not found';
  END IF;
  IF a.status IN ('delivered','cancelled','rejected','expired','reassigned') THEN RAISE EXCEPTION 'Delivery is closed'; END IF;
  INSERT INTO public.delivery_exceptions(assignment_id, order_id, partner_id, reason, notes, photo_path, created_by)
  VALUES (a.id, a.order_id, a.partner_id, _reason, nullif(trim(_notes), ''), nullif(trim(_photo_path), ''), auth.uid())
  RETURNING id INTO exception_id;
  INSERT INTO public.delivery_tracking(assignment_id, status, note) VALUES (a.id, 'exception', 'Exception: ' || _reason);
  RETURN exception_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_delivery_exception(uuid,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_delivery_exception(uuid,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.resolve_delivery_exception(
  _exception_id uuid, _status text, _note text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e record;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN RAISE EXCEPTION 'Admin access required'; END IF;
  IF _status NOT IN ('in_review','resolved','dismissed') THEN RAISE EXCEPTION 'Invalid resolution status'; END IF;
  UPDATE public.delivery_exceptions SET resolution_status = _status, resolution_note = nullif(trim(_note), ''), resolved_by = auth.uid(), resolved_at = CASE WHEN _status IN ('resolved','dismissed') THEN now() ELSE NULL END, updated_at = now()
  WHERE id = _exception_id RETURNING * INTO e;
  IF e.id IS NULL THEN RAISE EXCEPTION 'Exception not found'; END IF;
  RETURN e.id;
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_delivery_exception(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_delivery_exception(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_reassign_delivery(_assignment_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a record; next_assignment uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN RAISE EXCEPTION 'Admin access required'; END IF;
  SELECT * INTO a FROM public.delivery_assignments WHERE id = _assignment_id FOR UPDATE;
  IF a.id IS NULL OR a.status IN ('delivered','cancelled','rejected','expired','reassigned') THEN RAISE EXCEPTION 'Assignment cannot be reassigned'; END IF;
  UPDATE public.delivery_assignments SET status = 'reassigned', updated_at = now() WHERE id = a.id;
  INSERT INTO public.delivery_tracking(assignment_id, status, note) VALUES (a.id, 'reassigned', 'Admin reassigned delivery');
  UPDATE public.orders SET assigned_partner_id = NULL, status = CASE WHEN status::text IN ('out_for_delivery','picked_up','assigned') THEN 'ready_for_pickup'::public.order_status ELSE status END, updated_at = now() WHERE id = a.order_id;
  next_assignment := public.dispatch_delivery_for_order_internal(a.order_id, 60);
  RETURN next_assignment;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_reassign_delivery(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reassign_delivery(uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
