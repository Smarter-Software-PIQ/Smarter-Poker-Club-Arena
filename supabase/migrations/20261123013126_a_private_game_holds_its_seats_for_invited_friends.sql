-- @live-proof: (to_regclass('public.private_game_holds') IS NOT NULL AND to_regclass('public.private_game_admissions') IS NOT NULL AND to_regprocedure('public.fn_invite_to_private_game(uuid,integer)') IS NOT NULL AND to_regprocedure('public.fn_accept_private_game_invite(uuid,text)') IS NOT NULL AND to_regprocedure('public.fn_cancel_private_game_hold(uuid)') IS NOT NULL AND to_regprocedure('public.fn_private_game_hold_state(uuid,text)') IS NOT NULL AND to_regprocedure('public.fn_private_game_live_holds()') IS NOT NULL AND to_regprocedure('public.fn_private_game_entry_guard()') IS NOT NULL AND NOT has_function_privilege('anon', 'public.fn_invite_to_private_game(uuid,integer)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.fn_private_game_live_holds()', 'EXECUTE') AND NOT has_table_privilege('authenticated', 'public.private_game_holds', 'SELECT') AND strpos(pg_get_functiondef('public.fn_set_heads_up_wait_mode(uuid,text)'::regprocedure), 'fn_ca_private_game_hold_open') > 0 AND strpos(pg_get_functiondef('public.fn_check_heads_up_seat_invite(uuid,text)'::regprocedure), 'fn_accept_private_game_invite') > 0)
--
-- 20261123013126_a_private_game_holds_its_seats_for_invited_friends.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THE PLAYER SAW (texted to Dan, 2026-11-22): "The crazy river is always
-- on the table, even when you invite someone. It doesn't open a new table."
-- A Spin or Heads Up a person opens from the lobby often already holds a
-- horse, a Heads Up starts the moment a person takes its other seat, and the
-- only seat hold that existed (Heads Up "Specific Player",
-- 20261122025900) was reachable at an EMPTY Heads Up table only and was
-- advisory: nothing in the seat doors read it.
--
-- WHAT THIS ADDS (ordinary migration, installs at any minute: new tables and
-- CREATE OR REPLACE FUNCTION only, no lock on any live table):
--
--   public.private_game_holds       one row per held game: the inviter, the
--                                   invite token, how many seats are held,
--                                   whether the game is private (exclusive)
--                                   and the hold's clock.
--   public.private_game_admissions  the invited players a valid token let in.
--
--   fn_invite_to_private_game(tournament, seats)   the Invite To Game door.
--     A caller who is not in the game gets a PRIVATE COPY of the same board
--     (fn_create_seat_first_game_atomic with the board's own configuration:
--     same club and union, format, stake, game, seats and satellite target),
--     bought into through the normal seat door (fn_take_seat_and_buy_in) in
--     the same transaction, so the copy never exists without its inviter and
--     a failed buy-in leaves nothing behind. A caller seated ALONE in the game
--     makes that game private in place (the old Specific Player case). A
--     caller seated beside others holds the game's open seat(s) in place.
--     Heads Up holds 1 seat, a Spin up to 2.
--   fn_accept_private_game_invite(tournament, token)  the friend's door:
--     a valid token admits them to a held seat (bounded by the seats held),
--     anyone else is answered with the rule.
--   fn_cancel_private_game_hold(tournament)  the inviter releases the hold;
--     the game falls back to the ordinary board rules. Unregistering is the
--     existing refund door, unchanged.
--   fn_private_game_hold_state(tournament, token)  what the table shows.
--   fn_private_game_live_holds()  what the engine reads (service role).
--   fn_private_game_entry_guard()  the trigger body that ENFORCES the hold on
--     every entry into a held game. It is attached by the window migration
--     20261123013136 (CREATE TRIGGER on tournament_players needs the daily
--     break); until then the engine and the client honour the hold.
--
-- A HOLD IS LIVE while: it is not cancelled, its game is still taking
-- entries, its inviter still holds an entry, fewer invited players hold an
-- entry than seats are held, and its clock has not run out. The moment any of
-- those stops being true the game is an ordinary board again. Nothing sweeps,
-- re-drives or repairs a hold (CLAUDE.md 10.12): liveness is computed where it
-- is read.
--
-- THE CLOCK IS THAWED, NOT BURNED (CLAUDE.md 13 rule 4). A hold lasts ten
-- minutes of OPEN play time. It is not a stored deadline the thaw has to
-- move: fn_private_game_hold_deadline adds back every frozen second
-- fn_thaw_platform recorded in engine_maintenance_thaws for a freeze that
-- began inside the hold, and while a break is in progress the clock stands
-- still. A five-minute cutover therefore can never eat a friend's seat, and
-- the certified thaw contract (fn_thaw_platform, its pinned md5 and its
-- required-steps list) is left exactly as the release lane certified it.
--
-- HORSES ARE PLAYERS (CLAUDE.md 10.5). Nothing here reads is_horse. A horse
-- cannot take a held seat by the same rule a person who has no invite cannot.
--
-- Older engines read the Heads Up row in heads_up_wait_holds; every Heads Up
-- hold opened here writes that row too, from the same token and clock, so a
-- Heads Up held during the hours before the new engine serves is honoured.
--
-- Wrap ALL DDL for one change in ONE transaction: every DDL statement fires
-- Supabase's schema-cache reload, which takes ~28s on this database, and ten
-- loose statements mean ten reloads (club-arena CLAUDE.md, production DDL policy).

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.private_game_holds (
  tournament_id        uuid PRIMARY KEY,
  source_tournament_id uuid NOT NULL,
  creator_user_id      uuid NOT NULL,
  invite_token         text NOT NULL CHECK (invite_token ~ '^[A-Za-z0-9_-]{16,64}$'),
  seats_held           integer NOT NULL CHECK (seats_held BETWEEN 1 AND 8),
  exclusive            boolean NOT NULL,
  status               text NOT NULL DEFAULT 'holding' CHECK (status IN ('holding', 'cancelled')),
  hold_started_at      timestamptz NOT NULL DEFAULT now(),
  hold_seconds         integer NOT NULL CHECK (hold_seconds BETWEEN 60 AND 900),
  hold_expires_at      timestamptz NOT NULL,
  cancelled_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT private_game_holds_nominal_clock
    CHECK (hold_expires_at = hold_started_at + make_interval(secs => hold_seconds))
);

