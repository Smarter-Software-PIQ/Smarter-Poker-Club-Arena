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
-- 3. THE SKIPPED ROWS, ONCE, WITHOUT NOTIFYING. The firing rows intake
--    skipped since install (received from 2026-11-10 07:24:20Z, first inbox
--    id 374266, pre-marked by the mirror-classify rule, never observed; 401
--    at 16:03Z) are run once through the corrected intake with a replay flag.
--    Each lands on the incident its record identity names: a wrapper on its
--    inner incident, fn_ca_cron_failure_watch on one incident of its own. Under
--    the flag no status changes, nothing recurs or escalates, and
--    reliability_escalate refuses outright, so reconciliation creates no
--    notification. An incident opened this way carries
--    awaiting_live_delivery: the tick does not escalate it and policy starts
--    at its first live delivery. Each touched incident gets one 'reconciled'
--    event listing its inbox rows. Re-running finds nothing (an observation
--    is unique per inbox row and delivery).
--
-- 4. LEAVING OBSERVE MODE SENDS NOTHING ABOUT THE PAST. Delivery already
--    never picks a suppressed_observe row. Two paths could still have burst
--    after a mode change, and both are closed: a reminder now repeats only a
--    message that reached Messenger (a group whose latest escalation or
--    reminder was suppressed is never reminded), and a new incident never
--    attaches to a suppressed escalation when its own would be sent.
--    The evidence line also names the public.ca_drift_incidents and
--    public.financial_alerts record when the incident carries one.
--
-- Nothing else changes: notify_mode, mutation_paused, the alert_classes seed,
-- the schedule and public.fn_reliability_controller_health are untouched.
-- Every replaced function (ingest_alert, tick, apply_signal, escalate,
-- render_escalation) is pinned to the md5 of the installed Stage B
-- definition, so this file refuses to install over anything else.
--
-- Native proof: scripts/ci/test-reliability-controller-stage-b.py applies this
-- file after Stage B and runs every Stage B behaviour plus the new cases
-- (PostgreSQL 17, never production).

