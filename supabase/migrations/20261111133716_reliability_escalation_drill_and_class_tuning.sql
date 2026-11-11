-- 20261111133716_reliability_escalation_drill_and_class_tuning
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-11 13:37:16 UTC.
--
-- ============================================================================
-- RELIABILITY CONTROLLER: AN ON-DEMAND ESCALATION DRILL, AND CLASS CORRECTIONS
-- READ FROM PRODUCTION (controller-data track, 2026-11-11)
-- ============================================================================
--
-- REQUIRES the installed controller: 20261110000020 (Stage B), 20261110045731
-- (health read and seed corrections), 20261110144203 (intake and push
-- findings), 20261110174051 (critical_only) and 20261110224707 (escalation
-- latch). This file redefines NO controller function: not reliability_tick,
-- reliability_transition, reliability_deliver_notifications, reliability_classify,
-- reliability_ingest_alert, reliability_apply_signal, reliability_escalate or
-- reliability_render_escalation. It adds one table, one service-only function
-- and alert-class rows. notify_mode, mutation_paused, the runbooks and the
-- schedule are untouched.
--
-- 1. THE DRILL: public.fn_reliability_drill(p_action text, p_drill_id text)
--    WHY. Nothing proved, end to end and on demand, that a critical fault
--    reaching the inbox ends as one Messenger DM and one phone push to the
--    owner. The parts were each proven in the native harness and the
--    production DMs so far (19 since critical_only) came from real faults,
--    which cannot be produced on purpose.
--    WHAT. 'start' injects one synthetic critical event through the SAME
--    intake every producer uses: public.fn_record_operational_alert into
--    public.operational_alert_events. From there nothing is special: the
--    inbox triggers run, zzz_reliability_intake_insert ingests it, the class
--    row below (reliability_drill, critical, is_incident) opens an incident,
--    reliability_apply_signal escalates it at once, reliability_escalate
--    queues one escalation, and the per-minute tick delivers it with
--    fn_send_message_once and one push_outbox row. 'resolve' sends the
--    producer-style resolved row (a new inbox row keyed '<firing key>:resolved'
--    with payload.resolves, the worldhub.push-health protocol), so the
--    incident moves to verifying through the normal resolution path; the tick
--    then confirms recovered after its 30 quiet minutes and closes it 24
--    hours later. No controller row is edited by the drill. 'verify' is a
--    read: the incident, its notification (state, message_id, push_state),
--    the Messenger message and the push row, with a pass verdict.
--    LABELLING. Source 'reliability-drill'. The alert name is
--    'Drill No Action Needed <drill id>', so the incident title, the DM's
--    Title line and the push title all say it is a drill and needs no action;
--    the Rule summary line of the DM says it in full. The drill id is in the
--    alert name on purpose: escalations are digested per (class, alert name)
--    for reminder_hours (6), so with a fixed name a second drill inside six
--    hours would attach to the first DM and send nothing, and the drill would
--    prove nothing. The id is also the 'run' scope label, so no two drills
--    share a fingerprint.
--    LIMITS. Idempotent per drill id (a repeated 'start' returns the first
--    run and writes nothing). A new drill within 10 minutes of the previous
--    one is refused (RELIABILITY_DRILL_REFUSED). Service-only: EXECUTE for
--    service_role alone, and the body refuses any other JWT role. It is
--    called by hand through workflow_dispatch
--    (.github/workflows/reliability-escalation-drill.yml); nothing schedules it.
--    The drill page is sent in critical_only mode like any critical incident.
--    Not paged elsewhere: fn_ca_owner_page_kind returns NULL for this source,
--    so zz_a_real_alert_reaches_the_owner sends nothing. Like every SQL
--    sender, both rows carry payload.target_task_id, the Production Alerts
--    fleet id (tests/an-operational-alert-sender-addresses-the-fleet.law.test.ts);
--    the fleet sees a labelled drill that resolves itself.
--
-- 2. CLASS CORRECTIONS, from production 2026-11-10 07:24Z to 2026-11-11 13:30Z
--    (235 incidents, 2,355 observations, 19 DMs and 0 intake rejections; full
--    numbers per class in docs/reliability-controller/CLASS-CATALOG.md
--    section 6). Only classifications whose producer was read change; no
--    class is suppressed and no row's is_incident changes. Severity is the
--    producer's: the class model has no debounce or hold-down field, and
--    default_severity applies only to a row without a ranked severity, so
--    flapping classes (LightningHandHost.post_commit_obligations_pending,
--    DatabaseRepliesLost) are flagged in the catalog, not tuned here.
--    * %post_commit_obligations_pending: unclassified -> money_integrity.
--      Producers read: server/src/lightning/LightningHandHost.ts:3570 and
--      server/src/engine/ServerTableEngineSettlement.ts:3408, a critical
--      public.financial_alerts row saying a COMMITTED hand's durable
--      post-commit envelope (fn_ca_process_hand_post_commit_obligations,
--      escrow and financial events) was handed to its successor. 2 incidents,
--      109 deliveries, 2 DMs. The authoritative store stays financial_alerts.
--    * MergedMigrationNotInstalled (migration-install-watch): fallback
--      unclassified -> release. Producer read:
--      supabase/migrations/20261109182123_a_merged_migration_still_uninstalled_after_an_hour_pages_the.sql:265,
--      a merged migration still absent from schema_migrations an hour later.
--      1 incident, 4 deliveries, 2 DMs (escalation and reminder), both real.
--    * OpenClawJobStale: unclassified -> monitoring_self (EXTERNAL-PRODUCERS
--      family 4). Producer read in Smarter-Poker/smarter-poker-workers at
--      e727a432: src/routes/cron-staleness-watchdog.ts:67-75 and 195-262, an
--      Open Claw job with no success inside 1x (warning) or 3x (critical) its
--      own p90 cadence, written to public.engine_alerts and resolved when it
--      succeeds again.
--    * workers.deploy-error-poll (family 9), producer read in the same repo:
--      VercelDeploymentFailed -> release (src/routes/deploy-error-poll.ts:19-28,
--      155-160: the newest settled World Hub main deployment on hub-vanguard is
--      ERROR, critical, never resolved by its producer); AutofixRebuildFailed
--      -> release (same file :163-166); DeploymentMonitorUnavailable ->
--      monitoring_self (src/lib/deploymentMonitorHealth.ts:4-43: the poll
--      cannot read Vercel; resolved by the next good read). Any other name
--      from that source stays unclassified.
--    Families 11 (mac-studio-git-maintenance), 12
--    (union_promo_duplicate_2026_11_07) and 13
--    (engine_release_stall_check_uuid_into_bigint) stay unclassified: no
--    producer exists in Club Arena, World Hub or the workers repo
--    (EXTERNAL-PRODUCERS.md section 6 lists the searches).
--
-- A class change affects only deliveries after install (the fingerprint
-- includes the class); no inbox history is replayed and no incident is edited.
--
-- Native proof: scripts/ci/test-reliability-controller-stage-b.py installs
-- this file over every controller migration and proves the drill escalates
-- once (one DM, one push), is idempotent, resolves through the normal path,
-- refuses a second drill inside 10 minutes and refuses anon and authenticated;
-- and that each corrected name lands on its new class.
--
-- @live-proof: (SELECT to_regprocedure('public.fn_reliability_drill(text,text)') IS NOT NULL AND has_function_privilege('service_role', 'public.fn_reliability_drill(text,text)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.fn_reliability_drill(text,text)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.fn_reliability_drill(text,text)', 'EXECUTE') AND NOT has_table_privilege('authenticated', 'smarter_private.reliability_drills', 'SELECT') AND (SELECT (smarter_private.reliability_classify('reliability-drill', 'Drill No Action Needed x', 'critical', false)).incident_class) = 'reliability_drill' AND (SELECT (smarter_private.reliability_classify('financial-alerts-backfill', 'LightningHandHost.post_commit_obligations_pending', 'critical', false)).incident_class) = 'money_integrity' AND (SELECT (smarter_private.reliability_classify('migration-install-watch', 'MergedMigrationNotInstalled', 'critical', false)).incident_class) = 'release' AND (SELECT (smarter_private.reliability_classify('engine-alerts-backfill', 'OpenClawJobStale', 'warning', false)).incident_class) = 'monitoring_self' AND (SELECT (smarter_private.reliability_classify('workers.deploy-error-poll', 'VercelDeploymentFailed', 'critical', false)).incident_class) = 'release' AND (SELECT (smarter_private.reliability_classify('workers.deploy-error-poll', 'DeploymentMonitorUnavailable', 'critical', false)).incident_class) = 'monitoring_self' AND (SELECT (smarter_private.reliability_classify('mac-studio-git-maintenance', 'Git Maintenance Not Keeping Up', 'warning', false)).incident_class) = 'unclassified' AND (SELECT s.notify_mode = 'critical_only' AND s.mutation_paused FROM smarter_private.reliability_settings s WHERE s.id) AND NOT EXISTS (SELECT 1 FROM smarter_private.reliability_runbooks WHERE enabled))

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '20s';

