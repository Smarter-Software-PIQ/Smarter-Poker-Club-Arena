-- Production definitions (2026-11-18, read-only pg_get_functiondef; the test
-- asserts each md5 equals production's) of the
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

  /* AN AGE-OUT IS NOT A RESOLUTION AND MUST NOT PROPAGATE AS ONE (2026-09-20).
     This trigger marks the financial_alerts rows behind an incident resolved.
     An incident retired only because its stream went quiet has established
     nothing about those alerts, so closing them would carry "I could not tell"
     into a second table dressed as an answer. The incident closes; the alert
     stays open for whoever reads financial_alerts directly. */
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
  -- Explicit operator resolution must commit its linked outcome atomically.
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

CREATE OR REPLACE FUNCTION public.fn_ca_resolution_needs_a_cause()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cause text := btrim(coalesce(NEW.root_cause, ''));
  v_ref   text := btrim(coalesce(NEW.correction_ref, ''));
  -- COALESCE, not a bare comparison: a NULL closure_basis must read as "not
  -- aged out" (false), never as NULL, or both fences below silently pass.
  v_aged  boolean := COALESCE(NEW.closure_basis = 'aged_out_unverified', false);
  v_ok    boolean;
BEGIN
  IF NEW.status <> 'resolved' OR
     (OLD.status = 'resolved'
      AND NEW.closure_basis IS NOT DISTINCT FROM OLD.closure_basis
      AND NEW.root_cause IS NOT DISTINCT FROM OLD.root_cause
      AND NEW.correction_ref IS NOT DISTINCT FROM OLD.correction_ref) THEN
    RETURN NEW;
  END IF;

  IF length(v_cause) < 40 THEN
    RAISE EXCEPTION
      'An incident is not resolved until the cause is written down. Supply root_cause: what was actually wrong, in a sentence (at least 40 characters). Got %.',
      CASE WHEN v_cause = '' THEN 'nothing' ELSE '"' || v_cause || '"' END
      USING ERRCODE = 'P0404';
  END IF;

  -- 2026-09-01: the auto_repair_status='repaired' bypass is GONE. Any writer
  -- could set that flag in the same UPDATE that resolved, which made the law
  -- optional for exactly the actor it was written to govern (the same shape
  -- as the [allow-revert] token incident of 2026-08-31). The automated
  -- reconciler now writes 'verified: <evidence>' like every other resolver.
  --
  -- 2026-09-20: 'aged-out:' joins the list, FENCED OFF from 'verified:' in
  -- BOTH directions. Until today the escalation tick closed a silence-retired
  -- incident with correction_ref 'verified: not seen again for N hours', so an
  -- unread event stream and a re-measured all-clear were recorded with the
  -- same word in the same field - 43 rows carry that wording. Silence is
  -- "I could not tell" (law 10.86 rule 1). It gets its own prefix, and the two
  -- can no longer be mistaken for one another.
  v_ok := v_ref ~* '^(migration[[:space:]]+[^[:space:]]|PR[[:space:]]*#[0-9]|chip_ledger[[:space:]]+[^[:space:]]|correction:[^[:space:]])'
       OR v_ref ~* '^(ruling:|verified:|no-change-needed:|aged-out:)[[:space:]]*[^[:space:]]';

  IF NOT v_ok THEN
    RAISE EXCEPTION
      'An incident is not resolved until something stops it happening again. Supply correction_ref as one of: "migration <name>", "PR #<n>", "chip_ledger <id>", "correction:<key>", "ruling: <decision>", "verified: <evidence>", "aged-out: <what went quiet>", or "no-change-needed: <why>". Got %.',
      CASE WHEN v_ref = '' THEN 'nothing' ELSE '"' || v_ref || '"' END
      USING ERRCODE = 'P0404';
  END IF;

  IF v_aged AND v_ref !~* '^aged-out:[[:space:]]*[^[:space:]]' THEN
    RAISE EXCEPTION
      'closure_basis is ''aged_out_unverified'', so correction_ref must begin "aged-out: ". An incident retired because its event stream went quiet was not verified, and must not be filed under any evidence prefix. Got %.',
      CASE WHEN v_ref = '' THEN 'nothing' ELSE '"' || v_ref || '"' END
      USING ERRCODE = 'P0404';
  END IF;

  IF NOT v_aged AND v_ref ~* '^aged-out:' THEN
    RAISE EXCEPTION
      'correction_ref begins "aged-out: " but closure_basis is %. Set closure_basis to ''aged_out_unverified'', or supply real evidence under one of the other prefixes.',
      COALESCE('''' || NEW.closure_basis || '''', 'not set')
      USING ERRCODE = 'P0404';
  END IF;

  RETURN NEW;
END;
$function$;
