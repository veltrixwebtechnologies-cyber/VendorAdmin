-- Defense-in-depth storage constraints for sensitive seller/delivery documents.
UPDATE storage.buckets
SET public = false,
    file_size_limit = 10 * 1024 * 1024,
    allowed_mime_types = ARRAY['application/pdf','image/jpeg','image/png','image/webp']
WHERE id IN ('seller-docs', 'delivery-docs');

CREATE OR REPLACE FUNCTION public.validate_sensitive_document_object()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
DECLARE ext text := lower(split_part(NEW.name, '.', array_length(string_to_array(NEW.name, '.'), 1)));
DECLARE mime text := lower(coalesce(NEW.metadata->>'mimetype', NEW.metadata->>'contentType', ''));
DECLARE size_bytes bigint := NULLIF(NEW.metadata->>'size', '')::bigint;
BEGIN
  IF NEW.bucket_id IN ('seller-docs', 'delivery-docs') THEN
    IF ext NOT IN ('pdf', 'jpg', 'jpeg', 'png', 'webp') THEN
      RAISE EXCEPTION 'Unsupported document extension';
    END IF;
    IF mime NOT IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp') THEN
      RAISE EXCEPTION 'Unsupported document MIME type';
    END IF;
    IF size_bytes IS NOT NULL AND size_bytes > 10 * 1024 * 1024 THEN
      RAISE EXCEPTION 'Document exceeds size limit';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_sensitive_document_object ON storage.objects;
CREATE TRIGGER trg_validate_sensitive_document_object
BEFORE INSERT OR UPDATE ON storage.objects
FOR EACH ROW EXECUTE FUNCTION public.validate_sensitive_document_object();

CREATE TABLE IF NOT EXISTS public.customer_otp_rate_limits (
  account_key text PRIMARY KEY,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  locked_until timestamptz
);
ALTER TABLE public.customer_otp_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_otp_rate_limits FROM anon, authenticated;
GRANT ALL ON public.customer_otp_rate_limits TO service_role;

CREATE OR REPLACE FUNCTION public.consume_customer_otp_rate_limit(_account_key text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.customer_otp_rate_limits; now_ts timestamptz := now();
BEGIN
  INSERT INTO public.customer_otp_rate_limits(account_key) VALUES (lower(trim(_account_key))) ON CONFLICT DO NOTHING;
  SELECT * INTO r FROM public.customer_otp_rate_limits WHERE account_key = lower(trim(_account_key)) FOR UPDATE;
  IF r.locked_until IS NOT NULL AND r.locked_until > now_ts THEN RETURN false; END IF;
  IF r.window_started_at < now_ts - interval '15 minutes' THEN
    UPDATE public.customer_otp_rate_limits SET window_started_at = now_ts, request_count = 1, locked_until = NULL WHERE account_key = r.account_key;
    RETURN true;
  END IF;
  IF r.request_count >= 5 THEN
    UPDATE public.customer_otp_rate_limits SET locked_until = now_ts + interval '30 minutes' WHERE account_key = r.account_key;
    RETURN false;
  END IF;
  UPDATE public.customer_otp_rate_limits SET request_count = request_count + 1 WHERE account_key = r.account_key;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.consume_customer_otp_rate_limit(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_customer_otp_rate_limit(text) TO service_role;