COMMENT ON TABLE public.private_game_holds IS
  'One row per game whose seats an inviter holds for invited friends (Invite To Game, 2026-11-22). hold_expires_at is the NOMINAL end; the live end is fn_private_game_hold_deadline, which gives back every frozen second. No foreign key to tournaments on purpose (CLAUDE.md section 2 rule 7).';

CREATE INDEX IF NOT EXISTS idx_private_game_holds_creator
  ON public.private_game_holds (creator_user_id);
CREATE INDEX IF NOT EXISTS idx_private_game_holds_holding
  ON public.private_game_holds (hold_expires_at)
  WHERE status = 'holding';

CREATE TABLE IF NOT EXISTS public.private_game_admissions (
  tournament_id uuid NOT NULL REFERENCES public.private_game_holds (tournament_id) ON DELETE CASCADE,
  user_id       uuid NOT NULL,
  admitted_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, user_id)
);

COMMENT ON TABLE public.private_game_admissions IS
  'The invited players a valid invite token admitted to a held seat. Bounded by private_game_holds.seats_held, written only by fn_accept_private_game_invite.';

ALTER TABLE public.private_game_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.private_game_admissions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.private_game_holds FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.private_game_admissions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.private_game_holds TO service_role;
GRANT SELECT ON TABLE public.private_game_admissions TO service_role;

-- ---------------------------------------------------------------------------
-- The live end of a hold: its nominal length plus every frozen second.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_private_game_hold_deadline(
  p_started_at timestamptz,
  p_seconds integer
)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_deadline   timestamptz;
  v_next       timestamptz;
  v_credit     numeric := 0;
  v_break_from timestamptz;
  i            integer;
