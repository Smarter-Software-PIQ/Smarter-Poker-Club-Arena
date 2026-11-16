-- Engine alert transitions belong to their producer episode, not append-row IDs.
-- engine_alerts 3116/3117 are one floor episode; intake keyed them separately
-- and rejected the real resolve as resolved_not_of_this_episode. Original
-- observations, source receipts, occurrence counts and quiet windows are kept.
-- The bounded projection upgrade resumes only those original rejected resolves.
-- No source alert, gameplay, financial row, runbook or schedule is written.
-- @live-proof: (position('ENGINE_EPISODE_IDENTITY_V1' in pg_get_functiondef('smarter_private.reliability_ingest_alert(bigint,text,text,text,text,text,jsonb,timestamptz,timestamptz,bigint,text,text)'::regprocedure)) > 0 AND NOT has_function_privilege('anon','smarter_private.reliability_engine_episode_identity(text,jsonb)','EXECUTE') AND NOT has_function_privilege('authenticated','smarter_private.reliability_engine_episode_identity(text,jsonb)','EXECUTE'))
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';
-- Serialize the brief projection upgrade with the original inbox transactions.
-- One short lock attempt: no old intake can finish behind the new identity.
LOCK TABLE public.operational_alert_events IN SHARE ROW EXCLUSIVE MODE;

