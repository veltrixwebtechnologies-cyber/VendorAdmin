-- Delivery Partner Hub integration for the existing Shoreline/SellerHub schema.
-- This migration is additive: it does not recreate orders, sellers, profiles,
-- products, or user_roles.

-- Run 20260801085900_delivery_partner_enum_values.sql first and commit it.
-- Supabase/Postgres must commit new enum values before this migration uses them.

-- Some shared project versions do not have the role helper yet. Keep the
-- canonical signature used by all RLS policies and delivery RPCs.
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('customer', 'vendor', 'admin', 'delivery_partner'));

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS assigned_partner_id uuid,
  ADD COLUMN IF NOT EXISTS customer_latitude double precision,
  ADD COLUMN IF NOT EXISTS customer_longitude double precision,
  ADD COLUMN IF NOT EXISTS delivery_otp text;

ALTER TABLE public.orders
  ALTER COLUMN delivery_otp SET DEFAULT lpad((floor(random() * 1000000))::text, 6, '0');

CREATE TABLE IF NOT EXISTS public.delivery_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  city text NOT NULL DEFAULT 'Coimbatore',
  latitude double precision,
  longitude double precision,
  radius_km numeric(6,2) NOT NULL DEFAULT 5,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.delivery_zones (name, city, latitude, longitude, radius_km, is_active)
VALUES
  ('Gandhipuram', 'Coimbatore', 11.0168, 76.9558, 5, true),
  ('RS Puram', 'Coimbatore', 11.0076, 76.9537, 5, true),
  ('Peelamedu', 'Coimbatore', 11.0300, 77.0000, 6, true),
  ('Saibaba Colony', 'Coimbatore', 11.0250, 76.9380, 5, true),
  ('Singanallur', 'Coimbatore', 11.0000, 77.0300, 6, true),
  ('Race Course', 'Coimbatore', 11.0005, 76.9660, 5, true)
ON CONFLICT (name) DO UPDATE SET
  city = EXCLUDED.city,
  latitude = EXCLUDED.latitude,
  longitude = EXCLUDED.longitude,
  radius_km = EXCLUDED.radius_km,
  is_active = EXCLUDED.is_active;

CREATE TABLE IF NOT EXISTS public.delivery_partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  mobile text NOT NULL,
  email text NOT NULL,
  mobile_verified boolean NOT NULL DEFAULT false,
  email_verified boolean NOT NULL DEFAULT false,
  profile_photo_url text,
  date_of_birth date,
  gender text,
  emergency_contact_name text,
  emergency_contact_number text,
  house_number text,
  street text,
  area text,
  city text,
  state text,
  pincode text,
  vehicle_type text,
  vehicle_number text,
  vehicle_brand text,
  vehicle_model text,
  vehicle_color text,
  licence_number text,
  licence_expiry date,
  aadhaar_number text,
  pan_number text,
  bank_account_holder text,
  bank_name text,
  bank_account_number text,
  bank_ifsc text,
  upi_id text,
  employment_type text,
  status text NOT NULL DEFAULT 'draft',
  admin_note text,
  registration_step smallint NOT NULL DEFAULT 1,
  availability text NOT NULL DEFAULT 'offline',
  current_latitude double precision,
  current_longitude double precision,
  location_updated_at timestamptz,
  rating numeric(3,2) NOT NULL DEFAULT 5,
  total_deliveries integer NOT NULL DEFAULT 0,
  cancelled_deliveries integer NOT NULL DEFAULT 0,
  late_deliveries integer NOT NULL DEFAULT 0,
  total_requests integer NOT NULL DEFAULT 0,
  accepted_requests integer NOT NULL DEFAULT 0,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.delivery_partner_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.delivery_partners(id) ON DELETE CASCADE,
  zone_id uuid NOT NULL REFERENCES public.delivery_zones(id) ON DELETE CASCADE,
  UNIQUE (partner_id, zone_id)
);

