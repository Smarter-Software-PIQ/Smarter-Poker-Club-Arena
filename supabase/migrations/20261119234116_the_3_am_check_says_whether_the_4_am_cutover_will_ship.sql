-- 20261119234116_the_3_am_check_says_whether_the_4_am_cutover_will_ship.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- ============================================================================
-- AT 3 AM THE DATABASE SAYS WHETHER THE 4 AM ENGINE CUTOVER WILL SHIP
-- (owner order, 2026-11-19 17:26 Chicago; incident 076ff467)
-- ============================================================================
--
-- WHAT WENT WRONG: the 04:00 Chicago cutover missed four mornings running
-- (2026-11-16..19). Every miss was knowable well before 04:00: no build the
-- 03:30 selection could take had a Backup certificate written after that
-- night's release schema freeze began, or a merged migration was still
-- uninstalled. Nobody heard until fn_ca_engine_cutover_watch paged at 04:30,
-- after the window had closed.
--
-- WHAT THIS ADDS (a read-only watch; it starts, retries or changes nothing):
--
-- 1. public.fn_ca_cutover_readiness_watch(p_at, p_dry_run) - pg_cron at
--    :00, :15 and :25 of 08 and 09 UTC, which is 03:00-03:25 Chicago in CST
--    and in CDT; the function reads America/Chicago itself and returns at once,
--    with no outside read, unless the Chicago clock is in [03:00, 03:30).
--    GitHub schedules arrive 7-10 hours late, so the database clock is the
--    only trigger. At 03:00 it judges the 04:00 cutover of that date:
--
--    a. a candidate the 03:30 selection will accept exists: the freeze
--       baseline (newest protected-main commit touching server/ merged at
--       least 30 minutes before the freeze began, as
--       scripts/ci/backup-freeze-baseline.py names it) or, failing that, one
--       of the newest server commits after it, holds a SUCCESS
--       backup-engine/certified status written after the freeze began, and
--       every migration file it adds since the serving build is installed
--       (fn_ca_installed_migration_listing; a file declared for the
--       maintenance window is exempt, as the selector exempts it). When the
--       serving build already contains the baseline nothing is owed;
--    b. no merged ordinary migration from before the freeze is uninstalled
--       (smarter_private.ca_merged_migration_watch);
--    c. no Spin board has waited past the 8,400 s ladder envelope
--       (v_spin_unfilled_waits; SPIN_LADDER_FULL_ENVELOPE_SECONDS), and no
--       tournament is stuck RUNNING past setting stuck_tournament_hours (the
--       predicate of fn_sp_critical_scan);
--    d. engine /health is healthy (status, liveness, settlement, whole-fleet
--       stall, dealer prerequisites) and reports the database leader's build.
--
--    GitHub is read through smarter_private.ca_cutover_http_json
--    (unauthenticated public REST, rate-limited): at most 10 requests a run,
--    and a run that found the cutover ready is not repeated that night.
--    Every run's verdict and facts are kept in
--    smarter_private.ca_cutover_readiness_runs. A not_ready verdict raises
--    ONE critical "CutoverReadinessAtRisk" alert (source
--    cutover-readiness-watch, key readiness:<cutover date>) naming each
--    reason, paged through the existing owner route as its own kind
--    'cutover_readiness' ("4 AM Engine Update At Risk"), with its own episode
--    clock so it never holds back the 04:30 'releases' page. A later run that
--    finds the cutover ready resolves it in place. "Could not tell" stays its
--    own verdict (CLAUDE.md 10.86): it is recorded and pages nothing.
--
--    p_dry_run => true evaluates the next 04:00 at any hour and writes
--    nothing (no row, no alert): the read-only live proof.
--
-- 2. fn_sp_digest_engine_cutover gains 'readiness': the last 03:00 verdict
--    for the cutover it reports, with its reasons.
--
-- Pinned by tests/the-three-am-check-says-whether-four-am-will-ship.law.test.ts;
-- native proof scripts/ci/test-the-three-am-cutover-readiness-check.py
-- (PostgreSQL 17, never production).
--
-- periodic-work: a detector that pages a person; it moves no money, seats, lobbies or releases, retries nothing and repairs nothing. It must run from the database clock because the failure it foresees is a GitHub schedule that does not arrive on time.
--
-- @probe-exempt: public.fn_ca_cutover_readiness_watch the watch reads GitHub and engine.smarter.poker over extensions.http, which a probe must not do from an install transaction; its dry run is executed live right after install
-- @probe-exempt: public.fn_ca_a_real_alert_reaches_the_owner trigger function on operational_alert_events, not callable directly; the static plpgsql_check gate covers it
--
-- @live-proof: (SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ca-cutover-readiness-watch-3am' AND schedule = '0,15,25 8,9 * * *' AND active) AND to_regprocedure('public.fn_ca_cutover_readiness_watch(timestamp with time zone, boolean)') IS NOT NULL AND to_regclass('smarter_private.ca_cutover_readiness_runs') IS NOT NULL AND public.fn_ca_owner_page_kind('cutover-readiness-watch', 'CutoverReadinessAtRisk', 'critical') = 'cutover_readiness' AND public.fn_ca_owner_page_kind('engine-cutover-watch', 'EngineCutoverMissed', 'critical') = 'releases' AND EXISTS (SELECT 1 FROM public.ca_owner_page_state WHERE kind = 'cutover_readiness') AND strpos(pg_get_functiondef('public.fn_ca_a_real_alert_reaches_the_owner()'::regprocedure), '4 AM Engine Update At Risk') > 0 AND strpos(pg_get_functiondef('public.fn_sp_digest_engine_cutover(date)'::regprocedure), 'ca_cutover_readiness_runs') > 0 AND NOT has_function_privilege('anon', 'public.fn_ca_cutover_readiness_watch(timestamp with time zone, boolean)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.fn_ca_cutover_readiness_watch(timestamp with time zone, boolean)', 'EXECUTE'))

BEGIN;
SET LOCAL lock_timeout = '4s';
SET LOCAL statement_timeout = '20s';

-- Every verdict the watch reaches, one row per run. No foreign key
-- (CLAUDE.md section 2 rule 7).
CREATE TABLE smarter_private.ca_cutover_readiness_runs (
  id bigserial PRIMARY KEY,
  cutover_day date NOT NULL,
  checked_at timestamptz NOT NULL,
  verdict text NOT NULL CHECK (verdict IN ('ready', 'not_owed', 'not_ready', 'unknown')),
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  unknowns jsonb NOT NULL DEFAULT '[]'::jsonb,
  facts jsonb NOT NULL DEFAULT '{}'::jsonb,
  alert_id bigint
);
CREATE INDEX ca_cutover_readiness_runs_day ON smarter_private.ca_cutover_readiness_runs (cutover_day, checked_at DESC);
REVOKE ALL ON smarter_private.ca_cutover_readiness_runs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE smarter_private.ca_cutover_readiness_runs_id_seq FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE smarter_private.ca_cutover_readiness_runs IS
  'One row per 03:00-03:25 Chicago run of fn_ca_cutover_readiness_watch: will the 04:00 engine cutover of cutover_day ship (20261119234116).';

CREATE OR REPLACE FUNCTION public.fn_ca_cutover_readiness_watch(
  p_at timestamptz DEFAULT clock_timestamp(), p_dry_run boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '120s'
AS $function$
DECLARE
  c_tz constant text := 'America/Chicago';
  c_repo constant text := 'https://api.github.com/repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena';
  c_context constant text := 'backup-engine/certified';
  c_file constant text := '^supabase/migrations/([0-9]{14})_[A-Za-z0-9_.-]+\.sql$';
  -- SPIN_LADDER_FULL_ENVELOPE_SECONDS (server/src/services/SpinMetrics.ts).
  c_envelope constant integer := 8400;
  -- The release schema freeze starts 23:45 Chicago the evening before
  -- (scripts/ci/merged-migration-dispatch.mjs RELEASE_SCHEMA_FREEZE_CHICAGO),
  -- written as an offset from the cutover date's midnight; the baseline is
  -- merged at least SETTLE before it (scripts/ci/backup-freeze-baseline.py).
  c_freeze_offset constant interval := interval '-15 minutes';
  c_settle constant interval := interval '30 minutes';
  c_walk constant integer := 4;
  v_local timestamp := p_at AT TIME ZONE c_tz;
  v_day date;
  v_freeze timestamptz;
  v_until timestamptz;
  v_frozen boolean;
  v_last record;
  v_health jsonb; v_serving text; v_leader text;
  v_reasons jsonb := '[]'::jsonb;
  v_unknowns jsonb := '[]'::jsonb;
  v_facts jsonb := '{}'::jsonb;
  v_list jsonb; v_commit jsonb; v_baseline text; v_baseline_at timestamptz;
  v_cmp jsonb; v_cmp_base jsonb; v_owed boolean; v_statuses jsonb; v_cert jsonb; v_latest jsonb;
  v_candidate text; v_candidate_cert timestamptz; v_missing text[]; v_tried jsonb := '[]'::jsonb;
  v_runs jsonb; v_spin record; v_stuck record; v_hours integer;
  v_verdict text; v_summary text; v_key text; v_id bigint; v_run_id bigint; v_resolved integer := 0;
  v_sha text;
  v_installed text[];
BEGIN
  -- The cutover judged: the next 04:00 Chicago at or after p_at.
  v_day := CASE WHEN v_local::time < time '04:00' THEN v_local::date ELSE v_local::date + 1 END;

  IF NOT p_dry_run THEN
    IF v_local::time < time '03:00' OR v_local::time >= time '03:30' THEN
      RETURN jsonb_build_object('ok', true, 'state', 'outside', 'cutover_day', v_day);
    END IF;
    SELECT r.verdict, r.checked_at INTO v_last
      FROM smarter_private.ca_cutover_readiness_runs r
     WHERE r.cutover_day = v_day ORDER BY r.checked_at DESC LIMIT 1;
    IF FOUND AND v_last.verdict IN ('ready', 'not_owed') THEN
      RETURN jsonb_build_object('ok', true, 'state', v_last.verdict, 'decided_at', v_last.checked_at, 'cutover_day', v_day);
    END IF;
  END IF;

  v_freeze := (v_day::timestamp + c_freeze_offset) AT TIME ZONE c_tz;
  v_until := v_freeze - c_settle;
  v_frozen := p_at >= v_freeze;
  v_facts := jsonb_build_object('cutover_day', v_day, 'checked_at', p_at, 'freeze_start', v_freeze,
                                'freeze_started', v_frozen, 'dry_run', p_dry_run);

  -- d. Engine /health.
  SELECT l.engine_version INTO v_leader FROM public.engine_leader l ORDER BY l.heartbeat_at DESC NULLS LAST LIMIT 1;
  v_health := smarter_private.ca_cutover_http_json('https://engine.smarter.poker/health');
  IF v_health IS NULL OR jsonb_typeof(v_health) <> 'object' THEN
    v_reasons := v_reasons || to_jsonb('engine /health did not answer'::text);
  ELSE
    v_serving := v_health->>'releaseSha';
    v_facts := v_facts || jsonb_build_object('serving_sha', v_serving, 'engine', jsonb_build_object(
      'status', v_health->>'status', 'liveness', v_health->>'liveness', 'settlement', v_health->>'settlementStatus',
      'whole_fleet_stalled', v_health->'wholeFleetStalled', 'dealer_ready', v_health->'dealerPrerequisitesReady',
      'leader', v_leader));
    IF COALESCE(v_health->>'status', '') <> 'ok' OR COALESCE(v_health->>'liveness', '') <> 'ok'
       OR COALESCE(v_health->>'settlementStatus', 'ok') <> 'ok'
       OR COALESCE(v_health->>'wholeFleetStalled', 'false') = 'true'
       OR COALESCE(v_health->>'dealerPrerequisitesReady', 'true') = 'false' THEN
      v_reasons := v_reasons || to_jsonb(format('engine /health is not healthy (status %s, liveness %s, settlement %s, whole fleet stalled %s, dealer ready %s)',
        COALESCE(v_health->>'status', 'none'), COALESCE(v_health->>'liveness', 'none'),
        COALESCE(v_health->>'settlementStatus', 'none'), COALESCE(v_health->>'wholeFleetStalled', 'none'),
        COALESCE(v_health->>'dealerPrerequisitesReady', 'none')));
    END IF;
    IF v_serving IS NULL OR v_serving !~ '^[0-9a-f]{40}$' THEN
      v_reasons := v_reasons || to_jsonb('engine /health reports no releaseSha'::text);
      v_serving := NULL;
    ELSIF v_leader IS NOT NULL AND left(v_serving, 8) <> left(v_leader, 8) THEN
      v_reasons := v_reasons || to_jsonb(format('engine /health serves %s but the database leader is %s', left(v_serving, 8), left(v_leader, 8)));
    END IF;
  END IF;

  -- The installed ledger, read through the existing reader
  -- (fn_ca_installed_migration_listing: supabase_migrations.schema_migrations).
  v_installed := ARRAY(SELECT j->>0 FROM json_array_elements(public.fn_ca_installed_migration_listing()) j);

  -- b. No merged ordinary migration from before the freeze is uninstalled.
  --    (A dry run before the freeze allows the installer its 30 minutes.)
  SELECT array_agg(w.version ORDER BY w.version) INTO v_missing
    FROM smarter_private.ca_merged_migration_watch w
   WHERE w.merged_at < least(v_freeze, p_at - interval '30 minutes')
     AND w.window_install IS NOT TRUE AND w.retired_at IS NULL AND w.superseded_by IS NULL
     AND w.version <> ALL (v_installed);
  IF v_missing IS NOT NULL THEN
    v_facts := v_facts || jsonb_build_object('uninstalled_before_freeze', to_jsonb(v_missing));
    v_reasons := v_reasons || to_jsonb(format('%s merged migration(s) from before the freeze are not installed: %s',
      cardinality(v_missing), array_to_string(v_missing[1:5], ', ')));
  END IF;

  -- c. Nothing stuck: Spin boards past the ladder envelope, tournaments stuck RUNNING.
  SELECT count(*) FILTER (WHERE extract(epoch FROM w.longest_wait) > c_envelope) AS n,
         (array_agg(w.tournament_id ORDER BY w.longest_wait DESC NULLS LAST))[1] AS tid,
         (array_agg(w.name ORDER BY w.longest_wait DESC NULLS LAST))[1] AS name,
         max(extract(epoch FROM w.longest_wait))::bigint AS wait_s
    INTO v_spin FROM public.v_spin_unfilled_waits w;
  v_facts := v_facts || jsonb_build_object('spin_longest_wait_s', v_spin.wait_s, 'spin_envelope_s', c_envelope);
  IF COALESCE(v_spin.n, 0) > 0 THEN
    v_reasons := v_reasons || to_jsonb(format('%s Spin board(s) waited past the %s s envelope; longest "%s" (%s) at %s s',
      v_spin.n, c_envelope, v_spin.name, left(v_spin.tid::text, 8), v_spin.wait_s));
  END IF;
  v_hours := COALESCE(public.fn_sp_setting('stuck_tournament_hours', 12)::int, 12);
  SELECT count(*) AS n, (array_agg(t.name ORDER BY t.started_at))[1] AS name,
         (array_agg(t.id ORDER BY t.started_at))[1] AS tid
    INTO v_stuck FROM public.tournaments t
   WHERE t.status = 'RUNNING' AND t.started_at < p_at - make_interval(hours => v_hours);
  v_facts := v_facts || jsonb_build_object('stuck_tournaments', v_stuck.n);
  IF v_stuck.n > 0 THEN
    v_reasons := v_reasons || to_jsonb(format('%s tournament(s) stuck RUNNING over %s hours; oldest "%s" (%s)',
      v_stuck.n, v_hours, v_stuck.name, left(v_stuck.tid::text, 8)));
  END IF;

  -- a. A Backup-certified candidate the 03:30 selection will accept.
  v_list := smarter_private.ca_cutover_http_json(format('%s/commits?sha=main&path=server&per_page=1&until=%s', c_repo,
              to_char(least(v_until, p_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
  IF v_list IS NULL OR jsonb_typeof(v_list) <> 'array' OR jsonb_array_length(v_list) = 0
     OR COALESCE(v_list->0->>'sha', '') !~ '^[0-9a-f]{40}$' THEN
    v_unknowns := v_unknowns || to_jsonb('GitHub could not be read: the freeze baseline'::text);
  ELSE
    v_baseline := v_list->0->>'sha';
    v_baseline_at := (v_list->0->'commit'->'committer'->>'date')::timestamptz;
    v_facts := v_facts || jsonb_build_object('baseline_sha', v_baseline, 'baseline_at', v_baseline_at);
  END IF;

  IF v_baseline IS NOT NULL AND v_serving IS NOT NULL THEN
    v_cmp := smarter_private.ca_cutover_http_json(format('%s/compare/%s...%s', c_repo, v_serving, v_baseline));
    IF v_cmp IS NULL OR v_cmp->>'status' IS NULL THEN
      v_unknowns := v_unknowns || to_jsonb('GitHub could not be read: does the serving build hold the baseline'::text);
    ELSE
      v_owed := v_cmp->>'status' NOT IN ('identical', 'behind');
      v_cmp_base := v_cmp;
      v_facts := v_facts || jsonb_build_object('owed', v_owed, 'serving_vs_baseline', v_cmp->>'status');
    END IF;
  END IF;

  IF v_owed THEN
    -- The baseline first, then the newest server commits after it (the
    -- selector walks newest first and takes the first that qualifies).
    v_list := '[]'::jsonb;
    IF p_at > v_until THEN
      v_list := smarter_private.ca_cutover_http_json(format('%s/commits?sha=main&path=server&per_page=%s&since=%s&until=%s',
                  c_repo, c_walk, to_char(v_until AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                  to_char(p_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
      IF v_list IS NULL OR jsonb_typeof(v_list) <> 'array' THEN v_list := '[]'::jsonb; END IF;
    END IF;
    v_list := v_list || jsonb_build_array(jsonb_build_object('sha', v_baseline));
    FOR v_commit IN SELECT x FROM jsonb_array_elements(v_list) x LOOP
      v_sha := v_commit->>'sha';
      CONTINUE WHEN v_sha IS NULL OR v_sha !~ '^[0-9a-f]{40}$';
      CONTINUE WHEN v_sha = v_baseline AND v_commit ? 'commit';  -- the baseline is asked last, once
      v_statuses := smarter_private.ca_cutover_http_json(format('%s/commits/%s/statuses?per_page=100', c_repo, v_sha));
      IF v_statuses IS NULL OR jsonb_typeof(v_statuses) <> 'array' THEN
        v_tried := v_tried || jsonb_build_object('sha', left(v_sha, 8), 'certificate', 'unreadable');
        CONTINUE;
      END IF;
      SELECT s INTO v_latest FROM jsonb_array_elements(v_statuses) s
       WHERE s->>'context' = c_context ORDER BY (s->>'created_at')::timestamptz DESC LIMIT 1;
      SELECT min((s->>'created_at')::timestamptz) INTO v_candidate_cert FROM jsonb_array_elements(v_statuses) s
       WHERE s->>'context' = c_context AND s->>'state' = 'success'
         AND (s->>'created_at')::timestamptz >= v_freeze AND (s->>'created_at')::timestamptz <= p_at;
      v_tried := v_tried || jsonb_build_object('sha', left(v_sha, 8),
        'certificate', COALESCE(v_latest->>'state', 'none'), 'certificate_at', v_latest->>'created_at',
        'certified_after_freeze', v_candidate_cert IS NOT NULL);
      CONTINUE WHEN v_candidate_cert IS NULL;
      -- Every migration file the candidate adds since serving is installed.
      v_cmp := CASE WHEN v_sha = v_baseline THEN v_cmp_base
                    ELSE smarter_private.ca_cutover_http_json(format('%s/compare/%s...%s', c_repo, v_serving, v_sha)) END;
      IF v_cmp IS NULL OR jsonb_typeof(v_cmp->'files') <> 'array' THEN
        v_tried := v_tried || jsonb_build_object('sha', left(v_sha, 8), 'migrations', 'unreadable');
        CONTINUE;
      END IF;
      SELECT array_agg(substring(f->>'filename' FROM c_file) ORDER BY f->>'filename') INTO v_missing
        FROM jsonb_array_elements(v_cmp->'files') f
       WHERE f->>'status' IN ('added', 'renamed') AND f->>'filename' ~ c_file
         AND substring(f->>'filename' FROM c_file) <> ALL (v_installed)
         AND NOT EXISTS (SELECT 1 FROM smarter_private.ca_merged_migration_watch w
                          WHERE w.version = substring(f->>'filename' FROM c_file) AND (w.window_install OR w.superseded_by IS NOT NULL));
      IF v_missing IS NOT NULL THEN
        v_tried := v_tried || jsonb_build_object('sha', left(v_sha, 8), 'uninstalled', to_jsonb(v_missing));
        CONTINUE;
      END IF;
      v_candidate := v_sha;
      EXIT;
    END LOOP;
    v_facts := v_facts || jsonb_build_object('candidates', v_tried, 'candidate_sha', v_candidate,
                                             'candidate_certified_at', v_candidate_cert);
    IF v_candidate IS NULL AND v_frozen THEN
      -- Name what the Backup lane is doing, so the page says where to look.
      v_runs := smarter_private.ca_cutover_http_json(format('%s/actions/workflows/backup-engine.yml/runs?per_page=1', c_repo));
      v_facts := v_facts || jsonb_build_object('latest_backup_run', CASE WHEN v_runs->'workflow_runs'->0 IS NULL THEN NULL ELSE jsonb_build_object(
        'id', v_runs->'workflow_runs'->0->'id', 'status', v_runs->'workflow_runs'->0->>'status',
        'conclusion', v_runs->'workflow_runs'->0->>'conclusion', 'head_sha', left(v_runs->'workflow_runs'->0->>'head_sha', 8),
        'created_at', v_runs->'workflow_runs'->0->>'created_at') END);
      IF jsonb_array_length(v_tried) = 0 OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_tried) t WHERE t->>'certificate' <> 'unreadable') THEN
        v_unknowns := v_unknowns || to_jsonb('GitHub could not be read: Backup certificates'::text);
      ELSE
        -- First, so the 300-character page leads with it.
        v_reasons := jsonb_build_array(format(
          'no Backup-certified build the 03:30 selection can take: freeze baseline %s (merged %s Central) has %s since the freeze began at %s Central%s%s%s',
          left(v_baseline, 8), COALESCE(to_char(v_baseline_at AT TIME ZONE c_tz, 'Mon FMDD HH24:MI'), 'unknown'),
          COALESCE((SELECT CASE WHEN t ? 'uninstalled' THEN 'a certificate but uninstalled migrations ' || (t->'uninstalled')::text
                                WHEN (t->>'certificate') = 'none' THEN 'no backup-engine/certified status'
                                ELSE 'certificate ' || (t->>'certificate') || ' at ' || COALESCE(to_char((t->>'certificate_at')::timestamptz AT TIME ZONE c_tz, 'Mon FMDD HH24:MI'), '?') END
                      FROM jsonb_array_elements(v_tried) t WHERE t->>'sha' = left(v_baseline, 8)
                      ORDER BY (t ? 'uninstalled') DESC LIMIT 1), 'no readable certificate'),
          to_char(v_freeze AT TIME ZONE c_tz, 'HH24:MI'),
          CASE WHEN jsonb_array_length(v_tried) > 1 THEN format(' (%s newer build(s) checked, none certified and installable)',
                 (SELECT count(DISTINCT t->>'sha') - 1 FROM jsonb_array_elements(v_tried) t)) ELSE '' END,
          COALESCE((SELECT '; ' || string_agg(format('%s is certified but migration(s) %s are not installed', t->>'sha',
                                                     (SELECT string_agg(u, ', ') FROM jsonb_array_elements_text(t->'uninstalled') u)), '; ')
                      FROM jsonb_array_elements(v_tried) t WHERE t ? 'uninstalled' AND t->>'sha' <> left(v_baseline, 8)), ''),
          CASE WHEN v_facts->'latest_backup_run' IS NULL OR v_facts->'latest_backup_run' = 'null'::jsonb THEN ''
               ELSE format('; newest Backup run %s is %s%s for %s', v_facts->'latest_backup_run'->>'id',
                      v_facts->'latest_backup_run'->>'status',
                      COALESCE('/' || (v_facts->'latest_backup_run'->>'conclusion'), ''),
                      v_facts->'latest_backup_run'->>'head_sha') END)) || v_reasons;
      END IF;
    END IF;
  END IF;

  v_verdict := CASE
    WHEN jsonb_array_length(v_reasons) > 0 THEN 'not_ready'
    WHEN jsonb_array_length(v_unknowns) > 0 THEN 'unknown'
    WHEN v_owed IS FALSE THEN 'not_owed'
    WHEN v_candidate IS NOT NULL THEN 'ready'
    -- Only a dry run can ask before the freeze: no certificate can exist yet.
    WHEN NOT v_frozen THEN 'pending'
    ELSE 'unknown' END;

  IF p_dry_run THEN
    RETURN jsonb_build_object('ok', true, 'dry_run', true, 'state', v_verdict,
      'reasons', v_reasons, 'unknowns', v_unknowns, 'facts', v_facts);
  END IF;

  INSERT INTO smarter_private.ca_cutover_readiness_runs (cutover_day, checked_at, verdict, reasons, unknowns, facts)
  VALUES (v_day, p_at, v_verdict, v_reasons, v_unknowns, v_facts)
  RETURNING id INTO v_run_id;

  -- A firing alarm for an earlier cutover is closed by tonight's first run.
  UPDATE public.operational_alert_events
     SET status = 'resolved', last_received_at = p_at,
         payload = payload || jsonb_build_object('resolved_at', p_at,
           'resolution', format('superseded by the %s check of the %s cutover', to_char(p_at AT TIME ZONE c_tz, 'HH24:MI'), v_day))
   WHERE source = 'cutover-readiness-watch' AND alertname = 'CutoverReadinessAtRisk' AND status = 'firing'
     AND COALESCE(payload->>'cutover_day', '') <> v_day::text;
  GET DIAGNOSTICS v_resolved = ROW_COUNT;

  IF v_verdict = 'not_ready' THEN
    v_summary := format('The 4 AM engine update on %s is at risk (checked %s Central). %s.',
      to_char(v_day, 'Mon FMDD'), to_char(p_at AT TIME ZONE c_tz, 'HH24:MI'),
      (SELECT string_agg(r, '; ') FROM jsonb_array_elements_text(v_reasons) r));
    -- One alarm per episode: a repeat delivery while it fires pages nothing;
    -- after a resolution a fresh key pages again.
    v_key := 'readiness:' || v_day::text;
    IF EXISTS (SELECT 1 FROM public.operational_alert_events
                WHERE source = 'cutover-readiness-watch' AND event_key = v_key AND status <> 'firing') THEN
      v_key := v_key || ':' || to_char(p_at AT TIME ZONE c_tz, 'HH24MI');
    END IF;
    v_id := public.fn_record_operational_alert('cutover-readiness-watch', v_key, 'CutoverReadinessAtRisk',
      'firing', 'critical', jsonb_build_object(
        'target_task_id', '01a09b86-5ba8-7290-8657-1041f13dd3ca',
        'summary', left(v_summary, 1000), 'cutover_day', v_day, 'reasons', v_reasons,
        'facts', v_facts, 'run_id', v_run_id, 'at', p_at));
    UPDATE smarter_private.ca_cutover_readiness_runs SET alert_id = v_id WHERE id = v_run_id;
  ELSIF v_verdict IN ('ready', 'not_owed') THEN
    WITH closed AS (
      UPDATE public.operational_alert_events
         SET status = 'resolved', last_received_at = p_at,
             payload = payload || jsonb_build_object('resolved_at', p_at,
               'resolution', format('the %s check found the cutover %s', to_char(p_at AT TIME ZONE c_tz, 'HH24:MI'),
                                    CASE v_verdict WHEN 'ready' THEN 'ready with ' || left(v_candidate, 8) ELSE 'not owed' END))
       WHERE source = 'cutover-readiness-watch' AND alertname = 'CutoverReadinessAtRisk' AND status = 'firing'
       RETURNING 1)
    SELECT v_resolved + count(*) INTO v_resolved FROM closed;
  END IF;

  RETURN jsonb_build_object('ok', true, 'state', v_verdict, 'cutover_day', v_day, 'run_id', v_run_id,
    'alert_id', v_id, 'resolved', v_resolved, 'reasons', v_reasons, 'unknowns', v_unknowns,
    'candidate', left(v_candidate, 8), 'baseline', left(v_baseline, 8));
END
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_cutover_readiness_watch(timestamptz, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_cutover_readiness_watch(timestamptz, boolean) TO service_role;
COMMENT ON FUNCTION public.fn_ca_cutover_readiness_watch(timestamptz, boolean) IS
  'At 03:00 Chicago: will the 04:00 engine cutover ship? Records a verdict and pages CutoverReadinessAtRisk when not (20261119234116). p_dry_run evaluates the next 04:00 and writes nothing.';

-- The owner page route gains one kind: cutover_readiness, with its own episode clock.
ALTER TABLE public.ca_owner_page_state DROP CONSTRAINT ca_owner_page_state_kind_check;
ALTER TABLE public.ca_owner_page_state ADD CONSTRAINT ca_owner_page_state_kind_check
  CHECK (kind IN ('dealing', 'restarts', 'money', 'releases', 'daily_window', 'migrations', 'cutover_readiness'));
INSERT INTO public.ca_owner_page_state (kind) VALUES ('cutover_readiness') ON CONFLICT (kind) DO NOTHING;

DO $patch$
DECLARE
  v_kind text := pg_get_functiondef('public.fn_ca_owner_page_kind(text,text,text)'::regprocedure);
  v_page text := pg_get_functiondef('public.fn_ca_a_real_alert_reaches_the_owner()'::regprocedure);
  v_digest text := pg_get_functiondef('public.fn_sp_digest_engine_cutover(date)'::regprocedure);
  c_kind_old constant text := E'THEN ''migrations''\n  END;';
  c_title_old constant text := E'               WHEN ''migrations'' THEN ''Merged Migration Not Installed''\n';
  c_summary_old constant text := 'v_kind IN (''releases'', ''daily_window'', ''migrations'')';
  c_digest_old constant text := '''resolved_at'', d.resolved_at)';
  c_once constant text := 'anchor did not match exactly once';
BEGIN
  IF (length(v_kind) - length(replace(v_kind, c_kind_old, ''))) / length(c_kind_old) <> 1 THEN
    RAISE EXCEPTION 'fn_ca_owner_page_kind %', c_once;
  END IF;
  IF (length(v_page) - length(replace(v_page, c_title_old, ''))) / length(c_title_old) <> 1
     OR (length(v_page) - length(replace(v_page, c_summary_old, ''))) / length(c_summary_old) <> 1 THEN
    RAISE EXCEPTION 'fn_ca_a_real_alert_reaches_the_owner %', c_once;
  END IF;
  IF (length(v_digest) - length(replace(v_digest, c_digest_old, ''))) / length(c_digest_old) <> 1 THEN
    RAISE EXCEPTION 'fn_sp_digest_engine_cutover %', c_once;
  END IF;
  EXECUTE replace(v_kind, c_kind_old,
    E'THEN ''migrations''\n    WHEN p_source = ''cutover-readiness-watch'' AND p_alertname = ''CutoverReadinessAtRisk'' AND p_severity = ''critical'' THEN ''cutover_readiness''\n  END;');
  v_page := replace(v_page, c_title_old,
    c_title_old || E'               WHEN ''cutover_readiness'' THEN ''4 AM Engine Update At Risk''\n');
  v_page := replace(v_page, c_summary_old, 'v_kind IN (''releases'', ''daily_window'', ''migrations'', ''cutover_readiness'')');
  EXECUTE v_page;
  EXECUTE replace(v_digest, c_digest_old,
    E'''resolved_at'', d.resolved_at,\n'
    || E'    -- The 03:00 readiness verdict for the same cutover (20261119234116).\n'
    || E'    ''readiness'', (SELECT jsonb_build_object(''verdict'', r.verdict, ''checked_at'', r.checked_at,\n'
    || E'                     ''checked_at_ct'', to_char(r.checked_at AT TIME ZONE ''America/Chicago'', ''HH24:MI''),\n'
    || E'                     ''reasons'', r.reasons, ''alert_id'', r.alert_id)\n'
    || E'                   FROM smarter_private.ca_cutover_readiness_runs r\n'
    || E'                  WHERE r.cutover_day = p_day + 1 ORDER BY r.checked_at DESC LIMIT 1))');
END
$patch$;

-- @probe-for: public.fn_ca_owner_page_kind
-- @probe-for: public.fn_sp_digest_engine_cutover
DO $probe$
DECLARE v jsonb;
BEGIN
  IF public.fn_ca_owner_page_kind('cutover-readiness-watch', 'CutoverReadinessAtRisk', 'critical') IS DISTINCT FROM 'cutover_readiness'
     OR public.fn_ca_owner_page_kind('engine-cutover-watch', 'EngineCutoverMissed', 'critical') IS DISTINCT FROM 'releases'
     OR public.fn_ca_owner_page_kind('migration-install-watch', 'MergedMigrationNotInstalled', 'critical') IS DISTINCT FROM 'migrations' THEN
    RAISE EXCEPTION 'fn_ca_owner_page_kind does not map the readiness alarm alone';
  END IF;
  v := public.fn_sp_digest_engine_cutover(current_date);
  IF NOT (v ? 'readiness') THEN RAISE EXCEPTION 'fn_sp_digest_engine_cutover lacks readiness'; END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- 03:00, 03:15 and 03:25 Chicago in CST (09 UTC) and in CDT (08 UTC); the
-- function itself returns at once outside [03:00, 03:30) Chicago.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'ca-cutover-readiness-watch-3am';
SELECT cron.schedule('ca-cutover-readiness-watch-3am', '0,15,25 8,9 * * *',
                     'select public.fn_ca_cutover_readiness_watch();');

COMMIT;
