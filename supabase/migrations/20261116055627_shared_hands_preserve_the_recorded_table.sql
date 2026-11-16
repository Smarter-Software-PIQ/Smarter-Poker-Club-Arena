-- A nine-seat recording with 200 chip flights exceeds the original 8,000-character
-- limit even after compression. Retain existing short payloads and permit larger
-- v4 records only when their extra field is a bounded compressed presentation.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE OR REPLACE FUNCTION public.fn_ca_shared_hand_payload_fits(p_payload text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE STRICT SECURITY INVOKER
SET search_path TO pg_catalog AS $$
DECLARE
  raw text;
  fields text[];
  n integer := octet_length(p_payload);
BEGIN
  IF n <= 8000 THEN
    RETURN n >= 16 AND p_payload ~ '^[A-Za-z0-9_~.-]+$';
  END IF;
  IF n > 1048576 OR p_payload !~ '^[A-Za-z0-9_-]+$' THEN RETURN false; END IF;
  raw := convert_from(decode(translate(p_payload, '-_', '+/') ||
    repeat('=', (4 - n % 4) % 4), 'base64'), 'UTF8');
  fields := string_to_array(raw, '~');
  RETURN cardinality(fields) = 22 AND fields[1] = 'v4'
    AND fields[21] <> '' AND fields[22] ~ '^[0-9a-z]{1,4}[.][A-Za-z0-9+/]+$';
EXCEPTION WHEN data_exception THEN RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_ca_shared_hand_payload_fits(text) FROM PUBLIC;
ALTER TABLE public.ca_shared_hands DROP CONSTRAINT ca_shared_hands_payload_check,
  ADD CONSTRAINT ca_shared_hands_payload_check CHECK (public.fn_ca_shared_hand_payload_fits(payload)) NOT VALID;
CREATE OR REPLACE FUNCTION public.fn_ca_shared_hand_reserve(
  p_payload text,
  p_invite_code text DEFAULT NULL,
  p_preview jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_md5    text;
  v_row    public.ca_shared_hands%ROWTYPE;
  v_token  text;
  v_alpha  constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  v_invite text := NULLIF(upper(btrim(COALESCE(p_invite_code, ''))), '');
  v_today  integer;
  v_try    integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;
  -- Length apart from the character set: a Postgres regex repetition count
  -- tops out at 255, so {16,8000} is not a valid pattern.
  IF p_payload IS NULL OR NOT public.fn_ca_shared_hand_payload_fits(p_payload) THEN
    RETURN jsonb_build_object('success', false, 'code', 'bad_payload');
  END IF;
  IF v_invite IS NOT NULL AND v_invite !~ '^[A-HJ-NP-Z2-9]{7}$' THEN
    v_invite := NULL;
  END IF;
  v_md5 := md5(p_payload);

  SELECT * INTO v_row FROM public.ca_shared_hands
   WHERE sender_id = v_uid AND payload_md5 = v_md5 AND revoked_at IS NULL;
  IF FOUND THEN
    IF v_invite IS NOT NULL AND v_row.invite_code IS DISTINCT FROM v_invite THEN
      UPDATE public.ca_shared_hands SET invite_code = v_invite WHERE token = v_row.token;
    END IF;
    RETURN jsonb_build_object('success', true, 'token', v_row.token,
      'sent', v_row.sent_at IS NOT NULL, 'views', v_row.view_count);
  END IF;

  -- A ceiling, not a product limit: nobody opens 500 hands a day by hand.
  SELECT count(*) INTO v_today FROM public.ca_shared_hands
   WHERE sender_id = v_uid AND created_at > now() - interval '1 day';
  IF v_today >= 500 THEN
    RETURN jsonb_build_object('success', false, 'code', 'too_many');
  END IF;

  LOOP
    v_try := v_try + 1;
    SELECT string_agg(substr(v_alpha, 1 + floor(random() * length(v_alpha))::int, 1), '')
      INTO v_token FROM generate_series(1, 8);
    BEGIN
      INSERT INTO public.ca_shared_hands (token, sender_id, payload, payload_md5, invite_code, preview)
      VALUES (v_token, v_uid, p_payload, v_md5, v_invite,
              public.fn_ca_shared_hand_clean_preview(COALESCE(p_preview, '{}'::jsonb)));
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      -- The random token was taken, or a concurrent call reserved this hand
      -- first. Prefer the existing live row.
      SELECT * INTO v_row FROM public.ca_shared_hands
       WHERE sender_id = v_uid AND payload_md5 = v_md5 AND revoked_at IS NULL;
      IF FOUND THEN
        RETURN jsonb_build_object('success', true, 'token', v_row.token,
          'sent', v_row.sent_at IS NOT NULL, 'views', v_row.view_count);
      END IF;
      IF v_try >= 8 THEN RAISE; END IF;
    END;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'token', v_token, 'sent', false, 'views', 0);
END;
$$;
-- Every historical row already passed the stricter original length bound.
ALTER TABLE public.ca_shared_hands VALIDATE CONSTRAINT ca_shared_hands_payload_check;
COMMIT;