CREATE TABLE IF NOT EXISTS public.delivery_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.delivery_partners(id) ON DELETE CASCADE,
  slot text NOT NULL,
  UNIQUE (partner_id, slot)
);

CREATE TABLE IF NOT EXISTS public.delivery_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.delivery_partners(id) ON DELETE CASCADE,
  doc_type text NOT NULL,
  file_path text NOT NULL,
  expiry_date date,
  status text NOT NULL DEFAULT 'pending',
  reviewer_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (partner_id, doc_type)
);

CREATE TABLE IF NOT EXISTS public.delivery_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  partner_id uuid NOT NULL REFERENCES public.delivery_partners(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  distance_km numeric(6,2),
  estimated_earning numeric(10,2),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '60 seconds'),
  responded_at timestamptz,
  picked_up_at timestamptz,
  delivered_at timestamptz,
  proof_type text,
  proof_value text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, partner_id)
);

CREATE TABLE IF NOT EXISTS public.delivery_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES public.delivery_assignments(id) ON DELETE CASCADE,
  status text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.delivery_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.delivery_partners(id) ON DELETE CASCADE,
  assignment_id uuid REFERENCES public.delivery_assignments(id) ON DELETE SET NULL,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.delivery_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.delivery_partners(id) ON DELETE CASCADE,
  amount numeric(10,2) NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  period_start date,
  period_end date,
  reference text,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.delivery_earnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.delivery_partners(id) ON DELETE CASCADE,
  assignment_id uuid REFERENCES public.delivery_assignments(id) ON DELETE SET NULL,
  type text NOT NULL DEFAULT 'delivery_fee',
  amount numeric(10,2) NOT NULL,
  description text,
  payout_id uuid REFERENCES public.delivery_payouts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.delivery_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.delivery_partners(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text,
  kind text NOT NULL DEFAULT 'general',
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.is_my_partner(_partner_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.delivery_partners
    WHERE id = _partner_id AND user_id = auth.uid()
  )
$$;

CREATE OR REPLACE FUNCTION public.sync_delivery_partner_role()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.profiles SET role = 'delivery_partner' WHERE id = NEW.user_id;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.user_id, 'delivery_partner') ON CONFLICT (user_id, role) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_delivery_partner_role ON public.delivery_partners;
CREATE TRIGGER trg_sync_delivery_partner_role
AFTER INSERT ON public.delivery_partners
FOR EACH ROW EXECUTE FUNCTION public.sync_delivery_partner_role();

CREATE OR REPLACE FUNCTION public.set_delivery_partner_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_delivery_partner_updated ON public.delivery_partners;
CREATE TRIGGER trg_delivery_partner_updated BEFORE UPDATE ON public.delivery_partners
FOR EACH ROW EXECUTE FUNCTION public.set_delivery_partner_updated_at();

CREATE OR REPLACE FUNCTION public.guard_delivery_partner_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.has_role(auth.uid(), 'admin'::public.app_role) THEN RETURN NEW; END IF;
  NEW.user_id := OLD.user_id;
  NEW.status := OLD.status;
  NEW.admin_note := OLD.admin_note;
  NEW.approved_at := OLD.approved_at;
  NEW.rating := OLD.rating;
  NEW.total_deliveries := OLD.total_deliveries;
  NEW.cancelled_deliveries := OLD.cancelled_deliveries;
  NEW.late_deliveries := OLD.late_deliveries;
  NEW.total_requests := OLD.total_requests;
  NEW.accepted_requests := OLD.accepted_requests;
  IF OLD.status = 'draft' AND NEW.registration_step >= 9 THEN
    NEW.status := 'pending_verification';
  END IF;
  IF OLD.status = 'info_requested' THEN NEW.status := 'pending_verification'; END IF;
  IF OLD.status <> 'approved' THEN NEW.availability := 'offline'; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_delivery_partner_columns ON public.delivery_partners;
