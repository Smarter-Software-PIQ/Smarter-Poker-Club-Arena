-- 20261110045731_reliability_controller_health_function_and_seed_corrections.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- ============================================================================
-- RELIABILITY CONTROLLER: THE HEALTH READ FOR MONITORING, AND SEED CORRECTIONS
-- (owner assignment 2026-11-09; docs/reliability-controller/HEALTH-SIGNAL.md
-- and docs/reliability-controller/EXTERNAL-PRODUCERS.md)
-- ============================================================================
--
-- REQUIRES 20261110000020_reliability_controller_stage_b. This file creates no
-- controller table. If smarter_private.reliability_heartbeat, _settings,
-- _notifications, _intake_rejections or _alert_classes is absent it raises
-- before changing anything, so an install ahead of Stage B applies nothing.
--
-- 1. public.fn_reliability_controller_health()
--    The controller lives in the database it reports through (the inbox and
--    the Messenger), so it cannot be the thing that says it has stopped.
--    server/scripts/collect-monitoring-health.sh on the engine host reads this
--    function once a minute over PostgREST, publishes reliability_controller_*
--    gauges, and Prometheus/Alertmanager email on them. PostgREST serves
--    schema public only, hence a public function over the private tables.
--    One row: the heartbeat time and age, notifications queued, notifications
--    failed in 24 hours, intake rejections in 24 hours, mutation_paused and
--    notify_mode. Read only. Declared and granted the way the collector's
--    other read is (public.fn_cron_failing_jobs, 20261108020000): LANGUAGE
--    sql, STABLE, SECURITY DEFINER with a fixed search_path, EXECUTE for
--    service_role only.
--    * A heartbeat that has never ticked stays NULL (greatest() ignores NULL,
--      hence the CASE). The collector treats NULL as unreadable and publishes
--      nothing, which ReliabilityControllerMetricsAbsent reports.
--    * notifications_queued counts state 'queued' only. 'rate_limited' is a
--      deliberate hold by max_dm_per_hour, not a stuck outbox.
--
-- 2. The four Prometheus alerts about the controller itself
--    ReliabilityControllerStale, ReliabilityControllerMetricsAbsent,
--    ReliabilityControllerOutboxStuck and ReliabilityControllerIntakeRejections
--    reach the inbox through Alertmanager's codex-inbox route as well as by
--    email. They are seeded as class monitoring_self with is_incident false,
--    so intake opens no incident and enqueues no notification for them.
--    EMAIL IS THE CHANNEL FOR THESE (Alertmanager email-critical and
--    email-warning to admin@smarter.poker), because it does not pass through
--    the controller. This is the Stage B rule applied to the external copy of
--    the same conditions: Stage B never announces a delivery failure through
--    delivery (reliability_escalate withholds ReliabilityDeliveryFailing) and
--    never lets its own rows re-enter intake. Were these rows incidents, a
--    stopped tick would queue an escalation it cannot deliver, the queue
--    would raise ReliabilityControllerOutboxStuck, and that would queue
--    another. The conditions are still recorded inside the controller by its
--    own self-signals (ReliabilityDeliveryFailing, ReliabilityIntakeRejections,
--    ReliabilityTickStepFailing), and the inbox rows themselves are kept.
--    Without these rows the names would fall to the priority 1000 fallback,
--    which is unclassified and escalates immediately.
--
-- 3. Seed corrections from docs/reliability-controller/EXTERNAL-PRODUCERS.md
--    (producers traced 2026-11-09):
--    * InstallQueue% -> development_notification, not an incident. Producer
--      found: operations/ops-mac/install-queue.sh and heartbeat.sh, the
--      migration install queue for agents; no production signal.
--    * The five families whose producer could not be read stay or become
--      unclassified, so they remain in triage: OpenClawJobStale and source
--      workers.deploy-error-poll (smarter-poker-workers repo, not connected),
--      source mac-studio-git-maintenance (a Mac-local script, not connected;
--      was development_notification and not an incident),
--      union_promo_duplicate% and engine_release_stall_check% (hand-written
--      rows with no producer; already unclassified, restated).
--    * CriticalPage.stuck_tournament and DailyDigest.stuck_tournament ->
--      tournament_lifecycle by exact name. Both read the same tournaments
--      predicate (fn_sp_critical_scan, fn_sp_digest_attention). They already
--      resolved to this class through '%stuck_tournament'; the exact rows
--      record that the rule bodies were read.
--
-- Keyed the way the Stage B seed is: UNIQUE (source_pattern,
-- alertname_pattern, severity_pattern). Every row is an upsert, so a second
-- run changes nothing. Only smarter_private.reliability_alert_classes is
-- written: no incident, observation, member, notification or setting is
-- touched, and an incident already open keeps the class it was opened with.
-- The transaction ends by classifying each name and aborts if any answer is
-- not the one intended.
--
-- Locks: a new function and a few rows in a catalog table read only by
-- intake. No hot table, no install window. Like every migration it is refused
-- inside the hourly break window (:50 to :03 UTC); apply it once outside it.
--
-- Native proof: scripts/ci/test-reliability-controller-health.py
-- (PostgreSQL 17, never production).

