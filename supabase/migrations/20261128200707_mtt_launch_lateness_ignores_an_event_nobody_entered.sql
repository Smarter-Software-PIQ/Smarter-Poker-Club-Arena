-- 20261128200707_mtt_launch_lateness_ignores_an_event_nobody_entered
--
-- Reserved by scripts/new-migration.mjs on 2026-11-28 20:07:07 UTC.
-- Production Alerts rows 450128 / 450194, incident mtt-started-late-cutover-hour,
-- engine incident 334c611e-ec44-4006-b557-0ea8a66a1b8c.
--
-- First drafted as 20261128160858 (PR #12376), which also widened the
-- maintenance-freeze credit to the late bar because every cutover freeze is
-- stamped 1 ms after the boundary (16:00:00.001 for a 16:00:00 start). While
-- it was in review, 20261128161915 (#12377, merged 19:11Z) fixed that cause
-- by allowing the freeze to begin up to 5 s after t.start_time, which covers
-- every observed stamp (.001). The older 160858 version would have installed
-- after 161915 and replaced its body. So this file is re-versioned after
-- 161915, builds on its installed body (preimage md5
-- 19533b7bf3421c6bbbf2e4b1560564f6, computed on PG16 from the #12377 file; the
-- same method reproduces #12377's own pinned preimage
-- 31cdd1ce751effd17cd335d30f60e840 from 20261128075041), keeps #12377's
-- 5-second predicate byte for byte, and adds only the change below.
--
-- AN EVENT NOBODY ENTERED IS NOT A LATE LAUNCH (same incident, read live
-- 2026-11-28T19:07Z, row 450194). Every 19:05Z MttStartedLate since 11-24 read
-- "2 MTT(s)" and resolved to "1" at ~19:31Z. The second event is the daily
-- "Daily 25 Chip Freezeout" of the one-member pilot club 652f121d (min_players
-- 3, 0 entrants, no horse in its pool): df0cc4ad sat REGISTERING with no
-- tournament_players row and current_players 0, and late_waiting counted it
-- from start + 240 s until the engine's empty-event rule
-- (server/src/tournament/emptyPastStartEvent.ts, 2026-10-15) cancelled it at
-- start + 30 m (876d20ee 19:32:24Z, 5d264f3a 19:30:23Z, 3c2f86c6 19:30:10Z,
-- ff9a92ad 19:30:05Z). An event with no registered or playing entrant has
-- nobody to deal to; it is owned by the empty-event cancel, and
-- fn_tournament_metrics.overdue_start (TournamentNeverStarted) already
-- exempts exactly that shape until start + 30 m + overdue and pages if it is
-- still standing. late_waiting now uses the same entrant test (EXISTS a
-- tournament_players row in 'registered'/'playing', or current_players <> 0),
-- so an event with even one entrant still alerts at start + 240 s, and an
-- empty event that the cancel never reaches is still paged by
-- TournamentNeverStarted. late_dealt is unchanged: a dealt event had entrants.
--
-- Function body only: no table lock, no data mutation, exact signature and
-- grants preserved.
--
-- @live-proof: (SELECT position('<= t.start_time + interval ''5 seconds''' IN pg_get_functiondef('public.fn_tournament_launch_lateness_metrics(integer,integer,integer,integer)'::regprocedure)) > 0 AND position('AND c.has_entrant' IN pg_get_functiondef('public.fn_tournament_launch_lateness_metrics(integer,integer,integer,integer)'::regprocedure)) > 0 AND position('effective_start_time' IN pg_get_functiondef('public.fn_tournament_launch_lateness_metrics(integer,integer,integer,integer)'::regprocedure)) > 0)

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
  IF md5(v_def) IS DISTINCT FROM '19533b7bf3421c6bbbf2e4b1560564f6' THEN
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
           (COALESCE(t.current_players, 0) <> 0
             OR EXISTS (SELECT 1 FROM public.tournament_players tp
                         WHERE tp.tournament_id = t.id
                           AND tp.status IN ('registered','playing'))) AS has_entrant,
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
      -- An event with no entrant is the empty-event cancel's
      -- (emptyPastStartEvent.ts) and TournamentNeverStarted's, not a late launch.
      c.first_created IS NULL
        AND c.has_entrant
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
  'Read-only launch-lateness gauges for TournamentMetrics: MTTs whose first dealt hand (hand_history.started_at) came over p_late_seconds after effective_start_time (GREATEST(start_time, thaw of a bounded <=12m maintenance freeze that began by start_time + 5 s and ended after start_time)), recorded in the last p_window_minutes, and MTTs with at least one registered or playing entrant and no recorded hand p_late_seconds + p_headroom_seconds after effective_start_time (an event nobody entered is left to the empty-event cancel and TournamentNeverStarted). 2026-10-19; bounded maintenance thaw 2026-11-28; 5 s freeze start jitter 2026-11-28 (#12377, row 450128); empty events excluded from late_waiting 2026-11-28 (row 450194).';

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
