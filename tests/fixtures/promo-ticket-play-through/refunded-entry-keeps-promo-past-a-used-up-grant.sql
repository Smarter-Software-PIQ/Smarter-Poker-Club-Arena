-- A refunded entry keeps its promo past a grant the entry itself used up
-- (20261123071237), proven on the full source stack: principal custody,
-- integrity custody, promo profit custody and the unified loss basis.
--
-- The case is the ordinary one for wheel and arcade prizes. A member holds a
-- small old grant (1) and a larger one (9) and enters an 18 + 2 event with 10
-- promo and 10 of their own chips. The promo share of the fee (1) is taken
-- from the oldest grant first, which uses it up and closes it as spent. The
-- event never runs and the entry is refunded. Before this migration that 1
-- chip was paid from the wallet to the promo fund.
--
-- The already-funded entry is an explicit opening; fee consumption, the exact
-- refund, every journal and every deferred financial guard are actual.
BEGIN;
SET LOCAL session_replication_role=replica;
INSERT INTO public.tournaments SELECT (jsonb_populate_record(NULL::public.tournaments,to_jsonb(t)||jsonb_build_object('id','b7a90000-0000-4000-8000-000000000011','name','Native Refund Keeps Promo Past A Used Up Grant','status','REGISTERING','buy_in_amount',18,'buy_in_fee',2,'prize_pool',18,'total_rake',2,'guaranteed_prize',0,'prize_pool_finalized',false))).* FROM public.tournaments t WHERE t.id='30000000-0000-0000-0000-000000000001';
INSERT INTO public.tournament_escrow(tournament_id,gross_in,fee_entries_in,satellite_fee_in,bounty_in,overlay_in,satellite_in,prize_out,bounty_out,fee_out,refund_prize,refund_bounty,refund_fee,reserve_out,reserve_in,prize_balance,bounty_balance,fee_balance,opened_from,opened_at,updated_at,enforced)
 VALUES('b7a90000-0000-4000-8000-000000000011',20,2,0,0,0,0,0,0,0,0,0,0,0,0,18,0,2,'native-already-funded-entry',now(),now(),true);
INSERT INTO public.chip_ledger(id,performed_by,from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id,tournament_id,created_at,status)
 VALUES('b7a90000-0000-4000-8000-000000000012','10000000-0000-0000-0000-000000000001','player_wallet','10000000-0000-0000-0000-000000000001','prize_liability','b7a90000-0000-4000-8000-000000000011',20,'tournament_buyin','20000000-0000-0000-0000-000000000001','b7a90000-0000-4000-8000-000000000011',clock_timestamp(),'posted');
INSERT INTO public.tournament_refund_entitlements(id,tournament_id,user_id,entitlement_kind,charge_category,refund_wallet_club_id,gross,refund_prize,refund_bounty,refund_fee,source_ledger_id,escrow_bucket,evidence_kind)
 VALUES('b7a90000-0000-4000-8000-000000000013','b7a90000-0000-4000-8000-000000000011','10000000-0000-0000-0000-000000000001','wallet_charge','tournament_buyin','20000000-0000-0000-0000-000000000001',20,18,0,2,'b7a90000-0000-4000-8000-000000000012','wallet_gross','atomic_wallet_charge');
INSERT INTO public.tournament_players(id,tournament_id,user_id,club_id,status,chips,prize) VALUES('b7a90000-0000-4000-8000-000000000014','b7a90000-0000-4000-8000-000000000011','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','registered',10000,0);
SET LOCAL session_replication_role=origin;
SELECT public.fn_ca_promo_play_through_record_grant('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',1,'wheel_prize','native-used-up-small',NULL,'promo_wallet','20000000-0000-0000-0000-000000000001');
SELECT public.fn_ca_promo_play_through_record_grant('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',9,'wheel_prize','native-used-up-large',NULL,'promo_wallet','20000000-0000-0000-0000-000000000001');
-- Typed opening: exactly these two grants funded the entry, so their custody
-- is named on the event directly instead of taking the member's oldest promo.
UPDATE public.ca_promo_principal_custody c SET kind='event',entity_id='b7a90000-0000-4000-8000-000000000011'
 FROM public.ca_promo_play_through_grants g WHERE g.id=c.grant_id AND g.source_ref IN('native-used-up-small','native-used-up-large') AND c.kind='player_wallet';
