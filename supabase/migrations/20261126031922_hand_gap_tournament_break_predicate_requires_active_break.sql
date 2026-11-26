-- 20261126031922_hand_gap_tournament_break_predicate_requires_active_break.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- TOURNAMENT BREAK PREDICATE REQUIRES AN ACTIVE OR GAP-OVERLAPPING BREAK
-- (2026-11-26, incident 1e532243).
--
-- WHAT BROKE (proved live on production 2026-11-26 02:20-02:35 UTC):
--   TournamentManagerBase.resumeFromBreak() resumes a tournament by writing
--   { on_break: false, break_ends_at: null } while retaining the historical
--   break_started_at timestamp. Three read/grading functions checked:
--     t.break_started_at < next_start AND COALESCE(t.break_ends_at, 'infinity') > ended_at
--   Because break_ends_at becomes NULL on resume while break_started_at stays
--   non-null, COALESCE(NULL, 'infinity') > ended_at evaluated TRUE FOREVER
--   after a tournament's first break:
--     1. public.fn_ca_hand_gap_unintended_delay silently dropped every hand
--        played after a tournament's first break (e.g. tournament 27421337 had
--        277 slow tournament/fold and 15 slow showroom_checked_river hands at
--        02:20-02:35 UTC, 20-34 minutes after resuming at 02:01:02 UTC, all
--        silently excluded from grading).
--     2. smarter_private.reliability_runbook_hand_gap_classification
--        misclassified those post-break slow hands as 'tournament_break'
--        (an intended wait), risking false auto-resolution of real critical
--        hand-gap alerts whenever only post-break tournaments breached.
--     3. public.fn_ca_felt_latency excluded every post-break tournament hand
--        as excluded = 'break', blinding hourly player-felt latency metrics.
--
-- WHAT THIS CHANGES:
--   Idempotent anchored edits on all three functions replacing the open-ended
--   COALESCE(t.break_ends_at, 'infinity') check with a three-case predicate:
--     1. Active or historical countdown break (break_ends_at IS NOT NULL):
--        break_started_at < next_start AND break_ends_at > ended_at.
--     2. Active pre-countdown break waiting for tables to finish their hand:
--        on_break IS TRUE AND break_ends_at IS NULL AND break_started_at < next_start.
--     3. Short (<60s) break that already resumed before grading ran:
--        break_ends_at IS NULL AND break_started_at >= ended_at - interval '5 seconds'
--        AND break_started_at < next_start.
--   Any resumed tournament with on_break = false, break_ends_at IS NULL, and
--   an older break_started_at is now graded accurately and never misclassified
--   as tournament_break / break. No tables are locked or mutated.
--
-- @live-proof: (SELECT position('t.on_break IS TRUE' in pg_get_functiondef('public.fn_ca_hand_gap_unintended_delay(timestamp with time zone,integer)'::regprocedure)) > 0 AND position('coalesce(t.break_ends_at' in lower(pg_get_functiondef('public.fn_ca_hand_gap_unintended_delay(timestamp with time zone,integer)'::regprocedure))) = 0 AND position('t.on_break IS TRUE' in pg_get_functiondef('smarter_private.reliability_runbook_hand_gap_classification(uuid,boolean,jsonb,timestamp with time zone)'::regprocedure)) > 0 AND position('coalesce(t.break_ends_at' in lower(pg_get_functiondef('smarter_private.reliability_runbook_hand_gap_classification(uuid,boolean,jsonb,timestamp with time zone)'::regprocedure))) = 0 AND position('t.on_break IS TRUE' in pg_get_functiondef('public.fn_ca_felt_latency(timestamp with time zone,timestamp with time zone)'::regprocedure)) > 0 AND position('coalesce(t.break_ends_at' in lower(pg_get_functiondef('public.fn_ca_felt_latency(timestamp with time zone,timestamp with time zone)'::regprocedure))) = 0)

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $grade$
DECLARE
  c_sig constant text := 'public.fn_ca_hand_gap_unintended_delay(timestamp with time zone,integer)';
  v_oid oid := to_regprocedure(c_sig);
  v_def text;
  c_old constant text :=
    '     AND NOT EXISTS (SELECT 1 FROM tournaments t' || chr(10) ||
    '                      WHERE t.id = p.tournament_id AND t.break_started_at < nx.started_at' || chr(10) ||
    '                        AND COALESCE(t.break_ends_at, ''infinity'') > p.ended_at)';
  c_new constant text :=
    '     AND NOT EXISTS (SELECT 1 FROM tournaments t' || chr(10) ||
    '                      WHERE t.id = p.tournament_id' || chr(10) ||
    '                        AND (' || chr(10) ||
    '                          (t.break_ends_at IS NOT NULL AND t.break_started_at < nx.started_at AND t.break_ends_at > p.ended_at)' || chr(10) ||
    '                          OR (t.on_break IS TRUE AND t.break_ends_at IS NULL AND t.break_started_at < nx.started_at)' || chr(10) ||
    '                          OR (t.break_ends_at IS NULL AND t.break_started_at >= p.ended_at - interval ''5 seconds'' AND t.break_started_at < nx.started_at)' || chr(10) ||
    '                        ))';
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'fn_ca_hand_gap_unintended_delay is not installed';
  END IF;
  v_def := pg_get_functiondef(v_oid);
  IF position('t.on_break IS TRUE' IN v_def) > 0
     AND position('coalesce(t.break_ends_at' IN lower(v_def)) = 0 THEN
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, c_old, ''))) / length(c_old) <> 1 THEN
    RAISE EXCEPTION 'fn_ca_hand_gap_unintended_delay tournament break anchor did not match once';
  END IF;
  EXECUTE replace(v_def, c_old, c_new);
