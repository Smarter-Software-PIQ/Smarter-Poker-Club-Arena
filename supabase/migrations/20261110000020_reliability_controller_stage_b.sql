-- 20261110000020_reliability_controller_stage_b.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- ============================================================================
-- RELIABILITY CONTROLLER, STAGE B (owner assignment 2026-11-09, design in
-- docs/reliability-controller/CHECKLIST.md section 2)
-- ============================================================================
--
-- WHY. public.operational_alert_events is a durable inbox (about 3,000 rows a
-- day) whose only consumer was a chat session. Nothing deterministic stood
-- between the inbox and a person. This installs a non-AI, Postgres-native
-- controller that turns inbox rows into incidents, runs an
-- explicit state machine, and writes one fixed-template Messenger escalation
-- per incident through the existing idempotent send.
--
-- WHAT IT INSTALLS (schema smarter_private, every name prefixed reliability_,
-- service-only):
--   settings, heartbeat, alert_classes, sources_without_resolve,
--   legal_transitions, incidents, alert_members, observations,
--   incident_events (append-only), notifications (outbox),
--   notification_incidents, intake_rejections, runbooks (catalog only, NO
--   enabled row), views v_open_incidents and v_controller_health, two AFTER
--   triggers on public.operational_alert_events and the pg_cron job
--   reliability-controller-tick.
--
-- WHAT IT NEVER DOES. Stage B takes no recovery action of any kind. It never
-- writes public.financial_alerts or public.ca_drift_incidents (their existing
-- jobs own closing them), never writes the inbox, never touches a release, an
-- engine, a table, a tournament or money. settings.mutation_paused ships true
-- and notify_mode ships 'observe': escalations are written to the outbox as
-- suppressed_observe and no direct message is sent until the owner changes
-- the mode. Only smarter_private.reliability_send_validation_message() sends in observe mode.
--
-- DESIGN DECISIONS A READER NEEDS:
--  * Fingerprint = md5(incident_class, source family, alert name, scope).
--    Scope is table_id, tournament_id, game_id, cluster_id, variant, instance
--    and component whenever the payload carries them, for every source, so
--    two tables, tournaments, games, clusters or variants never merge. A hand
--    id or request id is never read. The -backfill and -updates mirrors of a
--    source are one family. NAME SIMILARITY NEVER MERGES: the alert name in
--    the fingerprint is the name as delivered.
--  * Cross-name correlation only where identity is demonstrated. Read from
--    production on 2026-11-10: a 'drift_incident:financial_alerts:<name>' row
--    carries original_event.context.alert_id and a drift-incidents row named
--    'financial_alerts:<name>' carries original_incident.metadata.alert_id,
--    and that id is the id of the inner financial alert (40 of 40 sampled
--    wrappers resolved to an inner alert with the stripped name; 436 of 532
--    wrappers and 5,253 of 6,467 drift rows carry the id). alert_members is
--    keyed by that record id, and a delivery whose record is already known
--    joins the incident that record belongs to. A wrapper with no id is its
--    own incident; related_incident_id points at the open incident with the
--    stripped name and the same scope, as a link and never a merge.
--  * Ordering uses ONE clock per comparison, never a payload time against a
--    receipt time. Read from production on 2026-11-10: an Alertmanager row has
--    one event_key per (alertname, fingerprint, startsAt, status), and a
--    resolved row carries the startsAt of the firing it ends (137 of 144
--    resolved rows in the last 15,000 inbox rows had their firing twin). So
--    the EPISODE is the startsAt for Alertmanager and the inbox row itself
--    for a producer that resolves a row in place. alert_members keeps each
--    record's episode. A firing delivery of an older episode, and a firing
--    delivery of an episode already resolved, change nothing.
--  * Resolution safety. A resolved row applies when it belongs to the
--    record's current episode (same startsAt, or the same inbox row); when
--    neither side names an episode, it applies only if its database receipt
--    is later than the record's last firing receipt. A resolved row of an
--    older episode is an observation and changes no state. An applied one
--    moves the incident to verifying, and only when no other resolvable
--    record of the episode still fires; the tick confirms recovered after 30
--    quiet minutes (measured on the database clock) and closes it 24 hours
--    later. A resolved row for a closed incident is recorded and reopens
--    nothing.
--  * No guessing. When neither an episode nor one clock can order a resolved
--    row against the firing (a record never seen firing, or no firing
--    receipt to compare with), the row is an observation, the incident keeps
--    its status and resolution_state becomes 'uncertain' (shown in
--    v_open_incidents and on the uncertainty line of the escalation).
--  * No incident can hang: one from a resolving source with no firing
--    delivery for 24 hours and no resolved signal becomes stale_unverified
--    with closure_basis 'resolve_signal_missing'. It is never called recovered.
--  * Sources that never send a resolved row (sources_without_resolve) are
--    never 'recovered'. An incident fed only by them becomes stale_unverified
--    (closure_basis 'no_resolve_protocol') after 6 hours with no firing
--    delivery; a new firing returns it to
--    investigating or escalated as the same incident, recurrence_count + 1.
--  * Redelivery: an observation is unique on (inbox_event_id, delivery_count,
--    status). status is part of the key because ca-stall-watch and
--    engine-cutover-watch resolve a row in place without a new delivery.
--  * Recurrence: a firing delivery for a recovered incident reopens the SAME
--    row (recurrence_count + 1). After the incident is closed a new firing
--    opens a NEW row; it carries recurrence_count + 1 when the previous row
--    closed within 24 hours.
--  * Escalations are digested. One escalation notification per
--    (incident_class, normalized alert name) per reminder window; further
--    incidents of that group attach to it (notification_incidents) and send
--    no message of their own. Reminders: one per group per window, at most 4
--    per incident, and every message is under max_dm_per_hour.
--  * Messenger and push follow 20261109224532 (bug reports): the same platform
--    service identity sends, the recipient is constrained by
--    fn_is_platform_alert_recipient, one dedicated conversation id is kept in
--    settings and reused while both parties are in it, the message goes
--    through fn_send_message_once with request_id = md5(incident, seq), and
--    each sent escalation, reminder or validation adds one push_outbox row
--    (event 'reliability_escalation'). Read on production 2026-11-10:
--    aa_platform_push_recipient_guard calls fn_is_platform_operational_alert
--    (event, title, '{}'), which does not match this event, so the row stays
--    pending. Whatever the guard does is mirrored in push_state and never
--    fails the Messenger send. No delivered or read state is invented.
--    Message metadata is {kind: 'reliability_incident', incident_id,
--    notification_kind, handoff_version: 1}.
--  * One non-service surface: public.fn_reliability_incident_for_owner(uuid),
--    callable by authenticated and answered only when
--    fn_is_platform_alert_recipient(auth.uid()) is true (42501 otherwise). It
--    returns the incident, its last 20 events and the handoff text, and no
--    payload beyond the allowlisted labels.
--  * No self-escalation loop. Intake rejections, delivery failures and tick
--    step errors are counted in v_controller_health and raise at most one
--    open monitoring_self incident per kind; the delivery-failure incident
--    never enqueues a notification, and a row whose source is the controller
--    never enters intake.
--  * There is no "inbox silent" rule: silence is not failure. A producer
--    health check needs a periodic signal that provably reaches the inbox,
--    and none is established (Alertmanager's MonitoringCanary is routed to
--    null), so no such rule is created here.
--  * The intake trigger never breaks the inbox: its whole body runs inside a
--    handler that writes smarter_private.reliability_intake_rejections, with a 2 s lock wait.
--
-- Native proof: scripts/ci/test-reliability-controller-stage-b.py
-- (PostgreSQL 17, never production).
--
-- periodic-work: reliability-controller-tick is the product the owner assigned on 2026-11-09 (a scheduled, non-AI incident controller), not compensation for a defect. It evaluates only time-based rules (escalate a warning that is still firing, confirm a resolved alert stayed quiet, close, mark stale, remind, deliver the outbox, heartbeat). It repairs nothing, retries no business operation and moves no money, seat, table, tournament or release.

-- @live-proof: (SELECT to_regclass('smarter_private.reliability_incidents') IS NOT NULL AND to_regprocedure('smarter_private.reliability_tick(timestamp with time zone)') IS NOT NULL AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reliability-controller-tick' AND schedule = '* * * * *' AND active) AND (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.operational_alert_events'::regclass AND tgname IN ('zzz_reliability_intake_insert', 'zzz_reliability_intake_update') AND tgenabled = 'O') = 2 AND (SELECT notify_mode IN ('observe', 'critical_only', 'all') AND owner_user_id = '47965354-0e56-43ef-931c-ddaab82af765' AND system_sender_id = '2d1cd6c3-5700-4af9-a271-d4863fdab20d' FROM smarter_private.reliability_settings) AND NOT EXISTS (SELECT 1 FROM smarter_private.reliability_runbooks WHERE enabled) AND NOT has_table_privilege('anon', 'smarter_private.reliability_incidents', 'SELECT') AND NOT has_table_privilege('authenticated', 'smarter_private.reliability_incidents', 'SELECT') AND NOT has_table_privilege('authenticated', 'smarter_private.reliability_settings', 'SELECT, UPDATE') AND NOT has_function_privilege('authenticated', 'smarter_private.reliability_tick(timestamp with time zone)', 'EXECUTE') AND has_function_privilege('authenticated', 'public.fn_reliability_incident_for_owner(uuid)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.fn_reliability_incident_for_owner(uuid)', 'EXECUTE'))

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '20s';

-- Every object lives in the existing private schema smarter_private, under the
-- prefix reliability_. The repository's schema manifest and its merge gate
-- (scripts/ci/check-migrations-applied.mjs) know public and smarter_private
-- only, so a schema of its own could not be judged. Browser roles hold USAGE
-- on smarter_private; every table, view, sequence and function below is
-- therefore revoked from them by name.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
CREATE TABLE smarter_private.reliability_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  mutation_paused boolean NOT NULL DEFAULT true,
  notify_mode text NOT NULL DEFAULT 'observe' CHECK (notify_mode IN ('observe', 'critical_only', 'all')),
  owner_user_id uuid NOT NULL,
  system_sender_id uuid NOT NULL,
  conversation_id uuid,
  max_dm_per_hour integer NOT NULL DEFAULT 6 CHECK (max_dm_per_hour >= 0),
  reminder_hours integer NOT NULL DEFAULT 6 CHECK (reminder_hours >= 1),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT settings_distinct_parties CHECK (owner_user_id <> system_sender_id),
  CONSTRAINT settings_recipient_is_owner CHECK (public.fn_is_platform_alert_recipient(owner_user_id))
);
-- Recipient: the owner's Messenger account. Sender: the platform service
-- identity public.bug_report_routing already uses; no second sender exists.
INSERT INTO smarter_private.reliability_settings (id, mutation_paused, notify_mode, owner_user_id, system_sender_id)
VALUES (true, true, 'observe', '47965354-0e56-43ef-931c-ddaab82af765', '2d1cd6c3-5700-4af9-a271-d4863fdab20d');

CREATE TABLE smarter_private.reliability_heartbeat (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  tick_at timestamptz,
  tick_count bigint NOT NULL DEFAULT 0,
  last_result jsonb NOT NULL DEFAULT '{}'::jsonb
);
INSERT INTO smarter_private.reliability_heartbeat (id) VALUES (true);

CREATE TABLE smarter_private.reliability_alert_classes (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  priority integer NOT NULL,
  source_pattern text NOT NULL DEFAULT '%',
  alertname_pattern text NOT NULL DEFAULT '%',
  severity_pattern text NOT NULL DEFAULT '%',
  incident_class text NOT NULL,
  default_severity text NOT NULL DEFAULT 'warning',
  escalate_immediately boolean NOT NULL DEFAULT false,
  is_incident boolean NOT NULL DEFAULT true,
  note text,
  UNIQUE (source_pattern, alertname_pattern, severity_pattern)
);

CREATE TABLE smarter_private.reliability_sources_without_resolve (
  source text PRIMARY KEY,
  note text
);

CREATE TABLE smarter_private.reliability_legal_transitions (
  from_status text NOT NULL,
  to_status text NOT NULL,
  PRIMARY KEY (from_status, to_status)
);

CREATE TABLE smarter_private.reliability_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint text NOT NULL,
  incident_class text NOT NULL,
  title text NOT NULL,
  severity text NOT NULL,
  status text NOT NULL DEFAULT 'investigating'
    CHECK (status IN ('investigating', 'recovering', 'verifying', 'recovered', 'contained', 'escalated', 'stale_unverified', 'closed')),
  source text NOT NULL,
  alertname text NOT NULL,
  group_key text NOT NULL,
  related_incident_id uuid,
  environment text NOT NULL DEFAULT 'production',
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_observed_at timestamptz NOT NULL,
  last_observed_at timestamptz NOT NULL,
  last_firing_at timestamptz,
  last_firing_received_at timestamptz,
  last_resolved_at timestamptz,
  closure_basis text,
  resolution_state text NOT NULL DEFAULT 'none' CHECK (resolution_state IN ('none', 'uncertain')),
  opened_at timestamptz NOT NULL,
  status_changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  occurrence_count bigint NOT NULL DEFAULT 0,
  latest_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  engine_release text,
  escalation_state text NOT NULL DEFAULT 'none' CHECK (escalation_state IN ('none', 'escalated')),
  escalation_reason text,
  recurrence_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX reliability_incidents_one_open_per_fingerprint ON smarter_private.reliability_incidents (fingerprint) WHERE status <> 'closed';
CREATE INDEX reliability_incidents_fingerprint_idx ON smarter_private.reliability_incidents (fingerprint, created_at DESC);
CREATE INDEX reliability_incidents_open_status_idx ON smarter_private.reliability_incidents (status, status_changed_at) WHERE status <> 'closed';
CREATE INDEX reliability_incidents_group_idx ON smarter_private.reliability_incidents (group_key) WHERE status <> 'closed';

-- The last known state of each concrete alert, by its record identity. The
-- fingerprint is the incident that record belongs to.
CREATE TABLE smarter_private.reliability_alert_members (
  member_key text PRIMARY KEY,
  fingerprint text NOT NULL,
  status text NOT NULL CHECK (status IN ('firing', 'resolved')),
  resolvable boolean NOT NULL DEFAULT true,
  episode text,
  episode_at timestamptz,
  last_event_at timestamptz NOT NULL,
  last_received_at timestamptz NOT NULL,
  last_firing_at timestamptz,
  last_firing_received_at timestamptz
);
CREATE INDEX reliability_alert_members_fingerprint_idx ON smarter_private.reliability_alert_members (fingerprint, status);
CREATE INDEX reliability_alert_members_resolved_age_idx ON smarter_private.reliability_alert_members (last_event_at) WHERE status = 'resolved';

-- inbox_event_id names public.operational_alert_events.id. No foreign key on
-- purpose (CLAUDE.md section 2 rule 7): nothing here may lock or block the inbox.
CREATE TABLE smarter_private.reliability_observations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  incident_id uuid REFERENCES smarter_private.reliability_incidents (id),
  inbox_event_id bigint,
  delivery_count bigint NOT NULL DEFAULT 1,
  status text NOT NULL,
  severity text NOT NULL,
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  disposition text NOT NULL DEFAULT 'applied',
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (inbox_event_id, delivery_count, status)
);
CREATE INDEX reliability_observations_incident_idx ON smarter_private.reliability_observations (incident_id, id);

CREATE TABLE smarter_private.reliability_incident_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  incident_id uuid NOT NULL REFERENCES smarter_private.reliability_incidents (id),
  kind text NOT NULL,
  from_status text,
  to_status text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX reliability_incident_events_incident_idx ON smarter_private.reliability_incident_events (incident_id, at);

