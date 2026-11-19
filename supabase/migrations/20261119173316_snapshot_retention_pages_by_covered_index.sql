-- 20261119173316_snapshot_retention_pages_by_covered_index
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-19 17:33:16 UTC.
--
-- WHAT WAS WRONG (measured on production 2026-11-19):
--
-- sp_prune_hand_state_snapshots (cron sp_prune_hand_state_snapshots_2m, every
-- two minutes) held a database connection for its whole 20 s budget, run after
-- run, for hours at a time, and deleted nothing. pg_stat_statements since
-- 2026-10-04: 32,936 calls, mean 14.1 s, max 119.9 s (the postgres role's
-- 2 min statement_timeout; the in-statement set_config('statement_timeout',
-- '30s') in the cron command arms nothing for the statement already running).
-- cron.job_run_details: 2026-11-18 11:00-20:00 UTC every run took 20.0 s.
--
-- The cause is the retained backlog plus a per-row loop. About 627,000
-- snapshots are past the eight-day bound (oldest 2026-09-18) and none of them
-- holds a horse_adaptive_disposal_certificate (300 oldest and 300 newest
-- expired sampled: 0 certificates, 0 disposable), so every one is refused.
-- When a pass reaches the bound the cursor wraps to -infinity, as it must, so
-- refused witnesses are revisited. The revisit walked those 627,000 rows one
-- at a time: a heap fetch of each 12 KB snapshot row to read id, table_id and
-- hand_number (the only time index is created_at alone), then one DELETE
-- statement per row. A 10,000-row page measured 4.75 s just to read the
-- candidates (11,642 heap blocks from disk), and the per-row DELETEs filled
-- the rest of the 20 s budget, so a pass over the refused backlog took about
-- nine hours of continuous 20 s runs (examined counter: 61.6 million). Those
-- per-row DELETEs also evaluated horse_snapshot_disposable for rows with no
-- certificate: on the native fixture in
-- scripts/ci/test-snapshot-retention-pages-by-covered-index.py the previous
-- definition made 2,999 eligibility calls to delete 300 rows of 3,000; this
-- one makes 500, one per certified row with no reserved permit.
--
-- WHAT THIS CHANGES:
--
-- 1. A covering index, (created_at, id) INCLUDE (table_id, hand_number). The
--    keyset page is now an index-only read, ordered exactly as the cursor
--    orders, so reading a page touches no snapshot heap.
-- 2. The function works set-based in sub-pages of at most 1,000 rows: one
--    statement selects the page from the index, keeps only rows that hold a
--    disposal certificate and no reserved F06 permit (both index-only probes),
--    and deletes those under the UNCHANGED full predicate, the same four
--    conditions and the same authoritative horse_snapshot_disposable call,
--    re-checked on the locked row by the DELETE itself. The function is
--    called only for certified rows, never for a refused one.
--
-- WHAT DOES NOT CHANGE: the eight-day bound, the eligibility predicate, the
-- p_batch ceiling (10,000 rows examined per call), the 20 s budget, the
-- cursor table and its wrap at the end of a pass, the examined counter, the
-- return value, the function identity and ACL, the cron job. Cursor and
-- deletions still commit together in the caller's one transaction.
--
-- The covering index is built CONCURRENTLY in the sanctioned preamble
-- (scripts/ci/migration-concurrent-preamble.mjs): hand_state_snapshots is
-- written every hand, and a plain CREATE INDEX would hold SHARE on it for the
-- whole build. The transaction below refuses an INVALID or differently shaped
-- leftover before it replaces the function.
--
-- @live-proof: to_regclass('public.idx_hand_state_snapshots_retention_cover') IS NOT NULL AND position('SNAPSHOT RETENTION PAGES BY ITS COVERED INDEX' in pg_get_functiondef('public.sp_prune_hand_state_snapshots(integer)'::regprocedure)) > 0
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hand_state_snapshots_retention_cover
 ON public.hand_state_snapshots USING btree (created_at, id) INCLUDE (table_id, hand_number);

BEGIN;

SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

DO $guard$
DECLARE actual_definition text; valid boolean; ready boolean;
BEGIN
 IF md5(pg_get_functiondef('public.sp_prune_hand_state_snapshots(integer)'::regprocedure))
    IS DISTINCT FROM 'b192cde11e809c4477e9b009a353178a' THEN
  RAISE EXCEPTION 'snapshot retention preimage changed; inspect before installation';
 END IF;
 SELECT pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready
   INTO actual_definition,valid,ready FROM pg_index i
  WHERE i.indexrelid=to_regclass('public.idx_hand_state_snapshots_retention_cover')
    AND i.indrelid='public.hand_state_snapshots'::regclass;
 IF valid IS DISTINCT FROM true OR ready IS DISTINCT FROM true
    OR actual_definition IS DISTINCT FROM
     'CREATE INDEX idx_hand_state_snapshots_retention_cover ON public.hand_state_snapshots USING btree (created_at, id) INCLUDE (table_id, hand_number)' THEN
  RAISE EXCEPTION 'snapshot retention cover index missing, invalid or definition differs';
 END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.sp_prune_hand_state_snapshots(p_batch integer DEFAULT 5000)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
 v_cursor smarter_private.snapshot_retention_scan;
 v_seen integer := 0;
 v_page integer;
 v_page_seen integer;
 v_last_at timestamptz;
 v_last_id uuid;
 v_n integer;
 v_deleted integer := 0;
 v_limit integer := LEAST(10000, GREATEST(COALESCE(p_batch,5000),1));
 v_deadline timestamptz := clock_timestamp() + interval '20 seconds';
