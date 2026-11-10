-- 20261110224707_a_recovered_reliability_incident_is_no_longer_escalated.sql
--
-- Version reserved by scripts/reserve-migration-version.sh against this tree,
-- origin/main and every sibling worktree on this machine.
--
-- ============================================================================
-- A RECOVERED RELIABILITY INCIDENT IS NO LONGER ESCALATED
-- (Reliability incident 38ae668f-352c-4ef3-80b8-d1f8931383fa,
--  Tournament.atomic_finish_outcome_unknown, tournament 4b551d52; and the same
--  latch on a974b740-b4d4-4c50-9b92-b4b89a1730da and
--  78afb154-54ae-4661-bf7d-e5e3c18a6eb3)
-- ============================================================================
--
-- WHAT WENT WRONG. smarter_private.reliability_transition writes
-- escalation_state on the way INTO 'escalated' and never clears it:
--     escalation_state = CASE WHEN p_to_status = 'escalated' THEN 'escalated' ELSE escalation_state END
-- while in the same UPDATE closure_basis and resolution_state both special-case
-- the terminal statuses. So escalation is a LATCH. An incident that escalates
-- and then recovers keeps escalation_state='escalated' and
-- escalation_reason='no eligible recovery' for ever, and the owner handoff,
-- which reads those fields through fn_reliability_incident_for_owner, keeps
-- presenting it as AI AGENT NEEDED. Read on 2026-11-10, three incidents sat at
-- status='recovered' with escalation_state='escalated' for exactly this reason.
--
-- There is no second path that would have cleared it:
-- fn_ca_alert_resolution_reaches_the_incident propagates a resolved financial
-- alert to public.ca_drift_incidents, not to
-- smarter_private.reliability_incidents, so reliability_transition is the only
-- writer of this field.
--
-- THE FIX, AND WHY ONLY THESE TWO STATUSES. escalation_state is constrained to
-- ('none','escalated'), so clearing means 'none'. It is cleared only on
-- 'recovered' and 'closed':
--   * 'verifying' must NOT clear it - verification can fail and return to
--     escalated, and the legal matrix allows verifying -> escalated.
--   * 'contained', 'investigating', 'recovering' must NOT clear it - the
--     incident is still live.
--   * 'stale_unverified' must NOT clear it - that outcome is recorded as
--     aged_out_unverified precisely because nothing was verified, and the
--     repository is explicit that it must never read as a verified closure.
-- escalation_reason is deliberately LEFT as written, so the row still says why
-- it was escalated; and every transition, escalation included, is already
-- recorded in smarter_private.reliability_incident_events, so no history is
-- lost by clearing the flag.
--
-- RECURRENCE AND RE-ESCALATION. smarter_private.reliability_apply_signal
-- decides a recurrence's status with
--     CASE WHEN i.escalation_state = 'escalated' THEN 'escalated' ELSE 'investigating' END
-- With the latch, a new signal on a RECOVERED incident jumped straight back to
-- 'escalated' without anything being measured. With this fix it opens as
-- 'investigating' and escalates again only when a recovery is genuinely
-- unavailable - which is the designed flow, and the reason the latch is a
-- defect rather than a convenience. Re-escalation itself is unchanged: any
-- later transition to 'escalated' sets the flag again.
--
-- DATA: ONLY WHERE RECOVERY EVIDENCE IS ESTABLISHED. Two incidents are
-- reconciled here, each through the supported transition (recovered -> closed,
-- a legal edge), each guarded on its own evidence, and each a no-op if the
-- incident has since moved:
--   * 38ae668f Tournament.atomic_finish_outcome_unknown - financial alert
--     235060db is resolved with proof on the row: the tournament COMPLETED and
--     committed exactly once, one terminal receipt settled 2026-11-10
--     18:39:50.676782+00, prize pool 386.00 conserved to the cent by its
--     payout rows, bounty pool 345.00, escrow closed at zero at the same
--     instant. Nothing is re-settled here; the existing receipt is reused as
--     the evidence it already is.
--   * a974b740 LightningHandHost.post_commit_obligations_pending - financial
--     alert ea0ae17c is resolved: the post-commit envelope was applied and
--     post_commit_completed_at is set.
-- 78afb154 SpinFleetProducingNothing is deliberately NOT reconciled. Its
-- alertmanager condition cleared, but Spin throughput is still degraded
-- (6 starts in the hour to 2026-11-10 21:17Z against a documented ~100/hour,
-- 45 boards open with seated players at 1 to 2 of 3), so closing it would make
-- the board green while the fault is live. It stays escalated until the Spin
-- correction is verified.
--
-- No money, seat, schedule or release is touched, and no watcher or repair
-- loop is added.
--
-- @live-proof: position('CLEARED ON A TERMINAL STATUS (20261110224707)' in pg_get_functiondef('smarter_private.reliability_transition(uuid,text,text,jsonb)'::regprocedure)) > 0 AND NOT EXISTS (SELECT 1 FROM smarter_private.reliability_incidents WHERE id IN ('38ae668f-352c-4ef3-80b8-d1f8931383fa','a974b740-b4d4-4c50-9b92-b4b89a1730da') AND escalation_state = 'escalated') AND EXISTS (SELECT 1 FROM smarter_private.reliability_incidents WHERE id = '78afb154-54ae-4661-bf7d-e5e3c18a6eb3' AND escalation_state = 'escalated')

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