DO $pre$
BEGIN
  IF to_regclass('smarter_private.reliability_alert_classes') IS NULL
     OR to_regprocedure('smarter_private.reliability_classify(text,text,text,boolean)') IS NULL
     OR to_regprocedure('public.fn_record_operational_alert(text,text,text,text,text,jsonb)') IS NULL
     OR to_regprocedure('public.fn_reliability_controller_health()') IS NULL THEN
    RAISE EXCEPTION 'RELIABILITY_DRILL_PREREQUISITE: the reliability controller (20261110000020, 20261110045731) is not installed';
  END IF;
  -- The two rows corrected in place must still be what the evidence was read against.
  IF NOT EXISTS (SELECT 1 FROM smarter_private.reliability_alert_classes
                  WHERE source_pattern = '%' AND alertname_pattern = '%post_commit_obligations_pending' AND severity_pattern = '%'
                    AND incident_class = 'unclassified' AND is_incident) THEN
    RAISE EXCEPTION 'RELIABILITY_CLASS_PREIMAGE_CHANGED: %%post_commit_obligations_pending is no longer the unclassified incident row';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM smarter_private.reliability_alert_classes
                  WHERE source_pattern = '%' AND alertname_pattern = 'OpenClawJobStale' AND severity_pattern = '%'
                    AND incident_class = 'unclassified' AND is_incident) THEN
    RAISE EXCEPTION 'RELIABILITY_CLASS_PREIMAGE_CHANGED: OpenClawJobStale is no longer the unclassified incident row';
  END IF;
