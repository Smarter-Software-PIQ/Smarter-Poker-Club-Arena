-- 20261123072823_every_cash_seat_writer_takes_its_table_first.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- EVERY CASH SEAT WRITER TAKES ITS TABLE FIRST
--
-- THE RULE. A table's row is the parent of every chair at it. Since
-- 20261123024433 (the cash-out), 20261123024034 (sit out and the departure
-- request) and the dealt manifest, the cash paths that touch both lock the
-- tables row and then the seat. A writer that locks a seat and only then its
-- table (directly, or through zz_note_human_seat_seen, the AFTER trigger that
-- updates tables.last_human_seen_at whenever a human chair's leave_pending or
-- is_sitting_out changes, or through atomic_seat_cashout_locked, which now
-- takes the table itself) waits for a table one of those holds while that
-- one waits for the seat it holds: a deadlock, and the player's request is
-- the side Postgres cancels.
--
-- THE INVENTORY. Every function body in public and smarter_private that
-- writes public.table_seats was read from production on 2026-11-23. Four
-- still took a cash seat before its table:
--
--   fn_lightning_owed_leave_returns_to_pool  seat FOR UPDATE OF ts, then its
--     UPDATE of leave_pending/is_sitting_out takes the table through
--     zz_note_human_seat_seen;
--   fn_lightning_rejoin_seated               seat FOR UPDATE OF ts, then
--     atomic_seat_cashout_locked takes the table (a busted anchor's exit);
--   player_leave_table                       seat FOR UPDATE, then
--     atomic_seat_cashout_locked takes the table (a cash table only; a
--     tournament's game row was already taken first);
--   fn_cash_cluster_commit_must_move         every live seat of the cluster
--     FOR SHARE, then its UPDATE public.tables lifts the Lightning halt: a
--     cash-out holding one member table and waiting for its seat, held
--     FOR SHARE here, is the cycle.
--
-- Already table first, and why each is left alone: fn_cash_seat_move_execute
-- (cash_games, then every from/to table ORDER BY id FOR UPDATE, then the
-- moves; its inner _before_maintenance_gate move and swap are executable by
-- postgres alone and run only under it); fn_poker_diamond_buyin (tables FOR
-- UPDATE OF t before it deletes or inserts a chair); fn_cash_seat_sitout and
-- fn_request_seat_departure (20261123024034); fn_cashout_seat_occupancy and
-- atomic_seat_cashout_locked (20261123024433); atomic_table_cashout and
-- fn_admin_kick_player (they read the seat unlocked and leave the lock to
-- atomic_seat_cashout_locked); fn_take_seat_and_buy_in and
-- fn_seat_stage_entitlement (tables FOR UPDATE first);
-- fn_union_close_club_tables_for_join (its club's tables FOR UPDATE, then
-- their chairs); force_close_table_and_refund (fn_cashout_seats_for_closing_
-- table refuses a cash table that still has a live chair, so its seat UPDATE
-- never meets a live cash chair). Not a cycle: fn_lightning_pool_enter_seated and
-- fn_lightning_pool_enter lock one seat and never the table;
-- schedule_horse_leave changes only a horse's chair, which never touches the
-- table (zz_note_human_seat_seen acts for a human chair); the engine's stack
-- and time-bank writes and the hand settlement lock seats and never the
-- table; fn_cash_cluster_abort_pending_off writes no seat.
-- atomic_table_buyin_before_maintenance_announcement_gate inserts a NEW chair
-- before its table (20261123024433 (b)): an uncommitted chair is invisible to
-- every reader that locks chairs, so nobody holding the table can be waiting
-- for it. Tournament seat writers serialise on the tournament row first and
-- are outside this cash inventory; the maintenance thaw writes seats only
-- while the platform is frozen.
--
-- THE FIX. Each of the four takes its table first, in the mode its own later
-- write takes (FOR NO KEY UPDATE, a non-key UPDATE of tables):
--   * the owed-leave return locks p_table_id before the seat;
--   * the rejoin locks the table of the chair it is about to select, chosen by
--     the same predicate and order, under the same user lock and the same
--     cluster FOR SHARE that keep that choice stable, then selects the chair;
--   * the system leave locks a cash table where it already locked a
--     tournament's game row;
--   * the reversion locks every member table of the cluster ORDER BY id (the
--     order fn_cash_seat_move_execute uses) right after the cluster row and
--     before the seats. Its mode lock (lightning_cluster_mode) stays after
--     the row locks: the seat triggers that take it SHARED are DEFERRABLE
--     INITIALLY DEFERRED and run at their writer's commit, after that writer's
--     table and seat, so a writer never waits for a table while holding it.
--
-- MONEY. Nothing is credited, debited, priced, refunded or skipped
-- differently. Every amount, key and write is the same; only the moment a row
-- lock is taken moves. Nothing reads is_horse.
--
-- Proof: scripts/dev/prove-reporting-and-seat-writers-take-one-order.sh
-- Law: tests/every-cash-seat-writer-takes-its-table-first.law.test.ts
-- Changelog: docs/changelog/2026-11-23-reporting-and-seat-writers-take-one-order.md
--
-- HOW. Anchored edits of the live definitions: each needle must occur exactly
-- once or the whole file aborts and nothing changes.
-- @live-proof: (SELECT pg_get_functiondef('public.fn_lightning_owed_leave_returns_to_pool(uuid,uuid,integer,uuid)'::regprocedure) LIKE '%THE TABLE BEFORE THE SEAT (20261123072823)%PERFORM 1 FROM public.tables WHERE id = p_table_id FOR NO KEY UPDATE;%FROM public.table_seats ts%FOR UPDATE OF ts;%UPDATE public.table_seats%')
-- @live-proof: (SELECT pg_get_functiondef('public.fn_lightning_rejoin_seated(uuid)'::regprocedure) LIKE '%cash_games WHERE id=p_cluster_id FOR SHARE;%THE TABLE BEFORE THE SEAT (20261123072823)%FOR NO KEY UPDATE OF tt;%ORDER BY ts.joined_at DESC LIMIT 1 FOR UPDATE OF ts;%atomic_seat_cashout_locked%')
-- @live-proof: (SELECT pg_get_functiondef('public.player_leave_table(uuid,uuid)'::regprocedure) LIKE '%FROM tournaments WHERE id = v_tournament_id FOR NO KEY UPDATE;%THE TABLE BEFORE THE SEAT (20261123072823)%PERFORM 1 FROM tables WHERE id = p_table_id FOR NO KEY UPDATE;%FROM table_seats%FOR UPDATE;%atomic_seat_cashout_locked%')
-- @live-proof: (SELECT pg_get_functiondef('public.fn_cash_cluster_commit_must_move(uuid,uuid)'::regprocedure) LIKE '%FROM public.cash_games WHERE id = p_game_id FOR UPDATE;%THE TABLES BEFORE THEIR SEATS (20261123072823)%PERFORM 1 FROM public.tables tb WHERE tb.cluster_id = g.id ORDER BY tb.id FOR NO KEY UPDATE;%INTO v_locked_seats FROM (%UPDATE public.tables tb%')

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- (1) The Lightning owed-leave return: the table before the seat.
DO $owed_leave$
DECLARE
  v_def text := pg_get_functiondef('public.fn_lightning_owed_leave_returns_to_pool(uuid,uuid,integer,uuid)'::regprocedure);
  v_old text := $o$  SELECT ts.id, ts.leave_pending, tb.cluster_id
    INTO v_seat
$o$;
  v_new text := $r$  /* THE TABLE BEFORE THE SEAT (20261123072823). The table row, parent of
     the chair, is locked before the chair, in the mode the human-chair
     trigger's UPDATE of tables (fired by the leave_pending change below)
     takes. A cash-out, a sit-out and a departure request all take the table
     first; taken after the seat, this return deadlocks with each of them. */
  PERFORM 1 FROM public.tables WHERE id = p_table_id FOR NO KEY UPDATE;

  SELECT ts.id, ts.leave_pending, tb.cluster_id
    INTO v_seat
$r$;
BEGIN
  IF position('THE TABLE BEFORE THE SEAT' IN v_def) > 0 THEN
    RAISE EXCEPTION 'fn_lightning_owed_leave_returns_to_pool already locks its table first: re-read before editing';
  END IF;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'fn_lightning_owed_leave_returns_to_pool seat lock anchor was expected exactly once';
  END IF;
  IF position('FOR UPDATE OF ts' IN v_def) < position(v_old IN v_def) THEN
    RAISE EXCEPTION 'fn_lightning_owed_leave_returns_to_pool locks a seat before the anchor: re-read before editing';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$owed_leave$;

-- (2) The Lightning rejoin: the chosen chair's table before the chair.
DO $rejoin$
DECLARE
  v_def text := pg_get_functiondef('public.fn_lightning_rejoin_seated(uuid)'::regprocedure);
  v_old text := $o$ SELECT ts.* INTO s FROM public.table_seats ts JOIN public.tables t ON t.id=ts.table_id
 WHERE ts.user_id=u AND ts.left_at IS NULL AND t.cluster_id=p_cluster_id
 ORDER BY ts.joined_at DESC LIMIT 1 FOR UPDATE OF ts;
$o$;
  v_new text := $r$ /* THE TABLE BEFORE THE SEAT (20261123072823). The table of the chair the
    next statement selects (same predicate, same order, under the user lock
    and the cluster FOR SHARE above that keep the choice stable) is locked
    first, in the mode atomic_seat_cashout_locked takes it below. Taken after
    the chair, a busted anchor's exit deadlocked with every cash path that
    holds the table and wants the chair. */
 PERFORM 1 FROM public.tables tt
  WHERE tt.id = (SELECT ts.table_id FROM public.table_seats ts JOIN public.tables t ON t.id=ts.table_id
                  WHERE ts.user_id=u AND ts.left_at IS NULL AND t.cluster_id=p_cluster_id
                  ORDER BY ts.joined_at DESC LIMIT 1)
    FOR NO KEY UPDATE OF tt;
 SELECT ts.* INTO s FROM public.table_seats ts JOIN public.tables t ON t.id=ts.table_id
 WHERE ts.user_id=u AND ts.left_at IS NULL AND t.cluster_id=p_cluster_id
 ORDER BY ts.joined_at DESC LIMIT 1 FOR UPDATE OF ts;
$r$;
BEGIN
  IF position('THE TABLE BEFORE THE SEAT' IN v_def) > 0 THEN
    RAISE EXCEPTION 'fn_lightning_rejoin_seated already locks its table first: re-read before editing';
  END IF;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'fn_lightning_rejoin_seated seat lock anchor was expected exactly once';
  END IF;
  IF position('cash_games WHERE id=p_cluster_id FOR SHARE' IN v_def) = 0
     OR position('cash_games WHERE id=p_cluster_id FOR SHARE' IN v_def) > position(v_old IN v_def) THEN
    RAISE EXCEPTION 'fn_lightning_rejoin_seated no longer holds its cluster before the seat: re-read before editing';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$rejoin$;

-- (3) The system leave: a cash table before the seat.
DO $leave$
DECLARE
  v_def text := pg_get_functiondef('public.player_leave_table(uuid,uuid)'::regprocedure);
  v_old text := $o$  IF v_tournament_id IS NOT NULL THEN
    PERFORM 1 FROM tournaments WHERE id = v_tournament_id FOR NO KEY UPDATE;
  END IF;
$o$;
  v_new text := $r$  IF v_tournament_id IS NOT NULL THEN
    PERFORM 1 FROM tournaments WHERE id = v_tournament_id FOR NO KEY UPDATE;
  ELSE
    /* THE TABLE BEFORE THE SEAT (20261123072823). A cash table's row is
       locked before the seat, where a tournament's game row is, in the mode
       atomic_seat_cashout_locked takes it below. */
    PERFORM 1 FROM tables WHERE id = p_table_id FOR NO KEY UPDATE;
  END IF;
$r$;
BEGIN
  IF position('THE TABLE BEFORE THE SEAT' IN v_def) > 0 THEN
    RAISE EXCEPTION 'player_leave_table already locks its table first: re-read before editing';
  END IF;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'player_leave_table game lock anchor was expected exactly once';
  END IF;
  IF position(v_old IN v_def) > position('FROM table_seats' IN v_def) THEN
    RAISE EXCEPTION 'player_leave_table reads its seat before the game lock: re-read before editing';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$leave$;

-- (4) The Lightning reversion: every member table before any seat.
DO $must_move$
DECLARE
  v_def text := pg_get_functiondef('public.fn_cash_cluster_commit_must_move(uuid,uuid)'::regprocedure);
  v_old text := $o$  SELECT coalesce(array_agg(x.id ORDER BY x.id), ARRAY[]::uuid[]) INTO v_locked_seats FROM (
    SELECT ts.id FROM public.table_seats ts
$o$;
  v_new text := $r$  /* THE TABLES BEFORE THEIR SEATS (20261123072823). Every member table,
     parent of the seats below, is locked first, in id order (the order
     fn_cash_seat_move_execute takes its tables) and in the mode the halt
     lift's UPDATE public.tables takes at the end. Taken there instead, after
     the seats FOR SHARE, a cash-out holding one member table and waiting for
     its seat closed a cycle. The mode lock stays after the row locks. */
  PERFORM 1 FROM public.tables tb WHERE tb.cluster_id = g.id ORDER BY tb.id FOR NO KEY UPDATE;
  SELECT coalesce(array_agg(x.id ORDER BY x.id), ARRAY[]::uuid[]) INTO v_locked_seats FROM (
    SELECT ts.id FROM public.table_seats ts
$r$;
BEGIN
  IF position('THE TABLES BEFORE THEIR SEATS' IN v_def) > 0 THEN
    RAISE EXCEPTION 'fn_cash_cluster_commit_must_move already locks its tables first: re-read before editing';
  END IF;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'fn_cash_cluster_commit_must_move seat lock anchor was expected exactly once';
  END IF;
  IF position('FROM public.cash_games WHERE id = p_game_id FOR UPDATE' IN v_def) = 0
     OR position('FROM public.cash_games WHERE id = p_game_id FOR UPDATE' IN v_def) > position(v_old IN v_def)
     OR position('UPDATE public.tables tb' IN v_def) < position(v_old IN v_def) THEN
    RAISE EXCEPTION 'fn_cash_cluster_commit_must_move no longer takes cluster, seats, then tables: re-read before editing';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$must_move$;

-- Each of the four now takes a table before its first seat lock.
DO $verify_tables_first$
DECLARE
  v_def text;
BEGIN
  v_def := pg_get_functiondef('public.fn_lightning_owed_leave_returns_to_pool(uuid,uuid,integer,uuid)'::regprocedure);
  IF NOT (position('PERFORM 1 FROM public.tables WHERE id = p_table_id FOR NO KEY UPDATE' IN v_def) BETWEEN 1 AND position('FOR UPDATE OF ts' IN v_def)) THEN
    RAISE EXCEPTION 'the owed-leave return does not lock its table before its seat';
  END IF;
  v_def := pg_get_functiondef('public.fn_lightning_rejoin_seated(uuid)'::regprocedure);
  IF NOT (position('FOR NO KEY UPDATE OF tt' IN v_def) BETWEEN 1 AND position('FOR UPDATE OF ts' IN v_def)) THEN
    RAISE EXCEPTION 'the rejoin does not lock its table before its seat';
  END IF;
  v_def := pg_get_functiondef('public.player_leave_table(uuid,uuid)'::regprocedure);
  IF NOT (position('PERFORM 1 FROM tables WHERE id = p_table_id FOR NO KEY UPDATE' IN v_def) BETWEEN 1 AND position('FROM table_seats' IN v_def)) THEN
    RAISE EXCEPTION 'the system leave does not lock its table before its seat';
  END IF;
  v_def := pg_get_functiondef('public.fn_cash_cluster_commit_must_move(uuid,uuid)'::regprocedure);
  IF NOT (position('PERFORM 1 FROM public.tables tb WHERE tb.cluster_id = g.id ORDER BY tb.id FOR NO KEY UPDATE' IN v_def)
          BETWEEN position('FROM public.cash_games WHERE id = p_game_id FOR UPDATE' IN v_def) AND position('INTO v_locked_seats FROM (' IN v_def)) THEN
    RAISE EXCEPTION 'the reversion does not lock its tables between its cluster and its seats';
  END IF;
END
$verify_tables_first$;

-- @probe-for: public.fn_lightning_owed_leave_returns_to_pool
DO $probe_owed_leave$
DECLARE
  v_out jsonb;
BEGIN
  -- An occupancy that does not exist: the edited body locks a table id no
  -- row holds and answers stale_occupancy (platform_frozen in a break).
  v_out := public.fn_lightning_owed_leave_returns_to_pool(gen_random_uuid(), gen_random_uuid(), 1, gen_random_uuid());
  IF v_out->>'reason' NOT IN ('stale_occupancy', 'platform_frozen') THEN
    RAISE EXCEPTION 'the owed-leave probe expected stale_occupancy, got %', v_out;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_owed_leave$;

-- @probe-for: public.fn_lightning_rejoin_seated
DO $probe_rejoin$
DECLARE
  v_cluster uuid;
  v_out jsonb;
BEGIN
  -- A player who holds no chair, at a Lightning cluster if one exists: the
  -- edited body reaches the new table lock, finds no chair and answers NULL.
  -- The claim is local to this block and undone with it.
  SELECT g.id INTO v_cluster FROM public.cash_games g WHERE g.cluster_mode = 'lightning' ORDER BY g.id LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  BEGIN
    v_out := public.fn_lightning_rejoin_seated(COALESCE(v_cluster, gen_random_uuid()));
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'PLATFORM_FROZEN' THEN RAISE; END IF;
  END;
  IF v_out IS NOT NULL THEN
    RAISE EXCEPTION 'the rejoin probe expected no chair for an unseated player, got %', v_out;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_rejoin$;

-- @probe-for: public.player_leave_table
DO $probe_leave$
BEGIN
  -- A table and player that do not exist: the edited body takes its user
  -- lock, locks a table id no row holds, finds no seat and returns.
  PERFORM public.player_leave_table(gen_random_uuid(), gen_random_uuid());
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_leave$;

-- @probe-for: public.fn_cash_cluster_commit_must_move
DO $probe_must_move$
DECLARE
  v_out jsonb;
BEGIN
  -- A cluster that does not exist: the edited body answers not_found (or
  -- platform_frozen in a break) and moves nothing.
  v_out := public.fn_cash_cluster_commit_must_move(gen_random_uuid(), gen_random_uuid());
  IF v_out->>'reason' NOT IN ('not_found', 'platform_frozen') THEN
    RAISE EXCEPTION 'the reversion probe expected not_found, got %', v_out;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_must_move$;

COMMIT;
