-- @live-proof: position('owner-operational-notifications' in pg_get_functiondef('public.fn_ca_incident_resolution_reaches_the_alerts()'::regprocedure)) > 0
-- 20261117224454_owner_incident_notice_closes_with_incident.sql
--
-- Version reserved by scripts/new-migration.mjs.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- fn_try_record_owner_notification copies every owner notification into
-- public.operational_alert_events (source 'owner-operational-notifications')
-- as a FIRING row, and nothing ever resolves it. When the drift incident
-- named in a financial_incident notice resolves, its financial_alerts rows are
-- closed by fn_ca_incident_resolution_reaches_the_alerts, but the owner-notice
-- copy stays firing for ever, so its Reliability Controller incident can
-- never clear. Example: f775f812 "financial_incident:fn_ca_conservation_sweep:
-- fn_ca_orphaned_running_tournaments is critical" (event 381325) stayed
-- escalated after drift incident 229714c9 resolved, and the Nightly 20K it
-- described had completed and paid. Read 2026-11-17: 865 financial_incident
-- notices firing; 836 of them belong to incidents already resolved.
--
-- The fix belongs where the incident resolves. The same trigger that closes
-- the incident's financial_alerts now also resolves, in the same
-- transaction, every firing owner-notice copy whose
-- payload.original_notification.data.incident_id is that incident. The
-- existing zzz_reliability_intake_update trigger on operational_alert_events
-- carries that status change to the controller, which closes the incident
-- through its normal resolved path. No schedule, watcher or sweep is added.
--
-- The trigger's existing rules are kept unchanged:
--   * an incident closed as aged_out_unverified resolves nothing (it returns
--     before this point), so its notices stay firing;
--   * a failure in the propagation is filed and only an explicit operator
--     resolution raises.
--
-- One-time correction: the 836 notices whose incident is already resolved
-- (closure basis other than aged_out_unverified) are resolved here with the
-- same note shape. Notices with no incident or an aged-out incident are
-- untouched.
--
-- Guarded: the anchor must appear exactly once, and the rewrite is re-read to
-- confirm it landed. A second run is a no-op. pg_get_functiondef carries owner,
-- SECURITY DEFINER and SET clauses.

BEGIN;

DO $migration$
DECLARE
  v_fn regprocedure := 'public.fn_ca_incident_resolution_reaches_the_alerts()'::regprocedure;
  v_anchor text := E'  RETURN NEW;\nEXCEPTION WHEN OTHERS THEN\n  -- Explicit operator resolution must commit its linked outcome atomically.';
  v_add text := E'  /* AN OWNER-NOTICE COPY RESOLVES WITH ITS INCIDENT (2026-11-17).\n     fn_try_record_owner_notification records each owner notification as a\n     firing operational_alert_events row; it closes here, in the transaction\n     that resolves the incident it names. */\n  UPDATE public.operational_alert_events e\n     SET status = ''resolved'',\n         payload = e.payload || jsonb_build_object(\n           ''resolution'', v_note,\n           ''resolved_at'', now(),\n           ''resolved_by_incident'', NEW.id::text)\n   WHERE e.source = ''owner-operational-notifications''\n     AND e.status = ''firing''\n     AND e.payload->''original_notification''->''data''->>''incident_id'' = NEW.id::text;\n\n';
  v_def text;
  v_n int;
BEGIN
  v_def := pg_get_functiondef(v_fn);
  IF position('owner-operational-notifications' in v_def) > 0 THEN
    RAISE NOTICE 'already applied';
  ELSE
    v_n := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'anchor found % times in fn_ca_incident_resolution_reaches_the_alerts, expected 1', v_n;
    END IF;
    EXECUTE replace(v_def, v_anchor, v_add || v_anchor);
    IF position('owner-operational-notifications' in pg_get_functiondef(v_fn)) = 0 THEN
      RAISE EXCEPTION 'rewrite of fn_ca_incident_resolution_reaches_the_alerts did not land';
    END IF;
  END IF;
END
$migration$;

-- One-time correction for notices whose incident had already resolved.
UPDATE public.operational_alert_events e
   SET status = 'resolved',
       payload = e.payload || jsonb_build_object(
         'resolution', 'Closed with drift incident ' || d.id::text || ': '
                       || COALESCE(NULLIF(d.resolution,''), 'no note given on the incident'),
         'resolved_at', now(),
         'resolved_by_incident', d.id::text)
  FROM public.ca_drift_incidents d
 WHERE e.source = 'owner-operational-notifications'
   AND e.status = 'firing'
   AND e.payload->'original_notification'->'data'->>'incident_id' = d.id::text
   AND d.status = 'resolved'
   AND COALESCE(d.closure_basis, '') <> 'aged_out_unverified';

COMMIT;
