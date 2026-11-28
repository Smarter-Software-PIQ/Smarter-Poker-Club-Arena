-- 20261128075041_mtt_launch_lateness_measures_from_bounded_maintenance_thaw
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-28.
--
-- MTT LAUNCH LATENESS MEASURES FROM A BOUNDED MAINTENANCE THAW (2026-11-28).
--
-- Incident 334c611e-ec44-4006-b557-0ea8a66a1b8c (MttStartedLate, 56 occurrences /
-- 52 recurrences):
--
-- WHAT WAS WRONG (proven live over 7 days, 2026-11-21 to 2026-11-28).
-- On 2026-11-21 the owner moved routine engine cutovers to a three-hourly
-- schedule at 01, 04, 07, 10, 13, 16, 19 and 22 America/Chicago (:00-:05,
-- maintenanceSchedulePolicy.json). Fixed-board MTTs scheduled on the hour at
-- 10:00, 13:00, 16:00, 19:00 and 22:00 America/Chicago (16:00, 19:00, 22:00,
-- 01:00 and 04:00 UTC) pre-seat ahead of :58, wait through the total 5-minute
-- platform freeze, and deal their first hand 1-3 seconds after the :05:00 thaw
-- (:05:01-:05:03, +301 to +303 s after start_time).
--
-- 33 of 33 MttStartedLate firings across the six days since 2026-11-21 22:00Z
-- were these exact :00 maintenance-slot starts dealing 1-3 s after thaw; zero
-- MTTs outside maintenance windows started late.
--
-- fn_tournament_launch_lateness_metrics (20261019223841, written when breaks
-- were :55-:00 before :00 starts) subtracted t.start_time without accounting
-- for a bounded completed platform maintenance freeze covering t.start_time.
--
-- WHAT THIS CHANGES:
--   * For each MTT t, if a bounded (<= 12 minutes) completed maintenance freeze
--     recorded in public.engine_maintenance_break_log or complete v3
--     public.engine_maintenance_thaws covered t.start_time
--     (freeze_started_at <= t.start_time AND freeze_ended_at > t.start_time),
--     effective_start_time = GREATEST(t.start_time, freeze_ended_at); otherwise
--     effective_start_time = t.start_time.
--   * late_dealt, late_waiting, and worst_late_seconds measure from
--     effective_start_time using the exact same 120 s late bar and 120 s
--     headroom. An MTT that stalls >120 s after the thaw, an MTT outside a
--     maintenance break, or an MTT caught in an unbounded (>12 m) freeze still
--     fires MttStartedLate identically.
--
-- Function body only: no table lock, no data mutation, exact signature and
-- grants preserved.
--
-- @live-proof: (SELECT position('effective_start_time' IN pg_get_functiondef('public.fn_tournament_launch_lateness_metrics(integer,integer,integer,integer)'::regprocedure)) > 0 AND position('engine_maintenance_thaws' IN pg_get_functiondef('public.fn_tournament_launch_lateness_metrics(integer,integer,integer,integer)'::regprocedure)) > 0 AND position('engine_maintenance_break_log' IN pg_get_functiondef('public.fn_tournament_launch_lateness_metrics(integer,integer,integer,integer)'::regprocedure)) > 0)

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
  IF md5(v_def) IS DISTINCT FROM 'd4653d96547d94ac68342141e71b360e' THEN
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
        -- covered t.start_time prevents any table from dealing until the thaw.
        -- Measure launch lateness from that thaw boundary; unbounded freezes
        -- (> 12 m) and post-thaw delays > p_late_seconds still alert.
        SELECT max(w.freeze_end) AS thaw_at
          FROM (
            SELECT l.break_ended_at AS freeze_end
              FROM public.engine_maintenance_break_log l
             WHERE l.break_started_at > b.now_at - b.lookback - interval '1 hour'
               AND l.break_started_at <= t.start_time
               AND l.break_ended_at > t.start_time
               AND l.break_ended_at <= l.break_started_at + interval '12 minutes'
            UNION ALL
            SELECT th.release_target_at AS freeze_end
              FROM public.engine_maintenance_thaws th
             WHERE th.contract_version = 3
               AND COALESCE((th.shifted->>'complete')::boolean, false)
               AND th.freeze_started_at IS NOT NULL
               AND th.freeze_started_at > b.now_at - b.lookback - interval '1 hour'
               AND th.freeze_started_at <= t.start_time
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
  'Read-only launch-lateness gauges for TournamentMetrics: MTTs whose first dealt hand (hand_history.started_at) came over p_late_seconds after effective_start_time (GREATEST(start_time, covering bounded <=12m maintenance thaw)), recorded in the last p_window_minutes, and MTTs with no recorded hand p_late_seconds + p_headroom_seconds after effective_start_time. 2026-10-19; bounded maintenance thaw 2026-11-28.';

REVOKE ALL ON FUNCTION public.fn_tournament_launch_lateness_metrics(integer, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tournament_launch_lateness_metrics(integer, integer, integer, integer) TO service_role;

DO $probe$
DECLARE
  r record;
BEGIN
  SELECT * INTO r FROM public.fn_tournament_launch_lateness_metrics(120, 120, 15, 24);
  IF r.late_first_hands IS NULL OR r.late_waiting IS NULL OR r.worst_late_seconds IS NULL THEN
    RAISE EXCEPTION 'MTT_LATENESS_PROBE returned NULL scalar';
  END IF;
END $probe$;

COMMIT;
