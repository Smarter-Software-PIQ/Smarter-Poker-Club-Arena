\set ON_ERROR_STOP on
-- BEFORE 20261112184950: the live issuer-refund bodies are refused at commit.
UPDATE public.ca_ledger_invariant_mode SET mode = 'refuse', reason = 'fixture: ticket refund cases';
CREATE TEMP TABLE tr_base AS SELECT club_id, user_id, chip_balance FROM public.club_members;

-- Seed: every issued ticket enters escrow with its own leg in its own
-- transaction, and the cancel path's issue receipt exists exactly as the
-- cashier writes it.
--   T1 35.00 issuer A1 holder A2   (Cancel button)
--   T2  5.00 issuer A1 holder A3   bound to closed target X1, holder departed
--   T3  7.00 issuer A1 holder A2   bound to closed target X2, holder active
--   T4 11.00 issuer A1 holder A2   redeemed already (invalid-state boundary)
--   T5  3.00 issuer A3 holder A2   issuer departed (recipient boundary)
--   T6  9.00 issuer A1 holder A2   issue receipt disagrees with the ticket
BEGIN;
INSERT INTO public.tournament_tickets (id, club_id, issued_by, holder_id, value, status) VALUES
 ('7c000000-0000-4000-8000-000000000001','11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000002',35,'issued'),
 ('7c000000-0000-4000-8000-000000000002','11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000003', 5,'issued'),
 ('7c000000-0000-4000-8000-000000000003','11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000002', 7,'issued'),
 ('7c000000-0000-4000-8000-000000000004','11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000002',11,'issued'),
 ('7c000000-0000-4000-8000-000000000005','11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000002', 3,'issued'),
 ('7c000000-0000-4000-8000-000000000006','11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000002', 9,'issued');
INSERT INTO public.chip_ledger (from_type, to_type, to_entity_id, amount, category, club_id)
SELECT 'system_mint', 'escrow', id, value, 'ticket_issue', club_id
  FROM public.tournament_tickets WHERE id::text LIKE '7c000000-%';
INSERT INTO public.chip_transactions (club_id, from_user_id, to_user_id, amount, transaction_type, metadata)
SELECT club_id, issued_by, holder_id,
       CASE WHEN id = '7c000000-0000-4000-8000-000000000006' THEN value + 1 ELSE value END,
       'tournament_ticket_issue',
       jsonb_build_object('ticket_id', id, 'escrow_entity_id', id)
  FROM public.tournament_tickets WHERE id::text LIKE '7c000000-%';
INSERT INTO public.tournament_ticket_entry_targets VALUES
 ('7c000000-0000-4000-8000-000000000002','5e000000-0000-4000-8000-0000000000a1'),
 ('7c000000-0000-4000-8000-000000000003','5e000000-0000-4000-8000-0000000000a2');
SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;
-- T4 is redeemed through its own balanced leg.
BEGIN;
UPDATE public.tournament_tickets SET status = 'redeemed', redeemed_at = now()
 WHERE id = '7c000000-0000-4000-8000-000000000004';
INSERT INTO public.chip_ledger (from_type, from_entity_id, to_type, amount, category, club_id)
VALUES ('escrow','7c000000-0000-4000-8000-000000000004','system_burn',11,'ticket_redeem','11111111-1111-1111-1111-111111111111');
SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;

CREATE OR REPLACE FUNCTION pg_temp.tr_refused(p_case text, p_sql text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_msg text; v_state text;
BEGIN
  BEGIN
    EXECUTE p_sql;
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'FIXTURE: % committed and was supposed to be refused', p_case USING ERRCODE = 'P9999';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    IF v_state = 'P9999' THEN RAISE; END IF;
    IF v_state <> '23514' OR v_msg NOT LIKE 'REFUSED: balance_moved_without_its_ledger_row account=%' THEN
      RAISE EXCEPTION 'FIXTURE: % was refused for the wrong reason: [%] %', p_case, v_state, v_msg;
    END IF;
    RAISE NOTICE 'ok  refused   %: %', p_case, v_msg;
    RETURN v_msg;
  END;
END $$;

-- The incident, reproduced on the real body: the issuer's Cancel is refused at
-- commit, on the ticket float or the misattributed cashout account it booked.
DO $$
DECLARE v text;
BEGIN
  v := pg_temp.tr_refused('PRE-FIX Cancel button (incident 16ef8334 shape)',
    $q$ SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
        SELECT public.fn_cancel_tournament_ticket('7c000000-0000-4000-8000-000000000001') $q$);
  IF v NOT LIKE '%account=ticket_escrow %' AND v NOT LIKE '%account=cashout_escrow:7c000000-0000-4000-8000-000000000001 %' THEN
    RAISE EXCEPTION 'FIXTURE: pre-fix cancel refused on an unexpected account: %', v;
  END IF;
  -- The closed-target issuer return is refused at COMMIT, past its own
  -- per-ticket handler, so the whole transaction that closes the tournament
  -- would roll back with it.
  v := pg_temp.tr_refused('PRE-FIX closed-target issuer return takes the closing transaction with it',
    $q$ SELECT public.fn_ca_settle_closed_cashier_entry_tickets('5e000000-0000-4000-8000-0000000000a1', 'fixture') $q$);
END $$;

DO $$
BEGIN
  IF (SELECT status FROM public.tournament_tickets WHERE id = '7c000000-0000-4000-8000-000000000001') <> 'issued'
     OR (SELECT status FROM public.tournament_tickets WHERE id = '7c000000-0000-4000-8000-000000000002') <> 'issued'
     OR EXISTS (SELECT 1 FROM public.club_members m JOIN tr_base b USING (club_id, user_id) WHERE m.chip_balance <> b.chip_balance)
     OR EXISTS (SELECT 1 FROM public.chip_transactions WHERE transaction_type = 'tournament_ticket_cancel')
     OR EXISTS (SELECT 1 FROM public.chip_ledger WHERE category = 'escrow_release' AND from_entity_id::text LIKE '7c000000-%') THEN
    RAISE EXCEPTION 'FIXTURE: a refused pre-fix refund left something behind';
  END IF;
  RAISE NOTICE 'ok  rollback  both refused refunds left tickets, wallet, receipts and journal untouched';
END $$;
