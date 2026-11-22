-- 20261122002835_three_hourly_break_scorecard_and_weekly_report.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
-- Enhancement E6 (three-hourly cutover follow-up for break observability):
-- 1. public.fn_ca_record_break_scorecard(timestamptz): preserves grading of
--    every break that actually ran via engine_maintenance_break_log, and in
--    the break_never_started fallback detects whether the last 24 hours of
--    engine_maintenance_break_log show three-hourly cadence (any scheduled
--    Chicago start hour in {1, 7, 10, 13, 16, 19, 22}, which also holds when
--    >= 2 distinct hours in {1, 4, 7, 10, 13, 16, 19, 22} ran). When active,
--    the fallback checks the :05 end of the most recent Chicago cycle hour in
--    {1, 4, 7, 10, 13, 16, 19, 22} within the last hour (excluding the
--    repeated 01:00 CST hour on fall-back day); otherwise it preserves the
--    daily 04:05 America/Chicago anchor.
-- 2. public.fn_maintenance_week_report(integer): detects observed_cadence
--    ('three-hourly' vs 'daily') and expected_breaks_per_day (8 vs 1) from
--    actual break/thaw rows in the window, aligns dealing_by_minute with the
--    :00-:04 Chicago break shape, and replaces the stale 24*window_days hourly
--    wording in breaks_without_thaw_note.
--
-- @live-proof: (SELECT position('1, 7, 10, 13, 16, 19, 22' IN pg_get_functiondef('public.fn_ca_record_break_scorecard(timestamptz)'::regprocedure)) > 0 AND position('observed_cadence' IN pg_get_functiondef('public.fn_maintenance_week_report(integer)'::regprocedure)) > 0 AND position('24*window_days' IN pg_get_functiondef('public.fn_maintenance_week_report(integer)'::regprocedure)) = 0)

BEGIN;
SET LOCAL lock_timeout = '4s';
SET LOCAL statement_timeout = '30s';

DO $preimage$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.fn_ca_record_break_scorecard(timestamptz)'::regprocedure)
     <> '4298c5abee924b6d3eff5661535ddd66' THEN
    RAISE EXCEPTION 'fn_ca_record_break_scorecard preimage changed; requalify';
  END IF;

  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.fn_maintenance_week_report(integer)'::regprocedure)
     NOT IN ('3493b914673c667c68e8962427895405', '995de83c56f6d5d6977e675ba788937b') THEN
    RAISE EXCEPTION 'fn_maintenance_week_report preimage changed; requalify';
  END IF;
END;
$preimage$;

