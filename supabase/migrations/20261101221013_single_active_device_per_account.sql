-- 20261101221013_single_active_device_per_account.sql
--
-- SINGLE ACTIVE DEVICE PER ACCOUNT: A NEW LOGIN REVOKES EVERY OTHER SESSION
--
-- Dan, 2026-11-01: "Every other poker app and site in the world kicks you out
-- of one device when you log into your account from another device, we don't
-- and that needs to be fixed... regardless if its desktop, mobile or ipad, it
-- needs to log out of all previous sessions. You can have multiple desktop
-- windows and login's open, just not different devices."
--
-- HOW IT WORKS. The client claims its login after sign-in through
-- ca_claim_active_login (src/lib/activeLogin.ts). A claim from a NEW GoTrue
-- session - a real login; re-emitted auth events carry the same session_id
-- and are no-ops - deletes every other auth.sessions row for the account
-- (FK cascade takes the refresh tokens) and upserts
-- ca_player_session_revocations: the SAME event fn_ca_player_force_logout
-- raises, so everything downstream is already built and proven -
--   - the engine re-verdicts every socket (fn_ca_player_session_live says the
--     deleted sessions are gone) and closes the kicked device's tables,
--   - every kicked client's revocation channel probes GoTrue and bounces to
--     sign-in (src/lib/sessionRevoked.ts).
-- Windows and tabs of the same browser share one session, so "multiple
-- desktop windows and logins" keep working; only a different install dies.
--
-- ROLLOUT SAFETY. The very first claim for an account only records itself: a
-- re-announced pre-feature session (a tab regaining focus can re-emit
-- SIGNED_IN) must not kick a device mid-hand on the day this ships. Every
-- claim after that enforces. A signature-valid JWT can outlive its revoked
-- session by days (2026-09-04 outage), so only a session GoTrue still holds
-- may claim - a dead token can never kick anyone.
--
-- Wrap ALL DDL for one change in ONE transaction (CLAUDE.md DDL policy).

BEGIN;

-- No FK to auth.users: auth.users is written on every login, and a cursor
-- table never carries a foreign key to a hot relation (CLAUDE.md rule 7).
-- An orphan row for a deleted account is harmless.
CREATE TABLE IF NOT EXISTS public.ca_account_active_login (
  user_id uuid PRIMARY KEY,
  session_id uuid NOT NULL,
  device_id uuid,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ca_account_active_login ENABLE ROW LEVEL SECURITY;
-- Definer-only table: the claim function is the single writer. service_role
-- keeps read access for operator tooling and nothing else (policy 2.9).
REVOKE ALL ON public.ca_account_active_login FROM public, anon, authenticated, service_role;
GRANT SELECT ON public.ca_account_active_login TO service_role;

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
  IF NOT EXISTS (
    SELECT 1 FROM auth.sessions
    WHERE id = v_sid AND user_id = v_uid
      AND (not_after IS NULL OR not_after > v_at)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'why', 'session_gone');
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
