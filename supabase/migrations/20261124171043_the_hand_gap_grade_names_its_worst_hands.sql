-- 20261124171043_the_hand_gap_grade_names_its_worst_hands.sql
--
-- Version reserved by scripts/reserve-migration-version.sh against this tree,
-- origin/main and every sibling worktree, so it cannot collide with another
-- agent's in-flight work.
--
-- @live-proof: (SELECT 'unintended_max_ms' = ANY (p.proargnames) AND 'worst_hands' = ANY (p.proargnames) AND 'neither_unintended_p95_ms' = ANY (p.proargnames) AND position('AS unintended_max_ms' in pg_get_functiondef(p.oid)) > 0 AND position('all_in_showdown' in pg_get_functiondef(p.oid)) > 0 AND position('count(DISTINCT' in pg_get_functiondef(p.oid)) > 0 FROM pg_proc p WHERE p.oid = 'public.fn_ca_hand_gap_unintended_delay(timestamp with time zone,integer)'::regprocedure)
--
-- THE HAND-GAP GRADE NAMES ITS SLOWEST HAND (2026-11-24, Cutover reliability
-- programme item 1b; Lane: release-custody).
--
-- WHAT BROKE. Backup certification refused 19203b9a1f0b at 12:47Z on
-- "kind=cash shape=showdown_checked_river hands=14 p50 1 ms p95 573 ms
-- p99 1422 ms budget 250 ms over_budget=1": over 14 hands a p95 is decided by
-- the slowest one or two hands, so ONE slow hand failed a whole three-hour
-- cycle. server/standby/standby-engine.sh check_soak_hand_gap_delay now judges
-- the sample instead (a minimum cell size, an exact binomial test of the
-- over-budget count, and a hard ceiling for any single multi-second stall),
-- and its verdict must name the hands that fired it. The grader returned only
-- percentiles and counts: no maximum and no hand ids, so a hard ceiling could
-- only be judged on p99 and the verdict could not be traced.
--
-- WHAT THIS CHANGES. An anchored edit of
-- public.fn_ca_hand_gap_unintended_delay(timestamptz, int) that adds two
-- columns at the END of its result and changes nothing else it computes:
--   unintended_max_ms  the cell's largest graded (gap - owed), rounded ms;
--   worst_hands        jsonb array of the cell's five slowest graded pairs,
--                      slowest first: {hand_id, table_id, unintended_ms},
--                      hand_id being the hand whose following gap it is.
-- Every grading expression, filter, constant and existing column is kept
-- byte-for-byte (later anchored edits of the grader still find their text);
-- the shaped CTE only also carries s.id and s.table_id. A new result row type
-- cannot be installed by CREATE OR REPLACE, so the function is dropped and
-- re-created from its own live definition inside this one transaction, its
-- comment and grants restored. No view or rule depends on it (plain DROP, no
-- CASCADE: a dependency makes this fail loudly). The one caller in the
-- database, fn_ca_hand_gap_watch, names its columns explicitly and is
-- unchanged; Backup's judge reads the two columns only when the grader on its
-- copy has them. Idempotent: a grader that already has worst_hands is left
-- alone. No table, row, seat, wallet or alert is written.
--
-- Proof: scripts/ci/test-hand-gap-watch.py (PostgreSQL, after 20261122095254)
-- and tests/backup-cert-checks-lifecycle-logs.law.test.ts.

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $grade$
DECLARE
  c_sig constant text := 'public.fn_ca_hand_gap_unintended_delay(timestamp with time zone,integer)';
  v_oid oid := to_regprocedure(c_sig);
  v_def text;
  v_comment text;
  c_returns_old constant text := 'neither_unintended_p95_ms integer)';
  c_returns_new constant text := 'neither_unintended_p95_ms integer, unintended_max_ms integer, worst_hands jsonb)';
  c_shaped_old constant text := '  SELECT s.tournament_id IS NOT NULL AS tournament, s.gap_ms,';
  c_shaped_new constant text := '  SELECT s.id AS hand_id, s.table_id AS hand_table_id, s.tournament_id IS NOT NULL AS tournament, s.gap_ms,';
  c_tail_old constant text :=
    'FILTER (WHERE row_graded AND NOT someone_busted AND NOT seat_moved))::int AS neither_unintended_p95_ms' || chr(10) ||
    '  FROM shaped';
  c_tail_new constant text :=
    'FILTER (WHERE row_graded AND NOT someone_busted AND NOT seat_moved))::int AS neither_unintended_p95_ms,' || chr(10) ||
    '       round(max(gap_ms - owed_ms) FILTER (WHERE row_graded))::int AS unintended_max_ms,' || chr(10) ||
    '       to_jsonb((array_agg(jsonb_build_object(''hand_id'', hand_id, ''table_id'', hand_table_id,' || chr(10) ||
    '                                              ''unintended_ms'', round(gap_ms - owed_ms)::int)' || chr(10) ||
    '                           ORDER BY gap_ms - owed_ms DESC, hand_id) FILTER (WHERE row_graded))[1:5]) AS worst_hands' || chr(10) ||
    '  FROM shaped';
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'fn_ca_hand_gap_unintended_delay is not installed';
  END IF;
  IF (SELECT 'worst_hands' = ANY (proargnames) FROM pg_proc WHERE oid = v_oid) THEN
    RETURN;
  END IF;
  v_def := pg_get_functiondef(v_oid);
  v_comment := obj_description(v_oid, 'pg_proc');
  IF (length(v_def) - length(replace(v_def, c_returns_old, ''))) / length(c_returns_old) <> 1 THEN
    RAISE EXCEPTION 'fn_ca_hand_gap_unintended_delay RETURNS anchor did not match once';
  END IF;
  IF (length(v_def) - length(replace(v_def, c_shaped_old, ''))) / length(c_shaped_old) <> 1 THEN
    RAISE EXCEPTION 'fn_ca_hand_gap_unintended_delay shaped anchor did not match once';
  END IF;
  IF (length(v_def) - length(replace(v_def, c_tail_old, ''))) / length(c_tail_old) <> 1 THEN
    RAISE EXCEPTION 'fn_ca_hand_gap_unintended_delay result anchor did not match once';
  END IF;
  v_def := replace(replace(replace(v_def, c_returns_old, c_returns_new), c_shaped_old, c_shaped_new), c_tail_old, c_tail_new);
  EXECUTE 'DROP FUNCTION ' || c_sig;
  EXECUTE v_def;
  IF v_comment IS NOT NULL THEN
    EXECUTE format('COMMENT ON FUNCTION %s IS %L', c_sig, v_comment);
  END IF;
END $grade$;

REVOKE ALL ON FUNCTION public.fn_ca_hand_gap_unintended_delay(timestamptz, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_hand_gap_unintended_delay(timestamptz, int) TO service_role;

COMMIT;