END
$pre$;

-- ---------------------------------------------------------------------------
-- 1. Alert classes
-- ---------------------------------------------------------------------------
INSERT INTO smarter_private.reliability_alert_classes
  (priority, source_pattern, alertname_pattern, severity_pattern, incident_class, default_severity, escalate_immediately, is_incident, note)
VALUES
  (80, 'reliability-drill', '%', '%', 'reliability_drill', 'critical', true, true,
   'public.fn_reliability_drill: the on-demand escalation drill, run by hand (20261111133716)'),
  (140, 'workers.deploy-error-poll', 'VercelDeploymentFailed', '%', 'release', 'critical', false, true,
   'smarter-poker-workers src/routes/deploy-error-poll.ts:19-28,155-160: newest settled World Hub main deployment is ERROR; owner World Hub release'),
  (140, 'workers.deploy-error-poll', 'AutofixRebuildFailed', '%', 'release', 'critical', false, true,
   'smarter-poker-workers src/routes/deploy-error-poll.ts:163-166; owner World Hub release'),
  (140, 'workers.deploy-error-poll', 'DeploymentMonitorUnavailable', '%', 'monitoring_self', 'critical', false, true,
   'smarter-poker-workers src/lib/deploymentMonitorHealth.ts:4-43: the poll cannot read Vercel; owner workers deploy monitor'),
  (140, 'migration-install-watch', 'MergedMigrationNotInstalled', '%', 'release', 'critical', false, true,
   'supabase/migrations/20261109182123_a_merged_migration_still_uninstalled_after_an_hour_pages_the.sql:265; owner Club Arena migration install route');

