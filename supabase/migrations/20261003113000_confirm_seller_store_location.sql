-- Persist a seller-confirmed physical shop entrance for customer discovery.
-- The authenticated caller can only update the seller row owned by auth.uid().
CREATE OR REPLACE FUNCTION public.confirm_seller_store_location(
  p_address_line1 text,
  p_address_line2 text,
  p_city text,
  p_state text,
  p_pincode text,
  p_latitude double precision,
  p_longitude double precision,
  p_google_place_id text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_seller_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_latitude IS NULL OR p_latitude::text IN ('NaN', 'Infinity', '-Infinity')
     OR p_latitude NOT BETWEEN -90 AND 90 THEN
    RAISE EXCEPTION 'Latitude must be between -90 and 90';
  END IF;
  IF p_longitude IS NULL OR p_longitude::text IN ('NaN', 'Infinity', '-Infinity')
     OR p_longitude NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'Longitude must be between -180 and 180';
  END IF;
  IF NULLIF(trim(p_address_line1), '') IS NULL OR length(trim(p_address_line1)) < 4 THEN
    RAISE EXCEPTION 'Enter a complete store address';
  END IF;
  IF NULLIF(trim(p_city), '') IS NULL OR NULLIF(trim(p_state), '') IS NULL THEN
    RAISE EXCEPTION 'City and state are required';
  END IF;
  IF trim(COALESCE(p_pincode, '')) !~ '^[0-9]{6}$' THEN
    RAISE EXCEPTION 'Enter a valid 6-digit pincode';
  END IF;

  UPDATE public.sellers AS s
  SET address_line1 = trim(p_address_line1),
      address_line2 = NULLIF(trim(COALESCE(p_address_line2, '')), ''),
      city = trim(p_city),
      state = trim(p_state),
      pincode = trim(p_pincode),
      lat = p_latitude,
      lng = p_longitude,
      shop_latitude = p_latitude,
      shop_longitude = p_longitude,
      location_verified = true,
      location_verified_at = now(),
      wizard_data = COALESCE(s.wizard_data, '{}'::jsonb) || jsonb_build_object(
        'lat', p_latitude,
        'lng', p_longitude,
        'shopCoordinates', jsonb_build_object('lat', p_latitude, 'lng', p_longitude),
        'googlePlaceId', NULLIF(trim(COALESCE(p_google_place_id, '')), ''),
        'locationConfirmationRequired', false
      ) || CASE
        WHEN COALESCE(s.wizard_data->>'pickupSame', 'true') = 'true' THEN jsonb_build_object(
          'pickupLat', p_latitude,
          'pickupLng', p_longitude,
          'pickupCoordinates', jsonb_build_object('lat', p_latitude, 'lng', p_longitude)
        )
        ELSE '{}'::jsonb
      END
  WHERE s.user_id = v_user_id
  RETURNING s.id INTO v_seller_id;

  IF v_seller_id IS NULL THEN
    RAISE EXCEPTION 'No seller profile is linked to this account';
  END IF;

  RETURN v_seller_id;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_seller_store_location(
  text, text, text, text, text, double precision, double precision, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_seller_store_location(
  text, text, text, text, text, double precision, double precision, text
) TO authenticated;
