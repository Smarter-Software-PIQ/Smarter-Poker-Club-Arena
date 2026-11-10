-- 20261110224528_the_collusion_pair_flow_is_read_from_the_window.sql
--
-- Version reserved by scripts/reserve-migration-version.sh against this tree,
-- origin/main and every sibling worktree on this machine.
--
-- ============================================================================
-- THE COLLUSION PAIR FLOW IS READ FROM THE WINDOW, NOT FROM EVERY PROFILE
-- (Reliability incident 61fc0986-d4dd-4b54-9c58-14b2605aecc0,
--  drift_incident:fn_ca_cron_failure_watch, jobname=ca-collusion-daily)
-- ============================================================================
--
-- WHAT WENT WRONG. cron job 202 (ca-collusion-daily, "20 4 * * *",
-- SELECT public.fn_ca_collusion_scan(7)) has FAILED every day since
-- 2026-11-07 with
--   ERROR:  canceling statement due to statement timeout
--   CONTEXT:  PL/pgSQL function fn_ca_collusion_scan(integer) line 6 at FOR over SELECT rows
-- against the function's own SET statement_timeout TO '120s'. Read from
-- cron.job_run_details 2026-11-10: Oct 30 81s, Oct 31 103s, Nov 1 85s,
-- Nov 2 79s, Nov 3 68s, Nov 4 58s, Nov 5 56s, Nov 6 62s, then Nov 7, 8, 9
-- and 10 all cancelled at 120s. fn_ca_cron_failure_watch saw the failure and
-- paged critical, correctly.
--
-- The driving CTE walked EVERY profile and ran one lateral aggregate per
-- profile against ca_hand_transfers keyed by winner_id. Measured on production
-- 2026-11-10: 5,015 profiles, 5,198,530 transfer rows in the 7-day window, but
-- only 1,056 distinct winners in it - so roughly 3,959 lateral index scans
-- return nothing, and the shape is pinned to idx_ca_hand_transfers_winner. It
-- therefore cannot use ca_hand_transfers_played_at_idx, the index added hours
-- earlier the same day by 20261110162314 for this very scan: the index was
-- right, the query shape prevented the benefit.
--
-- THE FIX. Read the window once and group by the pair. The profile
-- restriction the lateral's join to profiles used to supply is kept as an
-- EXISTS semi-join, so the result set is unchanged.
--
-- EQUIVALENCE, PROVED ON A FIXED DATASET (read-only on production,
-- 2026-11-10, both shapes over played_at > '2026-11-09 22:00:00+00'):
--   directed rows            85,357  ==  85,357
--   directed EXCEPT ALL both ways         0  and  0   (so duplicate
--                                                      multiplicity matches,
--                                                      not just distinct rows)
--   sum(cnt)                415,007  == 415,007
--   sum(gross)       705,462,952.76  == 705,462,952.76
--   qualified pairs, all three thresholds applied
--     (hands_together >= 20, abs(net) >= 5000, direction_ratio > 0.8)
--                                 68  ==  68
--   qualified EXCEPT ALL both ways         0  and  0
-- A tractable window was used for equivalence because the OLD shape cannot
-- finish the 7-day window at all - that is the defect.
--
-- PERFORMANCE, on the real 7-day window (EXPLAIN ANALYZE, read-only, no DDL):
--   new shape 9.03 s, taking ca_hand_transfers_played_at_idx: 5,198,530 rows
--   -> 444,259 directed pairs -> 246,025 pairs -> 3,157 qualifying.
--   Old shape: cancelled at 120 s.
--
-- WHAT THIS DOES NOT CHANGE. Thresholds, columns, insert target and the
-- reporting contract are untouched. ca_detector_registry holds
-- source='fn_ca_collusion_scan' at status='retired', so v_retired is true and
-- the incident-raising loop stays skipped: this resumes the
-- ca_collusion_signals inserts that have been missing since Nov 7 and raises
-- no drift incident. The retired detector stays retired. No chips move, no
-- money row is read or written, and no cron, watcher or repair loop is added.
--
-- @live-proof: position('READ THE WINDOW, NOT EVERY PROFILE (20261110224528)' in pg_get_functiondef('public.fn_ca_collusion_scan(integer)'::regprocedure)) > 0 AND position('CROSS JOIN LATERAL' in pg_get_functiondef('public.fn_ca_collusion_scan(integer)'::regprocedure)) = 0 AND EXISTS (SELECT 1 FROM public.ca_detector_registry WHERE source = 'fn_ca_collusion_scan' AND status = 'retired') AND EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'ca_hand_transfers_played_at_idx')

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '20s';

