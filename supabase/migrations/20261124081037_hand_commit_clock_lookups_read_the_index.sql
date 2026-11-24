-- 20261124081037_hand_commit_clock_lookups_read_the_index
--
-- Version chosen by hand at 08:10Z (reserve-migration-version.sh timed out
-- under load); the required version-collision check gates it.
--
-- WHAT WAS WRONG (measured on production 2026-11-24):
--
-- DatabaseRepliesLost fires 3-8 times a day: engine requests on one tournament
-- wait past their own 4 s / 8 s deadlines behind a lock held by
-- process_tournament_rebuy (tournament row FOR UPDATE + ca:tournament-rebuy-lane,
-- 15.5 s at 06:37Z; 28.7 s max over 323k calls). The four largest firings of
-- Nov 20-23 (107, 32, 5, 35 lost) all fall at 20:31-20:41 Chicago, the
-- Nightly 20K rebuy/add-on close, when hundreds of rebuys queue on one
-- tournament. Inside the lock the rebuy runs Promo Play Through work that
-- reads fn_ca_promo_fee_events. For the heaviest open-grant member that read
-- returns 8,920 rows, 5,696 of which probe public.hand_atomic_commits by
-- hand_id for committed_at alone. Warm, the whole read takes 97-194 ms; cold,
-- under load, it took 7.9 s and 13.8 s, because each probe fetches its row
-- from a 17 GB heap (rows carry the full post-commit payload) that is not in
-- cache. A transaction-scoped lock cannot be released before commit, so the
-- remedy is the cost of the read, not where it runs.
--
-- WHAT THIS CHANGES:
--
-- One covering index, (hand_id) INCLUDE (committed_at), so every
-- "committed_at of this hand" probe is an index-only read (the visibility map
-- covers 99.9 % of the heap). Measured with hypopg on production, rolled back:
-- the planner moves the probe from an Index Scan on hand_atomic_commits_hand_id_key
-- (heap fetch) to an Index Only Scan on the new index; estimated size 324 MB.
-- No function, row, ACL or money path changes; every reader keeps its exact
-- semantics because only the access path changes.
--
-- Built CONCURRENTLY in the sanctioned preamble
-- (scripts/ci/migration-concurrent-preamble.mjs): hand_atomic_commits is
-- written by every hand, and a plain CREATE INDEX would hold SHARE on it for
-- the whole build. The transaction refuses an INVALID or differently shaped
-- leftover by name.
--
-- @live-proof: (SELECT i.indisvalid AND i.indisready AND i.indislive FROM pg_index i WHERE i.indexrelid = to_regclass('public.idx_hand_atomic_commits_hand_id_committed_cover'))
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hand_atomic_commits_hand_id_committed_cover
 ON public.hand_atomic_commits USING btree (hand_id) INCLUDE (committed_at);

BEGIN;

SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

DO $verify$
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM pg_index i
  JOIN pg_class ix ON ix.oid = i.indexrelid
  JOIN pg_am am ON am.oid = ix.relam
  WHERE i.indexrelid = to_regclass('public.idx_hand_atomic_commits_hand_id_committed_cover')
    AND i.indrelid = 'public.hand_atomic_commits'::regclass
    AND am.amname = 'btree'
    AND i.indisvalid AND i.indisready AND i.indislive
    AND NOT i.indisunique AND i.indpred IS NULL AND i.indexprs IS NULL
    AND i.indnkeyatts = 1 AND i.indnatts = 2
    AND ARRAY(SELECT pg_get_indexdef(i.indexrelid, n, true) FROM generate_series(1, 2) n)
        = ARRAY['hand_id', 'committed_at']
 ) THEN
  RAISE EXCEPTION 'HAND_COMMIT_CLOCK_COVER_NOT_QUALIFIED' USING ERRCODE = '55000';
 END IF;
END
$verify$;

COMMIT;
