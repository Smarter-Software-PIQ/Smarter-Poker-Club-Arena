-- 20261128161915_mtt_launch_lateness_tolerates_maintenance_start_jitter
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-28.
--
-- MTT LAUNCH LATENESS TOLERATES SUB-SECOND MAINTENANCE FREEZE TIMER JITTER (2026-11-28).
--
-- Live verification of 20261128075041 on 2026-11-28 at 16:00Z (10:00 America/Chicago)
-- caught a 1-millisecond boundary miss:
--   * Mid-Morning Turbo (6-Max NLH) (5d4aeb41-d1f5-46ef-a686-d8c4cd589f82) had
--     start_time = '2026-11-28 16:00:00.000+00' and was parked by GameServer's :55
--     synchronized break until the maintenance break end ('2026-11-28 16:05:00.000+00').
--   * Node.js setTimeout fired the maintenance freeze 1 ms late, recording:
--       engine_maintenance_break_log.break_started_at = '2026-11-28 16:00:00.001+00'
--       engine_maintenance_thaws.freeze_started_at    = '2026-11-28 16:00:00.001+00'
--     (and earlier rows showed 13:00:00.001+00 and 01:00:00.01+00).
--   * Strict `break_started_at <= t.start_time` / `freeze_started_at <= t.start_time`
--     evaluated FALSE by 0.001 s, causing MttStartedLate (334c611e) to fire at 16:05:26Z
--     with worst_late_seconds = 301 even though the tournament dealt immediately on thaw.
--
-- WHAT THIS CHANGES:
--   * Allows up to 5 seconds of timer jitter on the maintenance freeze start boundary
--     (`l.break_started_at <= t.start_time + interval '5 seconds'` and
--     `th.freeze_started_at <= t.start_time + interval '5 seconds'`), while keeping
--     `break_ended_at > t.start_time`, the 12-minute bounded maintenance cap, the 120 s
--     late bar, and full alerting for any MTT scheduled before the maintenance boundary
--     or stalling after thaw.
--
-- Function body only: no table lock, no data mutation, exact signature and grants preserved.
--
-- @live-proof: (SELECT position('effective_start_time' IN pg_get_functiondef('public.fn_tournament_launch_lateness_metrics(integer,integer,integer,integer)'::regprocedure)) > 0 AND position('engine_maintenance_thaws' IN pg_get_functiondef('public.fn_tournament_launch_lateness_metrics(integer,integer,integer,integer)'::regprocedure)) > 0 AND position('engine_maintenance_break_log' IN pg_get_functiondef('public.fn_tournament_launch_lateness_metrics(integer,integer,integer,integer)'::regprocedure)) > 0 AND position('interval ''5 seconds''' IN pg_get_functiondef('public.fn_tournament_launch_lateness_metrics(integer,integer,integer,integer)'::regprocedure)) > 0)

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

DO $preimage$
DECLARE
  v_oid oid := to_regprocedure('public.fn_tournament_launch_lateness_metrics(integer,integer,integer,integer)');
  v_def text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'MTT_LATENESS_MISSING fn_tournament_launch_lateness_metrics'
      USING ERRCODE = '55000';
  END IF;
  v_def := pg_get_functiondef(v_oid);
  IF md5(v_def) IS DISTINCT FROM '31cdd1ce751effd17cd335d30f60e840' THEN
    RAISE EXCEPTION 'MTT_LATENESS_PREIMAGE_DRIFT got %', md5(v_def)
      USING ERRCODE = '55000';
  END IF;
END $preimage$;

