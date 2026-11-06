-- THE HORSE DAILY AUDIT KEEPS ITS FAILURES, ITS ANALYSIS AND ITS PROVENANCE
-- (2026-11-05, phase 2 of the Nov 1-4 audit outage).
--
-- What happened. The 2026-10-31 variant-mix edit aliased horse_review_rollup
-- as "r" inside fn_run_horse_daily_audit, whose loop record is also "r", so
-- "r.game_variant" resolved to the unassigned PL/pgSQL record and every run
-- from 2026-11-01 raised `record "r" is not assigned yet` (cron job 373
-- failed 11-02..11-05 07:30Z with exactly that context). 20261105172255 fixed
-- the alias and added a watchdog; 20261105202216 taught it lost analysis.
-- Both were applied directly during the outage without a transaction; their
-- exact SQL is kept, wrapped and marked SUPERSEDED BY this file, as
-- 20261105230744 and 20261105230750 (see applied-migration-aliases.json).
--
-- What was still wrong, and what this changes:
--  1. A failed attempt left no record of its own. horse_daily_audit_runs now
--     holds every watchdog, fallback and backfill attempt (day, run id,
--     stage, status, error, SQLSTATE, context, attempt number), written in
--     the caller's transaction after the audit's subtransaction rolled back,
--     so the evidence survives the failure.
--  2. fn_horse_audit_set_agent_analysis returned void and either wrote a
--     placeholder audit row (stats '{}', which a reader could take for an
--     audit) or replaced whatever analysis was stored. It now returns an
--     explicit result, keeps every submission in
--     horse_daily_audit_analysis_submissions, holds an analysis that arrives
--     before its machine audit as pending (no placeholder row), attaches it
--     the moment the audit row is written (trigger), and never overwrites a
--     stored analysis: a differing later submission is kept in the log with
--     outcome retained_existing.
--  3. A backfilled day was indistinguishable from a day run on time, and the
--     checks that read live state (data receipts, fleet health, tuner
--     health, seat clock, solver liveness) silently described the backfill
--     moment. Every row now carries stats.provenance (calc version, run id,
--     run time, scheduled vs backfill, UTC period, engine versions seen that
--     day, source coverage), and in a backfill those sections' findings are
--     marked evaluated_at_run_time.
--  4. The day boundary was the caller's session TimeZone. The function is
--     pinned to UTC, the boundary the schedule has always used.
--  5. The watchdog retried forever with no budget and the fallback wrote a
--     placeholder row. Retries are bounded (6 per day per 7 days), each one
--     is a run row, alerts stay one per day and kind, and
--     fn_horse_daily_audit_watch_status() reports per day missing / failed /
--     running / pending / recovered / completed for the panel and for the
--     outside check that also covers "database unreachable". The watchdog
--     and fallback lose the browser EXECUTE grant the first watchdog shipped
--     with: only the cron and service_role run them.
--  6. The silence detectors warned every day about short deck, pineapple and
--     PLO8 layers on days those hand types dealt nothing. A counted stage gate
--     (fn_horse_audit_stage_gate) turns exactly those into layer_no_stage
--     notes while the day's hand count for that type is zero.
--  7. League legality: illegal_actions silently included truncated streets,
--     and the harness's own coercions and the brain's exception fallback were
--     never counted. New nullable columns (null = not measured) carry them and
--     the build commit, and the audit judges truncations on their own.
-- @live-proof: to_regclass('public.horse_daily_audit_runs') IS NOT NULL AND position('horse.audit_run_id' in pg_get_functiondef('public.fn_run_horse_daily_audit(date)'::regprocedure)) > 0 AND position('pending_machine_audit' in pg_get_functiondef('public.fn_horse_audit_set_agent_analysis(date,jsonb)'::regprocedure)) > 0 AND position('fn_horse_audit_stage_gate' in pg_get_functiondef('public.fn_run_horse_daily_audit(date)'::regprocedure)) > 0
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- League legality evidence that was missing (2026-11-05). Null on rows written
-- by builds before this change: not measured, never zero.
ALTER TABLE public.horse_league_results
  ADD COLUMN IF NOT EXISTS harness_corrected_actions integer,
  ADD COLUMN IF NOT EXISTS brain_exception_fallbacks integer,
  ADD COLUMN IF NOT EXISTS engine_sha text;

CREATE TABLE IF NOT EXISTS public.horse_daily_audit_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day          date NOT NULL,
  run_source   text NOT NULL CHECK (run_source IN ('watchdog','fallback','backfill','manual')),
  stage        text NOT NULL CHECK (stage IN ('machine_audit','analysis_persist','watchdog_pass')),
  status       text NOT NULL CHECK (status IN ('running','succeeded','failed','skipped')),
  attempt      integer NOT NULL DEFAULT 1,
  started_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at  timestamptz,
  error        text,
  error_state  text,
  calc_version text,
  reason       text,
  details      jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS horse_daily_audit_runs_day_idx ON public.horse_daily_audit_runs (day, started_at DESC);