-- @live-proof: (SELECT to_regprocedure('smarter_private.reliability_refresh_push_states(integer)') IS NOT NULL AND strpos(pg_get_functiondef('smarter_private.reliability_tick(timestamp with time zone)'::regprocedure), 'reliability_refresh_push_states') > 0 AND strpos(pg_get_functiondef('smarter_private.reliability_ingest_alert(bigint,text,text,text,text,text,jsonb,timestamp with time zone,timestamp with time zone,bigint,text,text)'::regprocedure), 'mirror_duplicate_of_captured_original') > 0 AND NOT has_function_privilege('authenticated', 'smarter_private.reliability_refresh_push_states(integer)', 'EXECUTE') AND NOT EXISTS (SELECT 1 FROM smarter_private.reliability_notifications n JOIN public.push_outbox p ON p.id = n.push_outbox_id WHERE p.status = 'sent' AND n.push_state <> 'provider_accepted') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'smarter_private' AND table_name = 'reliability_incidents' AND column_name = 'awaiting_live_delivery') AND strpos(pg_get_functiondef('smarter_private.reliability_escalate(uuid,text)'::regprocedure), 'RELIABILITY_REPLAY_MAY_NOT_NOTIFY') > 0)

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
  IF md5(pg_get_functiondef('smarter_private.reliability_apply_signal(text,boolean,text,text,text,text,text,text,jsonb,jsonb,text,text,boolean,timestamp with time zone,bigint,text,timestamp with time zone,timestamp with time zone)'::regprocedure))
     <> '78870214cc10d5de3f6de921147ea66f' THEN
    RAISE EXCEPTION 'RELIABILITY_FINDINGS_PREIMAGE_CHANGED: reliability_apply_signal';
  END IF;
  IF md5(pg_get_functiondef('smarter_private.reliability_escalate(uuid,text)'::regprocedure))
     <> 'ff4b9d115c9efa6dcf3f2d515cb46ecb' THEN
    RAISE EXCEPTION 'RELIABILITY_FINDINGS_PREIMAGE_CHANGED: reliability_escalate';
  END IF;
  IF md5(pg_get_functiondef('smarter_private.reliability_render_escalation(uuid,text,bigint)'::regprocedure))
     <> 'ee9a6063b5af4325ba95b792a69b4530' THEN
    RAISE EXCEPTION 'RELIABILITY_FINDINGS_PREIMAGE_CHANGED: reliability_render_escalation';
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
-- 2. Reconciled history never notifies; observe mode leaves nothing to send
-- ---------------------------------------------------------------------------
-- An incident opened from history waits for a live delivery before any
-- policy (escalation, the 30-minute warning rule) applies to it.
ALTER TABLE smarter_private.reliability_incidents
  ADD COLUMN awaiting_live_delivery boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION smarter_private.reliability_apply_signal(
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
  -- Set only by this migration's one-time admission of skipped inbox rows.
  v_replay boolean := coalesce(current_setting('reliability.replay', true), '') = 'on';
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
      IF v_replay THEN
        -- Opened from history: no policy runs until a live delivery arrives.
        UPDATE smarter_private.reliability_incidents SET awaiting_live_delivery = true WHERE id = i.id
        RETURNING * INTO i;
        v_disposition := 'reconciled';
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
  ELSIF NOT v_created AND v_replay THEN
    -- Reconciled history: counted and timed against the incident, nothing else.
    -- No transition, no recurrence, no escalation, no notification.
    UPDATE smarter_private.reliability_incidents
       SET occurrence_count = occurrence_count + 1,
           last_observed_at = greatest(last_observed_at, p_event_at),
           last_firing_at = greatest(coalesce(last_firing_at, p_event_at), p_event_at),
           latest_evidence = CASE WHEN p_received_at >= coalesce(last_firing_received_at, p_received_at)
                                  THEN coalesce(p_evidence, latest_evidence) ELSE latest_evidence END,
           last_firing_received_at = greatest(coalesce(last_firing_received_at, p_received_at), p_received_at),
           updated_at = clock_timestamp()
     WHERE id = i.id;
    v_disposition := 'reconciled';
  ELSIF NOT v_created THEN
    IF i.awaiting_live_delivery THEN
      -- The first live delivery after reconciliation: normal policy starts here.
      UPDATE smarter_private.reliability_incidents SET awaiting_live_delivery = false WHERE id = i.id;
      INSERT INTO smarter_private.reliability_incident_events (incident_id, kind, detail)
      VALUES (i.id, 'live_delivery_after_reconciliation', jsonb_build_object('observation_id', p_observation_id, 'event_at', p_event_at));
      v_policy := true;
    END IF;
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
  IF v_fresh AND NOT v_resolved AND NOT v_replay AND (v_created OR v_policy OR v_upgraded) THEN
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

CREATE OR REPLACE FUNCTION smarter_private.reliability_escalate(p_incident_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'smarter_private'
AS $fn$
DECLARE
  i smarter_private.reliability_incidents;
  n smarter_private.reliability_notifications;
  v_hours integer;
  v_mode text;
  v_suppressed boolean;
BEGIN
  IF coalesce(current_setting('reliability.replay', true), '') = 'on' THEN
    RAISE EXCEPTION 'RELIABILITY_REPLAY_MAY_NOT_NOTIFY: history is reconciled without escalation' USING ERRCODE = 'RC001';
  END IF;
  PERFORM smarter_private.reliability_transition(p_incident_id, 'escalated', p_reason, jsonb_build_object('kind', 'escalation'));
  SELECT * INTO STRICT i FROM smarter_private.reliability_incidents WHERE id = p_incident_id;
  IF i.source = 'reliability-controller' AND i.alertname = 'ReliabilityDeliveryFailing' THEN
    -- A message about not being able to send messages is a loop.
    INSERT INTO smarter_private.reliability_incident_events (incident_id, kind, detail)
    VALUES (i.id, 'notification_withheld', jsonb_build_object('reason', 'delivery failures are never announced through delivery'));
    RETURN;
  END IF;
  SELECT reminder_hours, notify_mode INTO STRICT v_hours, v_mode FROM smarter_private.reliability_settings WHERE id;
  -- A message that will be sent never hides inside one that was suppressed:
  -- after observe mode ends, a new incident does not attach to an escalation
  -- nobody received.
  v_suppressed := v_mode = 'observe' OR (v_mode = 'critical_only' AND i.severity IS DISTINCT FROM 'critical');
  PERFORM pg_advisory_xact_lock(hashtextextended('reliability-group:' || i.group_key, 0));
  SELECT * INTO n FROM smarter_private.reliability_notifications x
   WHERE x.group_key = i.group_key AND x.kind IN ('escalation', 'reminder')
     AND x.created_at > clock_timestamp() - make_interval(hours => v_hours)
     AND (v_suppressed OR x.state <> 'suppressed_observe')
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

CREATE OR REPLACE FUNCTION smarter_private.reliability_render_escalation(p_incident_id uuid, p_kind text, p_notification_id bigint)
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
       || CASE WHEN v_first IS NULL THEN 'none' ELSE v_first::text || '..' || v_last::text END
       || CASE WHEN nullif(i.latest_evidence->>'drift_incident_id', '') IS NOT NULL
               THEN ', public.ca_drift_incidents ' || smarter_private.reliability_one_line(i.latest_evidence->>'drift_incident_id', 64) ELSE '' END
       || CASE WHEN nullif(i.latest_evidence->>'financial_alert_id', '') IS NOT NULL
               THEN ', public.financial_alerts ' || smarter_private.reliability_one_line(i.latest_evidence->>'financial_alert_id', 64) ELSE '' END
       || E'\n'
    || 'Acceptance criteria: Identify root cause, fix at source, verify alert clears and stays clear.';
  RETURN left(v_body, 2000);
END
$fn$;

-- ---------------------------------------------------------------------------
-- 3. Push state mirrors public.push_outbox
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
         AND NOT i.awaiting_live_delivery
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
  --    then one "reminders stopped" line and no more. A reminder repeats a
  --    message that reached Messenger: a group whose latest escalation or
  --    reminder was suppressed (observe mode) is never reminded, so leaving
  --    observe mode sends nothing about the past.
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
         AND (SELECT n.state FROM smarter_private.reliability_notifications n
               WHERE n.group_key = i.group_key AND n.kind IN ('escalation', 'reminder')
               ORDER BY n.id DESC LIMIT 1) = 'persisted_in_messenger'
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
REVOKE ALL ON FUNCTION smarter_private.reliability_apply_signal(text, boolean, text, text, text, text, text, text, jsonb, jsonb, text, text, boolean, timestamptz, bigint, text, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION smarter_private.reliability_escalate(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION smarter_private.reliability_render_escalation(uuid, text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION smarter_private.reliability_tick(timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. One time: admit the firing rows intake skipped since Stage B installed
-- ---------------------------------------------------------------------------
-- Exactly the rows the old rule dropped: firing, received since the install
-- (2026-11-10 07:24:20Z; inbox id 374266 is the first such row), pre-marked
-- informational by the mirror-classify rule, and never observed. Each goes
-- through the corrected intake with the replay flag set, so it lands on the
-- incident its record identity names (a wrapper on its inner incident, a
-- standalone drift record on its own), counts once, changes no status and
-- creates no notification (reliability_escalate refuses while the flag is
-- set). Idempotent: an observation is unique per inbox row and delivery, so
-- a second run finds nothing. Bounded: a run that reaches the limit refuses
-- rather than leave rows behind. The tick is held off for the duration.
DO $admit_skipped$
DECLARE
  c_first_id CONSTANT bigint := 374266;
  c_since CONSTANT timestamptz := '2026-11-10 07:24:20+00';
  c_limit CONSTANT integer := 3000;
  r public.operational_alert_events;
  v_watermark bigint;
  v_rows integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('reliability-controller-tick'));
  SELECT coalesce(max(id), 0) INTO v_watermark FROM smarter_private.reliability_observations;
  PERFORM set_config('reliability.replay', 'on', true);
  FOR r IN
    SELECT e.* FROM public.operational_alert_events e
     WHERE e.id >= c_first_id AND e.received_at >= c_since
       AND e.status = 'firing' AND e.investigation_status = 'informational'
       AND e.investigation->>'rule' = 'mirror_duplicate_of_captured_original'
       AND NOT EXISTS (SELECT 1 FROM smarter_private.reliability_observations o
                        WHERE o.inbox_event_id = e.id AND o.status = 'firing')
     ORDER BY e.id
     LIMIT c_limit
  LOOP
    BEGIN
      PERFORM smarter_private.reliability_ingest_alert(
        r.id, r.source, r.event_key, r.alertname, r.status, r.severity, r.payload,
        r.received_at, r.last_received_at, r.delivery_count, r.investigation_status, 'INSERT');
    EXCEPTION
      WHEN SQLSTATE 'RC001' THEN RAISE;
      WHEN OTHERS THEN
        INSERT INTO smarter_private.reliability_intake_rejections (inbox_event_id, source, alertname, event_key, operation, reason, sqlstate)
        VALUES (r.id, left(r.source, 120), left(r.alertname, 240), left(r.event_key, 512), 'RECONCILE', left(SQLERRM, 1000), SQLSTATE);
    END;
    v_rows := v_rows + 1;
  END LOOP;
  PERFORM set_config('reliability.replay', 'off', true);
  IF v_rows >= c_limit THEN
    RAISE EXCEPTION 'RELIABILITY_RECONCILE_LIMIT: % rows reached the limit; refusing to leave rows behind', v_rows;
  END IF;
  INSERT INTO smarter_private.reliability_incident_events (incident_id, kind, detail)
  SELECT o.incident_id, 'reconciled',
         jsonb_build_object(
           'reason', 'firing inbox rows skipped by the Stage B intake because the mirror-classify rule pre-marked them informational',
           'inbox_event_ids', jsonb_agg(o.inbox_event_id ORDER BY o.inbox_event_id),
           'observations', count(*),
           'opened_by_reconciliation', bool_or(i.awaiting_live_delivery))
    FROM smarter_private.reliability_observations o
    JOIN smarter_private.reliability_incidents i ON i.id = o.incident_id
   WHERE o.id > v_watermark AND o.inbox_event_id IS NOT NULL
   GROUP BY o.incident_id;
  RAISE NOTICE 'reliability reconciliation: % skipped inbox row(s) admitted', v_rows;
END
$admit_skipped$;

-- One time: re-mirror the notifications that exist. Idempotent.
DO $remirror$
BEGIN
  PERFORM smarter_private.reliability_refresh_push_states(1000);
END
$remirror$;

COMMIT;
