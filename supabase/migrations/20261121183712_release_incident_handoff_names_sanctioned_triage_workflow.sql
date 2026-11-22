-- 20261121183712_release_incident_handoff_names_sanctioned_triage_workflow.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- RELEASE INCIDENT HANDOFF NAMES THE SANCTIONED TRIAGE/INSPECT/CLAIM WORKFLOW
-- (2026-11-21, follow-up to incident 484c4cee and PRs #11632/#11641).
--
-- WHY. Every unassigned AI AGENT NEEDED handoff prints raw SQL:
--   Claim before working: SELECT smarter_private.fn_claim_reliability_incident(...)
-- Local coding agents do not hold DATABASE_URL (and Owner Policy forbids
-- reading .env or copying credentials). For incident_class = 'release', the
-- sanctioned manual-only workflow `.github/workflows/triage-engine-release-incident.yml`
-- provides bounded read-only triage (`operation=triage`), read-only incident
-- inspection (`operation=inspect`), and sanctioned claim submission
-- (`operation=claim`) using `ci-main`'s repository secret. Naming it directly
-- in `smarter_private.reliability_claim_owner_line(uuid)` routes future agents
-- straight to the sanctioned path on the first turn without touching any table
-- lock, escalation gate, or release-control workflow.
--
-- @live-proof: strpos(pg_get_functiondef('smarter_private.reliability_claim_owner_line(uuid)'::regprocedure), 'triage-engine-release-incident.yml') > 0 AND NOT has_function_privilege('authenticated', 'smarter_private.reliability_claim_owner_line(uuid)', 'EXECUTE') AND NOT has_function_privilege('anon', 'smarter_private.reliability_claim_owner_line(uuid)', 'EXECUTE')

BEGIN;

SET LOCAL lock_timeout = '4s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION smarter_private.reliability_claim_owner_line(p_incident_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'smarter_private'
AS $function$
DECLARE
  k smarter_private.reliability_incident_claims;
  v_state jsonb := smarter_private.reliability_incident_claim_state(p_incident_id, now());
  v_class text;
  v_who text;
  v_claim text;
BEGIN
  SELECT * INTO k FROM smarter_private.reliability_incident_claims WHERE incident_id = p_incident_id;
  SELECT incident_class INTO v_class FROM smarter_private.reliability_incidents WHERE id = p_incident_id;
  v_claim := 'Claim before working: SELECT smarter_private.fn_claim_reliability_incident('''
             || p_incident_id::text || ''', ''<session>'', ''<branch>'');' || E'\n';
  IF v_class = 'release' THEN
    v_claim := v_claim
               || 'Sanctioned release triage/inspect/claim (no local DB secret): '
               || 'gh workflow run triage-engine-release-incident.yml --ref main -f operation=inspect -f incident_id='
               || p_incident_id::text || E'\n';
  END IF;
  IF k.incident_id IS NOT NULL THEN
    v_who := smarter_private.reliability_one_line(k.agent_session, 80)
             || coalesce(', branch ' || smarter_private.reliability_one_line(k.branch, 120), '')
             || coalesce(', PR ' || smarter_private.reliability_one_line(k.pull_request, 60), '');
  END IF;
  RETURN CASE v_state->>'state'
    WHEN 'live' THEN
      'Owner: claimed by ' || v_who
      || ', until ' || to_char(k.expires_at AT TIME ZONE 'America/Chicago', 'YYYY-MM-DD HH24:MI') || ' America/Chicago.'
      || ' Coordinate with that owner; do not start a second fix.'
      || ' The claim stops blocking at ' || to_char((k.progress_at + interval '8 hours') AT TIME ZONE 'America/Chicago', 'YYYY-MM-DD HH24:MI')
      || ' America/Chicago unless the owner reports a new branch or PR'
      || CASE WHEN k.pull_request IS NOT NULL
              THEN ', or as soon as that PR has merged and this incident fires again: then claim it, and the claim reads the merge from GitHub.'
              ELSE '.' END
      || E'\n'
    WHEN 'shipped_and_recurred' THEN
      'Owner: unassigned, needs an AI coding agent. The claimed fix shipped and the incident recurred: '
      || v_who || ' merged at '
      || to_char(k.pr_merged_at AT TIME ZONE 'America/Chicago', 'YYYY-MM-DD HH24:MI') || ' America/Chicago and this incident fired again at '
      || to_char((v_state->>'refired_after_merge_at')::timestamptz AT TIME ZONE 'America/Chicago', 'YYYY-MM-DD HH24:MI') || ' America/Chicago,'
      || ' so that claim no longer blocks. Check whether that fix is live yet, then fix what remains.' || E'\n'
      || v_claim
    WHEN 'lifetime_spent' THEN
      'Owner: unassigned, needs an AI coding agent. The claim by ' || v_who
      || ' passed its 8-hour lifetime without a new branch or PR, so it no longer blocks. Read that work first.' || E'\n'
      || v_claim
    ELSE
      'Owner: unassigned, needs an AI coding agent' || E'\n' || v_claim
  END;
END
$function$;

REVOKE ALL ON FUNCTION smarter_private.reliability_claim_owner_line(uuid) FROM PUBLIC, anon, authenticated;

-- @probe-for: smarter_private.reliability_claim_owner_line
DO $probe$
DECLARE v_id uuid; v_line text;
BEGIN
  SELECT id INTO v_id FROM smarter_private.reliability_incidents ORDER BY created_at DESC LIMIT 1;
  IF v_id IS NOT NULL THEN
    v_line := smarter_private.reliability_claim_owner_line(v_id);
    IF v_line IS NULL OR strpos(v_line, 'Owner:') = 0 THEN
      RAISE EXCEPTION 'reliability_claim_owner_line probe failed';
    END IF;
  END IF;
END
$probe$;

COMMIT;
