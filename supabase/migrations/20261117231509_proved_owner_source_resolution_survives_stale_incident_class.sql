-- A historical no-resolve classification is not stronger than a later actual
-- same-episode original source resolution. Never infer recovery from age alone.
-- @live-proof: to_regprocedure('smarter_private.reliability_proved_source_resolution(uuid)') IS NOT NULL
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='8s';

CREATE FUNCTION smarter_private.reliability_proved_source_resolution(p_incident_id uuid)
RETURNS boolean LANGUAGE sql STABLE
SET search_path TO pg_catalog, smarter_private
AS $function$
 SELECT EXISTS (
   SELECT 1 FROM smarter_private.reliability_incidents i
   WHERE i.id=p_incident_id AND i.source IN ('owner-operational-notifications','sp-critical-pager','sp-daily-digest')
     AND i.status='stale_unverified' AND i.resolution_state='none'
     AND i.last_resolved_at>=i.last_firing_received_at
     AND NOT EXISTS (SELECT 1 FROM smarter_private.reliability_alert_members x
       WHERE x.fingerprint=i.fingerprint AND x.last_firing_at>=i.opened_at AND x.status<>'resolved')
     AND EXISTS (
       SELECT 1 FROM smarter_private.reliability_observations o
       JOIN public.operational_alert_events e ON e.id=o.inbox_event_id
       JOIN smarter_private.reliability_alert_members m ON m.fingerprint=i.fingerprint
         AND m.member_key=e.source||':'||regexp_replace(e.event_key,':resolved$','')
       WHERE o.incident_id=i.id AND o.status='resolved' AND e.status='resolved'
         AND e.source=i.source AND m.status='resolved'
         AND m.episode='row:'||e.id::text AND m.last_firing_at>=i.opened_at
         AND o.observed_at=m.last_event_at AND o.observed_at<=i.last_resolved_at
         AND o.created_at>=m.last_firing_received_at
         AND ((e.source='owner-operational-notifications'
               AND public.fn_sp_original_alert_proof(e.id)->>'kind'='original_drift_resolution')
           OR (((e.source='sp-critical-pager' AND e.alertname='CriticalPage.stuck_tournament')
                  OR (e.source='sp-daily-digest' AND e.alertname='DailyDigest.stuck_tournament'))
               AND e.payload->>'resolved_by'='fn_sp_critical_scan'
               AND pg_input_is_valid(e.payload->>'resolved_at','timestamptz')
               AND CASE WHEN pg_input_is_valid(e.payload#>>'{detail,tournament_id}','uuid')
                 THEN NOT EXISTS (SELECT 1 FROM public.tournaments t
                   WHERE t.id=(e.payload#>>'{detail,tournament_id}')::uuid AND t.status='RUNNING')
                 ELSE false END))));
$function$;
REVOKE ALL ON FUNCTION smarter_private.reliability_proved_source_resolution(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION smarter_private.reliability_proved_source_resolution(uuid) TO service_role;

DO $patch$
DECLARE d text; old text; replacement text;
BEGIN
 d:=pg_get_functiondef('smarter_private.reliability_transition(uuid,text,text,jsonb)'::regprocedure);
 old:='  IF NOT EXISTS (SELECT 1 FROM smarter_private.reliability_legal_transitions t WHERE t.from_status = v_from AND t.to_status = p_to_status) THEN';
 replacement:=$body$  IF v_from='stale_unverified' AND p_to_status='verifying'
     AND NOT smarter_private.reliability_proved_source_resolution(p_incident_id) THEN
    RAISE EXCEPTION 'stale incident has no proved same-episode owner source resolution' USING ERRCODE='22023';
  END IF;
$body$||old;
 IF length(d)-length(replace(d,old,''))<>length(old) THEN RAISE EXCEPTION 'original transition admission changed'; END IF;
 EXECUTE replace(d,old,replacement);
 d:=pg_get_functiondef('smarter_private.reliability_apply_signal(text,boolean,text,text,text,text,text,text,jsonb,jsonb,text,text,boolean,timestamptz,bigint,text,timestamptz,timestamptz)'::regprocedure);
 old:=$body$      ELSIF i.status IN ('investigating', 'recovering', 'contained', 'escalated') THEN$body$;
 replacement:=old||E'\n        -- original_owner_resolve_after_stale_v1: fresh same-episode branch only.';
 replacement:=replace(replacement,' THEN',E'\n         OR (i.status=''stale_unverified'' AND smarter_private.reliability_proved_source_resolution(i.id)) THEN');
 IF length(d)-length(replace(d,old,''))<>length(old) THEN RAISE EXCEPTION 'original resolved signal branch changed'; END IF;
 EXECUTE replace(d,old,replacement);
END $patch$;
INSERT INTO smarter_private.reliability_legal_transitions(from_status,to_status)
VALUES('stale_unverified','verifying') ON CONFLICT DO NOTHING;

-- Admit only original resolutions already received by intake before this source
-- correction. Preserve their receipt/quiet clock, all history and escalation.
DO $existing_original_resolutions$
DECLARE r record;
BEGIN
 FOR r IN SELECT i.id FROM smarter_private.reliability_incidents i
   WHERE i.status='stale_unverified' AND i.source IN ('owner-operational-notifications','sp-critical-pager','sp-daily-digest')
     AND smarter_private.reliability_proved_source_resolution(i.id)
   ORDER BY i.id FOR UPDATE OF i
 LOOP
   PERFORM smarter_private.reliability_transition(r.id,'verifying',
     'the recorded same-episode original owner source resolved',
     jsonb_build_object('kind','resolved_signal','basis','proved_original_source_resolution'));
 END LOOP;
END $existing_original_resolutions$;
COMMIT;
