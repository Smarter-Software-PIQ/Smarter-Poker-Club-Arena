-- 20261123024034_a_sit_out_takes_its_table_before_its_seat.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- A SIT-OUT OR A DEPARTURE TAKES ITS TABLE BEFORE ITS SEAT
--
-- THE DEFECT, READ FROM THE POSTGRES LOG. A tournament hand's continuation
-- journal (fn_f06_retain_hand_continuation, the PostgREST call taking
-- p_tournament_id, p_lease_generation, p_table_id, p_hand_number, p_sequence,
-- p_payload, p_sha256) and the engine's sit-out of a player at the same table
-- (fn_cash_seat_sitout) deadlocked at 07:06:39 and 18:32:04 UTC on
-- 2026-11-22. Postgres cancelled the journal write both times. The journal's
-- side is the same line each time:
--
--   while locking tuple (...) in relation "table_seats"
--   fn_ca_f06_share_table_lane line 22:
--   SELECT s.id FROM public.table_seats s ... ORDER BY s.id FOR UPDATE OF s
--
-- THE CAUSE, BY LINE. fn_ca_f06_share_table_lane takes the table row FOR
-- UPDATE and then every seat of the table in id order: the order every hand
-- lane uses (table row, then seats). fn_cash_seat_sitout takes the player's
-- seat FOR UPDATE first and then updates it. That UPDATE of is_sitting_out
-- fires the AFTER trigger zz_note_human_seat_seen (migration 20261112022000),
-- which runs, for a person's seat:
--
--   UPDATE public.tables SET last_human_seen_at = now() WHERE id = tid;
--
-- So the sit-out held the seat and waited for the table row, while the lane
-- held the table row and waited for the seat. fn_request_seat_departure has
-- the same shape: it locks the seat, then sets is_sitting_out (and, at a cash
-- table, leave_pending) on it, which fires the same trigger, on tournament
-- tables as well as cash. It has not deadlocked in the logs yet, but it would
-- the same way, and once the sit-out takes the table first it is the only
-- writer of those two columns that could still close a cycle with a sit-out
-- of the same seat.
--
-- THE FIX. Both functions take the table row FOR NO KEY UPDATE before the
-- seat: the mode the trigger's UPDATE takes anyway (last_human_seen_at is not
-- a key column), so the trigger needs no stronger lock later and never waits
-- for the row after the seat is held. A sit-out or departure that meets a
-- hand lane now waits at the table row holding nothing, and the lane finishes
-- first, or the other way round. The departure keeps its tournament row first
-- (tournament, table, seat: the order a hand commit takes them).
--
-- The lock is taken for every seat, a horse's as well as a person's (the
-- trigger writes only for a person, but nothing here reads is_horse). No
-- seat, stack, payout, finishing place or sit-out result changes: the same
-- rows are written with the same values. Only the order of two locks moves.
--
-- Proof: scripts/dev/prove-a-sit-out-takes-its-table-before-its-seat.sh
-- Law: tests/a-sit-out-takes-its-table-before-its-seat.law.test.ts
-- Changelog: docs/changelog/2026-11-22-a-sit-out-takes-its-table-before-its-seat.md
--
-- HOW. Anchored edits of the live definition: each needle must occur exactly
-- once or the whole file aborts and nothing changes.
-- @live-proof: (SELECT position('PERFORM 1 FROM public.tables WHERE id=p_table_id FOR NO KEY UPDATE' IN pg_get_functiondef('public.fn_cash_seat_sitout(uuid,uuid,uuid,boolean)'::regprocedure)) BETWEEN 1 AND position('SELECT * INTO seat FROM public.table_seats' IN pg_get_functiondef('public.fn_cash_seat_sitout(uuid,uuid,uuid,boolean)'::regprocedure)))
-- @live-proof: (SELECT position('PERFORM 1 FROM public.tables WHERE id=p_table_id FOR NO KEY UPDATE' IN pg_get_functiondef('public.fn_request_seat_departure(uuid,uuid,integer,uuid,text)'::regprocedure)) BETWEEN 1 AND position('SELECT id INTO v_seat_id FROM public.table_seats' IN pg_get_functiondef('public.fn_request_seat_departure(uuid,uuid,integer,uuid,text)'::regprocedure)))

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $sitout_table_first$
DECLARE
  v_def text := pg_get_functiondef('public.fn_cash_seat_sitout(uuid,uuid,uuid,boolean)'::regprocedure);
  v_old text := $o$  SELECT * INTO seat FROM public.table_seats ts WHERE ts.table_id=p_table_id AND ts.user_id=p_user_id$o$;
  v_new text := $r$  -- THE TABLE BEFORE THE SEAT (20261123024034). The seat UPDATE below fires
  -- zz_note_human_seat_seen, which writes this table row. Taken here, in the
  -- mode that write needs, the order is the hand lanes' own (table row, then
  -- seats), so a hand lane and this sit-out never wait on each other in a cycle.
  PERFORM 1 FROM public.tables WHERE id=p_table_id FOR NO KEY UPDATE;
  SELECT * INTO seat FROM public.table_seats ts WHERE ts.table_id=p_table_id AND ts.user_id=p_user_id$r$;
