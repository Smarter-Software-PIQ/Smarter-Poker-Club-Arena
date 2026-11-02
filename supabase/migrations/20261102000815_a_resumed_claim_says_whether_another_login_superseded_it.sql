-- 20261102000815_a_resumed_claim_says_whether_another_login_superseded_it.sql
--
-- A RESUMED CLAIM SAYS WHETHER ANOTHER LOGIN SUPERSEDED IT
--
-- Follow-up to 20261101221013 (single active device per account). A device
-- that is OFFLINE when another device's login kicks it misses the realtime
-- revocation event, and its signature-valid JWT keeps every PostgREST read
-- working for days (the 2026-09-04 lesson), so on resume it looks signed in
-- until it touches the engine. The client now re-verifies through this
-- function on every boot; for that answer to carry the right words
-- ("Your Account Was Signed In On Another Device"), a session_gone refusal
-- must say whether a DIFFERENT login now owns the account (superseded: true)
-- or the session simply died another way, such as an operator force logout
-- (superseded: false).
--
-- Same body as 20261101221013 otherwise; only the session_gone return gains
-- the superseded flag. CREATE OR REPLACE, one transaction, no table changes.

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
  v_prev public.ca_account_active_login;
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

  -- A revoked session's JWT stays signature-valid for days; only a session
  -- GoTrue still holds may claim, so a dead token can never kick anyone.
  -- superseded says whether a DIFFERENT login now owns this account, so the
  -- resuming client can say "Your Account Was Signed In On Another Device"
  -- instead of the generic sign-out message.
  IF NOT EXISTS (
    SELECT 1 FROM auth.sessions
    WHERE id = v_sid AND user_id = v_uid
      AND (not_after IS NULL OR not_after > v_at)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'why', 'session_gone',
      'superseded', EXISTS (
        SELECT 1 FROM public.ca_account_active_login a
        JOIN auth.sessions s ON s.id = a.session_id AND s.user_id = a.user_id
        WHERE a.user_id = v_uid AND a.session_id <> v_sid
          AND (s.not_after IS NULL OR s.not_after > v_at)
      ));
  END IF;

  -- Same per-user lock as fn_ca_player_force_logout: one writer at a time
  -- decides which of this account's sessions live.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text, 731));

  SELECT * INTO v_prev FROM public.ca_account_active_login WHERE user_id = v_uid FOR UPDATE;

  IF NOT FOUND THEN
    -- First claim ever for this account: record, never kick (rollout safety).
    INSERT INTO public.ca_account_active_login(user_id, session_id, device_id, claimed_at, updated_at)
      VALUES (v_uid, v_sid, v_device, v_at, v_at);
    RETURN jsonb_build_object('ok', true, 'kicked', 0, 'first', true);
  END IF;

  IF v_prev.session_id = v_sid THEN
    -- The active login re-asserting itself (tab focus, reload): a no-op.
    IF v_prev.device_id IS DISTINCT FROM v_device AND v_device IS NOT NULL THEN
      UPDATE public.ca_account_active_login SET device_id = v_device, updated_at = v_at
        WHERE user_id = v_uid;
    END IF;
    RETURN jsonb_build_object('ok', true, 'kicked', 0, 'same', true);
  END IF;

  -- A new login. This session is now the only one; every other session dies.
  UPDATE public.ca_account_active_login
    SET session_id = v_sid, device_id = v_device, claimed_at = v_at, updated_at = v_at
    WHERE user_id = v_uid;

  DELETE FROM auth.sessions WHERE user_id = v_uid AND id <> v_sid;
  GET DIAGNOSTICS v_kicked = ROW_COUNT;

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
