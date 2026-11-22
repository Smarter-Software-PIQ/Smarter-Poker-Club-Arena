-- 20261122145848_cutover_readiness_classification_resolution_and_cron_recover.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--   1. Reliability Controller classification & runbook coverage for
--      CutoverReadinessAtRisk (incident 35a1bcd7) and sibling unclassified
--      alert rakeback_settler_read_horizon_held:
--        - Classifies cutover-readiness-watch / CutoverReadinessAtRisk as
--          'release' (priority 140 + source fallback 400) and reclassifies any
--          open unclassified CutoverReadinessAtRisk incident to 'release'.
--        - Classifies rakeback_settler_read_horizon_held as 'money_integrity'
--          (priority 200).
--        - Extends the read-only cutover_diagnosis runbook to also diagnose
--          CutoverReadinessAtRisk from smarter_private.ca_cutover_readiness_runs.
--   2. Post-03:30 resolution for CutoverReadinessAtRisk in
--      public.fn_ca_engine_cutover_watch:
--        - fn_ca_cutover_readiness_watch stops running at 03:30 Chicago, so a
--          firing CutoverReadinessAtRisk alert stayed open and escalated for
--          24 hours even after 04:00 or 07:00 shipped the freeze baseline.
--        - fn_ca_engine_cutover_watch now resolves firing CutoverReadinessAtRisk
--          alerts once production holds the baseline_sha, once today's cutover
--          is sealed/not_owed, or once the cutover_day has passed.
--   3. Verified recovery clearance in public.fn_ca_cron_failure_watch:
--        - After a repeatedly failing hourly job (e.g. ca-horse-exposure-watch-hourly,
--          drift incident c3935699) is fixed at its root cause, the 24h ratio
--          branch (day.fails >= 5 AND day.fails > day.successes) kept re-raising
--          it for 12+ hours even after 3 consecutive clean runs.
--        - Exclude jobs whose last 3 finished runs all succeeded
--          (NOT (day.finished = 3 AND day.failed_in_a_row = 0)) from the stale
--          24h ratio branch while still firing on any active or flapping failure.
--   4. Verified resolution of the 4 fn_ca_guard_defs_watch drift incidents
--      from installed migration 20261121154220 (54d7fe1e, f4733687, 77b028f4,
--      1e303f5e) after migration 20261122145633 recorded their forward
--      declarations.
--
-- @probe-for: public.fn_ca_cron_failure_watch
-- @probe-exempt: public.fn_ca_engine_cutover_watch calls external GitHub and engine /health via extensions.http; proven by native PostgreSQL test scripts/ci/test-a-missed-engine-cutover-is-paged.py
-- @probe-exempt: smarter_private.reliability_runbook_cutover_diagnosis calls external GitHub via ca_cutover_http_json; proven by native PostgreSQL test scripts/ci/test-reliability-runbooks.py
-- @live-proof: EXISTS (SELECT 1 FROM smarter_private.reliability_alert_classes WHERE source_pattern = 'cutover-readiness-watch' AND alertname_pattern = 'CutoverReadinessAtRisk' AND incident_class = 'release') AND EXISTS (SELECT 1 FROM smarter_private.reliability_alert_classes WHERE alertname_pattern = 'rakeback_settler_read_horizon_held' AND incident_class = 'money_integrity') AND EXISTS (SELECT 1 FROM smarter_private.reliability_runbooks WHERE key = 'cutover_diagnosis' AND eligibility->'alertnames' ? 'CutoverReadinessAtRisk') AND strpos(pg_get_functiondef('public.fn_ca_engine_cutover_watch(timestamptz)'::regprocedure), 'CutoverReadinessAtRisk') > 0 AND strpos(pg_get_functiondef('public.fn_ca_cron_failure_watch()'::regprocedure), 'AND NOT (day.finished = 3 AND day.failed_in_a_row = 0)') > 0 AND EXISTS (SELECT 1 FROM public.ca_guard_defs WHERE proname = 'fn_ca_cron_failure_watch' AND declared_ref LIKE '%20261122145848%') AND NOT EXISTS (SELECT 1 FROM public.ca_drift_incidents WHERE id IN ('54d7fe1e-661d-436a-a5e1-6b60720d00fb','f4733687-4d8d-4577-a996-729688975e9d','77b028f4-5c18-4564-a568-1ae4bdc098aa','1e303f5e-fade-456a-ab9e-bd92c632f0b3') AND status <> 'resolved')

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ── 1. Reliability Controller classes & open incident reclassification ───────
DO $classify_cutover_and_rakeback$
BEGIN
  IF to_regclass('smarter_private.reliability_alert_classes') IS NOT NULL THEN
    INSERT INTO smarter_private.reliability_alert_classes
      (priority, source_pattern, alertname_pattern, severity_pattern, incident_class, default_severity, escalate_immediately, is_incident, note)
    SELECT 140, 'cutover-readiness-watch', 'CutoverReadinessAtRisk', '%', 'release', 'critical', false, true,
           'fn_ca_cutover_readiness_watch (20261119234116): 03:00 Chicago pre-cutover readiness risk; owner engine release lane (20261122145848)'
     WHERE NOT EXISTS (
       SELECT 1 FROM smarter_private.reliability_alert_classes
        WHERE source_pattern = 'cutover-readiness-watch'
          AND alertname_pattern = 'CutoverReadinessAtRisk'
     );

    INSERT INTO smarter_private.reliability_alert_classes
      (priority, source_pattern, alertname_pattern, severity_pattern, incident_class, default_severity, escalate_immediately, is_incident, note)
    SELECT 400, 'cutover-readiness-watch', '%', '%', 'release', 'critical', false, true,
           'cutover-readiness-watch source fallback (20261122145848)'
     WHERE NOT EXISTS (
       SELECT 1 FROM smarter_private.reliability_alert_classes
        WHERE source_pattern = 'cutover-readiness-watch'
          AND alertname_pattern = '%'
     );

    INSERT INTO smarter_private.reliability_alert_classes
      (priority, source_pattern, alertname_pattern, severity_pattern, incident_class, default_severity, escalate_immediately, is_incident, note)
    SELECT 200, '%', 'rakeback_settler_read_horizon_held', '%', 'money_integrity', 'warning', false, true,
           'rakeback-settler-read-horizon: settler read horizon held back on lagging financial inputs (20261122145848)'
     WHERE NOT EXISTS (
       SELECT 1 FROM smarter_private.reliability_alert_classes
        WHERE alertname_pattern = 'rakeback_settler_read_horizon_held'
     );
  END IF;

  IF to_regclass('smarter_private.reliability_incidents') IS NOT NULL THEN
    UPDATE smarter_private.reliability_incidents
       SET incident_class = 'release',
           title = 'CutoverReadinessAtRisk (release)'
     WHERE source = 'cutover-readiness-watch'
       AND alertname = 'CutoverReadinessAtRisk'
       AND incident_class = 'unclassified'
       AND status NOT IN ('recovered', 'closed');
  END IF;

  IF to_regclass('smarter_private.reliability_runbooks') IS NOT NULL THEN
    UPDATE smarter_private.reliability_runbooks
       SET eligibility = '{"class": "release", "alertnames": ["EngineCutoverMissed", "CutoverReadinessAtRisk"]}'::jsonb
     WHERE key = 'cutover_diagnosis'
       AND version = 1;
  END IF;