CREATE INDEX IF NOT EXISTS horse_daily_audit_runs_stage_idx ON public.horse_daily_audit_runs (stage, started_at DESC);
ALTER TABLE public.horse_daily_audit_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.horse_daily_audit_runs FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.horse_daily_audit_runs TO service_role;

CREATE TABLE IF NOT EXISTS public.horse_daily_audit_analysis_submissions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day          date NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  submitted_by text NOT NULL DEFAULT current_user,
  analysis     jsonb NOT NULL,
  analysis_md5 text GENERATED ALWAYS AS (md5(analysis::text)) STORED,
  outcome      text NOT NULL CHECK (outcome IN ('stored','pending_machine_audit','attached_after_audit','duplicate','retained_existing')),
  outcome_at   timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS horse_daily_audit_analysis_submissions_day_idx
  ON public.horse_daily_audit_analysis_submissions (day, submitted_at DESC);
ALTER TABLE public.horse_daily_audit_analysis_submissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.horse_daily_audit_analysis_submissions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.horse_daily_audit_analysis_submissions TO service_role;

-- Findings from a section that reads live state, run after the day closed,
-- say so instead of passing for history.
CREATE OR REPLACE FUNCTION public.fn_horse_audit_mark_run_time(p_findings jsonb, p_day date, p_section text)
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public' AS $f$
  SELECT CASE
    WHEN p_findings IS NULL THEN '[]'::jsonb
    WHEN jsonb_typeof(p_findings) <> 'array' THEN p_findings
    WHEN now() <= ((p_day + interval '1 day 12 hours') AT TIME ZONE 'UTC') THEN p_findings
    ELSE coalesce((
      SELECT jsonb_agg(CASE WHEN jsonb_typeof(f) = 'object'
               THEN f || jsonb_build_object('evaluated_at_run_time', true, 'run_time_section', p_section,
                 'run_time_note', 'This audit ran after the day closed. This check reads live state at run time, not the historical day.')
               ELSE f END ORDER BY o)
        FROM jsonb_array_elements(p_findings) WITH ORDINALITY e(f, o)), '[]'::jsonb)
  END
$f$;
REVOKE ALL ON FUNCTION public.fn_horse_audit_mark_run_time(jsonb,date,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_horse_audit_mark_run_time(jsonb,date,text) TO service_role;

-- A layer that belongs to one hand type cannot fire on a day that hand type
-- dealt nothing. Counted from horse_daily_nets, not assumed: since the Nov 2
-- 2026 cash policy, short deck, pineapple and PLO8 deal no horse cash hands,
-- and 48 of the 85 layer_went_silent warnings on 2026-11-04 were those layers.
-- The finding turns back into its original warning on its own the first day
-- that hand type deals a hand again.
CREATE OR REPLACE FUNCTION public.fn_horse_audit_stage_gate(p_findings jsonb, p_day date)
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public' AS $f$
  WITH f AS (
    SELECT e.f, e.o,
           substring(e.f->'evidence'->>'feature' from '(short_deck|pineapple|plo8)') AS variant
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_findings) = 'array' THEN p_findings ELSE '[]'::jsonb END)
           WITH ORDINALITY e(f, o)
  ), stage AS (
    SELECT v.variant, coalesce((SELECT sum(n.hands) FROM horse_daily_nets n
                                 WHERE n.day = p_day AND n.game_variant = v.variant), 0) AS hands
      FROM (SELECT DISTINCT variant FROM f WHERE variant IS NOT NULL) v
  )
  SELECT CASE WHEN jsonb_typeof(p_findings) <> 'array' THEN p_findings ELSE coalesce(jsonb_agg(
    CASE WHEN f.f->>'code' IN ('layer_went_silent','layer_silent') AND s.hands = 0 THEN
      f.f || jsonb_build_object(
        'severity', 'note', 'code', 'layer_no_stage', 'original_code', f.f->>'code', 'original_severity', f.f->>'severity',
        'evidence', coalesce(f.f->'evidence', '{}'::jsonb) || jsonb_build_object('variant', f.variant, 'variant_hands_that_day', 0),
        'recommendation', 'This layer only acts on ' || f.variant || ' hands, and horses dealt no ' || f.variant ||
          ' hands this day (the Nov 2 2026 cash policy stopped those games for horses). Nothing to fix. It returns to a warning the first day ' ||
          f.variant || ' hands are dealt again.')
    ELSE f.f END ORDER BY f.o), '[]'::jsonb) END
  FROM f LEFT JOIN stage s USING (variant)
