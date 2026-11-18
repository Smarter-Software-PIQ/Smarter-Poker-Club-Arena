-- Production definitions (2026-11-18, read-only pg_get_functiondef) of the
-- helpers the alert->incident roll-up calls, and of the incident->alert
-- cascade that resolves the drift_incident:* echoes when an incident closes.
CREATE OR REPLACE FUNCTION public.fn_ca_normalize_alert_text(p_text text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  /* Order matters. UUIDs first (digits and hyphens), then timestamps, then
     decimals, then bare integers, then whitespace. What is left is the WORDS,
     which is what distinguishes one cause from another. */
  SELECT regexp_replace(
           regexp_replace(
             regexp_replace(
               regexp_replace(
                 regexp_replace(
                   lower(coalesce(p_text, '')),
                   '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
                   '<id>', 'g'),
                 '\d{4}-\d{2}-\d{2}[t ]\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}:?\d{2}|z)?',
                 '<ts>', 'g'),
               '\d+\.\d+', '<amt>', 'g'),
             '\d+', '<n>', 'g'),
           '\s+', ' ', 'g')
$function$;

CREATE OR REPLACE FUNCTION public.fn_ca_stable_dedupe_key(p_key text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  /* Strips a trailing period label: :2026-09-06, :2026-09-06-18, :2026-36.
     Used ONLY together with an equal discrepancy, so an hourly bucket that
     reports a different number is never folded into another one. */
  SELECT regexp_replace($1, ':([0-9]{4}-[0-9]{2}-[0-9]{2}(-[0-9]{2})?|[0-9]{4}-[0-9]{1,2})$', '')
$function$;

CREATE OR REPLACE FUNCTION public.fn_ca_incident_resolution_reaches_the_alerts()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_note text; v_state text; v_msg text;
BEGIN
  IF NEW.status <> 'resolved' OR
     (COALESCE(OLD.status,'') = 'resolved'
      AND NEW.closure_basis IS NOT DISTINCT FROM OLD.closure_basis) THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.closure_basis = 'aged_out_unverified', false) THEN
    RETURN NEW;
  END IF;

  v_note := 'Closed with drift incident ' || NEW.id::text || ': '
            || COALESCE(NULLIF(NEW.resolution,''), 'no note given on the incident');

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
  UPDATE public.financial_alerts f
     SET resolved = true, resolved_at = now(),
         resolution = COALESCE(NULLIF(f.resolution,'') || ' | ','') || v_note
   WHERE NOT COALESCE(f.resolved,false)
     AND f.context->>'incident_id' ~ '^[0-9a-fA-F-]{36}$'
     AND (f.context->>'incident_id')::uuid = NEW.id;

  IF NEW.metadata->>'alert_id' ~ '^[0-9a-fA-F-]{36}$' THEN
    UPDATE public.financial_alerts f
       SET resolved = true, resolved_at = now(),
           resolution = COALESCE(NULLIF(f.resolution,'') || ' | ','') || v_note
     WHERE NOT COALESCE(f.resolved,false)
       AND f.id = (NEW.metadata->>'alert_id')::uuid;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  IF NEW.closure_basis = 'operator' THEN RAISE; END IF;
  GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  BEGIN
    INSERT INTO public.ca_incident_file_failures
      (source, dedupe_key, classification, severity, discrepancy, sqlstate, message)
    VALUES ('fn_ca_incident_resolution_reaches_the_alerts',
            'propagate:incident->alert:' || NEW.id::text,
            'unknown', 'warning', 0, v_state,
            'a resolved incident did not close the alerts echoing it: ' || v_msg);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RAISE WARNING 'fn_ca_incident_resolution_reaches_the_alerts failed: %', v_msg;
  RETURN NEW;
END $function$;
