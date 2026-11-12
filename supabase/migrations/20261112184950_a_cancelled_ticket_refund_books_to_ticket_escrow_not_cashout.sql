-- 20261112184950_a_cancelled_ticket_refund_books_to_ticket_escrow_not_cashout.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- A CANCELLED TICKET'S REFUND IS A TICKET-ESCROW LEG, NOT A CASHOUT-ESCROW LEG.
--
-- Incidents 9aaed91e (-5.00 chip drift: ledger_imbalance) and 496bda61
-- (ledger_invariant.refused), drift incident 16ef8334, 2026-11-12 18:40 UTC.
--
-- Two places return an issued ticket's escrow to its ISSUER:
--   public.fn_cancel_tournament_ticket(uuid)                    the Cancel button
--   public.fn_ca_settle_closed_cashier_entry_tickets(uuid,text) the issuer branch,
--     when a cashier entry ticket's one target closes and its holder is no
--     longer an active member
-- Both set app.ledger_category = 'escrow_release' with counterparty 'escrow'
-- and the ticket id as the entity. The ledger tally
-- (public.fn_ca_tally_ledger_leg) and the trial balance
-- (public.fn_ca_trial_balance) both read an 'escrow' leg whose category is
-- escrow_hold or escrow_release as CASHOUT custody ('cashout_escrow:<id>'),
-- because that is the cashout queue's pair of categories
-- (fn_cashier_cashout_transition). So the -value leg was booked to
-- cashout_escrow:<ticket id>, which holds nothing, while the ticket's status
-- change took value out of 'ticket_escrow' (fn_ca_ticket_escrow_float) with no
-- leg there. The ledger invariant (zz_ca_store_has_its_ledger_row) refuses
-- that transaction at commit: balance_moved_without_its_ledger_row
-- account=ticket_escrow balance_delta=-value ledger_net=0.
--
-- In practice: no ticket has ever been cancelled. chip_transactions holds no
-- 'tournament_ticket_cancel' row at all, and every one of the four
-- ticket_escrow refusals on record (2026-10-12 .. 2026-11-12) came from an
-- agent probe through the management API (application mgmt-api), the last
-- two being today's incident (a DO $probe$ calling fn_cancel_tournament_ticket
-- on a live 35.00 Cashier Ticket, and a hand-written 5.00 issue). Every one
-- was rolled back by the invariant. No balance moved, nobody is owed, and
-- nothing is settled here (CLAUDE.md 10.9: there is no damage to settle).
--
-- THE FIX AT THE ROOT (10.11 / 10.12): the issuer refund declares category
-- 'refund'. 'refund' is an allowed chip_ledger category, carries no
-- cashout-escrow meaning anywhere, and an 'escrow' leg under it resolves to
-- 'ticket_escrow' in both the tally and the trial balance, exactly as the
-- issue ('ticket_issue') and the holder release ('ticket_redeem') already do.
-- Its other readers agree: fn_sp_digest_player_totals counts it as refunded
-- to the issuer (true), fn_ca_funded_chip_return_journal ignores it (escrow is
-- not a non-circulating store), and horse_refund_parity reads only legs with a
-- tournament (these have none). Nothing else changes in either function.
--
-- LANDING ORDER. #10620 (promo cashier tickets) and #10622 (alerts lane) fix
-- the same doors. A function another lane already rid of escrow_release is
-- left unchanged (a NOTICE names it); only a body that still carries the line
-- is rewritten, so whichever lands first, the settler's issuer return is not
-- left behind.
--
-- Pinned by tests/a-cancelled-ticket-refund-books-to-ticket-escrow.law.test.ts.
--
-- @live-proof: (SELECT strpos(pg_get_functiondef('public.fn_cancel_tournament_ticket(uuid)'::regprocedure), '''escrow_release''') = 0 AND strpos(pg_get_functiondef('public.fn_ca_settle_closed_cashier_entry_tickets(uuid,text)'::regprocedure), '''escrow_release''') = 0 AND public.fn_ca_ledger_tally_key('escrow', NULL, NULL) = 'ticket_escrow')

BEGIN;
SET LOCAL lock_timeout = '2s';

