-- ============================================================
-- SHOP AVAILABILITY SYSTEM
-- Migration: 20260824000000_shop_availability_system.sql
--
-- Tables:
--   shop_hours           – regular weekly schedule (7 rows per seller)
--   shop_overrides       – manual open/closed + temporary closure
--   shop_holidays        – date-range closures & special hours
--   shop_availability_log – audit trail of every change
--
-- Functions:
--   get_shop_status(seller_id, at_ts, tz) → JSONB  (fast, indexed)
--
-- All times stored in UTC or as plain TIME + timezone label.
-- Overnight schedules: open_time > close_time means crosses midnight.
-- ============================================================

-- ── ENUM ──────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'override_kind' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.override_kind AS ENUM ('temporary_closed', 'manual_open', 'manual_closed');
  END IF;
END $$;

-- ── shop_hours ─────────────────────────────────────────────────────────────────
-- One row per (seller, day_of_week). day_of_week: 0=Sunday … 6=Saturday (ISO: 7=Sunday).
-- We use Postgres dow convention (0=Sunday) for simplicity.
CREATE TABLE IF NOT EXISTS public.shop_hours (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id       UUID        NOT NULL REFERENCES public.sellers(id) ON DELETE CASCADE,
  day_of_week     SMALLINT    NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  is_open         BOOLEAN     NOT NULL DEFAULT true,
  open_time       TIME        NOT NULL DEFAULT '09:00',
  close_time      TIME        NOT NULL DEFAULT '21:00',
  -- Overnight support: close_time < open_time means closes next calendar day
  -- Timezone label stored for display; DB always computes in UTC using sellers.timezone.
  break_start     TIME,
  break_end       TIME,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (seller_id, day_of_week)
);
CREATE INDEX IF NOT EXISTS idx_shop_hours_seller ON public.shop_hours(seller_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shop_hours TO authenticated;
GRANT ALL ON public.shop_hours TO service_role;
ALTER TABLE public.shop_hours ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Seller manages own hours"
  ON public.shop_hours FOR ALL TO authenticated
  USING  (EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = seller_id AND s.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = seller_id AND s.user_id = auth.uid()));

CREATE POLICY "Admin manages all shop hours"
  ON public.shop_hours FOR ALL TO authenticated
  USING  (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Public reads approved shop hours"
  ON public.shop_hours FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.sellers s
      WHERE s.id = seller_id AND s.status = 'approved'
    )
  );

CREATE TRIGGER trg_shop_hours_updated
  BEFORE UPDATE ON public.shop_hours
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── shop_timezone ─────────────────────────────────────────────────────────────
-- We add a timezone column to sellers so hours are interpreted correctly.
ALTER TABLE public.sellers
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  ADD COLUMN IF NOT EXISTS accepts_orders BOOLEAN NOT NULL DEFAULT true;

-- ── shop_overrides ─────────────────────────────────────────────────────────────
-- A "live" override beats the weekly schedule.
-- Only the most-recent active row is used (see get_shop_status).
CREATE TABLE IF NOT EXISTS public.shop_overrides (
  id              UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id       UUID               NOT NULL REFERENCES public.sellers(id) ON DELETE CASCADE,
  kind            public.override_kind NOT NULL,
  reason          TEXT,
  -- When NULL the override is indefinite (until reverted)
  effective_until TIMESTAMPTZ,
  created_at      TIMESTAMPTZ        NOT NULL DEFAULT now(),
  created_by      UUID               REFERENCES auth.users(id),
  reverted_at     TIMESTAMPTZ,
  reverted_by     UUID               REFERENCES auth.users(id)
);
CREATE INDEX IF NOT EXISTS idx_shop_overrides_seller ON public.shop_overrides(seller_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shop_overrides TO authenticated;
GRANT ALL ON public.shop_overrides TO service_role;
ALTER TABLE public.shop_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Seller manages own overrides"
  ON public.shop_overrides FOR ALL TO authenticated
  USING  (EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = seller_id AND s.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = seller_id AND s.user_id = auth.uid()));

