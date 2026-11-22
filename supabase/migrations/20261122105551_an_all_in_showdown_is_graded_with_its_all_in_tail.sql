-- 20261122105551_an_all_in_showdown_is_graded_with_its_all_in_tail.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- AN ALL-IN SHOWDOWN IS GRADED WITH ITS ALL-IN TAIL, HOWEVER THE CHIPS WENT IN
-- (EngineCutoverMissed 2026-11-22, operational_alert_events 447376; incident
-- 076ff467).
--
-- WHAT HAPPENED. The 04:00 America/Chicago cutover on 2026-11-22 sent nothing:
-- the 03:30 selection (stage-engine-release run 45000042559) kept serving
-- c2d6e45e because the one shippable build, freeze baseline 0a3a6a52, was
-- refused by the Backup (backup-engine run 44994520089, certify 06:44-07:36Z):
--   hand_gap_unintended_delay_exceeded: kind=cash shape=cash_bust hands=12
--   unintended_p50_ms=1 unintended_p95_ms=499 unintended_p99_ms=501 over_budget=2
-- Ten of twelve hands graded within 1 ms of owed; two graded exactly +500 ms.
--
-- WHY. 500 ms is ALL_IN_SHOWDOWN_EXTRA_MS (2000) minus WINNING_CARDS_EXTRA_MS
-- (1500). The engine adds the all-in tail when ANY shown player is all-in
-- (server/src/engine/presentation/handEventFrames.ts isAllInShowdown reads
-- player.is_all_in). HandController sets is_all_in on a call, bet, raise,
-- blind or ante that empties the stack, recording that action under its own
-- name. This grader counted an all-in showdown only when a shown player has an
-- action literally named 'all_in', so every all-in made any other way was
-- graded 500 ms short of what it owed, and the 500 ms reads as an engine
-- delay that never happened.
--
-- MEASURED ON PRODUCTION (read-only, 2026-11-22 ~10:50 UTC):
--   * 12 h: 369 cash and 6,294 tournament showdowns with a shown player left
--     at stack 0; 1 cash and 37 tournament had no 'all_in' action.
--   * 8 h, 10,118 showdowns whose next hand recorded cadence.hold_ms (the
--     engine's own completion hold): 72 graded exactly 500 ms under the
--     engine's hold. "A shown player ended at stack 0" detects 22 of them and
--     every one of the 22 matches the engine's hold exactly (0 false). The
--     other 50 are all-in WINNERS (e.g. a1365a00: all-in recorded as 'raise',
--     winner's stack non-zero) that no hand_history field identifies, so the
--     engine now records the fact itself (cadence.all_in_showdown, same PR)
--     and this grader prefers it when present.
--   * Example 05f7550e: the busted player went all-in posting the blind and
--     ante; engine hold 4750 (1400 read + 2000 all-in + 1100 push + 250 muck),
--     grader assumed 4250, so a +159 ms gap graded +659 ms.
--
-- WHAT THIS CHANGES (one transaction, no lock on any hot table: function
-- bodies only):
--   1. public.fn_ca_hand_gap_unintended_delay (the production watch AND the
--      Backup certificate's soak check, server/standby/standby-engine.sh):
--      anchored edit of production's own text. all_in_shown is
--        the engine's recorded cadence.all_in_showdown when the next hand
--        carries it as a boolean, otherwise
--        an 'all_in' action by a shown player OR a shown player at stack 0.
--      Every other shape, beat, exclusion and budget is unchanged.
--   2. smarter_private.reliability_runbook_hand_gap_classification: the same
--      derived rule (its pairing reads no cadence).
-- No threshold, budget or timeout moves. A real delay still grades as one.
--
-- Pinned by tests/an-all-in-showdown-is-graded-with-its-all-in-tail.law.test.ts;
-- proved on PostgreSQL 16 by scripts/ci/test-hand-gap-watch.py.
--
-- @live-proof: (SELECT strpos(pg_get_functiondef('public.fn_ca_hand_gap_unintended_delay(timestamp with time zone,integer)'::regprocedure), 'pair.next_cadence->''all_in_showdown''') > 0 AND strpos(pg_get_functiondef('public.fn_ca_hand_gap_unintended_delay(timestamp with time zone,integer)'::regprocedure), 'jsonb_array_elements(pair.players) ap') > 0 AND strpos(pg_get_functiondef('smarter_private.reliability_runbook_hand_gap_classification(uuid,boolean,jsonb,timestamptz)'::regprocedure), 'jsonb_array_elements(pair.players) ap') > 0 AND NOT has_function_privilege('anon', 'public.fn_ca_hand_gap_unintended_delay(timestamp with time zone,integer)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.fn_ca_hand_gap_unintended_delay(timestamp with time zone,integer)', 'EXECUTE'))

BEGIN;

SET LOCAL lock_timeout = '4s';

-- 1. The grader: prefer the engine's recorded fact, else derive it from the
--    hand (an 'all_in' action or a shown player left at stack 0).
DO $edit$
DECLARE
  v_def text := pg_get_functiondef('public.fn_ca_hand_gap_unintended_delay(timestamp with time zone,integer)'::regprocedure);
  c_old constant text := 'EXISTS (SELECT 1 FROM jsonb_array_elements(pair.actions) a, jsonb_array_elements(pair.shown) sd'
    || chr(10) || '                 WHERE a->>''action'' = ''all_in'' AND a->>''userId'' = sd->>''user_id'') AS all_in_shown,';
  c_new constant text := 'CASE WHEN jsonb_typeof(pair.next_cadence->''all_in_showdown'') = ''boolean'''
    || chr(10) || '              THEN (pair.next_cadence->>''all_in_showdown'')::boolean'
    || chr(10) || '              ELSE EXISTS (SELECT 1 FROM jsonb_array_elements(pair.actions) a, jsonb_array_elements(pair.shown) sd'
    || chr(10) || '                            WHERE a->>''action'' = ''all_in'' AND a->>''userId'' = sd->>''user_id'')'
    || chr(10) || '                OR EXISTS (SELECT 1 FROM jsonb_array_elements(pair.players) ap, jsonb_array_elements(pair.shown) sd'
    || chr(10) || '                            WHERE ap->>''userId'' = sd->>''user_id'' AND coalesce((ap->>''stack'')::numeric, 1) = 0)'
    || chr(10) || '         END AS all_in_shown,';
BEGIN
  IF (length(v_def) - length(replace(v_def, c_old, ''))) / length(c_old) <> 1 THEN
    RAISE EXCEPTION 'fn_ca_hand_gap_unintended_delay all_in_shown anchor did not match exactly once';
  END IF;
  EXECUTE replace(v_def, c_old, c_new);
END
$edit$;

REVOKE ALL ON FUNCTION public.fn_ca_hand_gap_unintended_delay(timestamptz, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_hand_gap_unintended_delay(timestamptz, int) TO service_role;

-- 2. The runbook's copy of the grader: the same derived rule.
DO $edit$
DECLARE
  v_def text := pg_get_functiondef('smarter_private.reliability_runbook_hand_gap_classification(uuid,boolean,jsonb,timestamptz)'::regprocedure);
  c_old constant text := 'EXISTS (SELECT 1 FROM jsonb_array_elements(pair.actions) x, jsonb_array_elements(pair.shown) sd'
    || chr(10) || '                        WHERE x->>''action'' = ''all_in'' AND x->>''userId'' = sd->>''user_id'') AS all_in_shown,';
  c_new constant text := '(EXISTS (SELECT 1 FROM jsonb_array_elements(pair.actions) x, jsonb_array_elements(pair.shown) sd'
    || chr(10) || '                        WHERE x->>''action'' = ''all_in'' AND x->>''userId'' = sd->>''user_id'')'
    || chr(10) || '                OR EXISTS (SELECT 1 FROM jsonb_array_elements(pair.players) ap, jsonb_array_elements(pair.shown) sd'
    || chr(10) || '                        WHERE ap->>''userId'' = sd->>''user_id'' AND coalesce((ap->>''stack'')::numeric, 1) = 0)) AS all_in_shown,';
BEGIN
  IF (length(v_def) - length(replace(v_def, c_old, ''))) / length(c_old) <> 1 THEN
    RAISE EXCEPTION 'reliability_runbook_hand_gap_classification all_in_shown anchor did not match exactly once';
  END IF;
  EXECUTE replace(v_def, c_old, c_new);
END
$edit$;

REVOKE ALL ON FUNCTION smarter_private.reliability_runbook_hand_gap_classification(uuid, boolean, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;

-- @probe-for: public.fn_ca_hand_gap_unintended_delay
-- @probe-for: smarter_private.reliability_runbook_hand_gap_classification
DO $probe$
DECLARE v_n int; v_res jsonb;
BEGIN
  SELECT count(*) INTO v_n FROM public.fn_ca_hand_gap_unintended_delay(now(), 5);
  v_res := smarter_private.reliability_runbook_hand_gap_classification(
    '00000000-0000-0000-0000-000000000000'::uuid, true, '{"max_alerts_per_attempt": 0}'::jsonb, clock_timestamp());
  IF v_res->>'outcome' IS NULL THEN
    RAISE EXCEPTION 'hand_gap_classification probe returned null outcome';
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