$f$;
REVOKE ALL ON FUNCTION public.fn_horse_audit_stage_gate(jsonb,date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_horse_audit_stage_gate(jsonb,date) TO service_role;

DO $mig$
DECLARE
  v_src text := pg_get_functiondef('public.fn_run_horse_daily_audit(date)'::regprocedure);
  v_out text := v_src;
  v_sec text;
  v_old text;
BEGIN
  IF position('horse.audit_run_id' in v_src) > 0 THEN
    RAISE NOTICE 'fn_run_horse_daily_audit already carries provenance';
    RETURN;
  END IF;
  FOREACH v_sec IN ARRAY ARRAY['fn_audit_fleet_health','fn_audit_data_receipts','fn_audit_tuner_health',
                               'fn_audit_seat_clock','fn_audit_solver_pipeline_liveness'] LOOP
    v_old := 'v_findings := v_findings || ' || v_sec || '(p_day);';
    IF (length(v_out) - length(replace(v_out, v_old, ''))) / length(v_old) <> 1 THEN
      RAISE EXCEPTION 'expected exactly one call of % in fn_run_horse_daily_audit', v_sec;
    END IF;
    v_out := replace(v_out, v_old,
      'v_findings := v_findings || fn_horse_audit_mark_run_time(' || v_sec || '(p_day), p_day, ''' || v_sec || ''');');
  END LOOP;
  v_old := 'for r in select matchup, bb100, stderr, illegal_actions from horse_league_results';
  IF position(v_old in v_out) = 0 THEN RAISE EXCEPTION 'league loop not found in fn_run_horse_daily_audit'; END IF;
  v_out := replace(v_out, v_old, 'for r in select matchup, bb100, stderr, illegal_actions, truncated_streets, harness_corrected_actions, brain_exception_fallbacks, engine_sha from horse_league_results');
  v_old := E'find the exact branch.'');\n    end if;\n';
  IF (length(v_out) - length(replace(v_out, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'league illegal_actions block not found exactly once';
  END IF;
  v_out := replace(v_out, v_old, v_old
|| E'    -- 2026-11-05: truncations no longer ride inside illegal_actions, and the\n'
|| E'    -- harness now counts its own coercions and the brain''s exception fallback.\n'
|| E'    if coalesce(r.truncated_streets, 0) > 0 then\n'
|| E'      v_findings := v_findings || jsonb_build_object(''severity'',''critical'',''category'',''logic'',''code'',''league_truncated_streets'',\n'
|| E'        ''title'',''League matchup '' || r.matchup || '' cut '' || r.truncated_streets || '' streets short at the action cap'',\n'
|| E'        ''evidence'', jsonb_build_object(''matchup'', r.matchup, ''truncated_streets'', r.truncated_streets, ''engine_sha'', r.engine_sha),\n'
|| E'        ''recommendation'',''A street that hits the action cap means a raise war the rules should have ended. Find the betting loop.'');\n'
|| E'    end if;\n'
|| E'    if coalesce(r.brain_exception_fallbacks, 0) > 0 then\n'
|| E'      v_findings := v_findings || jsonb_build_object(''severity'',''warn'',''category'',''logic'',''code'',''league_brain_exception_fallbacks'',\n'
|| E'        ''title'',''League matchup '' || r.matchup || '': the brain threw '' || r.brain_exception_fallbacks || '' times and fell back to check/fold'',\n'
|| E'        ''evidence'', jsonb_build_object(''matchup'', r.matchup, ''brain_exception_fallbacks'', r.brain_exception_fallbacks, ''engine_sha'', r.engine_sha),\n'
|| E'        ''recommendation'',''These decisions never reached the legality check, so illegal_actions = 0 does not cover them. Reproduce the matchup and read the caught exception.'');\n'
|| E'    end if;\n'
|| E'    if r.harness_corrected_actions is null then\n'
|| E'      null; -- written by a build that did not count coercions: unmeasured, not zero\n'
|| E'    elsif r.harness_corrected_actions > 0 then\n'
|| E'      v_findings := v_findings || jsonb_build_object(''severity'',''info'',''category'',''logic'',''code'',''league_harness_corrected_actions'',\n'
|| E'        ''title'',''League matchup '' || r.matchup || '': '' || r.harness_corrected_actions || '' actions were coerced by the harness before validation'',\n'
|| E'        ''evidence'', jsonb_build_object(''matchup'', r.matchup, ''harness_corrected_actions'', r.harness_corrected_actions, ''engine_sha'', r.engine_sha),\n'
|| E'        ''recommendation'',''A check facing a bet or a call with nothing to call came out of decide after legalization. Live tables apply the same coercion silently.'');\n'
|| E'    end if;\n');
  FOREACH v_sec IN ARRAY ARRAY['fn_audit_layer_silence_and_coverage','fn_audit_layer_drift'] LOOP
    v_old := 'v_findings := v_findings || ' || v_sec || '(p_day);';
    IF (length(v_out) - length(replace(v_out, v_old, ''))) / length(v_old) <> 1 THEN
      RAISE EXCEPTION 'expected exactly one call of % in fn_run_horse_daily_audit', v_sec;
    END IF;
    v_out := replace(v_out, v_old, 'v_findings := v_findings || fn_horse_audit_stage_gate(' || v_sec || '(p_day), p_day);');
  END LOOP;

  v_old := E'  insert into horse_daily_audit as a (day, generated_at, stats, findings)\n  values (p_day, now(), coalesce(v_stats,''{}''::jsonb), v_findings)';
  IF position(v_old in v_out) = 0 THEN
    RAISE EXCEPTION 'audit insert not found in fn_run_horse_daily_audit';
  END IF;
  v_out := replace(v_out, v_old,
E'  -- PROVENANCE (2026-11-05). Which run wrote this row, when, on what data.\n'
|| E'  v_stats := coalesce(v_stats, ''{}''::jsonb) || jsonb_build_object(''provenance'', jsonb_build_object(\n'
|| E'    ''calc_version'', ''20261105220227'',\n'
|| E'    ''run_id'', nullif(current_setting(''horse.audit_run_id'', true), ''''),\n'
|| E'    ''run_at'', clock_timestamp(),\n'
|| E'    ''mode'', case when now() > ((p_day + interval ''1 day 12 hours'') at time zone ''UTC'') then ''backfill'' else ''scheduled'' end,\n'
|| E'    ''period'', jsonb_build_object(''start'', (p_day::timestamp at time zone ''UTC''), ''end'', ((p_day + 1)::timestamp at time zone ''UTC''), ''timezone'', ''UTC''),\n'
|| E'    ''engine_versions'', (select coalesce(jsonb_agg(distinct b.engine_version), ''[]''::jsonb) from engine_maintenance_break_log b\n'
|| E'                           where b.break_started_at >= p_day and b.break_started_at < p_day + 1 and b.engine_version is not null),\n'
|| E'    ''source_coverage'', jsonb_build_object(\n'
|| E'      ''review_rows'', v_day_hands,\n'
|| E'      ''telemetry_rows'', (select count(*) from horse_brain_telemetry t where t.day = p_day),\n'
|| E'      ''nets_rows'', (select count(*) from horse_daily_nets n where n.day = p_day),\n'
|| E'      ''baseline_days'', v_base_days,\n'
|| E'      ''oldest_review_retained'', (select min(played_at) from horse_hand_reviews)),\n'
|| E'    ''run_time_sections'', jsonb_build_array(''fn_audit_data_receipts'',''fn_audit_fleet_health'',''fn_audit_tuner_health'',''fn_audit_seat_clock'',''fn_audit_solver_pipeline_liveness'')));\n\n'
|| v_old);
  EXECUTE v_out;
END
$mig$;
ALTER FUNCTION public.fn_run_horse_daily_audit(date) SET timezone TO 'UTC';

-- Analysis persistence with an explicit result.
DROP FUNCTION IF EXISTS public.fn_horse_audit_set_agent_analysis(date, jsonb);
CREATE FUNCTION public.fn_horse_audit_set_agent_analysis(p_day date, p_analysis jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  v_audit   public.horse_daily_audit%ROWTYPE;
  v_sub_id  uuid;
  v_outcome text;
BEGIN
  IF p_day IS NULL OR p_analysis IS NULL OR jsonb_typeof(p_analysis) <> 'object' THEN
    RAISE EXCEPTION 'fn_horse_audit_set_agent_analysis needs a day and a json object' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_audit FROM public.horse_daily_audit WHERE day = p_day FOR UPDATE;

  IF NOT FOUND OR v_audit.stats = '{}'::jsonb THEN
    v_outcome := 'pending_machine_audit';
  ELSIF v_audit.agent_analysis IS NULL THEN
    UPDATE public.horse_daily_audit SET agent_analysis = p_analysis, agent_analyzed_at = now() WHERE day = p_day;
    v_outcome := 'stored';
  ELSIF md5(v_audit.agent_analysis::text) = md5(p_analysis::text) THEN
    v_outcome := 'duplicate';
  ELSE
    v_outcome := 'retained_existing';
  END IF;

  INSERT INTO public.horse_daily_audit_analysis_submissions (day, analysis, outcome)
  VALUES (p_day, p_analysis, v_outcome) RETURNING id INTO v_sub_id;

  RETURN jsonb_build_object(
    'day', p_day,
    'persisted', true,
    'outcome', v_outcome,
    'submission_id', v_sub_id,
    'machine_audit_present', v_outcome <> 'pending_machine_audit',
    'note', CASE v_outcome
      WHEN 'stored' THEN 'Analysis stored on the audit row.'
      WHEN 'pending_machine_audit' THEN 'The machine audit for this day is not written yet. The analysis is kept and attaches itself when the audit row lands.'
      WHEN 'duplicate' THEN 'The same analysis is already stored.'
      ELSE 'A different analysis is already stored and was kept. This submission is retained in horse_daily_audit_analysis_submissions.' END);
END
$f$;
REVOKE ALL ON FUNCTION public.fn_horse_audit_set_agent_analysis(date, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_horse_audit_set_agent_analysis(date, jsonb) TO service_role;

-- A pending analysis joins its audit the moment the audit is written.
CREATE OR REPLACE FUNCTION public.fn_horse_audit_attach_pending_analysis()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  v_sub public.horse_daily_audit_analysis_submissions%ROWTYPE;
BEGIN
  IF NEW.agent_analysis IS NOT NULL OR NEW.stats IS NULL OR NEW.stats = '{}'::jsonb THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_sub FROM public.horse_daily_audit_analysis_submissions s
   WHERE s.day = NEW.day AND s.outcome = 'pending_machine_audit'
   ORDER BY s.submitted_at ASC LIMIT 1;
  IF FOUND THEN
    NEW.agent_analysis := v_sub.analysis;
    NEW.agent_analyzed_at := v_sub.submitted_at;
    UPDATE public.horse_daily_audit_analysis_submissions
       SET outcome = 'attached_after_audit', outcome_at = clock_timestamp()
     WHERE id = v_sub.id;
    UPDATE public.horse_daily_audit_analysis_submissions
       SET outcome = CASE WHEN analysis_md5 = v_sub.analysis_md5 THEN 'duplicate' ELSE 'retained_existing' END,
           outcome_at = clock_timestamp()
     WHERE day = NEW.day AND outcome = 'pending_machine_audit' AND id <> v_sub.id;
  END IF;
  RETURN NEW;
END
$f$;
REVOKE ALL ON FUNCTION public.fn_horse_audit_attach_pending_analysis() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS horse_daily_audit_attach_pending_analysis ON public.horse_daily_audit;
CREATE TRIGGER horse_daily_audit_attach_pending_analysis
  BEFORE INSERT OR UPDATE OF stats ON public.horse_daily_audit
  FOR EACH ROW EXECUTE FUNCTION public.fn_horse_audit_attach_pending_analysis();

-- One attempt at one day's machine audit, recorded whatever happens.
CREATE OR REPLACE FUNCTION public.fn_horse_daily_audit_attempt(p_day date, p_source text, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '120s' AS $f$
DECLARE
  v_run uuid; v_attempt int; v_err text; v_state text; v_ctx text; v_claim record; v_res jsonb;
BEGIN
  SELECT j.claimed_at, j.claimed_by INTO v_claim FROM public.horse_job_runs j
   WHERE j.job = 'daily_audit' AND j.run_date = p_day;
  SELECT count(*) + 1 INTO v_attempt FROM public.horse_daily_audit_runs
   WHERE day = p_day AND stage = 'machine_audit';
  INSERT INTO public.horse_daily_audit_runs (day, run_source, stage, status, attempt, calc_version, reason, details)
  VALUES (p_day, p_source, 'machine_audit', 'running', v_attempt, '20261105220227', p_reason,
          jsonb_build_object('engine_claimed_at', v_claim.claimed_at, 'engine_claimed_by', v_claim.claimed_by))
  RETURNING id INTO v_run;
  PERFORM set_config('horse.audit_run_id', v_run::text, true);
  BEGIN
    v_res := public.fn_run_horse_daily_audit(p_day);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE, v_ctx = PG_EXCEPTION_CONTEXT;
  END;
  PERFORM set_config('horse.audit_run_id', '', true);
  UPDATE public.horse_daily_audit_runs
     SET status = CASE WHEN v_err IS NULL THEN 'succeeded' ELSE 'failed' END,
         finished_at = clock_timestamp(), error = v_err, error_state = v_state,
         details = details || jsonb_build_object('context', left(v_ctx, 2000), 'result', v_res)
   WHERE id = v_run;
  RETURN jsonb_build_object('day', p_day, 'run_id', v_run, 'attempt', v_attempt, 'ok', v_err IS NULL,
                            'error', v_err, 'sqlstate', v_state, 'result', v_res);
END
$f$;
REVOKE ALL ON FUNCTION public.fn_horse_daily_audit_attempt(date,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_horse_daily_audit_attempt(date,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_horse_daily_audit_raise_alert(p_day date, p_kind text, p_severity text, p_message text, p_context jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF EXISTS (SELECT 1 FROM public.financial_alerts f
              WHERE f.source = 'fn_horse_daily_audit_watchdog' AND NOT f.resolved
                AND f.context->>'day' = p_day::text AND coalesce(f.context->>'kind','audit') = p_kind) THEN
    RETURN false;
  END IF;
  INSERT INTO public.financial_alerts (severity, source, message, context)
  VALUES (p_severity, 'fn_horse_daily_audit_watchdog', p_message,
          coalesce(p_context, '{}'::jsonb) || jsonb_build_object('day', p_day, 'kind', p_kind));
  RETURN true;
END
$f$;
REVOKE ALL ON FUNCTION public.fn_horse_daily_audit_raise_alert(date,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_horse_daily_audit_fallback()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '120s' AS $function$
DECLARE
  d date := (now() AT TIME ZONE 'utc')::date - 1;
  v_res jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM public.horse_daily_audit WHERE day = d AND stats <> '{}'::jsonb) THEN
    RETURN jsonb_build_object('day', d, 'status', 'engine_row_present');
  END IF;
  v_res := public.fn_horse_daily_audit_attempt(d, 'fallback', 'the engine had not written the day by 07:30 UTC');
  IF NOT (v_res->>'ok')::boolean THEN
    PERFORM public.fn_horse_daily_audit_raise_alert(d, 'audit', 'critical',
      'Horse daily audit missing for ' || d || ' and the 07:30 UTC fallback failed: ' || (v_res->>'error'),
      jsonb_build_object('run_id', v_res->>'run_id', 'error', v_res->>'error', 'sqlstate', v_res->>'sqlstate'));
    RETURN jsonb_build_object('day', d, 'status', 'function_error') || v_res;
  END IF;
  UPDATE public.horse_daily_audit
     SET findings = coalesce(findings, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
       'severity','critical','category','schema','code','daily_audit_rescued_by_fallback',
       'title','The engine did not produce the ' || d || ' audit; the 07:30Z database fallback generated it',
       'evidence', jsonb_build_object('day', d, 'run_id', v_res->>'run_id', 'rescued_at', now())))
   WHERE day = d;
  RETURN jsonb_build_object('day', d, 'status', 'rescued') || v_res;
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_horse_daily_audit_watchdog()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '300s' AS $function$
DECLARE
  r record; v_res jsonb; v_out jsonb := '[]'::jsonb; v_released int; v_failed int; v_pass uuid;
  c_max_failed constant int := 6;
BEGIN
  INSERT INTO public.horse_daily_audit_runs (day, run_source, stage, status, calc_version)
  VALUES ((now() AT TIME ZONE 'utc')::date, 'watchdog', 'watchdog_pass', 'running', '20261105220227')
  RETURNING id INTO v_pass;

  FOR r IN
    SELECT gs::date AS day
      FROM generate_series((now() AT TIME ZONE 'utc')::date - 7, (now() AT TIME ZONE 'utc')::date - 1, interval '1 day') gs
     WHERE NOT EXISTS (SELECT 1 FROM public.horse_daily_audit a WHERE a.day = gs::date AND a.stats <> '{}'::jsonb)
       AND now() > ((gs::date + interval '1 day 8 hours') AT TIME ZONE 'UTC')
  LOOP
    SELECT count(*) INTO v_failed FROM public.horse_daily_audit_runs
     WHERE day = r.day AND stage = 'machine_audit' AND status = 'failed' AND started_at > now() - interval '7 days';
    IF v_failed >= c_max_failed THEN
      PERFORM public.fn_horse_daily_audit_raise_alert(r.day, 'audit', 'critical',
        'Horse daily audit missing for ' || r.day || ' and its retry budget is spent (' || v_failed || ' failed attempts)',
        jsonb_build_object('failed_attempts', v_failed));
      v_out := v_out || jsonb_build_object('day', r.day, 'ok', false, 'skipped', 'retry budget spent');
      CONTINUE;
    END IF;
    v_res := public.fn_horse_daily_audit_attempt(r.day, 'watchdog', 'expected audit row missing after its deadline');
    IF NOT (v_res->>'ok')::boolean THEN
      PERFORM public.fn_horse_daily_audit_raise_alert(r.day, 'audit', 'critical',
        'Horse daily audit missing for ' || r.day || ' and retry failed: ' || (v_res->>'error'),
        jsonb_build_object('run_id', v_res->>'run_id', 'error', v_res->>'error', 'sqlstate', v_res->>'sqlstate'));
    END IF;
    v_out := v_out || v_res;
  END LOOP;

  -- Lost or stalled agent analysis: an old claim, no stored analysis and no
  -- pending submission. Release the claim so a runner can take the day again.
  FOR r IN
    SELECT a.day, j.claimed_at, j.claimed_by
      FROM public.horse_daily_audit a
      JOIN public.horse_job_runs j ON j.run_date = a.day AND j.job = 'claude_daily_analysis'
     WHERE a.day >= (now() AT TIME ZONE 'utc')::date - 14
       AND a.stats <> '{}'::jsonb
       AND a.agent_analysis IS NULL
       AND j.claimed_at < now() - interval '6 hours'
       AND now() > ((a.day + interval '1 day 12 hours') AT TIME ZONE 'UTC')
       AND NOT EXISTS (SELECT 1 FROM public.horse_daily_audit_analysis_submissions s
                        WHERE s.day = a.day AND s.outcome = 'pending_machine_audit')
  LOOP
    DELETE FROM public.horse_job_runs j WHERE j.run_date = r.day AND j.job = 'claude_daily_analysis';
    GET DIAGNOSTICS v_released = ROW_COUNT;
    INSERT INTO public.horse_daily_audit_runs (day, run_source, stage, status, finished_at, error, calc_version, details)
    VALUES (r.day, 'watchdog', 'analysis_persist', 'failed', clock_timestamp(),
            'analysis claimed but never stored', '20261105220227',
            jsonb_build_object('claimed_at', r.claimed_at, 'claimed_by', r.claimed_by, 'claim_released', v_released > 0));
    PERFORM public.fn_horse_daily_audit_raise_alert(r.day, 'analysis', 'warning',
      'Horse daily analysis for ' || r.day || ' was claimed at ' || to_char(r.claimed_at,'YYYY-MM-DD HH24:MI') || ' UTC but never stored; claim released for a retry',
      jsonb_build_object('claimed_at', r.claimed_at));
    v_out := v_out || jsonb_build_object('day', r.day, 'analysis_claim_released', v_released);
  END LOOP;

  UPDATE public.financial_alerts f SET resolved = true, resolved_at = now(), resolution = 'audit row present'
   WHERE f.source = 'fn_horse_daily_audit_watchdog' AND NOT f.resolved AND coalesce(f.context->>'kind','audit') = 'audit'
     AND EXISTS (SELECT 1 FROM public.horse_daily_audit a WHERE a.day::text = f.context->>'day' AND a.stats <> '{}'::jsonb);
  UPDATE public.financial_alerts f SET resolved = true, resolved_at = now(), resolution = 'agent analysis stored'
   WHERE f.source = 'fn_horse_daily_audit_watchdog' AND NOT f.resolved AND f.context->>'kind' = 'analysis'
     AND EXISTS (SELECT 1 FROM public.horse_daily_audit a WHERE a.day::text = f.context->>'day' AND a.agent_analysis IS NOT NULL);

  UPDATE public.horse_daily_audit_runs SET status = 'succeeded', finished_at = clock_timestamp(), details = jsonb_build_object('actions', v_out)
   WHERE id = v_pass;
  RETURN v_out;
END
$function$;

-- Nobody in a browser runs the watchdog or the fallback. The live watchdog
-- (20261105172255) was executable by authenticated; only the cron (postgres)
-- and service_role need them.
REVOKE ALL ON FUNCTION public.fn_horse_daily_audit_watchdog() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_horse_daily_audit_watchdog() TO service_role;
REVOKE ALL ON FUNCTION public.fn_horse_daily_audit_fallback() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_horse_daily_audit_fallback() TO service_role;
REVOKE ALL ON FUNCTION public.fn_horse_audit_attach_pending_analysis() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_horse_daily_audit_raise_alert(date,text,text,text,jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- Per-day state for the panel and the outside check.
CREATE OR REPLACE FUNCTION public.fn_horse_daily_audit_watch_status(p_days integer DEFAULT 14)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  WITH days AS (
    SELECT gs::date AS day
      FROM generate_series((now() AT TIME ZONE 'utc')::date - least(greatest(coalesce(p_days,14),1),90),
                           (now() AT TIME ZONE 'utc')::date - 1, interval '1 day') gs
  ), per_day AS (
    SELECT d.day, a.generated_at, a.stats->'provenance'->>'mode' AS mode,
           a.stats IS NOT NULL AND a.stats <> '{}'::jsonb AS audit_present,
           a.agent_analysis IS NOT NULL AS analysis_present,
           a.agent_analysis->>'tier' AS analysis_tier,
           j.claimed_at, j.claimed_by,
           lr.status AS last_status, lr.error AS last_error, lr.started_at AS last_attempt_at,
           (SELECT count(*) FROM horse_daily_audit_runs x WHERE x.day = d.day AND x.stage = 'machine_audit' AND x.status = 'failed') AS failed_attempts,
           EXISTS (SELECT 1 FROM horse_daily_audit_runs x WHERE x.day = d.day AND x.stage = 'machine_audit' AND x.status = 'succeeded'
                     AND x.run_source IN ('watchdog','fallback','backfill','manual')) AS recovered_run,
           EXISTS (SELECT 1 FROM horse_daily_audit_analysis_submissions s WHERE s.day = d.day AND s.outcome = 'pending_machine_audit') AS analysis_pending,
           now() > ((d.day + interval '1 day 8 hours') AT TIME ZONE 'UTC') AS audit_due,
           now() > ((d.day + interval '1 day 14 hours') AT TIME ZONE 'UTC') AS analysis_due
      FROM days d
      LEFT JOIN horse_daily_audit a ON a.day = d.day
      LEFT JOIN horse_job_runs j ON j.job = 'daily_audit' AND j.run_date = d.day
      LEFT JOIN LATERAL (SELECT r.status, r.error, r.started_at FROM horse_daily_audit_runs r
                          WHERE r.day = d.day AND r.stage = 'machine_audit' ORDER BY r.started_at DESC LIMIT 1) lr ON true
  )
  SELECT jsonb_build_object(
    'checked_at', now(),
    'watchdog_last_pass_at', (SELECT max(started_at) FROM horse_daily_audit_runs WHERE stage = 'watchdog_pass' AND status = 'succeeded'),
    'watchdog_stale', coalesce((SELECT max(started_at) FROM horse_daily_audit_runs WHERE stage = 'watchdog_pass' AND status = 'succeeded') < now() - interval '7 hours', true),
    'days', coalesce(jsonb_agg(jsonb_build_object(
      'day', day,
      'machine_audit', CASE
          WHEN audit_present AND (mode = 'backfill' OR recovered_run) THEN 'recovered'
          WHEN audit_present THEN 'completed'
          WHEN last_status = 'running' THEN 'running'
          WHEN last_status = 'failed' THEN 'failed'
          WHEN audit_due THEN 'missing'
          ELSE 'not_due' END,
      'analysis', CASE
          WHEN analysis_present AND analysis_tier = 'reconstruction' THEN 'reconstructed'
          WHEN analysis_present THEN 'stored'
          WHEN analysis_pending THEN 'pending_machine_audit'
          WHEN analysis_due THEN 'missing'
          ELSE 'not_due' END,
      'engine_claimed_at', claimed_at, 'engine_claimed_by', claimed_by,
      'generated_at', generated_at, 'mode', mode,
      'failed_attempts', failed_attempts, 'last_error', last_error, 'last_attempt_at', last_attempt_at)
      ORDER BY day DESC), '[]'::jsonb))
  FROM per_day
$f$;
REVOKE ALL ON FUNCTION public.fn_horse_daily_audit_watch_status(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_horse_daily_audit_watch_status(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.ca_horse_audit_watch_status(p_days integer DEFAULT 14)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF NOT fn_is_horse_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  RETURN public.fn_horse_daily_audit_watch_status(p_days);
END
$f$;
REVOKE ALL ON FUNCTION public.ca_horse_audit_watch_status(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ca_horse_audit_watch_status(integer) TO authenticated, service_role;
INSERT INTO public.ca_browser_definer_allowlist (proname, reason)
VALUES ('ca_horse_audit_watch_status',
        'Per-day horse daily audit state (missing, failed, running, pending, recovered, completed) shown on the horse Daily Audit panel. Gates itself on fn_is_horse_admin() before reading anything, like the other ca_horse_* console functions; STABLE, writes nothing, returns audit job state only.')
ON CONFLICT (proname) DO NOTHING;

DO $post$
BEGIN
  IF NOT (to_regclass('public.horse_daily_audit_runs') IS NOT NULL
          AND position('horse.audit_run_id' in pg_get_functiondef('public.fn_run_horse_daily_audit(date)'::regprocedure)) > 0
          AND position('pending_machine_audit' in pg_get_functiondef('public.fn_horse_audit_set_agent_analysis(date,jsonb)'::regprocedure)) > 0) THEN
    RAISE EXCEPTION 'horse audit hardening post-image missing';
  END IF;
END
$post$;
COMMIT;
