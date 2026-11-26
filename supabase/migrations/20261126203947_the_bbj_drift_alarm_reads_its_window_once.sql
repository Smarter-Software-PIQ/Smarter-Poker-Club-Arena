-- 20261126203947_the_bbj_drift_alarm_reads_its_window_once
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT WAS WRONG (measured on production 2026-11-26):
--
-- FeeReconciler.auditBBJDrift calls bbj_drift_since(now() - 1 day) every hour
-- as service_role, whose statement_timeout is 8 s. Cold it took 10,686 ms
-- (shared hit 262,624, read 17,603) and was cancelled; warm it took 401 ms.
-- Two costs, both in the access path, none in the answer:
--
--   1. The 24 hours of BBJ-bearing rake rows (about 26,500) were fetched from
--      the 6 GB rake_records heap, whose rows carry the full jsonb evidence,
--      so a cold hour read some 17,600 pages to use three narrow columns.
--   2. The CTE `j` is referenced twice (sum(received) and the FILTER), was
--      inlined both times, and so probed bbj_contributions once per hand
--      TWICE: 211,360 of the 280,192 buffers.
--
-- WHAT THIS CHANGES:
--
--   * One covering partial index on rake_records,
--     (created_at) INCLUDE (hand_id, bbj_contribution) WHERE bbj_contribution > 0,
--     so the window is an index-only read (98.8 % of the heap is all-visible).
--     Built CONCURRENTLY in the sanctioned preamble
--     (scripts/ci/migration-concurrent-preamble.mjs): rake_records is written
--     every hand, and a plain CREATE INDEX would hold SHARE on it for the
--     whole build. The transaction refuses an INVALID or differently shaped
--     leftover by name.
--   * bbj_drift_since reads the window ONCE (MATERIALIZED) and probes each
--     settled hand's bank row ONCE (MATERIALIZED j).
--
-- The answer is identical: same signature, same six columns, same 6-minute
-- settle grace (strictly greater than fn_bbj_repair_unbanked's 5 minutes),
-- same join by hand, same unlinkable population. The function stays STABLE,
-- SECURITY INVOKER and search_path public; CREATE OR REPLACE keeps its ACL.
-- The transaction proves the old and new bodies agree on the live data before
-- it commits.
--
-- @live-proof: (SELECT i.indisvalid FROM pg_index i WHERE i.indexrelid = to_regclass('public.idx_rake_records_bbj_window_cover')) AND (SELECT position('AS MATERIALIZED' IN pg_get_functiondef('public.bbj_drift_since(timestamptz)'::regprocedure)) > 0)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rake_records_bbj_window_cover
 ON public.rake_records USING btree (created_at) INCLUDE (hand_id, bbj_contribution)
 WHERE (bbj_contribution > (0)::numeric);

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $verify_index$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class ix ON ix.oid = i.indexrelid
    JOIN pg_am am ON am.oid = ix.relam
    WHERE i.indexrelid = to_regclass('public.idx_rake_records_bbj_window_cover')
      AND i.indrelid = 'public.rake_records'::regclass
      AND am.amname = 'btree'
      AND i.indisvalid AND i.indisready AND i.indislive
      AND NOT i.indisunique AND i.indexprs IS NULL
      AND pg_get_expr(i.indpred, i.indrelid) = '(bbj_contribution > (0)::numeric)'
      AND i.indnkeyatts = 1 AND i.indnatts = 3
      AND ARRAY(SELECT pg_get_indexdef(i.indexrelid, n, true) FROM generate_series(1, 3) n)
          = ARRAY['created_at', 'hand_id', 'bbj_contribution']
  ) THEN
    RAISE EXCEPTION 'BBJ_WINDOW_COVER_NOT_QUALIFIED' USING ERRCODE = '55000';
  END IF;
END
$verify_index$;

