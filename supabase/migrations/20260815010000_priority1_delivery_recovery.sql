-- Priority 1 delivery recovery and safety primitives. These extend the
-- existing assignment/tracking model; no duplicate order workflow is added.

CREATE TABLE IF NOT EXISTS public.delivery_contact_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES public.delivery_assignments(id) ON DELETE CASCADE,
  partner_id uuid NOT NULL REFERENCES public.delivery_partners(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('call_attempt', 'mark_unreachable', 'escalate')),
  attempt_number integer NOT NULL DEFAULT 1 CHECK (attempt_number > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS delivery_contact_attempts_assignment_idx
  ON public.delivery_contact_attempts (assignment_id, created_at DESC);
ALTER TABLE public.delivery_contact_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.delivery_contact_attempts FROM anon, authenticated;
GRANT SELECT ON public.delivery_contact_attempts TO authenticated;
DROP POLICY IF EXISTS "partners read own contact attempts" ON public.delivery_contact_attempts;
CREATE POLICY "partners read own contact attempts" ON public.delivery_contact_attempts
  FOR SELECT TO authenticated USING (public.is_my_partner(partner_id));

CREATE OR REPLACE FUNCTION public.record_delivery_contact_attempt(
  _assignment_id uuid,
  _action text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  a record;
  attempts integer;
BEGIN
  SELECT * INTO a FROM public.delivery_assignments WHERE id = _assignment_id FOR UPDATE;
  IF a.id IS NULL OR NOT public.is_my_partner(a.partner_id) THEN
    RAISE EXCEPTION 'Delivery assignment not found';
  END IF;
  IF a.status NOT IN ('accepted', 'navigating_to_vendor', 'reached_vendor', 'picked_up', 'out_for_delivery') THEN
    RAISE EXCEPTION 'Contact is available only for active deliveries';
  END IF;
  IF _action NOT IN ('call_attempt', 'mark_unreachable', 'escalate') THEN
    RAISE EXCEPTION 'Invalid contact action';
  END IF;

  SELECT count(*)::integer INTO attempts
  FROM public.delivery_contact_attempts
  WHERE assignment_id = a.id AND action = 'call_attempt';

  IF _action IN ('mark_unreachable', 'escalate') AND attempts < 1 THEN
    RAISE EXCEPTION 'Record at least one call attempt first';
  END IF;

  INSERT INTO public.delivery_contact_attempts(assignment_id, partner_id, action, attempt_number)
  VALUES (a.id, a.partner_id, _action, attempts + CASE WHEN _action = 'call_attempt' THEN 1 ELSE 0 END);

  INSERT INTO public.delivery_tracking(assignment_id, status, note)
  VALUES (a.id, a.status, CASE _action
    WHEN 'call_attempt' THEN format('Customer contact attempt %s', attempts + 1)
    WHEN 'mark_unreachable' THEN 'Customer marked unreachable after waiting period'
    ELSE 'Customer unreachable escalated to support'
  END);

  RETURN jsonb_build_object(
    'attempts', attempts + CASE WHEN _action = 'call_attempt' THEN 1 ELSE 0 END,
    'wait_until', now() + interval '5 minutes',
    'action', _action
  );
END;
$$;
REVOKE ALL ON FUNCTION public.record_delivery_contact_attempt(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_delivery_contact_attempt(uuid, text) TO authenticated;

-- Going offline releases only pre-pickup work. Once an order is picked up it
-- remains assigned and is escalated instead of silently losing the parcel.
CREATE OR REPLACE FUNCTION public.partner_go_offline()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  p record;
  a record;
  released integer := 0;
  retained integer := 0;
BEGIN
  SELECT * INTO p FROM public.delivery_partners WHERE user_id = auth.uid() FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'Delivery partner profile not found'; END IF;

  UPDATE public.delivery_partners SET availability = 'offline', updated_at = now() WHERE id = p.id;
  FOR a IN
    SELECT da.id, da.order_id
    FROM public.delivery_assignments da
    WHERE da.partner_id = p.id
      AND da.status IN ('accepted', 'navigating_to_vendor', 'reached_vendor')
    FOR UPDATE
  LOOP
    UPDATE public.delivery_assignments
    SET status = 'cancelled', responded_at = coalesce(responded_at, now()), updated_at = now()
    WHERE id = a.id;
    UPDATE public.orders
    SET assigned_partner_id = NULL, status = 'ready_for_pickup', updated_at = now()
    WHERE id = a.order_id AND assigned_partner_id = p.id;
    INSERT INTO public.delivery_tracking(assignment_id, status, note)
    VALUES (a.id, 'cancelled', 'Partner went offline before pickup; order released for reassignment');
    PERFORM public.dispatch_delivery_for_order_internal(a.order_id, 60);
    released := released + 1;
  END LOOP;

  SELECT count(*)::integer INTO retained
  FROM public.delivery_assignments
  WHERE partner_id = p.id AND status IN ('picked_up', 'out_for_delivery');
  RETURN jsonb_build_object('released', released, 'retained_after_pickup', retained);
END;
$$;
REVOKE ALL ON FUNCTION public.partner_go_offline() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_go_offline() TO authenticated;

-- Server-side recovery for app crashes and dead browser sessions. If pg_cron
-- is enabled in Supabase, the guarded schedule below runs this every minute.
CREATE OR REPLACE FUNCTION public.reassign_stale_delivery_assignments(_stale_minutes integer DEFAULT 10)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  a record;
  recovered integer := 0;
BEGIN
  FOR a IN
    SELECT da.id, da.order_id
    FROM public.delivery_assignments da
    JOIN public.delivery_partners p ON p.id = da.partner_id
    WHERE da.status IN ('accepted', 'navigating_to_vendor', 'reached_vendor')
      AND (p.availability = 'offline'
        OR p.location_updated_at IS NULL
        OR p.location_updated_at < now() - make_interval(mins => greatest(_stale_minutes, 5)))
    FOR UPDATE OF da SKIP LOCKED
  LOOP
    UPDATE public.delivery_assignments
    SET status = 'cancelled', updated_at = now()
    WHERE id = a.id;
    UPDATE public.orders
    SET assigned_partner_id = NULL, status = 'ready_for_pickup', updated_at = now()
    WHERE id = a.order_id;
    INSERT INTO public.delivery_tracking(assignment_id, status, note)
    VALUES (a.id, 'cancelled', 'Assignment recovered after rider inactivity or stale GPS');
    PERFORM public.dispatch_delivery_for_order_internal(a.order_id, 60);
    recovered := recovered + 1;
  END LOOP;
  RETURN recovered;
END;
$$;
REVOKE ALL ON FUNCTION public.reassign_stale_delivery_assignments(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reassign_stale_delivery_assignments(integer) TO service_role;

DO $schedule$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'localshoree-reassign-stale-deliveries') THEN
      PERFORM cron.schedule(
        'localshoree-reassign-stale-deliveries',
        '* * * * *',
        $sql$SELECT public.reassign_stale_delivery_assignments(10);$sql$
      );
    END IF;
  END IF;
EXCEPTION WHEN undefined_table OR undefined_function THEN
  NULL;
END;
$schedule$;

-- Flag suspicious-but-storable GPS points for review. Existing server-side
-- speed rejection remains in place for impossible jumps above its hard limit.
ALTER TABLE public.delivery_locations
  ADD COLUMN IF NOT EXISTS is_suspicious boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS suspicion_reason text;
CREATE OR REPLACE FUNCTION public.flag_suspicious_delivery_location()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.speed_kmh IS NOT NULL AND NEW.speed_kmh > 120 THEN
    NEW.is_suspicious := true;
    NEW.suspicion_reason := 'unusually_high_speed';
  ELSIF NEW.accuracy_m IS NOT NULL AND NEW.accuracy_m > 5000 THEN
    NEW.is_suspicious := true;
    NEW.suspicion_reason := 'low_accuracy';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_flag_suspicious_delivery_location ON public.delivery_locations;
CREATE TRIGGER trg_flag_suspicious_delivery_location
BEFORE INSERT ON public.delivery_locations FOR EACH ROW
EXECUTE FUNCTION public.flag_suspicious_delivery_location();

NOTIFY pgrst, 'reload schema';
