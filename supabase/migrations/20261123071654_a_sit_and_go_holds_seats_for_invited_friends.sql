-- @live-proof: (to_regprocedure('public.fn_invite_to_private_game(uuid,integer)') IS NOT NULL AND strpos(pg_get_functiondef('public.fn_invite_to_private_game(uuid,integer)'::regprocedure), 'fn_register_for_tournament_request') > 0 AND strpos(pg_get_functiondef('public.fn_invite_to_private_game(uuid,integer)'::regprocedure), 'fn_create_seat_first_game_atomic') > 0 AND NOT has_function_privilege('anon', 'public.fn_invite_to_private_game(uuid,integer)', 'EXECUTE') AND has_function_privilege('authenticated', 'public.fn_invite_to_private_game(uuid,integer)', 'EXECUTE'))
--
-- 20261123071654_a_sit_and_go_holds_seats_for_invited_friends.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THE PLAYER SAW. Invite To Game on a six or nine seat Sit & Go (an
-- ordinary Sit & Go, or a "Starts When Full" satellite run as one, such as
-- "Satellite Into Nightly 20K 9-Max SNG Satellite") only shared the link.
-- 20261123013126 refused every Sit & Go but Heads Up (format_not_supported),
-- so nothing kept the friend's seat: any person who registered took it, a
-- board the union's daily horse plan had preseeded to one seat short started
-- the moment the inviter registered, and a board chosen for a horse slot
-- filled the friend's seat with a horse and dealt. The friend arrived to a
-- game that had already started.
--
-- WHAT THIS CHANGES (ordinary migration, installs at any minute: CREATE OR
-- REPLACE FUNCTION only, no lock on any live table):
--
--   fn_invite_to_private_game(tournament, seats) gains the Sit & Go branch.
--   It is the SAME hold (private_game_holds, fn_ca_private_game_hold_open,
--   the same token, clock, admissions, Cancel and entry rule), not a second
--   mechanism. Spins and Heads Up keep exactly the 20261123013126 behaviour.
--
--   A Sit & Go of 4 to 9 seats (format sng-v1, variant 'sng'):
--     - the inviter chooses how many friends, at most seats - 1;
--     - already registered: the seat(s) are held in this game, bounded by its
--       open seats;
--     - not registered: the inviter is registered through the NORMAL
--       registration door (fn_register_for_tournament_request: the normal
--       price, wallet, fee and receipt) in this same transaction, and then
--       the seat(s) are held, so a hold never exists without its inviter and
--       a refused registration leaves no hold and no charge. A game without
--       room for the inviter and one friend is refused before any money moves
--       (no_open_seat);
--     - the hold is NEVER exclusive in a Sit & Go. Dan's rule for a Sit & Go
--       is that the field fills around the people in it: the held seats are
--       kept for the invited friends, and every other seat stays open to
--       anyone, a person or a horse, exactly as with no hold
--       (fn_private_game_entry_refusal, the exclusive = false arm). The game
--       starts on its ordinary rule when every seat is taken, the friends
--       included; when the hold expires, is cancelled, or the inviter
--       unregisters, it is an ordinary board again.
--
-- WHY THE SIT & GO IS HELD IN PLACE, NOT COPIED. A Spin or Heads Up is a table
-- that opens with a horse in it, so Phase 1 opens a private copy beside it. A
-- six or nine seat Sit & Go is a registration board: it opens empty, takes a
-- horse only on the union's daily plan (20261029032444), and a satellite run
-- as one is ONE board per target, created only by fn_ensure_fixed_sng_satellite
-- under its per-target lock after its price and target checks. A copy made
-- from a browser door would be a second feeder outside that creator, and,
-- because the hold cannot be exclusive here, it would not be private anyway:
-- it would be a second public board. So the board itself is reserved.
--
-- ENFORCEMENT NEEDS NO NEW TRIGGER. fn_private_game_entry_guard (20261123013126,
-- attached by the window migration 20261123013136) judges every NEW row in
-- tournament_players, whatever door wrote it: fn_register_for_tournament and
-- its request and ticket doors, fn_register_horse_for_tournament, and the
-- seat doors. A Sit & Go registration is such a row, so the guard already
-- refuses a held Sit & Go seat to anyone but its inviter and the friends the
-- token admitted, under the FOR NO KEY UPDATE event lock every registration
-- door takes. A horse is refused by the same line as a person; nothing here
-- reads is_horse (CLAUDE.md 10.5).
--
-- INSTALL ORDER. Safe in either order relative to 20261123013136: this file
-- touches neither the guard nor the trigger. It needs 20261123013126 (the hold
-- tables and helpers) and refuses to install without it. Until the trigger
-- attaches at a 04:00 Chicago window, the hold is honoured by the engine that
-- carries this change (it registers no horse into a held seat and says so on
-- /health as privateSitAndGoHolds) and by the client, which offers the Sit &
-- Go hold only when that engine is serving and asks fn_accept_private_game_invite
-- before every Sit & Go registration.
--
-- THE CLOCK. Unchanged: ten minutes of open play, every frozen second given
-- back (fn_private_game_hold_deadline reads engine_maintenance_thaws), so a
-- cutover never eats a friend's seat (CLAUDE.md 13 rule 4).
--
-- Wrap ALL DDL for one change in ONE transaction: every DDL statement fires
-- Supabase's schema-cache reload, which takes ~28s on this database, and ten
-- loose statements mean ten reloads (club-arena CLAUDE.md, production DDL policy).

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $needs$
BEGIN
  IF to_regclass('public.private_game_holds') IS NULL
     OR to_regprocedure('public.fn_ca_private_game_hold_open(uuid,uuid,uuid,integer,boolean)') IS NULL
     OR to_regprocedure('public.fn_private_game_hold_view(uuid)') IS NULL
     OR to_regprocedure('public.fn_private_game_entry_refusal(uuid,uuid)') IS NULL
     OR to_regprocedure('public.fn_register_for_tournament_request(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'private_game_hold_missing: install 20261123013126 first'
      USING ERRCODE = '55000';
  END IF;
END $needs$;

-- ---------------------------------------------------------------------------
-- INVITE TO GAME: Spins and Heads Up as 20261123013126, plus the Sit & Go.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_invite_to_private_game(
  p_tournament_id uuid,
  p_seats_held integer DEFAULT 1
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
  v_seats         integer;
  v_live_entries  integer := 0;
  v_caller_in     boolean := false;
  v_window        text;
  v_hold          jsonb;
  v_other         jsonb;
  v_new_id        uuid;
  v_create        jsonb;
  v_table_id      uuid;
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
    RAISE EXCEPTION 'fn_invite_to_private_game requires an authenticated caller'
      USING ERRCODE = '28000';
  END IF;
  IF NOT public.fn_caller_session_is_live() THEN
    RAISE EXCEPTION 'SESSION_REVOKED: this session is signed out - sign in again'
      USING ERRCODE = '28000';
  END IF;
  IF p_tournament_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'game_not_found');
  END IF;

  SELECT * INTO v_src FROM public.tournaments WHERE id = p_tournament_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'game_not_found');
  END IF;
  IF upper(COALESCE(v_src.status::text, '')) NOT IN ('ANNOUNCED', 'REGISTERING')
     OR v_src.started_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'game_already_started');
  END IF;

  /* ── A SIT & GO OF FOUR TO NINE SEATS (2026-11-23) ─────────────────────────
     A registration board, held in place and never exclusively (see the
     header). The persisted format decides, never a label alone: a row whose
     format_contract is not sng-v1 is not offered. */
  IF lower(COALESCE(v_src.variant, '')) = 'sng'
     AND COALESCE(v_src.max_players, 0) BETWEEN 4 AND 9 THEN
    IF to_jsonb(v_src)->>'format_contract' IS DISTINCT FROM 'sng-v1' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'format_not_supported');
    END IF;

    v_seats := LEAST(GREATEST(COALESCE(p_seats_held, 1), 1), v_src.max_players - 1);

    SELECT count(*)::integer, COALESCE(bool_or(tp.user_id = v_uid), false)
      INTO v_live_entries, v_caller_in
      FROM public.tournament_players tp
     WHERE tp.tournament_id = v_src.id
       AND tp.status::text IN ('registered', 'playing');

    IF v_caller_in THEN
      /* Already registered: hold this game's open seat(s), nothing is bought.
         The registration doors' own lock on the event (FOR NO KEY UPDATE,
         20261119185300) is taken first and everything is read again under
         it, so no entry committing beside this one can be missed. Nothing
         else is locked after it here, so this is the order every door uses. */
      PERFORM 1 FROM public.tournaments WHERE id = v_src.id FOR NO KEY UPDATE;
      SELECT * INTO v_src FROM public.tournaments WHERE id = p_tournament_id;
      IF upper(COALESCE(v_src.status::text, '')) NOT IN ('ANNOUNCED', 'REGISTERING')
         OR v_src.started_at IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'game_already_started');
      END IF;
      SELECT count(*)::integer, COALESCE(bool_or(tp.user_id = v_uid), false)
        INTO v_live_entries, v_caller_in
        FROM public.tournament_players tp
       WHERE tp.tournament_id = v_src.id
         AND tp.status::text IN ('registered', 'playing');
      IF NOT v_caller_in THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'not_in_game');
      END IF;
      v_other := public.fn_private_game_hold_view(v_src.id);
      IF v_other IS NOT NULL
         AND (v_other->>'live')::boolean IS TRUE
         AND (v_other->>'creator_user_id')::uuid IS DISTINCT FROM v_uid THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'another_invite_is_holding');
      END IF;
      IF v_src.max_players - v_live_entries < 1 THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'no_open_seat');
      END IF;
      v_seats := LEAST(v_seats, v_src.max_players - v_live_entries);
      v_hold := public.fn_ca_private_game_hold_open(v_src.id, v_src.id, v_uid, v_seats, false);
      IF (v_hold->>'ok')::boolean IS NOT TRUE THEN
        RETURN v_hold;
      END IF;
      RETURN v_hold || jsonb_build_object(
        'created', false,
        'registered', false,
        'sit_and_go', true,
        'table_id', public.fn_tournament_primary_table(v_src.id));
    END IF;

    /* Not registered: the normal registration door, the normal price, then
       the hold, in this one transaction.

       LOCK ORDER. The registration door takes its own lanes first (the
       acquisition lane, the entry boundary 530090, the table cap, the launch
       receipt) and the event row last (20261119052513). This path therefore
       takes NO lock before calling it: locking the event row first would be
       the reverse order, and a person registering for the same game at the
       same instant would deadlock with the invite. The reads below are only
       an early answer that costs nothing; the decision is made again under
       the event row lock the door leaves held. */
    v_other := public.fn_private_game_hold_view(v_src.id);
    IF v_other IS NOT NULL
       AND (v_other->>'live')::boolean IS TRUE
       AND (v_other->>'creator_user_id')::uuid IS DISTINCT FROM v_uid THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'another_invite_is_holding');
    END IF;
    v_window := public.fn_daily_window_entry_refusal(v_src.id);
    IF v_window IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', v_window);
    END IF;
    IF v_src.max_players - v_live_entries < 2 THEN
      -- No room for the inviter AND a friend: say so before anything is paid.
      RETURN jsonb_build_object('ok', false, 'reason', 'no_open_seat');
    END IF;

    BEGIN
      v_buy := public.fn_register_for_tournament_request(v_src.id, gen_random_uuid());
      IF (v_buy->>'ok')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'private_game_refused',
          DETAIL = COALESCE(v_buy->>'reason', 'registration_failed');
      END IF;

      /* The door has locked the event row (FOR NO KEY UPDATE); taking it
         again is immediate. Decide under it: the inviter is in, and there is
         still at least one open seat to hold. Anything else rolls the
         registration back with this block, so nobody is charged. */
      PERFORM 1 FROM public.tournaments WHERE id = v_src.id FOR NO KEY UPDATE;
      SELECT count(*)::integer, COALESCE(bool_or(tp.user_id = v_uid), false)
        INTO v_live_entries, v_caller_in
        FROM public.tournament_players tp
       WHERE tp.tournament_id = v_src.id
         AND tp.status::text IN ('registered', 'playing');
      IF NOT v_caller_in THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'private_game_refused',
          DETAIL = 'registration_failed';
      END IF;
      v_other := public.fn_private_game_hold_view(v_src.id);
      IF v_other IS NOT NULL
         AND (v_other->>'live')::boolean IS TRUE
         AND (v_other->>'creator_user_id')::uuid IS DISTINCT FROM v_uid THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'private_game_refused',
          DETAIL = 'another_invite_is_holding';
      END IF;
      IF v_src.max_players - v_live_entries < 1 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'private_game_refused',
          DETAIL = 'no_open_seat';
      END IF;
      v_seats := LEAST(v_seats, v_src.max_players - v_live_entries);

      v_hold := public.fn_ca_private_game_hold_open(v_src.id, v_src.id, v_uid, v_seats, false);
      IF (v_hold->>'ok')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'private_game_refused',
          DETAIL = COALESCE(v_hold->>'reason', 'hold_refused');
      END IF;
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
      GET STACKED DIAGNOSTICS v_reason = PG_EXCEPTION_DETAIL;
      /* Another inviter's hold left no open seat for this registration: the
         entry guard refused it, which is the rule answering, not a fault. */
      IF SQLERRM LIKE 'PRIVATE_GAME_SEAT_HELD%' THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'private_game_seat_held');
      END IF;
      IF SQLERRM <> 'private_game_refused' THEN
        RAISE;
      END IF;
      RETURN jsonb_build_object('ok', false, 'reason', COALESCE(NULLIF(v_reason, ''), 'private_game_refused'));
    END;

    RETURN v_hold || jsonb_build_object(
      'created', false,
      'registered', true,
      'sit_and_go', true,
      'registration', v_buy,
      'table_id', public.fn_tournament_primary_table(v_src.id));
  END IF;

  /* Seat-first games only: a Spin, a Heads Up and a Heads Up satellite are a
     table with open seats, and their invite door is that table's link. */
  IF NOT (lower(COALESCE(v_src.variant, '')) = 'spin' OR COALESCE(v_src.max_players, 0) = 2)
     OR COALESCE(v_src.max_players, 0) NOT BETWEEN 2 AND 3 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'format_not_supported');
  END IF;

  v_seats := LEAST(GREATEST(COALESCE(p_seats_held, 1), 1), v_src.max_players - 1);

  SELECT count(*)::integer, COALESCE(bool_or(tp.user_id = v_uid), false)
    INTO v_live_entries, v_caller_in
    FROM public.tournament_players tp
   WHERE tp.tournament_id = v_src.id
     AND tp.status::text IN ('registered', 'playing');

  IF v_caller_in THEN
    /* Holding seats HERE: take the registration doors' own lock on the event
       (FOR NO KEY UPDATE) and count again, so no entry committing beside this
       one can be missed. The copy path below never locks the source game. */
    PERFORM 1 FROM public.tournaments WHERE id = v_src.id FOR NO KEY UPDATE;
    SELECT count(*)::integer, COALESCE(bool_or(tp.user_id = v_uid), false)
      INTO v_live_entries, v_caller_in
      FROM public.tournament_players tp
     WHERE tp.tournament_id = v_src.id
       AND tp.status::text IN ('registered', 'playing');
    IF NOT v_caller_in THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'not_in_game');
    END IF;
    IF v_live_entries = 1 THEN
      -- Alone in it: this game becomes the private one.
      v_hold := public.fn_ca_private_game_hold_open(v_src.id, v_src.id, v_uid, v_seats, true);
    ELSE
      -- Seated beside others: hold the open seat(s) here.
      IF v_src.max_players - v_live_entries < 1 THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'no_open_seat');
      END IF;
      v_seats := LEAST(v_seats, v_src.max_players - v_live_entries);
      v_hold := public.fn_ca_private_game_hold_open(v_src.id, v_src.id, v_uid, v_seats, false);
    END IF;
    IF (v_hold->>'ok')::boolean IS NOT TRUE THEN
      RETURN v_hold;
    END IF;
    RETURN v_hold || jsonb_build_object(
      'created', false,
      'table_id', public.fn_tournament_primary_table(v_src.id));
  END IF;

  /* Not in the game: a private copy of the same board, bought into through
     the normal seat door in this one transaction. */
  v_window := public.fn_daily_window_entry_refusal(v_src.id);
  IF v_window IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', v_window);
  END IF;

  v_srcj := to_jsonb(v_src);
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

    /* The copy must be the same board. Anything the creator would not
       reproduce refuses here and the copy is rolled back with this block. */
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

    v_hold := public.fn_ca_private_game_hold_open(v_new_id, v_src.id, v_uid, v_seats, true);
    IF (v_hold->>'ok')::boolean IS NOT TRUE THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'private_game_refused',
        DETAIL = COALESCE(v_hold->>'reason', 'hold_refused');
    END IF;

    -- The inviter's own buy-in: the normal seat door, the normal price.
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
    'tournament_id', v_new_id,
    'table_id', v_table_id,
    'invite_token', (SELECT h.invite_token FROM public.private_game_holds h WHERE h.tournament_id = v_new_id),
    'buy_in', v_buy
  ) || (v_hold - 'tournament_id');
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_invite_to_private_game(uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_invite_to_private_game(uuid, integer) TO authenticated;

COMMENT ON FUNCTION public.fn_invite_to_private_game(uuid, integer) IS
  'Invite To Game (20261123013126, Sit & Go 20261123071654). A Spin or Heads Up: a private copy of the board, or the game held in place. A Sit & Go of 4-9 seats: the inviter registered through the normal registration door if needed, then up to seats-1 seats held in place (never exclusive) for invited friends. One hold mechanism: private_game_holds.';

-- Post-apply security assertions (fail closed if the grants drift).
DO $post$
BEGIN
  IF has_function_privilege('anon', 'public.fn_invite_to_private_game(uuid,integer)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.fn_invite_to_private_game(uuid,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'fn_invite_to_private_game grants drifted';
  END IF;
END;
$post$;

-- Function probe (tests/a-migration-proves-its-functions-before-commit.law.test.ts):
-- the SECURITY DEFINER body runs once inside a subtransaction that always
-- unwinds. A game id nobody holds answers without touching money.

-- @probe-for: public.fn_invite_to_private_game
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

  /* Production refuses a caller whose session is not live (SESSION_REVOKED,
     28000): the probe's made-up actor has none. That refusal is itself the
     door answering correctly, so the call accepts it and nothing else. */
  BEGIN
    v_res := public.fn_invite_to_private_game(gen_random_uuid(), 3);
    IF v_res->>'reason' IS DISTINCT FROM 'game_not_found' THEN
      RAISE EXCEPTION 'unexpected probe result from fn_invite_to_private_game: %', v_res;
    END IF;
  EXCEPTION WHEN SQLSTATE '28000' OR SQLSTATE 'P0001' THEN
    IF SQLERRM NOT LIKE 'SESSION_REVOKED:%' THEN RAISE; END IF;
  END;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