BEGIN
  IF p_started_at IS NULL OR p_seconds IS NULL OR p_seconds <= 0 THEN
    RETURN NULL;
  END IF;
  v_deadline := p_started_at + make_interval(secs => p_seconds);
  /* A credit can carry the end past the start of a LATER freeze, so the sum is
     taken again over the extended span until it stops moving. Freezes are at
     least three hours apart and a hold is at most fifteen minutes, so this
     settles in one or two passes; four is the bound, never a wait. */
  FOR i IN 1..4 LOOP
    SELECT COALESCE(sum(t.frozen_seconds), 0)
      INTO v_credit
      FROM public.engine_maintenance_thaws t
     WHERE t.freeze_started_at >= p_started_at
       AND t.freeze_started_at < v_deadline;
    v_next := p_started_at + make_interval(secs => p_seconds + v_credit);
    EXIT WHEN v_next = v_deadline;
    v_deadline := v_next;
  END LOOP;
  /* A break in progress that began inside the hold and has not been thawed
     yet: the clock stands still until it is, so the time the break takes is
     added as it passes. Once fn_thaw_platform records the freeze, the sum
     above carries it and this branch no longer applies. */
  SELECT COALESCE(b.break_started_at, b.announced_at)
    INTO v_break_from
    FROM public.engine_maintenance_break b
   LIMIT 1;
  IF v_break_from IS NOT NULL
     AND v_break_from >= p_started_at
     AND v_break_from < v_deadline
     AND NOT EXISTS (
       SELECT 1 FROM public.engine_maintenance_thaws t
        WHERE t.freeze_started_at >= v_break_from - interval '15 minutes'
          AND t.freeze_started_at <= v_break_from + interval '15 minutes'
     ) THEN
    v_deadline := v_deadline + GREATEST(clock_timestamp() - v_break_from, interval '0');
  END IF;
  RETURN v_deadline;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_private_game_hold_deadline(timestamptz, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_private_game_hold_deadline(timestamptz, integer)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Everything a reader needs to know about one held game, computed now.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_private_game_hold_view(p_tournament_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_hold            public.private_game_holds%ROWTYPE;
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

  RETURN jsonb_build_object(
    'tournament_id', v_hold.tournament_id,
    'source_tournament_id', v_hold.source_tournament_id,
    'creator_user_id', v_hold.creator_user_id,
    'seats_held', v_hold.seats_held,
    'exclusive', v_hold.exclusive,
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
-- THE RULE. NULL means this player may take an entry into this game now.
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
  v_view jsonb;
  v_open integer;
BEGIN
  IF p_tournament_id IS NULL THEN
    RETURN NULL;
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
  /* A hold in a shared game keeps only the held seats. Any seat beyond them
     is open to anyone, exactly as it would be with no hold. */
  v_open := (v_view->>'max_players')::integer
          - (v_view->>'live_entries')::integer
          - (v_view->>'held_open')::integer;
  IF v_open >= 1 THEN
    RETURN NULL;
  END IF;
  RETURN 'private_game_seat_held';
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_private_game_entry_refusal(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_private_game_entry_refusal(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- The enforcement. Attached to tournament_players by 20261123013136.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_private_game_entry_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_refusal text;
BEGIN
  /* Only a NEW entry is judged: an insert, or a row becoming an entry or
     changing hands. Every other update (registered to playing, chips, busts)
     leaves at the first line, so the trigger costs nothing on the hand path. */
  IF NEW.status::text NOT IN ('registered', 'playing') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.status::text IN ('registered', 'playing')
     AND OLD.user_id IS NOT DISTINCT FROM NEW.user_id THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.private_game_holds h
     WHERE h.tournament_id = NEW.tournament_id AND h.status = 'holding'
  ) THEN
    RETURN NEW;
  END IF;
  /* The same row lock every registration door already takes on the event
     (FOR NO KEY UPDATE, 20261119185300), taken again so the rule is read
     after any entry that was racing this one has committed. The doors hold
     it already; this never waits on a hand commit (FOR KEY SHARE). */
  PERFORM 1 FROM public.tournaments WHERE id = NEW.tournament_id FOR NO KEY UPDATE;
  v_refusal := public.fn_private_game_entry_refusal(NEW.tournament_id, NEW.user_id);
  IF v_refusal IS NOT NULL THEN
    RAISE EXCEPTION 'PRIVATE_GAME_SEAT_HELD: this seat is held for an invited friend'
      USING ERRCODE = 'P0001',
            HINT = 'private_game_seat_held';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_private_game_entry_guard()
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Open (or reuse) the hold on one game. Internal: every caller has already
-- proven who the creator is and taken the event's row lock.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_ca_private_game_hold_open(
  p_tournament_id uuid,
  p_source_tournament_id uuid,
  p_creator uuid,
  p_seats integer,
  p_exclusive boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_hold_seconds constant integer := 600;
  v_existing     public.private_game_holds%ROWTYPE;
  v_view         jsonb;
  v_token        text;
  v_table_id     uuid;
  v_max_players  integer;
BEGIN
  SELECT * INTO v_existing
    FROM public.private_game_holds
   WHERE tournament_id = p_tournament_id
   FOR UPDATE;

  IF FOUND THEN
    v_view := public.fn_private_game_hold_view(p_tournament_id);
    IF (v_view->>'live')::boolean THEN
      IF v_existing.creator_user_id <> p_creator THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'another_invite_is_holding');
      END IF;
      /* The same inviter asking again gets the same hold and the same link. */
      RETURN jsonb_build_object('ok', true, 'reused', true, 'invite_token', v_existing.invite_token)
             || v_view;
    END IF;
    /* A hold that is over is replaced. The inviter keeps their link; a new
       inviter gets a new one. Admissions belonged to the old hold. */
    v_token := CASE WHEN v_existing.creator_user_id = p_creator
                    THEN v_existing.invite_token
                    ELSE replace(gen_random_uuid()::text, '-', '') END;
    DELETE FROM public.private_game_admissions WHERE tournament_id = p_tournament_id;
    UPDATE public.private_game_holds
       SET source_tournament_id = p_source_tournament_id,
           creator_user_id = p_creator,
           invite_token = v_token,
           seats_held = p_seats,
           exclusive = p_exclusive,
           status = 'holding',
           hold_started_at = now(),
           hold_seconds = c_hold_seconds,
           hold_expires_at = now() + make_interval(secs => c_hold_seconds),
           cancelled_at = NULL,
           updated_at = now()
     WHERE tournament_id = p_tournament_id;
  ELSE
    v_token := replace(gen_random_uuid()::text, '-', '');
    INSERT INTO public.private_game_holds (
      tournament_id, source_tournament_id, creator_user_id, invite_token,
      seats_held, exclusive, status, hold_started_at, hold_seconds, hold_expires_at
    ) VALUES (
      p_tournament_id, p_source_tournament_id, p_creator, v_token,
      p_seats, p_exclusive, 'holding', now(), c_hold_seconds,
      now() + make_interval(secs => c_hold_seconds)
    );
  END IF;

  /* Older engines honour a Heads Up hold through heads_up_wait_holds. Written
     from this hold's own token and clock so the two can never disagree. */
  SELECT t.max_players INTO v_max_players FROM public.tournaments t WHERE t.id = p_tournament_id;
  IF COALESCE(v_max_players, 0) = 2 AND p_exclusive THEN
    v_table_id := public.fn_tournament_primary_table(p_tournament_id);
    IF v_table_id IS NOT NULL THEN
      INSERT INTO public.heads_up_wait_holds (
        tournament_id, table_id, creator_user_id, wait_mode, invite_token, hold_expires_at, updated_at
      ) VALUES (
        p_tournament_id, v_table_id, p_creator, 'specific_player', v_token,
        now() + make_interval(secs => c_hold_seconds), now()
      )
      ON CONFLICT (tournament_id) DO UPDATE SET
        table_id = EXCLUDED.table_id,
        creator_user_id = EXCLUDED.creator_user_id,
        wait_mode = EXCLUDED.wait_mode,
        invite_token = EXCLUDED.invite_token,
        hold_expires_at = EXCLUDED.hold_expires_at,
        updated_at = now();
    END IF;
  END IF;

  v_view := public.fn_private_game_hold_view(p_tournament_id);
  RETURN jsonb_build_object('ok', true, 'reused', false, 'invite_token', v_token) || v_view;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_private_game_hold_open(uuid, uuid, uuid, integer, boolean)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- INVITE TO GAME.
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

-- ---------------------------------------------------------------------------
-- The friend's door. A valid token admits; anyone else hears the rule.
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

  -- Serialised with every entry into the game, in the doors' lock order.
  PERFORM 1 FROM public.tournaments WHERE id = p_tournament_id FOR NO KEY UPDATE;

  SELECT * INTO v_hold FROM public.private_game_holds WHERE tournament_id = p_tournament_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'allowed', true, 'reserved', false);
  END IF;
  v_view := public.fn_private_game_hold_view(p_tournament_id);
  v_base := jsonb_build_object(
    'tournament_id', p_tournament_id,
    'table_id', public.fn_tournament_primary_table(p_tournament_id),
    'exclusive', v_view->'exclusive',
    'seats_held', v_view->'seats_held',
    'held_open', v_view->'held_open',
    'outcome', v_view->'outcome',
    'hold_expires_at', v_view->'hold_expires_at');

  IF (v_view->>'live')::boolean IS NOT TRUE THEN
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
-- The inviter lets the hold go. The game becomes an ordinary board.
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
-- What the table shows. The token is told only to the inviter.
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
  /* Who is holding the seat is told only to someone the hold is for. */
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
-- What the engine reads: every hold that could still be live, computed now.
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
  /* EXECUTE is granted to service_role only; a browser token that reached it
     anyway is refused by name. A session with no JWT (psql, pg_cron) reads. */
  IF COALESCE(auth.role(), 'service_role') <> 'service_role' THEN
    RAISE EXCEPTION 'fn_private_game_live_holds is for the engine' USING ERRCODE = '42501';
  END IF;
  /* A hold's live end is at most its nominal end plus one freeze (fifteen
     minutes is the thaw's own ceiling), so older rows cannot be live and are
     never read: the set stays the handful of invites open right now. */
  SELECT COALESCE(jsonb_agg(v ORDER BY v->>'tournament_id'), '[]'::jsonb)
    INTO v_out
    FROM (
      SELECT public.fn_private_game_hold_view(h.tournament_id) - 'creator_user_id' AS v
        FROM public.private_game_holds h
       WHERE h.status = 'holding'
         AND h.hold_expires_at > now() - interval '30 minutes'
    ) s
   WHERE v IS NOT NULL;
  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_private_game_live_holds()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_private_game_live_holds() TO service_role;

-- ---------------------------------------------------------------------------
-- SPECIFIC PLAYER IS ONE CASE OF THIS, NOT A SECOND MECHANISM.
-- Same signature, same answers; the hold behind it is a private game hold.
-- ---------------------------------------------------------------------------
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
  v_hold          jsonb;
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
   WHERE id = v_tbl.tournament_id
   FOR NO KEY UPDATE;

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
    UPDATE public.private_game_holds
       SET status = 'cancelled', cancelled_at = now(), updated_at = now()
     WHERE tournament_id = v_t.id
       AND creator_user_id = v_uid
       AND status = 'holding';
    INSERT INTO public.heads_up_wait_holds (
      tournament_id, table_id, creator_user_id, wait_mode, invite_token, hold_expires_at, updated_at
    ) VALUES (v_t.id, p_table_id, v_uid, 'play_anyone', NULL, now(), now())
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
      'invite_token', NULL,
      'hold_expires_at', now()
    );
  END IF;

  v_hold := public.fn_ca_private_game_hold_open(v_t.id, v_t.id, v_uid, 1, true);
  IF (v_hold->>'ok')::boolean IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'reason', COALESCE(v_hold->>'reason', 'hold_refused'));
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'mode', p_mode,
    'tournament_id', v_t.id,
    'table_id', p_table_id,
    'invite_token', v_hold->>'invite_token',
    'hold_expires_at', v_hold->'hold_expires_at'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_set_heads_up_wait_mode(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_set_heads_up_wait_mode(uuid, text)
  TO authenticated, service_role;

/* The browsers that still ask this question before a Heads Up purchase get the
   same answer as before, from the private hold, and a valid token is admitted
   here exactly as fn_accept_private_game_invite admits it - so an older page
   is not refused by the entry guard once it is attached. No longer STABLE:
   it records the admission. */
CREATE OR REPLACE FUNCTION public.fn_check_heads_up_seat_invite(
  p_table_id uuid,
  p_invite_token text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid          uuid := auth.uid();
  v_tournament   uuid;
  v_res          jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'fn_check_heads_up_seat_invite requires an authenticated caller'
      USING ERRCODE = '28000';
  END IF;

  IF p_table_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'allowed', true, 'reserved', false);
  END IF;

  SELECT tournament_id INTO v_tournament FROM public.tables WHERE id = p_table_id;
  IF v_tournament IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'allowed', true, 'reserved', false);
  END IF;

  v_res := public.fn_accept_private_game_invite(v_tournament, p_invite_token);
  IF (v_res->>'allowed')::boolean IS NOT FALSE THEN
    RETURN jsonb_build_object(
      'ok', true,
      'allowed', true,
      'reserved', COALESCE((v_res->>'reserved')::boolean, false),
      'is_creator', COALESCE((v_res->>'is_creator')::boolean, false),
      'token_valid', COALESCE((v_res->>'token_valid')::boolean, false),
      'hold_expires_at', v_res->'hold_expires_at'
    );
  END IF;
  RETURN jsonb_build_object(
    'ok', false,
    'allowed', false,
    'reserved', true,
    'reason', 'heads_up_invite_required',
    'hold_expires_at', v_res->'hold_expires_at'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_check_heads_up_seat_invite(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_check_heads_up_seat_invite(uuid, text)
  TO authenticated, service_role;

-- Post-apply security assertions (fail closed if RLS or grants drift).
DO $post$
BEGIN
  IF (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.private_game_holds'::regclass) IS NOT TRUE
     OR (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.private_game_admissions'::regclass) IS NOT TRUE THEN
    RAISE EXCEPTION 'private game hold tables must have row level security enabled';
  END IF;
  IF has_table_privilege('authenticated', 'public.private_game_holds', 'SELECT')
     OR has_table_privilege('anon', 'public.private_game_holds', 'SELECT')
     OR has_table_privilege('authenticated', 'public.private_game_admissions', 'INSERT') THEN
    RAISE EXCEPTION 'a browser role must never read an invite token or write an admission directly';
  END IF;
  IF has_function_privilege('anon', 'public.fn_invite_to_private_game(uuid,integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_accept_private_game_invite(uuid,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_private_game_live_holds()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_ca_private_game_hold_open(uuid,uuid,uuid,integer,boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_private_game_entry_refusal(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'private game hold grants drifted';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.fn_invite_to_private_game(uuid,integer)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.fn_accept_private_game_invite(uuid,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.fn_cancel_private_game_hold(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.fn_private_game_hold_state(uuid,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.fn_private_game_live_holds()', 'EXECUTE') THEN
    RAISE EXCEPTION 'private game hold doors are not reachable by their callers';
  END IF;
END;
$post$;

-- Function probes (tests/a-migration-proves-its-functions-before-commit.law.test.ts):
-- each SECURITY DEFINER PL/pgSQL body runs once inside a subtransaction that
-- always unwinds. A game id nobody holds answers without touching money.

-- @probe-for: public.fn_invite_to_private_game
-- @probe-for: public.fn_accept_private_game_invite
-- @probe-for: public.fn_cancel_private_game_hold
-- @probe-for: public.fn_private_game_hold_state
-- @probe-for: public.fn_set_heads_up_wait_mode
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

  v_res := public.fn_invite_to_private_game(gen_random_uuid(), 1);
  IF v_res->>'reason' IS DISTINCT FROM 'game_not_found' THEN
    RAISE EXCEPTION 'unexpected probe result from fn_invite_to_private_game: %', v_res;
  END IF;
  v_res := public.fn_accept_private_game_invite(gen_random_uuid(), 'abcdefabcdefabcdef');
  IF (v_res->>'allowed')::boolean IS NOT TRUE OR (v_res->>'reserved')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'unexpected probe result from fn_accept_private_game_invite: %', v_res;
  END IF;
  v_res := public.fn_cancel_private_game_hold(gen_random_uuid());
  IF v_res->>'reason' IS DISTINCT FROM 'no_hold' THEN
    RAISE EXCEPTION 'unexpected probe result from fn_cancel_private_game_hold: %', v_res;
  END IF;
  v_res := public.fn_private_game_hold_state(gen_random_uuid(), NULL);
  IF (v_res->>'held')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'unexpected probe result from fn_private_game_hold_state: %', v_res;
  END IF;
  v_res := public.fn_set_heads_up_wait_mode(gen_random_uuid(), 'specific_player');
  IF v_res->>'reason' IS DISTINCT FROM 'table_not_found' THEN
    RAISE EXCEPTION 'unexpected probe result from fn_set_heads_up_wait_mode: %', v_res;
  END IF;
  v_res := public.fn_check_heads_up_seat_invite(gen_random_uuid(), NULL);
  IF (v_res->>'allowed')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'unexpected probe result from fn_check_heads_up_seat_invite: %', v_res;
  END IF;

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

-- @probe-exempt: public.fn_private_game_entry_guard is a BEFORE trigger function on tournament_players attached by 20261123013136; exercised by INSERT in scripts/ci/test-private-game-holds-postgres.py

COMMIT;
