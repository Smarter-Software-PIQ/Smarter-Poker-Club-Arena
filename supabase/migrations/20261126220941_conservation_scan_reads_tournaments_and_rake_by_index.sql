-- 20261126220941_conservation_scan_reads_tournaments_and_rake_by_index.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT WAS WRONG (measured on production 2026-11-26, read-only):
--
-- fn_tournament_money_conservation (GameServer, every 6 h, p_since_days 7)
-- was cancelled by statement timeout 5 times in the 24 h to 21:45Z. Its one
-- read, fn_tournament_conservation_deltas, spends almost all of its time in
-- two places:
--
--   1. eligible: tournaments WHERE status IN ('COMPLETED','CANCELLED') AND
--      ended_at in the window. The only ended_at index covers COMPLETED alone
--      (idx_tournaments_completed_ended_at), so the planner seq-scans the
--      1.5 GB heap: 199,970 buffers to keep 731 of 1,004,801 rows (0.45 s
--      warm, seconds cold).
--   2. rake_totals: rake_records joined to those 731 events. The planner
--      full-scans idx_rake_records_club_data_tournament_window (1,782,021
--      entries, 237,864 buffers, 114,668 of them read from disk) and hashes,
--      because a per-event probe on idx_rake_records_tournament must visit
--      the heap for is_tournament and rake_amount. Measured 10.4 s; the
--      per-event probe, forced, took 0.47 s for the same 40,182 rows.
--
-- Together, cold, 8.3 to 24.9 s against an 8 s statement budget.
--
-- WHAT THIS CHANGES:
--
-- Two partial indexes whose predicates are the function's own, word for word,
-- so the planner can prove them and no reader's semantics change:
--
--   idx_tournaments_conservation_ended_at (ended_at)
--     WHERE status IN ('COMPLETED','CANCELLED')
--     A seven-day window is ~1.7k index entries instead of a heap scan.
--   idx_rake_records_tournament_rake_cover (tournament_id) INCLUDE (rake_amount)
--     WHERE is_tournament AND rake_amount <> 0 AND tournament_id IS NOT NULL
--     Each event's rake is an index-only probe (~55 entries per event).
--
-- No function, row, ACL or money path changes: fn_tournament_conservation_deltas
-- and fn_tournament_money_conservation are untouched (both are pinned money
-- functions); only the access path under them changes.
--
-- Built CONCURRENTLY in the sanctioned preamble
-- (scripts/ci/migration-concurrent-preamble.mjs): rake_records is written by
-- every hand and tournaments by every event, so a plain CREATE INDEX would
-- hold SHARE on each for the whole build. The transaction refuses an INVALID
-- or differently shaped leftover by name.
--
-- @live-proof: (SELECT i.indisvalid AND i.indisready AND i.indislive FROM pg_index i WHERE i.indexrelid = to_regclass('public.idx_tournaments_conservation_ended_at'))
-- @live-proof: (SELECT i.indisvalid AND i.indisready AND i.indislive FROM pg_index i WHERE i.indexrelid = to_regclass('public.idx_rake_records_tournament_rake_cover'))
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tournaments_conservation_ended_at
 ON public.tournaments USING btree (ended_at)
 WHERE status IN ('COMPLETED', 'CANCELLED');

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rake_records_tournament_rake_cover
 ON public.rake_records USING btree (tournament_id) INCLUDE (rake_amount)
 WHERE is_tournament AND rake_amount <> 0 AND tournament_id IS NOT NULL;

BEGIN;

SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

DO $verify$
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM pg_index i
  JOIN pg_class ix ON ix.oid = i.indexrelid
  JOIN pg_am am ON am.oid = ix.relam
  WHERE i.indexrelid = to_regclass('public.idx_tournaments_conservation_ended_at')
    AND i.indrelid = 'public.tournaments'::regclass
    AND am.amname = 'btree'
    AND i.indisvalid AND i.indisready AND i.indislive
    AND NOT i.indisunique AND i.indexprs IS NULL
    AND i.indnkeyatts = 1 AND i.indnatts = 1
    AND pg_get_indexdef(i.indexrelid, 1, true) = 'ended_at'
    AND pg_get_expr(i.indpred, i.indrelid) = '(status = ANY (ARRAY[''COMPLETED''::text, ''CANCELLED''::text]))'
 ) THEN
  RAISE EXCEPTION 'CONSERVATION_TOURNAMENT_WINDOW_INDEX_NOT_QUALIFIED' USING ERRCODE = '55000';
 END IF;
 IF NOT EXISTS (
  SELECT 1 FROM pg_index i
  JOIN pg_class ix ON ix.oid = i.indexrelid
  JOIN pg_am am ON am.oid = ix.relam
  WHERE i.indexrelid = to_regclass('public.idx_rake_records_tournament_rake_cover')
    AND i.indrelid = 'public.rake_records'::regclass
    AND am.amname = 'btree'
    AND i.indisvalid AND i.indisready AND i.indislive
    AND NOT i.indisunique AND i.indexprs IS NULL
    AND i.indnkeyatts = 1 AND i.indnatts = 2
    AND ARRAY(SELECT pg_get_indexdef(i.indexrelid, n, true) FROM generate_series(1, 2) n)
        = ARRAY['tournament_id', 'rake_amount']
    AND pg_get_expr(i.indpred, i.indrelid) = '(is_tournament AND (rake_amount <> (0)::numeric) AND (tournament_id IS NOT NULL))'
 ) THEN
  RAISE EXCEPTION 'CONSERVATION_RAKE_COVER_INDEX_NOT_QUALIFIED' USING ERRCODE = '55000';
 END IF;
END
$verify$;

COMMIT;