DO $fix$
DECLARE
  c_old constant text := E'PERFORM set_config(''app.ledger_category'',''escrow_release'',true);';
  c_new constant text := E'PERFORM set_config(''app.ledger_category'',''refund'',true);';
  v_fn regprocedure;
  v_def text;
  v_after text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.fn_cancel_tournament_ticket(uuid)'::regprocedure,
    'public.fn_ca_settle_closed_cashier_entry_tickets(uuid,text)'::regprocedure]
  LOOP
    v_def := pg_get_functiondef(v_fn);
    -- Another lane may have removed escrow_release from this function first
    -- (#10620 rewrites the Cancel door, #10622 both doors). Any category other
    -- than the cashout pair already lands on ticket_escrow, so that function is
    -- left exactly as it is; this file never rewrites another lane's choice.
    IF strpos(v_def, '''escrow_release''') = 0 THEN
      RAISE NOTICE 'TICKET_ESCROW_CATEGORY: % already declares no escrow_release; left unchanged', v_fn;
      CONTINUE;
    END IF;
    -- Exactly one issuer-refund category line, and no other escrow_release in
    -- the body: anything else means the function moved under us; stop.
    IF (length(v_def) - length(replace(v_def, c_old, ''))) / length(c_old) <> 1
       OR (length(v_def) - length(replace(v_def, '''escrow_release''', ''))) / length('''escrow_release''') <> 1 THEN
      RAISE EXCEPTION 'TICKET_ESCROW_CATEGORY_ANCHOR: % does not hold exactly one issuer-refund escrow_release line', v_fn;
    END IF;
    v_after := replace(v_def, c_old, c_new);
    EXECUTE v_after;
    IF strpos(pg_get_functiondef(v_fn), '''escrow_release''') > 0
       OR strpos(pg_get_functiondef(v_fn), c_new) = 0 THEN
      RAISE EXCEPTION 'TICKET_ESCROW_CATEGORY_NOT_INSTALLED: %', v_fn;
    END IF;
  END LOOP;

  -- The account the refund now books to.
  IF public.fn_ca_ledger_tally_key('escrow', NULL, NULL) IS DISTINCT FROM 'ticket_escrow' THEN
    RAISE EXCEPTION 'TICKET_ESCROW_TALLY_KEY: an escrow leg outside escrow_hold/escrow_release no longer resolves to ticket_escrow';
  END IF;
END
$fix$;


-- THE INCIDENT CLOSES THROUGH ITS OWN LIFECYCLE, ON EVIDENCE, NEVER BY FORCE.
-- Drift incident 16ef8334 (its reliability incidents 9aaed91e and 496bda61
-- and inbox rows 377197..377201 follow it through
-- zz_ca_incident_resolution_reaches_the_alerts) is resolved with
-- fn_ca_incident_action only when, in this transaction: both doors above carry
-- no escrow_release, the incident is still open, and every refusal filed on it
-- is a transaction PostgreSQL reports aborted. Otherwise it is left open with a
-- NOTICE and this file still installs. Absent in a fixture: skipped.
DO $close$
DECLARE
  c_incident constant uuid := '16ef8334-8673-475e-b375-45b0589b36f6';
  v_open boolean;
  v_refusals integer;
  v_aborted integer;
  v_result jsonb;
BEGIN
  IF to_regclass('public.ca_ledger_invariant_refusals') IS NULL
     OR to_regclass('public.ca_drift_incidents') IS NULL
     OR to_regprocedure('public.fn_ca_incident_action(uuid,text,text,uuid,text,text)') IS NULL THEN
    RAISE NOTICE 'TICKET_ESCROW_INCIDENT: no incident lifecycle here; skipped';
    RETURN;
  END IF;
  SELECT resolved_at IS NULL INTO v_open FROM public.ca_drift_incidents WHERE id = c_incident;
  IF v_open IS NOT TRUE THEN
    RAISE NOTICE 'TICKET_ESCROW_INCIDENT: % absent or already resolved; left as it is', c_incident;
    RETURN;
  END IF;
  IF strpos(pg_get_functiondef('public.fn_cancel_tournament_ticket(uuid)'::regprocedure), '''escrow_release''') > 0
     OR strpos(pg_get_functiondef('public.fn_ca_settle_closed_cashier_entry_tickets(uuid,text)'::regprocedure), '''escrow_release''') > 0 THEN
    RAISE NOTICE 'TICKET_ESCROW_INCIDENT: a door still declares escrow_release; % left open', c_incident;
    RETURN;
  END IF;
  SELECT count(*), count(*) FILTER (WHERE txid_status(r.txid::bigint) = 'aborted')
    INTO v_refusals, v_aborted
    FROM public.ca_ledger_invariant_refusals r
   WHERE r.incident_id = c_incident;
  IF v_refusals = 0 OR v_aborted <> v_refusals THEN
    RAISE NOTICE 'TICKET_ESCROW_INCIDENT: % of % refusals on % read aborted; left open', v_aborted, v_refusals, c_incident;
    RETURN;
  END IF;
  v_result := public.fn_ca_incident_action(
    c_incident, 'resolve',
    format('Verified at install: both issuer-refund doors now declare category refund (resolves to ticket_escrow); every one of the %s refusals filed on this incident (counters 69 and 70: management-API probes, 18:40:12 and 18:41:46 UTC 2026-11-12) is a transaction PostgreSQL reports aborted, so no balance or journal row persisted. Executed proof: scripts/dev/test-ledger-invariant.sh, stage ticket-refund-*.', v_refusals),
    NULL,
    'fn_cancel_tournament_ticket and the issuer-return branch of fn_ca_settle_closed_cashier_entry_tickets declared ledger category escrow_release, which fn_ca_tally_ledger_leg (since 20261006140948) books to cashout_escrow:<ticket>, so the ticket float moved with no ticket_escrow leg and the commit check refused every issuer refund. The two refusals were probes that exposed it.',
    'PR #10621, migration 20261112184950');
  IF (v_result->>'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'TICKET_ESCROW_INCIDENT: the lifecycle refused the resolution: %', v_result;
  END IF;
END
$close$;

COMMIT;