CREATE OR REPLACE FUNCTION public.bbj_drift_since(p_since timestamp with time zone)
 RETURNS TABLE(booked numeric, received numeric, booked_rows bigint, received_rows bigint, unlinkable_rows bigint, unlinkable_chips numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- ONE READ OF THE WINDOW, ONE PROBE PER HAND (2026-11-26). The window is an
  -- index-only read of idx_rake_records_bbj_window_cover, and both CTEs are
  -- MATERIALIZED so neither is inlined twice.
  WITH r AS MATERIALIZED (
    SELECT rr.hand_id, rr.bbj_contribution, rr.created_at
    FROM rake_records rr
    WHERE rr.created_at >= p_since
      AND rr.bbj_contribution > 0
  ),
  j AS MATERIALIZED (
    -- Settled: 6 minutes, STRICTLY GREATER than fn_bbj_repair_unbanked's
    -- 5-minute grace. An alarm that judges hands its own healer is still
    -- waiting on reports the healer's patience as a shortfall.
    -- Join by hand, never by a second time window (2026-08-30): a slice
    -- banked late by a self-heal still belongs to its hand.
    SELECT r.bbj_contribution AS booked,
           COALESCE((SELECT sum(b.amount) FROM bbj_contributions b
                      WHERE b.hand_id = r.hand_id), 0) AS received
    FROM r
    WHERE r.hand_id IS NOT NULL
      AND r.created_at < now() - interval '6 minutes'
  )
  SELECT
    COALESCE(sum(j.booked), 0)::numeric,
    COALESCE(sum(j.received), 0)::numeric,
    count(*)::bigint,
    count(*) FILTER (WHERE j.received > 0)::bigint,
    (SELECT count(*) FROM r WHERE r.hand_id IS NULL)::bigint,
    COALESCE((SELECT sum(r.bbj_contribution) FROM r WHERE r.hand_id IS NULL), 0)::numeric
  FROM j;
$function$;

DO $post$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_t0 timestamptz;
  v_ms numeric;
BEGIN
  -- Same function shape: STABLE, invoker, search_path public, sql.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid = 'public.bbj_drift_since(timestamptz)'::regprocedure
      AND p.provolatile = 's' AND NOT p.prosecdef
      AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'sql')
      AND p.proconfig = ARRAY['search_path=public']
  ) THEN
    RAISE EXCEPTION 'BBJ_DRIFT_SHAPE_CHANGED' USING ERRCODE = '55000';
  END IF;

  -- Same answer on the live data. The previous body is read inline (verbatim
  -- from 20260830064419) in the SAME statement as the new function, so both
  -- judge one snapshot (a STABLE function uses its caller's), and now() is the
  -- transaction start, so both judge the identical window.
  WITH r AS (
    SELECT hand_id, bbj_contribution FROM rake_records
    WHERE created_at >= now() - interval '1 day' AND bbj_contribution > 0
  ),
  settled AS (
    SELECT hand_id, bbj_contribution FROM rake_records
    WHERE created_at >= now() - interval '1 day'
      AND created_at < now() - interval '6 minutes'
      AND bbj_contribution > 0 AND hand_id IS NOT NULL
  ),
  j AS (
    SELECT s.bbj_contribution AS booked,
           COALESCE((SELECT sum(b.amount) FROM bbj_contributions b
                      WHERE b.hand_id = s.hand_id), 0) AS received
    FROM settled s
  )
  , old_answer AS (
    SELECT COALESCE(sum(j.booked), 0)::numeric AS booked,
           COALESCE(sum(j.received), 0)::numeric AS received,
           count(*)::bigint AS booked_rows,
           count(*) FILTER (WHERE j.received > 0)::bigint AS received_rows,
           (SELECT count(*) FROM r WHERE r.hand_id IS NULL)::bigint AS unlinkable_rows,
           COALESCE((SELECT sum(r.bbj_contribution) FROM r WHERE r.hand_id IS NULL), 0)::numeric AS unlinkable_chips
    FROM j
  )
  SELECT to_jsonb(o), to_jsonb(n)
    INTO v_old, v_new
    FROM old_answer o, public.bbj_drift_since(now() - interval '1 day') n;
  IF v_old IS DISTINCT FROM v_new THEN
    RAISE EXCEPTION 'BBJ_DRIFT_ANSWER_CHANGED old=% new=%', v_old, v_new USING ERRCODE = '55000';
  END IF;
  v_t0 := clock_timestamp();
  PERFORM * FROM public.bbj_drift_since(now() - interval '1 day');
  v_ms := extract(epoch FROM clock_timestamp() - v_t0) * 1000;
  IF v_ms > 5000 THEN
    RAISE EXCEPTION 'BBJ_DRIFT_STILL_SLOW % ms', round(v_ms) USING ERRCODE = '55000';
  END IF;
  RAISE NOTICE 'bbj_drift_since: answer unchanged, read in % ms', round(v_ms);
END
$post$;

COMMIT;
