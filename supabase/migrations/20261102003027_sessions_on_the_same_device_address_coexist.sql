-- 20261102003027_sessions_on_the_same_device_address_coexist.sql
--
-- SESSIONS ON THE SAME DEVICE ADDRESS COEXIST
--
-- Dan, 2026-11-01: "When im on the same device like this Mac, i should be
-- able to be logged into multiple screens at once if its the same device
-- address... its only letting me be signed into one browser, and kicking me
-- from all the others." The per-install id cannot say this: Chrome, Safari
-- and the in-app browser on one Mac are three installs. So the DATABASE now
-- decides what "the same device" is, from the claiming request itself (the
-- same headers ca_record_device_sighting reads; the client can forge
-- nothing): the network address plus a coarse platform class. Two browsers
-- on one Mac share both and coexist; a phone, an iPad or another computer
-- differs in at least one and still kicks everything else, exactly as the
-- single-active-device rule (20261101221013) demands.
--
-- HOW. ca_account_active_login (one active session per account) becomes
-- ca_login_sessions (every claimed session, with the address and platform
-- that claimed it). A session's FIRST claim is its login: it revokes every
-- other session EXCEPT those recorded from the same address and platform,
-- then records itself. Re-claims are no-ops, so a tab regaining focus can
-- never kick anyone, and the boot re-verification (20261102000815) keeps
-- its session_gone/superseded answers unchanged. Sessions recorded before
-- this change carry no address, match nothing, and die at the next foreign
-- login - one extra sign-in, once.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ca_login_sessions (
  session_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,          -- no FK: auth tables are hot (CLAUDE.md rule 7)
  device_id uuid,
  net text,                        -- request network address at claim ('' unknown)
  platform text,                   -- coarse class: mac/windows/linux/iphone/ipad/android/other
  claimed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ca_login_sessions_user ON public.ca_login_sessions (user_id);
ALTER TABLE public.ca_login_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_login_sessions FROM public, anon, authenticated, service_role;
GRANT SELECT ON public.ca_login_sessions TO service_role;

-- Carry over the one recorded active session per account, identity unknown.
INSERT INTO public.ca_login_sessions (session_id, user_id, device_id, net, platform, claimed_at, updated_at)
  SELECT session_id, user_id, device_id, '', 'unknown', claimed_at, updated_at
  FROM public.ca_account_active_login
ON CONFLICT (session_id) DO NOTHING;

DROP TABLE public.ca_account_active_login;

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

  -- The device identity comes from the REQUEST, never from the client
  -- (same reading as ca_record_device_sighting).
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
    WHEN v_ua ~* 'iphone' THEN 'iphone'
    WHEN v_ua ~* 'ipad' THEN 'ipad'
    WHEN v_ua ~* 'android' AND v_ua ~* 'mobile' THEN 'android-phone'
    WHEN v_ua ~* 'android' THEN 'android-tablet'
    WHEN v_ua ~* 'macintosh|mac os x' THEN 'mac'
    WHEN v_ua ~* 'windows' THEN 'windows'
    WHEN v_ua ~* 'linux|cros' THEN 'linux'
    ELSE 'other'
  END;

  -- A revoked session's JWT stays signature-valid for days; only a session
  -- GoTrue still holds may claim, so a dead token can never kick anyone.
  -- superseded: a DIFFERENT recorded login is still alive, so the resuming
  -- client says "Your Account Was Signed In On Another Device".
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

  -- Same per-user lock as fn_ca_player_force_logout: one writer at a time
  -- decides which of this account's sessions live.
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
  -- was recorded from the same device address and platform - another browser
  -- window on the same computer. An unknown identity matches nothing.
  DELETE FROM auth.sessions s
    WHERE s.user_id = v_uid AND s.id <> v_sid
      AND NOT EXISTS (
        SELECT 1 FROM public.ca_login_sessions l
        WHERE l.session_id = s.id
          AND v_net <> '' AND l.net = v_net
          AND l.platform = v_platform
      );
  GET DIAGNOSTICS v_kicked = ROW_COUNT;

  -- Record this login, and let go of rows whose sessions no longer exist.
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
