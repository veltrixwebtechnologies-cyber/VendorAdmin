-- Lock workflow and approval fields behind validated server functions.
-- The browser uses RPCs for these transitions; direct table writes must not
-- be able to approve products, rewrite ownership, or skip delivery steps.

CREATE OR REPLACE FUNCTION public.guard_seller_product_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;

  NEW.user_id := OLD.user_id;
  NEW.seller_id := OLD.seller_id;
  NEW.status := OLD.status;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_seller_product_columns ON public.products;
CREATE TRIGGER trg_guard_seller_product_columns
BEFORE UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.guard_seller_product_columns();

-- Delivery assignments and tracking are written by SECURITY DEFINER RPCs.
-- Partners and customers retain read access through RLS, but cannot inject or
-- mutate workflow rows through PostgREST.
REVOKE INSERT, UPDATE, DELETE ON public.delivery_assignments FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.delivery_tracking FROM authenticated;
GRANT SELECT ON public.delivery_assignments TO authenticated;
GRANT SELECT ON public.delivery_tracking TO authenticated;

-- Live coordinates are written only by submit_partner_location(). Keep normal
-- profile/availability edits available to the app, but remove the three
-- location columns from direct client UPDATE privileges so they cannot be
-- spoofed through PostgREST.
REVOKE UPDATE ON public.delivery_partners FROM authenticated;
GRANT UPDATE (
  full_name, mobile, email, mobile_verified, email_verified,
  profile_photo_url, date_of_birth, gender, emergency_contact_name,
  emergency_contact_number, house_number, street, area, city, state, pincode,
  vehicle_type, vehicle_number, vehicle_brand, vehicle_model, vehicle_color,
  licence_number, licence_expiry, aadhaar_number, pan_number,
  bank_account_holder, bank_name, bank_account_number, bank_ifsc, upi_id,
  employment_type, registration_step, availability
) ON public.delivery_partners TO authenticated;

-- Sellers advance orders through advance_seller_order(). Cancellation also
-- gets a guarded RPC so the broad vendor UPDATE policy is not needed.
DROP POLICY IF EXISTS "Vendors update store orders" ON public.orders;

CREATE OR REPLACE FUNCTION public.cancel_seller_order(_order_id uuid, _reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  o record;
BEGIN
  SELECT * INTO o
  FROM public.orders
  WHERE id = _order_id
  FOR UPDATE;

  IF o.id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.sellers s
      WHERE s.id = o.seller_id AND s.user_id = auth.uid()
    )
  ) THEN
    RAISE EXCEPTION 'Not allowed to cancel this order';
  END IF;

  IF o.status::text IN ('delivered', 'cancelled', 'returned') THEN
    RAISE EXCEPTION 'Order cannot be cancelled from status %', o.status;
  END IF;

  UPDATE public.orders
  SET status = 'cancelled', updated_at = now()
  WHERE id = o.id;

  RETURN jsonb_build_object('id', o.id, 'status', 'cancelled');
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_seller_order(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_seller_order(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