CREATE TRIGGER trg_guard_delivery_partner_columns BEFORE UPDATE ON public.delivery_partners
FOR EACH ROW EXECUTE FUNCTION public.guard_delivery_partner_columns();

CREATE OR REPLACE FUNCTION public.guard_delivery_assignment_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.has_role(auth.uid(), 'admin'::public.app_role) THEN RETURN NEW; END IF;
  NEW.order_id := OLD.order_id;
  NEW.partner_id := OLD.partner_id;
  NEW.distance_km := OLD.distance_km;
  NEW.estimated_earning := OLD.estimated_earning;
  NEW.expires_at := OLD.expires_at;
  NEW.created_at := OLD.created_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_delivery_assignment_columns ON public.delivery_assignments;
CREATE TRIGGER trg_guard_delivery_assignment_columns BEFORE UPDATE ON public.delivery_assignments
FOR EACH ROW EXECUTE FUNCTION public.guard_delivery_assignment_columns();

ALTER TABLE public.delivery_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_partner_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_earnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_notifications ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.delivery_zones TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.delivery_partners TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.delivery_partner_zones, public.delivery_shifts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_documents TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.delivery_assignments, public.delivery_tracking TO authenticated;
GRANT SELECT, INSERT ON public.delivery_locations TO authenticated;
GRANT SELECT, UPDATE ON public.delivery_payouts TO authenticated;
GRANT SELECT ON public.delivery_earnings TO authenticated;
GRANT SELECT, UPDATE ON public.delivery_notifications TO authenticated;

DROP POLICY IF EXISTS "delivery zones readable" ON public.delivery_zones;
DROP POLICY IF EXISTS "partner reads own record" ON public.delivery_partners;
DROP POLICY IF EXISTS "partner creates own record" ON public.delivery_partners;
DROP POLICY IF EXISTS "partner updates own record" ON public.delivery_partners;
DROP POLICY IF EXISTS "partner manages own zones" ON public.delivery_partner_zones;
DROP POLICY IF EXISTS "partner manages own shifts" ON public.delivery_shifts;
DROP POLICY IF EXISTS "partner documents access" ON public.delivery_documents;
DROP POLICY IF EXISTS "assignment access" ON public.delivery_assignments;
DROP POLICY IF EXISTS "tracking access" ON public.delivery_tracking;
DROP POLICY IF EXISTS "location access" ON public.delivery_locations;
DROP POLICY IF EXISTS "payout access" ON public.delivery_payouts;
DROP POLICY IF EXISTS "payout admin update" ON public.delivery_payouts;
DROP POLICY IF EXISTS "earnings access" ON public.delivery_earnings;
DROP POLICY IF EXISTS "notification access" ON public.delivery_notifications;
DROP POLICY IF EXISTS "notification update" ON public.delivery_notifications;