UPDATE smarter_private.reliability_alert_classes
   SET incident_class = 'money_integrity',
       note = 'server/src/lightning/LightningHandHost.ts:3570, server/src/engine/ServerTableEngineSettlement.ts:3408: a committed hand''s post-commit envelope was handed to its successor; authoritative store public.financial_alerts (20261111133716)'
 WHERE source_pattern = '%' AND alertname_pattern = '%post_commit_obligations_pending' AND severity_pattern = '%';

UPDATE smarter_private.reliability_alert_classes
   SET incident_class = 'monitoring_self',
       note = 'smarter-poker-workers src/routes/cron-staleness-watchdog.ts:67-75,195-262: an Open Claw job past its own cadence; owner Open Claw scheduler (20261111133716)'
 WHERE source_pattern = '%' AND alertname_pattern = 'OpenClawJobStale' AND severity_pattern = '%';

-- ---------------------------------------------------------------------------
-- 2. The drill ledger
-- ---------------------------------------------------------------------------
-- No foreign key to the inbox or the incidents (Stage B rule: nothing here may
-- lock the inbox). One row per drill id.
CREATE TABLE smarter_private.reliability_drills (
  drill_id text PRIMARY KEY CHECK (drill_id ~ '^[a-z0-9][a-z0-9-]{5,47}$'),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  alertname text NOT NULL,
  firing_inbox_event_id bigint,
  incident_id uuid,
  resolve_requested_at timestamptz,
  resolved_inbox_event_id bigint
);
CREATE INDEX reliability_drills_requested_idx ON smarter_private.reliability_drills (requested_at DESC);
ALTER TABLE smarter_private.reliability_drills ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON smarter_private.reliability_drills FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON smarter_private.reliability_drills TO service_role;