CREATE OR REPLACE FUNCTION public.fn_ca_record_break_scorecard(
  p_end timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS ca_break_scorecards
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_end   TIMESTAMPTZ := p_end;
  v_start TIMESTAMPTZ;
  v_observed_at TIMESTAMPTZ := now();
  -- The window actually measured. Equal to [v_start, v_end) only when no
  -- break log row can be found.
  v_meas_start TIMESTAMPTZ;
  v_meas_end   TIMESTAMPTZ;
  v_brk   RECORD;
  v_hands INTEGER; v_wtabs INTEGER;
  v_thaw  RECORD; v_kill INTEGER; v_base INTEGER; v_rec INTEGER;
  v_ship  RECORD; v_pre NUMERIC; v_post NUMERIC; v_conserved BOOLEAN; v_delta NUMERIC;
  v_verdict TEXT; v_row public.ca_break_scorecards; m INTEGER;
  v_early_s NUMERIC; v_late_start_s NUMERIC; v_covered BOOLEAN; v_reasons TEXT[] := '{}';
  -- A break that never started, and what the engine said about it. Scalars
  -- rather than a RECORD on purpose: a record that is only ever SELECTed INTO
  -- inside an IF is "not assigned yet" on every hour that takes the other
  -- branch, and the INSERT below reads these on every hour.
  v_never_started BOOLEAN;
  v_fault_stage TEXT; v_fault_outcome TEXT; v_fault_error TEXT;
  -- The tables recovery is measured over: dealing before the break, still open.
  v_base_ids UUID[];
  c_max_hands CONSTANT INTEGER := 50;
  -- How far the break may miss its scheduled 5-minute shape before that is a
  -- finding. Observed healthy breaks start within a few seconds of the edge,
  -- so a 30-second allowance is generous against measured behaviour and still
  -- catches an early resume.
  c_edge_tolerance_s CONSTANT NUMERIC := 30;
BEGIN
  -- No global break was due: continuous cash play is healthy, not a failed thaw.
  IF v_end IS NULL THEN
  -- DAILY_OBSERVATION_SELECTION_BEGIN
  SELECT COALESCE(
    (SELECT b.break_started_at + interval '5 minutes'
       FROM public.engine_maintenance_break_log b
      WHERE b.break_ended_at IS NOT NULL
        AND b.break_started_at + interval '5 minutes' <= v_observed_at
        AND b.break_started_at + interval '5 minutes' > v_observed_at - interval '1 hour'
      ORDER BY b.break_started_at DESC LIMIT 1),
    (SELECT expected_end FROM (
      SELECT cand_utc + interval '5 minutes' AS expected_end
        FROM (
          SELECT generate_series(
                   date_trunc('hour', v_observed_at) - interval '1 hour',
                   date_trunc('hour', v_observed_at),
                   interval '1 hour'
                 ) AS cand_utc
        ) hrs
       WHERE (
         CASE
           WHEN EXISTS (
             SELECT 1
               FROM public.engine_maintenance_break_log r
              WHERE r.break_started_at <= v_observed_at
                AND r.break_started_at > v_observed_at - interval '24 hours'
                AND EXTRACT(MINUTE FROM ((r.break_started_at + interval '3 minutes') AT TIME ZONE 'America/Chicago'))::int <= 6
                AND EXTRACT(HOUR FROM ((r.break_started_at + interval '3 minutes') AT TIME ZONE 'America/Chicago'))::int IN (1, 7, 10, 13, 16, 19, 22)
           ) THEN EXTRACT(HOUR FROM (cand_utc AT TIME ZONE 'America/Chicago'))::int IN (1, 4, 7, 10, 13, 16, 19, 22)
           ELSE EXTRACT(HOUR FROM (cand_utc AT TIME ZONE 'America/Chicago'))::int = 4
         END
       )
       AND NOT (
         EXTRACT(HOUR FROM (cand_utc AT TIME ZONE 'America/Chicago'))::int = 1
         AND EXTRACT(HOUR FROM ((cand_utc - interval '1 hour') AT TIME ZONE 'America/Chicago'))::int = 1
       )
    ) d
    WHERE expected_end <= v_observed_at
      AND expected_end > v_observed_at - interval '1 hour'
    ORDER BY expected_end DESC
    LIMIT 1)
  ) INTO v_end;
  -- DAILY_OBSERVATION_SELECTION_END
  END IF;
  IF v_end IS NULL THEN RETURN NULL; END IF;
  v_start := v_end - interval '5 minutes';
  -- THE BREAK THAT ACTUALLY RAN. Read first, because it defines the window
  -- everything else is measured over.
  SELECT break_started_at, break_ended_at, unparked_at_countdown, peak_unparked,
         ready_for_restart_at
    INTO v_brk
    FROM public.engine_maintenance_break_log
   WHERE break_started_at BETWEEN v_start - interval '3 min' AND v_start + interval '3 min'
   ORDER BY recorded_at DESC LIMIT 1;

  IF v_brk.break_started_at IS NOT NULL AND v_brk.break_ended_at IS NOT NULL THEN
    v_meas_start := v_brk.break_started_at;
    v_meas_end   := v_brk.break_ended_at;
    -- Seconds the break finished BEFORE its scheduled end.
    v_early_s := GREATEST(0, EXTRACT(EPOCH FROM (v_end - v_brk.break_ended_at)));
    -- Seconds the break started AFTER its scheduled start.
    v_late_start_s := GREATEST(0, EXTRACT(EPOCH FROM (v_brk.break_started_at - v_start)));
    v_covered := (v_early_s <= c_edge_tolerance_s AND v_late_start_s <= c_edge_tolerance_s);
  ELSE
    v_meas_start := v_start;
    v_meas_end   := v_end;
    v_covered := NULL;  -- unknown, not false: we could not find the break
  END IF;

  -- A BREAK THAT NEVER STARTED (correction c). No break-log row means no
  -- engine ran a break for this window. The engine records why against the
  -- announcement at v_start - 2 min; [v_start - 3 min, v_start] tolerates a
  -- clock a minute out either side.
  v_never_started := (v_brk.break_started_at IS NULL);
  IF v_never_started THEN
    SELECT f.stage, f.outcome, f.error
      INTO v_fault_stage, v_fault_outcome, v_fault_error
      FROM public.engine_maintenance_break_faults f
     WHERE f.announced_at BETWEEN v_start - interval '3 min' AND v_start
     ORDER BY f.recorded_at DESC
     LIMIT 1;
  END IF;

  SELECT count(*), count(DISTINCT table_id) INTO v_hands, v_wtabs
    FROM public.hand_history
   WHERE created_at >= v_meas_start AND created_at < v_meas_end;

  SELECT frozen_seconds, thawed_at INTO v_thaw
    FROM public.engine_maintenance_thaws
   WHERE freeze_started_at BETWEEN v_start - interval '3 min' AND v_start + interval '3 min'
   ORDER BY thawed_at DESC LIMIT 1;

  SELECT count(*) INTO v_kill FROM public.engine_recovery_events
   WHERE event = 'watchdog_kill_rebuild'
     AND event_class = 'automatic_recovery'
     AND created_at >= v_end AND created_at < v_end + interval '5 min';

  -- RECOVERY, OVER THE TABLES THAT CAN COME BACK (correction d). The base is
  -- every table that dealt in the 5-minute window before the drain and is
  -- still open; a tournament table that finished during the break is closed
  -- and will never deal again.
  SELECT array_agg(DISTINCT h.table_id) INTO v_base_ids
    FROM public.hand_history h
    JOIN public.tables t ON t.id = h.table_id
   WHERE h.created_at >= v_end - interval '12 min'
     AND h.created_at <  v_end - interval '7 min'
     AND t.status <> 'closed';
  v_base := COALESCE(cardinality(v_base_ids), 0);
  v_rec := NULL;
  IF v_base > 0 THEN
    FOR m IN 1..10 LOOP
      IF (SELECT count(DISTINCT h.table_id) FROM public.hand_history h
            WHERE h.table_id = ANY (v_base_ids)
              AND h.created_at >= v_end
              AND h.created_at <  v_end + make_interval(mins => m)) >= ceil(v_base * 0.8) THEN
        v_rec := m * 60; EXIT;
      END IF;
    END LOOP;
  END IF;

  -- THE ATTEMPT THAT SHIPPED, IF ONE DID (correction a).
  SELECT target_sha, shipped INTO v_ship FROM public.ca_engine_deploy_attempts
   WHERE at >= v_start AND at < v_end + interval '6 min'
   ORDER BY shipped DESC, at DESC LIMIT 1;

  SELECT total INTO v_pre  FROM public.ca_freeze_circulation_marks WHERE window_hour = v_end AND kind='pre';
  SELECT total INTO v_post FROM public.ca_freeze_circulation_marks WHERE window_hour = v_end AND kind='post';
  IF v_pre IS NOT NULL AND v_post IS NOT NULL THEN
    v_delta := v_post - v_pre;
    v_conserved := (abs(v_delta) <= GREATEST(1.0, COALESCE(v_pre, 0) * 1e-7));
  ELSE v_delta := NULL; v_conserved := NULL; END IF;

  -- == EACH FAILURE UNDER ITS OWN NAME, FOR THE MESSAGE ==
  -- Collected separately from the verdict below, whose single-CASE shape
  -- tests/the-break-clocks-agree.law.test.ts pins.
  IF v_hands IS NOT NULL THEN
    IF v_hands > c_max_hands THEN
      v_reasons := array_append(v_reasons, 'dealt_inside_break');
    END IF;
    IF COALESCE(v_thaw.frozen_seconds, 0) <= 0 THEN
      v_reasons := array_append(v_reasons, 'thaw_did_not_run');
    END IF;
    IF v_covered IS FALSE THEN
      v_reasons := array_append(v_reasons, 'break_missed_its_window');
    END IF;
    IF v_never_started THEN
      v_reasons := array_prepend('break_never_started'::text, v_reasons);
    END IF;
  END IF;

  -- v_covered IS NOT FALSE, deliberately: NULL means no break log row was
  -- found, which is unmeasured, and unmeasured is not failed.
  v_verdict := CASE
    WHEN v_hands IS NULL THEN 'unknown'
    WHEN v_hands <= c_max_hands
     AND COALESCE(v_thaw.frozen_seconds, 0) > 0
     AND v_covered IS NOT FALSE
    THEN 'pass'
    ELSE 'fail' END;

  INSERT INTO public.ca_break_scorecards AS s (
    break_ended_at, break_started_at, hands_in_window, tables_dealing_in_window,
    thaw_ran, thaw_frozen_seconds, kill_rebuilds_after, recovery_seconds,
    pre_break_tables, shipped_sha, shipped, freeze_conserved, freeze_delta, verdict, detail,
    unparked_at_countdown, peak_unparked, ready_for_restart_at, gate_opened)
  VALUES (
    v_end, v_start, v_hands, v_wtabs,
    (v_thaw.frozen_seconds IS NOT NULL), v_thaw.frozen_seconds, v_kill, v_rec,
    v_base, v_ship.target_sha, COALESCE(v_ship.shipped, FALSE), v_conserved, v_delta, v_verdict,
    jsonb_build_object(
      'pre_total', v_pre,
      'post_total', v_post,
      'measured_from', v_meas_start,
      'measured_to', v_meas_end,
      'measured_actual_break', (v_brk.break_started_at IS NOT NULL),
      'covered_the_hour', v_covered,
      'resumed_early_seconds', v_early_s,
      'started_late_seconds', v_late_start_s,
      'never_started', v_never_started,
      'fault_stage', v_fault_stage,
      'fault_outcome', v_fault_outcome,
      'fault_error', v_fault_error,
      'reasons', to_jsonb(v_reasons)),
    v_brk.unparked_at_countdown, v_brk.peak_unparked, v_brk.ready_for_restart_at,
    CASE WHEN v_brk.unparked_at_countdown IS NULL THEN NULL
         ELSE (v_brk.ready_for_restart_at IS NOT NULL OR COALESCE(v_ship.shipped, false)) END)
  ON CONFLICT (break_ended_at) DO UPDATE SET
    hands_in_window = EXCLUDED.hands_in_window,
    tables_dealing_in_window = EXCLUDED.tables_dealing_in_window,
    thaw_ran = EXCLUDED.thaw_ran, thaw_frozen_seconds = EXCLUDED.thaw_frozen_seconds,
    kill_rebuilds_after = EXCLUDED.kill_rebuilds_after, recovery_seconds = EXCLUDED.recovery_seconds,
    pre_break_tables = EXCLUDED.pre_break_tables, shipped_sha = EXCLUDED.shipped_sha,
    shipped = EXCLUDED.shipped, freeze_conserved = EXCLUDED.freeze_conserved,
    freeze_delta = EXCLUDED.freeze_delta, verdict = EXCLUDED.verdict, detail = EXCLUDED.detail,
    unparked_at_countdown = EXCLUDED.unparked_at_countdown, peak_unparked = EXCLUDED.peak_unparked,
    ready_for_restart_at = EXCLUDED.ready_for_restart_at, gate_opened = EXCLUDED.gate_opened,
    recorded_at = now()
  RETURNING * INTO v_row;

  IF v_verdict = 'fail' THEN
    PERFORM public.fn_ca_break_scorecard_push(v_row);
  END IF;
  RETURN v_row;
END $function$;

REVOKE ALL ON FUNCTION public.fn_ca_record_break_scorecard(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_record_break_scorecard(timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_maintenance_week_report(p_days INTEGER DEFAULT 7)
 RETURNS JSONB
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v JSONB;
  v_three_hourly BOOLEAN := FALSE;
  v_cadence TEXT;
  v_expected_per_day INTEGER;
BEGIN
  -- Infer observed cadence from actual break-log and thaw rows in the window:
  -- any scheduled break/freeze starting near a non-04 three-hourly Chicago
  -- slot ({1, 7, 10, 13, 16, 19, 22}) indicates the three-hourly schedule
  -- (8 breaks/day); otherwise report the daily 04:00 Chicago anchor (1/day).
  SELECT (
    EXISTS (
      SELECT 1
        FROM public.engine_maintenance_break_log b
       WHERE b.break_started_at > NOW() - make_interval(days => p_days)
         AND EXTRACT(MINUTE FROM ((b.break_started_at + interval '3 minutes') AT TIME ZONE 'America/Chicago'))::int <= 6
         AND EXTRACT(HOUR FROM ((b.break_started_at + interval '3 minutes') AT TIME ZONE 'America/Chicago'))::int IN (1, 7, 10, 13, 16, 19, 22)
    )
    OR EXISTS (
      SELECT 1
        FROM public.engine_maintenance_thaws t
       WHERE t.thawed_at > NOW() - make_interval(days => p_days)
         AND t.freeze_started_at IS NOT NULL
         AND EXTRACT(MINUTE FROM ((t.freeze_started_at + interval '3 minutes') AT TIME ZONE 'America/Chicago'))::int <= 6
         AND EXTRACT(HOUR FROM ((t.freeze_started_at + interval '3 minutes') AT TIME ZONE 'America/Chicago'))::int IN (1, 7, 10, 13, 16, 19, 22)
    )
  ) INTO v_three_hourly;

  IF v_three_hourly THEN
    v_cadence := 'three-hourly';
    v_expected_per_day := 8;
  ELSE
    v_cadence := 'daily';
    v_expected_per_day := 1;
  END IF;

  SELECT jsonb_build_object(
    'window_days', p_days,
    'generated_at', NOW(),
    'observed_cadence', v_cadence,
    'expected_breaks_per_day', v_expected_per_day,

    -- The thaw ledger is the authoritative record of armed freezes.
    'freezes', (
      SELECT jsonb_build_object(
        'count', COUNT(*),
        'avg_frozen_seconds', ROUND(AVG(frozen_seconds)::numeric, 1),
        'max_frozen_seconds', MAX(frozen_seconds),
        'min_frozen_seconds', MIN(frozen_seconds),
        'over_360s', COUNT(*) FILTER (WHERE frozen_seconds > 360),
        'total_shifted', (
          SELECT jsonb_object_agg(k, s) FROM (
            SELECT e.key AS k, SUM((e.value #>> '{}')::bigint) AS s
            FROM public.engine_maintenance_thaws t,
                 LATERAL jsonb_each(
                   CASE WHEN jsonb_typeof(t.shifted) = 'object' THEN t.shifted ELSE '{}'::jsonb END
                 ) e
            WHERE t.thawed_at > NOW() - make_interval(days => p_days)
              AND jsonb_typeof(e.value) = 'number'
              AND (e.value #>> '{}') ~ '^-?[0-9]+$'
            GROUP BY e.key
          ) agg
        )
      )
      FROM public.engine_maintenance_thaws
      WHERE thawed_at > NOW() - make_interval(days => p_days)
    ),

    -- Scheduled-cycle dealing shape around Chicago :00-:04 breaks:
    -- :53-:57 before drain, :58-:59 last-hand drain, :00-:04 break,
    -- :05-:09 post-break recovery.
    'dealing_by_minute', (
      SELECT jsonb_object_agg(bucket, hands) FROM (
        SELECT
          CASE
            WHEN (
              (v_three_hourly AND EXTRACT(HOUR FROM (created_at AT TIME ZONE 'America/Chicago'))::int IN (0, 3, 6, 9, 12, 15, 18, 21))
              OR (NOT v_three_hourly AND EXTRACT(HOUR FROM (created_at AT TIME ZONE 'America/Chicago'))::int = 3)
            ) AND EXTRACT(MINUTE FROM (created_at AT TIME ZONE 'America/Chicago'))::int BETWEEN 53 AND 57 THEN 'before_53_57'
            WHEN (
              (v_three_hourly AND EXTRACT(HOUR FROM (created_at AT TIME ZONE 'America/Chicago'))::int IN (0, 3, 6, 9, 12, 15, 18, 21))
              OR (NOT v_three_hourly AND EXTRACT(HOUR FROM (created_at AT TIME ZONE 'America/Chicago'))::int = 3)
            ) AND EXTRACT(MINUTE FROM (created_at AT TIME ZONE 'America/Chicago'))::int BETWEEN 58 AND 59 THEN 'last_hand_58_59'
            WHEN (
              (v_three_hourly AND EXTRACT(HOUR FROM (created_at AT TIME ZONE 'America/Chicago'))::int IN (1, 4, 7, 10, 13, 16, 19, 22))
              OR (NOT v_three_hourly AND EXTRACT(HOUR FROM (created_at AT TIME ZONE 'America/Chicago'))::int = 4)
            ) AND EXTRACT(MINUTE FROM (created_at AT TIME ZONE 'America/Chicago'))::int BETWEEN 0 AND 4 THEN 'break_00_04'
            WHEN (
              (v_three_hourly AND EXTRACT(HOUR FROM (created_at AT TIME ZONE 'America/Chicago'))::int IN (1, 4, 7, 10, 13, 16, 19, 22))
              OR (NOT v_three_hourly AND EXTRACT(HOUR FROM (created_at AT TIME ZONE 'America/Chicago'))::int = 4)
            ) AND EXTRACT(MINUTE FROM (created_at AT TIME ZONE 'America/Chicago'))::int BETWEEN 5 AND 9 THEN 'after_05_09'
            ELSE NULL
          END AS bucket,
          COUNT(*) AS hands
        FROM public.hand_history
        WHERE created_at > NOW() - make_interval(days => p_days)
        GROUP BY 1
      ) b WHERE bucket IS NOT NULL
    ),

    'breaks_without_thaw_note',
      CASE
        WHEN v_three_hourly THEN
          'compare freezes.count against 8*window_days (three-hourly America/Chicago schedule: 01, 04, 07, 10, 13, 16, 19, 22) minus skipped windows; a shortfall means end() or the thaw is failing'
        ELSE
          'compare freezes.count against 1*window_days (daily 04:00 America/Chicago anchor) minus skipped windows; a shortfall means end() or the thaw is failing'
      END
  ) INTO v;
  RETURN v;
END $function$;

COMMENT ON FUNCTION public.fn_maintenance_week_report(INTEGER) IS
  'The maintenance break''s weekly self-report: observed cadence (three-hourly 8/day vs daily 1/day), freeze counts and durations, thaw shift totals, and the scheduled Chicago :00-:04 dealing dip shape. Read-only; service_role only.';

REVOKE ALL ON FUNCTION public.fn_maintenance_week_report(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_maintenance_week_report(INTEGER) TO service_role;

-- @probe-for: public.fn_ca_record_break_scorecard
DO $probe$
BEGIN
  PERFORM public.fn_ca_record_break_scorecard(NULL);
  PERFORM public.fn_ca_record_break_scorecard('2020-01-01 09:05:00+00'::timestamptz);
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_maintenance_week_report
DO $probe$
DECLARE
  v_report JSONB;
BEGIN
  v_report := public.fn_maintenance_week_report(7);
  IF v_report IS NULL
     OR NOT (v_report ? 'observed_cadence')
     OR NOT (v_report ? 'expected_breaks_per_day') THEN
    RAISE EXCEPTION 'fn_maintenance_week_report probe returned unexpected payload: %', v_report;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