CREATE POLICY "delivery zones readable" ON public.delivery_zones FOR SELECT TO authenticated USING (is_active);
CREATE POLICY "partner reads own record" ON public.delivery_partners FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "partner creates own record" ON public.delivery_partners FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "partner updates own record" ON public.delivery_partners FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "partner manages own zones" ON public.delivery_partner_zones FOR ALL TO authenticated
  USING (public.is_my_partner(partner_id) OR public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.is_my_partner(partner_id) OR public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "partner manages own shifts" ON public.delivery_shifts FOR ALL TO authenticated
  USING (public.is_my_partner(partner_id) OR public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.is_my_partner(partner_id) OR public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "partner documents access" ON public.delivery_documents FOR ALL TO authenticated
  USING (public.is_my_partner(partner_id) OR public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.is_my_partner(partner_id) OR public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "assignment access" ON public.delivery_assignments FOR ALL TO authenticated
  USING (public.is_my_partner(partner_id) OR public.has_role(auth.uid(), 'admin'::public.app_role) OR EXISTS (
    SELECT 1 FROM public.orders o WHERE o.id = order_id AND o.user_id = auth.uid()
  ))
  WITH CHECK (public.is_my_partner(partner_id) OR public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "tracking access" ON public.delivery_tracking FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.delivery_assignments a WHERE a.id = assignment_id AND
    (public.is_my_partner(a.partner_id) OR public.has_role(auth.uid(), 'admin'::public.app_role))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.delivery_assignments a WHERE a.id = assignment_id AND
    (public.is_my_partner(a.partner_id) OR public.has_role(auth.uid(), 'admin'::public.app_role))));
CREATE POLICY "location access" ON public.delivery_locations FOR ALL TO authenticated
  USING (public.is_my_partner(partner_id) OR public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.is_my_partner(partner_id));
CREATE POLICY "payout access" ON public.delivery_payouts FOR SELECT TO authenticated
  USING (public.is_my_partner(partner_id) OR public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "payout admin update" ON public.delivery_payouts FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "earnings access" ON public.delivery_earnings FOR SELECT TO authenticated
  USING (public.is_my_partner(partner_id) OR public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "notification access" ON public.delivery_notifications FOR SELECT TO authenticated
  USING (public.is_my_partner(partner_id) OR public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "notification update" ON public.delivery_notifications FOR UPDATE TO authenticated
  USING (public.is_my_partner(partner_id)) WITH CHECK (public.is_my_partner(partner_id));

DROP POLICY IF EXISTS "Delivery partners read assigned orders" ON public.orders;
CREATE POLICY "Delivery partners read assigned orders" ON public.orders FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.delivery_assignments a WHERE a.order_id = orders.id
    AND public.is_my_partner(a.partner_id)) OR
    (status = 'ready_for_pickup' AND assigned_partner_id IS NULL AND EXISTS (
      SELECT 1 FROM public.delivery_partners p WHERE p.user_id = auth.uid() AND p.status = 'approved'
    )));

DROP POLICY IF EXISTS "Delivery partners update assigned orders" ON public.orders;
CREATE POLICY "Delivery partners update assigned orders" ON public.orders FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.delivery_assignments a WHERE a.order_id = orders.id
    AND public.is_my_partner(a.partner_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.delivery_assignments a WHERE a.order_id = orders.id
    AND public.is_my_partner(a.partner_id)));

DROP POLICY IF EXISTS "Delivery partners read assigned sellers" ON public.sellers;
CREATE POLICY "Delivery partners read assigned sellers" ON public.sellers FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR EXISTS (
      SELECT 1
      FROM public.orders o
      JOIN public.delivery_assignments a ON a.order_id = o.id
      WHERE o.seller_id = sellers.id
        AND public.is_my_partner(a.partner_id)
    )
  );

DROP POLICY IF EXISTS "Delivery partners read assigned order items" ON public.order_items;
CREATE POLICY "Delivery partners read assigned order items" ON public.order_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.orders o
      JOIN public.delivery_assignments a ON a.order_id = o.id
      WHERE o.id = order_items.order_id
        AND public.is_my_partner(a.partner_id)
    )
  );

