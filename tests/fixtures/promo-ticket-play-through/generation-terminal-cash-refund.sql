-- Same retained funded-entry opening as the original returns proof. The terminal
-- loss receipt and fee consumption are actual. The later original cash refund
-- must refuse under terminal guards with every monetary value unchanged.
BEGIN;
SET LOCAL session_replication_role=replica;
INSERT INTO public.tournaments SELECT (jsonb_populate_record(NULL::public.tournaments,to_jsonb(t)||jsonb_build_object('id','b7990000-0000-4000-8000-000000000001','name','Native Terminal Cash Refund','status','COMPLETED','buy_in_amount',18,'buy_in_fee',2,'prize_pool',18,'total_rake',2,'guaranteed_prize',0,'prize_pool_finalized',true))).* FROM public.tournaments t WHERE t.id='30000000-0000-0000-0000-000000000001';
INSERT INTO public.tournament_escrow(tournament_id,gross_in,fee_entries_in,satellite_fee_in,bounty_in,overlay_in,satellite_in,prize_out,bounty_out,fee_out,refund_prize,refund_bounty,refund_fee,reserve_out,reserve_in,prize_balance,bounty_balance,fee_balance,opened_from,opened_at,updated_at,enforced)
 VALUES('b7990000-0000-4000-8000-000000000001',20,2,0,0,0,0,0,0,0,0,0,0,0,0,18,0,2,'native-already-funded-terminal-entry',now(),now(),true);
UPDATE public.clubs SET promo_balance=980 WHERE id='20000000-0000-0000-0000-000000000001';
UPDATE public.club_members SET chip_balance=10 WHERE club_id='20000000-0000-0000-0000-000000000001' AND user_id='10000000-0000-0000-0000-000000000001';
INSERT INTO public.chip_ledger(id,performed_by,from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id,tournament_id,created_at,status)
 VALUES('b7990000-0000-4000-8000-000000000002','10000000-0000-0000-0000-000000000001','player_wallet','10000000-0000-0000-0000-000000000001','prize_liability','b7990000-0000-4000-8000-000000000001',20,'tournament_buyin','20000000-0000-0000-0000-000000000001','b7990000-0000-4000-8000-000000000001',clock_timestamp(),'posted');
INSERT INTO public.tournament_refund_entitlements(id,tournament_id,user_id,entitlement_kind,charge_category,refund_wallet_club_id,gross,refund_prize,refund_bounty,refund_fee,source_ledger_id,escrow_bucket,evidence_kind)
 VALUES('b7990000-0000-4000-8000-000000000003','b7990000-0000-4000-8000-000000000001','10000000-0000-0000-0000-000000000001','wallet_charge','tournament_buyin','20000000-0000-0000-0000-000000000001',20,18,0,2,'b7990000-0000-4000-8000-000000000002','wallet_gross','atomic_wallet_charge');
INSERT INTO public.tournament_players(id,tournament_id,user_id,club_id,status,chips,prize) VALUES('b7990000-0000-4000-8000-000000000004','b7990000-0000-4000-8000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','eliminated',0,0);
-- Existing authorized refund liability predates the terminal opening.
INSERT INTO public.tournament_obligations(tournament_id,kind,place,user_id,amount_owed,amount_paid,source) VALUES('b7990000-0000-4000-8000-000000000001','refund',NULL,'10000000-0000-0000-0000-000000000001',20,0,'atomic_cancel_tournament');
SET LOCAL session_replication_role=origin;
SELECT public.fn_ca_promo_play_through_record_grant('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',20,'club_promo','native-terminal-cash-refund',NULL,'promo_wallet','20000000-0000-0000-0000-000000000001');
SELECT public.fn_ca_promo_move_custody('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','player_wallet','10000000-0000-0000-0000-000000000001','event','b7990000-0000-4000-8000-000000000001',20);
INSERT INTO public.ca_promo_event_principal_lots(grant_id,tournament_id,charge_ledger_id,source_ref,original_amount,remaining) SELECT id,'b7990000-0000-4000-8000-000000000001','b7990000-0000-4000-8000-000000000002','native-terminal-cash-refund',20,20 FROM public.ca_promo_play_through_grants WHERE source_ref='native-terminal-cash-refund';
SELECT public.fn_ca_promo_consume_entry_fee('b7990000-0000-4000-8000-000000000002');
SELECT public.fn_ca_promo_profit_cleanup_settled_event('b7990000-0000-4000-8000-000000000001','10000000-0000-0000-0000-000000000001');
DO $$BEGIN
 IF (SELECT principal FROM public.ca_promo_event_fee_consumption_receipts WHERE charge_ledger_id='b7990000-0000-4000-8000-000000000002')<>2 THEN RAISE EXCEPTION 'original fee expense was not two';END IF;
 IF (SELECT sum(amount) FROM public.ca_promo_event_terminal_loss_slices WHERE charge_ledger_id='b7990000-0000-4000-8000-000000000002')<>18 THEN RAISE EXCEPTION 'actual terminal cleanup did not retain exact eighteen loss authority';END IF;
 IF EXISTS(SELECT 1 FROM public.ca_promo_event_entry_loss_slices WHERE charge_ledger_id='b7990000-0000-4000-8000-000000000002') THEN RAISE EXCEPTION 'terminal proof accidentally used a bust loss receipt';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_play_through_grants WHERE source_ref='native-terminal-cash-refund' AND remaining=0 AND close_reason='spent' AND closed_at IS NOT NULL AND fee_target=80) THEN RAISE EXCEPTION 'terminal cleanup did not close original grant finally';END IF;