BEGIN
  IF position('FROM public.tables WHERE id=p_table_id FOR NO KEY UPDATE' IN v_def)>0 THEN
    RAISE EXCEPTION 'fn_cash_seat_sitout already takes its table before its seat: re-read before editing';
  END IF;
  IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN
    RAISE EXCEPTION 'fn_cash_seat_sitout seat lock anchor was expected exactly once';
  END IF;
  EXECUTE replace(v_def,v_old,v_new);
END
$sitout_table_first$;

-- @probe-for: public.fn_cash_seat_sitout
DO $probe_sitout$
BEGIN
  IF public.fn_cash_seat_sitout(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), true) IS NOT NULL THEN
    RAISE EXCEPTION 'SIT_OUT_PROBE_FOUND_A_SEAT';
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_sitout$;

DO $verify_sitout$
BEGIN
  IF (length(pg_get_functiondef('public.fn_cash_seat_sitout(uuid,uuid,uuid,boolean)'::regprocedure))-length(replace(pg_get_functiondef('public.fn_cash_seat_sitout(uuid,uuid,uuid,boolean)'::regprocedure),'PERFORM 1 FROM public.tables WHERE id=p_table_id FOR NO KEY UPDATE','')))
        /length('PERFORM 1 FROM public.tables WHERE id=p_table_id FOR NO KEY UPDATE')<>1
     OR position('PERFORM 1 FROM public.tables WHERE id=p_table_id FOR NO KEY UPDATE' IN pg_get_functiondef('public.fn_cash_seat_sitout(uuid,uuid,uuid,boolean)'::regprocedure))
        >= position('SELECT * INTO seat FROM public.table_seats' IN pg_get_functiondef('public.fn_cash_seat_sitout(uuid,uuid,uuid,boolean)'::regprocedure)) THEN
    RAISE EXCEPTION 'the sit-out table lock did not install exactly once before its seat lock';
  END IF;
END
$verify_sitout$;

DO $departure_table_first$
DECLARE
  v_def text := pg_get_functiondef('public.fn_request_seat_departure(uuid,uuid,integer,uuid,text)'::regprocedure);
  v_old text := $o$ SELECT id INTO v_seat_id FROM public.table_seats$o$;
  v_new text := $r$ -- THE TABLE BEFORE THE SEAT (20261123024034). The seat UPDATE below fires
 -- zz_note_human_seat_seen, which writes this table row. Taken here, after
 -- the tournament row and in the mode that write needs, the order is a hand
 -- commit's own (tournament, table row, then seats).
 PERFORM 1 FROM public.tables WHERE id=p_table_id FOR NO KEY UPDATE;
 SELECT id INTO v_seat_id FROM public.table_seats$r$;
BEGIN
  IF position('FROM public.tables WHERE id=p_table_id FOR NO KEY UPDATE' IN v_def)>0 THEN
    RAISE EXCEPTION 'fn_request_seat_departure already takes its table before its seat: re-read before editing';
  END IF;
  IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN
    RAISE EXCEPTION 'fn_request_seat_departure seat lock anchor was expected exactly once';
  END IF;
  EXECUTE replace(v_def,v_old,v_new);
END
$departure_table_first$;

-- @probe-for: public.fn_request_seat_departure
DO $probe_departure$
BEGIN
  BEGIN
    PERFORM public.fn_request_seat_departure(gen_random_uuid(), gen_random_uuid(), 1, gen_random_uuid(), 'voluntary');
    RAISE EXCEPTION 'DEPARTURE_PROBE_FOUND_A_TABLE';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'CASHOUT_TABLE_NOT_FOUND' THEN RAISE; END IF;
  END;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_departure$;

DO $verify_departure$
BEGIN
  IF (length(pg_get_functiondef('public.fn_request_seat_departure(uuid,uuid,integer,uuid,text)'::regprocedure))-length(replace(pg_get_functiondef('public.fn_request_seat_departure(uuid,uuid,integer,uuid,text)'::regprocedure),'PERFORM 1 FROM public.tables WHERE id=p_table_id FOR NO KEY UPDATE','')))
        /length('PERFORM 1 FROM public.tables WHERE id=p_table_id FOR NO KEY UPDATE')<>1
     OR position('PERFORM 1 FROM public.tables WHERE id=p_table_id FOR NO KEY UPDATE' IN pg_get_functiondef('public.fn_request_seat_departure(uuid,uuid,integer,uuid,text)'::regprocedure))
        >= position('SELECT id INTO v_seat_id FROM public.table_seats' IN pg_get_functiondef('public.fn_request_seat_departure(uuid,uuid,integer,uuid,text)'::regprocedure))
     OR position('PERFORM 1 FROM public.tables WHERE id=p_table_id FOR NO KEY UPDATE' IN pg_get_functiondef('public.fn_request_seat_departure(uuid,uuid,integer,uuid,text)'::regprocedure))
        <= position('FROM public.tournaments WHERE id=v_tournament FOR NO KEY UPDATE' IN pg_get_functiondef('public.fn_request_seat_departure(uuid,uuid,integer,uuid,text)'::regprocedure)) THEN
    RAISE EXCEPTION 'the departure table lock did not install exactly once between its tournament and seat locks';
  END IF;
END
$verify_departure$;

COMMIT;
