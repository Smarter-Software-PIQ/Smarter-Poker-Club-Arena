-- A refunded entry keeps its promo with the member (20261123000232), proven on
-- the full source stack: principal custody, integrity custody, promo profit
-- custody and the unified loss basis. The already-funded entry is an explicit
-- opening; fee consumption, the exact refund, every journal and every deferred
-- financial guard are actual.
BEGIN;
SET LOCAL session_replication_role=replica;
INSERT INTO public.tournaments SELECT (jsonb_populate_record(NULL::public.tournaments,to_jsonb(t)||jsonb_build_object('id','b7a90000-0000-4000-8000-000000000001','name','Native Refund Keeps Promo','status','REGISTERING','buy_in_amount',18,'buy_in_fee',2,'prize_pool',18,'total_rake',2,'guaranteed_prize',0,'prize_pool_finalized',false))).* FROM public.tournaments t WHERE t.id='30000000-0000-0000-0000-000000000001';
INSERT INTO public.tournament_escrow(tournament_id,gross_in,fee_entries_in,satellite_fee_in,bounty_in,overlay_in,satellite_in,prize_out,bounty_out,fee_out,refund_prize,refund_bounty,refund_fee,reserve_out,reserve_in,prize_balance,bounty_balance,fee_balance,opened_from,opened_at,updated_at,enforced)
 VALUES('b7a90000-0000-4000-8000-000000000001',20,2,0,0,0,0,0,0,0,0,0,0,0,0,18,0,2,'native-already-funded-entry',now(),now(),true);
UPDATE public.clubs SET promo_balance=980 WHERE id='20000000-0000-0000-0000-000000000001';
UPDATE public.club_members SET chip_balance=10 WHERE club_id='20000000-0000-0000-0000-000000000001' AND user_id='10000000-0000-0000-0000-000000000001';
INSERT INTO public.chip_ledger(id,performed_by,from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id,tournament_id,created_at,status)
 VALUES('b7a90000-0000-4000-8000-000000000002','10000000-0000-0000-0000-000000000001','player_wallet','10000000-0000-0000-0000-000000000001','prize_liability','b7a90000-0000-4000-8000-000000000001',20,'tournament_buyin','20000000-0000-0000-0000-000000000001','b7a90000-0000-4000-8000-000000000001',clock_timestamp(),'posted');
INSERT INTO public.tournament_refund_entitlements(id,tournament_id,user_id,entitlement_kind,charge_category,refund_wallet_club_id,gross,refund_prize,refund_bounty,refund_fee,source_ledger_id,escrow_bucket,evidence_kind)
 VALUES('b7a90000-0000-4000-8000-000000000003','b7a90000-0000-4000-8000-000000000001','10000000-0000-0000-0000-000000000001','wallet_charge','tournament_buyin','20000000-0000-0000-0000-000000000001',20,18,0,2,'b7a90000-0000-4000-8000-000000000002','wallet_gross','atomic_wallet_charge');