CREATE TABLE smarter_private.reliability_notifications (
  id bigserial PRIMARY KEY,
  incident_id uuid REFERENCES smarter_private.reliability_incidents (id),
  seq integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('escalation', 'status_change', 'reminder', 'validation')),
  request_id uuid NOT NULL UNIQUE,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  state text NOT NULL CHECK (state IN ('queued', 'suppressed_observe', 'rate_limited', 'persisted_in_messenger', 'failed')),
  group_key text,
  message_id uuid,
  push_outbox_id uuid,
  push_state text NOT NULL DEFAULT 'not_requested'
    CHECK (push_state IN ('not_requested', 'pending', 'diverted_by_guard', 'refused')),
  push_detail text,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  sent_at timestamptz,
  UNIQUE (incident_id, seq)
);
CREATE INDEX reliability_notifications_pending_idx ON smarter_private.reliability_notifications (id) WHERE state IN ('queued', 'rate_limited');
CREATE INDEX reliability_notifications_sent_idx ON smarter_private.reliability_notifications (sent_at) WHERE state = 'persisted_in_messenger';
CREATE INDEX reliability_notifications_group_idx ON smarter_private.reliability_notifications (group_key, created_at) WHERE group_key IS NOT NULL;

-- Every incident a digested notification speaks for.
CREATE TABLE smarter_private.reliability_notification_incidents (
  notification_id bigint NOT NULL REFERENCES smarter_private.reliability_notifications (id),
  incident_id uuid NOT NULL REFERENCES smarter_private.reliability_incidents (id),
  attached_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (notification_id, incident_id)
);
CREATE INDEX reliability_notification_incidents_incident_idx ON smarter_private.reliability_notification_incidents (incident_id);