CREATE OR REPLACE FUNCTION smarter_private.reliability_engine_episode_identity(p_alertname text, p_payload jsonb)
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'pg_catalog', 'smarter_private'
AS $identity$
  WITH row_data AS (
    SELECT CASE WHEN jsonb_typeof(p_payload->'original_event')='object'
                THEN p_payload->'original_event' ELSE p_payload END AS r
  ), fields AS (
    SELECT r, r#>>'{labels,engine_alert_episode_id}' AS episode,
           coalesce(nullif(r->>'component',''),r#>>'{labels,component}') AS component
      FROM row_data
  )
  SELECT jsonb_build_object(
    'member_key','engine-alerts:'||p_alertname||':'||component||':episode:'||lower(episode),
    'episode',lower(episode),
    'episode_at',smarter_private.reliability_safe_timestamp(r->>'starts_at'))
    FROM fields
   WHERE jsonb_typeof(r#>'{labels,engine_alert_episode_id}')='string'
     AND episode ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
     AND episode <> '00000000-0000-0000-0000-000000000000'
     AND component ~ '^[A-Za-z0-9_.:-]{1,120}$'
     AND coalesce(r->>'alertname',r#>>'{labels,alertname}')=p_alertname
$identity$;
REVOKE ALL ON FUNCTION smarter_private.reliability_engine_episode_identity(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION smarter_private.reliability_engine_episode_identity(text,jsonb) TO service_role;

DO $patch$
DECLARE
  s text; n text; k integer;
  sig constant text := 'smarter_private.reliability_ingest_alert(bigint,text,text,text,text,text,jsonb,timestamptz,timestamptz,bigint,text,text)';
  old_parts text[] := ARRAY[
$q$  v_release text;
BEGIN$q$,
$q$  v_member := CASE
$q$,
$q$  IF p_source = 'alertmanager' THEN
    v_episode_at := smarter_private.reliability_safe_timestamp(v_alert->>'startsAt');$q$,
$q$  IF v_observation IS NULL THEN RETURN NULL; END IF;$q$];
  new_parts text[] := ARRAY[
$q$  v_release text;
  v_engine_identity jsonb;
BEGIN
  -- ENGINE_EPISODE_IDENTITY_V1: the engine appends firing and resolved rows.
  -- Its validated producer episode and component are the durable member.
  IF v_family = 'engine-alerts' THEN
    v_engine_identity := smarter_private.reliability_engine_episode_identity(v_raw_name,p_payload);
  END IF;$q$,
$q$  v_member := CASE
    WHEN v_engine_identity IS NOT NULL THEN v_engine_identity->>'member_key'
$q$,
$q$  IF v_engine_identity IS NOT NULL THEN
    v_episode := v_engine_identity->>'episode';
    v_episode_at := smarter_private.reliability_safe_timestamp(v_engine_identity->>'episode_at');
  ELSIF p_source = 'alertmanager' THEN
    v_episode_at := smarter_private.reliability_safe_timestamp(v_alert->>'startsAt');$q$,
$q$  IF v_observation IS NULL AND v_resolved AND v_engine_identity IS NOT NULL THEN
    -- Resume this exact original rejected delivery after its member projection
    -- was upgraded. No new observation, delivery identity or firing is invented.
    SELECT id INTO v_observation FROM smarter_private.reliability_observations
     WHERE inbox_event_id=p_id AND delivery_count=p_delivery_count
       AND status='resolved' AND disposition='resolved_not_of_this_episode';
  END IF;
  IF v_observation IS NULL THEN RETURN NULL; END IF;$q$];
BEGIN
  s := pg_get_functiondef(sig::regprocedure);
  IF position('ENGINE_EPISODE_IDENTITY_V1' in s)>0 THEN RETURN; END IF;
  IF md5(s)<>'e83681e210cbba856ed8a609a82dc3d2' THEN
    RAISE EXCEPTION 'ENGINE_EPISODE_INTAKE_PREIMAGE_CHANGED';
  END IF;
  n:=s;
  FOR k IN 1..array_length(old_parts,1) LOOP
    IF (length(n)-length(replace(n,old_parts[k],'')))/length(old_parts[k])<>1 THEN
      RAISE EXCEPTION 'ENGINE_EPISODE_INTAKE_ANCHOR_CHANGED: %',k;
    END IF;
    n:=replace(n,old_parts[k],new_parts[k]);
  END LOOP;
  EXECUTE n;
END
$patch$;

-- Upgrade the existing projection from retained original receipts. Historical
-- observations stay in place. Only a current firing member with one proved
-- producer episode may move; an ambiguous collision refuses the transaction.
DO $projection$
DECLARE r record; n integer:=0;
BEGIN
  FOR r IN
    SELECT DISTINCT m.member_key, identity.value
      FROM smarter_private.reliability_alert_members m
      JOIN smarter_private.reliability_incidents i ON i.fingerprint=m.fingerprint AND i.status<>'closed'
      JOIN smarter_private.reliability_observations o ON o.incident_id=i.id AND o.status='firing'
      JOIN public.operational_alert_events e ON e.id=o.inbox_event_id
      CROSS JOIN LATERAL (SELECT smarter_private.reliability_engine_episode_identity(e.alertname,e.payload) AS value) identity
     WHERE e.source IN ('engine-alerts-backfill','engine-alerts-updates')
       AND m.member_key='engine-alerts:'||e.alertname||':'||split_part(e.event_key,':',1)
       AND m.status='firing' AND m.last_firing_at>=i.opened_at AND identity.value IS NOT NULL
     ORDER BY m.member_key LIMIT 201
  LOOP
    n:=n+1;
    IF n>200 THEN RAISE EXCEPTION 'ENGINE_EPISODE_PROJECTION_BOUND_EXCEEDED'; END IF;
    IF EXISTS(SELECT 1 FROM smarter_private.reliability_alert_members WHERE member_key=r.value->>'member_key') THEN
      RAISE EXCEPTION 'ENGINE_EPISODE_PROJECTION_COLLISION';
    END IF;
    UPDATE smarter_private.reliability_alert_members
       SET member_key=r.value->>'member_key',episode=r.value->>'episode',
           episode_at=smarter_private.reliability_safe_timestamp(r.value->>'episode_at')
     WHERE member_key=r.member_key;
  END LOOP;
  n:=0;
  FOR r IN
    SELECT DISTINCT e.*
      FROM smarter_private.reliability_observations o
      JOIN public.operational_alert_events e ON e.id=o.inbox_event_id
      JOIN smarter_private.reliability_incidents i ON i.id=o.incident_id AND i.status<>'closed'
      CROSS JOIN LATERAL (SELECT smarter_private.reliability_engine_episode_identity(e.alertname,e.payload) AS value) identity
      JOIN smarter_private.reliability_alert_members m ON m.member_key=identity.value->>'member_key'
     WHERE e.source IN ('engine-alerts-backfill','engine-alerts-updates')
       AND o.status='resolved' AND o.disposition='resolved_not_of_this_episode'
       AND m.status='firing' AND m.last_firing_at>=i.opened_at
     ORDER BY e.id LIMIT 201
  LOOP
    n:=n+1;
    IF n>200 THEN RAISE EXCEPTION 'ENGINE_EPISODE_RESUME_BOUND_EXCEEDED'; END IF;
    PERFORM smarter_private.reliability_ingest_alert(r.id,r.source,r.event_key,r.alertname,r.status,r.severity,
      r.payload,r.received_at,r.last_received_at,r.delivery_count,r.investigation_status,'INSERT');
  END LOOP;
END
$projection$;
COMMIT;
