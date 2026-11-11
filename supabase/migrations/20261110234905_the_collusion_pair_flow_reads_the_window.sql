-- 20261110234905_the_collusion_pair_flow_reads_the_window.sql
--
-- Version reserved by scripts/reserve-migration-version.sh against this tree,
-- origin/main and every sibling worktree on this machine.
--
-- ============================================================================
-- THE COLLUSION PAIR FLOW READS THE WINDOW, NOT EVERY PROFILE
-- (Reliability incident 61fc0986-d4dd-4b54-9c58-14b2605aecc0,
--  drift_incident:fn_ca_cron_failure_watch, jobname=ca-collusion-daily)
-- ============================================================================
--
-- SUPERSEDES 20261110224528, which is the same change and REFUSED on its own
-- postimage assertion with nothing committed: that file asserted the phrase
-- "cross join lateral" was gone from the patched function, while its own
-- replacement COMMENT contained that phrase, so the assertion could never
-- pass. Production was left untouched by it, confirmed read-only: the
-- function still hashes to its pre-patch md5 and still contains the lateral.
-- This file carries the identical SQL change with the comment reworded so it
-- does not contain the phrase, and with the marker on ONE line so the
-- postimage can find it.
--
-- WHAT WENT WRONG. cron job 202 (ca-collusion-daily, "20 4 * * *",
-- SELECT public.fn_ca_collusion_scan(7)) FAILED every day since 2026-11-07
-- with "canceling statement due to statement timeout" at
-- "fn_ca_collusion_scan(integer) line 6", against the function's own 120s.
-- Read from cron.job_run_details 2026-11-10: Oct 30 81s, Oct 31 103s,
-- Nov 1 85s, Nov 2 79s, Nov 3 68s, Nov 4 58s, Nov 5 56s, Nov 6 62s, then
-- Nov 7, 8, 9 and 10 all cancelled at 120s. fn_ca_cron_failure_watch saw it
-- and paged critical, correctly.
--
-- The driving CTE walked EVERY profile and ran one lateral aggregate per
-- profile against ca_hand_transfers keyed by winner_id. Measured on
-- production 2026-11-10: 5,015 profiles, 5,198,530 transfer rows in the 7-day
-- window, but only 1,056 distinct winners in it, so about 3,959 of those
-- per-profile lookups return nothing. Worse, the shape is pinned to
-- idx_ca_hand_transfers_winner, so it cannot use
-- ca_hand_transfers_played_at_idx, the index added hours earlier the same day
-- by 20261110162314 for this very scan. The index was right; the query shape
-- prevented the benefit.
--
-- THE FIX. Read the window once and group by the pair. The profile
-- restriction the old driver supplied through its join to profiles is kept as
-- an EXISTS semi-join, so the result set is unchanged.
--
-- EQUIVALENCE, PROVED ON A FIXED DATASET (read-only on production,
-- 2026-11-10, both shapes over played_at > '2026-11-09 22:00:00+00'):
--   directed rows                     85,357  ==  85,357
--   directed EXCEPT ALL, both ways          0  and  0
--     (both directions, so duplicate multiplicity matches, not just
--      distinct rows)
--   sum(cnt)                         415,007  == 415,007
--   sum(gross)                705,462,952.76  == 705,462,952.76
--   qualified pairs, all three thresholds applied
--     (hands_together >= 20, abs(net) >= 5000, direction_ratio > 0.8)
--                                         68  ==  68
--   qualified EXCEPT ALL, both ways          0  and  0
-- A tractable window was used for equivalence because the OLD shape cannot
-- finish the 7-day window at all; that is the defect.
--
-- PERFORMANCE on the real 7-day window (EXPLAIN ANALYZE, read-only, no DDL):
--   new shape 9.03 s, taking ca_hand_transfers_played_at_idx: 5,198,530 rows
--   -> 444,259 directed pairs -> 246,025 pairs -> 3,157 qualifying.
--   Old shape: cancelled at 120 s.
--
-- WHAT THIS DOES NOT CHANGE. Thresholds, columns, insert target and the
-- reporting contract are untouched. ca_detector_registry holds
-- source='fn_ca_collusion_scan' at status='retired', so v_retired is true and
-- the incident-raising loop stays skipped: this resumes the
-- ca_collusion_signals inserts missing since Nov 7 and raises no drift
-- incident. The retired detector stays retired. No chips move, no money row
-- is read or written, and no cron, watcher or repair loop is added.
--
-- @live-proof: position('READ THE WINDOW NOT EVERY PROFILE (20261110234905)' in pg_get_functiondef('public.fn_ca_collusion_scan(integer)'::regprocedure)) > 0 AND position('CROSS JOIN LATERAL' in pg_get_functiondef('public.fn_ca_collusion_scan(integer)'::regprocedure)) = 0 AND EXISTS (SELECT 1 FROM public.ca_detector_registry WHERE source = 'fn_ca_collusion_scan' AND status = 'retired') AND EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'ca_hand_transfers_played_at_idx')

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
'  -- READ THE WINDOW NOT EVERY PROFILE (20261110234905). The old driver ran one
  -- lateral aggregate for each of 5,015 profiles while only 1,056 of them had
  -- a transfer in the window, and its shape was pinned to
  -- idx_ca_hand_transfers_winner, so it could not use
  -- ca_hand_transfers_played_at_idx (added the same day by 20261110162314).
  -- It was cancelled at this function''s own 120s timeout every day from
  -- 2026-11-07. Grouping the window once returns the same pairs - proved equal
  -- on a fixed dataset, both EXCEPT ALL directions, counts, sums and all three
  -- thresholds - in 9.0s measured. The EXISTS keeps the profile restriction
  -- the old driver''s join to profiles used to provide.
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
DECLARE d text := pg_get_functiondef('public.fn_ca_collusion_scan(integer)'::regprocedure);
BEGIN
  IF position('READ THE WINDOW NOT EVERY PROFILE (20261110234905)' in d) = 0 THEN
    RAISE EXCEPTION 'COLLUSION_SCAN_POSTIMAGE: the marker is not in the installed function';
  END IF;
  IF position('CROSS JOIN LATERAL' in d) <> 0 THEN
    RAISE EXCEPTION 'COLLUSION_SCAN_POSTIMAGE: the per-profile driver is still present';
  END IF;
END
$post$;

COMMIT;