END$$;
INSERT INTO public.ca_settle_sources(source,note) VALUES('atomic_cancel_tournament','DB caller') ON CONFLICT(source) DO NOTHING;
SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;
-- Original terminal guards forbid a new financial continuation. This is a
-- required safe refusal, not permission to reopen the event or bypass a guard.
DO $$DECLARE before_state jsonb;after_state jsonb;blocked boolean:=false;message text;BEGIN
 SELECT jsonb_build_object(
  'wallet',(SELECT chip_balance FROM public.club_members WHERE club_id='20000000-0000-0000-0000-000000000001' AND user_id='10000000-0000-0000-0000-000000000001'),
  'fund',(SELECT promo_balance FROM public.clubs WHERE id='20000000-0000-0000-0000-000000000001'),
  'ledger',(SELECT count(*) FROM public.chip_ledger),'transactions',(SELECT count(*) FROM public.chip_transactions),
  'wallet_transactions',(SELECT count(*) FROM public.wallet_transactions),'credit_keys',(SELECT count(*) FROM public.wallet_credit_idempotency),
  'tranches',(SELECT count(*) FROM public.tournament_refund_tranches),'authorizations',(SELECT count(*) FROM public.tournament_refund_authorizations),
  'returns',(SELECT count(*) FROM public.ca_promo_principal_return_receipts),
  'grant',(SELECT to_jsonb(g) FROM public.ca_promo_play_through_grants g WHERE source_ref='native-terminal-cash-refund'),
  'obligation',(SELECT to_jsonb(o) FROM public.tournament_obligations o WHERE tournament_id='b7990000-0000-4000-8000-000000000001' AND kind='refund')) INTO before_state;
 BEGIN
  PERFORM public.fn_settle_tournament_refund_exact('b7990000-0000-4000-8000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',20,18,0,2,'atomic_cancel_tournament','Native Terminal Refund');
 EXCEPTION WHEN SQLSTATE '55000' THEN
  GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;
  IF message<>'terminal wallet credit key evidence is immutable' THEN RAISE EXCEPTION 'wrong terminal guard refused: %',message;END IF;
  blocked:=true;
 END;
 IF NOT blocked THEN RAISE EXCEPTION 'original terminal cash refund unexpectedly accepted';END IF;
 SELECT jsonb_build_object(
  'wallet',(SELECT chip_balance FROM public.club_members WHERE club_id='20000000-0000-0000-0000-000000000001' AND user_id='10000000-0000-0000-0000-000000000001'),
  'fund',(SELECT promo_balance FROM public.clubs WHERE id='20000000-0000-0000-0000-000000000001'),
  'ledger',(SELECT count(*) FROM public.chip_ledger),'transactions',(SELECT count(*) FROM public.chip_transactions),
  'wallet_transactions',(SELECT count(*) FROM public.wallet_transactions),'credit_keys',(SELECT count(*) FROM public.wallet_credit_idempotency),
  'tranches',(SELECT count(*) FROM public.tournament_refund_tranches),'authorizations',(SELECT count(*) FROM public.tournament_refund_authorizations),
  'returns',(SELECT count(*) FROM public.ca_promo_principal_return_receipts),
  'grant',(SELECT to_jsonb(g) FROM public.ca_promo_play_through_grants g WHERE source_ref='native-terminal-cash-refund'),
  'obligation',(SELECT to_jsonb(o) FROM public.tournament_obligations o WHERE tournament_id='b7990000-0000-4000-8000-000000000001' AND kind='refund')) INTO after_state;
 IF after_state IS DISTINCT FROM before_state THEN RAISE EXCEPTION 'terminal refusal changed original financial evidence';END IF;
 IF (SELECT sum(amount) FROM public.ca_promo_original_entry_loss_basis WHERE charge_ledger_id='b7990000-0000-4000-8000-000000000002')<>18 THEN RAISE EXCEPTION 'original unified loss basis omitted terminal eighteen';END IF;
 IF (SELECT count(*) FROM public.ca_promo_event_terminal_loss_slices WHERE charge_ledger_id='b7990000-0000-4000-8000-000000000002')<>1 THEN RAISE EXCEPTION 'terminal source receipt was duplicated';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_play_through_grants WHERE source_ref='native-terminal-cash-refund' AND remaining=0 AND closed_at IS NOT NULL AND close_reason='spent' AND fee_target=80) THEN RAISE EXCEPTION 'refused terminal refund revived original grant';END IF;
END$$;
SET CONSTRAINTS ALL IMMEDIATE;
