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
-- Pinned by tests/a-cancelled-ticket-refund-books-to-ticket-escrow.law.test.ts.
--
-- @live-proof: (SELECT strpos(pg_get_functiondef('public.fn_cancel_tournament_ticket(uuid)'::regprocedure), '''escrow_release''') = 0 AND strpos(pg_get_functiondef('public.fn_cancel_tournament_ticket(uuid)'::regprocedure), 'PERFORM set_config(''app.ledger_category'',''refund'',true);') > 0 AND strpos(pg_get_functiondef('public.fn_ca_settle_closed_cashier_entry_tickets(uuid,text)'::regprocedure), '''escrow_release''') = 0 AND strpos(pg_get_functiondef('public.fn_ca_settle_closed_cashier_entry_tickets(uuid,text)'::regprocedure), 'PERFORM set_config(''app.ledger_category'',''refund'',true);') > 0 AND public.fn_ca_ledger_tally_key('escrow', NULL, NULL) = 'ticket_escrow')

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

COMMIT;