CREATE TABLE smarter_private.reliability_intake_rejections (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  inbox_event_id bigint,
  source text,
  alertname text,
  event_key text,
  operation text,
  reason text NOT NULL,
  sqlstate text,
  at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX reliability_intake_rejections_at_idx ON smarter_private.reliability_intake_rejections (at);

-- Catalog only. Stage B seeds no row and performs no recovery action.
CREATE TABLE smarter_private.reliability_runbooks (
  key text NOT NULL,
  version integer NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  eligibility jsonb NOT NULL DEFAULT '{}'::jsonb,
  limits jsonb NOT NULL DEFAULT '{}'::jsonb,
  note text,
  PRIMARY KEY (key, version)
);

ALTER TABLE smarter_private.reliability_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE smarter_private.reliability_heartbeat ENABLE ROW LEVEL SECURITY;
ALTER TABLE smarter_private.reliability_alert_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE smarter_private.reliability_sources_without_resolve ENABLE ROW LEVEL SECURITY;
ALTER TABLE smarter_private.reliability_legal_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE smarter_private.reliability_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE smarter_private.reliability_alert_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE smarter_private.reliability_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE smarter_private.reliability_incident_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE smarter_private.reliability_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE smarter_private.reliability_notification_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE smarter_private.reliability_intake_rejections ENABLE ROW LEVEL SECURITY;
ALTER TABLE smarter_private.reliability_runbooks ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Seeds
-- ---------------------------------------------------------------------------
INSERT INTO smarter_private.reliability_legal_transitions (from_status, to_status) VALUES
  ('investigating', 'recovering'), ('investigating', 'verifying'), ('investigating', 'contained'), ('investigating', 'escalated'),
  ('recovering', 'verifying'), ('recovering', 'investigating'), ('recovering', 'contained'), ('recovering', 'escalated'),
  ('verifying', 'recovered'), ('verifying', 'investigating'), ('verifying', 'escalated'),
  ('recovered', 'closed'), ('recovered', 'investigating'),
  ('contained', 'verifying'), ('contained', 'investigating'), ('contained', 'escalated'),
  ('escalated', 'verifying'), ('escalated', 'recovering'), ('escalated', 'contained'), ('escalated', 'closed'),
  ('investigating', 'stale_unverified'), ('escalated', 'stale_unverified'),
  ('stale_unverified', 'investigating'), ('stale_unverified', 'escalated'), ('stale_unverified', 'closed');

INSERT INTO smarter_private.reliability_sources_without_resolve (source, note) VALUES
  ('sp-critical-pager', 'no resolved rows in 14 days (inventory 2026-11-09)'),
  ('sp-daily-digest', 'no resolved rows in 14 days (inventory 2026-11-09)'),
  ('owner-operational-notifications', 'no resolved rows in 14 days (inventory 2026-11-09)'),
  ('daily-window', 'no resolved rows in 14 days (inventory 2026-11-09)'),
  ('weekly-payout', 'no resolved rows in 14 days (inventory 2026-11-09)'),
  ('install-queue', 'no resolved rows in 14 days (inventory 2026-11-09)'),
  ('mac-studio-git-maintenance', 'no resolved rows in 14 days (inventory 2026-11-09)');

-- Lowest priority number wins. Patterns are ILIKE against the raw source, the
-- alert name with its wrapper prefixes stripped, and the lowercased severity.
INSERT INTO smarter_private.reliability_alert_classes
  (priority, source_pattern, alertname_pattern, severity_pattern, incident_class, default_severity, escalate_immediately, is_incident, note)
VALUES
  (20, 'mac-studio-git-maintenance', '%', '%', 'development_notification', 'info', false, false, 'repository maintenance on the Ops Mac'),
  (30, 'club-arena.post-deploy-e2e', '%', 'critical', 'release', 'critical', false, true, 'a critical firing post-deploy episode is a release incident'),
  (40, 'club-arena.post-deploy-e2e', '%', '%', 'development_notification', 'info', false, false, 'per-release receipts and non-critical post-deploy rows'),
  -- The loaded Alertmanager rules, by exact name (164 rules; classes from the
  -- 2026-11-09 source inventory, 79 of them fired in the last 14 days).
  (100, '%', 'EngineDown', '%', 'table_liveness', 'critical', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'EngineHandsPerSecDropped', '%', 'table_liveness', 'critical', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'EngineTableCountAnomaly', '%', 'table_liveness', 'warning', false, true, 'rule file; 14 episodes in 14 days'),
  (100, '%', 'EngineCannotBeReplaced', '%', 'release', 'critical', false, true, 'rule file; 1 episodes in 14 days'),
  (100, '%', 'PlatformFrozenTooOften', '%', 'release', 'critical', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'EngineReplacementWatchdogBlind', '%', 'monitoring_self', 'critical', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'OpenClawJobsHaveGoneSilent', '%', 'unclassified', 'warning', false, true, 'rule file; 5 episodes in 14 days'),
  (100, '%', 'CronJobsReportingSuccessWhileDoingNothing', '%', 'database', 'warning', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'OpenClawFleetLongSilence', '%', 'unclassified', 'critical', false, true, 'rule file; 1 episodes in 14 days'),
  (100, '%', 'PgCronFailuresElevated', '%', 'database', 'warning', false, true, 'rule file; 45 episodes in 14 days'),
  (100, '%', 'PgCronFleetStopped', '%', 'database', 'critical', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'PgCronJobFailingRepeatedly', '%', 'database', 'warning', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'PgCronGuardJobFailingRepeatedly', '%', 'database', 'critical', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'CronFailingJobsBlind', '%', 'monitoring_self', 'warning', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'CronMetricsBlind', '%', 'monitoring_self', 'warning', false, true, 'rule file; 7 episodes in 14 days'),
  (100, '%', 'ReplicationSlotPinningWal', '%', 'database', 'critical', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'EngineDatabaseClockSkew', '%', 'database', 'warning', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'DatabaseRpcErrorsElevated', '%', 'database', 'warning', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'DatabaseRepliesLost', '%', 'database', 'warning', false, true, 'rule file; 31 episodes in 14 days'),
  (100, '%', 'DatabaseWriteRetriesExhausted', '%', 'database', 'critical', false, true, 'rule file; 1 episodes in 14 days'),
  (100, '%', 'HostDiskNearlyFull', '%', 'unclassified', 'warning', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'HostCPUSaturated', '%', 'unclassified', 'warning', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'HostMemoryPressure', '%', 'unclassified', 'warning', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'ReplicationSlotFallingBehind', '%', 'database', 'warning', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'ReplicationSlotCriticallyBehind', '%', 'database', 'critical', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'ReplicationSlotInactive', '%', 'database', 'critical', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'ReplicationMetricsBlind', '%', 'monitoring_self', 'warning', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'DatabaseNotAnswering', '%', 'database', 'critical', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'ReplicationSlotsDisappeared', '%', 'database', 'critical', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'ActionLatencyDegraded', '%', 'table_liveness', 'warning', false, true, 'rule file; 19 episodes in 14 days'),
  (100, '%', 'ActionLatencyCritical', '%', 'table_liveness', 'critical', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'HandsAreFailingToSettle', '%', 'money_integrity', 'critical', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'SettlementFailuresAboveBaseline', '%', 'money_integrity', 'warning', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'NoHandsAreSettling', '%', 'money_integrity', 'critical', false, true, 'rule file; 1 episodes in 14 days'),
  (100, '%', 'SettlementsStuckMidStateMachine', '%', 'money_integrity', 'warning', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'SettlementMetricsBlind', '%', 'monitoring_self', 'warning', false, true, 'rule file; 7 episodes in 14 days'),
  (100, '%', 'HandProjectionDrainWedged', '%', 'unclassified', 'critical', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'HandProjectionOutboxBacklog', '%', 'unclassified', 'warning', false, true, 'rule file; 5 episodes in 14 days'),
  (100, '%', 'HandProjectionOutboxBacklogCritical', '%', 'unclassified', 'critical', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'HandProjectionDrainStalled', '%', 'unclassified', 'critical', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'HandProjectionMetricsBlind', '%', 'monitoring_self', 'warning', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'UndeclaredTriggerOnAMoneyTable', '%', 'money_integrity', 'critical', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'MoneyAlertsGoingUnread', '%', 'money_integrity', 'warning', false, true, 'rule file; 3 episodes in 14 days'),
  (100, '%', 'MoneyAlertBacklogGrowing', '%', 'money_integrity', 'warning', false, true, 'rule file; 1 episodes in 14 days'),
  (100, '%', 'MoneyHealthBlind', '%', 'monitoring_self', 'warning', false, true, 'rule file; 7 episodes in 14 days'),
  (100, '%', 'PlayersReconnectingRepeatedly', '%', 'table_liveness', 'warning', false, true, 'rule file; 43 episodes in 14 days'),
  (100, '%', 'TablesAreReloadingThemselves', '%', 'table_liveness', 'critical', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'PlayersCannotAuthenticateToTables', '%', 'table_liveness', 'critical', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'EngineRefusingSessions', '%', 'table_liveness', 'warning', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'EngineRefusingSessionsInVolume', '%', 'table_liveness', 'warning', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'EngineCannotReachAuth', '%', 'table_liveness', 'critical', false, true, 'rule file; 4 episodes in 14 days'),
  (100, '%', 'EngineCoreOutOfHeadroom', '%', 'table_liveness', 'warning', false, true, 'rule file; 72 episodes in 14 days'),
  (100, '%', 'EngineCoreSaturated', '%', 'table_liveness', 'critical', false, true, 'rule file; 1 episodes in 14 days'),
  (100, '%', 'EngineSheddingPrecisionForHours', '%', 'horse_decision_delivery', 'warning', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'TournamentBreakStartedSlow', '%', 'tournament_lifecycle', 'warning', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'TournamentEliminationSchedulerSaturated', '%', 'tournament_lifecycle', 'critical', false, true, 'rule file; 6 episodes in 14 days'),
  (100, '%', 'TournamentEliminationSchedulerAllSlotsStalled', '%', 'tournament_lifecycle', 'critical', false, true, 'rule file; 10 episodes in 14 days'),
  (100, '%', 'TournamentBountyRecoveryLaneFailing', '%', 'money_integrity', 'critical', false, true, 'rule file; 3 episodes in 14 days'),
  (100, '%', 'TournamentBountyRealtimeDisconnected', '%', 'money_integrity', 'critical', false, true, 'rule file; 1 episodes in 14 days'),
  (100, '%', 'TournamentManagerWakeRealtimeDisconnected', '%', 'tournament_lifecycle', 'critical', false, true, 'rule file; 1 episodes in 14 days'),
  (100, '%', 'TournamentBountyOutboxBacklogStuck', '%', 'money_integrity', 'critical', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'TournamentRunningWithNoOwner', '%', 'tournament_lifecycle', 'warning', false, true, 'rule file; 6 episodes in 14 days'),
  (100, '%', 'TournamentRunningWithNoOwnerCritical', '%', 'tournament_lifecycle', 'critical', false, true, 'rule file; 3 episodes in 14 days'),
  (100, '%', 'TournamentManagerQuarantineStuck', '%', 'tournament_lifecycle', 'warning', false, true, 'rule file; 2 episodes in 14 days'),
  (100, '%', 'F06DrainedCustodyRefused', '%', 'tournament_lifecycle', 'warning', false, true, 'rule file; 1 episodes in 14 days'),
  (100, '%', 'ClusterControllerStalled', '%', 'cluster', 'critical', false, true, 'rule file; 5 episodes in 14 days'),
  (100, '%', 'ClusterPassLatchReleased', '%', 'cluster', 'warning', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'ClusterPassErrors', '%', 'cluster', 'warning', false, true, 'rule file; 13 episodes in 14 days'),
  (100, '%', 'ClusterTickingNothing', '%', 'cluster', 'critical', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'ClusterFeedersAbandoned', '%', 'cluster', 'warning', false, true, 'rule file; 9 episodes in 14 days'),
  (100, '%', 'ClusterMovesExpiring', '%', 'cluster', 'warning', false, true, 'rule file; 10 episodes in 14 days'),
  (100, '%', 'ClusterPassSlow', '%', 'cluster', 'warning', false, true, 'rule file; 2 episodes in 14 days'),
  (100, '%', 'HorseFleetCollapsed', '%', 'horse_fleet_throughput', 'critical', false, true, 'rule file; 10 episodes in 14 days'),
  (100, '%', 'HorseFleetThroughputRelativeDrop', '%', 'horse_fleet_throughput', 'critical', false, true, 'rule file; 46 episodes in 14 days'),
  (100, '%', 'HorseCashActionsStopped', '%', 'horse_fleet_throughput', 'critical', false, true, 'rule file; 30 episodes in 14 days'),
  (100, '%', 'HorseFleetNotSeated', '%', 'horse_fleet_throughput', 'critical', false, true, 'rule file; 1 episodes in 14 days'),
  (100, '%', 'HorseFleetHeartbeatStale', '%', 'horse_fleet_throughput', 'critical', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'HorseDecisionWorkerDown', '%', 'horse_decision_delivery', 'critical', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'HorseTurnTimeouts', '%', 'horse_decision_delivery', 'warning', false, true, 'rule file; 26 episodes in 14 days'),
  (100, '%', 'HorseTurnTimeoutStorm', '%', 'horse_decision_delivery', 'critical', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'HorseTurnsAbandonedByLostAuthority', '%', 'horse_decision_delivery', 'critical', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'LeaseRenewalLoopStopped', '%', 'table_liveness', 'critical', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'LeaseHeartbeatsNotBeingKept', '%', 'table_liveness', 'critical', false, true, 'rule file; 11 episodes in 14 days'),
  (100, '%', 'HorseDecisionFallbacks', '%', 'horse_decision_delivery', 'critical', false, true, 'rule file; 1 episodes in 14 days'),
  (100, '%', 'HorseSeatsUnactable', '%', 'horse_decision_delivery', 'warning', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'HorseForcedSitOuts', '%', 'horse_fleet_throughput', 'critical', false, true, 'rule file; 15 episodes in 14 days'),
  (100, '%', 'HorseTournamentsOverdue', '%', 'tournament_lifecycle', 'critical', false, true, 'rule file; 15 episodes in 14 days'),
  (100, '%', 'PagerDeliveryFailing', '%', 'monitoring_self', 'critical', false, true, 'rule file; 1 episodes in 14 days'),
  (100, '%', 'CriticalEmailDeliveryFailing', '%', 'monitoring_self', 'warning', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'MonitoringCanary', '%', 'monitoring_self', 'canary', false, false, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'EngineHostNearOOM', '%', 'table_liveness', 'critical', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'EngineBuildHeadroomLost', '%', 'release', 'warning', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'EngineProcessMemoryHigh', '%', 'unclassified', 'warning', false, true, 'rule file; 90 episodes in 14 days'),
  (100, '%', 'LightningHandsAbandoned', '%', 'money_integrity', 'critical', false, true, 'rule file; 3 episodes in 14 days'),
  (100, '%', 'ClientErrorSpike', '%', 'unclassified', 'warning', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'PlayersRefusedDuringFreeze', '%', 'release', 'info', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'HorseBrainPolicyLedgerSilent', '%', 'horse_decision_delivery', 'warning', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'HorseBrainVariantSilent', '%', 'horse_decision_delivery', 'warning', false, true, 'rule file; 29 episodes in 14 days'),
  (100, '%', 'HorseBrainOutsideDomainSurge', '%', 'horse_policy_domain', 'warning', false, true, 'rule file; 86 episodes in 14 days'),
  (100, '%', 'HorseBrainPolicyUnavailableSurge', '%', 'horse_policy_domain', 'warning', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'HorseBrainPolicyUnregistered', '%', 'horse_policy_domain', 'warning', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'HorseBrainPolicyGraphUnrecorded', '%', 'horse_policy_domain', 'warning', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'PokerTablesFrozen', '%', 'table_liveness', 'critical', false, true, 'rule file; 543 episodes in 14 days'),
  (100, '%', 'PokerFleetWideStall', '%', 'table_liveness', 'warning', false, true, 'rule file; 53 episodes in 14 days'),
  (100, '%', 'PokerTournamentTableNeverStarted', '%', 'tournament_lifecycle', 'critical', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'PokerEngineCannotBeReplaced', '%', 'release', 'critical', false, true, 'rule file; 9 episodes in 14 days'),
  (100, '%', 'PokerRestartGateHeldByStuckPermit', '%', 'release', 'warning', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'EngineReleaseOwnerStale', '%', 'release', 'critical', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'EngineReleaseOwnerLooping', '%', 'release', 'warning', false, true, 'rule file; 1 episodes in 14 days'),
  (100, '%', 'EngineReleaseOwnerBlind', '%', 'monitoring_self', 'warning', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'PokerSettlementBlocked', '%', 'money_integrity', 'critical', false, true, 'rule file; 23 episodes in 14 days'),
  (100, '%', 'EngineScrapeDown', '%', 'monitoring_self', 'critical', false, true, 'rule file; 1 episodes in 14 days'),
  (100, '%', 'EngineDiscoveryStalled', '%', 'table_liveness', 'critical', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'EngineLivenessDead', '%', 'table_liveness', 'critical', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'EngineHandsStopped', '%', 'table_liveness', 'critical', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'EngineFleetThroughputCollapsed', '%', 'table_liveness', 'critical', false, true, 'rule file; 24 episodes in 14 days'),
  (100, '%', 'EngineRestartedOutsideTheBreak', '%', 'table_liveness', 'critical', false, true, 'rule file; 89 episodes in 14 days'),
  (100, '%', 'EngineTableRebuildChurn', '%', 'table_liveness', 'warning', false, true, 'rule file; 2 episodes in 14 days'),
  (100, '%', 'StatsHandIndexLagging', '%', 'stats', 'warning', false, true, 'rule file; 2 episodes in 14 days'),
  (100, '%', 'StatsLiveTriggerMissingHands', '%', 'stats', 'warning', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'StatsWitnessAuditDisagrees', '%', 'stats', 'warning', false, true, 'rule file; 7 episodes in 14 days'),
  (100, '%', 'StatsAllInEquityCoverageLow', '%', 'stats', 'warning', false, true, 'rule file; 120 episodes in 14 days'),
  (100, '%', 'StatsHealthReadStale', '%', 'monitoring_self', 'warning', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'RecoveryStackDegraded', '%', 'monitoring_self', 'critical', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'RecoveryStackUnverified', '%', 'monitoring_self', 'warning', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'EngineReleaseGateNeverOpens', '%', 'release', 'critical', false, true, 'rule file; 1 episodes in 14 days'),
  (100, '%', 'RestartGateHeldByUndurableTables', '%', 'release', 'warning', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'TournamentNeverStarted', '%', 'tournament_lifecycle', 'critical', false, true, 'rule file; 44 episodes in 14 days'),
  (100, '%', 'MttStartedLate', '%', 'tournament_lifecycle', 'warning', false, true, 'rule file; 200 episodes in 14 days'),
  (100, '%', 'MttLaunchLatenessBlind', '%', 'monitoring_self', 'warning', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'TournamentFleetUnserved', '%', 'tournament_lifecycle', 'critical', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'MttPlayStopped', '%', 'tournament_lifecycle', 'critical', false, true, 'rule file; 284 episodes in 14 days'),
  (100, '%', 'MttFleetNotDealing', '%', 'tournament_lifecycle', 'critical', false, true, 'rule file; 168 episodes in 14 days'),
  (100, '%', 'MttBreakDidNotEnd', '%', 'tournament_lifecycle', 'critical', false, true, 'rule file; 1 episodes in 14 days'),
  (100, '%', 'TournamentStuckCompleting', '%', 'tournament_lifecycle', 'critical', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'TournamentSeatlessPhantoms', '%', 'tournament_lifecycle', 'critical', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'TournamentCompletedUnpaid', '%', 'money_integrity', 'critical', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'TournamentMetricsStale', '%', 'monitoring_self', 'warning', false, true, 'rule file; 1 episodes in 14 days'),
  (100, '%', 'TournamentLobbyEmpty', '%', 'tournament_lifecycle', 'warning', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'TournamentsDecidedButUnfinished', '%', 'tournament_lifecycle', 'critical', false, true, 'rule file; 1 episodes in 14 days'),
  (100, '%', 'HorsesCommittedToDecidedGames', '%', 'horse_fleet_throughput', 'warning', false, true, 'rule file; 1 episodes in 14 days'),
  (100, '%', 'TournamentFinishRefusalsPersisting', '%', 'tournament_lifecycle', 'critical', false, true, 'rule file; 3 episodes in 14 days'),
  (100, '%', 'TournamentsBlockedByUnreconciledFees', '%', 'money_integrity', 'critical', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'DatabaseDeadlocksElevated', '%', 'database', 'critical', false, true, 'rule file; 10 episodes in 14 days'),
  (100, '%', 'SettlementLaneConvoy', '%', 'database', 'warning', false, true, 'rule file; 11 episodes in 14 days'),
  (100, '%', 'HorseFleetMetricsStale', '%', 'monitoring_self', 'warning', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'SpinDrawFairnessDrift', '%', 'money_integrity', 'critical', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'SpinMetricsStale', '%', 'monitoring_self', 'critical', false, true, 'rule file; 3 episodes in 14 days'),
  (100, '%', 'SpinPrizeUnpaid', '%', 'money_integrity', 'critical', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'SpinDrawBookingGapOpened', '%', 'money_integrity', 'critical', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'SpinDrawNeverBooked', '%', 'money_integrity', 'critical', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'SpinFleetProducingNothing', '%', 'spin_lifecycle', 'critical', false, true, 'rule file; 35 episodes in 14 days'),
  (100, '%', 'RakeAttributionBacklog', '%', 'money_integrity', 'warning', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'SpinRevealChronicallyLate', '%', 'spin_lifecycle', 'warning', false, true, 'rule file; 13 episodes in 14 days'),
  (100, '%', 'SpinReservePoolThin', '%', 'money_integrity', 'warning', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'SpinHumanWaitingForOpponents', '%', 'spin_lifecycle', 'critical', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'SpinUnfilledBacklog', '%', 'spin_lifecycle', 'warning', false, true, 'rule file; 6 episodes in 14 days'),
  (100, '%', 'SLOEngineAvailability', '%', 'table_liveness', 'critical', false, true, 'rule file; 9 episodes in 14 days'),
  (100, '%', 'SLOHandsAreNotBeingDealt', '%', 'table_liveness', 'critical', false, true, 'rule file; 67 episodes in 14 days'),
  (100, '%', 'SLOTableHasStalled', '%', 'table_liveness', 'critical', false, true, 'rule file; 194 episodes in 14 days'),
  (100, '%', 'SLOActionLatencyDegraded', '%', 'table_liveness', 'warning', false, true, 'rule file; 35 episodes in 14 days'),
  (100, '%', 'SLOBroadcastLatencyDegraded', '%', 'table_liveness', 'warning', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'SLOSettlementSuccess', '%', 'money_integrity', 'critical', false, true, 'rule file; 0 episodes in 14 days'),
  (100, '%', 'SLODatabaseErrorBudget', '%', 'database', 'warning', false, true, 'rule file; 0 episodes in 14 days'),
  -- Database and service producers with no rule file (normalized names). Classes
  -- agree with docs/reliability-controller/SOURCE-INVENTORY.md section 3a; a
  -- name whose producer was not found is unclassified so it stays in triage.
  (150, '%', 'tournament.real_time_payout_refused', '%', 'money_integrity', 'critical', false, true, null),
  (150, '%', 'TournamentRecurring.freeBuyAudit', '%', 'tournament_lifecycle', 'warning', false, true, null),
  (150, '%', 'DailyDigest.not_delivered', '%', 'monitoring_self', 'warning', false, true, null),
  (150, '%', 'DailyDigest.deploy_failed', '%', 'release', 'warning', false, true, null),
  (150, '%', 'DailyDigest.horse_fleet_degraded', '%', 'horse_fleet_throughput', 'warning', false, true, null),
  (150, '%', 'DailyDigest.big_diamond_move', '%', 'money_integrity', 'warning', false, true, null),
  (150, '%', 'DailyDigest.rake_rollup_mismatch', '%', 'money_integrity', 'warning', false, true, null),
  (150, '%', 'DailyDigest.agent_on_credit', '%', 'money_integrity', 'warning', false, true, null),
  (150, '%', 'CriticalPage.midway_free_buy_missing', '%', 'tournament_lifecycle', 'critical', false, true, null),
  (150, '%', 'postHandTasks.hand_history_failed', '%', 'stats', 'warning', false, true, null),
  (150, '%', 'StallWatchBlind', '%', 'monitoring_self', 'warning', false, true, null),
  (150, '%', 'ServerTableEngine.street_integrity_violation', '%', 'money_integrity', 'critical', false, true, 'inventory 3a: chip total mismatch'),
  (150, '%', 'ServerTableEngine.authoritative_hand_semantic_refusal', '%', 'money_integrity', 'critical', false, true, 'inventory 3a: refused by the atomic settlement contract'),
  (150, '%', 'postHandTasks.leave_pending_failed', '%', 'table_liveness', 'warning', false, true, 'inventory 3a'),
  (250, '%', 'DailyDigest.%', '%', 'unclassified', 'warning', false, true, 'product digest rules; producer rule not read'),
  (250, '%', 'TriviaQuestion%', '%', 'unclassified', 'warning', false, true, 'World Hub source; producer not found'),
  (250, '%', 'Accounting Documents Issued%', '%', 'unclassified', 'info', false, true, 'informational business record'),
  (200, '%', 'TableStoppedDealing', '%', 'table_liveness', 'critical', false, true, 'ca-stall-watch'),
  (200, '%', 'lightning_alerts', '%', 'table_liveness', 'warning', false, true, 'class needs a payload check'),
  (200, '%', '%post_commit_obligations_pending', '%', 'unclassified', 'warning', false, true, null),
  (200, '%', 'postHandTasks.%', '%', 'table_liveness', 'warning', false, true, null),
  (200, '%', '%fn_ca_tables_that_cannot_deal%', '%', 'tournament_lifecycle', 'critical', false, true, null),
  (200, '%', '%fn_ca_hand_commit_refusals%', '%', 'money_integrity', 'warning', false, true, null),
  (200, '%', 'fn_ca_writer_lock_sentinel', '%', 'database', 'warning', false, true, null),
  (200, '%', 'lightning_card_incident', '%', 'money_integrity', 'warning', false, true, null),
  (200, '%', 'ClubArenaEngineKillStorm', '%', 'table_liveness', 'critical', false, true, null),
  (200, '%', 'ClubArenaFleet%', '%', 'table_liveness', 'critical', false, true, null),
  (200, '%', 'fn_ca_bust_backlog_page', '%', 'tournament_lifecycle', 'warning', false, true, null),
  (200, '%', 'fn_ca_tournament%', '%', 'tournament_lifecycle', 'warning', false, true, null),
  (200, '%', 'Tournament.%', '%', 'tournament_lifecycle', 'warning', false, true, null),
  (200, '%', 'GameServer.tournament%', '%', 'tournament_lifecycle', 'warning', false, true, null),
  (200, '%', '%fn_ca_orphaned_running_tournaments%', '%', 'tournament_lifecycle', 'critical', false, true, null),
  (200, '%', 'ScheduledTournaments.%', '%', 'tournament_lifecycle', 'warning', false, true, null),
  (200, '%', '%fn_ca_absent_tournament_players%', '%', 'tournament_lifecycle', 'warning', false, true, null),
  (200, '%', 'fn_ca_bounty_only_final_two_watch', '%', 'money_integrity', 'warning', false, true, null),
  (200, '%', '%fn_ca_knockout_door_stalled%', '%', 'tournament_lifecycle', 'warning', false, true, null),
  (200, '%', 'TournamentStopNotSettled', '%', 'tournament_lifecycle', 'critical', false, true, null),
  (200, '%', '%stuck_tournament', '%', 'tournament_lifecycle', 'critical', false, true, null),
  (200, '%', 'DailyWindow%', '%', 'tournament_lifecycle', 'warning', false, true, null),
  (200, '%', 'fn_tournament_money_conservation', '%', 'money_integrity', 'critical', false, true, null),
  (200, '%', 'ca_manual_adjustments', '%', 'money_integrity', 'info', false, true, null),
  (200, '%', 'fn_ca_free_buy_funding_watch', '%', 'money_integrity', 'warning', false, true, null),
  (200, '%', 'union_accounting_scheduler', '%', 'money_integrity', 'critical', false, true, 'class needs a payload check'),
  (200, '%', 'fn_ca_escrow_balance_drift', '%', 'money_integrity', 'critical', false, true, null),
  (200, '%', '%settler_lag%', '%', 'money_integrity', 'warning', false, true, null),
  (200, '%', 'fn_union_%', '%', 'money_integrity', 'warning', false, true, null),
  (200, '%', 'RakeSpec.%', '%', 'money_integrity', 'warning', false, true, null),
  (200, '%', '%fn_union_governance_check%', '%', 'money_integrity', 'warning', false, true, null),
  (200, '%', 'fn_ca_daily_bonus_claim.%', '%', 'money_integrity', 'warning', false, true, null),
  (200, '%', 'fn_ca_journal_append_only', '%', 'money_integrity', 'critical', false, true, null),
  (200, '%', 'fn_ca_ledger_replay', '%', 'money_integrity', 'critical', false, true, null),
  (200, '%', 'lightning_settlement', '%', 'money_integrity', 'critical', false, true, null),
  (200, '%', 'weekly_club_accounting', '%', 'money_integrity', 'warning', false, true, null),
  (200, '%', 'fn_ca_mint_velocity_watch', '%', 'money_integrity', 'critical', false, true, null),
  (200, '%', 'ledger_invariant.%', '%', 'money_integrity', 'critical', false, true, null),
  (200, '%', 'horse_split.%', '%', 'money_integrity', 'warning', false, true, null),
  (200, '%', '%make_good', '%', 'money_integrity', 'warning', false, true, null),
  (200, '%', 'union_promo_duplicate%', '%', 'unclassified', 'warning', false, true, null),
  (200, '%', 'free_buy_format_mismatch', '%', 'money_integrity', 'warning', false, true, null),
  (200, '%', 'leaderboard_union_basis', '%', 'money_integrity', 'warning', false, true, null),
  (200, '%', '%chip drift%', '%', 'money_integrity', 'critical', false, true, null),
  (200, '%', '%Chip integrity%', '%', 'money_integrity', 'critical', false, true, null),
  (200, '%', 'WeeklyPayout%', '%', 'money_integrity', 'critical', false, true, null),
  (200, '%', 'fn_ca_cron_failure_watch', '%', 'database', 'warning', false, true, null),
  (200, '%', 'fn_ca_guard_defs_watch', '%', 'monitoring_self', 'critical', false, true, null),
  (200, '%', 'fn_ca_engine_release_stall_check', '%', 'release', 'critical', false, true, null),
  (200, '%', 'engine_release_stall_check%', '%', 'unclassified', 'warning', false, true, null),
  (200, '%', 'ClubArenaRestartGateShut', '%', 'release', 'critical', false, true, null),
  (200, '%', 'EngineCutoverMissed', '%', 'release', 'critical', false, true, null),
  (200, '%', 'lightning-internal-pilot-retired%', '%', 'money_integrity', 'warning', false, true, null),
  (200, '%', 'MonitoringDeployFailed', '%', 'release', 'warning', false, true, null),
  (200, '%', 'VercelDeploymentFailed', '%', 'unclassified', 'warning', false, true, null),
  (200, '%', 'DeploymentMonitorUnavailable', '%', 'unclassified', 'warning', false, true, null),
  (200, '%', 'InstallQueue%', '%', 'unclassified', 'warning', false, true, null),
  (200, '%', 'HorseFleet.stableHandHeartbeat', '%', 'horse_fleet_throughput', 'critical', false, true, null),
  (200, '%', 'fn_horse_daily_audit_watchdog', '%', 'unclassified', 'warning', false, true, null),
  (200, '%', 'fn_gto_v31_round_stall_check', '%', 'unclassified', 'warning', false, true, 'class needs a payload check'),
  (200, '%', 'ClubArenaStats%', '%', 'stats', 'warning', false, true, null),
  (200, '%', 'OperationalAlertMissing%', '%', 'monitoring_self', 'warning', false, true, null),
  (200, '%', 'Push%', '%', 'unclassified', 'warning', false, true, null),
  (200, '%', 'OwnerAccountDeviceNotConfirmingPush', '%', 'unclassified', 'warning', false, true, null),
  (200, '%', 'OpenClaw%', '%', 'unclassified', 'warning', false, true, null),
  -- Families, for a rule added after this seed.
  (290, '%', '%MetricsBlind', '%', 'monitoring_self', 'warning', false, true, null),
  (290, '%', '%MetricsStale', '%', 'monitoring_self', 'warning', false, true, null),
  (300, '%', 'HorseBrain%', '%', 'horse_policy_domain', 'warning', false, true, null),
  (300, '%', 'HorseDecision%', '%', 'horse_decision_delivery', 'critical', false, true, null),
  (300, '%', 'HorseTurn%', '%', 'horse_decision_delivery', 'warning', false, true, null),
  (310, '%', 'Horse%', '%', 'horse_fleet_throughput', 'warning', false, true, null),
  (300, '%', 'Spin%', '%', 'spin_lifecycle', 'warning', false, true, null),
  (300, '%', 'Tournament%', '%', 'tournament_lifecycle', 'warning', false, true, null),
  (300, '%', 'Mtt%', '%', 'tournament_lifecycle', 'warning', false, true, null),
  (300, '%', 'Cluster%', '%', 'cluster', 'warning', false, true, null),
  (300, '%', 'Database%', '%', 'database', 'warning', false, true, null),
  (300, '%', 'Postgres%', '%', 'database', 'warning', false, true, null),
  (300, '%', 'Replication%', '%', 'database', 'warning', false, true, null),
  (300, '%', 'PgCron%', '%', 'database', 'warning', false, true, null),
  (300, '%', 'Stats%', '%', 'stats', 'warning', false, true, null),
  (300, '%', 'EngineRelease%', '%', 'release', 'warning', false, true, null),
  (300, '%', 'Settlement%', '%', 'money_integrity', 'warning', false, true, null),
  (300, '%', 'Money%', '%', 'money_integrity', 'warning', false, true, null),
  -- Whole sources.
  (400, 'financial-alerts-%', '%', '%', 'money_integrity', 'warning', false, true, null),
  (400, 'drift-incidents-%', '%', '%', 'money_integrity', 'warning', false, true, null),
  (400, 'ca-stall-watch', '%', '%', 'table_liveness', 'warning', false, true, null),
  (400, 'engine-cutover-watch', '%', '%', 'release', 'critical', false, true, null),
  (400, 'production-integrity-audit', '%', '%', 'monitoring_self', 'warning', false, true, null),
  (400, 'club-arena.deploy-monitoring', '%', '%', 'release', 'warning', false, true, null),
  -- Anything unmatched is still an incident, and it escalates.
  (1000, '%', '%', '%', 'unclassified', 'warning', true, true, 'fallback');

-- ---------------------------------------------------------------------------
-- Small pure helpers
-- ---------------------------------------------------------------------------
CREATE FUNCTION smarter_private.reliability_safe_timestamp(p_text text)
RETURNS timestamptz
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $fn$
DECLARE v timestamptz;
BEGIN
  IF p_text IS NULL OR length(p_text) NOT BETWEEN 10 AND 40 THEN RETURN NULL; END IF;
  v := p_text::timestamptz;
  -- Alertmanager writes 0001-01-01 for "no end yet".
  IF v < '2020-01-01'::timestamptz THEN RETURN NULL; END IF;
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END
$fn$;

CREATE FUNCTION smarter_private.reliability_source_family(p_source text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $fn$
  SELECT regexp_replace(p_source, '-(backfill|updates)$', '')
$fn$;

-- The name with its wrapper prefixes stripped. Used to pick a class and to
-- group escalations into one digest. It is NOT part of the fingerprint.
CREATE FUNCTION smarter_private.reliability_normalize_alertname(p_alertname text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $fn$
  SELECT left(regexp_replace(
           regexp_replace(p_alertname, '^((drift_incident|financial_alerts|financial_incident):)+', ''),
           ' is (critical|warning|info)$', ''), 240)
$fn$;

-- The first scalar string found under p_key in the places a producer writes
-- its ids. Objects and arrays are never taken.
CREATE FUNCTION smarter_private.reliability_payload_id(p_labels jsonb, p_payload jsonb, p_key text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $fn$
  SELECT left(v.value #>> '{}', 120)
    FROM (VALUES (1, p_labels -> p_key),
                 (2, p_payload -> p_key),
                 (3, p_payload #> ARRAY['original_event', 'context', p_key]),
                 (4, p_payload #> ARRAY['original_incident', p_key]),
                 (5, p_payload #> ARRAY['original_incident', 'metadata', p_key]),
                 (6, p_payload #> ARRAY['original_notification', 'data', p_key])) AS v(ord, value)
   WHERE jsonb_typeof(v.value) = 'string' AND v.value #>> '{}' <> ''
   ORDER BY v.ord
   LIMIT 1
$fn$;

-- One short id for a scope, for the digest line of an escalation: the most
-- specific identity the scope holds.
CREATE FUNCTION smarter_private.reliability_scope_id(p_scope jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $fn$
  SELECT coalesce((
    SELECT left(e.key || '=' || e.value, 54)
      FROM jsonb_each_text(coalesce(p_scope, '{}'::jsonb)) e
     ORDER BY coalesce(array_position(ARRAY['table_id', 'tournament_id', 'game_id', 'cluster_id', 'operation_id', 'variant',
                                            'jobname', 'rpc', 'slot', 'run', 'scope_id', 'union_id', 'instance', 'host'], e.key), 99), e.key
     LIMIT 1), 'unscoped')
$fn$;

CREATE FUNCTION smarter_private.reliability_severity_rank(p_severity text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $fn$
  SELECT CASE lower(p_severity) WHEN 'critical' THEN 3 WHEN 'warning' THEN 2 WHEN 'info' THEN 1 ELSE 0 END
$fn$;

-- One line of plain text: no control characters, bounded length.
CREATE FUNCTION smarter_private.reliability_one_line(p_text text, p_max integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $fn$
  SELECT left(btrim(regexp_replace(replace(coalesce(p_text, ''), U&'\2014', '-'), '[[:cntrl:]]+', ' ', 'g')), p_max)
$fn$;

-- The first matching rule. A resolved row is matched without its severity and
-- only against incident rules, so it lands on the fingerprint its firing twin
-- opened even when the twin was critical and the receipt says info.
CREATE FUNCTION smarter_private.reliability_classify(p_source text, p_alertname text, p_severity text, p_resolved boolean)
RETURNS smarter_private.reliability_alert_classes
LANGUAGE sql
STABLE
SET search_path TO 'pg_catalog', 'smarter_private'
AS $fn$
  SELECT c
    FROM smarter_private.reliability_alert_classes c
   WHERE p_source ILIKE c.source_pattern
     AND p_alertname ILIKE c.alertname_pattern
     AND CASE WHEN p_resolved THEN c.is_incident ELSE lower(p_severity) ILIKE c.severity_pattern END
   ORDER BY c.priority, c.id
   LIMIT 1
$fn$;

-- ---------------------------------------------------------------------------
-- History is append-only
-- ---------------------------------------------------------------------------
CREATE FUNCTION smarter_private.reliability_incident_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $fn$
BEGIN
  RAISE EXCEPTION 'smarter_private.reliability_incident_events is append-only (audit trail)';
END
$fn$;

CREATE TRIGGER incident_events_append_only
  BEFORE UPDATE OR DELETE ON smarter_private.reliability_incident_events
  FOR EACH ROW EXECUTE FUNCTION smarter_private.reliability_incident_events_append_only();

-- ---------------------------------------------------------------------------
-- State machine
-- ---------------------------------------------------------------------------
CREATE FUNCTION smarter_private.reliability_transition(p_incident_id uuid, p_to_status text, p_reason text, p_detail jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'smarter_private'
AS $fn$
DECLARE
  v_from text;
  v_detail jsonb := coalesce(p_detail, '{}'::jsonb);
BEGIN
  -- No caller check here on purpose: the intake trigger reaches this function
  -- under whatever role wrote the inbox row. EXECUTE is revoked from every
  -- browser role below, which is the gate.
  SELECT status INTO v_from FROM smarter_private.reliability_incidents WHERE id = p_incident_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reliability incident % does not exist', p_incident_id USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM smarter_private.reliability_legal_transitions t WHERE t.from_status = v_from AND t.to_status = p_to_status) THEN
    RAISE EXCEPTION 'illegal reliability transition % -> % for incident %', v_from, p_to_status, p_incident_id
      USING ERRCODE = '22023';
  END IF;
  UPDATE smarter_private.reliability_incidents
     SET status = p_to_status,
         status_changed_at = clock_timestamp(),
         updated_at = clock_timestamp(),
         escalation_state = CASE WHEN p_to_status = 'escalated' THEN 'escalated' ELSE escalation_state END,
         escalation_reason = CASE WHEN p_to_status = 'escalated' THEN p_reason ELSE escalation_reason END,
         closure_basis = CASE
           WHEN p_to_status = 'stale_unverified' THEN coalesce(v_detail->>'closure_basis', 'unverified')
           WHEN p_to_status = 'verifying' THEN 'resolved_signal'
           WHEN p_to_status IN ('recovered', 'closed') THEN closure_basis
           ELSE NULL END,
         resolution_state = CASE WHEN p_to_status IN ('verifying', 'recovered', 'closed') THEN 'none' ELSE resolution_state END
   WHERE id = p_incident_id;
  INSERT INTO smarter_private.reliability_incident_events (incident_id, kind, from_status, to_status, detail)
  VALUES (p_incident_id, coalesce(v_detail->>'kind', 'transition'), v_from, p_to_status,
          v_detail || jsonb_build_object('reason', p_reason));
END
$fn$;

-- ---------------------------------------------------------------------------
-- Escalation message (fixed template, plain text, at most 2000 characters)
-- ---------------------------------------------------------------------------
-- p_notification_id names the digest: every incident attached to it is
-- counted, and up to 10 of their scope ids are listed.
CREATE FUNCTION smarter_private.reliability_render_escalation(p_incident_id uuid, p_kind text, p_notification_id bigint)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path TO 'pg_catalog', 'smarter_private'
AS $fn$
DECLARE
  i smarter_private.reliability_incidents;
  v_labels text;
  v_scope text;
  v_summary text;
  v_first bigint;
  v_last bigint;
  v_scopes integer;
  v_scope_ids text;
  v_body text;
  v_allowed constant text[] := ARRAY['alertname', 'severity', 'component', 'variant', 'format', 'job', 'instance', 'table_id', 'tournament_id', 'source'];
BEGIN
  SELECT * INTO STRICT i FROM smarter_private.reliability_incidents WHERE id = p_incident_id;
  SELECT left(string_agg(e.key || '=' || smarter_private.reliability_one_line(e.value, 60), ', ' ORDER BY e.key), 300)
    INTO v_labels
    FROM jsonb_each_text(coalesce(i.latest_evidence->'labels', '{}'::jsonb)) e
   WHERE e.key = ANY (v_allowed);
  SELECT left(string_agg(e.key || '=' || smarter_private.reliability_one_line(e.value, 60), ', ' ORDER BY e.key), 240)
    INTO v_scope
    FROM jsonb_each_text(i.scope) e;
  v_summary := nullif(smarter_private.reliability_one_line(i.latest_evidence->>'summary', 160), '');
  SELECT min(o.inbox_event_id), max(o.inbox_event_id) INTO v_first, v_last
    FROM smarter_private.reliability_observations o WHERE o.incident_id = i.id;
  SELECT count(*), string_agg(x.sid, '; ' ORDER BY x.sid) FILTER (WHERE x.rn <= 10)
    INTO v_scopes, v_scope_ids
    FROM (SELECT d.sid, row_number() OVER (ORDER BY d.sid) AS rn
            FROM (SELECT DISTINCT smarter_private.reliability_one_line(smarter_private.reliability_scope_id(j.scope), 54) AS sid
                    FROM smarter_private.reliability_notification_incidents ni
                    JOIN smarter_private.reliability_incidents j ON j.id = ni.incident_id
                   WHERE ni.notification_id = p_notification_id
                  UNION
                  SELECT smarter_private.reliability_one_line(smarter_private.reliability_scope_id(i.scope), 54)) d) x;
  v_body :=
    'AI AGENT NEEDED' || E'\n'
    || CASE WHEN p_kind = 'reminder' THEN 'Reminder: this incident is still escalated.' || E'\n' ELSE '' END
    || 'Incident ID: ' || i.id::text || E'\n'
    || 'Severity: ' || upper(i.severity) || E'\n'
    || 'Title: ' || smarter_private.reliability_one_line(i.title, 160) || E'\n'
    || 'Owner: unassigned, needs an AI coding agent' || E'\n'
    || 'First detected: ' || to_char(i.first_observed_at AT TIME ZONE 'America/Chicago', 'YYYY-MM-DD HH24:MI:SS') || ' America/Chicago' || E'\n'
    || 'Latest observation: ' || to_char(i.last_observed_at AT TIME ZONE 'America/Chicago', 'YYYY-MM-DD HH24:MI:SS') || ' America/Chicago' || E'\n'
    || 'Confirmed impact and scope: '
       || CASE WHEN v_scope IS NULL THEN 'Not established from the evidence received.' ELSE v_scope || '.' END
       || ' Delivered firing ' || i.occurrence_count::text || ' time(s).' || E'\n'
    || 'Affected scopes: ' || v_scopes::text || ' (' || v_scope_ids || CASE WHEN v_scopes > 10 THEN '; and more' ELSE '' END || ')' || E'\n'
    || 'Attempted: No automatic recovery exists for this class yet.' || E'\n'
    || 'Why automatic handling cannot complete: '
       || smarter_private.reliability_one_line(coalesce(i.escalation_reason, 'no eligible recovery'), 120)
       || ' (class ' || i.incident_class || ' has no enabled runbook).' || E'\n'
    || 'Containment: None verified.' || E'\n'
    || 'Current uncertainty: Root cause is not established. The controller saw the alert only and inspected nothing else.'
       || CASE WHEN i.resolution_state = 'uncertain'
               THEN ' A resolved signal arrived that could not be ordered against the firing, so whether it cleared is uncertain.' ELSE '' END || E'\n'
    || 'Next action: Read the evidence below, find what raises this alert at its source, and fix that code or schema.' || E'\n'
    || E'\n'
    || 'Agent Handoff' || E'\n'
    || 'Alert name: ' || smarter_private.reliability_one_line(i.alertname, 120) || E'\n'
    || 'Source: ' || smarter_private.reliability_one_line(i.source, 80) || E'\n'
    || 'Incident class: ' || i.incident_class || E'\n'
    || 'Scope labels: ' || coalesce(v_labels, 'none') || E'\n'
    || 'Occurrence count: ' || i.occurrence_count::text || E'\n'
    || 'Recurrence count: ' || i.recurrence_count::text || E'\n'
    || CASE WHEN i.engine_release IS NOT NULL THEN 'Engine release: ' || smarter_private.reliability_one_line(i.engine_release, 64) || E'\n' ELSE '' END
    || CASE WHEN v_summary IS NOT NULL THEN 'Rule summary: ' || v_summary || E'\n' ELSE '' END
    || 'Evidence: smarter_private.reliability_incidents ' || i.id::text || ', inbox events '
       || CASE WHEN v_first IS NULL THEN 'none' ELSE v_first::text || '..' || v_last::text END || E'\n'
    || 'Acceptance criteria: Identify root cause, fix at source, verify alert clears and stays clear.';
  RETURN left(v_body, 2000);
END
$fn$;

-- ---------------------------------------------------------------------------
-- Outbox
-- ---------------------------------------------------------------------------
-- Created in the transaction of the transition that caused it. request_id is
-- a pure function of (incident, seq), so a replayed send is the same message.
CREATE FUNCTION smarter_private.reliability_enqueue_notification(p_incident_id uuid, p_kind text, p_body text DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'smarter_private'
AS $fn$
DECLARE
  s smarter_private.reliability_settings;
  v_id bigint := nextval('smarter_private.reliability_notifications_id_seq');
  v_seq integer;
  v_severity text;
  v_group text;
  v_state text := 'queued';
  v_note text;
  v_request uuid;
BEGIN
  SELECT * INTO STRICT s FROM smarter_private.reliability_settings WHERE id;
  IF p_incident_id IS NULL THEN
    v_seq := 0;
    v_request := md5('reliability-controller:validation:' || v_id::text)::uuid;
  ELSE
    SELECT severity, group_key INTO STRICT v_severity, v_group FROM smarter_private.reliability_incidents WHERE id = p_incident_id FOR UPDATE;
    SELECT coalesce(max(n.seq), 0) + 1 INTO v_seq FROM smarter_private.reliability_notifications n WHERE n.incident_id = p_incident_id;
    v_request := md5('reliability-controller:' || p_incident_id::text || ':' || v_seq::text)::uuid;
  END IF;
  IF p_kind <> 'validation' THEN
    IF s.notify_mode = 'observe' THEN
      v_state := 'suppressed_observe'; v_note := 'notify_mode observe';
    ELSIF s.notify_mode = 'critical_only' AND v_severity IS DISTINCT FROM 'critical' THEN
      v_state := 'suppressed_observe'; v_note := 'notify_mode critical_only';
    END IF;
  END IF;
  -- The row first (with a placeholder), so the digest can count its incidents.
  INSERT INTO smarter_private.reliability_notifications (id, incident_id, seq, kind, request_id, body, state, group_key, last_error)
  VALUES (v_id, p_incident_id, v_seq, p_kind, v_request, coalesce(p_body, 'pending'), v_state, v_group, v_note);
  IF p_incident_id IS NOT NULL THEN
    INSERT INTO smarter_private.reliability_notification_incidents (notification_id, incident_id) VALUES (v_id, p_incident_id);
    IF p_kind = 'reminder' THEN
      INSERT INTO smarter_private.reliability_notification_incidents (notification_id, incident_id)
      SELECT v_id, j.id FROM smarter_private.reliability_incidents j
       WHERE j.group_key = v_group AND j.status = 'escalated' AND j.id <> p_incident_id
       ORDER BY j.opened_at LIMIT 50
      ON CONFLICT DO NOTHING;
    END IF;
    IF p_body IS NULL THEN
      UPDATE smarter_private.reliability_notifications SET body = smarter_private.reliability_render_escalation(p_incident_id, p_kind, v_id) WHERE id = v_id;
    END IF;
  END IF;
  RETURN v_id;
END
$fn$;

-- One escalation message per (class, normalized alert name) per reminder
-- window. A further incident of the group attaches to that message.
CREATE FUNCTION smarter_private.reliability_escalate(p_incident_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'smarter_private'
AS $fn$
DECLARE
  i smarter_private.reliability_incidents;
  n smarter_private.reliability_notifications;
  v_hours integer;
BEGIN
  PERFORM smarter_private.reliability_transition(p_incident_id, 'escalated', p_reason, jsonb_build_object('kind', 'escalation'));
  SELECT * INTO STRICT i FROM smarter_private.reliability_incidents WHERE id = p_incident_id;
  IF i.source = 'reliability-controller' AND i.alertname = 'ReliabilityDeliveryFailing' THEN
    -- A message about not being able to send messages is a loop.
    INSERT INTO smarter_private.reliability_incident_events (incident_id, kind, detail)
    VALUES (i.id, 'notification_withheld', jsonb_build_object('reason', 'delivery failures are never announced through delivery'));
    RETURN;
  END IF;
  SELECT reminder_hours INTO STRICT v_hours FROM smarter_private.reliability_settings WHERE id;
  PERFORM pg_advisory_xact_lock(hashtextextended('reliability-group:' || i.group_key, 0));
  SELECT * INTO n FROM smarter_private.reliability_notifications x
   WHERE x.group_key = i.group_key AND x.kind IN ('escalation', 'reminder')
     AND x.created_at > clock_timestamp() - make_interval(hours => v_hours)
   ORDER BY x.id DESC LIMIT 1
   FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM smarter_private.reliability_enqueue_notification(p_incident_id, 'escalation');
    RETURN;
  END IF;
  INSERT INTO smarter_private.reliability_notification_incidents (notification_id, incident_id)
  VALUES (n.id, i.id) ON CONFLICT DO NOTHING;
  INSERT INTO smarter_private.reliability_incident_events (incident_id, kind, detail)
  VALUES (i.id, 'escalation_attached', jsonb_build_object('notification_id', n.id, 'lead_incident_id', n.incident_id));
  -- A message nobody has tried to send yet can still say how many it covers.
  IF n.state IN ('queued', 'rate_limited') AND n.attempts = 0 THEN
    UPDATE smarter_private.reliability_notifications SET body = smarter_private.reliability_render_escalation(n.incident_id, n.kind, n.id) WHERE id = n.id;
  END IF;
END
$fn$;

-- The dedicated controller conversation, created the way
-- public.fn_route_bug_report_to_owner creates its own and reused while both
-- parties are in it. The caller holds the settings row.
CREATE FUNCTION smarter_private.reliability_owner_conversation()
RETURNS uuid
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'smarter_private'
AS $fn$
DECLARE
  s smarter_private.reliability_settings;
  v_conv uuid;
BEGIN
  SELECT * INTO STRICT s FROM smarter_private.reliability_settings WHERE id;
  v_conv := s.conversation_id;
  IF v_conv IS NOT NULL AND (
       SELECT count(*) FROM public.social_conversation_participants p
        WHERE p.conversation_id = v_conv
          AND p.user_id IN (s.owner_user_id, s.system_sender_id)) <> 2 THEN
    v_conv := NULL;
  END IF;
  IF v_conv IS NULL THEN
    INSERT INTO public.social_conversations (is_group) VALUES (false) RETURNING id INTO v_conv;
    INSERT INTO public.social_conversation_participants (conversation_id, user_id)
    VALUES (v_conv, s.system_sender_id), (v_conv, s.owner_user_id);
    UPDATE smarter_private.reliability_settings SET conversation_id = v_conv, updated_at = clock_timestamp() WHERE id;
  END IF;
  RETURN v_conv;
END
$fn$;

-- Safe under concurrent callers: the settings row is the one serialization
-- point (a second caller returns 'busy' at once), every row is locked before
-- it is sent, and request_id on messenger_send_requests is the final guard.
CREATE FUNCTION smarter_private.reliability_deliver_notifications(p_limit integer DEFAULT 10, p_only_id bigint DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'smarter_private'
AS $fn$
DECLARE
  s smarter_private.reliability_settings;
  r smarter_private.reliability_notifications;
  i smarter_private.reliability_incidents;
  v_conversation uuid;
  v_answer jsonb;
  v_sent_hour integer;
  v_sent integer := 0;
  v_limited integer := 0;
  v_failed integer := 0;
  v_suppressed integer := 0;
  v_push uuid;
  v_push_status text;
  v_push_reason text;
  v_push_state text;
BEGIN
  IF COALESCE(auth.role(), '') NOT IN ('', 'service_role') THEN
    RAISE EXCEPTION 'smarter_private.reliability_deliver_notifications is service-only' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM smarter_private.reliability_settings WHERE id FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('skipped', 'busy');
  END IF;
  FOR r IN
    SELECT n.* FROM smarter_private.reliability_notifications n
     WHERE n.state IN ('queued', 'rate_limited')
       AND (p_only_id IS NULL OR n.id = p_only_id)
     ORDER BY n.id
     LIMIT least(greatest(coalesce(p_limit, 10), 1), 50)
     FOR UPDATE SKIP LOCKED
  LOOP
    IF r.kind <> 'validation' THEN
      IF s.notify_mode = 'observe' THEN
        UPDATE smarter_private.reliability_notifications SET state = 'suppressed_observe', last_error = 'notify_mode observe' WHERE id = r.id;
        v_suppressed := v_suppressed + 1;
        CONTINUE;
      END IF;
      SELECT count(*) INTO v_sent_hour FROM smarter_private.reliability_notifications n
       WHERE n.state = 'persisted_in_messenger' AND n.kind <> 'validation'
         AND n.sent_at > clock_timestamp() - interval '1 hour';
      IF v_sent_hour >= s.max_dm_per_hour THEN
        UPDATE smarter_private.reliability_notifications SET state = 'rate_limited', last_error = 'max_dm_per_hour reached' WHERE id = r.id;
        v_limited := v_limited + 1;
        CONTINUE;
      END IF;
    END IF;
    BEGIN
      IF v_conversation IS NULL THEN
        v_conversation := smarter_private.reliability_owner_conversation();
      END IF;
      v_answer := public.fn_send_message_once(
        v_conversation, s.system_sender_id, r.request_id, r.body, 'text',
        jsonb_build_object('kind', 'reliability_incident', 'incident_id', r.incident_id,
                           'notification_kind', r.kind, 'handoff_version', 1));
      IF v_answer->>'message_id' IS NULL THEN
        RAISE EXCEPTION 'messenger returned no message id';
      END IF;
      UPDATE smarter_private.reliability_notifications
         SET state = 'persisted_in_messenger', message_id = (v_answer->>'message_id')::uuid,
             sent_at = clock_timestamp(), attempts = attempts + 1, last_error = NULL
       WHERE id = r.id;
      v_sent := v_sent + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE smarter_private.reliability_notifications
         SET attempts = attempts + 1, last_error = left(SQLSTATE || ': ' || SQLERRM, 500),
             state = CASE WHEN attempts + 1 >= 5 THEN 'failed' ELSE 'queued' END
       WHERE id = r.id;
      v_failed := v_failed + 1;
      CONTINUE;
    END;
    -- One phone push per sent escalation, reminder or validation, in the
    -- existing durable outbox. Its guards decide; what they decide is
    -- mirrored and never undoes the message above.
    IF r.kind IN ('escalation', 'reminder', 'validation') AND r.push_outbox_id IS NULL AND r.push_state = 'not_requested' THEN
      v_push := NULL; v_push_status := NULL; v_push_reason := NULL;
      BEGIN
        IF r.incident_id IS NOT NULL THEN
          SELECT * INTO STRICT i FROM smarter_private.reliability_incidents WHERE id = r.incident_id;
        END IF;
        INSERT INTO public.push_outbox (recipient_user_id, title, body, url, event, tag, status, related_entity_id)
        VALUES (s.owner_user_id,
                left(CASE WHEN r.kind = 'validation' THEN 'Reliability Controller Validation'
                          ELSE 'AI Agent Needed: ' || smarter_private.reliability_one_line(i.title, 100) END, 120),
                left(CASE WHEN r.kind = 'validation' THEN smarter_private.reliability_one_line(r.body, 400)
                          ELSE upper(i.severity) || ': ' || smarter_private.reliability_one_line(i.alertname, 160)
                               || ' (' || smarter_private.reliability_scope_id(i.scope) || '). Open Messenger for the agent handoff.' END, 500),
                '/hub/messenger?conversation=' || v_conversation::text,
                'reliability_escalation',
                'reliability:' || coalesce(r.incident_id::text, 'validation:' || r.id::text),
                'pending',
                r.incident_id)
        RETURNING id, status, failure_reason INTO v_push, v_push_status, v_push_reason;
        v_push_state := CASE
          WHEN v_push IS NULL THEN 'refused'
          WHEN v_push_status = 'pending' THEN 'pending'
          WHEN v_push_reason = 'routed_to_production_alerts' THEN 'diverted_by_guard'
          ELSE 'refused' END;
        v_push_reason := CASE WHEN v_push IS NULL THEN 'a push_outbox trigger returned no row'
                              ELSE v_push_status || coalesce(': ' || v_push_reason, '') END;
      EXCEPTION WHEN OTHERS THEN
        v_push := NULL;
        v_push_state := 'refused';
        v_push_reason := left(SQLSTATE || ': ' || SQLERRM, 300);
      END;
      UPDATE smarter_private.reliability_notifications
         SET push_outbox_id = v_push, push_state = v_push_state, push_detail = v_push_reason
       WHERE id = r.id;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('sent', v_sent, 'rate_limited', v_limited, 'failed', v_failed, 'suppressed', v_suppressed);
END
$fn$;

CREATE FUNCTION smarter_private.reliability_send_validation_message(p_text text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'smarter_private'
AS $fn$
DECLARE
  v_id bigint;
  r smarter_private.reliability_notifications;
BEGIN
  IF COALESCE(auth.role(), '') NOT IN ('', 'service_role') THEN
    RAISE EXCEPTION 'smarter_private.reliability_send_validation_message is service-only' USING ERRCODE = '42501';
  END IF;
  v_id := smarter_private.reliability_enqueue_notification(
    NULL, 'validation',
    left('RELIABILITY CONTROLLER VALIDATION' || E'\n' || smarter_private.reliability_one_line(p_text, 1900), 2000));
  PERFORM smarter_private.reliability_deliver_notifications(1, v_id);
  SELECT * INTO STRICT r FROM smarter_private.reliability_notifications WHERE id = v_id;
  RETURN jsonb_build_object('notification_id', r.id, 'state', r.state, 'message_id', r.message_id,
                            'request_id', r.request_id, 'last_error', r.last_error);
END
$fn$;

-- ---------------------------------------------------------------------------
-- The one place a signal changes an incident
-- ---------------------------------------------------------------------------
-- p_observation_id is the observation already written for this delivery; it
-- is stamped with the incident and with what was done with it.
CREATE FUNCTION smarter_private.reliability_apply_signal(
  p_class text, p_escalate_immediately boolean, p_default_severity text,
  p_source_family text, p_alertname text, p_normalized_name text, p_status text, p_severity text,
  p_scope jsonb, p_evidence jsonb, p_engine_release text,
  p_member_key text, p_resolvable boolean, p_event_at timestamptz, p_observation_id bigint,
  p_episode text, p_episode_at timestamptz, p_received_at timestamptz)
RETURNS uuid
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'smarter_private'
AS $fn$
DECLARE
  v_fp text := md5(p_class || '|' || p_source_family || '|' || p_alertname || '|' || coalesce(p_scope, '{}'::jsonb)::text);
  v_severity text := CASE WHEN smarter_private.reliability_severity_rank(p_severity) > 0 THEN lower(p_severity)
                          ELSE coalesce(nullif(p_default_severity, ''), 'warning') END;
  v_resolved boolean := p_status = 'resolved';
  m smarter_private.reliability_alert_members;
  v_known boolean;
  v_fresh boolean;
  v_created boolean := false;
  v_policy boolean := false;
  v_upgraded boolean := false;
  v_prior smarter_private.reliability_incidents;
  i smarter_private.reliability_incidents;
  v_disposition text := 'applied';
  v_why text := 'stale';
  v_uncertain boolean := false;
  v_try integer := 0;
  v_rows integer;
BEGIN
  -- 1. The record. One row per concrete alert; a record already known keeps
  --    the incident it belongs to (identity, not name). Its state moves only
  --    forward, and "forward" is decided on one clock: the episode when both
  --    sides name one, the database receipt time otherwise.
  INSERT INTO smarter_private.reliability_alert_members
    (member_key, fingerprint, status, resolvable, episode, episode_at, last_event_at, last_received_at, last_firing_at, last_firing_received_at)
  VALUES (p_member_key, v_fp, p_status, p_resolvable, p_episode, p_episode_at, p_event_at, p_received_at,
          CASE WHEN v_resolved THEN NULL ELSE p_event_at END, CASE WHEN v_resolved THEN NULL ELSE p_received_at END)
  ON CONFLICT (member_key) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_known := v_rows = 0;
  SELECT * INTO STRICT m FROM smarter_private.reliability_alert_members WHERE member_key = p_member_key FOR UPDATE;
  IF NOT v_known THEN
    v_fresh := true;
  ELSE
    v_fp := m.fingerprint;
    IF v_resolved THEN
      IF m.status <> 'firing' THEN
        v_fresh := false; v_why := 'resolved_already';
      ELSIF p_episode IS NOT NULL AND m.episode IS NOT NULL THEN
        v_fresh := p_episode = m.episode; v_why := 'resolved_older_episode';
      ELSIF m.last_firing_received_at IS NULL OR p_received_at = m.last_firing_received_at THEN
        -- No episode and no usable receipt order: do not guess.
        v_fresh := false; v_why := 'resolution_order_unknown'; v_uncertain := true;
      ELSE
        v_fresh := p_received_at > m.last_firing_received_at;
        v_why := 'resolved_before_last_firing_receipt';
      END IF;
    ELSIF p_episode_at IS NOT NULL AND m.episode_at IS NOT NULL THEN
      v_fresh := p_episode_at > m.episode_at OR (p_episode = m.episode AND m.status = 'firing');
    ELSE
      v_fresh := p_received_at >= m.last_received_at;
    END IF;
    IF v_fresh THEN
      UPDATE smarter_private.reliability_alert_members
         SET status = p_status, resolvable = p_resolvable, last_event_at = p_event_at, last_received_at = p_received_at,
             episode = CASE WHEN v_resolved THEN episode ELSE p_episode END,
             episode_at = CASE WHEN v_resolved THEN episode_at ELSE p_episode_at END,
             last_firing_at = CASE WHEN v_resolved THEN last_firing_at ELSE p_event_at END,
             last_firing_received_at = CASE WHEN v_resolved THEN last_firing_received_at ELSE p_received_at END
       WHERE member_key = p_member_key;
    END IF;
  END IF;

  -- 2. The open incident for this fingerprint, created for a fresh firing.
  LOOP
    v_try := v_try + 1;
    SELECT * INTO i FROM smarter_private.reliability_incidents WHERE fingerprint = v_fp AND status <> 'closed' FOR UPDATE;
    EXIT WHEN FOUND OR v_resolved OR NOT v_fresh OR v_try > 3;
    SELECT * INTO v_prior FROM smarter_private.reliability_incidents
     WHERE fingerprint = v_fp AND status = 'closed' ORDER BY created_at DESC LIMIT 1;
    INSERT INTO smarter_private.reliability_incidents
      (fingerprint, incident_class, title, severity, source, alertname, group_key, related_incident_id, scope,
       first_observed_at, last_observed_at, last_firing_at, last_firing_received_at, opened_at, occurrence_count,
       latest_evidence, engine_release, recurrence_count)
    VALUES
      (v_fp, p_class, smarter_private.reliability_one_line(p_normalized_name, 120) || ' (' || replace(p_class, '_', ' ') || ')',
       v_severity, p_source_family, p_alertname, p_class || '|' || p_normalized_name,
       -- A wrapper that names no record is linked, never merged.
       CASE WHEN p_alertname <> p_normalized_name THEN (
         SELECT r.id FROM smarter_private.reliability_incidents r
          WHERE r.alertname = p_normalized_name AND r.scope = coalesce(p_scope, '{}'::jsonb) AND r.status <> 'closed'
          ORDER BY r.created_at DESC LIMIT 1) END,
       coalesce(p_scope, '{}'::jsonb),
       p_event_at, p_event_at, p_event_at, p_received_at, p_event_at, 1,
       coalesce(p_evidence, '{}'::jsonb), p_engine_release,
       CASE WHEN v_prior.id IS NOT NULL AND v_prior.status_changed_at > clock_timestamp() - interval '24 hours'
            THEN v_prior.recurrence_count + 1 ELSE 0 END)
    ON CONFLICT (fingerprint) WHERE status <> 'closed' DO NOTHING
    RETURNING * INTO i;
    IF FOUND THEN
      v_created := true;
      INSERT INTO smarter_private.reliability_incident_events (incident_id, kind, to_status, detail)
      VALUES (i.id, 'opened', 'investigating',
              jsonb_build_object('previous_incident_id', v_prior.id, 'recurrence_count', i.recurrence_count));
      IF i.recurrence_count > 0 THEN
        INSERT INTO smarter_private.reliability_incident_events (incident_id, kind, to_status, detail)
        VALUES (i.id, 'recurrence', 'investigating', jsonb_build_object('previous_incident_id', v_prior.id));
      END IF;
      EXIT;
    END IF;
  END LOOP;

  IF i.id IS NULL THEN
    -- Nothing open. A resolved row for a closed incident is kept against it
    -- and reopens nothing; a stale or orphan delivery is only an observation.
    IF v_resolved THEN
      SELECT * INTO v_prior FROM smarter_private.reliability_incidents
       WHERE fingerprint = v_fp AND status = 'closed' ORDER BY created_at DESC LIMIT 1;
      IF FOUND THEN
        INSERT INTO smarter_private.reliability_incident_events (incident_id, kind, detail)
        VALUES (v_prior.id, 'late_resolved', jsonb_build_object('observation_id', p_observation_id, 'event_at', p_event_at));
        UPDATE smarter_private.reliability_observations SET incident_id = v_prior.id, disposition = 'late_resolved' WHERE id = p_observation_id;
        RETURN v_prior.id;
      END IF;
      UPDATE smarter_private.reliability_observations SET disposition = 'resolved_without_incident' WHERE id = p_observation_id;
    ELSE
      UPDATE smarter_private.reliability_observations SET disposition = 'stale' WHERE id = p_observation_id;
    END IF;
    RETURN NULL;
  END IF;

  -- The evidence reference of an escalation reads this.
  UPDATE smarter_private.reliability_observations SET incident_id = i.id WHERE id = p_observation_id;

  IF NOT v_fresh THEN
    -- Kept as an observation; no state changes.
    v_disposition := v_why;
    UPDATE smarter_private.reliability_incidents
       SET last_observed_at = greatest(last_observed_at, p_event_at), updated_at = clock_timestamp()
     WHERE id = i.id;
  ELSIF v_resolved THEN
    UPDATE smarter_private.reliability_incidents
       SET last_observed_at = greatest(last_observed_at, p_event_at), updated_at = clock_timestamp()
     WHERE id = i.id;
    IF NOT v_known OR m.last_firing_at IS NULL OR m.last_firing_at < i.opened_at THEN
      -- Not a record this episode saw firing: it resolves nothing here, and
      -- whether it speaks for this incident cannot be established.
      v_disposition := 'resolved_not_of_this_episode';
      v_uncertain := i.status IN ('investigating', 'recovering', 'contained', 'escalated');
    ELSE
      UPDATE smarter_private.reliability_incidents
         SET last_resolved_at = greatest(coalesce(last_resolved_at, p_received_at), p_received_at)
       WHERE id = i.id;
      IF EXISTS (SELECT 1 FROM smarter_private.reliability_alert_members x
                  WHERE x.fingerprint = v_fp AND x.status = 'firing' AND x.resolvable AND x.last_firing_at >= i.opened_at) THEN
        v_disposition := 'resolved_others_still_firing';
      ELSIF i.status IN ('investigating', 'recovering', 'contained', 'escalated') THEN
        PERFORM smarter_private.reliability_transition(i.id, 'verifying', 'the alert resolved',
          jsonb_build_object('kind', 'resolved_signal', 'event_at', p_event_at, 'episode', p_episode));
      END IF;
    END IF;
  ELSIF NOT v_created THEN
    v_upgraded := smarter_private.reliability_severity_rank(v_severity) > smarter_private.reliability_severity_rank(i.severity);
    UPDATE smarter_private.reliability_incidents
       SET occurrence_count = occurrence_count + 1,
           last_observed_at = greatest(last_observed_at, p_event_at),
           last_firing_at = greatest(coalesce(last_firing_at, p_event_at), p_event_at),
           last_firing_received_at = greatest(coalesce(last_firing_received_at, p_received_at), p_received_at),
           latest_evidence = coalesce(p_evidence, latest_evidence),
           engine_release = coalesce(p_engine_release, engine_release),
           severity = CASE WHEN v_upgraded THEN v_severity ELSE severity END,
           recurrence_count = recurrence_count + CASE WHEN i.status IN ('recovered', 'stale_unverified') THEN 1 ELSE 0 END,
           opened_at = CASE WHEN i.status IN ('recovered', 'stale_unverified') THEN p_event_at ELSE opened_at END,
           updated_at = clock_timestamp()
     WHERE id = i.id;
    IF i.status = 'recovered' OR (i.status = 'stale_unverified' AND i.escalation_state <> 'escalated') THEN
      PERFORM smarter_private.reliability_transition(i.id, 'investigating', 'the alert fired again',
        jsonb_build_object('kind', 'recurrence', 'event_at', p_event_at, 'from', i.status));
      v_policy := true;
    ELSIF i.status = 'stale_unverified' THEN
      PERFORM smarter_private.reliability_transition(i.id, 'escalated', coalesce(i.escalation_reason, 'no eligible recovery'),
        jsonb_build_object('kind', 'recurrence', 'event_at', p_event_at, 'from', i.status));
    ELSIF i.status = 'verifying' THEN
      -- Fired again before recovery was confirmed: back where it was, and no
      -- second escalation for the same episode.
      PERFORM smarter_private.reliability_transition(i.id,
        CASE WHEN i.escalation_state = 'escalated' THEN 'escalated' ELSE 'investigating' END,
        coalesce(i.escalation_reason, 'the alert fired again while verifying'),
        jsonb_build_object('kind', 'refire', 'event_at', p_event_at));
    END IF;
  END IF;

  -- 3. Stage B escalation policy at creation, recurrence or a rise to critical.
  IF v_fresh AND NOT v_resolved AND (v_created OR v_policy OR v_upgraded) THEN
    SELECT * INTO i FROM smarter_private.reliability_incidents WHERE id = i.id;
    IF i.status = 'investigating'
       AND (i.severity = 'critical' OR p_escalate_immediately)
       AND NOT EXISTS (SELECT 1 FROM smarter_private.reliability_runbooks r
                        WHERE r.enabled AND r.eligibility->>'incident_class' = i.incident_class) THEN
      PERFORM smarter_private.reliability_escalate(i.id, 'no eligible recovery');
    END IF;
  END IF;

  IF v_uncertain AND v_resolved AND i.resolution_state <> 'uncertain' THEN
    UPDATE smarter_private.reliability_incidents SET resolution_state = 'uncertain', updated_at = clock_timestamp() WHERE id = i.id;
    INSERT INTO smarter_private.reliability_incident_events (incident_id, kind, detail)
    VALUES (i.id, 'resolution_uncertain',
            jsonb_build_object('observation_id', p_observation_id, 'why', v_disposition, 'status_kept', i.status));
  END IF;

  UPDATE smarter_private.reliability_observations SET disposition = v_disposition WHERE id = p_observation_id;
  RETURN i.id;
END
$fn$;

-- ---------------------------------------------------------------------------
-- Intake from the inbox
-- ---------------------------------------------------------------------------
CREATE FUNCTION smarter_private.reliability_ingest_alert(
  p_id bigint, p_source text, p_event_key text, p_alertname text, p_status text, p_severity text,
  p_payload jsonb, p_received_at timestamptz, p_last_received_at timestamptz, p_delivery_count bigint,
  p_investigation_status text, p_operation text)
RETURNS uuid
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'smarter_private'
AS $fn$
DECLARE
  v_alert jsonb := p_payload->'alert';
  v_labels jsonb := '{}'::jsonb;
  v_resolved boolean := p_status = 'resolved';
  v_raw_name text := left(p_alertname, 240);
  v_name text := smarter_private.reliability_normalize_alertname(p_alertname);
  v_family text := smarter_private.reliability_source_family(p_source);
  v_class smarter_private.reliability_alert_classes;
  v_scope jsonb;
  v_evidence_labels jsonb;
  v_record text;
  v_member text;
  v_event_at timestamptz;
  v_received timestamptz;
  v_episode text;
  v_episode_at timestamptz;
  v_now timestamptz := clock_timestamp();
  v_observation bigint;
  v_release text;
BEGIN
  -- The controller's own rows never re-enter intake.
  IF p_source LIKE 'reliability-controller%' THEN RETURN NULL; END IF;
  -- Never an incident: test rows, the canary, pure information, and a firing
  -- row the inbox already classified informational (a mirror duplicate).
  IF p_investigation_status = 'test' OR lower(p_severity) = 'canary' THEN RETURN NULL; END IF;
  IF p_status = 'info' AND lower(p_severity) = 'info' THEN RETURN NULL; END IF;
  IF NOT v_resolved AND p_investigation_status = 'informational' THEN RETURN NULL; END IF;

  IF p_source = 'alertmanager' THEN
    IF jsonb_typeof(v_alert) IS DISTINCT FROM 'object' OR jsonb_typeof(v_alert->'labels') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'malformed alertmanager payload: alert.labels is not an object' USING ERRCODE = '22023';
    END IF;
    v_labels := v_alert->'labels';
    IF v_labels->>'severity' = 'canary' THEN RETURN NULL; END IF;
  ELSIF jsonb_typeof(p_payload->'labels') = 'object' THEN
    v_labels := p_payload->'labels';
  END IF;

  v_class := smarter_private.reliability_classify(p_source, v_name, p_severity, v_resolved);
  IF v_class.id IS NULL THEN
    v_class.incident_class := 'unclassified';
    v_class.default_severity := 'warning';
    v_class.escalate_immediately := true;
    v_class.is_incident := true;
  END IF;
  IF NOT v_class.is_incident THEN RETURN NULL; END IF;

  -- What separates one incident from another, for every source: the durable
  -- identity fields of docs/reliability-controller/CLASS-CATALOG.md. Ids are
  -- read wherever the producer writes them; the label-only fields are read
  -- from labels alone. A hand id, a settlement id or a request id is never read.
  v_scope := jsonb_strip_nulls(jsonb_build_object(
    'table_id', smarter_private.reliability_payload_id(v_labels, p_payload, 'table_id'),
    'tournament_id', smarter_private.reliability_payload_id(v_labels, p_payload, 'tournament_id'),
    'game_id', smarter_private.reliability_payload_id(v_labels, p_payload, 'game_id'),
    'cluster_id', smarter_private.reliability_payload_id(v_labels, p_payload, 'cluster_id'),
    'variant', smarter_private.reliability_payload_id(v_labels, p_payload, 'variant'),
    'operation_id', smarter_private.reliability_payload_id(v_labels, p_payload, 'operation_id'),
    'union_id', smarter_private.reliability_payload_id(v_labels, p_payload, 'union_id'),
    'scope_id', smarter_private.reliability_payload_id(v_labels, p_payload, 'scope_id'),
    'period_end', smarter_private.reliability_payload_id(v_labels, p_payload, 'period_end'))
    || jsonb_build_object(
    'instance', left(v_labels->>'instance', 120),
    'host', left(v_labels->>'host', 120),
    'scope', left(v_labels->>'scope', 120),
    'reason', left(v_labels->>'reason', 120),
    'rpc', left(v_labels->>'rpc', 120),
    'jobname', left(v_labels->>'jobname', 120),
    'slot', left(v_labels->>'slot', 120),
    'run', left(v_labels->>'run', 120)));

  v_evidence_labels := v_scope || jsonb_strip_nulls(jsonb_build_object(
    'alertname', v_raw_name, 'severity', lower(p_severity), 'source', p_source,
    'component', left(v_labels->>'component', 120),
    'format', left(v_labels->>'format', 120), 'job', left(v_labels->>'job', 120)));

  -- The record this delivery is about. For the ledger mirrors it is the inner
  -- financial alert id when the row carries it (see the header).
  v_record := CASE
    WHEN v_family = 'financial-alerts' AND v_raw_name <> v_name
      THEN smarter_private.reliability_payload_id('{}'::jsonb, jsonb_build_object('original_event', p_payload->'original_event'), 'alert_id')
    WHEN v_family = 'drift-incidents'
      THEN smarter_private.reliability_payload_id('{}'::jsonb, jsonb_build_object('original_incident',
             jsonb_build_object('metadata', p_payload #> '{original_incident,metadata}')), 'alert_id') END;
  v_member := CASE
    WHEN p_source = 'alertmanager' THEN 'alertmanager:' || v_raw_name || ':' || coalesce(v_alert->>'fingerprint', p_event_key)
    WHEN v_record IS NOT NULL THEN 'financial-alert:' || v_record
    WHEN v_family = 'financial-alerts' AND v_raw_name = v_name THEN 'financial-alert:' || split_part(p_event_key, ':', 1)
    WHEN jsonb_typeof(p_payload->'resolves') = 'string' THEN p_source || ':' || (p_payload->>'resolves')
    WHEN p_source ~ '-(backfill|updates)$' THEN v_family || ':' || v_raw_name || ':' || split_part(p_event_key, ':', 1)
    ELSE p_source || ':' || regexp_replace(p_event_key, ':resolved$', '') END;

  -- The EVENT time. A redelivery says "still so now"; anything else carries
  -- its own time in the payload when the producer wrote one.
  v_event_at := CASE
    WHEN p_operation = 'REDELIVERY' THEN p_last_received_at
    WHEN v_resolved THEN coalesce(smarter_private.reliability_safe_timestamp(v_alert->>'endsAt'),
                                  smarter_private.reliability_safe_timestamp(p_payload->>'resolved_at'),
                                  CASE WHEN p_operation = 'STATUS_CHANGE' THEN v_now ELSE p_received_at END)
    ELSE coalesce(smarter_private.reliability_safe_timestamp(v_alert->>'startsAt'),
                  smarter_private.reliability_safe_timestamp(p_payload->>'detected_at'),
                  smarter_private.reliability_safe_timestamp(p_payload->>'at'),
                  smarter_private.reliability_safe_timestamp(p_payload->>'observed_at'),
                  CASE WHEN p_operation = 'STATUS_CHANGE' THEN v_now ELSE p_received_at END) END;
  v_event_at := least(coalesce(v_event_at, v_now), v_now);
  -- The database's own clock for this delivery.
  v_received := CASE p_operation WHEN 'REDELIVERY' THEN p_last_received_at WHEN 'STATUS_CHANGE' THEN v_now ELSE p_received_at END;
  -- The episode. Alertmanager: startsAt, which its resolved row repeats. Any
  -- other producer: the inbox row, which a firing and an in-place resolve share.
  IF p_source = 'alertmanager' THEN
    v_episode_at := smarter_private.reliability_safe_timestamp(v_alert->>'startsAt');
    v_episode := CASE WHEN v_episode_at IS NOT NULL THEN v_alert->>'startsAt' END;
  ELSIF NOT v_resolved OR p_operation = 'STATUS_CHANGE' THEN
    v_episode := 'row:' || p_id::text;
  END IF;

  -- One observation per delivery. A repeat of the same delivery stops here.
  INSERT INTO smarter_private.reliability_observations (inbox_event_id, delivery_count, status, severity, scope, observed_at)
  VALUES (p_id, p_delivery_count, CASE WHEN v_resolved THEN 'resolved' ELSE 'firing' END, lower(p_severity), v_scope, v_event_at)
  ON CONFLICT (inbox_event_id, delivery_count, status) DO NOTHING
  RETURNING id INTO v_observation;
  IF v_observation IS NULL THEN RETURN NULL; END IF;

  v_release := nullif(left(coalesce(
    CASE WHEN jsonb_typeof(p_payload->'releaseSha') = 'string' THEN p_payload->>'releaseSha' END,
    CASE WHEN jsonb_typeof(p_payload->'engine_release') = 'string' THEN p_payload->>'engine_release' END,
    CASE WHEN jsonb_typeof(p_payload->'serving_sha') = 'string' THEN p_payload->>'serving_sha' END,
    v_labels->>'release', v_labels->>'engine_release', ''), 64), '');

  RETURN smarter_private.reliability_apply_signal(
    v_class.incident_class, v_class.escalate_immediately, v_class.default_severity,
    v_family, v_raw_name, v_name, CASE WHEN v_resolved THEN 'resolved' ELSE 'firing' END, p_severity,
    v_scope,
    jsonb_build_object(
      'inbox_event_id', p_id, 'delivery_count', p_delivery_count, 'raw_source', p_source,
      'labels', v_evidence_labels, 'event_at', v_event_at,
      'summary', CASE WHEN jsonb_typeof(v_alert->'annotations') = 'object'
                      THEN smarter_private.reliability_one_line(v_alert->'annotations'->>'summary', 300) END),
    v_release, v_member,
    NOT EXISTS (SELECT 1 FROM smarter_private.reliability_sources_without_resolve w WHERE w.source = p_source),
    v_event_at, v_observation, v_episode, v_episode_at, v_received);
END
$fn$;

-- THE TRIGGER NEVER BREAKS INTAKE. Everything runs inside a handler; what the
-- handler catches is written to intake_rejections, and the inbox row commits.
CREATE FUNCTION smarter_private.reliability_trg_operational_alert_intake()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'smarter_private'
SET lock_timeout TO '2s'
AS $fn$
DECLARE
  v_operation text;
  v_reason text;
  v_state text;
BEGIN
  BEGIN
    v_operation := CASE WHEN TG_OP = 'INSERT' THEN 'INSERT'
                        WHEN OLD.status IS DISTINCT FROM NEW.status THEN 'STATUS_CHANGE'
                        ELSE 'REDELIVERY' END;
    PERFORM smarter_private.reliability_ingest_alert(
      NEW.id, NEW.source, NEW.event_key, NEW.alertname, NEW.status, NEW.severity, NEW.payload,
      NEW.received_at, NEW.last_received_at, NEW.delivery_count, NEW.investigation_status, v_operation);
  EXCEPTION WHEN OTHERS THEN
    v_reason := SQLERRM;
    v_state := SQLSTATE;
    BEGIN
      INSERT INTO smarter_private.reliability_intake_rejections (inbox_event_id, source, alertname, event_key, operation, reason, sqlstate)
      VALUES (NEW.id, left(NEW.source, 120), left(NEW.alertname, 240), left(NEW.event_key, 512), v_operation,
              left(v_reason, 1000), v_state);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'reliability intake rejection for inbox row % could not be recorded: %', NEW.id, SQLERRM;
    END;
  END;
  RETURN NULL;
END
$fn$;

-- ---------------------------------------------------------------------------
-- The controller's own failures: recorded, at most one incident per kind
-- ---------------------------------------------------------------------------
CREATE FUNCTION smarter_private.reliability_self_signal(p_alertname text, p_failing boolean, p_summary text, p_now timestamptz)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'smarter_private'
AS $fn$
DECLARE
  v_member text := 'reliability-controller:' || p_alertname;
  v_observation bigint;
BEGIN
  IF p_failing = EXISTS (SELECT 1 FROM smarter_private.reliability_alert_members m WHERE m.member_key = v_member AND m.status = 'firing') THEN
    RETURN;
  END IF;
  INSERT INTO smarter_private.reliability_observations (inbox_event_id, status, severity, observed_at)
  VALUES (NULL, CASE WHEN p_failing THEN 'firing' ELSE 'resolved' END, 'warning', p_now)
  RETURNING id INTO v_observation;
  PERFORM smarter_private.reliability_apply_signal(
    'monitoring_self', true, 'warning', 'reliability-controller', p_alertname, p_alertname,
    CASE WHEN p_failing THEN 'firing' ELSE 'resolved' END, 'warning', '{}'::jsonb,
    jsonb_build_object('labels', jsonb_build_object('alertname', p_alertname, 'severity', 'warning', 'source', 'reliability-controller'),
                       'summary', p_summary),
    NULL, v_member, true, p_now, v_observation, NULL, NULL, p_now);
END
$fn$;

-- ---------------------------------------------------------------------------
-- Tick: time-based rules only
-- ---------------------------------------------------------------------------
-- One tick at a time (advisory lock; a second caller returns 'overlap'),
-- every step takes at most 50 rows with FOR UPDATE SKIP LOCKED, and the
-- whole call runs under a 20 s statement_timeout. A backlog is worked over
-- several ticks.
CREATE FUNCTION smarter_private.reliability_tick(p_now timestamptz DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'smarter_private'
SET statement_timeout TO '20s'
SET lock_timeout TO '2s'
AS $fn$
DECLARE
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  c_rows constant integer := 50;
  s smarter_private.reliability_settings;
  r record;
  v_result jsonb := '{}'::jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_n integer;
  v_m integer;
  v_groups text[] := '{}';
BEGIN
  IF COALESCE(auth.role(), '') NOT IN ('', 'service_role') THEN
    RAISE EXCEPTION 'smarter_private.reliability_tick is service-only' USING ERRCODE = '42501';
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtext('reliability-controller-tick')) THEN
    RETURN jsonb_build_object('skipped', 'overlap');
  END IF;
  SELECT * INTO STRICT s FROM smarter_private.reliability_settings WHERE id;

  -- 1. A warning with no eligible recovery escalates when it is still firing
  --    after 30 minutes or has recurred three times in 24 hours.
  BEGIN
    v_n := 0;
    FOR r IN
      SELECT i.id, i.opened_at,
             (SELECT count(*) FROM smarter_private.reliability_incident_events e
                JOIN smarter_private.reliability_incidents j ON j.id = e.incident_id
               WHERE j.fingerprint = i.fingerprint AND e.kind = 'recurrence' AND e.at > v_now - interval '24 hours') AS recurrences
        FROM smarter_private.reliability_incidents i
       WHERE i.status = 'investigating'
         AND (i.opened_at <= v_now - interval '30 minutes' OR i.recurrence_count >= 3)
         AND NOT EXISTS (SELECT 1 FROM smarter_private.reliability_runbooks b
                          WHERE b.enabled AND b.eligibility->>'incident_class' = i.incident_class)
       ORDER BY i.opened_at
       LIMIT c_rows
       FOR UPDATE OF i SKIP LOCKED
    LOOP
      IF r.recurrences >= 3 THEN
        PERFORM smarter_private.reliability_escalate(r.id, 'no eligible recovery: recurred 3 or more times in 24 hours');
        v_n := v_n + 1;
      ELSIF r.opened_at <= v_now - interval '30 minutes' THEN
        PERFORM smarter_private.reliability_escalate(r.id, 'no eligible recovery: still firing after 30 minutes');
        v_n := v_n + 1;
      END IF;
    END LOOP;
    v_result := v_result || jsonb_build_object('escalated', v_n);
  EXCEPTION WHEN OTHERS THEN
    v_errors := v_errors || jsonb_build_object('step', 'escalate', 'error', left(SQLERRM, 300));
  END;

  -- 2. A source with no resolve protocol can never verify. An incident fed
  --    only by such sources becomes stale_unverified after 6 hours with no
  --    firing delivery. Safety net for every other incident: 24 hours with no
  --    firing delivery and no resolved signal is stale_unverified too, so
  --    nothing hangs. Neither is ever called recovered. Database clock only.
  BEGIN
    v_n := 0;
    v_m := 0;
    FOR r IN
      SELECT i.id,
             EXISTS (SELECT 1 FROM smarter_private.reliability_alert_members m
                      WHERE m.fingerprint = i.fingerprint AND m.resolvable AND m.last_firing_at >= i.opened_at) AS resolving,
             i.last_firing_received_at
        FROM smarter_private.reliability_incidents i
       WHERE i.status IN ('investigating', 'escalated')
         AND i.last_firing_received_at <= v_now - interval '6 hours'
       ORDER BY i.last_firing_received_at
       LIMIT c_rows
       FOR UPDATE OF i SKIP LOCKED
    LOOP
      IF NOT r.resolving THEN
        PERFORM smarter_private.reliability_transition(r.id, 'stale_unverified',
          'no firing delivery for 6 hours from a source that never sends resolved; nothing verified',
          jsonb_build_object('kind', 'stale_unverified', 'closure_basis', 'no_resolve_protocol'));
        v_n := v_n + 1;
      ELSIF r.last_firing_received_at <= v_now - interval '24 hours' THEN
        PERFORM smarter_private.reliability_transition(r.id, 'stale_unverified',
          'no firing delivery for 24 hours and no resolved signal arrived; nothing verified',
          jsonb_build_object('kind', 'stale_unverified', 'closure_basis', 'resolve_signal_missing'));
        v_m := v_m + 1;
      END IF;
    END LOOP;
    v_result := v_result || jsonb_build_object('stale_unverified', v_n, 'resolve_signal_missing', v_m);
  EXCEPTION WHEN OTHERS THEN
    v_errors := v_errors || jsonb_build_object('step', 'stale', 'error', left(SQLERRM, 300));
  END;

  -- 3. verifying -> recovered once a real resolved signal has stayed quiet
  --    for 30 minutes on the database clock. (A firing delivery while
  --    verifying has already left this status, and verifying is reached from
  --    a resolved signal only.)
  BEGIN
    v_n := 0;
    FOR r IN
      SELECT i.id FROM smarter_private.reliability_incidents i
       WHERE i.status = 'verifying'
         AND i.status_changed_at <= v_now - interval '30 minutes'
       ORDER BY i.status_changed_at
       LIMIT c_rows
       FOR UPDATE OF i SKIP LOCKED
    LOOP
      PERFORM smarter_private.reliability_transition(r.id, 'recovered', 'the alert stayed resolved for 30 minutes',
        jsonb_build_object('kind', 'quiet_window_passed'));
      v_n := v_n + 1;
    END LOOP;
    v_result := v_result || jsonb_build_object('recovered', v_n);
  EXCEPTION WHEN OTHERS THEN
    v_errors := v_errors || jsonb_build_object('step', 'recover', 'error', left(SQLERRM, 300));
  END;

  -- 4. recovered -> closed after 24 hours.
  BEGIN
    v_n := 0;
    FOR r IN
      SELECT i.id FROM smarter_private.reliability_incidents i
       WHERE i.status = 'recovered' AND i.status_changed_at <= v_now - interval '24 hours'
       ORDER BY i.status_changed_at
       LIMIT c_rows
       FOR UPDATE OF i SKIP LOCKED
    LOOP
      PERFORM smarter_private.reliability_transition(r.id, 'closed', '24 hours without recurrence', jsonb_build_object('kind', 'closed'));
      v_n := v_n + 1;
    END LOOP;
    v_result := v_result || jsonb_build_object('closed', v_n);
  EXCEPTION WHEN OTHERS THEN
    v_errors := v_errors || jsonb_build_object('step', 'close', 'error', left(SQLERRM, 300));
  END;

  -- 5. Reminders: one per group per reminder window, at most 4 per incident,
  --    then one "reminders stopped" line and no more.
  BEGIN
    v_n := 0;
    FOR r IN
      SELECT i.id, i.group_key,
             (SELECT count(*) FROM smarter_private.reliability_notifications n WHERE n.incident_id = i.id AND n.kind = 'reminder') AS reminders
        FROM smarter_private.reliability_incidents i
       WHERE i.status = 'escalated' AND i.severity = 'critical'
         AND (SELECT max(n.created_at) FROM smarter_private.reliability_notifications n
               WHERE n.group_key = i.group_key AND n.kind IN ('escalation', 'reminder'))
             <= v_now - make_interval(hours => s.reminder_hours)
         AND NOT EXISTS (SELECT 1 FROM smarter_private.reliability_incident_events e WHERE e.incident_id = i.id AND e.kind = 'reminders_stopped')
       ORDER BY i.status_changed_at
       LIMIT c_rows
       FOR UPDATE OF i SKIP LOCKED
    LOOP
      IF r.reminders >= 4 THEN
        INSERT INTO smarter_private.reliability_incident_events (incident_id, kind, detail)
        VALUES (r.id, 'reminders_stopped', jsonb_build_object('reason', 'reminders stopped after 4; the incident is still escalated'));
      ELSIF NOT (r.group_key = ANY (v_groups)) THEN
        PERFORM smarter_private.reliability_enqueue_notification(r.id, 'reminder');
        v_groups := v_groups || r.group_key;
        v_n := v_n + 1;
      END IF;
    END LOOP;
    v_result := v_result || jsonb_build_object('reminders', v_n);
  EXCEPTION WHEN OTHERS THEN
    v_errors := v_errors || jsonb_build_object('step', 'remind', 'error', left(SQLERRM, 300));
  END;

  -- 6. Deliver the outbox.
  BEGIN
    v_result := v_result || jsonb_build_object('delivery', smarter_private.reliability_deliver_notifications(10));
  EXCEPTION WHEN OTHERS THEN
    v_errors := v_errors || jsonb_build_object('step', 'deliver', 'error', left(SQLERRM, 300));
  END;

  -- 7. Member rows that resolved more than 7 days ago are no longer needed to
  --    order late deliveries. Bounded.
  BEGIN
    DELETE FROM smarter_private.reliability_alert_members m
     WHERE m.member_key IN (
       SELECT x.member_key FROM smarter_private.reliability_alert_members x
        WHERE x.status = 'resolved' AND x.last_event_at < v_now - interval '7 days'
        ORDER BY x.last_event_at LIMIT 1000);
  EXCEPTION WHEN OTHERS THEN
    v_errors := v_errors || jsonb_build_object('step', 'prune_members', 'error', left(SQLERRM, 300));
  END;

  -- 8. The controller's own failures. One open incident per kind at most;
  --    the delivery one sends nothing (smarter_private.reliability_escalate withholds it).
  BEGIN
    PERFORM smarter_private.reliability_self_signal('ReliabilityIntakeRejections',
      EXISTS (SELECT 1 FROM smarter_private.reliability_intake_rejections j WHERE j.at > v_now - interval '1 hour'),
      'smarter_private.reliability_intake_rejections received rows in the last hour', v_now);
    PERFORM smarter_private.reliability_self_signal('ReliabilityDeliveryFailing',
      EXISTS (SELECT 1 FROM smarter_private.reliability_notifications n
               WHERE (n.state = 'failed' AND n.created_at > v_now - interval '24 hours')
                  OR (n.state = 'queued' AND n.attempts > 0)),
      'smarter_private.reliability_notifications holds sends the Messenger refused', v_now);
    PERFORM smarter_private.reliability_self_signal('ReliabilityTickStepFailing',
      jsonb_array_length(v_errors) > 0,
      'a smarter_private.reliability_tick step raised; see smarter_private.reliability_heartbeat.last_result', v_now);
  EXCEPTION WHEN OTHERS THEN
    v_errors := v_errors || jsonb_build_object('step', 'self_check', 'error', left(SQLERRM, 300));
  END;

  v_result := v_result || jsonb_build_object('at', v_now, 'errors', v_errors);
  UPDATE smarter_private.reliability_heartbeat
     SET tick_at = clock_timestamp(), tick_count = tick_count + 1, last_result = v_result
   WHERE id;
  RETURN v_result;
END
$fn$;

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------
CREATE VIEW smarter_private.reliability_v_open_incidents WITH (security_invoker = true) AS
  SELECT i.id, i.incident_class, i.title, i.severity, i.status, i.source, i.alertname, i.scope, i.related_incident_id,
         i.first_observed_at, i.last_observed_at, i.last_firing_at, i.last_resolved_at, i.opened_at,
         i.occurrence_count, i.recurrence_count, i.escalation_state, i.escalation_reason, i.closure_basis, i.resolution_state,
         i.engine_release, i.status_changed_at
    FROM smarter_private.reliability_incidents i
   WHERE i.status <> 'closed';

CREATE VIEW smarter_private.reliability_v_controller_health WITH (security_invoker = true) AS
  SELECT h.tick_at AS heartbeat_at,
         extract(epoch FROM clock_timestamp() - h.tick_at)::bigint AS heartbeat_age_seconds,
         h.tick_count,
         h.last_result,
         jsonb_array_length(coalesce(h.last_result->'errors', '[]'::jsonb)) AS tick_step_errors,
         (SELECT count(*) FROM smarter_private.reliability_notifications n WHERE n.state IN ('queued', 'rate_limited')) AS queued_notifications,
         (SELECT count(*) FROM smarter_private.reliability_notifications n WHERE n.state = 'failed') AS failed_notifications,
         (SELECT count(*) FROM smarter_private.reliability_notifications n WHERE n.state = 'queued' AND n.attempts > 0) AS delivery_retries_pending,
         (SELECT count(*) FROM smarter_private.reliability_notifications n WHERE n.push_state IN ('diverted_by_guard', 'refused')) AS pushes_not_accepted,
         (SELECT count(*) FROM smarter_private.reliability_intake_rejections j WHERE j.at > clock_timestamp() - interval '24 hours') AS rejections_24h,
         (SELECT count(*) FROM smarter_private.reliability_incidents i WHERE i.status <> 'closed') AS open_incidents,
         (SELECT count(*) FROM smarter_private.reliability_incidents i WHERE i.status = 'escalated') AS escalated_incidents,
         s.mutation_paused,
         s.notify_mode
    FROM smarter_private.reliability_heartbeat h CROSS JOIN smarter_private.reliability_settings s;

-- ---------------------------------------------------------------------------
-- The one non-service surface: the owner reads one incident
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.fn_reliability_incident_for_owner(p_incident_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'smarter_private'
AS $fn$
DECLARE
  i smarter_private.reliability_incidents;
  v_first bigint;
  v_last bigint;
  v_handoff text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.fn_is_platform_alert_recipient(auth.uid()) THEN
    RAISE EXCEPTION 'Not Authorized' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO i FROM smarter_private.reliability_incidents WHERE id = p_incident_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT min(o.inbox_event_id), max(o.inbox_event_id) INTO v_first, v_last
    FROM smarter_private.reliability_observations o WHERE o.incident_id = i.id;
  -- The text that was (or would be) sent: the newest message that speaks for
  -- this incident, else the template rendered now.
  SELECT n.body INTO v_handoff
    FROM smarter_private.reliability_notification_incidents ni
    JOIN smarter_private.reliability_notifications n ON n.id = ni.notification_id
   WHERE ni.incident_id = i.id AND n.kind IN ('escalation', 'reminder')
   ORDER BY n.id DESC LIMIT 1;
  RETURN jsonb_build_object(
    'incident_id', i.id, 'incident_class', i.incident_class, 'title', i.title, 'severity', i.severity,
    'status', i.status, 'resolution_state', i.resolution_state, 'closure_basis', i.closure_basis,
    'source', i.source, 'alertname', i.alertname, 'environment', i.environment, 'scope', i.scope,
    'labels', coalesce(i.latest_evidence->'labels', '{}'::jsonb),
    'first_observed_at', i.first_observed_at, 'last_observed_at', i.last_observed_at,
    'last_firing_at', i.last_firing_at, 'last_resolved_at', i.last_resolved_at,
    'first_inbox_event_id', v_first, 'latest_inbox_event_id', v_last,
    'occurrence_count', i.occurrence_count, 'recurrence_count', i.recurrence_count,
    'escalation_state', i.escalation_state, 'escalation_reason', i.escalation_reason,
    'engine_release', i.engine_release, 'related_incident_id', i.related_incident_id,
    'events', coalesce((
      SELECT jsonb_agg(jsonb_build_object('at', e.at, 'kind', e.kind, 'from_status', e.from_status,
                                          'to_status', e.to_status, 'reason', e.detail->>'reason') ORDER BY e.id DESC)
        FROM (SELECT * FROM smarter_private.reliability_incident_events x WHERE x.incident_id = i.id ORDER BY x.id DESC LIMIT 20) e), '[]'::jsonb),
    'handoff', coalesce(v_handoff, smarter_private.reliability_render_escalation(i.id, 'escalation', NULL)),
    'handoff_version', 1);
END
$fn$;

REVOKE ALL ON FUNCTION public.fn_reliability_incident_for_owner(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_reliability_incident_for_owner(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Access: service-only
-- ---------------------------------------------------------------------------
REVOKE ALL ON smarter_private.reliability_settings FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON smarter_private.reliability_heartbeat FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON smarter_private.reliability_alert_classes FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON smarter_private.reliability_sources_without_resolve FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON smarter_private.reliability_legal_transitions FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON smarter_private.reliability_incidents FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON smarter_private.reliability_alert_members FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON smarter_private.reliability_observations FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON smarter_private.reliability_incident_events FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON smarter_private.reliability_notifications FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON smarter_private.reliability_notification_incidents FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON smarter_private.reliability_intake_rejections FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON smarter_private.reliability_runbooks FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON smarter_private.reliability_v_open_incidents FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON smarter_private.reliability_v_controller_health FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE smarter_private.reliability_notifications_id_seq FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE smarter_private.reliability_alert_classes_id_seq FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE smarter_private.reliability_observations_id_seq FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE smarter_private.reliability_incident_events_id_seq FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE smarter_private.reliability_intake_rejections_id_seq FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION smarter_private.reliability_safe_timestamp(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION smarter_private.reliability_source_family(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION smarter_private.reliability_normalize_alertname(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION smarter_private.reliability_payload_id(jsonb, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION smarter_private.reliability_scope_id(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION smarter_private.reliability_severity_rank(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION smarter_private.reliability_one_line(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION smarter_private.reliability_classify(text, text, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION smarter_private.reliability_incident_events_append_only() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION smarter_private.reliability_transition(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION smarter_private.reliability_render_escalation(uuid, text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION smarter_private.reliability_enqueue_notification(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION smarter_private.reliability_escalate(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION smarter_private.reliability_owner_conversation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION smarter_private.reliability_deliver_notifications(integer, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION smarter_private.reliability_send_validation_message(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION smarter_private.reliability_apply_signal(text, boolean, text, text, text, text, text, text, jsonb, jsonb, text, text, boolean, timestamptz, bigint, text, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION smarter_private.reliability_ingest_alert(bigint, text, text, text, text, text, jsonb, timestamptz, timestamptz, bigint, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION smarter_private.reliability_trg_operational_alert_intake() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION smarter_private.reliability_self_signal(text, boolean, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION smarter_private.reliability_tick(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT SELECT ON smarter_private.reliability_settings TO service_role;
GRANT SELECT ON smarter_private.reliability_heartbeat TO service_role;
GRANT SELECT ON smarter_private.reliability_alert_classes TO service_role;
GRANT SELECT ON smarter_private.reliability_sources_without_resolve TO service_role;
GRANT SELECT ON smarter_private.reliability_legal_transitions TO service_role;
GRANT SELECT ON smarter_private.reliability_incidents TO service_role;
GRANT SELECT ON smarter_private.reliability_alert_members TO service_role;
GRANT SELECT ON smarter_private.reliability_observations TO service_role;
GRANT SELECT ON smarter_private.reliability_incident_events TO service_role;
GRANT SELECT ON smarter_private.reliability_notifications TO service_role;
GRANT SELECT ON smarter_private.reliability_notification_incidents TO service_role;
GRANT SELECT ON smarter_private.reliability_intake_rejections TO service_role;
GRANT SELECT ON smarter_private.reliability_runbooks TO service_role;
GRANT SELECT ON smarter_private.reliability_v_open_incidents TO service_role;
GRANT SELECT ON smarter_private.reliability_v_controller_health TO service_role;
GRANT EXECUTE ON FUNCTION smarter_private.reliability_transition(uuid, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION smarter_private.reliability_deliver_notifications(integer, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION smarter_private.reliability_send_validation_message(text) TO service_role;
GRANT EXECUTE ON FUNCTION smarter_private.reliability_tick(timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- Wiring: after every existing trigger on the inbox (names sort last)
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS zzz_reliability_intake_insert ON public.operational_alert_events;
CREATE TRIGGER zzz_reliability_intake_insert
  AFTER INSERT ON public.operational_alert_events
  FOR EACH ROW EXECUTE FUNCTION smarter_private.reliability_trg_operational_alert_intake();

DROP TRIGGER IF EXISTS zzz_reliability_intake_update ON public.operational_alert_events;
CREATE TRIGGER zzz_reliability_intake_update
  AFTER UPDATE OF delivery_count, status ON public.operational_alert_events
  FOR EACH ROW
  WHEN (OLD.delivery_count IS DISTINCT FROM NEW.delivery_count OR OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION smarter_private.reliability_trg_operational_alert_intake();

DO $schedule$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reliability-controller-tick') THEN
    PERFORM cron.unschedule('reliability-controller-tick');
  END IF;
  PERFORM cron.schedule('reliability-controller-tick', '* * * * *',
    $cmd$SELECT CASE WHEN pg_try_advisory_lock(hashtext('reliability-controller-tick:job'))
           THEN (SELECT smarter_private.reliability_tick()::text) ELSE 'skipped: overlap' END;$cmd$);
END
$schedule$;

COMMIT;