DO $pre$
BEGIN
  IF md5(pg_get_functiondef('smarter_private.reliability_transition(uuid,text,text,jsonb)'::regprocedure)) <> '50d8bd48d1b848bb9d7f5c26ba89ee0a' THEN
    RAISE EXCEPTION 'RELIABILITY_TRANSITION_PREIMAGE_CHANGED: reliability_transition was edited since this patch was qualified';
  END IF;
  -- The legal edges this migration relies on must exist.
  IF NOT EXISTS (SELECT 1 FROM smarter_private.reliability_legal_transitions WHERE from_status='recovered' AND to_status='closed') THEN
    RAISE EXCEPTION 'RELIABILITY_TRANSITION_PREIMAGE_CHANGED: recovered -> closed is not a legal transition';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM smarter_private.reliability_legal_transitions WHERE from_status='verifying' AND to_status='escalated') THEN
    RAISE EXCEPTION 'RELIABILITY_TRANSITION_PREIMAGE_CHANGED: verifying -> escalated is not a legal transition; the verifying carve-out assumes it';
  END IF;
END
$pre$;

DO $latch$
DECLARE
  s text;
  n text;
  k integer;
  c_sig constant text := 'smarter_private.reliability_transition(uuid,text,text,jsonb)';
  c_old constant text :=
'         escalation_state = CASE WHEN p_to_status = ''escalated'' THEN ''escalated'' ELSE escalation_state END,';
  c_new constant text :=
'         -- CLEARED ON A TERMINAL STATUS (20261110224707). Escalation used to
         -- be a latch: set on the way in and never unset, so a recovered
         -- incident kept paging as AI AGENT NEEDED for ever. Only the two
         -- terminal statuses clear it. ''verifying'' must not, because
         -- verifying -> escalated is legal and verification can fail;
         -- ''stale_unverified'' must not, because that closure is explicitly
         -- unverified. escalation_reason is left as written and every
         -- transition stays in reliability_incident_events, so no history is
         -- lost.
         escalation_state = CASE WHEN p_to_status = ''escalated'' THEN ''escalated''
                                 WHEN p_to_status IN (''recovered'', ''closed'') THEN ''none''
                                 ELSE escalation_state END,';
BEGIN
  s := pg_get_functiondef(c_sig::regprocedure);
  k := (length(s) - length(replace(s, c_old, ''))) / length(c_old);
  IF k IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'RELIABILITY_TRANSITION_ANCHOR: escalation_state clause found % times; requalify before installing', k;
  END IF;
  n := replace(s, c_old, c_new);
  IF n = s THEN
    RAISE EXCEPTION 'RELIABILITY_TRANSITION_ANCHOR: escalation_state patch did not change the function';
  END IF;
  EXECUTE n;
END
$latch$;

-- Reconcile the two incidents whose recovery evidence is established, through
-- the supported transition only, and only while they are still 'recovered'.
DO $reconcile$
DECLARE
  v_ok boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM public.financial_alerts
                  WHERE id = '235060db-a5f9-4cda-afd3-3b4fac238d55' AND resolved IS TRUE)
    INTO v_ok;
  IF v_ok AND EXISTS (SELECT 1 FROM smarter_private.reliability_incidents
                       WHERE id = '38ae668f-352c-4ef3-80b8-d1f8931383fa' AND status = 'recovered') THEN
    PERFORM smarter_private.reliability_transition(
      '38ae668f-352c-4ef3-80b8-d1f8931383fa', 'closed',
      'recovery verified on the source financial alert; no coding agent is needed',
      jsonb_build_object('kind', 'reconciled',
        'basis', 'financial alert 235060db resolved: tournament 4b551d52 COMPLETED and committed exactly once, '
              || 'one terminal receipt settled 2026-11-10 18:39:50.676782+00, prize pool 386.00 conserved to the cent, '
              || 'bounty pool 345.00, escrow closed at zero. Existing receipt reused; no settlement replayed.',
        'by', '20261110224707'));
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.financial_alerts
                  WHERE id = 'ea0ae17c-f347-4e78-95a0-562a165e83de' AND resolved IS TRUE)
    INTO v_ok;
  IF v_ok AND EXISTS (SELECT 1 FROM smarter_private.reliability_incidents
                       WHERE id = 'a974b740-b4d4-4c50-9b92-b4b89a1730da' AND status = 'recovered') THEN
    PERFORM smarter_private.reliability_transition(
      'a974b740-b4d4-4c50-9b92-b4b89a1730da', 'closed',
      'recovery verified on the source financial alert; no coding agent is needed',
      jsonb_build_object('kind', 'reconciled',
        'basis', 'financial alert ea0ae17c resolved: the post-commit envelope for the hand has been applied and '
              || 'post_commit_completed_at is set. Classification corrected at source by 20261110224637.',
        'by', '20261110224707'));
  END IF;
END
$reconcile$;

DO $post$
BEGIN
  IF position('CLEARED ON A TERMINAL STATUS (20261110224707)' in
              pg_get_functiondef('smarter_private.reliability_transition(uuid,text,text,jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'RELIABILITY_TRANSITION_POSTIMAGE: the installed function is not the patched one';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM smarter_private.reliability_incidents
                  WHERE id = '78afb154-54ae-4661-bf7d-e5e3c18a6eb3' AND escalation_state = 'escalated') THEN
    RAISE EXCEPTION 'SPIN_INCIDENT_MUST_STAY_ESCALATED: 78afb154 was cleared, but the Spin fault is not verified fixed';
  END IF;
END
$post$;

COMMIT;
