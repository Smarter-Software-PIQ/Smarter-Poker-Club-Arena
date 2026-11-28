-- 20261128160858_mtt_launch_lateness_freeze_starting_at_the_start_minute
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-28 16:08:58 UTC.
--
-- A MAINTENANCE FREEZE THAT BEGINS AT THE START MINUTE COVERS THE START
-- (2026-11-28, Production Alerts row 450128, incident mtt-started-late-cutover-hour,
-- engine incident 334c611e-ec44-4006-b557-0ea8a66a1b8c).
--
-- WHAT WAS WRONG (read live 2026-11-28T16:06Z).
-- 20261128075041 credited a bounded maintenance thaw only when the freeze
-- began AT OR BEFORE t.start_time (l.break_started_at <= t.start_time,
-- th.freeze_started_at <= t.start_time). The cutover freeze is opened by the
-- engine on the boundary and is stamped a millisecond after it:
--   engine_maintenance_break_log  16:00:00.001 -> 16:05:00.149
--   engine_maintenance_thaws (v3) 16:00:00.001 -> 16:05:00.001 complete
-- while the fixed-board MTT "Mid-Morning Turbo (6-Max NLH)" 5d4aeb41 has
-- start_time 16:00:00.000 and dealt its first hand at 16:05:01.156. The freeze
-- missed the start by 1 ms, so the fix never matched, effective_start_time
-- stayed 16:00:00, and fn_tournament_launch_lateness_metrics(120,120,15,24)
-- returned (1, 0, 301): MttStartedLate fired at 16:05:26Z, the first cutover
-- start after the fix was installed. Every cutover freeze is opened this way
-- (13:00:00.001, 16:00:00.001 in the same log), so the fix could never match
-- an on-the-hour start.
--
-- WHAT THIS CHANGES.
-- A bounded (<= 12 minute) completed freeze is credited when it began no later
-- than the late bar after t.start_time (freeze_start <= t.start_time + late)
-- and ended after t.start_time. A freeze that begins before an event could be
-- called late is what stopped it dealing; measuring from its thaw is the same
-- rule 20261128075041 meant to state, without depending on the millisecond the
-- freeze was stamped. Everything else is byte-for-byte 20261128075041: the
-- 12 minute cap, the 120 s late bar and headroom, the v3 completeness test,
-- and full alerting for a post-thaw stall, a non-break late launch and an
-- unbounded freeze.
--
-- Measured with the new predicate against the live rows above: the event's
-- effective start is 16:05:00.149 and its first hand is 1 s after it, so it
-- is not late. Native proof (PG16, both definitions, same fixtures):
-- docs/production-alerts/evidence/450128-mtt-late-freeze-boundary/.
--
-- Function body only: no table lock, no data mutation, exact signature and
-- grants preserved.
--
-- @live-proof: (SELECT position('<= t.start_time + b.late' IN pg_get_functiondef('public.fn_tournament_launch_lateness_metrics(integer,integer,integer,integer)'::regprocedure)) > 0 AND position('effective_start_time' IN pg_get_functiondef('public.fn_tournament_launch_lateness_metrics(integer,integer,integer,integer)'::regprocedure)) > 0)

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
        -- began no later than the late bar after t.start_time and ended after
        -- it prevents any table from dealing until the thaw. The engine stamps
        -- a cutover freeze just after the boundary (16:00:00.001 for a 16:00
        -- start), so "began at or before t.start_time" never matched.
        -- Measure launch lateness from that thaw boundary; unbounded freezes
        -- (> 12 m) and post-thaw delays > p_late_seconds still alert.
        SELECT max(w.freeze_end) AS thaw_at
          FROM (
            SELECT l.break_ended_at AS freeze_end
              FROM public.engine_maintenance_break_log l
             WHERE l.break_started_at > b.now_at - b.lookback - interval '1 hour'
               AND l.break_started_at <= t.start_time + b.late
               AND l.break_ended_at > t.start_time
               AND l.break_ended_at <= l.break_started_at + interval '12 minutes'
            UNION ALL
            SELECT th.release_target_at AS freeze_end
              FROM public.engine_maintenance_thaws th
             WHERE th.contract_version = 3
               AND COALESCE((th.shifted->>'complete')::boolean, false)
               AND th.freeze_started_at IS NOT NULL
               AND th.freeze_started_at > b.now_at - b.lookback - interval '1 hour'
               AND th.freeze_started_at <= t.start_time + b.late
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
  'Read-only launch-lateness gauges for TournamentMetrics: MTTs whose first dealt hand (hand_history.started_at) came over p_late_seconds after effective_start_time (GREATEST(start_time, thaw of a bounded <=12m maintenance freeze that began by start_time + p_late_seconds and ended after start_time)), recorded in the last p_window_minutes, and MTTs with no recorded hand p_late_seconds + p_headroom_seconds after effective_start_time. 2026-10-19; bounded maintenance thaw 2026-11-28; freeze beginning within the late bar after start_time 2026-11-28 (row 450128).';

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