END
$classify_cutover_and_rakeback$;

-- ── 2. Extend cutover_diagnosis runbook to read CutoverReadinessAtRisk ─────
CREATE OR REPLACE FUNCTION smarter_private.reliability_runbook_cutover_diagnosis(
  p_incident_id uuid,
  p_dry_run boolean,
  p_limits jsonb,
  p_now timestamp with time zone
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  c_tz constant text := 'America/Chicago';
  c_repo constant text := 'https://api.github.com/repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena';
  c_context constant text := 'backup-engine/certified';
  v_alert bigint;
  v_alertname text;
  d record;
  v_readiness record;
  v_freeze timestamptz;
  v_statuses jsonb;
  v_cert_at timestamptz;
  v_any_cert_at timestamptz;
  v_art jsonb;
  v_run jsonb;
  v_cmp jsonb;
  v_missing text[] := '{}';
  v_carried integer := 0;
  v_exit record;
  v_cause text;
  v_text text;
  f jsonb;
  v_version text;
  v_installed boolean;
  v_history text := 'supabase_migrations.schema_migrations';
BEGIN
  SELECT i.alertname, (i.latest_evidence->>'inbox_event_id')::bigint
    INTO v_alertname, v_alert
    FROM smarter_private.reliability_incidents i
   WHERE i.id = p_incident_id;

  IF v_alertname = 'CutoverReadinessAtRisk' THEN
    IF to_regclass('smarter_private.ca_cutover_readiness_runs') IS NULL THEN
      RETURN jsonb_build_object('outcome', 'nothing_to_do', 'summary', 'cutover readiness runs table is not present');
    END IF;
    SELECT r.cutover_day, r.checked_at, r.verdict, r.reasons, r.unknowns, r.facts
      INTO v_readiness
      FROM smarter_private.ca_cutover_readiness_runs r
     WHERE r.alert_id = v_alert
     ORDER BY r.checked_at DESC
     LIMIT 1;
    IF v_readiness.cutover_day IS NULL THEN
      SELECT r.cutover_day, r.checked_at, r.verdict, r.reasons, r.unknowns, r.facts
        INTO v_readiness
        FROM smarter_private.ca_cutover_readiness_runs r
       WHERE r.verdict = 'not_ready'
       ORDER BY r.checked_at DESC
       LIMIT 1;
    END IF;
    IF v_readiness.cutover_day IS NULL THEN
      RETURN jsonb_build_object('outcome', 'nothing_to_do', 'summary', 'no not_ready cutover readiness run is recorded');
    END IF;
    v_text := COALESCE(
      (SELECT string_agg(x, '; ') FROM jsonb_array_elements_text(COALESCE(v_readiness.reasons, '[]'::jsonb)) x),
      'no readiness reason recorded'
    );
    RETURN jsonb_build_object(
      'outcome', CASE WHEN p_dry_run THEN 'observed' ELSE 'diagnosed' END,
      'summary', left(format('%s readiness at risk (checked %s Central): serving %s, baseline %s. Reasons: %s. No engine swap is automatic (certified builds only, in windows); no safe Backup dispatch route exists for the controller, so nothing was requested.',
                             to_char(v_readiness.cutover_day, 'Mon FMDD'),
                             to_char(v_readiness.checked_at AT TIME ZONE c_tz, 'HH24:MI'),
                             COALESCE(left(v_readiness.facts->>'serving_sha', 8), 'unknown'),
                             COALESCE(left(v_readiness.facts->>'baseline_sha', 8), 'unknown'),
                             v_text), 900),
      'cause', 'cutover_readiness_at_risk',
      'cutover_day', v_readiness.cutover_day,
      'checked_at', v_readiness.checked_at,
      'verdict', v_readiness.verdict,
      'serving_sha', v_readiness.facts->>'serving_sha',
      'baseline_sha', v_readiness.facts->>'baseline_sha',
      'reasons', v_readiness.reasons,
      'facts', v_readiness.facts,
      'certification_request', 'none: no safe dispatch route for the controller'
    );
  END IF;

  SELECT * INTO d FROM smarter_private.ca_engine_cutover_days c WHERE c.alert_id = v_alert;
  IF d.chicago_day IS NULL THEN
    SELECT * INTO d FROM smarter_private.ca_engine_cutover_days c WHERE c.verdict = 'missed' ORDER BY c.chicago_day DESC LIMIT 1;
  END IF;
  IF d.chicago_day IS NULL THEN
    RETURN jsonb_build_object('outcome', 'nothing_to_do', 'summary', 'no missed cutover day is recorded');
  END IF;
  -- The freeze begins 23:45 Chicago the evening before (scripts/ci/merged-migration-dispatch.mjs
  -- RELEASE_SCHEMA_FREEZE_CHICAGO, mirrored by fn_ca_engine_cutover_watch 20261119182637).
  v_freeze := (d.chicago_day::timestamp - interval '15 minutes') AT TIME ZONE c_tz;

  v_statuses := smarter_private.ca_cutover_http_json(format('%s/commits/%s/statuses?per_page=100', c_repo, d.owed_sha));
  IF jsonb_typeof(v_statuses) = 'array' THEN
    SELECT max((s->>'created_at')::timestamptz) FILTER (WHERE (s->>'created_at')::timestamptz >= v_freeze),
           max((s->>'created_at')::timestamptz)
      INTO v_cert_at, v_any_cert_at
      FROM jsonb_array_elements(v_statuses) s
     WHERE s->>'context' = c_context AND s->>'state' = 'success';
  END IF;

  v_art := smarter_private.ca_cutover_http_json(format('%s/actions/artifacts?name=daily-engine-selection-%s&per_page=5',
                                                       c_repo, to_char(d.chicago_day, 'YYYY-MM-DD')));
  IF coalesce((v_art->>'total_count')::integer, 0) > 0 THEN
    v_run := smarter_private.ca_cutover_http_json(format('%s/actions/runs/%s', c_repo, v_art->'artifacts'->0->'workflow_run'->>'id'));
  END IF;

  v_cmp := smarter_private.ca_cutover_http_json(format('%s/compare/%s...%s', c_repo, d.serving_sha, d.owed_sha));
  IF jsonb_typeof(v_cmp->'files') = 'array' THEN
    FOR f IN SELECT * FROM jsonb_array_elements(v_cmp->'files') LOOP
      CONTINUE WHEN f->>'filename' !~ '^supabase/migrations/[0-9]{14}_[^/]+\.sql$' OR f->>'status' = 'removed';
      v_carried := v_carried + 1;
      v_version := substring(f->>'filename' FROM 'migrations/([0-9]{14})_');
      -- Dynamic on purpose: Supabase's own schema (see cron_proof_run).
      EXECUTE 'SELECT EXISTS (SELECT 1 FROM ' || v_history || ' m WHERE m.version = $1)'
         INTO v_installed USING v_version;
      IF NOT v_installed THEN
        v_missing := v_missing || v_version;
      END IF;
    END LOOP;
  END IF;

  SELECT e.run_id, e.stage, e.outcome, left(coalesce(e.error, e.release_result, ''), 200) AS error, e.recorded_at, left(e.target_sha, 8) AS target
    INTO v_exit
    FROM public.engine_deploy_exit_paths e
   WHERE e.recorded_at >= (d.chicago_day + time '03:30') AT TIME ZONE c_tz - interval '5 hours'
     AND e.recorded_at < (d.chicago_day + time '06:00') AT TIME ZONE c_tz
   ORDER BY e.recorded_at DESC LIMIT 1;

  v_cause := CASE
    WHEN v_statuses IS NULL AND v_art IS NULL AND v_cmp IS NULL THEN 'github_unreadable'
    WHEN cardinality(v_missing) > 0 THEN 'owed_build_carries_uninstalled_migrations'
    WHEN v_cert_at IS NULL THEN 'freeze_baseline_uncertified'
    WHEN coalesce((v_art->>'total_count')::integer, 0) = 0 THEN 'no_preparation_run'
    WHEN v_exit.run_id IS NOT NULL THEN 'release_attempt_' || coalesce(v_exit.outcome, 'unknown')
    ELSE 'selection_refused_a_certified_baseline' END;
  v_text := CASE v_cause
    WHEN 'github_unreadable' THEN 'GitHub could not be read, so the release evidence is unknown; the watch reason stands: ' || coalesce(d.reason, '?')
    WHEN 'owed_build_carries_uninstalled_migrations' THEN format('the owed build %s carries %s migration(s) production has not installed (%s), so the contents judge refuses it until they install',
         left(d.owed_sha, 8), cardinality(v_missing), array_to_string(v_missing[1:8], ', '))
    WHEN 'freeze_baseline_uncertified' THEN format('the freeze-baseline build %s has no %s success written after the freeze began (%s America/Chicago)%s, so the 03:30 selection had no certified build to send; the backup-engine.yml plan job (scripts/ci/backup-freeze-baseline.py state=due) owns that certificate',
         left(d.owed_sha, 8), c_context, to_char(v_freeze AT TIME ZONE c_tz, 'YYYY-MM-DD HH24:MI'),
         CASE WHEN v_any_cert_at IS NOT NULL THEN ' (its newest certificate is from ' || to_char(v_any_cert_at AT TIME ZONE c_tz, 'YYYY-MM-DD HH24:MI') || ', before the freeze)' ELSE ' (it was never certified)' END)
    WHEN 'no_preparation_run' THEN format('no daily-engine-selection-%s artifact exists: no 03:30 preparation run was admitted', to_char(d.chicago_day, 'YYYY-MM-DD'))
    WHEN 'selection_refused_a_certified_baseline' THEN format('the freeze baseline %s was certified at %s and every migration it carries is installed, yet selection run %s (%s) sent nothing; read its daily-engine-selection artifact verdicts',
         left(d.owed_sha, 8), to_char(v_cert_at AT TIME ZONE c_tz, 'HH24:MI'), coalesce(v_run->>'id', '?'), coalesce(v_run->>'conclusion', '?'))
    ELSE format('release receipt %s at stage %s: %s', v_exit.run_id, v_exit.stage, v_exit.error) END;
  RETURN jsonb_build_object(
    'outcome', CASE WHEN p_dry_run THEN 'observed' ELSE 'diagnosed' END,
    'summary', left(format('%s missed: serving %s, owed %s. Cause: %s. No engine swap is automatic (certified builds only, in windows); no safe Backup dispatch route exists for the controller, so nothing was requested.',
                           to_char(d.chicago_day, 'Mon FMDD'), left(d.serving_sha, 8), left(d.owed_sha, 8), v_text), 900),
    'cause', v_cause,
    'chicago_day', d.chicago_day, 'serving_sha', d.serving_sha, 'owed_sha', d.owed_sha, 'watch_reason', d.reason,
    'freeze_started_at', v_freeze, 'certified_after_freeze_at', v_cert_at, 'newest_certificate_at', v_any_cert_at,
    'selection_artifacts', coalesce((v_art->>'total_count')::integer, -1),
    'selection_run', CASE WHEN v_run IS NULL THEN NULL ELSE jsonb_build_object('id', v_run->'id', 'conclusion', v_run->'conclusion', 'url', v_run->'html_url') END,
    'owed_build_migrations', v_carried, 'uninstalled_migrations', to_jsonb(v_missing),
    'compare_truncated', coalesce(jsonb_array_length(v_cmp->'files'), 0) >= 300,
    'latest_receipt', CASE WHEN v_exit.run_id IS NULL THEN NULL ELSE to_jsonb(v_exit) END,
    'certification_request', 'none: no safe dispatch route for the controller');
END
$function$;

REVOKE ALL ON FUNCTION smarter_private.reliability_runbook_cutover_diagnosis(uuid, boolean, jsonb, timestamp with time zone) FROM PUBLIC, anon, authenticated;

-- ── 3. Resolve CutoverReadinessAtRisk in fn_ca_engine_cutover_watch ────────
CREATE OR REPLACE FUNCTION public.fn_ca_engine_cutover_watch(
  p_at timestamp with time zone DEFAULT clock_timestamp()
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '50s'
 SET lock_timeout TO '2s'
AS $function$
DECLARE
  c_tz constant text := 'America/Chicago';
  c_repo constant text := 'https://api.github.com/repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena';
  v_local timestamp := p_at AT TIME ZONE c_tz;
  v_day date := v_local::date;
  v_window timestamptz := (v_day + time '04:00') AT TIME ZONE c_tz;
  v_cutoff timestamptz := (v_day + time '03:30') AT TIME ZONE c_tz;
  v_row smarter_private.ca_engine_cutover_days%ROWTYPE;
  v_leader text; v_since timestamptz;
  v_serving text; v_owed jsonb; v_cmp jsonb; v_runs jsonb;
  v_reason text; v_exit record; v_verdict text; v_shipped boolean;
  v_open record; v_id bigint; v_summary text; v_resolved integer := 0;
BEGIN
  SELECT l.engine_version, l.acquired_at INTO v_leader, v_since
    FROM public.engine_leader l ORDER BY l.heartbeat_at DESC NULLS LAST LIMIT 1;
  -- "Since" is the sealed release of that build, not a later restart.
  SELECT COALESCE(max(e.recorded_at), v_since) INTO v_since FROM public.engine_deploy_exit_paths e
   WHERE e.outcome = 'shipped' AND left(e.target_sha, 8) = left(v_leader, 8);
  SELECT * INTO v_row FROM smarter_private.ca_engine_cutover_days WHERE chicago_day = v_day;

  -- Nothing to do: before 04:30 with no alarm open, or today is decided and
  -- no alarm is open. A missed day or firing CutoverReadinessAtRisk stays
  -- checked until production holds the build or the cutover seals.
  IF NOT EXISTS (SELECT 1 FROM public.operational_alert_events
                  WHERE ((source = 'engine-cutover-watch' AND alertname = 'EngineCutoverMissed')
                         OR (source = 'cutover-readiness-watch' AND alertname = 'CutoverReadinessAtRisk'))
                    AND status = 'firing')
     AND (v_local::time < time '04:30' OR v_row.verdict IN ('sealed', 'not_owed')) THEN
    RETURN jsonb_build_object('ok', true, 'state', COALESCE(v_row.verdict, 'before_0430'), 'chicago_day', v_day);
  END IF;

  v_serving := smarter_private.ca_cutover_http_json('https://engine.smarter.poker/health')->>'releaseSha';
  IF v_serving IS NULL OR v_serving !~ '^[0-9a-f]{40}$'
     OR (v_leader IS NOT NULL AND left(v_serving, 8) <> left(v_leader, 8)) THEN
    RETURN jsonb_build_object('ok', false, 'state', 'unknown', 'reason', 'engine /health did not report one releaseSha matching the leader');
  END IF;

  -- An open EngineCutoverMissed alarm closes once production holds the build
  -- it named. Only asked again when the serving build has changed.
  FOR v_open IN
    SELECT o.id, o.event_key, o.payload->>'owed_sha' AS owed, o.payload->>'serving_sha' AS was
      FROM public.operational_alert_events o
     WHERE o.source = 'engine-cutover-watch' AND o.alertname = 'EngineCutoverMissed' AND o.status = 'firing'
  LOOP
    CONTINUE WHEN v_open.was = v_serving;
    v_cmp := smarter_private.ca_cutover_http_json(format('%s/compare/%s...%s', c_repo, v_open.owed, v_serving));
    CONTINUE WHEN v_cmp IS NULL OR v_cmp->>'status' NOT IN ('identical', 'ahead');
    UPDATE public.operational_alert_events
       SET status = 'resolved', last_received_at = p_at,
           payload = payload || jsonb_build_object('resolved_at', p_at,
             'resolution', format('production now holds %s, which contains the owed %s', left(v_serving, 8), left(v_open.owed, 8)))
     WHERE id = v_open.id AND status = 'firing';
    UPDATE smarter_private.ca_engine_cutover_days SET resolved_at = p_at, checked_at = p_at
     WHERE alert_id = v_open.id;
    v_resolved := v_resolved + 1;
  END LOOP;

  -- A 03:00 CutoverReadinessAtRisk alarm (whose watch stops at 03:30) closes
  -- once production holds its freeze baseline, once today's cutover seals or
  -- is not owed, or once its cutover day has passed (20261122145848).
  FOR v_open IN
    SELECT o.id, o.event_key,
           o.payload->'facts'->>'baseline_sha' AS baseline,
           o.payload->'facts'->>'serving_sha' AS was,
           CASE WHEN COALESCE(o.payload->>'cutover_day', '') ~ '^\d{4}-\d{2}-\d{2}$'
                THEN (o.payload->>'cutover_day')::date END AS cday
      FROM public.operational_alert_events o
     WHERE o.source = 'cutover-readiness-watch' AND o.alertname = 'CutoverReadinessAtRisk' AND o.status = 'firing'
  LOOP
    IF v_open.cday IS NOT NULL AND v_open.cday < v_day THEN
      UPDATE public.operational_alert_events
         SET status = 'resolved', last_received_at = p_at,
             payload = payload || jsonb_build_object('resolved_at', p_at,
               'resolution', format('cutover day %s has passed (now %s)', v_open.cday, v_day))
       WHERE id = v_open.id AND status = 'firing';
      v_resolved := v_resolved + 1;
      CONTINUE;
    END IF;
    IF v_row.verdict IN ('sealed', 'not_owed') AND (v_open.cday IS NULL OR v_open.cday = v_day) THEN
      UPDATE public.operational_alert_events
         SET status = 'resolved', last_received_at = p_at,
             payload = payload || jsonb_build_object('resolved_at', p_at,
               'resolution', format('the %s cutover is %s (serving %s)', v_day, v_row.verdict, left(v_serving, 8)))
       WHERE id = v_open.id AND status = 'firing';
      v_resolved := v_resolved + 1;
      CONTINUE;
    END IF;
    CONTINUE WHEN v_open.baseline IS NULL OR v_open.baseline !~ '^[0-9a-f]{40}$' OR v_open.was = v_serving;
    v_cmp := smarter_private.ca_cutover_http_json(format('%s/compare/%s...%s', c_repo, v_open.baseline, v_serving));
    CONTINUE WHEN v_cmp IS NULL OR v_cmp->>'status' NOT IN ('identical', 'ahead');
    UPDATE public.operational_alert_events
       SET status = 'resolved', last_received_at = p_at,
           payload = payload || jsonb_build_object('resolved_at', p_at,
             'resolution', format('production now holds %s, which contains the readiness baseline %s', left(v_serving, 8), left(v_open.baseline, 8)))
     WHERE id = v_open.id AND status = 'firing';
    v_resolved := v_resolved + 1;
  END LOOP;

  IF v_local::time < time '04:30' OR v_row.verdict IN ('sealed', 'not_owed') THEN
    RETURN jsonb_build_object('ok', true, 'state', COALESCE(v_row.verdict, 'before_0430'), 'resolved', v_resolved);
  END IF;
  IF v_row.verdict = 'missed' THEN
    UPDATE smarter_private.ca_engine_cutover_days SET checked_at = p_at, serving_sha = v_serving WHERE chicago_day = v_day;
    RETURN jsonb_build_object('ok', true, 'state', CASE WHEN v_resolved > 0 THEN 'resolved' ELSE 'missed' END,
                              'serving', left(v_serving, 8), 'owed', left(v_row.owed_sha, 8), 'resolved', v_resolved);
  END IF;

  -- First decision for today: which engine build was owed going into 04:00?
  -- The build the freeze can ship: merged by the freeze start minus 30 minutes
  -- (scripts/ci/merged-migration-dispatch.mjs RELEASE_SCHEMA_FREEZE_CHICAGO,
  -- scripts/ci/backup-freeze-baseline.py SETTLE), counted from the cutover date's midnight, 20261119182637.
  v_owed := smarter_private.ca_cutover_owed_build(v_serving, least(v_cutoff, (v_day::timestamp + interval '-45 minutes') AT TIME ZONE c_tz));
  IF v_owed IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'state', 'unknown', 'reason', 'GitHub could not be read', 'serving', left(v_serving, 8));
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.engine_deploy_exit_paths e
                  WHERE e.outcome = 'shipped' AND e.recorded_at >= v_cutoff AND e.recorded_at < p_at
                    AND left(e.target_sha, 8) = left(v_serving, 8)) INTO v_shipped;
  IF (v_owed->>'held')::boolean THEN
    v_verdict := CASE WHEN v_shipped OR (v_since >= v_window - interval '5 minutes' AND v_since < v_window + interval '30 minutes')
                      THEN 'sealed' ELSE 'not_owed' END;
    INSERT INTO smarter_private.ca_engine_cutover_days (chicago_day, checked_at, serving_sha, serving_since, owed_sha, owed_committed_at, verdict)
    VALUES (v_day, p_at, v_serving, v_since, v_owed->>'owed_sha', (v_owed->>'owed_at')::timestamptz, v_verdict)
    ON CONFLICT (chicago_day) DO NOTHING;
    WITH closed_readiness AS (
      UPDATE public.operational_alert_events
         SET status = 'resolved', last_received_at = p_at,
             payload = payload || jsonb_build_object('resolved_at', p_at,
               'resolution', format('the %s cutover is %s (serving %s)', v_day, v_verdict, left(v_serving, 8)))
       WHERE source = 'cutover-readiness-watch' AND alertname = 'CutoverReadinessAtRisk' AND status = 'firing'
         AND COALESCE(payload->>'cutover_day', v_day::text) <= v_day::text
       RETURNING 1
    )
    SELECT v_resolved + count(*) INTO v_resolved FROM closed_readiness;
    RETURN jsonb_build_object('ok', true, 'state', v_verdict, 'serving', left(v_serving, 8),
                              'owed', left(v_owed->>'owed_sha', 8), 'resolved', v_resolved);
  END IF;

  -- Owed and not held: name why. A receiver receipt for this window wins;
  -- without one, say whether GitHub delivered a preparation run at all.
  SELECT e.run_id, e.stage, e.outcome, left(COALESCE(e.error, e.release_result, ''), 200) AS error, e.recorded_at, left(e.target_sha, 8) AS target
    INTO v_exit
    FROM public.engine_deploy_exit_paths e
   WHERE e.recorded_at >= v_cutoff - interval '5 hours' AND e.recorded_at < p_at
   ORDER BY e.recorded_at DESC LIMIT 1;
  IF v_exit.run_id IS NULL THEN
    -- The admitted daily selection job uploads daily-engine-selection-<date>
    -- (stage-engine-release.yml job selection). Present: a preparation ran
    -- and chose nothing to send. Absent: no preparation run was admitted.
    v_runs := smarter_private.ca_cutover_http_json(format('%s/actions/artifacts?name=daily-engine-selection-%s&per_page=1',
                c_repo, to_char(v_day, 'YYYY-MM-DD')));
  END IF;
  v_reason := CASE
    WHEN v_exit.run_id IS NOT NULL AND v_exit.outcome = 'shipped'
      THEN format('a release of %s sealed at %s, but it does not contain %s', v_exit.target,
                  to_char(v_exit.recorded_at AT TIME ZONE c_tz, 'HH24:MI "Central"'), left(v_owed->>'owed_sha', 8))
    WHEN v_exit.run_id IS NOT NULL AND v_exit.stage IN ('admit', 'engine-doors', 'prepare', 'stage')
      THEN format('the release was refused at %s: %s (run %s)', v_exit.stage, v_exit.error, v_exit.run_id)
    WHEN v_exit.run_id IS NOT NULL
      THEN format('the release failed at %s: %s (run %s)', v_exit.stage, v_exit.error, v_exit.run_id)
    WHEN v_runs IS NULL THEN 'no release attempt was recorded; whether a preparation run arrived could not be read from GitHub'
    WHEN COALESCE((v_runs->>'total_count')::int, 0) = 0
      THEN 'no preparation run: no Stage run was admitted for the 03:30-03:50 preparation of this date'
    ELSE 'refused selection: the 03:30 preparation ran but selected no Backup-certified build to send (read its daily-engine-selection artifact)' END;
  v_summary := format('The 4 AM engine update did not happen on %s. Still serving %s (since %s); owed %s. Reason: %s.',
                      to_char(v_day, 'Mon FMDD'), left(v_serving, 8),
                      to_char(v_since AT TIME ZONE c_tz, 'Mon FMDD HH24:MI "Central"'), left(v_owed->>'owed_sha', 8), v_reason);
  v_id := public.fn_record_operational_alert('engine-cutover-watch', 'missed:' || v_day::text, 'EngineCutoverMissed',
    'firing', 'critical', jsonb_build_object(
      'target_task_id', '01a09b86-5ba8-7290-8657-1041f13dd3ca',
      'summary', v_summary, 'chicago_day', v_day, 'serving_sha', v_serving, 'serving_since', v_since,
      'owed_sha', v_owed->>'owed_sha', 'owed_committed_at', v_owed->>'owed_at', 'reason', v_reason,
      'latest_receipt', CASE WHEN v_exit.run_id IS NULL THEN NULL ELSE to_jsonb(v_exit) END, 'at', p_at));
  INSERT INTO smarter_private.ca_engine_cutover_days (chicago_day, checked_at, serving_sha, serving_since, owed_sha, owed_committed_at, verdict, reason, alert_id)
  VALUES (v_day, p_at, v_serving, v_since, v_owed->>'owed_sha', (v_owed->>'owed_at')::timestamptz, 'missed', v_reason, v_id)
  ON CONFLICT (chicago_day) DO NOTHING;
  RETURN jsonb_build_object('ok', true, 'state', 'missed', 'serving', left(v_serving, 8),
                            'owed', left(v_owed->>'owed_sha', 8), 'reason', v_reason, 'alert_id', v_id, 'resolved', v_resolved);
