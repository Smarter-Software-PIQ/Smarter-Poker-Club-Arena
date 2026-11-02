-- Owner-authorized exact-event correction, November 2, 2026.
-- Append ROLLBACK for mandatory probe; COMMIT only after source installation.
-- Keeps the 5000 combined guarantee, 950 bounties and 380 rake unchanged.
-- Reuses the existing reversal journal, escrow primitive and original bank.
-- Fails closed if any place has been prepared, paid or cached.
-- Requires combined-guarantee source installed before use. Never changes triggers.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='8s';
DO $correction$
DECLARE
 t constant uuid := '6b72abc3-bd16-488c-aea5-54b1eace98d5';
 bank constant uuid := 'fade0000-0000-0000-0000-000000000001';
 k constant text := 'tourney:6b72abc3-bd16-488c-aea5-54b1eace98d5:owner_bounty_guarantee_20261102';
 tr public.tournaments%ROWTYPE; er public.tournament_escrow%ROWTYPE;
 receipt public.tournament_entry_close_receipts%ROWTYPE;
 before_bank numeric; after_bank numeric; leg uuid; prior_skip text;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261102043648') THEN
   RAISE EXCEPTION 'combined guarantee source must be installed before correction';
 END IF;
 PERFORM public.fn_ca_lock_settlement_lane_for_tournament(t);
 SELECT * INTO STRICT tr FROM public.tournaments WHERE id=t FOR UPDATE;
 SELECT * INTO STRICT er FROM public.tournament_escrow WHERE tournament_id=t FOR UPDATE;
 SELECT * INTO STRICT receipt FROM public.tournament_entry_close_receipts WHERE tournament_id=t FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.chip_ledger WHERE idempotency_key=k) THEN
   IF tr.prize_pool<>4050 OR tr.bounty_pool<>950 OR er.overlay_in<>1580 OR receipt.final_prize_pool<>4050 THEN
     RAISE EXCEPTION 'existing correction receipt conflicts with current state';
   END IF;
   RETURN;
 END IF;
 IF tr.status IS DISTINCT FROM 'RUNNING' OR tr.prize_pool IS DISTINCT FROM 5000::numeric
   OR tr.guaranteed_prize IS DISTINCT FROM 5000::numeric OR tr.bounty_pool IS DISTINCT FROM 950::numeric
   OR tr.buy_in_amount IS DISTINCT FROM 36::numeric OR tr.buy_in_fee IS DISTINCT FROM 4::numeric
   OR tr.bounty_amount IS DISTINCT FROM 10::numeric OR tr.total_rake IS DISTINCT FROM 380::numeric
   OR tr.prize_pool_finalized IS DISTINCT FROM true OR receipt.final_prize_pool IS DISTINCT FROM 5000::numeric
   OR receipt.reprice_completed_at IS NULL THEN RAISE EXCEPTION 'event terms or close receipt changed'; END IF;
 IF (SELECT count(*) FROM public.tournament_players WHERE tournament_id=t)<>95
   OR EXISTS(SELECT 1 FROM public.tournament_players WHERE tournament_id=t AND
     (coalesce(prize,0)<>0 OR coalesce(rebuys,0)<>0 OR coalesce(add_on,false)))
   THEN RAISE EXCEPTION 'field or cached place prizes changed'; END IF;
 IF EXISTS(SELECT 1 FROM public.tournament_place_settlement_batches WHERE tournament_id=t)
   OR EXISTS(SELECT 1 FROM public.tournament_satellite_settlement_batches WHERE tournament_id=t)
   OR EXISTS(SELECT 1 FROM public.tournament_final_table_deal_batches WHERE tournament_id=t)
   OR EXISTS(SELECT 1 FROM public.tournament_terminal_settlements WHERE tournament_id=t)
   OR EXISTS(SELECT 1 FROM public.tournament_cancellation_receipts WHERE tournament_id=t)
   OR EXISTS(SELECT 1 FROM public.tournament_obligations WHERE tournament_id=t AND kind IN('place','bubble_protection','final_table_deal','late_reg_adjustment'))
   OR EXISTS(SELECT 1 FROM public.tournament_payouts p WHERE p.tournament_id=t AND
     (p.source IN('structure','reconcile','hu_shortfall','late_reg_adjustment','clawback','spin_backpay','overlay_backpay','final_table_deal')
       OR public.fn_tournament_payout_key_is_place_evidence(t,p.idempotency_key)))
   THEN RAISE EXCEPTION 'prepared, paid, terminal or cancellation evidence prevents correction'; END IF;
 IF er.enforced IS DISTINCT FROM true OR er.overlay_in IS DISTINCT FROM 2530::numeric
   OR er.prize_balance IS DISTINCT FROM 5000::numeric OR er.prize_out<>0 OR er.refund_prize<>0
   OR er.refund_bounty<>0 OR er.closed_at IS NOT NULL OR er.terminal_closed_at IS NOT NULL
   OR er.gross_in-er.fee_entries_in+er.satellite_in<>3420 OR er.bounty_in<>950
   OR er.fee_balance<>380 THEN RAISE EXCEPTION 'escrow conservation precondition changed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.chip_ledger WHERE id='579ab0ec-a7c8-4752-b65f-2544415918c0'
   AND tournament_id=t AND category='overlay' AND amount=4896 AND from_type='union_bank'
   AND from_entity_id=bank AND to_type='prize_liability' AND to_entity_id=t)
   OR NOT EXISTS(SELECT 1 FROM public.chip_ledger WHERE id='dec229a8-7753-4a20-b3c4-5efa1eacae43'
   AND tournament_id=t AND category='reversal' AND amount=2366 AND to_type='union_bank' AND to_entity_id=bank)
   THEN RAISE EXCEPTION 'original overlay source proof changed'; END IF;
 SELECT chip_balance INTO STRICT before_bank FROM public.union_wallets WHERE union_id=bank FOR UPDATE;
 prior_skip := current_setting('app.ledger_autoskip_union_wallets',true);
 PERFORM set_config('app.ledger_autoskip_union_wallets','1',true);
 UPDATE public.union_wallets SET chip_balance=chip_balance+950,updated_at=now() WHERE union_id=bank RETURNING chip_balance INTO after_bank;
 PERFORM set_config('app.ledger_autoskip_union_wallets',coalesce(prior_skip,'0'),true);
 IF after_bank IS DISTINCT FROM before_bank+950 THEN RAISE EXCEPTION 'bank credit mismatch'; END IF;
 INSERT INTO public.chip_ledger(performed_by,from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id,tournament_id,description,idempotency_key,metadata)
 VALUES('2d1cd6c3-5700-4af9-a271-d4863fdab20d','prize_liability',t,'union_bank',bank,950,'reversal',tr.club_id,t,
   'Owner-authorized combined 5000 guarantee: return excess overlay; 4050 place prizes plus 950 bounties',k,
   jsonb_build_object('kind','owner_bounty_guarantee_correction','owner_instruction','go through and manually change the payout to the corrected 5000 prize pool and pay the overlay',
    'original_overlay_ledger_id','579ab0ec-a7c8-4752-b65f-2544415918c0','pool_before',5000,'pool_after',4050,
    'overlay_before',2530,'overlay_after',1580,'bounty_pool',950,'rake',380,
    'source_balance_before',before_bank,'source_balance_after',after_bank,'entry_close_before',to_jsonb(receipt))) RETURNING id INTO leg;
 PERFORM public.fn_ca_escrow_apply(t,'owner combined bounty guarantee correction',p_overlay_in=>-950);
 UPDATE public.tournament_entry_close_receipts SET final_prize_pool=4050,updated_at=now() WHERE tournament_id=t;
 UPDATE public.tournaments SET prize_pool=4050 WHERE id=t;
 IF NOT EXISTS(SELECT 1 FROM public.tournament_escrow e WHERE tournament_id=t AND prize_balance=4050 AND overlay_in=1580
   AND (to_jsonb(e)-ARRAY['overlay_in','prize_balance','updated_at'])=(to_jsonb(er)-ARRAY['overlay_in','prize_balance','updated_at']))
   OR NOT EXISTS(SELECT 1 FROM public.tournaments x WHERE id=t AND prize_pool=4050
   AND (to_jsonb(x)-'prize_pool')=(to_jsonb(tr)-'prize_pool'))
   THEN RAISE EXCEPTION 'postcondition changed unrelated tournament or escrow values'; END IF;
 RAISE NOTICE 'corrected ledger %, total 5000, retained overlay 1580, source credit 950',leg;
END;
$correction$;
