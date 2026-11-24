-- 20261124172239_the_cluster_tick_names_the_tables_it_planned_moves_from.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- THE CLUSTER TICK NAMES THE TABLES IT PLANNED MOVES FROM (2026-11-24,
-- incident 1e532243, unintended delay between hands).
--
-- WHAT WAS WRONG (production, read-only, 2026-11-24, builds 74d10c32eb6a,
-- 6c6aaa7707ac and 7f6e30be571d):
--   The must-move tick reports only a COUNT of the moves it planned:
--   `{ "moves_planned": n }`. The engine therefore raises the signal for the
--   whole GAME (server/src/cluster/seatBoundarySignals.ts, noteMovesPlanned),
--   and every cluster table whose rest straddles the plan goes round its
--   dealing loop once more after the full 1,500 ms rest
--   (seatBoundaryChangedUnderRest). In practice that is the DESTINATION Main:
--   a player leaves it, the vacancy wakes the tick at once, and the plan lands
--   inside that Main's own rest. The second pass deals a byte-identical roster
--   (cash_hand_participant_manifests: two captures, same seats, occupancies and
--   stacks, different hand numbers) about 840 ms late. That was 41 of 61 slow
--   cash transitions in 14 h (39 on the destination: 26 Main 1, 13 Main 2).
--   It is the delay that refused Backup certification of 19203b9a1f0b
--   (cash showdown_checked_river, 1 of 14 hands at +1,422 ms).
--
-- THE CHANGE (one anchored edit, nothing else):
--   fn_cash_cluster_tick_uncapped(uuid,integer) keeps every line it has, and
--   adds the source table of each must-move it plans to `v_move_sources`. The
--   `moves_planned` action now carries `source_table_ids` (a JSON array of uuid
--   strings) next to the count. The engine (PR #11926,
--   tickPlannedSourceTableIds) then signals only the tables a player is
--   planned to leave, so a destination Main no longer re-reads a roster that
--   cannot have changed. An engine that does not read the key ignores it.
--
--   The array is taken where the action is emitted: Step 2 (MUST-MOVE). The
--   balance (Step 3) and break (Step 5) plans increment v_moves only AFTER that
--   sole emission, so the tick has never reported them, and no engine signal
--   was ever raised for them. Reporting them now would be a new signal, not a
--   name for an existing one, and today's serving engine would treat it as
--   game-wide, so this migration leaves them exactly as they are.
--   `source_table_ids` is never null: it is emitted only with
--   `moves_planned > 0`, and its length is always equal to `moves_planned`.
--
-- WHAT IS GUARANTEED UNCHANGED (checked below, refused otherwise):
--   * the body: replacing the three new spans with the three anchors gives back
--     the exact pre-image, byte for byte;
--   * the signature, owner, ACL, SECURITY DEFINER, search_path (proconfig) and
--     volatility, compared field by field from pg_proc.
--   Each anchor must occur exactly once, and a body that already names its
--   sources is refused, so a re-run or a drifted pre-image fails closed.
--
-- Proof: scripts/dev/prove-the-cluster-tick-names-its-plan-sources.sh (applies
-- this file to the exact production pre-image and to a native behaviour model).
-- Law: tests/the-cluster-tick-names-the-tables-it-planned-moves-from.law.test.ts
--
-- @live-proof: (SELECT position('v_move_sources := v_move_sources || r.table_id;' in pg_get_functiondef('public.fn_cash_cluster_tick_uncapped(uuid,integer)'::regprocedure)) > 0 AND position('''source_table_ids'', to_jsonb(v_move_sources)' in pg_get_functiondef('public.fn_cash_cluster_tick_uncapped(uuid,integer)'::regprocedure)) > 0)

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $plan_sources$
DECLARE
  v_oid     oid := 'public.fn_cash_cluster_tick_uncapped(uuid,integer)'::regprocedure;
  v_before  text;
  v_after   text;
  v_catalog record;
  v_old_decl text :=
$o1$  v_moves integer := 0;
$o1$;
  v_new_decl text :=
$r1$  v_moves integer := 0;
  v_move_sources uuid[] := '{}'::uuid[];
$r1$;
  v_old_move text :=
$o2$      VALUES (g.id, r.user_id, r.table_id, t.id, 'must_move');
      v_moves := v_moves + 1;
$o2$;
  v_new_move text :=
$r2$      VALUES (g.id, r.user_id, r.table_id, t.id, 'must_move');
      v_moves := v_moves + 1;
      v_move_sources := v_move_sources || r.table_id;
$r2$;
  v_old_emit text :=
$o3$IF v_moves > 0 THEN v_actions := v_actions || jsonb_build_object('moves_planned', v_moves); END IF;$o3$;
  v_new_emit text :=
$r3$IF v_moves > 0 THEN v_actions := v_actions || jsonb_build_object('moves_planned', v_moves, 'source_table_ids', to_jsonb(v_move_sources)); END IF;$r3$;
BEGIN
  SELECT pg_get_functiondef(v_oid) INTO v_before;
  SELECT proowner, proacl, proconfig, prosecdef, provolatile, proargtypes, prorettype, proargdefaults
    INTO v_catalog
    FROM pg_proc
   WHERE oid = v_oid;

  IF position('v_move_sources' IN v_before) > 0 OR position('source_table_ids' IN v_before) > 0 THEN
    RAISE EXCEPTION 'fn_cash_cluster_tick_uncapped already names its plan sources: re-read before editing';
  END IF;
  IF (length(v_before) - length(replace(v_before, v_old_decl, ''))) / length(v_old_decl) <> 1 THEN
    RAISE EXCEPTION 'fn_cash_cluster_tick_uncapped v_moves declaration anchor was expected exactly once';
  END IF;
  IF (length(v_before) - length(replace(v_before, v_old_move, ''))) / length(v_old_move) <> 1 THEN
    RAISE EXCEPTION 'fn_cash_cluster_tick_uncapped must_move increment anchor was expected exactly once';
  END IF;
  IF (length(v_before) - length(replace(v_before, v_old_emit, ''))) / length(v_old_emit) <> 1 THEN
    RAISE EXCEPTION 'fn_cash_cluster_tick_uncapped moves_planned emission anchor was expected exactly once';
  END IF;
  -- The emission must follow the must_move increment (the order the array relies on).
  IF position(v_old_move IN v_before) > position(v_old_emit IN v_before) THEN
    RAISE EXCEPTION 'fn_cash_cluster_tick_uncapped emits moves_planned before its must_move increment';
  END IF;

  v_after := replace(replace(replace(v_before, v_old_decl, v_new_decl), v_old_move, v_new_move), v_old_emit, v_new_emit);
  EXECUTE v_after;

  IF replace(replace(replace(pg_get_functiondef(v_oid), v_new_emit, v_old_emit), v_new_move, v_old_move), v_new_decl, v_old_decl) <> v_before
     OR pg_get_functiondef(v_oid) <> v_after
     OR EXISTS (
       SELECT 1 FROM pg_proc
        WHERE oid = v_oid
          AND (proowner IS DISTINCT FROM v_catalog.proowner
               OR proacl IS DISTINCT FROM v_catalog.proacl
               OR proconfig IS DISTINCT FROM v_catalog.proconfig
               OR prosecdef IS DISTINCT FROM v_catalog.prosecdef
               OR provolatile IS DISTINCT FROM v_catalog.provolatile
               OR proargtypes IS DISTINCT FROM v_catalog.proargtypes
               OR prorettype IS DISTINCT FROM v_catalog.prorettype
               OR proargdefaults IS DISTINCT FROM v_catalog.proargdefaults)
     ) THEN
    RAISE EXCEPTION 'fn_cash_cluster_tick_uncapped plan-source edit changed unrelated source or authority';
  END IF;
END
$plan_sources$;

DO $verify_plan_sources$
DECLARE
  v_def text := pg_get_functiondef('public.fn_cash_cluster_tick_uncapped(uuid,integer)'::regprocedure);
BEGIN
  IF position('v_move_sources := v_move_sources || r.table_id;' IN v_def) = 0
     OR position('''source_table_ids'', to_jsonb(v_move_sources)' IN v_def) = 0 THEN
    RAISE EXCEPTION 'the plan-source report did not install cleanly in fn_cash_cluster_tick_uncapped';
  END IF;
END
$verify_plan_sources$;

-- @probe-for: public.fn_cash_cluster_tick_uncapped
DO $probe_uncapped$
BEGIN
  PERFORM public.fn_cash_cluster_tick_uncapped(gen_random_uuid(), NULL);
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_uncapped$;

COMMIT;
