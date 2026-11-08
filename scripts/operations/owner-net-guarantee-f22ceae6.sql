-- Exact owner-authorized correction of the 88-chip net guarantee shortfall.
-- Run the entire file with ROLLBACK first; commit only the installed protected source.
-- Paid awards and obligations are retained; remaining place weights share the
-- corrected remaining pool. No player wallet is edited or existing prize taken back.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='8s';
DO $correction$
DECLARE
 t constant uuid:='f22ceae6-2850-40ef-8f97-7d3660be32a3';
 bank constant uuid:='fade0000-0000-0000-0000-000000000001';
 k constant text:='tourney:f22ceae6-2850-40ef-8f97-7d3660be32a3:owner_net_guarantee_88';
 tr public.tournaments%ROWTYPE; er public.tournament_escrow%ROWTYPE;
 cr public.tournament_entry_close_receipts%ROWTYPE;
 paid jsonb; obligations jsonb; roster jsonb; paid_total numeric;
 weights jsonb; ladder jsonb; structure jsonb; after_row jsonb;
 before_bank numeric; after_bank numeric; prev text; funding jsonb;
BEGIN
 PERFORM public.fn_ca_lock_settlement_lane_for_tournament(t);
 SELECT * INTO STRICT tr FROM public.tournaments WHERE id=t FOR UPDATE;
 SELECT * INTO STRICT er FROM public.tournament_escrow WHERE tournament_id=t FOR UPDATE;
 SELECT * INTO STRICT cr FROM public.tournament_entry_close_receipts WHERE tournament_id=t FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.chip_ledger WHERE idempotency_key=k) THEN
   IF tr.prize_pool<>1830 OR tr.bounty_pool<>670 OR cr.final_prize_pool<>1830 THEN
     RAISE EXCEPTION 'existing 88-chip receipt conflicts with pool'; END IF;
   RETURN;
 END IF;
 funding:=public.fn_ca_guarantee_funding(t);
 IF tr.status<>'RUNNING' OR tr.prize_pool<>1742 OR tr.bounty_pool<>670
   OR tr.guaranteed_prize<>2500 OR tr.total_rake<>268 OR NOT tr.prize_pool_finalized
   OR tr.union_id<>bank OR tr.club_id<>bank OR cr.final_prize_pool<>1742
   OR cr.reprice_completed_at IS NULL OR (funding->>'net_coverage')::numeric<>2412
   OR (funding->>'house_due')::numeric<>88 OR (funding->>'house_posted')::numeric<>0
   OR tr.payout_math_version<>1 OR public.fn_ca_tournament_unit_cents(t)<>1
   OR coalesce(tr.bubble_protection,false)
 THEN RAISE EXCEPTION '88-chip event terms, funding or close receipt changed'; END IF;
 PERFORM 1 FROM public.tournament_players WHERE tournament_id=t ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.tournament_payouts WHERE tournament_id=t ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.tournament_obligations WHERE tournament_id=t ORDER BY id FOR UPDATE;
 SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') INTO paid FROM public.tournament_payouts p WHERE tournament_id=t;
 SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY id),'[]') INTO obligations FROM public.tournament_obligations o WHERE tournament_id=t;
 SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') INTO roster FROM public.tournament_players p WHERE tournament_id=t;
 IF (SELECT count(*) FROM public.tournament_players WHERE tournament_id=t)<>67
 OR EXISTS(SELECT 1 FROM public.tournament_place_settlement_batches WHERE tournament_id=t)
 OR EXISTS(SELECT 1 FROM public.tournament_final_table_deal_batches WHERE tournament_id=t)
 OR EXISTS(SELECT 1 FROM public.tournament_terminal_settlements WHERE tournament_id=t)
 OR EXISTS(SELECT 1 FROM public.tournament_cancellation_receipts WHERE tournament_id=t)
 OR EXISTS(SELECT 1 FROM public.tournament_payouts WHERE tournament_id=t AND
    (source<>'structure' OR paid_at IS NULL OR position NOT BETWEEN 1 AND 11))
 OR EXISTS(SELECT position FROM public.tournament_payouts WHERE tournament_id=t GROUP BY position HAVING count(*)<>1)
 OR EXISTS(SELECT 1 FROM public.tournament_obligations o WHERE tournament_id=t AND
    (kind NOT IN ('place','bounty') OR settled_at IS NULL OR amount_owed<>amount_paid OR (kind='place' AND NOT EXISTS(
      SELECT 1 FROM public.tournament_payouts p WHERE p.tournament_id=t AND p.user_id=o.user_id
       AND p.position=o.place AND p.amount=o.amount_paid AND p.paid_at IS NOT NULL))))
 THEN RAISE EXCEPTION 'unsettled, adjusted or terminal awards prevent correction'; END IF;
 SELECT coalesce(sum(amount),0) INTO paid_total FROM public.tournament_payouts WHERE tournament_id=t;
 IF paid_total>=1742 OR er.enforced IS DISTINCT FROM true OR er.prize_balance<>1742-paid_total
   OR er.prize_out<>paid_total OR er.closed_at IS NOT NULL OR er.terminal_closed_at IS NOT NULL
   OR er.refund_prize<>0 OR er.refund_bounty<>0 THEN RAISE EXCEPTION 'escrow or paid awards changed'; END IF;
 SELECT jsonb_agg(jsonb_build_object('place',(e->>'place')::integer,'bp',round((e->>'percentage')::numeric*100)::bigint) ORDER BY (e->>'place')::integer)
 INTO weights FROM jsonb_array_elements(tr.payout_structure::jsonb)e
 WHERE NOT EXISTS(SELECT 1 FROM public.tournament_payouts p WHERE p.tournament_id=t AND p.position=(e->>'place')::integer);
 SELECT jsonb_agg(jsonb_build_object('place',place,'amount',amount) ORDER BY place) INTO ladder FROM (
   SELECT l.place,l.cents::numeric/100 amount FROM public.fn_ca_prize_ladder(round((1830-paid_total)*100)::bigint,weights,1)l
   UNION ALL SELECT p.position,p.amount FROM public.tournament_payouts p WHERE tournament_id=t
 )x;
 IF jsonb_array_length(ladder)<>11 OR (SELECT sum((e->>'amount')::numeric) FROM jsonb_array_elements(ladder)e)<>1830 THEN
   RAISE EXCEPTION 'corrected ladder does not conserve the funded pool'; END IF;
 SELECT jsonb_agg(jsonb_build_object('place',(e->>'place')::integer,'percentage',(e->>'amount')::numeric) ORDER BY (e->>'place')::integer)
 INTO structure FROM jsonb_array_elements(ladder)e;
 after_row:=to_jsonb(tr)||jsonb_build_object('prize_pool',1830,'payout_structure',structure::text);
 SELECT promo_wallet INTO STRICT before_bank FROM public.union_wallets WHERE union_id=bank FOR UPDATE;
 IF before_bank<88 THEN RAISE EXCEPTION 'union promo balance insufficient'; END IF;
 prev:=current_setting('app.ledger_autoskip_union_wallets',true);
 PERFORM set_config('app.ledger_autoskip_union_wallets','1',true);
 UPDATE public.union_wallets SET promo_wallet=promo_wallet-88,updated_at=now() WHERE union_id=bank RETURNING promo_wallet INTO after_bank;
 PERFORM set_config('app.ledger_autoskip_union_wallets',coalesce(prev,''),true);
 INSERT INTO public.chip_ledger(performed_by,from_type,from_entity_id,from_label,to_type,to_entity_id,to_label,amount,category,club_id,tournament_id,idempotency_key,description,metadata)
 VALUES('2d1cd6c3-5700-4af9-a271-d4863fdab20d','union_wallet',bank,'union_wallets.promo_wallet',
   'prize_liability',t,'tournament_escrow.prize_balance',88,'promo_send',tr.club_id,t,k,
   'Owner Authorized 88 Chip Net Guarantee Funding From Union Promo',
   jsonb_build_object('kind','owner_net_guarantee_88','prize_part',88,'bounty_part',0,
     'tournament_before',to_jsonb(tr),'tournament_after',after_row,'entry_close_before',to_jsonb(cr),
     'paid_before',paid,'obligations_before',obligations,'corrected_ladder',ladder,
     'source_balance_before',before_bank,'source_balance_after',after_bank));
 PERFORM public.fn_ca_escrow_apply(t,'Owner 88 chip net guarantee',p_gross_in=>88);
 UPDATE public.tournament_entry_close_receipts SET final_prize_pool=1830,payout_structure_snapshot=structure,updated_at=now() WHERE tournament_id=t;
 PERFORM set_config('app.owner_net_guarantee_correction',k,true);
 UPDATE public.tournaments SET prize_pool=1830,payout_structure=structure::text WHERE id=t;
 PERFORM set_config('app.owner_net_guarantee_correction','',true);
 IF after_bank<>before_bank-88 OR (SELECT prize_balance FROM public.tournament_escrow WHERE tournament_id=t)<>er.prize_balance+88
   OR (public.fn_ca_guarantee_funding(t)->>'house_due')::numeric<>0
   OR paid IS DISTINCT FROM (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') FROM public.tournament_payouts p WHERE tournament_id=t)
   OR obligations IS DISTINCT FROM (SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY id),'[]') FROM public.tournament_obligations o WHERE tournament_id=t)
   OR roster IS DISTINCT FROM (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') FROM public.tournament_players p WHERE tournament_id=t)
   OR (SELECT jsonb_agg(jsonb_build_object('place',place,'amount',amount)ORDER BY place) FROM public.fn_ca_tournament_place_amounts(t)) IS DISTINCT FROM ladder
 THEN RAISE EXCEPTION '88-chip conservation or retained awards failed'; END IF;
 RAISE NOTICE '88 promo chips funded; 1830 place prizes + 670 bounties = 2500; paid awards unchanged';
END $correction$;
