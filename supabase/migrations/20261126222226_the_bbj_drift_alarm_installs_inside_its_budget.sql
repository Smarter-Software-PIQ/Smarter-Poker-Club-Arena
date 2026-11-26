-- 20261126222226_the_bbj_drift_alarm_installs_inside_its_budget
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT WENT WRONG:
--
-- 20261126203947 (the BBJ drift alarm reads its window once) was refused on
-- install at 22:17 UTC: FATAL 25P04, transaction timeout. The applier stops an
-- ordinary transaction at about 12 s. That file proved its answer by running
-- the PREVIOUS slow body inline (about 10 s cold, the very cost it removes) and
-- then timed a second call; together they ran past the budget and the whole
-- transaction rolled back. The comparison itself had passed on live data, and
-- the CONCURRENTLY index outside the transaction was built and is valid.
--
-- WHAT THIS CHANGES:
--
-- The same index (already valid; the preamble is a no-op) and the same
-- function body, byte for byte. The proof drops the inline re-run of the slow
-- old body, which the refused install already passed on production and which
-- was also checked by hand read-only (8,790.37 booked and received, 26,415
-- hands, 0 unlinkable). The transaction keeps the index qualification, the
-- shape check and one timed call, which must finish in 2 s, so the whole
-- install stays well inside the applier's budget.
--
-- No money moves, no game table is locked, no cron schedule changes.
--
-- @live-proof: (SELECT i.indisvalid FROM pg_index i WHERE i.indexrelid = to_regclass('public.idx_rake_records_bbj_window_cover')) AND (SELECT position('AS MATERIALIZED' IN pg_get_functiondef('public.bbj_drift_since(timestamptz)'::regprocedure)) > 0)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rake_records_bbj_window_cover
 ON public.rake_records USING btree (created_at) INCLUDE (hand_id, bbj_contribution)
 WHERE (bbj_contribution > (0)::numeric);

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '8s';

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
  -- One timed call, inside the applier's budget with room to spare.
  v_t0 := clock_timestamp();
  PERFORM * FROM public.bbj_drift_since(now() - interval '1 day');
  v_ms := extract(epoch FROM clock_timestamp() - v_t0) * 1000;
  IF v_ms > 2000 THEN
    RAISE EXCEPTION 'BBJ_DRIFT_STILL_SLOW % ms', round(v_ms) USING ERRCODE = '55000';
  END IF;
  RAISE NOTICE 'bbj_drift_since: read in % ms', round(v_ms);
END
$post$;

COMMIT;
