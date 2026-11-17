-- Original source outcomes, investigation and transport receipts are distinct.
-- A physical source resolution reaches its original controller through the
-- existing status transition. An informational review never proves recovery.
-- No money, detector, schedule, notification destination or quiet-window change.
-- @live-proof: strpos(pg_get_functiondef('public.fn_sp_original_alert_proof(bigint)'::regprocedure),'original_source_review_v1')>0
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='8s';

DO $patch$
DECLARE d text; old text; replacement text;
BEGIN
 d:=pg_get_functiondef('public.fn_sp_original_alert_proof(bigint)'::regprocedure);
 old:='        witness text; kind text; reference text; verified boolean:=false;';
 IF length(d)-length(replace(d,old,''))<>length(old) THEN RAISE EXCEPTION 'original proof declaration changed';END IF;
 d:=replace(d,old,old||E'\n        reviewed boolean:=false; review_note text;');
 old:='  verified:=kind IS NOT NULL;';
 replacement:=$body$
  -- original_source_review_v1: owner notification carries the exact drift UUID,
  -- original event time and type. No title similarity or unscoped inference.
  IF kind IS NULL AND original.source='owner-operational-notifications'
     AND original.payload#>>'{original_notification,type}'='financial_incident' THEN
    SELECT i.id::text INTO witness FROM public.ca_drift_incidents i
    WHERE i.id=CASE WHEN (original.payload#>>'{original_notification,data,incident_id}') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN (original.payload#>>'{original_notification,data,incident_id}')::uuid END
      AND i.status='resolved' AND i.closure_basis IS DISTINCT FROM 'aged_out_unverified'
      AND length(btrim(COALESCE(i.root_cause,'')))>=40
      AND NULLIF(btrim(i.resolution),'') IS NOT NULL
      AND i.correction_ref ~* '^(migration[[:space:]]+[^[:space:]]|PR[[:space:]]*#[0-9]|chip_ledger[[:space:]]+[^[:space:]]|correction:[^[:space:]]|(ruling:|verified:|no-change-needed:)[[:space:]]*[^[:space:]])'
      AND CASE WHEN pg_input_is_valid(original.payload#>>'{original_notification,created_at}','timestamp with time zone')
        THEN (original.payload#>>'{original_notification,created_at}')::timestamptz
          BETWEEN i.detected_at AND i.resolved_at ELSE false END;
    IF FOUND THEN kind:='original_drift_resolution';reference:='Verified original drift incident '||witness;END IF;
  END IF;
  IF original.investigation_status='informational' THEN
    SELECT x.value->>'finding' INTO review_note
    FROM jsonb_each(CASE WHEN jsonb_typeof(original.investigation)='object' THEN original.investigation ELSE '{}'::jsonb END) x
    WHERE jsonb_typeof(x.value)='object'
      AND length(btrim(COALESCE(x.value->>'finding','')))>=40
      AND NULLIF(btrim(x.value->>'reviewed_by'),'') IS NOT NULL
      AND CASE WHEN pg_input_is_valid(x.value->>'reviewed_at','timestamp with time zone')
        THEN (x.value->>'reviewed_at')::timestamptz BETWEEN
          COALESCE(original.last_received_at,original.received_at) AND now() ELSE false END
    ORDER BY x.value->>'reviewed_at' DESC LIMIT 1;
    reviewed:=FOUND;
    IF reviewed THEN reference:=COALESCE(reference,review_note);END IF;
  END IF;
  verified:=kind IS NOT NULL;
$body$;
 IF length(d)-length(replace(d,old,''))<>length(old) THEN RAISE EXCEPTION 'original proof outcome changed';END IF;
 d:=replace(d,old,replacement);
 old:=$body$  IF NOT verified AND original.investigation_status='verified_fixed' THEN$body$;
 replacement:=$body$  IF NOT verified AND original.investigation_status='verified_fixed'
     AND COALESCE(original.last_received_at<=COALESCE(original.investigation_touched_at,original.received_at),
                  original.last_received_at IS NULL) THEN$body$;
 IF length(d)-length(replace(d,old,''))<>length(old) THEN RAISE EXCEPTION 'original verified review changed';END IF;
 d:=replace(d,old,replacement);
 old:=$body$'reviewed',verified OR COALESCE(original.investigation_status='historical',false)$body$;
 IF length(d)-length(replace(d,old,''))<>length(old) THEN RAISE EXCEPTION 'original reviewed return changed';END IF;
 EXECUTE replace(d,old,$body$'reviewed',reviewed OR verified OR COALESCE(original.investigation_status='historical',false)$body$);

 d:=pg_get_functiondef('public.fn_sp_daily_digest(date,boolean)'::regprocedure);
 old:=$body$WHEN o.investigation_status IN ('verified_fixed','historical') THEN 'fixed'$body$;
 IF length(d)-length(replace(d,old,''))<>length(old) THEN RAISE EXCEPTION 'single original digest outcome changed';END IF;
 d:=replace(d,old,$body$WHEN COALESCE((public.fn_sp_original_alert_proof(o.id)->>'reviewed')::boolean,false) THEN 'fixed'$body$);
 old:=$body$ELSE o.investigation->>'resolution' END)$body$;
 IF length(d)-length(replace(d,old,''))<>length(old) THEN RAISE EXCEPTION 'original digest resolution changed';END IF;
 EXECUTE replace(d,old,$body$ELSE COALESCE(o.investigation->>'resolution',public.fn_sp_original_alert_proof(o.id)->>'reference') END)$body$);

 d:=pg_get_functiondef('public.fn_ca_incident_resolution_reaches_the_alerts()'::regprocedure);
 old:='  UPDATE public.financial_alerts f';
 IF length(d)-length(replace(d,old,''))<>2*length(old) THEN RAISE EXCEPTION 'original drift propagation changed';END IF;
 replacement:=$body$
  -- The original resolution reaches its owner notification synchronously.
  UPDATE public.operational_alert_events e SET status='resolved',
    investigation=e.investigation||jsonb_build_object('resolution',v_note,
      'source_resolution',jsonb_build_object('incident_id',NEW.id,'resolved_at',NEW.resolved_at,
         'closure_basis',NEW.closure_basis,'correction_ref',NEW.correction_ref))
  WHERE e.source='owner-operational-notifications' AND e.status='firing'
    AND length(btrim(COALESCE(NEW.root_cause,'')))>=40
    AND NULLIF(btrim(NEW.resolution),'') IS NOT NULL
    AND NEW.correction_ref ~* '^(migration[[:space:]]+[^[:space:]]|PR[[:space:]]*#[0-9]|chip_ledger[[:space:]]+[^[:space:]]|correction:[^[:space:]]|(ruling:|verified:|no-change-needed:)[[:space:]]*[^[:space:]])'
    AND e.payload#>>'{original_notification,type}'='financial_incident'
    AND e.payload#>>'{original_notification,data,incident_id}'=NEW.id::text
    AND CASE WHEN pg_input_is_valid(e.payload#>>'{original_notification,created_at}','timestamp with time zone')
      THEN (e.payload#>>'{original_notification,created_at}')::timestamptz
        BETWEEN NEW.detected_at AND NEW.resolved_at ELSE false END;
  UPDATE public.financial_alerts f$body$;
 -- Only the first financial update is the propagation entry point.
 d:=overlay(d placing replacement from strpos(d,old) for length(old));
 EXECUTE d;

 d:=pg_get_functiondef('public.fn_operational_alert_mirror_classify()'::regprocedure);
 old:=$body$  IF NEW.investigation_status IS DISTINCT FROM 'new' THEN RETURN NEW; END IF;$body$;
 replacement:=old||$body$
  IF NEW.source='owner-operational-notifications'
     AND NEW.payload#>>'{original_notification,type}'='financial_incident'
     AND EXISTS(SELECT 1 FROM public.ca_drift_incidents i
       WHERE i.id=CASE WHEN (NEW.payload#>>'{original_notification,data,incident_id}') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
         THEN (NEW.payload#>>'{original_notification,data,incident_id}')::uuid END
         AND i.status='resolved' AND i.closure_basis IS DISTINCT FROM 'aged_out_unverified'
         AND length(btrim(COALESCE(i.root_cause,'')))>=40
         AND NULLIF(btrim(i.resolution),'') IS NOT NULL
         AND i.correction_ref ~* '^(migration[[:space:]]+[^[:space:]]|PR[[:space:]]*#[0-9]|chip_ledger[[:space:]]+[^[:space:]]|correction:[^[:space:]]|(ruling:|verified:|no-change-needed:)[[:space:]]*[^[:space:]])'
         AND CASE WHEN pg_input_is_valid(NEW.payload#>>'{original_notification,created_at}','timestamp with time zone')
           THEN (NEW.payload#>>'{original_notification,created_at}')::timestamptz
             BETWEEN i.detected_at AND i.resolved_at ELSE false END) THEN
    NEW.status:='resolved';NEW.investigation_status:='informational';
    NEW.investigation:=NEW.investigation||jsonb_build_object('rule','original_drift_already_resolved',
      'resolution','Original drift source has an evidence-backed resolution before this notification arrived.');
    RETURN NEW;
  END IF;
$body$;
 IF length(d)-length(replace(d,old,''))<>length(old) THEN RAISE EXCEPTION 'mirror arrival classification changed';END IF;
 EXECUTE replace(d,old,replacement);
END $patch$;

-- Preserve any other original source admitted by the current trigger. A
-- concurrent source extension must never be replaced by an older fixed list.
DO $arrival_trigger$
DECLARE d text; enabled "char"; anchor text:='''alertmanager''::text';
BEGIN
 SELECT pg_get_triggerdef(t.oid),t.tgenabled INTO STRICT d,enabled
 FROM pg_trigger t WHERE t.tgrelid='public.operational_alert_events'::regclass
   AND t.tgname='a0_operational_alert_mirror_classify' AND NOT t.tgisinternal;
 IF enabled<>'O' OR strpos(d,'fn_operational_alert_mirror_classify()')=0 THEN
  RAISE EXCEPTION 'original mirror arrival trigger changed';
 END IF;
 IF strpos(d,'owner-operational-notifications')=0 THEN
  IF length(d)-length(replace(d,anchor,''))<>length(anchor) THEN
   RAISE EXCEPTION 'original mirror source selector changed';
  END IF;
  EXECUTE replace(replace(d,'CREATE TRIGGER','CREATE OR REPLACE TRIGGER'),
    anchor,anchor||', ''owner-operational-notifications''::text');
 END IF;
END $arrival_trigger$;

-- Project already-proved original outcomes once at installation. Future changes
-- are owned by the original synchronous triggers above, never a repair schedule.
UPDATE public.operational_alert_events e SET status='resolved'
WHERE e.status='firing' AND e.source='owner-operational-notifications'
AND public.fn_sp_original_alert_proof(e.id)->>'kind'='original_drift_resolution';
COMMIT;
