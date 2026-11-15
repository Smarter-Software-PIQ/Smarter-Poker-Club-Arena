-- 20261115170236_a_moved_player_never_posts_to_enter_a_new_table.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Owner rule, Dan, 2026-11-15: "WHEN A PLAYER IS MOVED ON A MUST MOVE GAME TO
-- A NEW TABLE, THEY NEVER NEED TO POST TO RECEIVE A HAND, IF THEY ARE COMING
-- FROM A PREVIOUS TABLE. THEY ONLY POST IF THEY ARE IN THE BB OR IF THEY ARE
-- SITTING OUT AND MISS THE BLINDS."
--
-- must_move, break and balance already arrive owing nothing
-- (entry_hold = 'moved'). A seat change did not: since 2026-09-05 both
-- executors seated it as a fresh entrant who had agreed to post
-- (entry_hold = 'waiting', entry_post_agreed = true), so the engine billed a
-- live big blind on the next deal at the new table. That is the bug. A seat
-- change comes from a previous table in the same game, so it now arrives
-- exactly like every other move: 'moved', not agreed. The engine already
-- handles 'moved' (ServerTableEngineDealing: no wait-for-BB registration;
-- ServerTableEngineBase.admitMovedSeats: held only while its chair sits
-- between the button and the big blind, never billed; the marker clears when
-- the deal admits it). The big blind is posted when it reaches the chair, and
-- missed blinds after a sit-out are unchanged.
--
-- Only the two lines that choose the entry change, in place, against the
-- reviewed live bodies (md5 below). Sit-out carry, stack, session re-point and
-- receipts are untouched. No hot-table lock: functions only.

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $mig$
DECLARE
  v_src text; v_new text; v_n int; v_md5 text; v_check text;
  v_a text; v_b text;
BEGIN
  IF NOT (current_user IN ('postgres','service_role')) THEN
    RAISE EXCEPTION 'operator-only';
  END IF;

  ---------------------------------------------------------------------------
  -- 1. THE MOVE PATH: one CASE chose 'waiting' + agreed for a seat change.
  ---------------------------------------------------------------------------
  SELECT pg_get_functiondef(p.oid), md5(p.prosrc) INTO v_src, v_md5
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='fn_cash_seat_move_execute_before_maintenance_gate';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'fn_cash_seat_move_execute_before_maintenance_gate not found';
  END IF;

  IF position('A MOVED PLAYER NEVER POSTS TO ENTER' in v_src) > 0 THEN
    RAISE NOTICE 'move path already applied; skipping';
  ELSIF v_md5 <> '9c87bb74b8589bf47f6ecb32d573fa4e' THEN
    RAISE EXCEPTION 'Unreviewed fn_cash_seat_move_execute_before_maintenance_gate baseline %', v_md5;
  ELSE
    v_a := '  v_hold := CASE WHEN m.reason = ''seat_change'' THEN ''waiting'' ELSE ''moved'' END;' || E'\n' ||
           '  v_agreed := (m.reason = ''seat_change'');';
    v_n := (length(v_src)-length(replace(v_src,v_a,'')))/length(v_a);
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'the move entry choice appears % times, expected exactly 1', v_n;
    END IF;
    v_b := '  /* A MOVED PLAYER NEVER POSTS TO ENTER (Dan 2026-11-15). Every reason -' || E'\n' ||
           '     must_move, break, balance and seat_change - comes from a previous table' || E'\n' ||
           '     in this game, so it arrives owing nothing and posts only when the big' || E'\n' ||
           '     blind reaches its chair (or after a sit-out that missed the blinds). */' || E'\n' ||
           '  v_hold := ''moved'';' || E'\n' ||
           '  v_agreed := false;';
    v_new := replace(v_src, v_a, v_b);
    IF v_new = v_src THEN RAISE EXCEPTION 'move substitution produced no change'; END IF;
    EXECUTE v_new;
  END IF;

  ---------------------------------------------------------------------------
  -- 2. THE SWAP PATH: both chairs were seated 'waiting' + agreed.
  ---------------------------------------------------------------------------
  SELECT pg_get_functiondef(p.oid), md5(p.prosrc) INTO v_src, v_md5
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='fn_cash_seat_swap_execute_before_maintenance_gate';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'fn_cash_seat_swap_execute_before_maintenance_gate not found';
  END IF;

  IF position('A MOVED PLAYER NEVER POSTS TO ENTER' in v_src) > 0 THEN
    RAISE NOTICE 'swap path already applied; skipping';
  ELSIF v_md5 <> '85caa2ab67fd4ad8631b3f16c4fb6310' THEN
    RAISE EXCEPTION 'Unreviewed fn_cash_seat_swap_execute_before_maintenance_gate baseline %', v_md5;
  ELSE
    v_a := 'entry_hold = ''waiting'', entry_post_agreed = true, left_at = NULL';
    v_n := (length(v_src)-length(replace(v_src,v_a,'')))/length(v_a);
    IF v_n <> 2 THEN
      RAISE EXCEPTION 'the swap entry appears % times, expected exactly 2 (one per chair)', v_n;
    END IF;
    v_new := replace(v_src, v_a,
      'entry_hold = ''moved'', entry_post_agreed = false, left_at = NULL');
    -- The marker rides in the function header so a re-run can see it.
    v_new := replace(v_new, E'\nAS $function$\n',
      E'\nAS $function$\n/* A MOVED PLAYER NEVER POSTS TO ENTER (Dan 2026-11-15): both swapped chairs arrive ''moved'', owing nothing. */\n');
    IF v_new = v_src THEN RAISE EXCEPTION 'swap substitution produced no change'; END IF;
    EXECUTE v_new;
  END IF;

  ---------------------------------------------------------------------------
  -- POST-CONDITION: no executor seats an arrival as an entrant who must post.
  ---------------------------------------------------------------------------
  SELECT pg_get_functiondef(p.oid) INTO v_check
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='fn_cash_seat_move_execute_before_maintenance_gate';
  IF position('v_hold := ''moved'';' in v_check) = 0
     OR position('v_agreed := false;' in v_check) = 0
     OR position('v_hold := CASE' in v_check) > 0
     OR position('v_agreed := (m.reason' in v_check) > 0 THEN
    RAISE EXCEPTION 'post-condition failed: the move path can still seat a waiting entrant. Nothing written.';
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_check
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='fn_cash_seat_swap_execute_before_maintenance_gate';
  IF (length(v_check)-length(replace(v_check,'entry_hold = ''moved'', entry_post_agreed = false','')))
       / length('entry_hold = ''moved'', entry_post_agreed = false') <> 2
     OR position('entry_hold = ''waiting''' in v_check) > 0 THEN
    RAISE EXCEPTION 'post-condition failed: a swapped chair can still arrive owing a post. Nothing written.';
  END IF;

  RAISE NOTICE 'every seat move, seat changes and swaps included, now arrives owing nothing';
END $mig$;

COMMIT;