INSERT INTO public.ca_promo_event_principal_lots(grant_id,tournament_id,charge_ledger_id,source_ref,original_amount,remaining) SELECT id,'b7a90000-0000-4000-8000-000000000011','b7a90000-0000-4000-8000-000000000012',source_ref,amount,amount FROM public.ca_promo_play_through_grants WHERE source_ref IN('native-used-up-small','native-used-up-large') ORDER BY granted_at,id;
SELECT public.fn_ca_promo_consume_entry_fee('b7a90000-0000-4000-8000-000000000012');
INSERT INTO public.ca_settle_sources(source,note) VALUES('atomic_cancel_tournament','DB caller') ON CONFLICT(source) DO NOTHING;
DO $$DECLARE small uuid;large uuid;successor uuid;result jsonb;credit uuid;paid numeric;
 wallet_before numeric;fund_before numeric;locked_before numeric;cashable_before numeric;small_expiry timestamptz;returned numeric;
BEGIN
 SELECT id,expires_at INTO small,small_expiry FROM public.ca_promo_play_through_grants WHERE source_ref='native-used-up-small';
 SELECT id INTO large FROM public.ca_promo_play_through_grants WHERE source_ref='native-used-up-large';
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_play_through_grants WHERE id=small AND remaining=0 AND closed_at IS NOT NULL AND close_reason='spent')
  OR (SELECT remaining FROM public.ca_promo_play_through_grants WHERE id=large AND closed_at IS NULL)<>9
  OR (SELECT principal FROM public.ca_promo_event_fee_consumption_receipts WHERE charge_ledger_id='b7a90000-0000-4000-8000-000000000012')<>1
  OR (SELECT sum(amount) FROM public.ca_promo_event_fee_consumption_slices WHERE charge_ledger_id='b7a90000-0000-4000-8000-000000000012' AND grant_id=small)<>1 THEN
  RAISE EXCEPTION 'opening did not let the entry fee use up the oldest small grant';END IF;
 SELECT chip_balance INTO wallet_before FROM public.club_members WHERE club_id='20000000-0000-0000-0000-000000000001' AND user_id='10000000-0000-0000-0000-000000000001';
 SELECT promo_balance INTO fund_before FROM public.clubs WHERE id='20000000-0000-0000-0000-000000000001';
 locked_before:=public.fn_ca_promo_locked_at('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','player_wallet','10000000-0000-0000-0000-000000000001');
 cashable_before:=(public.fn_ca_promo_play_through_summary('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001')->>'cashable')::numeric;

 result:=public.fn_settle_tournament_refund_exact('b7a90000-0000-4000-8000-000000000011','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',20,18,0,2,'atomic_cancel_tournament','Native Refund Keeps Promo Past A Used Up Grant');
 IF (result->>'fully_settled')::boolean IS DISTINCT FROM true OR (result->>'paid')::numeric<>20 THEN RAISE EXCEPTION 'original exact refund refused: %',result;END IF;
 credit:=(result->>'credit_ledger_id')::uuid;

 -- Wallet, fund, journals.
 IF (SELECT chip_balance FROM public.club_members WHERE club_id='20000000-0000-0000-0000-000000000001' AND user_id='10000000-0000-0000-0000-000000000001')<>wallet_before+20 THEN RAISE EXCEPTION 'refund took promo out of the member wallet';END IF;
 IF (SELECT promo_balance FROM public.clubs WHERE id='20000000-0000-0000-0000-000000000001')<>fund_before THEN RAISE EXCEPTION 'refund paid promo to the fund';END IF;
 IF EXISTS(SELECT 1 FROM public.ca_promo_principal_return_receipts WHERE grant_id IN(small,large)) OR EXISTS(SELECT 1 FROM public.chip_ledger WHERE category='reversal' AND from_entity_id='10000000-0000-0000-0000-000000000001' AND created_at>=(SELECT created_at FROM public.chip_ledger WHERE id=credit)) THEN RAISE EXCEPTION 'refund still journaled a promo reversal';END IF;
 -- The used-up grant stays closed; its refunded fee is locked under a successor.
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_play_through_grants WHERE id=small AND remaining=0 AND close_reason='spent' AND amount=1) THEN RAISE EXCEPTION 'refund reopened or rewrote the used-up grant';END IF;
 IF NOT(SELECT count(*)=1 AND sum(amount)=1 AND sum(fee_amount)=1 AND sum(loss_amount)=0 FROM public.ca_promo_refund_keep_receipts WHERE grant_id=small AND treatment='successor' AND grant_close_reason='spent' AND ledger_id=credit AND entitlement_id='b7a90000-0000-4000-8000-000000000013') THEN RAISE EXCEPTION 'used-up grant has no single successor receipt';END IF;
 SELECT successor_grant_id INTO STRICT successor FROM public.ca_promo_refund_keep_receipts WHERE grant_id=small;
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_play_through_grants s JOIN public.ca_promo_play_through_grants o ON o.id=small
  WHERE s.id=successor AND s.id<>o.id AND s.closed_at IS NULL AND s.amount=1 AND s.remaining=1 AND s.fee_target=4 AND s.multiplier=o.multiplier
   AND s.club_id=o.club_id AND s.user_id=o.user_id AND s.source_kind=o.source_kind AND s.funded_from_type=o.funded_from_type AND s.funded_from_id=o.funded_from_id
   AND s.expires_at=small_expiry AND s.source_ledger_id IS NULL AND s.granted_at>o.granted_at) THEN RAISE EXCEPTION 'successor grant differs from the grant it follows';END IF;
 IF (SELECT amount FROM public.ca_promo_principal_custody WHERE grant_id=successor AND kind='player_wallet' AND entity_id='10000000-0000-0000-0000-000000000001')<>1 OR (SELECT count(*) FROM public.ca_promo_principal_custody WHERE grant_id=successor)<>1 THEN RAISE EXCEPTION 'successor principal is not held in the member wallet';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_gates WHERE grant_id=successor) OR NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_fee_phases WHERE grant_id=successor AND source_kind='gift') THEN RAISE EXCEPTION 'successor grant lacks the gate and phase every grant is seeded with';END IF;
 -- The open grant keeps its own principal exactly as 20261123000232 left it.
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_play_through_grants WHERE id=large AND closed_at IS NULL AND remaining=9) OR (SELECT amount FROM public.ca_promo_principal_custody WHERE grant_id=large AND kind='player_wallet')<>9 OR EXISTS(SELECT 1 FROM public.ca_promo_refund_restore_receipts WHERE grant_id IN(small,large)) THEN RAISE EXCEPTION 'open grant did not keep its refunded principal';END IF;
 -- All ten promo chips are locked again; only the member's own ten became cashable.
 IF public.fn_ca_promo_locked_at('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','player_wallet','10000000-0000-0000-0000-000000000001')<>locked_before+10 OR public.fn_ca_promo_locked_at('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','event','b7a90000-0000-4000-8000-000000000011')<>0 THEN RAISE EXCEPTION 'refunded promo is not locked in the member wallet';END IF;
 IF ((public.fn_ca_promo_play_through_summary('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001')->>'cashable')::numeric)<>cashable_before+10 THEN RAISE EXCEPTION 'refund turned promo into cashable chips';END IF;
 -- Response-loss replay of both owners moves nothing and writes no second successor.
 paid:=public.fn_ca_promo_return_refunded_principal(credit);
 IF paid<>0 OR (SELECT count(*) FROM public.ca_promo_refund_keep_receipts WHERE grant_id=small)<>1 OR (SELECT count(*) FROM public.ca_promo_play_through_grants WHERE source_ref LIKE 'refund_successor:'||small||':%')<>1
  OR (SELECT chip_balance FROM public.club_members WHERE club_id='20000000-0000-0000-0000-000000000001' AND user_id='10000000-0000-0000-0000-000000000001')<>wallet_before+20
  OR (SELECT promo_balance FROM public.clubs WHERE id='20000000-0000-0000-0000-000000000001')<>fund_before THEN RAISE EXCEPTION 'refund replay moved promo or wrote a second successor';END IF;
 IF EXISTS(SELECT 1 FROM public.tournament_escrow WHERE tournament_id='b7a90000-0000-4000-8000-000000000011' AND (prize_balance<>0 OR fee_balance<>0 OR bounty_balance<>0)) THEN RAISE EXCEPTION 'refund escrow did not balance';END IF;
 IF has_function_privilege('authenticated','public.fn_ca_promo_refund_successor_grant(uuid,numeric,text,text,uuid)','EXECUTE') OR has_function_privilege('service_role','public.fn_ca_promo_refund_successor_grant(uuid,numeric,text,text,uuid)','EXECUTE') OR has_table_privilege('authenticated','public.ca_promo_refund_keep_receipts','SELECT') OR has_table_privilege('anon','public.ca_promo_refund_keep_receipts','SELECT') THEN RAISE EXCEPTION 'successor owner or the keep receipts are reachable from a browser';END IF;
 -- A successor is an ordinary grant of its original fund: the original return
 -- owner pays it back to that fund by name, and it closes as returned.
 returned:=public.fn_ca_promo_return_principal(successor,'player_wallet','returned',1,'native-successor-return');
 IF returned<>1 OR (SELECT promo_balance FROM public.clubs WHERE id='20000000-0000-0000-0000-000000000001')<>fund_before+1 OR NOT EXISTS(SELECT 1 FROM public.ca_promo_play_through_grants WHERE id=successor AND remaining=0 AND close_reason='returned')
  OR (SELECT chip_balance FROM public.club_members WHERE club_id='20000000-0000-0000-0000-000000000001' AND user_id='10000000-0000-0000-0000-000000000001')<>wallet_before+19 THEN RAISE EXCEPTION 'successor grant did not return to its original fund through the original owner';END IF;
END$$;
SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;
