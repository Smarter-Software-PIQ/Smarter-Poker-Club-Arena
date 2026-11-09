-- 20261109022418_tournaments_started_at_has_an_index.sql
--
-- WHY. `tournaments` holds 991,799 rows in a 1,541 MB heap (measured
-- 2026-11-09) and no index covers `started_at` on its own: the seven that
-- mention it are all partial - spin-only, status-restricted, or predicated on
-- spin_reveal_lag_ms. So any question of the form "what started on this day"
-- was a full heap scan: 247,595 shared buffers, 2,843 ms warm, and 13,831 ms
-- cold for two days.
--
-- service_role's statement_timeout is pinned to its historical ~8 s (CLAUDE.md
-- section 2, the PGRST002 fix), so the estate digest's one call to
-- fn_ca_seat_first_daily_starts came back as
--
--   edge_logs  02:15:30Z  POST | 500 | /rest/v1/rpc/fn_ca_seat_first_daily_starts
--
-- and the digest printed "(seat-first starts unreadable today)" where Dan's
-- under-300 combined number should have been. The companion migration
-- 20261109022243 turned the day filter into a half-open
-- `started_at >= lo AND started_at < hi` range so an index can serve it. This
-- is that index. Expected plan afterwards: an index range read of one day
-- (about 15,000 rows today, about 200 a day once the waiting ladder is the
-- engine that is serving) instead of 991,799 heap rows.
--
-- WHY IT IS BUILT CONCURRENTLY, IN THIS EXACT SHAPE. A plain CREATE INDEX
-- holds SHARE on the table for the whole build, and `tournaments` is written
-- by the engine on every deal, start, pause and settle - CLAUDE.md section 2
-- rule 9 is what that costs. So this file uses the door's one considered
-- exception (scripts/ci/migration-concurrent-preamble.mjs, recorded by
-- 20260920185803 and 20260925205938): the index statement sits BEFORE the
-- transaction, is the only thing there, and carries IF NOT EXISTS so a
-- re-dispatch after a partial run skips what is already built. The
-- transaction below then refuses an INVALID leftover by name rather than
-- leaving a half-built index for the planner to ignore in silence.
--
-- COST. One btree over one timestamptz column, about 22 MB. 979,342 of the
-- 991,799 rows have a non-null `started_at`, so a partial index would exclude
-- almost nothing while stopping the planner using it for other `started_at`
-- questions; plain and unconditional is the right shape.
--
-- NOT A REPAIR JOB (CLAUDE.md 10.12). This builds no schedule, repairs no row
-- and compensates for nothing. It is the arithmetic the read always needed.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tournaments_started_at ON public.tournaments USING btree (started_at);

BEGIN;

DO $$
DECLARE
  v_exists boolean;
  v_valid boolean;
BEGIN
  SELECT true, i.indisvalid
    INTO v_exists, v_valid
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_index i ON i.indexrelid = c.oid
   WHERE n.nspname = 'public'
     AND c.relname = 'idx_tournaments_started_at';

  IF NOT COALESCE(v_exists, false) THEN
    RAISE EXCEPTION
      'idx_tournaments_started_at was not built; the concurrent preamble did not run';
  END IF;

  IF NOT v_valid THEN
    RAISE EXCEPTION
      'idx_tournaments_started_at exists but is INVALID; drop it and re-dispatch this migration so the build is completed rather than silently ignored by the planner';
  END IF;
END
$$;

COMMENT ON INDEX public.idx_tournaments_started_at IS
  'Serves half-open started_at day ranges: the daily seat-first start report (fn_ca_seat_first_daily_starts) and anything else asking what started on a given day. Added 2026-11-09 because every other started_at index is partial, so a one-day question scanned the whole 1.5 GB heap and exceeded the service_role statement budget over PostgREST.';

COMMIT;