-- @live-proof: (SELECT to_regprocedure('public.fn_reliability_controller_health()') IS NOT NULL AND (SELECT p.prosecdef AND p.proconfig @> ARRAY['search_path=pg_catalog, smarter_private'] FROM pg_proc p WHERE p.oid = 'public.fn_reliability_controller_health()'::regprocedure) AND has_function_privilege('service_role', 'public.fn_reliability_controller_health()', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.fn_reliability_controller_health()', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.fn_reliability_controller_health()', 'EXECUTE') AND NOT has_function_privilege('public', 'public.fn_reliability_controller_health()', 'EXECUTE') AND (SELECT count(*) FROM smarter_private.reliability_alert_classes c WHERE c.source_pattern = '%' AND c.severity_pattern = '%' AND c.alertname_pattern IN ('ReliabilityControllerStale', 'ReliabilityControllerMetricsAbsent', 'ReliabilityControllerOutboxStuck', 'ReliabilityControllerIntakeRejections') AND c.incident_class = 'monitoring_self' AND NOT c.is_incident AND NOT c.escalate_immediately) = 4 AND (SELECT c.incident_class = 'development_notification' AND NOT c.is_incident FROM smarter_private.reliability_alert_classes c WHERE c.source_pattern = '%' AND c.alertname_pattern = 'InstallQueue%' AND c.severity_pattern = '%') AND (SELECT c.incident_class = 'unclassified' AND c.is_incident FROM smarter_private.reliability_alert_classes c WHERE c.source_pattern = 'mac-studio-git-maintenance' AND c.alertname_pattern = '%' AND c.severity_pattern = '%') AND (SELECT count(*) FROM smarter_private.reliability_alert_classes c WHERE c.source_pattern = '%' AND c.severity_pattern = '%' AND c.alertname_pattern IN ('CriticalPage.stuck_tournament', 'DailyDigest.stuck_tournament') AND c.incident_class = 'tournament_lifecycle' AND c.is_incident) = 2)

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '20s';

-- ---------------------------------------------------------------------------
-- Fail closed: Stage B must already be installed
-- ---------------------------------------------------------------------------
DO $requires$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(r, ', ' ORDER BY r) INTO v_missing
    FROM unnest(ARRAY[
      'smarter_private.reliability_heartbeat',
      'smarter_private.reliability_settings',
      'smarter_private.reliability_notifications',
      'smarter_private.reliability_intake_rejections',
      'smarter_private.reliability_alert_classes']) AS r
   WHERE to_regclass(r) IS NULL;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Reliability Controller Stage B (migration 20261110000020) is not installed: % is missing. Install Stage B first. Nothing was changed.', v_missing
      USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('smarter_private.reliability_classify(text, text, text, boolean)') IS NULL THEN
    RAISE EXCEPTION 'Reliability Controller Stage B (migration 20261110000020) is not installed: smarter_private.reliability_classify(text, text, text, boolean) is missing. Install Stage B first. Nothing was changed.'
      USING ERRCODE = '55000';
  END IF;