CREATE OR REPLACE FUNCTION public.accept_delivery_request(_assignment_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a record;
BEGIN
  SELECT * INTO a FROM public.delivery_assignments WHERE id = _assignment_id FOR UPDATE;
  IF a.id IS NULL OR NOT public.is_my_partner(a.partner_id) THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF a.status <> 'pending' OR a.expires_at < now() THEN RAISE EXCEPTION 'Request is no longer available'; END IF;
  UPDATE public.orders SET status = 'assigned', assigned_partner_id = a.partner_id
    WHERE id = a.order_id AND assigned_partner_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order already assigned'; END IF;
  UPDATE public.delivery_assignments SET status = 'accepted', responded_at = now() WHERE id = a.id;
  UPDATE public.delivery_assignments SET status = 'expired' WHERE order_id = a.order_id AND id <> a.id AND status = 'pending';
  UPDATE public.delivery_partners SET accepted_requests = accepted_requests + 1 WHERE id = a.partner_id;
  INSERT INTO public.delivery_tracking (assignment_id, status, note) VALUES (a.id, 'accepted', 'Partner accepted the delivery');
  RETURN a.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_delivery(_assignment_id uuid, _proof_type text, _proof_value text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a record; o record; fee numeric;
BEGIN
  SELECT * INTO a FROM public.delivery_assignments WHERE id = _assignment_id;
  IF a.id IS NULL OR NOT public.is_my_partner(a.partner_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT * INTO o FROM public.orders WHERE id = a.order_id;
  IF _proof_type = 'otp' AND coalesce(_proof_value, '') <> coalesce(o.delivery_otp, '') THEN
    RAISE EXCEPTION 'Incorrect delivery OTP';
  END IF;
  fee := coalesce(a.estimated_earning, o.shipping_fee, 0);
  UPDATE public.delivery_assignments SET status = 'delivered', delivered_at = now(), proof_type = _proof_type, proof_value = _proof_value WHERE id = a.id;
  UPDATE public.orders SET status = 'delivered', delivered_at = now() WHERE id = a.order_id;
  INSERT INTO public.delivery_tracking (assignment_id, status, note) VALUES (a.id, 'delivered', 'Delivered to customer');
  INSERT INTO public.delivery_earnings (partner_id, assignment_id, amount, description) VALUES (a.partner_id, a.id, fee, 'Delivery ' || o.order_number);
  UPDATE public.delivery_partners SET total_deliveries = total_deliveries + 1 WHERE id = a.partner_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_delivery_request(uuid), public.complete_delivery(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.broadcast_delivery_request(_order_id uuid, _timeout_seconds integer DEFAULT 60)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o record;
  p record;
  created_count integer := 0;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = _order_id;
  IF o.id IS NULL OR o.status <> 'ready_for_pickup' OR o.assigned_partner_id IS NOT NULL THEN RETURN 0; END IF;
  IF NOT (public.has_role(auth.uid(), 'admin'::public.app_role) OR o.seller_id IN (
    SELECT s.id FROM public.sellers s WHERE s.user_id = auth.uid()
  )) THEN RAISE EXCEPTION 'Not allowed to dispatch this order'; END IF;

  FOR p IN SELECT id FROM public.delivery_partners
    WHERE status = 'approved' AND availability = 'online'
    ORDER BY rating DESC, created_at ASC LIMIT 10
  LOOP
    INSERT INTO public.delivery_assignments (order_id, partner_id, distance_km, estimated_earning, expires_at)
    VALUES (_order_id, p.id, NULL, coalesce(o.shipping_fee, 0), now() + make_interval(secs => _timeout_seconds))
    ON CONFLICT (order_id, partner_id) DO NOTHING;
    IF FOUND THEN
      INSERT INTO public.delivery_notifications (partner_id, title, body, kind)
      VALUES (p.id, 'New delivery request', 'A customer order is ready for pickup', 'new_delivery');
      UPDATE public.delivery_partners SET total_requests = total_requests + 1 WHERE id = p.id;
      created_count := created_count + 1;
    END IF;
  END LOOP;
  RETURN created_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.broadcast_delivery_request(uuid, integer) TO authenticated;

INSERT INTO storage.buckets (id, name, public)
VALUES ('delivery-docs', 'delivery-docs', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "Partners access own delivery docs" ON storage.objects;
DROP POLICY IF EXISTS "Partners upload own delivery docs" ON storage.objects;
CREATE POLICY "Partners access own delivery docs" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'delivery-docs' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.has_role(auth.uid(), 'admin'::public.app_role)));
CREATE POLICY "Partners upload own delivery docs" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'delivery-docs' AND (storage.foldername(name))[1] = auth.uid()::text);
