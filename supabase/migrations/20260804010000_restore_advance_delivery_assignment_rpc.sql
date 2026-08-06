    -- Restore the partner delivery status RPC and refresh PostgREST's schema
    -- cache. Some environments applied the later delivery migrations without
    -- exposing this function to the API.
    CREATE OR REPLACE FUNCTION public.advance_delivery_assignment(
      _assignment_id uuid,
      _next_status text
    )
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $$
    DECLARE
      a record;
      o record;
      next_order_status public.order_status;
    BEGIN
      SELECT * INTO a
      FROM public.delivery_assignments
      WHERE id = _assignment_id
      FOR UPDATE;

      IF a.id IS NULL OR NOT public.is_my_partner(a.partner_id) THEN
        RAISE EXCEPTION 'Delivery assignment not found';
      END IF;

      IF a.status IN ('delivered', 'cancelled', 'rejected', 'expired') THEN
        RAISE EXCEPTION 'Delivery assignment is already closed';
      END IF;

      IF NOT (
        (a.status = 'accepted' AND _next_status = 'navigating_to_vendor') OR
        (a.status = 'navigating_to_vendor' AND _next_status = 'reached_vendor') OR
        (a.status = 'reached_vendor' AND _next_status = 'picked_up') OR
        (a.status = 'picked_up' AND _next_status = 'out_for_delivery')
      ) THEN
        RAISE EXCEPTION 'Invalid delivery transition from % to %', a.status, _next_status;
      END IF;

      SELECT * INTO o
      FROM public.orders
      WHERE id = a.order_id
      FOR UPDATE;

      IF o.id IS NULL OR o.assigned_partner_id <> a.partner_id THEN
        RAISE EXCEPTION 'Order is not assigned to this partner';
      END IF;

      next_order_status := CASE
        WHEN _next_status = 'picked_up' THEN 'picked_up'::public.order_status
        WHEN _next_status = 'out_for_delivery' THEN 'out_for_delivery'::public.order_status
        ELSE 'assigned'::public.order_status
      END;

      UPDATE public.delivery_assignments
      SET status = _next_status,
          picked_up_at = CASE
            WHEN _next_status = 'picked_up' THEN COALESCE(picked_up_at, now())
            ELSE picked_up_at
          END,
          updated_at = now()
      WHERE id = a.id;

      UPDATE public.orders
      SET status = next_order_status
      WHERE id = o.id;

      INSERT INTO public.delivery_tracking (assignment_id, status, note)
      VALUES (a.id, _next_status, 'Partner updated delivery status');

      RETURN jsonb_build_object(
        'assignment_id', a.id,
        'order_id', o.id,
        'assignment_status', _next_status,
        'order_status', next_order_status::text
      );
    END;
    $$;

    REVOKE ALL ON FUNCTION public.advance_delivery_assignment(uuid, text) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.advance_delivery_assignment(uuid, text) TO authenticated;

    NOTIFY pgrst, 'reload schema';
