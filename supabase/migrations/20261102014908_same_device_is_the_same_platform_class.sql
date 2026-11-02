-- 20261102014908_same_device_is_the_same_platform_class.sql
--
-- "THE SAME DEVICE" IS THE PLATFORM CLASS, NOT THE NETWORK ADDRESS
--
-- Dan, 2026-11-01: multiple browsers on the same Mac were still being logged
-- out of each other. The cause: 20261102003027 decided "same device" from the
-- request's network address, and the address reaching the database is an
-- infrastructure egress IP (Azure 52.159.x / 20.83.x, shared across unrelated
-- users and varied per connection by the load balancer), not the client's
-- real IP. Two tabs on one Mac were routed through different egress IPs, so
-- they failed the address match and kicked each other.
--
-- The one device signal that IS reliable in the request is the platform class
-- from the user agent: both browsers on a Mac are 'mac', a phone is 'iphone',
-- an iPad is 'ipad', a Windows PC is 'windows'. That is exactly the device
-- distinction the rule is about (desktop vs mobile vs iPad), and it never
-- varies between two tabs on one machine. So a session is spared from a new
-- login's kick when it was recorded on the SAME known platform class, and the
-- network address is no longer part of the decision (it is still recorded,
-- for diagnostics only). A different platform - phone, iPad, Windows - still
-- kicks every other session, exactly as the single-active-device rule wants.
--
-- CREATE OR REPLACE only; no table changes. Wrap in one transaction.

BEGIN;

CREATE OR REPLACE FUNCTION public.ca_claim_active_login(p_device_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_sid uuid;
  v_device uuid;
  v_headers text;
  v_h jsonb;
  v_net text := '';
  v_ua text := '';
  v_platform text := 'other';
  v_known boolean;
  v_kicked int := 0;
  v_at timestamptz := clock_timestamp();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'why', 'no_user');
  END IF;
  BEGIN
    v_sid := nullif(auth.jwt()->>'session_id', '')::uuid;
  EXCEPTION WHEN others THEN
    v_sid := NULL;
  END;
  IF v_sid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'why', 'no_session_claim');
  END IF;
  BEGIN
    v_device := nullif(p_device_id, '')::uuid;
  EXCEPTION WHEN others THEN
    v_device := NULL; -- device id is telemetry; a malformed one never blocks the claim
  END;

  -- The platform class decides "the same device". The address is recorded for
  -- diagnostics only; it is an unreliable proxy hop and never gates a kick.
  v_headers := current_setting('request.headers', true);
  IF v_headers IS NOT NULL AND pg_input_is_valid(v_headers, 'jsonb') THEN
    v_h := v_headers::jsonb;
    v_net := btrim(coalesce(
      nullif(v_h ->> 'cf-connecting-ip', ''),
      nullif(v_h ->> 'x-real-ip', ''),
      nullif(split_part(v_h ->> 'x-forwarded-for', ',', 1), ''),
      ''));
    v_ua := coalesce(v_h ->> 'user-agent', '');
  END IF;
  IF v_net <> '' AND NOT pg_input_is_valid(v_net, 'inet') THEN
    v_net := '';
  END IF;
  v_platform := CASE
    WHEN v_ua ~* 'ipad' THEN 'ipad'
    WHEN v_ua ~* 'iphone|ipod' THEN 'iphone'
    WHEN v_ua ~* 'android' AND v_ua ~* 'mobile' THEN 'android-phone'
    WHEN v_ua ~* 'android' THEN 'android-tablet'
    -- Note: an iPad set to "Request Desktop Site" reports a Macintosh UA and
    -- so classes as 'mac'; distinguishing it needs a client touch hint, a
    -- separate follow-up. A normal iPad reports 'ipad' above.
    WHEN v_ua ~* 'macintosh|mac os x' THEN 'mac'
    WHEN v_ua ~* 'windows' THEN 'windows'
    WHEN v_ua ~* 'cros' THEN 'chromeos'
    WHEN v_ua ~* 'linux' THEN 'linux'
    ELSE 'other'
  END;

  -- A revoked session's JWT stays signature-valid for days; only a session
  -- GoTrue still holds may claim, so a dead token can never kick anyone.
  IF NOT EXISTS (
    SELECT 1 FROM auth.sessions
    WHERE id = v_sid AND user_id = v_uid
      AND (not_after IS NULL OR not_after > v_at)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'why', 'session_gone',
      'superseded', EXISTS (
        SELECT 1 FROM public.ca_login_sessions l
        JOIN auth.sessions s ON s.id = l.session_id AND s.user_id = l.user_id
        WHERE l.user_id = v_uid AND l.session_id <> v_sid
          AND (s.not_after IS NULL OR s.not_after > v_at)
      ));
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text, 731));

  SELECT true INTO v_known FROM public.ca_login_sessions WHERE session_id = v_sid FOR UPDATE;

  IF v_known THEN
    -- A recorded session re-asserting itself (tab focus, reload, boot
    -- re-verification): a no-op that keeps its identity current.
    UPDATE public.ca_login_sessions
      SET device_id = coalesce(v_device, device_id),
          net = CASE WHEN v_net <> '' THEN v_net ELSE net END,
          platform = CASE WHEN v_platform <> 'other' THEN v_platform ELSE platform END,
          updated_at = v_at
      WHERE session_id = v_sid;
    RETURN jsonb_build_object('ok', true, 'kicked', 0, 'same', true);
  END IF;

  -- This session's FIRST claim: a login. Every other session dies UNLESS it
  -- was recorded on the SAME known platform class - another browser or window
  -- on the same kind of device. An unknown/other class matches nothing, so it
  -- never over-spares.
  DELETE FROM auth.sessions s
    WHERE s.user_id = v_uid AND s.id <> v_sid
      AND NOT EXISTS (
        SELECT 1 FROM public.ca_login_sessions l
        WHERE l.session_id = s.id
          AND v_platform NOT IN ('other', 'unknown')
          AND l.platform = v_platform
      );
  GET DIAGNOSTICS v_kicked = ROW_COUNT;

  DELETE FROM public.ca_login_sessions l
    WHERE l.user_id = v_uid
      AND NOT EXISTS (SELECT 1 FROM auth.sessions s WHERE s.id = l.session_id);
  INSERT INTO public.ca_login_sessions (session_id, user_id, device_id, net, platform, claimed_at, updated_at)
    VALUES (v_sid, v_uid, v_device, v_net, v_platform, v_at, v_at)
  ON CONFLICT (session_id) DO UPDATE
    SET device_id = excluded.device_id, net = excluded.net,
        platform = excluded.platform, updated_at = excluded.updated_at;

  IF v_kicked > 0 THEN
    INSERT INTO public.ca_player_session_revocations(user_id, revoked_before, op_id)
      VALUES (v_uid, v_at, 'device_login:' || coalesce(v_device::text, 'unknown'))
      ON CONFLICT (user_id) DO UPDATE
        SET revoked_before = excluded.revoked_before,
            op_id = excluded.op_id,
            updated_at = now();
  END IF;

  RETURN jsonb_build_object('ok', true, 'kicked', v_kicked);
END
$function$;

REVOKE ALL ON FUNCTION public.ca_claim_active_login(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ca_claim_active_login(text) TO authenticated, service_role;

COMMIT;
