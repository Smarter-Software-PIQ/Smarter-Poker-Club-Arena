\set ON_ERROR_STOP on
-- AFTER 20261112184950 (the migration file itself ran between these stages,
-- rewriting the installed bodies exactly as it rewrites production's).

CREATE OR REPLACE FUNCTION pg_temp.tr_bal(p_user uuid) RETURNS numeric LANGUAGE sql AS $$
  SELECT chip_balance FROM public.club_members
   WHERE club_id = '11111111-1111-1111-1111-111111111111' AND user_id = p_user $$;
CREATE OR REPLACE FUNCTION pg_temp.tr_legs(p_ticket uuid) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.chip_ledger WHERE from_entity_id = p_ticket $$;
CREATE OR REPLACE FUNCTION pg_temp.tr_as(p_user text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true) $$;

-- Installed bodies carry the fix and nothing else changed in them.
DO $$
BEGIN
  IF strpos(pg_get_functiondef('public.fn_cancel_tournament_ticket(uuid)'::regprocedure), '''escrow_release''') > 0
     OR strpos(pg_get_functiondef('public.fn_ca_settle_closed_cashier_entry_tickets(uuid,text)'::regprocedure), '''escrow_release''') > 0 THEN
    RAISE EXCEPTION 'FIXTURE: the migration left escrow_release in an issuer refund';
  END IF;
  RAISE NOTICE 'ok  installed both issuer refunds declare refund';
END $$;

-- B1 boundary: someone other than the issuer cannot cancel; nothing moves.
BEGIN;
SELECT pg_temp.tr_as('aaaaaaaa-0000-0000-0000-000000000002');
DO $$ DECLARE r jsonb := public.fn_cancel_tournament_ticket('7c000000-0000-4000-8000-000000000001');
BEGIN
  IF (r->>'success')::boolean OR r->>'error' <> 'Only The Issuer May Cancel A Ticket' THEN RAISE EXCEPTION 'FIXTURE: B1 %', r; END IF;
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;

-- B2 the Cancel button commits: issuer +35, ticket cancelled, one refund leg
-- from the ticket's escrow, no cashout-escrow leg, one receipt.
BEGIN;
SELECT pg_temp.tr_as('aaaaaaaa-0000-0000-0000-000000000001');
DO $$ DECLARE r jsonb := public.fn_cancel_tournament_ticket('7c000000-0000-4000-8000-000000000001');
BEGIN
  IF NOT (r->>'success')::boolean OR (r->>'replayed')::boolean OR (r->>'refunded')::numeric <> 35 THEN RAISE EXCEPTION 'FIXTURE: B2 %', r; END IF;
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;
DO $$
BEGIN
  IF pg_temp.tr_bal('aaaaaaaa-0000-0000-0000-000000000001')
       <> (SELECT chip_balance FROM tr_base WHERE user_id = 'aaaaaaaa-0000-0000-0000-000000000001' AND club_id = '11111111-1111-1111-1111-111111111111') + 35
     OR (SELECT status FROM public.tournament_tickets WHERE id = '7c000000-0000-4000-8000-000000000001') <> 'cancelled'
     OR (SELECT count(*) FROM public.chip_ledger
          WHERE from_type = 'escrow' AND from_entity_id = '7c000000-0000-4000-8000-000000000001'
            AND to_type = 'player_wallet' AND to_entity_id = 'aaaaaaaa-0000-0000-0000-000000000001'
            AND amount = 35 AND category = 'refund') <> 1
     OR pg_temp.tr_legs('7c000000-0000-4000-8000-000000000001') <> 1
     OR (SELECT count(*) FROM public.chip_transactions
          WHERE transaction_type = 'tournament_ticket_cancel' AND metadata->>'ticket_id' = '7c000000-0000-4000-8000-000000000001') <> 1 THEN
    RAISE EXCEPTION 'FIXTURE: B2 outcome differs';
  END IF;
  RAISE NOTICE 'ok  passes    B2 Cancel button: issuer +35, ticket cancelled, one refund leg from its escrow, one receipt';
END $$;

-- B3 replay is idempotent: same receipt, no money, no leg.
BEGIN;
SELECT pg_temp.tr_as('aaaaaaaa-0000-0000-0000-000000000001');
DO $$ DECLARE r jsonb := public.fn_cancel_tournament_ticket('7c000000-0000-4000-8000-000000000001');
BEGIN
  IF NOT (r->>'replayed')::boolean THEN RAISE EXCEPTION 'FIXTURE: B3 %', r; END IF;
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;
DO $$ BEGIN
  IF pg_temp.tr_legs('7c000000-0000-4000-8000-000000000001') <> 1
     OR (SELECT count(*) FROM public.chip_transactions WHERE transaction_type = 'tournament_ticket_cancel') <> 1 THEN
    RAISE EXCEPTION 'FIXTURE: B3 replay moved something'; END IF;
  RAISE NOTICE 'ok  passes    B3 replay returns the receipt and moves nothing';
END $$;

-- B4 invalid state: a redeemed ticket cannot be cancelled; nothing moves.
-- B5 recipient: an issuer who left the club gets nothing and the ticket stays escrowed.
-- B6 integrity: an issue receipt that disagrees with the ticket aborts before any write.
DO $$
DECLARE r jsonb; v_before numeric := pg_temp.tr_bal('aaaaaaaa-0000-0000-0000-000000000001'); v_state text;
BEGIN
  PERFORM pg_temp.tr_as('aaaaaaaa-0000-0000-0000-000000000001');
  r := public.fn_cancel_tournament_ticket('7c000000-0000-4000-8000-000000000004');
  IF (r->>'success')::boolean OR r->>'error' <> 'Ticket Already Redeemed' THEN RAISE EXCEPTION 'FIXTURE: B4 %', r; END IF;
  PERFORM pg_temp.tr_as('aaaaaaaa-0000-0000-0000-000000000003');
  r := public.fn_cancel_tournament_ticket('7c000000-0000-4000-8000-000000000005');
  IF (r->>'success')::boolean OR r->>'error' NOT LIKE 'You Are No Longer A Member%' THEN RAISE EXCEPTION 'FIXTURE: B5 %', r; END IF;
  PERFORM pg_temp.tr_as('aaaaaaaa-0000-0000-0000-000000000001');
  BEGIN
    r := public.fn_cancel_tournament_ticket('7c000000-0000-4000-8000-000000000006');
    RAISE EXCEPTION 'FIXTURE: B6 a mismatched receipt was accepted %', r;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    IF v_state <> '22023' THEN RAISE; END IF;
  END;
  SET CONSTRAINTS ALL IMMEDIATE;
  IF pg_temp.tr_bal('aaaaaaaa-0000-0000-0000-000000000001') <> v_before
     OR (SELECT string_agg(status, ',' ORDER BY id) FROM public.tournament_tickets
          WHERE id IN ('7c000000-0000-4000-8000-000000000004','7c000000-0000-4000-8000-000000000005','7c000000-0000-4000-8000-000000000006'))
        <> 'redeemed,issued,issued'
     OR pg_temp.tr_legs('7c000000-0000-4000-8000-000000000005') <> 0
     OR pg_temp.tr_legs('7c000000-0000-4000-8000-000000000006') <> 0 THEN
    RAISE EXCEPTION 'FIXTURE: B4-B6 moved something';
  END IF;
  RAISE NOTICE 'ok  passes    B4 redeemed / B5 departed issuer / B6 mismatched receipt: refused, nothing moved';
END $$;

-- B7 the closed-target issuer return commits inside the closing transaction.
-- B8 the holder path, unchanged, still pays the holder.
-- B9 settling the same targets again is a no-op.
BEGIN;
DO $$ DECLARE r1 jsonb; r2 jsonb;
BEGIN
  r1 := public.fn_ca_settle_closed_cashier_entry_tickets('5e000000-0000-4000-8000-0000000000a1', 'fixture');
  r2 := public.fn_ca_settle_closed_cashier_entry_tickets('5e000000-0000-4000-8000-0000000000a2', 'fixture');
  IF NOT (r1->>'ok')::boolean OR (r1->>'returned')::int <> 1 OR (r1->>'amount')::numeric <> 5
     OR NOT (r2->>'ok')::boolean OR (r2->>'paid')::int <> 1 OR (r2->>'amount')::numeric <> 7 THEN
    RAISE EXCEPTION 'FIXTURE: B7/B8 % %', r1, r2;
  END IF;
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;
BEGIN;
DO $$ DECLARE r jsonb;
BEGIN
  r := public.fn_ca_settle_closed_cashier_entry_tickets('5e000000-0000-4000-8000-0000000000a1', 'fixture');
  IF (r->>'returned')::int <> 0 OR (r->>'paid')::int <> 0 THEN RAISE EXCEPTION 'FIXTURE: B9 %', r; END IF;
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.chip_ledger WHERE from_entity_id = '7c000000-0000-4000-8000-000000000002'
        AND to_entity_id = 'aaaaaaaa-0000-0000-0000-000000000001' AND amount = 5 AND category = 'refund') <> 1
     OR pg_temp.tr_legs('7c000000-0000-4000-8000-000000000002') <> 1
     OR (SELECT count(*) FROM public.chip_ledger WHERE from_entity_id = '7c000000-0000-4000-8000-000000000003'
        AND to_entity_id = 'aaaaaaaa-0000-0000-0000-000000000002' AND amount = 7 AND category = 'ticket_redeem') <> 1
     OR pg_temp.tr_legs('7c000000-0000-4000-8000-000000000003') <> 1
     OR pg_temp.tr_bal('aaaaaaaa-0000-0000-0000-000000000001')
          <> (SELECT chip_balance FROM tr_base WHERE user_id = 'aaaaaaaa-0000-0000-0000-000000000001' AND club_id = '11111111-1111-1111-1111-111111111111') + 35 + 5
     OR pg_temp.tr_bal('aaaaaaaa-0000-0000-0000-000000000002')
          <> (SELECT chip_balance FROM tr_base WHERE user_id = 'aaaaaaaa-0000-0000-0000-000000000002' AND club_id = '11111111-1111-1111-1111-111111111111') + 7
     OR EXISTS (SELECT 1 FROM public.financial_alerts)
     OR EXISTS (SELECT 1 FROM public.chip_ledger WHERE category = 'escrow_release' AND from_entity_id::text LIKE '7c000000-%') THEN
    RAISE EXCEPTION 'FIXTURE: B7-B9 outcome differs';
  END IF;
  RAISE NOTICE 'ok  passes    B7 closed-target issuer return +5 refund leg / B8 holder paid 7 / B9 second settle moves nothing; no alert';
END $$;