-- ---------------------------------------------------------------------------
-- 3. public.fn_reliability_drill
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.fn_reliability_drill(p_action text, p_drill_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'smarter_private'
AS $fn$
DECLARE
  c_source CONSTANT text := 'reliability-drill';
  c_gap CONSTANT interval := interval '10 minutes';
  d smarter_private.reliability_drills;
  v_last timestamptz;
  v_key text;
  v_name text;
  v_summary text;
  v_inbox bigint;
  v_incident uuid;
  s smarter_private.reliability_settings;
  i smarter_private.reliability_incidents;
  n smarter_private.reliability_notifications;
  v_msg record;
  v_escalations integer;
  v_messages integer;
  v_pushes integer;
  v_resolved_disposition text;
  v_delivered boolean;
  v_resolved boolean;
BEGIN
  IF COALESCE(auth.role(), '') NOT IN ('', 'service_role') THEN
    RAISE EXCEPTION 'public.fn_reliability_drill is service-only' USING ERRCODE = '42501';
  END IF;
  IF p_drill_id IS NULL OR p_drill_id !~ '^[a-z0-9][a-z0-9-]{5,47}$' THEN
    RAISE EXCEPTION 'RELIABILITY_DRILL_INVALID: drill id must be 6 to 48 lowercase letters, digits or hyphens' USING ERRCODE = '22023';
  END IF;
  v_key := 'drill:' || p_drill_id;
  v_name := 'Drill No Action Needed ' || p_drill_id;

  IF p_action = 'start' THEN
    PERFORM pg_advisory_xact_lock(hashtext('reliability-drill'));
    SELECT * INTO d FROM smarter_private.reliability_drills WHERE drill_id = p_drill_id;
    IF FOUND THEN
      RETURN jsonb_build_object('action', 'start', 'drill_id', d.drill_id, 'idempotent', true,
        'requested_at', d.requested_at, 'firing_inbox_event_id', d.firing_inbox_event_id, 'incident_id', d.incident_id);
    END IF;
    SELECT max(requested_at) INTO v_last FROM smarter_private.reliability_drills;
    IF v_last IS NOT NULL AND v_last > clock_timestamp() - c_gap THEN
      RAISE EXCEPTION 'RELIABILITY_DRILL_REFUSED: the last drill started at %, less than 10 minutes ago', v_last USING ERRCODE = 'P0001';
    END IF;
    v_summary := 'This is a Reliability Controller escalation drill (drill ' || p_drill_id
      || '). No action is needed: it resolves itself once the message and push are verified.';
    INSERT INTO smarter_private.reliability_drills (drill_id, alertname) VALUES (p_drill_id, v_name);
    -- The real intake, exactly as a producer calls it.
    v_inbox := public.fn_record_operational_alert(c_source, v_key, v_name, 'firing', 'critical',
      jsonb_build_object(
        'target_task_id', '01a09b86-5ba8-7290-8657-1041f13dd3ca',
        'drill_id', p_drill_id,
        'drill', true,
        'summary', v_summary,
        'labels', jsonb_build_object('run', p_drill_id, 'component', 'reliability-drill'),
        'alert', jsonb_build_object('annotations', jsonb_build_object('summary', v_summary))));
    SELECT o.incident_id INTO v_incident FROM smarter_private.reliability_observations o
     WHERE o.inbox_event_id = v_inbox AND o.status = 'firing' ORDER BY o.id LIMIT 1;
    UPDATE smarter_private.reliability_drills SET firing_inbox_event_id = v_inbox, incident_id = v_incident
     WHERE drill_id = p_drill_id;
    RETURN jsonb_build_object('action', 'start', 'drill_id', p_drill_id, 'idempotent', false,
      'firing_inbox_event_id', v_inbox, 'incident_id', v_incident);
  END IF;

  SELECT * INTO d FROM smarter_private.reliability_drills WHERE drill_id = p_drill_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'RELIABILITY_DRILL_UNKNOWN: no drill %', p_drill_id USING ERRCODE = 'P0002';
  END IF;

  IF p_action = 'resolve' THEN
    IF d.resolved_inbox_event_id IS NOT NULL THEN
      RETURN jsonb_build_object('action', 'resolve', 'drill_id', d.drill_id, 'idempotent', true,
        'resolved_inbox_event_id', d.resolved_inbox_event_id);
    END IF;
    v_inbox := public.fn_record_operational_alert(c_source, v_key || ':resolved', d.alertname, 'resolved', 'info',
      jsonb_build_object(
        'target_task_id', '01a09b86-5ba8-7290-8657-1041f13dd3ca',
        'drill_id', p_drill_id,
        'drill', true,
        'resolves', v_key,
        'resolved_at', clock_timestamp(),
        'summary', 'Reliability Controller drill ' || p_drill_id || ' verified and resolved by the drill.',
        'labels', jsonb_build_object('run', p_drill_id, 'component', 'reliability-drill')));
    UPDATE smarter_private.reliability_drills
       SET resolve_requested_at = clock_timestamp(), resolved_inbox_event_id = v_inbox
     WHERE drill_id = p_drill_id;
    RETURN jsonb_build_object('action', 'resolve', 'drill_id', p_drill_id, 'idempotent', false, 'resolved_inbox_event_id', v_inbox);
  END IF;

  IF p_action IS DISTINCT FROM 'verify' THEN
    RAISE EXCEPTION 'RELIABILITY_DRILL_INVALID: action must be start, resolve or verify' USING ERRCODE = '22023';
  END IF;

  -- verify: a read of what the controller did with the drill.
  SELECT * INTO STRICT s FROM smarter_private.reliability_settings WHERE id;
  SELECT * INTO i FROM smarter_private.reliability_incidents WHERE id = d.incident_id;
  SELECT * INTO n FROM smarter_private.reliability_notifications x
   WHERE x.incident_id = d.incident_id AND x.kind = 'escalation' ORDER BY x.id LIMIT 1;
  SELECT count(*) INTO v_escalations FROM smarter_private.reliability_notification_incidents ni
    JOIN smarter_private.reliability_notifications x ON x.id = ni.notification_id
   WHERE ni.incident_id = d.incident_id AND x.kind = 'escalation';
  SELECT m.id, m.conversation_id, m.sender_id, m.request_id, m.created_at,
         (m.content LIKE '%Drill No Action Needed%' AND m.content LIKE '%No action is needed%') AS says_drill
    INTO v_msg
    FROM public.social_messages m WHERE m.id = n.message_id;
  SELECT count(*) INTO v_messages FROM public.social_messages m WHERE n.request_id IS NOT NULL AND m.request_id = n.request_id;
  SELECT count(*) INTO v_pushes FROM public.push_outbox p
   WHERE d.incident_id IS NOT NULL AND p.related_entity_id = d.incident_id AND p.event = 'reliability_escalation';
  SELECT o.disposition INTO v_resolved_disposition FROM smarter_private.reliability_observations o
   WHERE d.resolved_inbox_event_id IS NOT NULL AND o.inbox_event_id = d.resolved_inbox_event_id AND o.status = 'resolved'
   ORDER BY o.id LIMIT 1;
  v_delivered := i.id IS NOT NULL AND i.incident_class = 'reliability_drill' AND i.severity = 'critical'
    AND v_escalations = 1 AND n.state = 'persisted_in_messenger' AND n.message_id IS NOT NULL
    AND v_msg.id IS NOT NULL AND v_msg.conversation_id = s.conversation_id AND v_msg.sender_id = s.system_sender_id
    AND coalesce(v_msg.says_drill, false) AND v_messages = 1
    AND n.push_outbox_id IS NOT NULL AND v_pushes = 1 AND n.push_state = 'provider_accepted';
  v_resolved := v_resolved_disposition = 'applied' AND i.status IN ('verifying', 'recovered', 'closed');
  RETURN jsonb_build_object(
    'action', 'verify', 'drill_id', d.drill_id, 'requested_at', d.requested_at,
    'firing_inbox_event_id', d.firing_inbox_event_id, 'resolved_inbox_event_id', d.resolved_inbox_event_id,
    'notify_mode', s.notify_mode,
    'incident', CASE WHEN i.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', i.id, 'status', i.status, 'severity', i.severity, 'incident_class', i.incident_class,
      'escalation_state', i.escalation_state, 'title', i.title, 'opened_at', i.opened_at) END,
    'notification', CASE WHEN n.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', n.id, 'state', n.state, 'message_id', n.message_id, 'request_id', n.request_id,
      'push_outbox_id', n.push_outbox_id, 'push_state', n.push_state, 'push_detail', n.push_detail,
      'sent_at', n.sent_at, 'last_error', n.last_error) END,
    'message', CASE WHEN v_msg.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_msg.id, 'conversation_id', v_msg.conversation_id, 'sender_id', v_msg.sender_id,
      'to_owner_conversation', v_msg.conversation_id = s.conversation_id, 'says_drill', v_msg.says_drill,
      'created_at', v_msg.created_at) END,
    'escalation_notifications', v_escalations, 'messages_for_request', v_messages, 'push_rows', v_pushes,
    'resolved_disposition', v_resolved_disposition,
    'delivered', coalesce(v_delivered, false), 'resolved', coalesce(v_resolved, false),
    'pass', coalesce(v_delivered, false) AND coalesce(v_resolved, false));
END
$fn$;

REVOKE ALL ON FUNCTION public.fn_reliability_drill(text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_reliability_drill(text, text) TO service_role;

COMMENT ON FUNCTION public.fn_reliability_drill(text, text) IS
  'Reliability Controller escalation drill (20261111133716). start | resolve | verify, one drill id each; service_role only; run by hand from reliability-escalation-drill.yml, never scheduled.';

COMMIT;
