-- 20261110160345_table_seats_live_partial_indexes_keep_a_real_row_estimate.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY (issue #10361, measured 2026-11-10):
--
-- table_seats holds ~3.14M rows, of which ~772 are live (left_at IS NULL).
-- Six partial indexes cover exactly the live rows (idx_table_seats_status,
-- idx_unique_active_user_per_table, idx_table_seats_live_user,
-- idx_table_seats_user_live, idx_table_seats_club_active,
-- idx_table_seats_unstamped_active). ANALYZE sets a partial index's
-- reltuples from the fraction of its sample that satisfies the predicate.
-- At the default statistics target the sample is 30,000 rows, so the
-- expected number of live rows in it is 772 / 3.14M * 30,000 = 7.4, and it is
-- routinely zero. Every autoanalyze (2,964 so far) then wrote reltuples = 0
-- for all six; production read 0 for every one of them at 15:5x UTC.
--
-- The planner takes 0 at its word: an index that "holds no rows" costs
-- nothing, so live-seat queries scanned all of idx_table_seats_status (1 MB,
-- 128 pages plus heap visits) once per outer row instead of probing the
-- unique (table_id, user_id) index. The worst case is the tournament stack
-- cross-check in fn_ca_settle_hand_stacks_absolute (the IF at its line 611),
-- which both hand commits (holding the tournament settlement lane SHARED) and
-- fn_ca_resume_hand_submission (holding it EXCLUSIVE) run: on a 495-player
-- tournament it took past the 8 s statement timeout for a 9-player hand
-- (1,516 timeouts of that one statement between 15:00 and 16:10 UTC). Each
-- slow holder queued the whole tournament's lane behind it and pinned
-- PostgREST connections, which slowed every game (Lightning fold-to-next-hand
-- p50 56.6 s at 15:32 UTC).
--
-- Measured on production with the statement's generic plan, unchanged SQL:
--   reltuples 0   -> > 15,000 ms (cancelled), full idx_table_seats_status scans
--   reltuples 774 ->     11.5 ms, idx_unique_active_user_per_table, 3,162 buffers
-- (one manual ANALYZE at default_statistics_target 1000, 2026-11-10 16:00 UTC).
--
-- THE FIX AT THE ROOT: give table_seats a sample large enough that its live
-- fraction cannot round to zero. The table's sample size is 300 x the largest
-- column statistics target, so target 1000 on left_at (the predicate column of
-- all six indexes) makes it 300,000 rows: ~74 expected live rows today, and
-- still ~23 if the table grows to 10M rows. No function, lock, rule or money
-- path changes; the lock design of the settlement lane is untouched.
--
-- LOCKS: ALTER ... SET STATISTICS takes SHARE UPDATE EXCLUSIVE, which does not
-- conflict with reads or writes (only with VACUUM/ANALYZE/DDL), so this is not
-- a daily-maintenance file. lock_timeout 1 s: if autovacuum holds the table,
-- the file fails once and is applied again later (rule 2, no loop).
-- The next autoanalyze applies the new target; no ANALYZE is run here.
--
-- @live-proof: (SELECT coalesce(attstattarget, -1) >= 1000 FROM pg_attribute WHERE attrelid = 'public.table_seats'::regclass AND attname = 'left_at')

BEGIN;
SET LOCAL lock_timeout = '1s';

ALTER TABLE public.table_seats ALTER COLUMN left_at SET STATISTICS 1000;

COMMIT;
