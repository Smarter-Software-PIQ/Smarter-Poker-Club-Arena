-- 20261110144203_reliability_controller_drift_mirrors_are_incidents_and_push_.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- ============================================================================
-- RELIABILITY CONTROLLER: TWO DEFECTS THE LIVE OBSERVATION WINDOW FOUND
-- ============================================================================
--
-- Stage B (20261110000020) was installed 2026-11-10 07:24Z in observe mode.
-- Read from production at 14:40Z, after 432 ticks:
--
-- 1. A MISSED CRITICAL. Intake skipped every firing row that arrived with
--    investigation_status 'informational'. The inbox's own trigger
--    a0_operational_alert_mirror_classify (fn_operational_alert_mirror_classify)
--    stamps that, rule 'mirror_duplicate_of_captured_original', on a firing
--    -updates row of the financial-alerts and drift-incidents mirrors whenever
--    an earlier row of the same record exists that has not resolved and is at
--    least as severe. It means "the inbox already holds this record", never
--    "this is not a problem". 125 firing rows of source drift-incidents-updates
--    were skipped that way since install. Most were wrappers whose inner
--    financial alert did become an incident, but fn_ca_cron_failure_watch
--    (critical, job ca-collusion-daily, drift incident c3f667d5, firing since
--    2026-11-09 21:37Z, 15 rows since install) has no other copy after
--    install: its original was captured before the controller existed, so
--    every copy the controller ever saw was pre-marked, and no incident exists.
--    FIX AT INTAKE: a firing row is skipped only when it is a record and not
--    an incident: status info AND severity info, a test row, the canary, or a
--    class with is_incident = false. A pre-marked mirror row is processed. A
--    wrapper that carries its inner record id still joins the inner incident
--    through alert_members (no second incident); a drift row with no inner id
--    is its own incident, and its latest_evidence names the authoritative
--    public.ca_drift_incidents id (drift_incident_id). jobname is read from
--    the payload as well as from labels, so each failing job is its own
--    incident (CLASS-CATALOG.md: jobname is the durable identity).
--    No inbox history is replayed: the next delivery of a still-firing record
--    opens its incident. The controller still never writes
--    public.financial_alerts or public.ca_drift_incidents.
--
-- 2. A STALE PUSH MIRROR. reliability_notifications.push_state recorded what
--    public.push_outbox said at insert and was never read again: notification
--    2 (validation) still says 'pending' while its push_outbox row is 'sent'
--    (attempts 1, sent_at 07:28:15Z).
--    FIX: smarter_private.reliability_refresh_push_states(limit), called by
--    the tick, re-reads public.push_outbox for notifications that are not yet
--    terminal (at most 50 a tick, newest 7 days) and mirrors exactly what the
--    row records:
--      pending    -> pending
--      processing -> claimed            (the dispatcher holds the row)
--      sent       -> provider_accepted  (the push provider accepted it; this
--                                        is NOT delivery to, or sight on, a phone)
--      failed     -> failed             (push_detail carries failure_reason)
--      skipped    -> diverted_by_guard when failure_reason is
--                    routed_to_production_alerts, else skipped
--    Existing notifications are re-mirrored once here, through the same
--    function, which is idempotent.
--
-- Nothing else changes: notify_mode, mutation_paused, the alert_classes seed,
-- the schedule and public.fn_reliability_controller_health are untouched.
-- Both replaced functions are pinned to the md5 of the installed Stage B
-- definition, so this file refuses to install over anything else.
--
-- Native proof: scripts/ci/test-reliability-controller-stage-b.py applies this
-- file after Stage B and runs every Stage B behaviour plus the new cases
-- (PostgreSQL 17, never production).

-- @live-proof: (SELECT to_regprocedure('smarter_private.reliability_refresh_push_states(integer)') IS NOT NULL AND strpos(pg_get_functiondef('smarter_private.reliability_tick(timestamp with time zone)'::regprocedure), 'reliability_refresh_push_states') > 0 AND strpos(pg_get_functiondef('smarter_private.reliability_ingest_alert(bigint,text,text,text,text,text,jsonb,timestamp with time zone,timestamp with time zone,bigint,text,text)'::regprocedure), 'mirror_duplicate_of_captured_original') > 0 AND NOT has_function_privilege('authenticated', 'smarter_private.reliability_refresh_push_states(integer)', 'EXECUTE') AND NOT EXISTS (SELECT 1 FROM smarter_private.reliability_notifications n JOIN public.push_outbox p ON p.id = n.push_outbox_id WHERE p.status = 'sent' AND n.push_state <> 'provider_accepted'))

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '20s';

DO $pre$
BEGIN
  IF md5(pg_get_functiondef('smarter_private.reliability_ingest_alert(bigint,text,text,text,text,text,jsonb,timestamp with time zone,timestamp with time zone,bigint,text,text)'::regprocedure))
     <> '3a952ca75a5d4595671961b918b3115e' THEN
    RAISE EXCEPTION 'RELIABILITY_FINDINGS_PREIMAGE_CHANGED: reliability_ingest_alert';
  END IF;
  IF md5(pg_get_functiondef('smarter_private.reliability_tick(timestamp with time zone)'::regprocedure))
     <> '20ac3df74884ecc3b49cedd04cff67e3' THEN
    RAISE EXCEPTION 'RELIABILITY_FINDINGS_PREIMAGE_CHANGED: reliability_tick';
  END IF;
END
$pre$;

