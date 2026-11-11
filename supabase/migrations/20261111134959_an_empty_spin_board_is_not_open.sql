-- 20261111134959_an_empty_spin_board_is_not_open
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-11 13:49:59 UTC.
--
-- @live-proof: position('ts.left_at is null' IN pg_get_functiondef('public.fn_spin_metrics(integer)'::regprocedure)) > 0 AND position('AN EMPTY BOARD IS NOT OPEN' IN pg_get_functiondef('public.fn_spin_metrics(integer)'::regprocedure)) > 0
--
-- AN EMPTY BOARD IS NOT OPEN (2026-11-11, alert SpinFleetProducingNothing,
-- fired 2026-11-11 11:19:17Z: "Spin has produced nothing for 8724s past the
-- ladder's own envelope").
--
-- WHAT WAS WRONG
--
-- SpinFleetProducingNothing's first arm is
--   poker_spin_seconds_since_last_start > poker_spin_ladder_full_envelope_seconds
--   and poker_spin_open_boards > 0
-- and its own comment states the contract: "A room with no boards open and
-- nothing starting is a quiet night and must never page anyone."
-- poker_spin_open_boards is fn_spin_metrics.open_boards, which counted EVERY
-- Spin in REGISTERING, including boards nobody sits at.
--
-- Measured read-only on production 2026-11-11 13:30Z: 45 Spins REGISTERING,
-- 32 of them created 2026-11-09 06:24Z-08:16Z with no tournament_players row
-- and no live seat. #10340 recorded why they stay: they belong to
-- certification fixture clubs with zero horse members, the seat-first
-- launcher (correctly) cannot open them and writes nothing for them, and the
-- ladder never cancels a board. The engine already counts an OPENED board as
-- one with a live seat (#10234, "an empty board is not one of the eleven").
-- The metric did not, so through the overnight quiet - no house board open,
-- nothing starting, by design - it read 33 "open" boards and the critical
-- page fired on the room working as specified. Prometheus, same morning:
-- open_boards 33 from 09:10Z to 12:00Z while seconds_since_last_start climbed
-- from 998 to 11184; at 12:00Z the house opened its boards (open_boards 44).
--
-- WHAT THIS CHANGES
--
-- fn_spin_metrics.open_boards counts a REGISTERING Spin only when it holds a
-- live seat: a table_seats row with left_at IS NULL on one of its tables, the
-- same predicate v_spin_unfilled_waits uses for live_seats. The floor-park
-- exclusion is kept. Nothing else in the function changes; every other gauge,
-- the signature, volatility, security, search_path, owner and grants are
-- asserted unchanged below. On production the new count reads 11 (the
-- SPIN_BOARD_OPEN_TARGET boards), in 36 ms (EXPLAIN ANALYZE, 2026-11-11).
--
-- The alert still pages on the outage it exists for: boards that horses or
-- people HAVE opened and that never start. A board with one horse in it is
-- open; the 32 fixture boards are not. No row is written, cancelled, refunded
-- or deleted, and no game rule changes.

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';

DO $change$
DECLARE
  d text;
  m jsonb;
  v_old constant text := $old$    where t.variant = 'spin' and t.status = 'REGISTERING'
      -- A board an owner floor park refuses to start is held, not open
      -- (2026-10-15, migration 20261015222118).
      and not public.fn_ca_operator_floor_park_holds(t.club_id, t.union_id)
$old$;
  v_new constant text := $new$    where t.variant = 'spin' and t.status = 'REGISTERING'
      -- A board an owner floor park refuses to start is held, not open
      -- (2026-10-15, migration 20261015222118).
      and not public.fn_ca_operator_floor_park_holds(t.club_id, t.union_id)
      -- AN EMPTY BOARD IS NOT OPEN (2026-11-11, migration 20261111134959).
      -- Only a board somebody sits at can be waiting on the ladder; the
      -- predicate is v_spin_unfilled_waits' own live seat.
      and exists (
        select 1
        from public.table_seats ts
        join public.tables tb on tb.id = ts.table_id
        where tb.tournament_id = t.id and ts.left_at is null
      )
$new$;
BEGIN
  d := pg_get_functiondef('public.fn_spin_metrics(integer)'::regprocedure);
  IF md5(d) IS DISTINCT FROM 'c3eec000c70e31cfcc3c38b8bac998fe' THEN
    RAISE EXCEPTION 'public.fn_spin_metrics changed since 2026-11-11 (expected md5 c3eec000c70e31cfcc3c38b8bac998fe, found %). Another writer owns it: re-read the live definition and re-apply the live-seat predicate onto it.', md5(d);
  END IF;
  IF (length(d) - length(replace(d, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'fn_spin_metrics open-board anchor is not unique';
  END IF;
  SELECT jsonb_build_object('owner', proowner, 'acl', proacl, 'config', proconfig,
                            'secdef', prosecdef, 'volatility', provolatile,
                            'result', pg_get_function_result(oid))
    INTO m FROM pg_proc WHERE oid = 'public.fn_spin_metrics(integer)'::regprocedure;

  EXECUTE replace(d, v_old, v_new);

  IF m IS DISTINCT FROM (
       SELECT jsonb_build_object('owner', proowner, 'acl', proacl, 'config', proconfig,
                                 'secdef', prosecdef, 'volatility', provolatile,
                                 'result', pg_get_function_result(oid))
         FROM pg_proc WHERE oid = 'public.fn_spin_metrics(integer)'::regprocedure) THEN
    RAISE EXCEPTION 'fn_spin_metrics metadata changed';
  END IF;
  IF pg_get_functiondef('public.fn_spin_metrics(integer)'::regprocedure) IS DISTINCT FROM replace(d, v_old, v_new) THEN
    RAISE EXCEPTION 'fn_spin_metrics postimage is not the anchored replacement';
  END IF;
END
$change$;

COMMIT;
