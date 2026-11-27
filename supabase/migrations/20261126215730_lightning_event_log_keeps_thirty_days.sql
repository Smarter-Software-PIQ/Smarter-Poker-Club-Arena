-- 20261126215730_lightning_event_log_keeps_thirty_days
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT WAS WRONG (measured on production 2026-11-26):
--
-- public.cash_cluster_events, the cash cluster and Lightning event log, had no
-- retention at all: 46 GB and about 64 M rows since 2026-09-04, growing by
-- 0.5 to 2.5 M rows a day. Nothing ever removed a row.
--
-- WHY 30 DAYS IS SAFE (every reader checked against the live bodies):
--
--   * No state is replayed from this log. Mode, epoch, pending conversions,
--     drains and freeze status live in cash_games, cash_cluster_epoch,
--     cash_cluster_conversion, lightning_cluster_drain and
--     lightning_pool_session. fn_cash_cluster_balance writes here; it never
--     reads the log.
--   * Every live reader is bounded: the cluster tick reads 2 minutes,
--     fn_lightning_alert_sweep and financial_alerts_proven_over read their
--     alert window, fn_cash_game_switch_off looks a request up near its
--     creation, fn_lightning_drain_advance reads from its drain request
--     (none open). The engine only listens for realtime INSERTs.
--   * The one reader that reaches back is "cluster_frozen since the current
--     epoch began" (fn_lightning_alert_sweep, fn_lightning_operator_cluster_row).
--     Epochs can be older than 30 days, so a cluster_frozen event of a game
--     that is frozen NOW is never deleted.
--   * Operator history tools (forensics, session trail, hand replay) lose
--     history older than 30 days. That is history, not state.
--
-- WHAT THIS CHANGES:
--
--   * public.fn_ca_prune_cash_cluster_events(p_keep, p_batch): owner-only,
--     refuses a keep shorter than 30 days, deletes at most p_batch (cap
--     50 000) of the OLDEST rows per call. It reads only the lowest p_batch
--     ids by primary key (id rises with time), so a call after the backlog is
--     gone touches one page range and deletes nothing, instead of walking 30
--     days of young rows looking for an old one.
--   * cron job ca-cash-cluster-events-retention every 5 minutes, 15 000 rows a
--     call (about 4.3 M a day), which clears the backlog and outruns the
--     busiest day measured (about 2.5 M rows).
--
-- Nothing here touches money, balances, ledgers, settlements or rake rows, and
-- no game table is locked.
--
-- periodic-work: retention only. A rolling 30-day delete of a disposable event
-- log is the product; nothing upstream fails that this compensates for.
--
-- @live-proof: to_regprocedure('public.fn_ca_prune_cash_cluster_events(interval,integer)') IS NOT NULL AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ca-cash-cluster-events-retention' AND active AND command LIKE '%fn_ca_prune_cash_cluster_events(interval ''30 days'', 15000)%')

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.fn_ca_prune_cash_cluster_events(
  p_keep interval DEFAULT interval '30 days',
  p_batch integer DEFAULT 15000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '30s'
SET lock_timeout TO '1s'
AS $function$
DECLARE
  v_batch integer := LEAST(50000, GREATEST(COALESCE(p_batch, 15000), 1));
  v_cutoff timestamptz;
  v_deleted integer := 0;
BEGIN
  IF p_keep IS NULL OR p_keep < interval '30 days' THEN
    RAISE EXCEPTION 'cash_cluster_events keeps at least 30 days' USING ERRCODE = '22023';
  END IF;

  v_cutoff := now() - p_keep;

  WITH lowest AS MATERIALIZED (
    SELECT e.id, e.at, e.kind, e.game_id
      FROM public.cash_cluster_events e
     ORDER BY e.id
     LIMIT v_batch
  ), doomed AS MATERIALIZED (
    SELECT l.id
      FROM lowest l
     WHERE l.at < v_cutoff
       AND NOT (l.kind = 'cluster_frozen'
                AND EXISTS (SELECT 1 FROM public.cash_games g
                             WHERE g.id = l.game_id AND g.cluster_mode = 'frozen'))
  )
  DELETE FROM public.cash_cluster_events t
   USING doomed d
   WHERE t.id = d.id
     AND t.at < v_cutoff;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END $function$;

REVOKE ALL ON FUNCTION public.fn_ca_prune_cash_cluster_events(interval, integer)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.fn_ca_prune_cash_cluster_events(interval, integer) IS
  'Owner-only rolling retention for public.cash_cluster_events (at least 30 days, at most 50000 of the oldest rows per call). Never deletes a cluster_frozen event of a game that is frozen now.';

SELECT cron.schedule(
  'ca-cash-cluster-events-retention',
  '*/5 * * * *',
  $cron$SET statement_timeout = '30s'; SET lock_timeout = '1s'; SELECT public.fn_ca_prune_cash_cluster_events(interval '30 days', 15000);$cron$
);

DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.oid = 'public.fn_ca_prune_cash_cluster_events(interval,integer)'::regprocedure
       AND p.prosecdef
       AND pg_get_userbyid(p.proowner) = 'postgres'
       AND p.proconfig @> ARRAY['search_path=public', 'statement_timeout=30s', 'lock_timeout=1s']
       AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
       AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
       AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'CASH_CLUSTER_EVENTS_PRUNER_SHAPE';
  END IF;
  BEGIN
    PERFORM public.fn_ca_prune_cash_cluster_events(interval '29 days', 1);
    RAISE EXCEPTION 'CASH_CLUSTER_EVENTS_PRUNER_ACCEPTED_SHORT_KEEP';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  END;
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'ca-cash-cluster-events-retention') <> 1 THEN
    RAISE EXCEPTION 'CASH_CLUSTER_EVENTS_RETENTION_JOB';
  END IF;
END $verify$;

-- @probe-for: public.fn_ca_prune_cash_cluster_events
DO $probe$
BEGIN
  PERFORM public.fn_ca_prune_cash_cluster_events(interval '30 days', 1);
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
