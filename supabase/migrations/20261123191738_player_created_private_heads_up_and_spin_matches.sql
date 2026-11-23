-- @live-proof: (to_regclass('public.private_seat_first_matches') IS NOT NULL AND to_regprocedure('public.fn_create_private_seat_first_match(uuid)') IS NOT NULL AND to_regprocedure('public.fn_close_private_seat_first_match(uuid)') IS NOT NULL AND to_regprocedure('public.fn_private_seat_first_lobby_state(uuid)') IS NOT NULL AND NOT has_function_privilege('anon', 'public.fn_create_private_seat_first_match(uuid)', 'EXECUTE') AND has_function_privilege('authenticated', 'public.fn_create_private_seat_first_match(uuid)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.fn_close_private_seat_first_match(uuid)', 'EXECUTE') AND has_function_privilege('authenticated', 'public.fn_close_private_seat_first_match(uuid)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.fn_private_seat_first_lobby_state(uuid)', 'EXECUTE') AND has_function_privilege('authenticated', 'public.fn_private_seat_first_lobby_state(uuid)', 'EXECUTE') AND NOT has_table_privilege('authenticated', 'public.private_seat_first_matches', 'SELECT') AND NOT has_table_privilege('anon', 'public.private_seat_first_matches', 'SELECT') AND strpos(pg_get_functiondef('public.fn_private_game_hold_view(uuid)'::regprocedure), 'private_seat_first_matches') > 0 AND strpos(pg_get_functiondef('public.fn_private_game_entry_refusal(uuid,uuid)'::regprocedure), 'private_seat_first_matches') > 0)
--
-- 20261123191738_player_created_private_heads_up_and_spin_matches.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- OWNER RULING (2026-11-23):
--   - Any club/union player can create a Private Heads-Up Match (2-max) or
--     Private Spin (3-max) at the very top of the Sit & Go / Spins lobby.
--   - Players pick ONLY Game, Stakes (Buy-In), and Starting Chips from what
--     the club/union CURRENTLY OFFERS on its active boards (never unoffered
--     variants, stakes, or stack sizes). Blind levels, rake, payout shape,
--     and everything else are automatically inherited from that offered board.
--   - Strictly link-only: nobody else (neither public players nor Horses) can
--     join except holders of the creator's invite link; it NEVER expires open
--     to the public.
--   - The creator can Unregister & Close the event at any time before it
--     starts: every seated player is refunded atomically through
--     fn_ca_unregister_tournament_player_exact, and the event is permanently
--     closed (CANCELLED) so a new one must be created.
--
-- ORDINARY MIGRATION: creates one new companion table and CREATE OR REPLACE
-- FUNCTIONs only; zero ALTER TABLE or trigger locks on live tables.

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $pre$
BEGIN
  IF to_regclass('public.private_game_holds') IS NULL
     OR to_regclass('public.private_game_admissions') IS NULL
     OR to_regprocedure('public.fn_ca_private_game_hold_open(uuid,uuid,uuid,integer,boolean)') IS NULL
     OR to_regprocedure('public.fn_create_seat_first_game_atomic(uuid,jsonb)') IS NULL
     OR to_regprocedure('public.fn_ca_unregister_tournament_player_exact(uuid,uuid,uuid,text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'private seat-first matches require private_game_holds and seat-first creation/refund doors';
  END IF;
END;
$pre$;

CREATE TABLE IF NOT EXISTS public.private_seat_first_matches (
  tournament_id        uuid PRIMARY KEY,
  club_id              uuid NOT NULL,
  union_id             uuid,
  source_tournament_id uuid NOT NULL,
  creator_user_id      uuid NOT NULL,
  format               text NOT NULL CHECK (format IN ('heads_up', 'spin')),
  status               text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'started', 'closed')),
  closed_at            timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.private_seat_first_matches IS
  'Player-created strictly-private Heads-Up Matches and Private Spins (2026-11-23). Always cloned from a currently offered public board; link-only forever (never falls open to public or Horses); creator unregister permanently closes and cancels the event. No foreign key to tournaments on purpose (CLAUDE.md section 2 rule 7).';

CREATE INDEX IF NOT EXISTS idx_private_seat_first_matches_club_status
  ON public.private_seat_first_matches (club_id, status);
CREATE INDEX IF NOT EXISTS idx_private_seat_first_matches_union_status
  ON public.private_seat_first_matches (union_id, status)
  WHERE union_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_private_seat_first_matches_creator_status
  ON public.private_seat_first_matches (creator_user_id, status);

ALTER TABLE public.private_seat_first_matches ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.private_seat_first_matches FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.private_seat_first_matches TO service_role;

-- ---------------------------------------------------------------------------
-- Hold view: permanent private matches never expire open on a 10-min timer.
-- Returns a rolling 15-minute hold_expires_at while open so the serving
-- engine's 4-second poll keeps privateHoldIsLive=true and exclusive=true.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_private_game_hold_view(p_tournament_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_hold            public.private_game_holds%ROWTYPE;
  v_match           public.private_seat_first_matches%ROWTYPE;
  v_is_perm         boolean := false;
  v_t               record;
  v_deadline        timestamptz;
  v_creator_in      boolean := false;
  v_live_entries    integer := 0;
  v_invitees_in     integer := 0;
  v_admitted        integer := 0;
  v_open_status     boolean;
  v_live            boolean;
  v_outcome         text;