-- ---------------------------------------------------------------------------
-- 1. Intake: a pre-marked mirror row is still an incident
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION smarter_private.reliability_ingest_alert(
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
  -- Never an incident: test rows, the canary and pure information (status
  -- info AND severity info), plus the non-incident classes below. A firing
  -- row is NOT skipped for arriving investigation_status 'informational':
  -- a0_operational_alert_mirror_classify stamps that on every later firing
  -- copy of a ledger mirror ('mirror_duplicate_of_captured_original'), which
  -- says the inbox holds an earlier copy, not that nothing is wrong.
  IF p_investigation_status = 'test' OR lower(p_severity) = 'canary' THEN RETURN NULL; END IF;
  IF p_status = 'info' AND lower(p_severity) = 'info' THEN RETURN NULL; END IF;

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
    'period_end', smarter_private.reliability_payload_id(v_labels, p_payload, 'period_end'),
    'jobname', smarter_private.reliability_payload_id(v_labels, p_payload, 'jobname'))
    || jsonb_build_object(
    'instance', left(v_labels->>'instance', 120),
    'host', left(v_labels->>'host', 120),
    'scope', left(v_labels->>'scope', 120),
    'reason', left(v_labels->>'reason', 120),
    'rpc', left(v_labels->>'rpc', 120),
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
      -- The authoritative record of a drift mirror row. Read only: the
      -- controller never edits or closes public.ca_drift_incidents.
      'drift_incident_id', CASE WHEN v_family = 'drift-incidents' THEN left(split_part(p_event_key, ':', 1), 64) END,
      'financial_alert_id', v_record,
      'summary', CASE WHEN jsonb_typeof(v_alert->'annotations') = 'object'
                      THEN smarter_private.reliability_one_line(v_alert->'annotations'->>'summary', 300) END),
    v_release, v_member,
    NOT EXISTS (SELECT 1 FROM smarter_private.reliability_sources_without_resolve w WHERE w.source = p_source),
    v_event_at, v_observation, v_episode, v_episode_at, v_received);
END
$fn$;

-- ---------------------------------------------------------------------------
-- 2. Push state mirrors public.push_outbox
-- ---------------------------------------------------------------------------
ALTER TABLE smarter_private.reliability_notifications
  DROP CONSTRAINT reliability_notifications_push_state_check;
ALTER TABLE smarter_private.reliability_notifications
  ADD CONSTRAINT reliability_notifications_push_state_check
  CHECK (push_state IN ('not_requested', 'pending', 'claimed', 'provider_accepted', 'failed', 'skipped', 'diverted_by_guard', 'refused'));

-- Reads public.push_outbox and writes only reliability_notifications. A row
-- push_outbox no longer holds is left as it was last seen. 'failed' is
-- re-read while recent, because the dispatcher may send it again.
CREATE FUNCTION smarter_private.reliability_refresh_push_states(p_limit integer DEFAULT 50)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'smarter_private'
AS $fn$
DECLARE
  v_changed integer;
BEGIN
  WITH due AS (
    SELECT n.id, n.push_outbox_id
      FROM smarter_private.reliability_notifications n
     WHERE n.push_outbox_id IS NOT NULL
       AND n.push_state IN ('pending', 'claimed', 'failed')
       AND n.created_at > clock_timestamp() - interval '7 days'
     ORDER BY n.id DESC
     LIMIT least(greatest(coalesce(p_limit, 50), 1), 1000)
     FOR UPDATE OF n SKIP LOCKED
  ), seen AS (
    SELECT d.id,
           CASE p.status
             WHEN 'pending' THEN 'pending'
             WHEN 'processing' THEN 'claimed'
             WHEN 'sent' THEN 'provider_accepted'
             WHEN 'failed' THEN 'failed'
             WHEN 'skipped' THEN CASE WHEN p.failure_reason = 'routed_to_production_alerts' THEN 'diverted_by_guard' ELSE 'skipped' END
           END AS push_state,
           left(p.status
                || CASE WHEN p.attempts > 0 THEN ', attempts ' || p.attempts::text ELSE '' END
                || CASE WHEN p.status = 'sent' AND p.sent_at IS NOT NULL
                        THEN ', accepted by the push provider at ' || to_char(p.sent_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                             || ' (not proof of delivery to a device)' ELSE '' END
                || coalesce(': ' || p.failure_reason, ''), 300) AS push_detail
      FROM due d
      JOIN public.push_outbox p ON p.id = d.push_outbox_id
  )
  UPDATE smarter_private.reliability_notifications n
     SET push_state = s.push_state, push_detail = s.push_detail
    FROM seen s
   WHERE n.id = s.id AND s.push_state IS NOT NULL
     AND (n.push_state IS DISTINCT FROM s.push_state OR n.push_detail IS DISTINCT FROM s.push_detail);
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed;
END
$fn$;

REVOKE ALL ON FUNCTION smarter_private.reliability_refresh_push_states(integer) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION smarter_private.reliability_tick(p_now timestamptz DEFAULT NULL)
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

  -- 6b. Mirror what public.push_outbox now says about the pushes written above.
  BEGIN
    v_result := v_result || jsonb_build_object('push_states_refreshed', smarter_private.reliability_refresh_push_states(c_rows));
  EXCEPTION WHEN OTHERS THEN
    v_errors := v_errors || jsonb_build_object('step', 'refresh_push', 'error', left(SQLERRM, 300));
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

-- Both replaced functions keep the grants Stage B gave them (CREATE OR REPLACE
-- preserves the ACL); restated so this file is complete on its own.
REVOKE ALL ON FUNCTION smarter_private.reliability_ingest_alert(bigint, text, text, text, text, text, jsonb, timestamptz, timestamptz, bigint, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION smarter_private.reliability_tick(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION smarter_private.reliability_tick(timestamptz) TO service_role;

-- One time: re-mirror the notifications that exist. Idempotent.
DO $remirror$
BEGIN
  PERFORM smarter_private.reliability_refresh_push_states(1000);
END
$remirror$;

COMMIT;