CREATE POLICY "Admin manages all overrides"
  ON public.shop_overrides FOR ALL TO authenticated
  USING  (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Public reads active overrides"
  ON public.shop_overrides FOR SELECT
  USING (
    reverted_at IS NULL AND
    (effective_until IS NULL OR effective_until > now()) AND
    EXISTS (
      SELECT 1 FROM public.sellers s
      WHERE s.id = seller_id AND s.status = 'approved'
    )
  );

-- ── shop_holidays ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.shop_holidays (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id       UUID        NOT NULL REFERENCES public.sellers(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL,
  -- date range (inclusive, in seller local calendar)
  start_date      DATE        NOT NULL,
  end_date        DATE        NOT NULL,
  -- NULL = closed all day; non-NULL = special hours (festival opening)
  special_open    TIME,
  special_close   TIME,
  is_closed       BOOLEAN     NOT NULL DEFAULT true,  -- false = special hours (open)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID        REFERENCES auth.users(id),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_shop_holidays_seller     ON public.shop_holidays(seller_id);
CREATE INDEX IF NOT EXISTS idx_shop_holidays_date_range ON public.shop_holidays(seller_id, start_date, end_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shop_holidays TO authenticated;
GRANT ALL ON public.shop_holidays TO service_role;
ALTER TABLE public.shop_holidays ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Seller manages own holidays"
  ON public.shop_holidays FOR ALL TO authenticated
  USING  (EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = seller_id AND s.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = seller_id AND s.user_id = auth.uid()));

CREATE POLICY "Admin manages all holidays"
  ON public.shop_holidays FOR ALL TO authenticated
  USING  (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Public reads future holidays"
  ON public.shop_holidays FOR SELECT
  USING (
    end_date >= CURRENT_DATE AND
    EXISTS (
      SELECT 1 FROM public.sellers s
      WHERE s.id = seller_id AND s.status = 'approved'
    )
  );

CREATE TRIGGER trg_shop_holidays_updated
  BEFORE UPDATE ON public.shop_holidays
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── shop_availability_log ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.shop_availability_log (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id   UUID        NOT NULL REFERENCES public.sellers(id) ON DELETE CASCADE,
  actor_id    UUID        REFERENCES auth.users(id),
  action      TEXT        NOT NULL,  -- 'set_hours','set_override','revert_override','add_holiday','del_holiday'
  payload     JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shop_avail_log_seller ON public.shop_availability_log(seller_id, created_at DESC);

GRANT SELECT, INSERT ON public.shop_availability_log TO authenticated;
GRANT ALL ON public.shop_availability_log TO service_role;
ALTER TABLE public.shop_availability_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Seller reads own availability log"
  ON public.shop_availability_log FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = seller_id AND s.user_id = auth.uid()));

CREATE POLICY "Admin reads all availability log"
  ON public.shop_availability_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated users can insert log"
  ON public.shop_availability_log FOR INSERT TO authenticated
  WITH CHECK (true);

-- ── get_shop_status() ─────────────────────────────────────────────────────────
-- Returns a JSONB document describing current open/closed state.
-- All logic is in the DB so it is immune to client clock drift.
--
-- Result keys:
--   status          : 'open' | 'closed' | 'closed_override' | 'open_override' | 'holiday'
--   is_open         : boolean
--   label           : human-readable string
--   opens_at        : TEXT | null   (e.g. "09:00 AM")
--   closes_at       : TEXT | null
--   override_reason : TEXT | null
--   checked_at      : timestamptz (server-side)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_shop_status(
  _seller_id UUID,
  _at        TIMESTAMPTZ DEFAULT now(),
  _tz        TEXT        DEFAULT 'Asia/Kolkata'
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz           TEXT;
  v_local        TIMESTAMPTZ;
  v_local_date   DATE;
  v_local_time   TIME;
  v_dow          SMALLINT;   -- 0=Sunday
  v_accepts      BOOLEAN;
  v_override     RECORD;
  v_holiday      RECORD;
  v_hours        RECORD;
  v_is_overnight BOOLEAN;
  v_prev_hours   RECORD;
  v_result       JSONB;
BEGIN
  -- 1. Resolve timezone from seller (fallback to parameter)
  SELECT COALESCE(s.timezone, _tz), s.accepts_orders
    INTO v_tz, v_accepts
    FROM public.sellers s
   WHERE s.id = _seller_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status','closed','is_open',false,
      'label','Shop not found','opens_at',null,'closes_at',null,
      'override_reason',null,'checked_at',_at
    );
  END IF;

  -- 2. accepts_orders hard gate
  IF NOT v_accepts THEN
    RETURN jsonb_build_object(
      'status','closed','is_open',false,
      'label','Shop is not accepting orders','opens_at',null,'closes_at',null,
      'override_reason',null,'checked_at',_at
    );
  END IF;

  -- 3. Convert to local time
  v_local      := _at AT TIME ZONE v_tz;
  v_local_date := v_local::DATE;
  v_local_time := v_local::TIME;
  v_dow        := EXTRACT(DOW FROM v_local)::SMALLINT; -- 0=Sun

  -- 4. Check active override (most recent wins)
  SELECT o.*
    INTO v_override
    FROM public.shop_overrides o
   WHERE o.seller_id   = _seller_id
     AND o.reverted_at IS NULL
     AND (o.effective_until IS NULL OR o.effective_until > _at)
   ORDER BY o.created_at DESC
   LIMIT 1;

  IF FOUND THEN
    IF v_override.kind = 'temporary_closed' OR v_override.kind = 'manual_closed' THEN
      RETURN jsonb_build_object(
        'status','closed_override','is_open',false,
        'label','Temporarily closed',
        'opens_at',null,'closes_at',null,
        'override_reason', COALESCE(v_override.reason,''),
        'checked_at',_at
      );
    ELSIF v_override.kind = 'manual_open' THEN
      RETURN jsonb_build_object(
        'status','open_override','is_open',true,
        'label','Open (manual override)',
        'opens_at',null,'closes_at',null,
        'override_reason', COALESCE(v_override.reason,''),
        'checked_at',_at
      );
    END IF;
  END IF;

  -- 5. Check holidays (special or full closure)
  SELECT h.*
    INTO v_holiday
    FROM public.shop_holidays h
   WHERE h.seller_id  = _seller_id
     AND h.start_date <= v_local_date
     AND h.end_date   >= v_local_date
   ORDER BY h.is_closed DESC, h.created_at DESC
   LIMIT 1;

  IF FOUND THEN
    IF v_holiday.is_closed THEN
      RETURN jsonb_build_object(
        'status','holiday','is_open',false,
        'label', 'Closed for ' || v_holiday.name,
        'opens_at',null,'closes_at',null,
        'override_reason', v_holiday.name,
        'checked_at',_at
      );
    ELSE
      -- Special hours
      IF v_holiday.special_open IS NOT NULL AND v_holiday.special_close IS NOT NULL THEN
        IF v_local_time >= v_holiday.special_open AND v_local_time < v_holiday.special_close THEN
          RETURN jsonb_build_object(
            'status','open','is_open',true,
            'label','Open · ' || v_holiday.name,
            'opens_at', to_char(v_holiday.special_open, 'HH12:MI AM'),
            'closes_at', to_char(v_holiday.special_close, 'HH12:MI AM'),
            'override_reason', v_holiday.name,
            'checked_at',_at
          );
        ELSE
          RETURN jsonb_build_object(
            'status','closed','is_open',false,
            'label','Closed · ' || v_holiday.name,
            'opens_at', to_char(v_holiday.special_open, 'HH12:MI AM'),
            'closes_at', to_char(v_holiday.special_close, 'HH12:MI AM'),
            'override_reason', v_holiday.name,
            'checked_at',_at
          );
        END IF;
      END IF;
    END IF;
  END IF;

  -- 6. Regular weekly hours
  SELECT h.*
    INTO v_hours
    FROM public.shop_hours h
   WHERE h.seller_id    = _seller_id
     AND h.day_of_week  = v_dow;

  IF NOT FOUND OR NOT v_hours.is_open THEN
    -- Find next open day
    RETURN jsonb_build_object(
      'status','closed','is_open',false,
      'label','Closed today',
      'opens_at',null,'closes_at',null,
      'override_reason',null,'checked_at',_at
    );
  END IF;

  v_is_overnight := v_hours.close_time < v_hours.open_time;

  -- Overnight: also check yesterday's schedule to see if we're in a carry-over window
  IF v_is_overnight THEN
    IF v_local_time < v_hours.close_time THEN
      -- We are in the post-midnight window of yesterday's schedule
      RETURN jsonb_build_object(
        'status','open','is_open',true,
        'label','Open · Closes at ' || to_char(v_hours.close_time,'HH12:MI AM'),
        'opens_at', to_char(v_hours.open_time,'HH12:MI AM'),
        'closes_at', to_char(v_hours.close_time,'HH12:MI AM'),
        'override_reason',null,'checked_at',_at
      );
    ELSIF v_local_time >= v_hours.open_time THEN
      RETURN jsonb_build_object(
        'status','open','is_open',true,
        'label','Open · Closes at ' || to_char(v_hours.close_time,'HH12:MI AM') || ' (next day)',
        'opens_at', to_char(v_hours.open_time,'HH12:MI AM'),
        'closes_at', to_char(v_hours.close_time,'HH12:MI AM'),
        'override_reason',null,'checked_at',_at
      );
    ELSE
      RETURN jsonb_build_object(
        'status','closed','is_open',false,
        'label','Opens at ' || to_char(v_hours.open_time,'HH12:MI AM'),
        'opens_at', to_char(v_hours.open_time,'HH12:MI AM'),
        'closes_at', to_char(v_hours.close_time,'HH12:MI AM'),
        'override_reason',null,'checked_at',_at
      );
    END IF;
  END IF;

  -- Normal (non-overnight) schedule
  IF v_local_time >= v_hours.open_time AND v_local_time < v_hours.close_time THEN
    -- Check break period
    IF v_hours.break_start IS NOT NULL AND v_hours.break_end IS NOT NULL
       AND v_local_time >= v_hours.break_start AND v_local_time < v_hours.break_end THEN
      RETURN jsonb_build_object(
        'status','closed','is_open',false,
        'label','On break · Opens at ' || to_char(v_hours.break_end,'HH12:MI AM'),
        'opens_at', to_char(v_hours.break_end,'HH12:MI AM'),
        'closes_at', to_char(v_hours.close_time,'HH12:MI AM'),
        'override_reason',null,'checked_at',_at
      );
    END IF;
    RETURN jsonb_build_object(
      'status','open','is_open',true,
      'label','Open · Closes at ' || to_char(v_hours.close_time,'HH12:MI AM'),
      'opens_at', to_char(v_hours.open_time,'HH12:MI AM'),
      'closes_at', to_char(v_hours.close_time,'HH12:MI AM'),
      'override_reason',null,'checked_at',_at
    );
  ELSIF v_local_time < v_hours.open_time THEN
    RETURN jsonb_build_object(
      'status','closed','is_open',false,
      'label','Opens at ' || to_char(v_hours.open_time,'HH12:MI AM'),
      'opens_at', to_char(v_hours.open_time,'HH12:MI AM'),
      'closes_at', to_char(v_hours.close_time,'HH12:MI AM'),
      'override_reason',null,'checked_at',_at
    );
  ELSE
    RETURN jsonb_build_object(
      'status','closed','is_open',false,
      'label','Closed · Opens tomorrow at ' || to_char(v_hours.open_time,'HH12:MI AM'),
      'opens_at', to_char(v_hours.open_time,'HH12:MI AM'),
      'closes_at', to_char(v_hours.close_time,'HH12:MI AM'),
      'override_reason',null,'checked_at',_at
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_shop_status TO authenticated, anon;

-- ── batch helper: get statuses for a list of seller IDs ───────────────────────
CREATE OR REPLACE FUNCTION public.get_shops_status(_seller_ids UUID[])
RETURNS TABLE (seller_id UUID, status_info JSONB)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT unnest AS seller_id, public.get_shop_status(unnest, now())
  FROM   unnest(_seller_ids);
$$;

GRANT EXECUTE ON FUNCTION public.get_shops_status TO authenticated, anon;

-- ── upsert_shop_hours() – convenience RPC ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.upsert_shop_hours(
  _seller_id    UUID,
  _day_of_week  SMALLINT,
  _is_open      BOOLEAN,
  _open_time    TIME,
  _close_time   TIME,
  _break_start  TIME DEFAULT NULL,
  _break_end    TIME DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
BEGIN
  -- Auth: must be the seller or admin
  IF NOT (
    EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = _seller_id AND s.user_id = v_user)
    OR public.has_role(v_user, 'admin')
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  INSERT INTO public.shop_hours
    (seller_id, day_of_week, is_open, open_time, close_time, break_start, break_end)
  VALUES
    (_seller_id, _day_of_week, _is_open, _open_time, _close_time, _break_start, _break_end)
  ON CONFLICT (seller_id, day_of_week)
  DO UPDATE SET
    is_open      = EXCLUDED.is_open,
    open_time    = EXCLUDED.open_time,
    close_time   = EXCLUDED.close_time,
    break_start  = EXCLUDED.break_start,
    break_end    = EXCLUDED.break_end,
    updated_at   = now();

  INSERT INTO public.shop_availability_log (seller_id, actor_id, action, payload)
  VALUES (
    _seller_id, v_user, 'set_hours',
    jsonb_build_object(
      'day', _day_of_week, 'is_open', _is_open,
      'open_time', _open_time::text, 'close_time', _close_time::text
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_shop_hours TO authenticated;

-- ── set_shop_override() ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_shop_override(
  _seller_id       UUID,
  _kind            public.override_kind,
  _reason          TEXT DEFAULT NULL,
  _effective_until TIMESTAMPTZ DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_id   UUID;
BEGIN
  IF NOT (
    EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = _seller_id AND s.user_id = v_user)
    OR public.has_role(v_user, 'admin')
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  -- Revert any active override first
  UPDATE public.shop_overrides
     SET reverted_at = now(), reverted_by = v_user
   WHERE seller_id   = _seller_id
     AND reverted_at IS NULL
     AND (effective_until IS NULL OR effective_until > now());

  INSERT INTO public.shop_overrides (seller_id, kind, reason, effective_until, created_by)
  VALUES (_seller_id, _kind, _reason, _effective_until, v_user)
  RETURNING id INTO v_id;

  INSERT INTO public.shop_availability_log (seller_id, actor_id, action, payload)
  VALUES (
    _seller_id, v_user, 'set_override',
    jsonb_build_object('kind', _kind::text, 'reason', _reason, 'until', _effective_until)
  );

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_shop_override TO authenticated;

-- ── revert_shop_override() ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.revert_shop_override(_seller_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
BEGIN
  IF NOT (
    EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = _seller_id AND s.user_id = v_user)
    OR public.has_role(v_user, 'admin')
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  UPDATE public.shop_overrides
     SET reverted_at = now(), reverted_by = v_user
   WHERE seller_id   = _seller_id
     AND reverted_at IS NULL
     AND (effective_until IS NULL OR effective_until > now());

  INSERT INTO public.shop_availability_log (seller_id, actor_id, action, payload)
  VALUES (_seller_id, v_user, 'revert_override', '{}'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.revert_shop_override TO authenticated;

-- ── Seed default hours for all existing approved sellers ──────────────────────
INSERT INTO public.shop_hours (seller_id, day_of_week, is_open, open_time, close_time)
SELECT
  s.id,
  d.dow,
  CASE WHEN d.dow = 0 THEN false ELSE true END,  -- closed on Sundays by default
  '09:00'::TIME,
  '21:00'::TIME
FROM public.sellers s
CROSS JOIN (SELECT generate_series(0,6) AS dow) d
WHERE s.status = 'approved'
ON CONFLICT (seller_id, day_of_week) DO NOTHING;