END
$requires$;

-- ---------------------------------------------------------------------------
-- 1. The health read for the monitoring collector
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_reliability_controller_health()
RETURNS TABLE (
  heartbeat_at_unix double precision,
  heartbeat_age_seconds double precision,
  notifications_queued bigint,
  notifications_failed_24h bigint,
  intake_rejections_24h bigint,
  mutation_paused boolean,
  notify_mode text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'smarter_private'
AS $fn$
  SELECT extract(epoch FROM h.tick_at)::double precision,
         CASE WHEN h.tick_at IS NULL THEN NULL
              ELSE greatest(extract(epoch FROM now() - h.tick_at), 0)::double precision END,
         (SELECT count(*) FROM smarter_private.reliability_notifications n WHERE n.state = 'queued'),
         (SELECT count(*) FROM smarter_private.reliability_notifications n
           WHERE n.state = 'failed' AND n.created_at > now() - interval '24 hours'),
         (SELECT count(*) FROM smarter_private.reliability_intake_rejections j
           WHERE j.at > now() - interval '24 hours'),
         s.mutation_paused,
         s.notify_mode
    FROM smarter_private.reliability_heartbeat h
   CROSS JOIN smarter_private.reliability_settings s
$fn$;

COMMENT ON FUNCTION public.fn_reliability_controller_health() IS
  'One row of Reliability Controller health for the monitoring collector (reliability_controller_* gauges in server/scripts/collect-monitoring-health.sh). Read only, service_role only. docs/reliability-controller/HEALTH-SIGNAL.md. 2026-11-09.';

REVOKE ALL ON FUNCTION public.fn_reliability_controller_health() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_reliability_controller_health() TO service_role;

-- ---------------------------------------------------------------------------
-- 2 and 3. Seed rows, upserted on the Stage B key
-- ---------------------------------------------------------------------------
INSERT INTO smarter_private.reliability_alert_classes AS c
  (priority, source_pattern, alertname_pattern, severity_pattern, incident_class, default_severity, escalate_immediately, is_incident, note)
VALUES
  -- The controller's own health, alerted by Prometheus. Email is the channel;
  -- intake opens nothing for these (see the header, section 2).
  (90, '%', 'ReliabilityControllerStale', '%', 'monitoring_self', 'critical', false, false, 'recovery-rules.yml; the controller''s own health, delivered by Alertmanager email, never an incident'),
  (90, '%', 'ReliabilityControllerMetricsAbsent', '%', 'monitoring_self', 'critical', false, false, 'recovery-rules.yml; the controller''s own health, delivered by Alertmanager email, never an incident'),
  (90, '%', 'ReliabilityControllerOutboxStuck', '%', 'monitoring_self', 'warning', false, false, 'recovery-rules.yml; the controller''s own health, delivered by Alertmanager email, never an incident'),
  (90, '%', 'ReliabilityControllerIntakeRejections', '%', 'monitoring_self', 'warning', false, false, 'recovery-rules.yml; the controller''s own health, delivered by Alertmanager email, never an incident'),
  -- Producer found: the agents' migration install queue on the Ops Mac.
  (200, '%', 'InstallQueue%', '%', 'development_notification', 'info', false, false, 'operations/ops-mac/install-queue.sh and heartbeat.sh; no production signal (EXTERNAL-PRODUCERS.md family 10)'),
  -- Producer not read: unclassified, so the family stays in triage.
  (150, '%', 'OpenClawJobStale', '%', 'unclassified', 'warning', false, true, 'producer in the smarter-poker-workers repo, not connected (EXTERNAL-PRODUCERS.md family 4)'),
  (150, 'workers.deploy-error-poll', '%', '%', 'unclassified', 'warning', false, true, 'producer in the smarter-poker-workers repo, not connected (EXTERNAL-PRODUCERS.md family 9)'),
  (20, 'mac-studio-git-maintenance', '%', '%', 'unclassified', 'warning', false, true, 'Mac-local producer, not connected (EXTERNAL-PRODUCERS.md family 11)'),
  (200, '%', 'union_promo_duplicate%', '%', 'unclassified', 'warning', false, true, 'hand-written financial_alerts row, no producer (EXTERNAL-PRODUCERS.md family 12)'),
  (200, '%', 'engine_release_stall_check%', '%', 'unclassified', 'warning', false, true, 'hand-written inbox row, no producer (EXTERNAL-PRODUCERS.md family 13)'),
  -- Rule bodies read: both report the same stuck-tournament predicate.
  (150, '%', 'CriticalPage.stuck_tournament', '%', 'tournament_lifecycle', 'critical', false, true, 'fn_sp_critical_scan, rule read (EXTERNAL-PRODUCERS.md family 1)'),
  (150, '%', 'DailyDigest.stuck_tournament', '%', 'tournament_lifecycle', 'critical', false, true, 'fn_sp_digest_attention, rule read (EXTERNAL-PRODUCERS.md section 2)')
ON CONFLICT (source_pattern, alertname_pattern, severity_pattern) DO UPDATE
   SET priority = EXCLUDED.priority,
       incident_class = EXCLUDED.incident_class,
       default_severity = EXCLUDED.default_severity,
       escalate_immediately = EXCLUDED.escalate_immediately,
       is_incident = EXCLUDED.is_incident,
       note = EXCLUDED.note
 WHERE (c.priority, c.incident_class, c.default_severity, c.escalate_immediately, c.is_incident, c.note)
       IS DISTINCT FROM
       (EXCLUDED.priority, EXCLUDED.incident_class, EXCLUDED.default_severity, EXCLUDED.escalate_immediately, EXCLUDED.is_incident, EXCLUDED.note);

-- ---------------------------------------------------------------------------
-- The seed is judged by what intake will answer, not by the rows written
-- ---------------------------------------------------------------------------
DO $assert$
DECLARE
  r record;
  v smarter_private.reliability_alert_classes;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('alertmanager', 'ReliabilityControllerStale', 'critical', 'monitoring_self', false),
      ('alertmanager', 'ReliabilityControllerMetricsAbsent', 'critical', 'monitoring_self', false),
      ('alertmanager', 'ReliabilityControllerOutboxStuck', 'warning', 'monitoring_self', false),
      ('alertmanager', 'ReliabilityControllerIntakeRejections', 'warning', 'monitoring_self', false),
      ('install-queue', 'InstallQueueJobFailed', 'warning', 'development_notification', false),
      ('install-queue', 'InstallQueueServiceDown', 'critical', 'development_notification', false),
      ('engine-alerts-backfill', 'OpenClawJobStale', 'warning', 'unclassified', true),
      ('workers.deploy-error-poll', 'VercelDeploymentFailed', 'critical', 'unclassified', true),
      ('workers.deploy-error-poll', 'DeploymentMonitorUnavailable', 'warning', 'unclassified', true),
      ('mac-studio-git-maintenance', 'Git Maintenance Not Keeping Up', 'warning', 'unclassified', true),
      ('mac-studio-git-maintenance', 'Git Maintenance Stale Lock Cleared', 'warning', 'unclassified', true),
      ('financial-alerts-backfill', 'union_promo_duplicate_2026_11_07', 'warning', 'unclassified', true),
      ('midway-weekly-payout-followup', 'engine_release_stall_check_uuid_into_bigint', 'warning', 'unclassified', true),
      ('sp-critical-pager', 'CriticalPage.stuck_tournament', 'critical', 'tournament_lifecycle', true),
      ('sp-daily-digest', 'DailyDigest.stuck_tournament', 'warning', 'tournament_lifecycle', true)
    ) AS t(source, alertname, severity, want_class, want_incident)
  LOOP
    v := smarter_private.reliability_classify(r.source, r.alertname, r.severity, false);
    IF v.incident_class IS DISTINCT FROM r.want_class OR v.is_incident IS DISTINCT FROM r.want_incident THEN
      RAISE EXCEPTION 'seed correction refused: % from % classifies as % (incident %), expected % (incident %)',
        r.alertname, r.source, v.incident_class, v.is_incident, r.want_class, r.want_incident;
    END IF;
  END LOOP;
END
$assert$;

COMMIT;
