-- AN INCIDENT IS CLAIMED BEFORE IT IS WORKED (2026-11-18).
--
-- Reliability incident d2d79c4f (fn_post_commit_stranded_watchdog) reached two
-- agent lanes through the same "AI AGENT NEEDED" handoff. Both started on the
-- same root cause and neither could see the other: the handoff said
-- "Owner: unassigned" to every reader, and nothing recorded who had picked it
-- up. One lane shipped PR #11303 while the other was still scaffolding a
-- competing migration for the same function.
--
-- The fix is a claim, written once and atomically:
--   smarter_private.fn_claim_reliability_incident(incident, session, branch,
--   pull_request, ttl) takes the incident only when it is unclaimed, when the
--   previous claim has expired, or when the caller already holds it (renewal).
--   Otherwise it changes nothing and answers with the current owner, so the
--   second lane is told who to coordinate with instead of starting work.
--   smarter_private.fn_release_reliability_incident_claim releases only the
--   caller's own claim.
-- The escalation text now names the owner, branch and pull request of a live
-- claim, and tells an unclaimed reader how to claim it.
--
-- Nothing here watches or repairs anything. A claim expires on its own clock
-- (at most 24 hours) so an abandoned claim never strands an incident.

BEGIN;

SET LOCAL lock_timeout = '4s';

CREATE TABLE IF NOT EXISTS smarter_private.reliability_incident_claims (
  -- No foreign key: adding one would lock the live incidents table. The
  -- claim function proves the incident exists before it writes a row.
  incident_id   uuid        PRIMARY KEY,
  agent_session text        NOT NULL CHECK (length(btrim(agent_session)) BETWEEN 1 AND 200),
  branch        text        CHECK (branch IS NULL OR length(branch) <= 200),
  pull_request  text        CHECK (pull_request IS NULL OR length(pull_request) <= 200),
  claimed_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at    timestamptz NOT NULL,
  CHECK (expires_at > claimed_at)
);
REVOKE ALL ON smarter_private.reliability_incident_claims FROM PUBLIC, anon, authenticated;
GRANT SELECT ON smarter_private.reliability_incident_claims TO service_role;

CREATE OR REPLACE FUNCTION smarter_private.fn_claim_reliability_incident(
  p_incident_id uuid, p_agent_session text, p_branch text DEFAULT NULL,
  p_pull_request text DEFAULT NULL, p_ttl interval DEFAULT interval '4 hours')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'smarter_private'
AS $function$
DECLARE
  v_session text := nullif(btrim(p_agent_session), '');
  k smarter_private.reliability_incident_claims;
  v_claimed boolean;
BEGIN
  IF p_incident_id IS NULL OR v_session IS NULL THEN
    RAISE EXCEPTION 'incident_claim_identity_missing' USING ERRCODE = '22023';
  END IF;
  IF p_ttl IS NULL OR p_ttl <= interval '0' OR p_ttl > interval '24 hours' THEN
    RAISE EXCEPTION 'incident_claim_ttl_out_of_range' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM smarter_private.reliability_incidents WHERE id = p_incident_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'incident_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- One statement decides: a fresh row, a renewal by the holder, or a takeover
  -- of an expired claim. A live claim held by someone else is left untouched.
  INSERT INTO smarter_private.reliability_incident_claims AS c
         (incident_id, agent_session, branch, pull_request, claimed_at, expires_at)
  VALUES (p_incident_id, v_session, nullif(btrim(p_branch), ''), nullif(btrim(p_pull_request), ''),
          clock_timestamp(), clock_timestamp() + p_ttl)
  ON CONFLICT (incident_id) DO UPDATE
     SET agent_session = EXCLUDED.agent_session,
         branch        = coalesce(EXCLUDED.branch,
                                  CASE WHEN c.agent_session = EXCLUDED.agent_session THEN c.branch END),
         pull_request  = coalesce(EXCLUDED.pull_request,
                                  CASE WHEN c.agent_session = EXCLUDED.agent_session THEN c.pull_request END),
         claimed_at    = CASE WHEN c.agent_session = EXCLUDED.agent_session
                              AND c.expires_at > clock_timestamp()
                              THEN c.claimed_at ELSE EXCLUDED.claimed_at END,
         expires_at    = EXCLUDED.expires_at
   WHERE c.agent_session = EXCLUDED.agent_session OR c.expires_at <= clock_timestamp()
  RETURNING c.* INTO k;
  v_claimed := FOUND;
  IF NOT v_claimed THEN
    SELECT * INTO STRICT k FROM smarter_private.reliability_incident_claims WHERE incident_id = p_incident_id;
  END IF;
  RETURN jsonb_build_object(
    'claimed', v_claimed, 'incident_id', k.incident_id, 'owner', k.agent_session,
    'branch', k.branch, 'pull_request', k.pull_request,
    'claimed_at', k.claimed_at, 'expires_at', k.expires_at);
END
$function$;
REVOKE ALL ON FUNCTION smarter_private.fn_claim_reliability_incident(uuid, text, text, text, interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION smarter_private.fn_claim_reliability_incident(uuid, text, text, text, interval) TO service_role;

CREATE OR REPLACE FUNCTION smarter_private.fn_release_reliability_incident_claim(
  p_incident_id uuid, p_agent_session text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'smarter_private'
AS $function$
BEGIN
  DELETE FROM smarter_private.reliability_incident_claims
   WHERE incident_id = p_incident_id AND agent_session = nullif(btrim(p_agent_session), '');
  RETURN FOUND;
END
$function$;
REVOKE ALL ON FUNCTION smarter_private.fn_release_reliability_incident_claim(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION smarter_private.fn_release_reliability_incident_claim(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION smarter_private.reliability_render_escalation(p_incident_id uuid, p_kind text, p_notification_id bigint)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'smarter_private'
AS $function$
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
  k smarter_private.reliability_incident_claims;
  v_allowed constant text[] := ARRAY['alertname', 'severity', 'component', 'variant', 'format', 'job', 'instance', 'table_id', 'tournament_id', 'source'];
BEGIN
  SELECT * INTO STRICT i FROM smarter_private.reliability_incidents WHERE id = p_incident_id;
  -- A live claim names who is already working this incident (20261118).
  SELECT * INTO k FROM smarter_private.reliability_incident_claims c
   WHERE c.incident_id = i.id AND c.expires_at > now();
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
    || CASE WHEN k.incident_id IS NOT NULL
            THEN 'Owner: claimed by ' || smarter_private.reliability_one_line(k.agent_session, 80)
                 || coalesce(', branch ' || smarter_private.reliability_one_line(k.branch, 120), '')
                 || coalesce(', PR ' || smarter_private.reliability_one_line(k.pull_request, 60), '')
                 || ', until ' || to_char(k.expires_at AT TIME ZONE 'America/Chicago', 'YYYY-MM-DD HH24:MI') || ' America/Chicago.'
                 || ' Coordinate with that owner; do not start a second fix.' || E'\n'
            ELSE 'Owner: unassigned, needs an AI coding agent' || E'\n'
                 || 'Claim before working: SELECT smarter_private.fn_claim_reliability_incident(''' || i.id::text || ''', ''<session>'', ''<branch>'');' || E'\n'
       END
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
$function$;
REVOKE ALL ON FUNCTION smarter_private.reliability_render_escalation(uuid, text, bigint) FROM PUBLIC, anon, authenticated;

COMMIT;