INSERT INTO public.tournament_players(id,tournament_id,user_id,club_id,status,chips,prize) VALUES('b7a90000-0000-4000-8000-000000000004','b7a90000-0000-4000-8000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','registered',10000,0);
SET LOCAL session_replication_role=origin;
SELECT public.fn_ca_promo_play_through_record_grant('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',20,'club_promo','native-refund-keeps-promo',NULL,'promo_wallet','20000000-0000-0000-0000-000000000001');
SELECT public.fn_ca_promo_move_custody('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','player_wallet','10000000-0000-0000-0000-000000000001','event','b7a90000-0000-4000-8000-000000000001',20);
INSERT INTO public.ca_promo_event_principal_lots(grant_id,tournament_id,charge_ledger_id,source_ref,original_amount,remaining) SELECT id,'b7a90000-0000-4000-8000-000000000001','b7a90000-0000-4000-8000-000000000002','native-refund-keeps-promo',20,20 FROM public.ca_promo_play_through_grants WHERE source_ref='native-refund-keeps-promo';
SELECT public.fn_ca_promo_consume_entry_fee('b7a90000-0000-4000-8000-000000000002');
INSERT INTO public.ca_settle_sources(source,note) VALUES('atomic_cancel_tournament','DB caller') ON CONFLICT(source) DO NOTHING;
DO $$DECLARE g uuid;result jsonb;credit uuid;paid numeric;BEGIN
 SELECT id INTO g FROM public.ca_promo_play_through_grants WHERE source_ref='native-refund-keeps-promo';
 IF (SELECT remaining FROM public.ca_promo_play_through_grants WHERE id=g)<>18 OR (SELECT principal FROM public.ca_promo_event_fee_consumption_receipts WHERE charge_ledger_id='b7a90000-0000-4000-8000-000000000002')<>2 THEN RAISE EXCEPTION 'opening did not spend the original promo fee of two';END IF;
 result:=public.fn_settle_tournament_refund_exact('b7a90000-0000-4000-8000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',20,18,0,2,'atomic_cancel_tournament','Native Refund Keeps Promo');
 IF (result->>'fully_settled')::boolean IS DISTINCT FROM true OR (result->>'paid')::numeric<>20 THEN RAISE EXCEPTION 'original exact refund refused: %',result;END IF;
 credit:=(result->>'credit_ledger_id')::uuid;
 IF (SELECT chip_balance FROM public.club_members WHERE club_id='20000000-0000-0000-0000-000000000001' AND user_id='10000000-0000-0000-0000-000000000001')<>30 THEN RAISE EXCEPTION 'refund took promo out of the member wallet';END IF;
 IF (SELECT promo_balance FROM public.clubs WHERE id='20000000-0000-0000-0000-000000000001')<>980 THEN RAISE EXCEPTION 'refund paid promo to the fund';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_play_through_grants WHERE id=g AND closed_at IS NULL AND close_reason IS NULL AND remaining=20 AND amount=20 AND fee_target=80) THEN RAISE EXCEPTION 'refund did not keep the original open grant whole';END IF;
 IF public.fn_ca_promo_locked_at('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','player_wallet','10000000-0000-0000-0000-000000000001')<>20 OR public.fn_ca_promo_locked_at('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','event','b7a90000-0000-4000-8000-000000000001')<>0 THEN RAISE EXCEPTION 'refunded promo is not locked in the member wallet';END IF;
 IF EXISTS(SELECT 1 FROM public.ca_promo_principal_return_receipts WHERE grant_id=g) OR EXISTS(SELECT 1 FROM public.chip_ledger WHERE category='reversal' AND from_entity_id='10000000-0000-0000-0000-000000000001' AND created_at>=(SELECT created_at FROM public.chip_ledger WHERE id=credit)) THEN RAISE EXCEPTION 'refund still journaled a promo reversal';END IF;
 IF NOT(SELECT count(*)=1 AND sum(amount)=2 FROM public.ca_promo_refund_restore_receipts WHERE grant_id=g AND reason='fee_refund' AND credit_ledger_id=credit) THEN RAISE EXCEPTION 'promo-paid fee was not restored exactly once';END IF;
 IF ((public.fn_ca_promo_play_through_summary('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001')->>'cashable')::numeric)<>10 THEN RAISE EXCEPTION 'refund turned promo into cashable chips';END IF;
 -- Response-loss replay of both owners moves nothing and restores nothing twice.
 paid:=public.fn_ca_promo_return_refunded_principal(credit);
 IF paid<>0 OR (SELECT remaining FROM public.ca_promo_play_through_grants WHERE id=g)<>20 OR (SELECT count(*) FROM public.ca_promo_refund_restore_receipts WHERE grant_id=g)<>1
  OR (SELECT chip_balance FROM public.club_members WHERE club_id='20000000-0000-0000-0000-000000000001' AND user_id='10000000-0000-0000-0000-000000000001')<>30 THEN RAISE EXCEPTION 'refund replay moved promo or restored it twice';END IF;
 IF EXISTS(SELECT 1 FROM public.tournament_escrow WHERE tournament_id='b7a90000-0000-4000-8000-000000000001' AND (prize_balance<>0 OR fee_balance<>0 OR bounty_balance<>0)) THEN RAISE EXCEPTION 'refund escrow did not balance';END IF;
 IF has_function_privilege('authenticated','public.fn_ca_promo_restore_refunded_entry_cost(uuid,text,numeric,uuid,uuid)','EXECUTE') OR has_function_privilege('service_role','public.fn_ca_promo_restore_refunded_entry_cost(uuid,text,numeric,uuid,uuid)','EXECUTE') OR has_table_privilege('authenticated','public.ca_promo_refund_restore_receipts','SELECT') THEN RAISE EXCEPTION 'restore owner or its receipts are reachable from a browser';END IF;
END$$;
SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;