BEGIN
 -- SNAPSHOT RETENTION PAGES BY ITS COVERED INDEX (2026-11-19, 20261119173316).
 -- The cron already takes its advisory lock. Other callers must not race
 -- the same scan position or wait behind a long retention transaction.
 SELECT * INTO v_cursor FROM smarter_private.snapshot_retention_scan
  WHERE singleton FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN 0; END IF;
 LOOP
  EXIT WHEN v_seen >= v_limit OR clock_timestamp() >= v_deadline;
  v_page := LEAST(1000, v_limit - v_seen);
  -- MATERIALIZED is the work boundary: the page is an index-only keyset read
  -- (idx_hand_state_snapshots_retention_cover), and only certified rows with
  -- no reserved permit ever reach the DELETE and its eligibility function.
  WITH page AS MATERIALIZED (
   SELECT s.id,s.created_at,s.table_id,s.hand_number FROM public.hand_state_snapshots s
    WHERE s.created_at >= v_cursor.through_at
      AND (s.created_at,s.id) > (v_cursor.through_at,v_cursor.after_id)
      AND s.created_at < statement_timestamp()-interval '8 days'
    ORDER BY s.created_at,s.id LIMIT v_page
  ), certified AS MATERIALIZED (
   SELECT p.id FROM page p
    WHERE EXISTS (SELECT 1 FROM smarter_private.horse_adaptive_disposal_certificates c
                   WHERE c.table_id=p.table_id AND c.hand_number=p.hand_number)
      AND NOT EXISTS (SELECT 1 FROM smarter_private.f06_hand_permits fp
                       WHERE fp.table_id=p.table_id AND fp.hand_number=p.hand_number AND fp.state='reserved')
  ), doomed AS (
   -- Same authoritative eligibility function, certificate and interrupted
   -- hand holds, rechecked by the DELETE. No human/BBJ/escrow witness relaxed.
   DELETE FROM public.hand_state_snapshots h USING certified d WHERE h.id=d.id
    AND h.updated_at < statement_timestamp()-interval '8 days'
    AND EXISTS (SELECT 1 FROM smarter_private.horse_adaptive_disposal_certificates c
                 WHERE c.table_id=h.table_id AND c.hand_number=h.hand_number)
    AND NOT EXISTS (SELECT 1 FROM smarter_private.f06_hand_permits p
                     WHERE p.table_id=h.table_id AND p.hand_number=h.hand_number AND p.state='reserved')
    AND smarter_private.horse_snapshot_disposable(h.id)
   RETURNING 1
  )
  SELECT (SELECT count(*) FROM doomed),
         (SELECT count(*) FROM page),
         (SELECT created_at FROM page ORDER BY created_at DESC,id DESC LIMIT 1),
         (SELECT id FROM page ORDER BY created_at DESC,id DESC LIMIT 1)
    INTO v_n,v_page_seen,v_last_at,v_last_id;
  EXIT WHEN v_page_seen=0;
  v_deleted := v_deleted+v_n;
  v_seen := v_seen+v_page_seen;
  v_cursor.through_at := v_last_at;
  v_cursor.after_id := v_last_id;
  EXIT WHEN v_page_seen < v_page;
 END LOOP;
 IF v_seen=0 THEN
  -- End of pass: revisit refused witnesses on the next existing cron call.
  -- They may become disposable after their original owning hand completes.
  v_cursor.through_at := '-infinity';
  v_cursor.after_id := '00000000-0000-0000-0000-000000000000';
 END IF;
 UPDATE smarter_private.snapshot_retention_scan
  SET through_at=v_cursor.through_at,after_id=v_cursor.after_id,
      examined=examined+v_seen,updated_at=clock_timestamp() WHERE singleton;
 RETURN v_deleted;
END
$function$;

REVOKE ALL ON FUNCTION public.sp_prune_hand_state_snapshots(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sp_prune_hand_state_snapshots(integer) TO service_role;

-- @probe-for: public.sp_prune_hand_state_snapshots
DO $probe$
BEGIN
 PERFORM public.sp_prune_hand_state_snapshots(1);
 RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
 IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- CREATE OR REPLACE preserves the existing function identity and ACL.
-- No cron, timeout, retention duration, payout or disposal predicate changes.

COMMIT;
