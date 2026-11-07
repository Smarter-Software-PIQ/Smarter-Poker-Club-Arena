-- 20261107194824_an_incident_upgraded_to_evidence_closes_its_alerts
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-07 19:48:24 UTC.
--
-- CLAUDE.md 10.9: the reasoning goes in this header, not just the SQL.
-- Say what was wrong, what this changes, and what you measured. A
-- migration whose header is its own filename is the next agent's mystery.
--
-- AN INCIDENT UPGRADED TO EVIDENCE CLOSES ITS ALERTS (2026-11-07).
--
-- fn_ca_incident_resolution_reaches_the_alerts (#8880, 2026-10-31) is written
-- for two cases: an incident becoming resolved, and an incident that is
-- ALREADY resolved whose closure_basis changes - an upgrade from
-- aged_out_unverified ("I could not tell") to real evidence. Its first guard
-- says so in code:
--   IF NEW.status <> 'resolved' OR (OLD.status='resolved'
--      AND NEW.closure_basis IS NOT DISTINCT FROM OLD.closure_basis) THEN RETURN
-- But zz_ca_incident_resolution_reaches_the_alerts is AFTER UPDATE OF status,
-- and UPDATE OF fires only when status is in the statement's SET list. An
-- upgrade that writes closure_basis alone never reaches the function, so the
-- function's own rule depends on how the writer phrases its UPDATE.
--
-- It has already cost three alerts. Measured on production 2026-11-07, three
-- resolved incidents carry closure_basis 'verified_remeasured' and metadata
-- 'prior_unverified_closure' (aged out first, upgraded on 2026-10-28 with
-- evidence: each cites PR #8441 / migration 20261028151339 and a clean natural
-- cron run after it), and the alert each one echoes is still open:
--   incident d5e1bad6-9943-48ee-baee-618671ed7bf0 -> alert bc21887b-552b-4ab8-8854-a37857bc75a7
--   incident 48db2402-310b-41c2-a260-129b894e16f3 -> alert 7da52e4e-6779-4189-b183-226a19e60009
--   incident 5c3d7624-0aec-4bd6-ba6b-ce44a1b0fc52 -> alert ad3befbb-d2dd-49d7-a78c-62ff1a2ac923
-- All three are drift_incident:fn_ca_cron_failure_watch.
--
-- 1. The trigger fires on status OR closure_basis, so the function decides,
--    by its own rule, whatever the writer's SET list. The function is not
--    touched (md5-pinned below). An age-out still never propagates: the
--    function returns before any write when closure_basis is
--    aged_out_unverified.
-- 2. The three stranded alerts are closed exactly as the function would have
--    closed them, with its own note format. Bounded to those three ids, each
--    re-checked against its incident here; a re-run closes 0.
--
-- What already relied on the narrower trigger: class 8 of
-- fn_resolve_settled_financial_alerts (20261107165633) upgrades escrow-drift
-- twins by closure_basis alone, and only twins of alerts it has just closed
-- in the same statement. With this trigger those upgrades reach the function,
-- whose UPDATEs are guarded by NOT resolved, so they close nothing that class
-- 8 has not already closed. Measured: every resolved incident with an open
-- echoed alert is one of these three (verified_remeasured) or aged out (39,
-- which stay open by design).
--
-- @live-proof: (SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t WHERE t.tgname='zz_ca_incident_resolution_reaches_the_alerts' AND t.tgrelid='public.ca_drift_incidents'::regclass)='CREATE TRIGGER zz_ca_incident_resolution_reaches_the_alerts AFTER UPDATE OF status, closure_basis ON public.ca_drift_incidents FOR EACH ROW EXECUTE FUNCTION fn_ca_incident_resolution_reaches_the_alerts()'
-- @live-proof: (SELECT count(*) FROM public.financial_alerts WHERE id IN ('bc21887b-552b-4ab8-8854-a37857bc75a7','7da52e4e-6779-4189-b183-226a19e60009','ad3befbb-d2dd-49d7-a78c-62ff1a2ac923') AND resolved IS TRUE)=3

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

DO $pre$
BEGIN
  IF md5(pg_get_functiondef('public.fn_ca_incident_resolution_reaches_the_alerts()'::regprocedure)) IS DISTINCT FROM '0d6c1f30fd1d9e1caebdfb9e9f2fd27e' THEN
    RAISE EXCEPTION 'INCIDENT_UPGRADE_PROPAGATION_FUNCTION_CHANGED' USING ERRCODE='55000';
  END IF;
  IF (SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t
       WHERE t.tgname='zz_ca_incident_resolution_reaches_the_alerts' AND t.tgrelid='public.ca_drift_incidents'::regclass)
     NOT IN ('CREATE TRIGGER zz_ca_incident_resolution_reaches_the_alerts AFTER UPDATE OF status ON public.ca_drift_incidents FOR EACH ROW EXECUTE FUNCTION fn_ca_incident_resolution_reaches_the_alerts()',
             'CREATE TRIGGER zz_ca_incident_resolution_reaches_the_alerts AFTER UPDATE OF status, closure_basis ON public.ca_drift_incidents FOR EACH ROW EXECUTE FUNCTION fn_ca_incident_resolution_reaches_the_alerts()') THEN
    RAISE EXCEPTION 'INCIDENT_UPGRADE_PROPAGATION_TRIGGER_CHANGED' USING ERRCODE='55000';
  END IF;
END $pre$;

DROP TRIGGER zz_ca_incident_resolution_reaches_the_alerts ON public.ca_drift_incidents;
CREATE TRIGGER zz_ca_incident_resolution_reaches_the_alerts
  AFTER UPDATE OF status, closure_basis ON public.ca_drift_incidents
  FOR EACH ROW EXECUTE FUNCTION public.fn_ca_incident_resolution_reaches_the_alerts();

DO $stranded$
DECLARE n integer;
BEGIN
  WITH pairs(incident_id, alert_id) AS (VALUES
    ('d5e1bad6-9943-48ee-baee-618671ed7bf0'::uuid,'bc21887b-552b-4ab8-8854-a37857bc75a7'::uuid),
    ('48db2402-310b-41c2-a260-129b894e16f3'::uuid,'7da52e4e-6779-4189-b183-226a19e60009'::uuid),
    ('5c3d7624-0aec-4bd6-ba6b-ce44a1b0fc52'::uuid,'ad3befbb-d2dd-49d7-a78c-62ff1a2ac923'::uuid))
  UPDATE public.financial_alerts f
     SET resolved = true, resolved_at = now(),
         resolution = COALESCE(NULLIF(f.resolution,'') || ' | ','')
           || 'Closed with drift incident ' || d.id::text || ': '
           || COALESCE(NULLIF(d.resolution,''), 'no note given on the incident')
    FROM pairs p JOIN public.ca_drift_incidents d ON d.id = p.incident_id
   WHERE f.id = p.alert_id
     AND NOT COALESCE(f.resolved,false)
     AND f.context->>'incident_id' = d.id::text
     AND d.status = 'resolved'
     AND d.closure_basis = 'verified_remeasured'
     AND d.correction_ref LIKE 'verified: %'
     AND d.metadata ? 'prior_unverified_closure';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n NOT IN (0, 3) THEN
    RAISE EXCEPTION 'INCIDENT_UPGRADE_STRANDED_ALERTS_DRIFTED: closed %', n USING ERRCODE='55000';
  END IF;
  IF (SELECT count(*) FROM public.financial_alerts WHERE id IN
       ('bc21887b-552b-4ab8-8854-a37857bc75a7','7da52e4e-6779-4189-b183-226a19e60009','ad3befbb-d2dd-49d7-a78c-62ff1a2ac923')
       AND resolved IS TRUE) <> 3 THEN
    RAISE EXCEPTION 'INCIDENT_UPGRADE_STRANDED_ALERTS_STILL_OPEN' USING ERRCODE='55000';
  END IF;
END $stranded$;

DO $post$
BEGIN
  IF (SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t
       WHERE t.tgname='zz_ca_incident_resolution_reaches_the_alerts' AND t.tgrelid='public.ca_drift_incidents'::regclass)
     IS DISTINCT FROM 'CREATE TRIGGER zz_ca_incident_resolution_reaches_the_alerts AFTER UPDATE OF status, closure_basis ON public.ca_drift_incidents FOR EACH ROW EXECUTE FUNCTION fn_ca_incident_resolution_reaches_the_alerts()' THEN
    RAISE EXCEPTION 'INCIDENT_UPGRADE_PROPAGATION_POSTIMAGE' USING ERRCODE='55000';
  END IF;
END $post$;

COMMIT;