END
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_engine_cutover_watch(timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_engine_cutover_watch(timestamp with time zone) TO service_role;

-- ── 4. Stop fn_ca_cron_failure_watch from re-raising fixed jobs after 3 clean runs
CREATE OR REPLACE FUNCTION public.fn_ca_cron_failure_watch()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET lock_timeout TO '2s'
 SET statement_timeout TO '30s'
AS $function$
DECLARE r record; n integer := 0; v_is_guard boolean; v_raised text[] := '{}';
BEGIN
  FOR r IN
    -- ONE pass over a bounded window. cron.job_run_details is indexed only by
    -- runid, so a per-job "last 3 runs" lookup with no time bound is a full
    -- scan per active job. Here a single scan of the last 7 days ranks each
    -- job's finished runs newest first; the 24 hour counts and the last three
    -- finished runs both come from that one pass. A job that appears in the
    -- 24 hour window runs at least daily, so its last three finished runs fall
    -- inside 7 days.
    WITH runs AS (
      SELECT d.jobid, d.status, d.start_time, d.return_message,
             d.start_time > now() - interval '24 hours' AS in_day,
             CASE WHEN d.status IN ('failed', 'succeeded')
                  THEN row_number() OVER (PARTITION BY d.jobid, d.status IN ('failed', 'succeeded')
                                          ORDER BY d.start_time DESC)
             END AS finished_rank
        FROM cron.job_run_details d
       WHERE d.start_time > now() - interval '7 days'
    ),
    day AS (
      SELECT j.jobid, j.jobname, j.command,
             count(*) FILTER (WHERE x.in_day AND x.status = 'failed')    AS fails,
             count(*) FILTER (WHERE x.in_day AND x.status = 'succeeded') AS successes,
             max(x.start_time) FILTER (WHERE x.in_day AND x.status = 'succeeded') AS last_success,
             max(left(x.return_message, 200)) FILTER (WHERE x.in_day AND x.status = 'failed') AS sample_error,
             count(*) FILTER (WHERE x.finished_rank <= 3) AS finished,
             count(*) FILTER (WHERE x.finished_rank <= 3 AND x.status = 'failed') AS failed_in_a_row,
             -- 20261119171234 + 20261119180800: the newest finished run and 7-day
             -- run count in the same single pass, so a weekly job that fails is
             -- heard immediately without waiting 24 hours.
             count(*) FILTER (WHERE x.in_day) AS runs_24h,
             count(*) FILTER (WHERE x.status IN ('failed', 'succeeded')) AS runs_7d,
             bool_or(x.finished_rank = 1 AND x.status = 'failed') AS last_finished_failed,
             max(x.start_time) FILTER (WHERE x.finished_rank = 1) AS last_finished_at,
             max(left(x.return_message, 200)) FILTER (WHERE x.finished_rank = 1) AS last_finished_error
        FROM cron.job j
        JOIN runs x ON x.jobid = j.jobid
       WHERE j.active
       GROUP BY j.jobid, j.jobname, j.command
      HAVING count(*) FILTER (WHERE x.in_day) > 0
          OR bool_or(x.finished_rank = 1 AND x.status = 'failed')
    )
    SELECT day.*
      FROM day
     WHERE (day.finished = 3 AND day.failed_in_a_row = 3
            AND (day.last_success IS NULL OR day.last_success <= now() - interval '2 hours'))
        -- 20261122145848: once a fixed job completes 3 consecutive clean runs,
        -- stop re-raising its stale 24h failure count so fn_ca_resolve_cleared_incidents
        -- can close the incident; flapping jobs still have failed_in_a_row > 0.
        OR (day.fails >= 5 AND day.fails > day.successes
            AND NOT (day.finished = 3 AND day.failed_in_a_row = 0))
        -- a weekly/infrequent job is heard immediately on its own last run, not
        -- after 24 hours or three weeks (daily/hourly/minute jobs have runs_7d >= 2).
        OR ((day.runs_24h = 0 OR day.runs_7d = 1) AND day.last_finished_failed
            -- 20261119183127 + 20261120001649: A FIXED JOB IS NOT FAILING. A job
            -- whose command is one call of one function is proven healthy by a
            -- completed run of that function recorded in ca_detector_runs after
            -- the failed run; a failed weekly run whose cause was fixed and run
            -- live then clears instead of paging for up to a week.
            AND NOT EXISTS (
              SELECT 1 FROM public.ca_detector_runs pr
               WHERE day.command ~* '^\s*select\s+(public\.)?fn_[a-z0-9_]+\(\s*\)\s*;?\s*$'
                 AND pr.detector = substring(day.command from '(fn_[A-Za-z0-9_]+)\(')
                 AND pr.ran_at > day.last_finished_at
                 AND COALESCE((pr.detail->>'pass')::boolean, true)))
     -- Infrequent/weekly failures sort first so 20 frequent failing jobs cannot
     -- truncate a failed weekly guard out of the LIMIT 20 window.
     ORDER BY ((day.runs_24h = 0 OR day.runs_7d = 1) AND day.last_finished_failed) DESC, day.fails DESC, day.jobname
     LIMIT 20
  LOOP
    SELECT EXISTS (SELECT 1 FROM public.ca_guard_inventory g
                    WHERE g.kind = 'cron' AND g.object_a = r.jobname AND g.active)
      INTO v_is_guard;
    PERFORM public.fn_ca_raise_drift_incident(
      'fn_ca_cron_failure_watch', 'unknown',
      CASE WHEN v_is_guard THEN 'critical' ELSE 'warning' END,
      CASE WHEN r.runs_24h = 0 OR r.runs_7d = 1
           THEN 'cron-failing:' || r.jobname || ':run:' || to_char(r.last_finished_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI')
           ELSE 'cron-failing:' || r.jobname || ':' || CURRENT_DATE::text END,
      0, NULL, NULL, 'reporting', 'cron.job_run_details',
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      CASE WHEN r.runs_24h = 0 OR r.runs_7d = 1
           THEN 'scheduled job ' || r.jobname || ' (infrequent/weekly, ' || r.runs_7d
                || ' finished run in 7d) failed its last run at '
                || r.last_finished_at::text || ' with no success since. Last error: '
                || COALESCE(r.last_finished_error, '?')
      ELSE
      'scheduled job ' || r.jobname || ' failed ' || r.fails || ' of '
        || (r.fails + r.successes) || ' runs in 24h (last '
        || r.failed_in_a_row || ' of its last 3 failed; last success '
        || COALESCE(r.last_success::text, 'none in 24h') || '). Last error: '
        || COALESCE(r.sample_error, '?') END,
      NULL, jsonb_build_object('jobname', r.jobname, 'fails_24h', r.fails,
                               'successes_24h', r.successes,
                               'failed_in_a_row', r.failed_in_a_row,
                               'last_success', r.last_success));
    v_raised := v_raised || r.jobname::text;
    n := n + 1;
  END LOOP;

  /* 2026-11-07: a job failing run after run is raised by its streak, not
     only after two hours with no success at all. Isolated like the ledger
     watch below, so a fault here never stops the rules above, and a failure
     of its own is a critical incident rather than a silent zero. */
  BEGIN
    FOR r IN SELECT f.* FROM public.fn_cron_failing_jobs() f
              WHERE NOT (f.jobname = ANY (v_raised))
    LOOP
      PERFORM public.fn_ca_raise_drift_incident(
        'fn_ca_cron_failure_watch', 'unknown',
        CASE WHEN r.is_guard THEN 'critical' ELSE 'warning' END,
        'cron-failing:' || r.jobname || ':' || CURRENT_DATE::text,
        0, NULL, NULL, 'reporting', 'cron.job_run_details',
        NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
        'scheduled job ' || r.jobname || ' is failing repeatedly: '
          || r.failed_in_a_row || ' failed runs in a row'
          || COALESCE(' since ' || r.failing_since::text, '')
          || ', ' || r.failed_of_last_20 || ' of its last 20 runs failed (last success '
          || COALESCE(r.last_success::text, 'not in the last ~7 hours') || '). Last error: '
          || COALESCE(r.last_error, '?'),
        NULL, jsonb_build_object('jobname', r.jobname,
                                 'failed_in_a_row', r.failed_in_a_row,
                                 'failing_since', r.failing_since,
                                 'failed_of_last_20', r.failed_of_last_20,
                                 'last_success', r.last_success,
                                 'rule', 'streak'));
      n := n + 1;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.fn_ca_raise_drift_incident(
      'fn_ca_cron_failure_watch', 'unknown', 'critical',
      'cron-failing-streak-read-failed:' || CURRENT_DATE::text,
      NULL, NULL, NULL, 'reporting', 'cron.job_run_details',
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      'fn_cron_failing_jobs failed, so a job failing run after run cannot be told from a healthy one: ' || SQLERRM,
      NULL, NULL);
  END;

  /* 20261002135708: a ledger refusal the counter saw and no record reached
     becomes an explicit row and a critical incident here. Isolated, so it can
     never stop the cron watch above from reporting, and a failure of its own
     is itself a critical incident rather than a silent zero. */
  BEGIN
    n := n + public.fn_ca_ledger_invariant_refusal_watch();
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.fn_ca_raise_drift_incident(
      'ledger_invariant.refused', 'unknown', 'critical',
      'ledger-invariant-refusal-watch-failed',
      NULL, NULL, NULL, 'ledger', 'chip_store',
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      'fn_ca_ledger_invariant_refusal_watch failed, so a ledger refusal whose record was lost cannot be told from no refusal: ' || SQLERRM,
      NULL, NULL);
  END;
  -- A completed run is a re-measurement fn_ca_resolve_cleared_incidents reads.
  INSERT INTO public.ca_detector_runs (detector, detail)
  VALUES ('fn_ca_cron_failure_watch', jsonb_build_object('raised', n));
  RETURN n;
END $function$;

REVOKE ALL ON FUNCTION public.fn_ca_cron_failure_watch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_cron_failure_watch() TO service_role;

SELECT public.fn_ca_declare_guard_redefinition('fn_ca_cron_failure_watch', 'migration 20261122145848_cutover_readiness_classification_resolution_and_cron_recover');

-- @probe-for: public.fn_ca_cron_failure_watch
DO $probe$
BEGIN
  PERFORM public.fn_ca_cron_failure_watch();
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- ── 5. Resolve the 4 verified guard-def drift incidents from 20261121154220 ─
DO $resolve_watch_timeout_guard_incidents$
DECLARE
  v_declared integer;
BEGIN
  IF to_regclass('public.ca_drift_incidents') IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.ca_drift_incidents
     WHERE id IN (
       '54d7fe1e-661d-436a-a5e1-6b60720d00fb',
       'f4733687-4d8d-4577-a996-729688975e9d',
       '77b028f4-5c18-4564-a568-1ae4bdc098aa',
       '1e303f5e-fade-456a-ab9e-bd92c632f0b3'
     )
       AND status <> 'resolved'
  ) THEN
    RETURN;
  END IF;

  SELECT count(*) INTO v_declared
    FROM public.ca_guard_defs
   WHERE (proname IN ('fn_ca_guard_defs_watch', 'fn_ca_negative_balance_watch', 'fn_ca_mint_velocity_watch')
          AND declared_ref LIKE '%20261122145633%')
      OR (proname = 'fn_ca_cron_failure_watch'
          AND declared_ref LIKE '%20261122145848%');

  IF v_declared <> 4 THEN
    RAISE EXCEPTION 'refusing to close guard-def drift incidents before all 4 declarations are recorded (got %)', v_declared;
  END IF;

  UPDATE public.ca_drift_incidents
     SET status = 'resolved',
         resolved_at = GREATEST(now(), detected_at),
         closure_basis = 'verified_remeasured',
         root_cause = 'Installed migration 20261121154220 added bounded lock_timeout (2s) and statement_timeout (30s) to all public.fn_ca_%_watch functions via dynamic ALTER FUNCTION without calling fn_ca_declare_guard_redefinition, altering pg_get_functiondef() for 4 watched guards.',
         resolution = 'Verified exact live function hashes and schema_migrations digest match 20261121154220; recorded forward declarations in migration 20261122145633 and hardened a-declared-guard-change-is-recorded-not-raised.law.test.ts to catch static and dynamic ALTER FUNCTION.',
         correction_ref = 'migration 20261122145633_declare_the_four_installed_watch_timeout_guards'
   WHERE id IN (
     '54d7fe1e-661d-436a-a5e1-6b60720d00fb',
     'f4733687-4d8d-4577-a996-729688975e9d',
     '77b028f4-5c18-4564-a568-1ae4bdc098aa',
     '1e303f5e-fade-456a-ab9e-bd92c632f0b3'
   )
     AND status <> 'resolved';
END
$resolve_watch_timeout_guard_incidents$;

COMMIT;