BEGIN
  SELECT * INTO v_hold FROM public.private_game_holds WHERE tournament_id = p_tournament_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_match
    FROM public.private_seat_first_matches
   WHERE tournament_id = p_tournament_id;
  v_is_perm := FOUND;

  SELECT id, status, max_players, started_at
    INTO v_t
    FROM public.tournaments
   WHERE id = p_tournament_id;

  v_open_status := FOUND
    AND upper(COALESCE(v_t.status::text, '')) IN ('ANNOUNCED', 'REGISTERING')
    AND v_t.started_at IS NULL;

  SELECT count(*)::integer,
         COALESCE(bool_or(tp.user_id = v_hold.creator_user_id), false)
    INTO v_live_entries, v_creator_in
    FROM public.tournament_players tp
   WHERE tp.tournament_id = p_tournament_id
     AND tp.status::text IN ('registered', 'playing');

  SELECT count(*)::integer,
         count(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM public.tournament_players tp
            WHERE tp.tournament_id = a.tournament_id
              AND tp.user_id = a.user_id
              AND tp.status::text IN ('registered', 'playing')))::integer
    INTO v_admitted, v_invitees_in
    FROM public.private_game_admissions a
   WHERE a.tournament_id = p_tournament_id
     AND a.user_id <> v_hold.creator_user_id;

  IF v_is_perm THEN
    v_outcome := CASE
      WHEN v_match.status = 'closed' OR v_hold.status = 'cancelled' THEN 'closed'
      WHEN NOT v_open_status THEN 'started'
      WHEN NOT v_creator_in THEN 'creator_left'
      WHEN v_invitees_in >= v_hold.seats_held THEN 'fulfilled'
      ELSE 'holding'
    END;
    v_live := v_outcome = 'holding';
    v_deadline := CASE
      WHEN v_live THEN clock_timestamp() + interval '15 minutes'
      ELSE COALESCE(v_match.closed_at, v_hold.cancelled_at, v_hold.hold_expires_at)
    END;
  ELSE
    v_deadline := public.fn_private_game_hold_deadline(v_hold.hold_started_at, v_hold.hold_seconds);
    v_outcome := CASE
      WHEN v_hold.status = 'cancelled' THEN 'cancelled'
      WHEN NOT v_open_status THEN 'started'
      WHEN NOT v_creator_in THEN 'creator_left'
      WHEN v_invitees_in >= v_hold.seats_held THEN 'fulfilled'
      WHEN v_deadline IS NULL OR v_deadline <= clock_timestamp() THEN 'expired'
      ELSE 'holding'
    END;
    v_live := v_outcome = 'holding';
  END IF;

  RETURN jsonb_build_object(
    'tournament_id', v_hold.tournament_id,
    'source_tournament_id', v_hold.source_tournament_id,
    'creator_user_id', v_hold.creator_user_id,
    'seats_held', v_hold.seats_held,
    'exclusive', CASE WHEN v_is_perm THEN true ELSE v_hold.exclusive END,
    'permanent_private', v_is_perm,
    'max_players', COALESCE(v_t.max_players, 0),
    'live_entries', v_live_entries,
    'admitted', v_admitted,
    'invitees_seated', v_invitees_in,
    'held_open', CASE WHEN v_live THEN GREATEST(v_hold.seats_held - v_invitees_in, 0) ELSE 0 END,
    'live', v_live,
    'outcome', v_outcome,
    'hold_started_at', v_hold.hold_started_at,
    'hold_expires_at', v_deadline
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_private_game_hold_view(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_private_game_hold_view(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Entry refusal rule: custom private matches NEVER open to uninvited players.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_private_game_entry_refusal(
  p_tournament_id uuid,
  p_user_id uuid
)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_match public.private_seat_first_matches%ROWTYPE;
  v_view  jsonb;
  v_open  integer;
BEGIN
  IF p_tournament_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_match
    FROM public.private_seat_first_matches
   WHERE tournament_id = p_tournament_id;
  IF FOUND THEN
    IF v_match.status = 'closed' THEN
      RETURN 'private_game_closed';
    END IF;
    IF p_user_id IS NOT NULL AND p_user_id = v_match.creator_user_id THEN
      RETURN NULL;
    END IF;
    IF p_user_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.private_game_admissions a
       WHERE a.tournament_id = p_tournament_id AND a.user_id = p_user_id
    ) THEN
      v_view := public.fn_private_game_hold_view(p_tournament_id);
      IF v_view IS NOT NULL AND (v_view->>'outcome') IN ('closed', 'creator_left') THEN
        RETURN 'private_game_closed';
      END IF;
      RETURN NULL;
    END IF;
    RETURN 'private_game_seat_held';
  END IF;

  v_view := public.fn_private_game_hold_view(p_tournament_id);
  IF v_view IS NULL OR (v_view->>'live')::boolean IS NOT TRUE THEN
    RETURN NULL;
  END IF;
  IF p_user_id IS NOT NULL AND p_user_id = (v_view->>'creator_user_id')::uuid THEN
    RETURN NULL;
  END IF;
  IF p_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.private_game_admissions a
     WHERE a.tournament_id = p_tournament_id AND a.user_id = p_user_id
  ) THEN
    RETURN NULL;
  END IF;
  IF (v_view->>'exclusive')::boolean THEN
    RETURN 'private_game_seat_held';
  END IF;
  v_open := GREATEST((v_view->>'max_players')::integer - (v_view->>'live_entries')::integer, 0);
  IF v_open <= (v_view->>'held_open')::integer THEN
    RETURN 'private_game_seat_held';
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_private_game_entry_refusal(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_private_game_entry_refusal(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Accept invite: closed custom private matches stay closed (never fall open).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_accept_private_game_invite(
  p_tournament_id uuid,
  p_invite_token text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid      uuid := auth.uid();
  v_token    text := NULLIF(btrim(COALESCE(p_invite_token, '')), '');
  v_hold     public.private_game_holds%ROWTYPE;
  v_is_perm  boolean := false;
  v_view     jsonb;
  v_refusal  text;
  v_base     jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'fn_accept_private_game_invite requires an authenticated caller'
      USING ERRCODE = '28000';
  END IF;
  IF p_tournament_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'allowed', true, 'reserved', false);
  END IF;

  PERFORM 1 FROM public.tournaments WHERE id = p_tournament_id FOR NO KEY UPDATE;

  SELECT * INTO v_hold FROM public.private_game_holds WHERE tournament_id = p_tournament_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'allowed', true, 'reserved', false);
  END IF;

  v_is_perm := EXISTS (
    SELECT 1 FROM public.private_seat_first_matches m WHERE m.tournament_id = p_tournament_id
  );
  v_view := public.fn_private_game_hold_view(p_tournament_id);
  v_base := jsonb_build_object(
    'tournament_id', p_tournament_id,
    'table_id', public.fn_tournament_primary_table(p_tournament_id),
    'exclusive', v_view->'exclusive',
    'permanent_private', v_is_perm,
    'seats_held', v_view->'seats_held',
    'held_open', v_view->'held_open',
    'outcome', v_view->'outcome',
    'hold_expires_at', v_view->'hold_expires_at');

  IF (v_view->>'live')::boolean IS NOT TRUE THEN
    IF v_is_perm THEN
      RETURN v_base || jsonb_build_object(
        'ok', false,
        'allowed', false,
        'reserved', true,
        'reason', CASE WHEN (v_view->>'outcome') = 'started' THEN 'game_already_started' ELSE 'private_game_closed' END,
        'token_valid', v_token IS NOT NULL AND v_token = v_hold.invite_token);
    END IF;
    RETURN v_base || jsonb_build_object('ok', true, 'allowed', true, 'reserved', false,
      'token_valid', v_token IS NOT NULL AND v_token = v_hold.invite_token);
  END IF;
  IF v_uid = v_hold.creator_user_id THEN
    RETURN v_base || jsonb_build_object('ok', true, 'allowed', true, 'reserved', true, 'is_creator', true);
  END IF;
  IF EXISTS (SELECT 1 FROM public.private_game_admissions a
              WHERE a.tournament_id = p_tournament_id AND a.user_id = v_uid) THEN
    RETURN v_base || jsonb_build_object('ok', true, 'allowed', true, 'reserved', true, 'admitted', true);
  END IF;
  IF v_token IS NOT NULL AND v_token = v_hold.invite_token THEN
    IF (v_view->>'admitted')::integer >= v_hold.seats_held THEN
      RETURN v_base || jsonb_build_object('ok', false, 'allowed', false, 'reserved', true,
        'reason', 'private_game_full');
    END IF;
    INSERT INTO public.private_game_admissions (tournament_id, user_id)
    VALUES (p_tournament_id, v_uid)
    ON CONFLICT (tournament_id, user_id) DO NOTHING;
    RETURN v_base || jsonb_build_object('ok', true, 'allowed', true, 'reserved', true,
      'admitted', true, 'token_valid', true);
  END IF;

  v_refusal := public.fn_private_game_entry_refusal(p_tournament_id, v_uid);
  IF v_refusal IS NULL THEN
    RETURN v_base || jsonb_build_object('ok', true, 'allowed', true, 'reserved', false);
  END IF;
  RETURN v_base || jsonb_build_object('ok', false, 'allowed', false, 'reserved', true,
    'reason', v_refusal, 'token_valid', false);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_accept_private_game_invite(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_accept_private_game_invite(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Cancel hold: refuses releasing a permanent private match to the public.
-- Creators must call fn_close_private_seat_first_match to unregister & close.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_cancel_private_game_hold(p_tournament_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid  uuid := auth.uid();
  v_rows integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'fn_cancel_private_game_hold requires an authenticated caller'
      USING ERRCODE = '28000';
  END IF;
  IF p_tournament_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'game_not_found');
  END IF;
  PERFORM 1 FROM public.tournaments WHERE id = p_tournament_id FOR NO KEY UPDATE;
  IF EXISTS (SELECT 1 FROM public.private_seat_first_matches m WHERE m.tournament_id = p_tournament_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'use_close_private_match');
  END IF;
  UPDATE public.private_game_holds
     SET status = 'cancelled', cancelled_at = now(), updated_at = now()
   WHERE tournament_id = p_tournament_id
     AND creator_user_id = v_uid
     AND status = 'holding';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_hold');
  END IF;
  UPDATE public.heads_up_wait_holds
     SET wait_mode = 'play_anyone', invite_token = NULL, hold_expires_at = now(), updated_at = now()
   WHERE tournament_id = p_tournament_id
     AND creator_user_id = v_uid;
  RETURN jsonb_build_object('ok', true, 'outcome', 'cancelled', 'tournament_id', p_tournament_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_cancel_private_game_hold(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_cancel_private_game_hold(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Hold state readback: surfaces permanent_private to creator and invitee.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_private_game_hold_state(
  p_tournament_id uuid,
  p_invite_token text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_token text := NULLIF(btrim(COALESCE(p_invite_token, '')), '');
  v_hold  public.private_game_holds%ROWTYPE;
  v_view  jsonb;
  v_name  text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'fn_private_game_hold_state requires an authenticated caller'
      USING ERRCODE = '28000';
  END IF;
  IF p_tournament_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'held', false);
  END IF;
  SELECT * INTO v_hold FROM public.private_game_holds WHERE tournament_id = p_tournament_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'held', false);
  END IF;
  v_view := public.fn_private_game_hold_view(p_tournament_id);
  IF v_uid = v_hold.creator_user_id THEN
    RETURN jsonb_build_object('ok', true, 'held', true, 'is_creator', true,
      'invite_token', v_hold.invite_token,
      'table_id', public.fn_tournament_primary_table(p_tournament_id))
      || (v_view - 'creator_user_id' - 'source_tournament_id');
  END IF;
  IF (v_token IS NOT NULL AND v_token = v_hold.invite_token)
     OR EXISTS (SELECT 1 FROM public.private_game_admissions a
                 WHERE a.tournament_id = p_tournament_id AND a.user_id = v_uid) THEN
    SELECT COALESCE(NULLIF(btrim(p.display_name), ''), NULLIF(btrim(p.username), ''), 'Your Friend')
      INTO v_name
      FROM public.profiles p WHERE p.id = v_hold.creator_user_id;
  END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'held', true,
    'is_creator', false,
    'table_id', public.fn_tournament_primary_table(p_tournament_id),
    'inviter_name', v_name,
    'token_valid', v_token IS NOT NULL AND v_token = v_hold.invite_token,
    'admitted', EXISTS (SELECT 1 FROM public.private_game_admissions a
                         WHERE a.tournament_id = p_tournament_id AND a.user_id = v_uid),
    'live', v_view->'live',
    'outcome', v_view->'outcome',
    'exclusive', v_view->'exclusive',
    'permanent_private', COALESCE((v_view->>'permanent_private')::boolean, false),
    'seats_held', v_view->'seats_held',
    'held_open', v_view->'held_open',
    'max_players', v_view->'max_players',
    'live_entries', v_view->'live_entries',
    'hold_expires_at', v_view->'hold_expires_at');
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_private_game_hold_state(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_private_game_hold_state(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Live holds for the engine: always includes open permanent private matches.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_private_game_live_holds()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_out jsonb;
BEGIN
  IF COALESCE(auth.role(), 'service_role') <> 'service_role' THEN
    RAISE EXCEPTION 'fn_private_game_live_holds is for the engine' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(v ORDER BY v->>'tournament_id'), '[]'::jsonb)
    INTO v_out
    FROM (
      SELECT public.fn_private_game_hold_view(h.tournament_id) - 'creator_user_id' AS v
        FROM public.private_game_holds h
       WHERE h.status = 'holding'
         AND (
           h.hold_expires_at > now() - interval '30 minutes'
           OR EXISTS (
             SELECT 1 FROM public.private_seat_first_matches m
              WHERE m.tournament_id = h.tournament_id
                AND m.status = 'open'
           )
         )
    ) s
   WHERE v IS NOT NULL;
  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_private_game_live_holds()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_private_game_live_holds() TO service_role;

-- ---------------------------------------------------------------------------
-- CREATE PRIVATE HEADS-UP MATCH OR PRIVATE SPIN FROM A CURRENTLY OFFERED BOARD
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_create_private_seat_first_match(
  p_source_tournament_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid           uuid := auth.uid();
  v_src           public.tournaments%ROWTYPE;
  v_srcj          jsonb;
  v_format        text;
  v_is_spin       boolean := false;
  v_open_count    integer := 0;
  v_window        text;
  v_new_id        uuid;
  v_create        jsonb;
  v_table_id      uuid;
  v_hold          jsonb;
  v_buy           jsonb;
  v_config        jsonb;
  v_identity_keys text[] := ARRAY[
    'club_id', 'union_id', 'name', 'game_type', 'variant', 'tournament_type',
    'buy_in_amount', 'buy_in_fee', 'guaranteed_prize', 'starting_chips',
    'max_players', 'min_players', 'table_size', 'satellite_target_id',
    'satellite_seats', 'format_contract'];
  v_mismatch      text;
  v_reason        text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'fn_create_private_seat_first_match requires an authenticated caller'
      USING ERRCODE = '28000';
  END IF;
  IF NOT public.fn_caller_session_is_live() THEN
    RAISE EXCEPTION 'SESSION_REVOKED: this session is signed out - sign in again'
      USING ERRCODE = '28000';
  END IF;
  IF p_source_tournament_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'source_not_offered');
  END IF;

  SELECT * INTO v_src FROM public.tournaments WHERE id = p_source_tournament_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'source_not_offered');
  END IF;

  -- Must clone a currently offered PUBLIC board, never another private match.
  IF EXISTS (
    SELECT 1 FROM public.private_seat_first_matches m WHERE m.tournament_id = v_src.id
  ) OR EXISTS (
    SELECT 1 FROM public.private_game_holds h
     WHERE h.tournament_id = v_src.id AND h.exclusive = true
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'source_not_offered');
  END IF;

  IF upper(COALESCE(v_src.status::text, '')) NOT IN ('ANNOUNCED', 'REGISTERING', 'RUNNING') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'source_not_offered');
  END IF;

  v_srcj := to_jsonb(v_src);
  IF COALESCE((v_srcj->>'is_satellite')::boolean, false)
     OR upper(COALESCE(v_src.tournament_type::text, '')) = 'SATELLITE'
     OR COALESCE(v_srcj->>'format_contract', '') = 'seat-first-satellite-v1'
     OR v_src.satellite_target_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'format_not_supported');
  END IF;

  v_is_spin := lower(COALESCE(v_src.variant, '')) = 'spin'
    OR upper(COALESCE(v_src.tournament_type::text, '')) = 'SPIN'
    OR COALESCE(v_srcj->>'format_contract', '') = 'spin-v1';

  IF v_is_spin AND COALESCE(v_src.max_players, 0) = 3 THEN
    v_format := 'spin';
  ELSIF NOT v_is_spin AND COALESCE(v_src.max_players, 0) = 2 THEN
    v_format := 'heads_up';
  ELSE
    RETURN jsonb_build_object('ok', false, 'reason', 'format_not_supported');
  END IF;

  -- Bound active open custom private matches per creator (prevents lobby spam).
  SELECT count(*)::integer INTO v_open_count
    FROM public.private_seat_first_matches m
    JOIN public.tournaments t ON t.id = m.tournament_id
   WHERE m.creator_user_id = v_uid
     AND m.status = 'open'
     AND upper(COALESCE(t.status::text, '')) IN ('ANNOUNCED', 'REGISTERING')
     AND t.started_at IS NULL;
  IF v_open_count >= 5 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'too_many_open_private_matches');
  END IF;

  v_window := public.fn_daily_window_entry_refusal(v_src.id);
  IF v_window IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', v_window);
  END IF;

  v_config := jsonb_build_object(
    'club_id', v_srcj->'club_id',
    'union_id', v_srcj->'union_id',
    'name', v_srcj->'name',
    'game_type', v_srcj->'game_type',
    'variant', v_srcj->'variant',
    'tournament_type', v_srcj->'tournament_type',
    'buy_in_amount', v_srcj->'buy_in_amount',
    'buy_in_fee', v_srcj->'buy_in_fee',
    'guaranteed_prize', v_srcj->'guaranteed_prize',
    'starting_chips', v_srcj->'starting_chips',
    'max_players', v_srcj->'max_players',
    'min_players', v_srcj->'min_players',
    'table_size', v_srcj->'table_size',
    'current_players', 0,
    'status', 'REGISTERING',
    'blind_structure', CASE jsonb_typeof(v_srcj->'blind_structure')
                         WHEN 'string' THEN (v_srcj->>'blind_structure')::jsonb
                         ELSE v_srcj->'blind_structure' END,
    'payout_structure', CASE jsonb_typeof(v_srcj->'payout_structure')
                          WHEN 'string' THEN (v_srcj->>'payout_structure')::jsonb
                          ELSE v_srcj->'payout_structure' END,
    'start_time', now() + interval '10 minutes',
    'late_reg_levels', v_srcj->'late_reg_levels',
    'late_reg_mins', v_srcj->'late_reg_mins',
    'satellite_target_id', v_srcj->'satellite_target_id',
    'satellite_seats', v_srcj->'satellite_seats',
    'short_description', v_srcj->'short_description'
  );

  v_new_id := gen_random_uuid();
  BEGIN
    v_create := public.fn_create_seat_first_game_atomic(v_new_id, v_config);
    IF (v_create->>'ok')::boolean IS NOT TRUE OR v_create->>'table_id' IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'private_game_refused',
        DETAIL = COALESCE(v_create->>'reason', 'board_not_reproducible');
    END IF;
    v_table_id := (v_create->>'table_id')::uuid;

    SELECT string_agg(k, ',') INTO v_mismatch
      FROM unnest(v_identity_keys) AS k
     WHERE CASE WHEN k = 'guaranteed_prize'
                THEN COALESCE((v_create->'tournament'->>k)::numeric, 0)
                     <> COALESCE((v_srcj->>k)::numeric, 0)
                ELSE (v_create->'tournament'->k) IS DISTINCT FROM (v_srcj->k) END;
    IF v_mismatch IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'private_game_refused',
        DETAIL = 'board_not_reproducible:' || v_mismatch;
    END IF;

    v_hold := public.fn_ca_private_game_hold_open(
      v_new_id, v_src.id, v_uid, v_src.max_players - 1, true
    );
    IF (v_hold->>'ok')::boolean IS NOT TRUE THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'private_game_refused',
        DETAIL = COALESCE(v_hold->>'reason', 'hold_refused');
    END IF;

    INSERT INTO public.private_seat_first_matches (
      tournament_id, club_id, union_id, source_tournament_id, creator_user_id, format, status
    ) VALUES (
      v_new_id, v_src.club_id, v_src.union_id, v_src.id, v_uid, v_format, 'open'
    );

    -- Creator buys into Seat 1 atomically through the normal seat door.
    v_buy := public.fn_take_seat_and_buy_in(v_table_id, 1);
    IF (v_buy->>'ok')::boolean IS NOT TRUE THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'private_game_refused',
        DETAIL = COALESCE(v_buy->>'reason', 'buy_in_failed');
    END IF;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS v_reason = PG_EXCEPTION_DETAIL;
    IF SQLERRM <> 'private_game_refused' THEN
      RAISE;
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', COALESCE(NULLIF(v_reason, ''), 'private_game_refused'));
  END;

  v_hold := public.fn_private_game_hold_view(v_new_id);
  RETURN jsonb_build_object(
    'ok', true,
    'created', true,
    'format', v_format,
    'permanent_private', true,
    'tournament_id', v_new_id,
    'table_id', v_table_id,
    'invite_token', (SELECT h.invite_token FROM public.private_game_holds h WHERE h.tournament_id = v_new_id),
    'buy_in', v_buy
  ) || (v_hold - 'tournament_id');
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_create_private_seat_first_match(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_create_private_seat_first_match(uuid) TO authenticated;

COMMENT ON FUNCTION public.fn_create_private_seat_first_match(uuid) IS
  'Creates a strictly link-only Private Heads-Up Match or Private Spin by cloning an active offered public board (exact game, stakes, starting chips, rake, and blind levels) and buying the creator into Seat 1 atomically.';

-- ---------------------------------------------------------------------------
-- UNREGISTER & PERMANENTLY CLOSE A CREATOR'S PRIVATE MATCH (ATOMIC REFUND)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_close_private_seat_first_match(
  p_tournament_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid       uuid := auth.uid();
  v_t         public.tournaments%ROWTYPE;
  v_match     public.private_seat_first_matches%ROWTYPE;
  v_table_id  uuid;
  v_player    record;
  v_unreg     jsonb;
  v_refunded  integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'fn_close_private_seat_first_match requires an authenticated caller'
      USING ERRCODE = '28000';
  END IF;
  IF NOT public.fn_caller_session_is_live() THEN
    RAISE EXCEPTION 'SESSION_REVOKED: this session is signed out - sign in again'
      USING ERRCODE = '28000';
  END IF;
  IF p_tournament_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'game_not_found');
  END IF;

  SELECT * INTO v_t FROM public.tournaments WHERE id = p_tournament_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'game_not_found');
  END IF;

  SELECT * INTO v_match
    FROM public.private_seat_first_matches
   WHERE tournament_id = p_tournament_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_a_private_match');
  END IF;
  IF v_match.creator_user_id IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_creator');
  END IF;

  IF v_match.status = 'closed' OR upper(COALESCE(v_t.status::text, '')) = 'CANCELLED' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'closed', true,
      'already_closed', true,
      'refunded_count', 0,
      'tournament_id', p_tournament_id
    );
  END IF;

  IF upper(COALESCE(v_t.status::text, '')) NOT IN ('ANNOUNCED', 'REGISTERING')
     OR v_t.started_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'game_already_started');
  END IF;

  v_table_id := public.fn_tournament_primary_table(p_tournament_id);

  -- Refund every currently registered/seated entrant through the authoritative refund door.
  FOR v_player IN
    SELECT tp.user_id
      FROM public.tournament_players tp
     WHERE tp.tournament_id = p_tournament_id
       AND tp.status::text IN ('registered', 'playing')
     ORDER BY tp.id ASC
  LOOP
    v_unreg := public.fn_ca_unregister_tournament_player_exact(
      p_tournament_id,
      v_player.user_id,
      v_table_id,
      'Private game closed by creator'
    );
    IF COALESCE((v_unreg->>'ok')::boolean, false) IS NOT TRUE
       AND COALESCE((v_unreg->>'success')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'private match close refund failed for %: %', v_player.user_id, v_unreg;
    END IF;
    v_refunded := v_refunded + 1;
  END LOOP;

  UPDATE public.private_seat_first_matches
     SET status = 'closed', closed_at = now(), updated_at = now()
   WHERE tournament_id = p_tournament_id;

  UPDATE public.private_game_holds
     SET status = 'cancelled', cancelled_at = now(), updated_at = now()
   WHERE tournament_id = p_tournament_id;

  UPDATE public.heads_up_wait_holds
     SET wait_mode = 'play_anyone', invite_token = NULL, hold_expires_at = now(), updated_at = now()
   WHERE tournament_id = p_tournament_id;

  UPDATE public.tournaments
     SET status = 'CANCELLED', current_players = 0
   WHERE id = p_tournament_id;

  UPDATE public.tables
     SET status = 'closed'
   WHERE tournament_id = p_tournament_id;

  RETURN jsonb_build_object(
    'ok', true,
    'closed', true,
    'already_closed', false,
    'refunded_count', v_refunded,
    'tournament_id', p_tournament_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_close_private_seat_first_match(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_close_private_seat_first_match(uuid) TO authenticated;

COMMENT ON FUNCTION public.fn_close_private_seat_first_match(uuid) IS
  'Creator unregisters and permanently closes a Private Heads-Up Match or Private Spin before start, refunding all seated entrants atomically and marking the tournament CANCELLED and table closed.';

-- ---------------------------------------------------------------------------
-- LOBBY VISIBILITY READBACK FOR ONE CLUB / UNION SCOPE
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_private_seat_first_lobby_state(
  p_club_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid      uuid := auth.uid();
  v_union_id uuid;
  v_hidden   jsonb;
  v_mine     jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'fn_private_seat_first_lobby_state requires an authenticated caller'
      USING ERRCODE = '28000';
  END IF;
  IF p_club_id IS NULL THEN
    RETURN jsonb_build_object('hidden_tournament_ids', '[]'::jsonb, 'my_matches', '[]'::jsonb);
  END IF;

  SELECT uc.union_id INTO v_union_id
    FROM public.union_clubs uc
   WHERE uc.club_id = p_club_id
   LIMIT 1;

  SELECT COALESCE(jsonb_agg(m.tournament_id ORDER BY m.created_at DESC), '[]'::jsonb)
    INTO v_hidden
    FROM public.private_seat_first_matches m
    JOIN public.tournaments t ON t.id = m.tournament_id
   WHERE (m.club_id = p_club_id OR (v_union_id IS NOT NULL AND m.union_id = v_union_id))
     AND m.status = 'open'
     AND upper(COALESCE(t.status::text, '')) IN ('ANNOUNCED', 'REGISTERING')
     AND m.creator_user_id <> v_uid
     AND NOT EXISTS (
       SELECT 1 FROM public.private_game_admissions a
        WHERE a.tournament_id = m.tournament_id AND a.user_id = v_uid
     );

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'tournament_id', m.tournament_id,
      'table_id', public.fn_tournament_primary_table(m.tournament_id),
      'format', m.format,
      'is_creator', (m.creator_user_id = v_uid),
      'invite_token', CASE WHEN m.creator_user_id = v_uid THEN h.invite_token ELSE NULL END,
      'source_tournament_id', m.source_tournament_id,
      'status', m.status
    )
    ORDER BY m.created_at DESC
  ), '[]'::jsonb)
    INTO v_mine
    FROM public.private_seat_first_matches m
    JOIN public.tournaments t ON t.id = m.tournament_id
    LEFT JOIN public.private_game_holds h ON h.tournament_id = m.tournament_id
   WHERE (m.club_id = p_club_id OR (v_union_id IS NOT NULL AND m.union_id = v_union_id))
     AND m.status = 'open'
     AND upper(COALESCE(t.status::text, '')) IN ('ANNOUNCED', 'REGISTERING')
     AND t.started_at IS NULL
     AND (
       m.creator_user_id = v_uid
       OR EXISTS (
         SELECT 1 FROM public.private_game_admissions a
          WHERE a.tournament_id = m.tournament_id AND a.user_id = v_uid
       )
     );

  RETURN jsonb_build_object(
    'hidden_tournament_ids', v_hidden,
    'my_matches', v_mine
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_private_seat_first_lobby_state(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_private_seat_first_lobby_state(uuid) TO authenticated;

-- Post-apply security assertions.
DO $post$
BEGIN
  IF (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.private_seat_first_matches'::regclass) IS NOT TRUE THEN
    RAISE EXCEPTION 'private_seat_first_matches must have row level security enabled';
  END IF;
  IF has_table_privilege('authenticated', 'public.private_seat_first_matches', 'SELECT')
     OR has_table_privilege('anon', 'public.private_seat_first_matches', 'SELECT')
     OR has_table_privilege('authenticated', 'public.private_seat_first_matches', 'INSERT') THEN
    RAISE EXCEPTION 'browser roles must never read or mutate private_seat_first_matches directly';
  END IF;
  IF has_function_privilege('anon', 'public.fn_create_private_seat_first_match(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_close_private_seat_first_match(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_private_seat_first_lobby_state(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_private_game_live_holds()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_private_game_entry_refusal(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'private seat-first match grants drifted';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.fn_create_private_seat_first_match(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.fn_close_private_seat_first_match(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.fn_private_seat_first_lobby_state(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.fn_accept_private_game_invite(uuid,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.fn_cancel_private_game_hold(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.fn_private_game_hold_state(uuid,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.fn_private_game_live_holds()', 'EXECUTE') THEN
    RAISE EXCEPTION 'private seat-first match doors are not reachable by their callers';
  END IF;
END;
$post$;

-- Function probes (tests/a-migration-proves-its-functions-before-commit.law.test.ts).
-- @probe-for: public.fn_create_private_seat_first_match
-- @probe-for: public.fn_close_private_seat_first_match
-- @probe-for: public.fn_private_seat_first_lobby_state
-- @probe-for: public.fn_accept_private_game_invite
-- @probe-for: public.fn_cancel_private_game_hold
-- @probe-for: public.fn_private_game_hold_state
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

  BEGIN
    v_res := public.fn_create_private_seat_first_match(gen_random_uuid());
    IF v_res->>'reason' IS DISTINCT FROM 'source_not_offered' THEN
      RAISE EXCEPTION 'unexpected probe result from fn_create_private_seat_first_match: %', v_res;
    END IF;
  EXCEPTION WHEN SQLSTATE '28000' OR SQLSTATE 'P0001' THEN
    IF SQLERRM NOT LIKE 'SESSION_REVOKED:%' THEN RAISE; END IF;
  END;

  BEGIN
    v_res := public.fn_close_private_seat_first_match(gen_random_uuid());
    IF v_res->>'reason' IS DISTINCT FROM 'game_not_found' THEN
      RAISE EXCEPTION 'unexpected probe result from fn_close_private_seat_first_match: %', v_res;
    END IF;
  EXCEPTION WHEN SQLSTATE '28000' OR SQLSTATE 'P0001' THEN
    IF SQLERRM NOT LIKE 'SESSION_REVOKED:%' THEN RAISE; END IF;
  END;

  BEGIN
    v_res := public.fn_private_seat_first_lobby_state(gen_random_uuid());
    IF jsonb_typeof(v_res->'hidden_tournament_ids') IS DISTINCT FROM 'array'
       OR jsonb_typeof(v_res->'my_matches') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'unexpected probe result from fn_private_seat_first_lobby_state: %', v_res;
    END IF;
  EXCEPTION WHEN SQLSTATE '28000' OR SQLSTATE 'P0001' THEN
    IF SQLERRM NOT LIKE 'SESSION_REVOKED:%' THEN RAISE; END IF;
  END;

  BEGIN
    v_res := public.fn_accept_private_game_invite(gen_random_uuid(), 'abcdefabcdefabcdef');
    IF (v_res->>'allowed')::boolean IS NOT TRUE OR (v_res->>'reserved')::boolean IS NOT FALSE THEN
      RAISE EXCEPTION 'unexpected probe result from fn_accept_private_game_invite: %', v_res;
    END IF;
  EXCEPTION WHEN SQLSTATE '28000' OR SQLSTATE 'P0001' THEN
    IF SQLERRM NOT LIKE 'SESSION_REVOKED:%' THEN RAISE; END IF;
  END;

  BEGIN
    v_res := public.fn_cancel_private_game_hold(gen_random_uuid());
    IF v_res->>'reason' IS DISTINCT FROM 'no_hold' THEN
      RAISE EXCEPTION 'unexpected probe result from fn_cancel_private_game_hold: %', v_res;
    END IF;
  EXCEPTION WHEN SQLSTATE '28000' OR SQLSTATE 'P0001' THEN
    IF SQLERRM NOT LIKE 'SESSION_REVOKED:%' THEN RAISE; END IF;
  END;

  BEGIN
    v_res := public.fn_private_game_hold_state(gen_random_uuid(), NULL);
    IF (v_res->>'held')::boolean IS NOT FALSE THEN
      RAISE EXCEPTION 'unexpected probe result from fn_private_game_hold_state: %', v_res;
    END IF;
  EXCEPTION WHEN SQLSTATE '28000' OR SQLSTATE 'P0001' THEN
    IF SQLERRM NOT LIKE 'SESSION_REVOKED:%' THEN RAISE; END IF;
  END;

  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_private_game_live_holds
DO $probe$
DECLARE
  v_res jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  v_res := public.fn_private_game_live_holds();
  IF jsonb_typeof(v_res) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'unexpected probe result from fn_private_game_live_holds: %', v_res;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