END $grade$;

DO $runbook$
DECLARE
  c_sig constant text := 'smarter_private.reliability_runbook_hand_gap_classification(uuid,boolean,jsonb,timestamp with time zone)';
  v_oid oid := to_regprocedure(c_sig);
  v_def text;
  c_old constant text :=
    '                   SELECT 1 FROM tournaments t WHERE t.id = sh.tournament_id AND t.break_started_at < sh.next_start' || chr(10) ||
    '                      AND coalesce(t.break_ends_at, ''infinity'') > sh.ended_at) THEN ''tournament_break''';
  c_new constant text :=
    '                   SELECT 1 FROM tournaments t' || chr(10) ||
    '                    WHERE t.id = sh.tournament_id' || chr(10) ||
    '                      AND (' || chr(10) ||
    '                        (t.break_ends_at IS NOT NULL AND t.break_started_at < sh.next_start AND t.break_ends_at > sh.ended_at)' || chr(10) ||
    '                        OR (t.on_break IS TRUE AND t.break_ends_at IS NULL AND t.break_started_at < sh.next_start)' || chr(10) ||
    '                        OR (t.break_ends_at IS NULL AND t.break_started_at >= sh.ended_at - interval ''5 seconds'' AND t.break_started_at < sh.next_start)' || chr(10) ||
    '                      )) THEN ''tournament_break''';
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'reliability_runbook_hand_gap_classification is not installed';
  END IF;
  v_def := pg_get_functiondef(v_oid);
  IF position('t.on_break IS TRUE' IN v_def) > 0
     AND position('coalesce(t.break_ends_at' IN lower(v_def)) = 0 THEN
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, c_old, ''))) / length(c_old) <> 1 THEN
    RAISE EXCEPTION 'reliability_runbook_hand_gap_classification tournament break anchor did not match once';
  END IF;
  EXECUTE replace(v_def, c_old, c_new);
END $runbook$;

DO $felt$
DECLARE
  c_sig constant text := 'public.fn_ca_felt_latency(timestamp with time zone,timestamp with time zone)';
  v_oid oid := to_regprocedure(c_sig);
  v_def text;
  c_old constant text :=
    '                             WHERE t.id = s.tournament_id AND t.break_started_at < s.next_start' || chr(10) ||
    '                               AND COALESCE(t.break_ends_at, ''infinity'') > s.ended_at) THEN ''break''';
  c_new constant text :=
    '                             WHERE t.id = s.tournament_id' || chr(10) ||
    '                               AND (' || chr(10) ||
    '                                 (t.break_ends_at IS NOT NULL AND t.break_started_at < s.next_start AND t.break_ends_at > s.ended_at)' || chr(10) ||
    '                                 OR (t.on_break IS TRUE AND t.break_ends_at IS NULL AND t.break_started_at < s.next_start)' || chr(10) ||
    '                                 OR (t.break_ends_at IS NULL AND t.break_started_at >= s.ended_at - interval ''5 seconds'' AND t.break_started_at < s.next_start)' || chr(10) ||
    '                               )) THEN ''break''';
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'fn_ca_felt_latency is not installed';
  END IF;
  v_def := pg_get_functiondef(v_oid);
  IF position('t.on_break IS TRUE' IN v_def) > 0
     AND position('coalesce(t.break_ends_at' IN lower(v_def)) = 0 THEN
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, c_old, ''))) / length(c_old) <> 1 THEN
    RAISE EXCEPTION 'fn_ca_felt_latency tournament break anchor did not match once';
  END IF;
  EXECUTE replace(v_def, c_old, c_new);
END $felt$;

REVOKE ALL ON FUNCTION public.fn_ca_hand_gap_unintended_delay(timestamptz, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_hand_gap_unintended_delay(timestamptz, int) TO service_role;

REVOKE ALL ON FUNCTION smarter_private.reliability_runbook_hand_gap_classification(uuid, boolean, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION smarter_private.reliability_runbook_hand_gap_classification(uuid, boolean, jsonb, timestamptz) TO service_role;

REVOKE ALL ON FUNCTION public.fn_ca_felt_latency(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_felt_latency(timestamptz, timestamptz) TO service_role;

-- @probe-for: public.fn_ca_hand_gap_unintended_delay
DO $probe$
BEGIN
  PERFORM * FROM public.fn_ca_hand_gap_unintended_delay(now(), 1) LIMIT 1;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: smarter_private.reliability_runbook_hand_gap_classification
DO $probe$
BEGIN
  PERFORM smarter_private.reliability_runbook_hand_gap_classification(gen_random_uuid(), true, '{"max_alerts_per_attempt":1}'::jsonb, now());
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_ca_felt_latency
DO $probe$
BEGIN
  PERFORM * FROM public.fn_ca_felt_latency(now() - interval '1 minute', now()) LIMIT 1;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