CREATE OR REPLACE FUNCTION public.fn_tournament_launch_lateness_metrics(
  p_late_seconds integer DEFAULT 120,
  p_headroom_seconds integer DEFAULT 120,
  p_window_minutes integer DEFAULT 15,
  p_lookback_hours integer DEFAULT 24
)
 RETURNS TABLE(late_first_hands integer, late_waiting integer, worst_late_seconds integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH b AS (
    SELECT statement_timestamp() AS now_at,
           make_interval(secs => LEAST(86400, GREATEST(1, COALESCE(p_late_seconds, 120)))) AS late,
           make_interval(secs => LEAST(3600, GREATEST(0, COALESCE(p_headroom_seconds, 120)))) AS headroom,
           make_interval(mins => LEAST(1440, GREATEST(1, COALESCE(p_window_minutes, 15)))) AS win,
           make_interval(hours => LEAST(168, GREATEST(1, COALESCE(p_lookback_hours, 24)))) AS lookback
  ),
  c AS (
    SELECT t.start_time,
           GREATEST(t.start_time, COALESCE(mw.thaw_at, t.start_time)) AS effective_start_time,
           t.status,
           f.first_created,
           f.first_started
      FROM public.tournaments t
     CROSS JOIN b
      LEFT JOIN LATERAL (
        -- A bounded (<= 12 minutes) completed platform maintenance freeze that
        -- covered t.start_time (allowing <= 5 seconds of timer jitter when the
        -- freeze starts on the exact :00:00 boundary, e.g. :00:00.001) prevents
        -- any table from dealing until the thaw. Measure launch lateness from
        -- that thaw boundary; unbounded freezes (> 12 m) and post-thaw delays
        -- > p_late_seconds still alert.
        SELECT max(w.freeze_end) AS thaw_at
          FROM (
            SELECT l.break_ended_at AS freeze_end
              FROM public.engine_maintenance_break_log l
             WHERE l.break_started_at > b.now_at - b.lookback - interval '1 hour'
               AND l.break_started_at <= t.start_time + interval '5 seconds'
               AND l.break_ended_at > t.start_time
               AND l.break_ended_at <= l.break_started_at + interval '12 minutes'
            UNION ALL
            SELECT th.release_target_at AS freeze_end
              FROM public.engine_maintenance_thaws th
             WHERE th.contract_version = 3
               AND COALESCE((th.shifted->>'complete')::boolean, false)
               AND th.freeze_started_at IS NOT NULL
               AND th.freeze_started_at > b.now_at - b.lookback - interval '1 hour'
               AND th.freeze_started_at <= t.start_time + interval '5 seconds'
               AND th.release_target_at > t.start_time
               AND th.release_target_at <= th.freeze_started_at + interval '12 minutes'
          ) w
      ) mw ON true
      LEFT JOIN LATERAL (
        -- The event's earliest recorded hands; the earliest deal among them is
        -- its first hand. Rows are written at hand end, so take a few.
        SELECT min(x.created_at) AS first_created, min(x.started_at) AS first_started
          FROM (SELECT h.created_at, h.started_at
                  FROM public.hand_history h
                 WHERE h.tournament_id = t.id
                 ORDER BY h.created_at ASC
                 LIMIT 20) x
      ) f ON true
     WHERE t.start_time > b.now_at - b.lookback
       AND t.start_time < b.now_at - b.late
       AND t.format_contract IN ('mtt-v1','mtt-v2')
       AND t.status <> 'CANCELLED'
  ),
  m AS (
    SELECT
      c.first_created IS NOT NULL
        AND c.first_created > b.now_at - b.win
        AND c.first_started > c.effective_start_time + b.late AS late_dealt,
      c.first_created IS NULL
        AND c.status IN ('ANNOUNCED','REGISTERING','RUNNING')
        AND c.effective_start_time < b.now_at - b.late - b.headroom AS late_waiting,
      CASE WHEN c.first_created IS NULL THEN b.now_at - c.effective_start_time
           ELSE c.first_started - c.effective_start_time END AS lateness
      FROM c CROSS JOIN b
  )
  SELECT count(*) FILTER (WHERE m.late_dealt)::integer,
         count(*) FILTER (WHERE m.late_waiting)::integer,
         COALESCE(max(extract(epoch FROM m.lateness))
                    FILTER (WHERE m.late_dealt OR m.late_waiting), 0)::integer
    FROM m;
$function$;

COMMENT ON FUNCTION public.fn_tournament_launch_lateness_metrics(integer, integer, integer, integer) IS
  'Read-only launch-lateness gauges for TournamentMetrics: MTTs whose first dealt hand (hand_history.started_at) came over p_late_seconds after effective_start_time (GREATEST(start_time, covering bounded <=12m maintenance thaw with <=5s start-boundary jitter tolerance)), recorded in the last p_window_minutes, and MTTs with no recorded hand p_late_seconds + p_headroom_seconds after effective_start_time. 2026-10-19; bounded maintenance thaw + jitter tolerance 2026-11-28.';

REVOKE ALL ON FUNCTION public.fn_tournament_launch_lateness_metrics(integer, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tournament_launch_lateness_metrics(integer, integer, integer, integer) TO service_role;

-- @probe-for: public.fn_tournament_launch_lateness_metrics
DO $probe$
DECLARE
  r record;
BEGIN
  SELECT * INTO r FROM public.fn_tournament_launch_lateness_metrics(120, 120, 15, 24);
  IF r.late_first_hands IS NULL OR r.late_waiting IS NULL OR r.worst_late_seconds IS NULL THEN
    RAISE EXCEPTION 'MTT_LATENESS_PROBE returned NULL scalar';
  END IF;
  IF position('interval ''5 seconds''' IN pg_get_functiondef('public.fn_tournament_launch_lateness_metrics(integer,integer,integer,integer)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'MTT_LATENESS_PROBE missing 5s boundary jitter tolerance';
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
