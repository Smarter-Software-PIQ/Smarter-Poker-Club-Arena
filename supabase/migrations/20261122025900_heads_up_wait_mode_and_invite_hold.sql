-- 20261122025900_heads_up_wait_mode_and_invite_hold.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Persists the seated human's Heads-Up Sit N Go wait mode ('play_anyone' vs
-- 'specific_player') in a dedicated small table `public.heads_up_wait_holds`
-- with zero locks on hot tables (`tournaments`, `tables`, `table_seats`):
--   1. `play_anyone` records `hold_expires_at = now()` and `invite_token = NULL`,
--      releasing the 3-7 minute partner hold immediately so the engine can match
--      seat 2 right away.
--   2. `specific_player` mints (or preserves) a cryptographic URL-safe invite
--      token and sets a bounded 5-minute hold (`now() + interval '5 minutes'`,
--      never infinite) so neither the fleet nor uninvited players snipe seat 2
--      during the hold window, and reloading the table preserves the exact mode
--      and invite link. Expired holds (> 5 min) or holds whose creator left
--      automatically fall open.
--   3. Writes occur exclusively through SECURITY DEFINER RPC
--      `public.fn_set_heads_up_wait_mode(uuid, text)`; seat-2 invite verification
--      occurs server-side through `public.fn_check_heads_up_seat_invite(uuid, text)`
--      without ever exposing `invite_token` to non-creators.
--
-- Wrap ALL DDL for one change in ONE transaction: every DDL statement fires
-- Supabase's schema-cache reload, which takes ~28s on this database, and ten
-- loose statements mean ten reloads (club-arena CLAUDE.md, production DDL policy).

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.heads_up_wait_holds (
  tournament_id uuid PRIMARY KEY,
  table_id uuid NOT NULL,
  creator_user_id uuid NOT NULL,
  wait_mode text NOT NULL CHECK (wait_mode IN ('play_anyone', 'specific_player')),
  invite_token text,
  hold_expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT heads_up_wait_holds_mode_contract CHECK (
    (wait_mode = 'play_anyone' AND invite_token IS NULL)
    OR (
      wait_mode = 'specific_player'
      AND invite_token IS NOT NULL
      AND length(invite_token) >= 16
      AND hold_expires_at IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_heads_up_wait_holds_table_id
  ON public.heads_up_wait_holds (table_id);

ALTER TABLE public.heads_up_wait_holds ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.heads_up_wait_holds
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.heads_up_wait_holds TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.heads_up_wait_holds TO service_role;

DROP POLICY IF EXISTS heads_up_wait_holds_select_own ON public.heads_up_wait_holds;
CREATE POLICY heads_up_wait_holds_select_own
  ON public.heads_up_wait_holds
  FOR SELECT
  TO authenticated
  USING (creator_user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.fn_set_heads_up_wait_mode(
  p_table_id uuid,
  p_mode text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid           uuid := auth.uid();
  v_tbl           record;
  v_t             record;
  v_live_count    integer := 0;
  v_caller_seated boolean := false;
  v_existing      public.heads_up_wait_holds%ROWTYPE;
  v_has_existing  boolean := false;
  v_token         text;
  v_expires_at    timestamptz;
  v_max_expires   timestamptz := now() + interval '5 minutes';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'fn_set_heads_up_wait_mode requires an authenticated caller'
      USING ERRCODE = '28000';
  END IF;

  IF p_table_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'table_not_found');
  END IF;

  IF p_mode IS NULL OR p_mode NOT IN ('play_anyone', 'specific_player') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_mode');
  END IF;

  SELECT id, tournament_id, max_players, status
    INTO v_tbl
    FROM public.tables
   WHERE id = p_table_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'table_not_found');
  END IF;

  IF v_tbl.status = 'closed' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'table_closed');
  END IF;

  IF v_tbl.tournament_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_a_heads_up_game');
  END IF;

  SELECT id, status, variant, max_players
    INTO v_t
    FROM public.tournaments
   WHERE id = v_tbl.tournament_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'game_not_found');
  END IF;

  IF upper(COALESCE(v_t.status::text, '')) NOT IN ('ANNOUNCED', 'REGISTERING') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'game_already_started');
  END IF;

  IF COALESCE(v_t.max_players, v_tbl.max_players, 0) <> 2
     OR COALESCE(v_t.variant, '') = 'spin' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_a_heads_up_game');
  END IF;

  SELECT count(*)::integer, COALESCE(bool_or(user_id = v_uid), false)
    INTO v_live_count, v_caller_seated
    FROM public.table_seats
   WHERE table_id = p_table_id
     AND left_at IS NULL;

  IF NOT v_caller_seated THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_seated');
  END IF;

  IF v_live_count <> 1 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'opponent_already_seated');
  END IF;

  IF p_mode = 'play_anyone' THEN
    v_token := NULL;
    v_expires_at := now();
  ELSE
    SELECT *
      INTO v_existing
      FROM public.heads_up_wait_holds
     WHERE tournament_id = v_t.id;
    v_has_existing := FOUND;

    IF v_has_existing
       AND v_existing.creator_user_id = v_uid
       AND v_existing.wait_mode = 'specific_player'
       AND v_existing.invite_token IS NOT NULL
       AND length(v_existing.invite_token) >= 16 THEN
      v_token := v_existing.invite_token;
      IF v_existing.hold_expires_at IS NOT NULL AND v_existing.hold_expires_at > now() THEN
        v_expires_at := LEAST(v_existing.hold_expires_at, v_max_expires);
      ELSE
        v_expires_at := v_max_expires;
      END IF;
    ELSE
      v_token := replace(gen_random_uuid()::text, '-', '');
      v_expires_at := v_max_expires;
    END IF;
  END IF;

  INSERT INTO public.heads_up_wait_holds (
    tournament_id,
    table_id,
    creator_user_id,
    wait_mode,
    invite_token,
    hold_expires_at,
    updated_at
  )
  VALUES (
    v_t.id,
    p_table_id,
    v_uid,
    p_mode,
    v_token,
    v_expires_at,
    now()
  )
  ON CONFLICT (tournament_id) DO UPDATE SET
    table_id = EXCLUDED.table_id,
    creator_user_id = EXCLUDED.creator_user_id,
    wait_mode = EXCLUDED.wait_mode,
    invite_token = EXCLUDED.invite_token,
    hold_expires_at = EXCLUDED.hold_expires_at,
    updated_at = now();

  RETURN jsonb_build_object(
    'ok', true,
    'mode', p_mode,
    'tournament_id', v_t.id,
    'table_id', p_table_id,
    'invite_token', v_token,
    'hold_expires_at', v_expires_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_set_heads_up_wait_mode(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_set_heads_up_wait_mode(uuid, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_check_heads_up_seat_invite(
  p_table_id uuid,
  p_invite_token text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid                  uuid := auth.uid();
  v_tbl                  record;
  v_hold                 public.heads_up_wait_holds%ROWTYPE;
  v_creator_still_seated boolean := false;
  v_clean_token          text := NULLIF(btrim(COALESCE(p_invite_token, '')), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'fn_check_heads_up_seat_invite requires an authenticated caller'
      USING ERRCODE = '28000';
  END IF;

  IF p_table_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'allowed', true, 'reserved', false);
  END IF;

  SELECT id, tournament_id, status
    INTO v_tbl
    FROM public.tables
   WHERE id = p_table_id;

  IF NOT FOUND OR v_tbl.tournament_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'allowed', true, 'reserved', false);
  END IF;

  SELECT *
    INTO v_hold
    FROM public.heads_up_wait_holds
   WHERE tournament_id = v_tbl.tournament_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'allowed', true, 'reserved', false);
  END IF;

  IF v_hold.wait_mode <> 'specific_player' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'allowed', true,
      'reserved', false,
      'wait_mode', v_hold.wait_mode
    );
  END IF;

  IF v_hold.hold_expires_at IS NULL OR v_hold.hold_expires_at <= now() THEN
    RETURN jsonb_build_object(
      'ok', true,
      'allowed', true,
      'reserved', false,
      'expired', true,
      'wait_mode', 'specific_player'
    );
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM public.table_seats
     WHERE table_id = p_table_id
       AND user_id = v_hold.creator_user_id
       AND left_at IS NULL
  ) INTO v_creator_still_seated;

  IF NOT COALESCE(v_creator_still_seated, false) THEN
    RETURN jsonb_build_object(
      'ok', true,
      'allowed', true,
      'reserved', false,
      'creator_left', true
    );
  END IF;

  IF v_uid = v_hold.creator_user_id THEN
    RETURN jsonb_build_object(
      'ok', true,
      'allowed', true,
      'reserved', true,
      'is_creator', true,
      'hold_expires_at', v_hold.hold_expires_at
    );
  END IF;

  IF v_clean_token IS NOT NULL
     AND v_hold.invite_token IS NOT NULL
     AND v_clean_token = v_hold.invite_token THEN
    RETURN jsonb_build_object(
      'ok', true,
      'allowed', true,
      'reserved', true,
      'token_valid', true,
      'hold_expires_at', v_hold.hold_expires_at
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', false,
    'allowed', false,
    'reserved', true,
    'reason', 'heads_up_invite_required',
    'hold_expires_at', v_hold.hold_expires_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_check_heads_up_seat_invite(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_check_heads_up_seat_invite(uuid, text)
  TO authenticated, service_role;

-- Post-apply security assertions (fail closed if RLS or grants drift).
DO $post$
DECLARE
  v_rls boolean;
BEGIN
  SELECT c.relrowsecurity
    INTO v_rls
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'heads_up_wait_holds';

  IF v_rls IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'heads_up_wait_holds must have row level security enabled';
  END IF;

  IF has_table_privilege('anon', 'public.heads_up_wait_holds', 'SELECT')
     OR has_table_privilege('anon', 'public.heads_up_wait_holds', 'INSERT') THEN
    RAISE EXCEPTION 'anon must not have table privileges on heads_up_wait_holds';
  END IF;

  IF has_table_privilege('authenticated', 'public.heads_up_wait_holds', 'INSERT')
     OR has_table_privilege('authenticated', 'public.heads_up_wait_holds', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.heads_up_wait_holds', 'DELETE') THEN
    RAISE EXCEPTION 'authenticated must not write directly to heads_up_wait_holds';
  END IF;

  IF has_function_privilege('anon', 'public.fn_set_heads_up_wait_mode(uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not execute fn_set_heads_up_wait_mode';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.fn_set_heads_up_wait_mode(uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated must be able to execute fn_set_heads_up_wait_mode';
  END IF;

  IF has_function_privilege('anon', 'public.fn_check_heads_up_seat_invite(uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not execute fn_check_heads_up_seat_invite';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.fn_check_heads_up_seat_invite(uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated must be able to execute fn_check_heads_up_seat_invite';
  END IF;
END;
$post$;

-- Function probes (tests/a-migration-proves-its-functions-before-commit.law.test.ts):
-- each new SECURITY DEFINER PL/pgSQL body runs once inside a subtransaction that
-- always unwinds.

-- @probe-for: public.fn_set_heads_up_wait_mode
DO $probe$
DECLARE
  v_actor uuid := gen_random_uuid();
  v_res   jsonb;
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_actor, 'role', 'authenticated')::text,
    true
  );
  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  v_res := public.fn_set_heads_up_wait_mode(gen_random_uuid(), 'specific_player');
  IF COALESCE((v_res->>'ok')::boolean, true) IS NOT FALSE
     OR v_res->>'reason' <> 'table_not_found' THEN
    RAISE EXCEPTION 'unexpected probe result from fn_set_heads_up_wait_mode: %', v_res;
  END IF;

  v_res := public.fn_set_heads_up_wait_mode(gen_random_uuid(), 'play_anyone');
  IF COALESCE((v_res->>'ok')::boolean, true) IS NOT FALSE
     OR v_res->>'reason' <> 'table_not_found' THEN
    RAISE EXCEPTION 'unexpected probe result from fn_set_heads_up_wait_mode (play_anyone): %', v_res;
  END IF;

  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_check_heads_up_seat_invite
DO $probe$
DECLARE
  v_actor uuid := gen_random_uuid();
  v_res   jsonb;
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_actor, 'role', 'authenticated')::text,
    true
  );
  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  v_res := public.fn_check_heads_up_seat_invite(gen_random_uuid(), NULL);
  IF COALESCE((v_res->>'allowed')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'unexpected probe result from fn_check_heads_up_seat_invite: %', v_res;
  END IF;

  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