DO $pre$
BEGIN
  IF md5(pg_get_functiondef('public.fn_ca_collusion_scan(integer)'::regprocedure)) <> '8a27314f623d55b4885eae1d6ebe2819' THEN
    RAISE EXCEPTION 'COLLUSION_SCAN_PREIMAGE_CHANGED: fn_ca_collusion_scan was edited since this patch was qualified; requalify before installing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'ca_hand_transfers_played_at_idx') THEN
    RAISE EXCEPTION 'COLLUSION_SCAN_INDEX_MISSING: ca_hand_transfers_played_at_idx is not installed; the new shape depends on it';
  END IF;
END
$pre$;

DO $by_window$
DECLARE
  s text;
  n text;
  k integer;
  c_sig constant text := 'public.fn_ca_collusion_scan(integer)';
  c_old constant text :=
'  WITH directed AS MATERIALIZED (
    SELECT p.id AS winner_id,
           ht.loser_id,
           ht.cnt,
           ht.gross
      FROM public.profiles p
      CROSS JOIN LATERAL (
        SELECT t.loser_id,
               count(*)      AS cnt,
               sum(t.amount) AS gross
          FROM public.ca_hand_transfers t
         WHERE t.winner_id = p.id
           AND t.played_at > v_since
           AND t.loser_id IS NOT NULL
           AND t.amount > 0
         GROUP BY t.loser_id
      ) ht
  ),';
  c_new constant text :=
'  -- READ THE WINDOW, NOT EVERY PROFILE (20261110224528). The per-profile
  -- CROSS JOIN LATERAL ran one index scan for each of 5,015 profiles while
  -- only 1,056 of them had a transfer in the window, and its shape could not
  -- use ca_hand_transfers_played_at_idx because it was driven by winner_id.
  -- It was cancelled at this function''s own 120s timeout every day from
  -- 2026-11-07. Grouping the window once returns the same pairs - proved
  -- equal on a fixed dataset, EXCEPT ALL both ways, counts, sums and all
  -- three thresholds - in 9.0s measured. The EXISTS keeps the profile
  -- restriction the lateral''s join to profiles used to provide.
  WITH directed AS MATERIALIZED (
    SELECT t.winner_id,
           t.loser_id,
           count(*)      AS cnt,
           sum(t.amount) AS gross
      FROM public.ca_hand_transfers t
     WHERE t.played_at > v_since
       AND t.loser_id IS NOT NULL
       AND t.amount > 0
       AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = t.winner_id)
     GROUP BY t.winner_id, t.loser_id
  ),';
BEGIN
  s := pg_get_functiondef(c_sig::regprocedure);
  k := (length(s) - length(replace(s, c_old, ''))) / length(c_old);
  IF k IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'COLLUSION_SCAN_ANCHOR: directed CTE found % times in %; requalify before installing', k, c_sig;
  END IF;
  n := replace(s, c_old, c_new);
  IF n = s THEN
    RAISE EXCEPTION 'COLLUSION_SCAN_ANCHOR: directed CTE patch did not change %', c_sig;
  END IF;
  EXECUTE n;
END
$by_window$;

DO $post$
BEGIN
  IF position('READ THE WINDOW, NOT EVERY PROFILE (20261110224528)' in
              pg_get_functiondef('public.fn_ca_collusion_scan(integer)'::regprocedure)) = 0
     OR position('CROSS JOIN LATERAL' in
              pg_get_functiondef('public.fn_ca_collusion_scan(integer)'::regprocedure)) <> 0 THEN
    RAISE EXCEPTION 'COLLUSION_SCAN_POSTIMAGE: the installed function is not the patched one';
  END IF;
END
$post$;

COMMIT;
