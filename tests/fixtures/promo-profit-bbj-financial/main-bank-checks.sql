-- Only the specified original main100 numeric, replay and late-fault cases.
CREATE FUNCTION pg_temp.bbj_money_state() RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE t text;v jsonb;result jsonb:='{}';BEGIN
 FOREACH t IN ARRAY ARRAY['bbj_pools','bbj_payouts','bbj_payout_recipients','bbj_unclaimed_shares','bbj_recipient_reporting_owners','bbj_winners','club_members','wallet_credit_idempotency','wallet_transactions','chip_transactions','chip_ledger','ca_promo_play_through_grants','ca_promo_principal_custody','ca_promo_profit_gates','ca_promo_profit_fee_phases','ca_promo_profit_custody','ca_promo_profit_realization_receipts'] LOOP
  EXECUTE format('SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text),''[]''::jsonb) FROM public.%I x',t) INTO v;
  result:=result||jsonb_build_object(t,v);
 END LOOP;RETURN result;END $$;
BEGIN;
SET LOCAL request.jwt.claim.role='service_role';
SET LOCAL request.jwt.claim.sub='10000000-0000-0000-0000-000000000001';
DO $$DECLARE result record;before_state jsonb;s jsonb;BEGIN
 IF (SELECT main_balance<>900 OR backup_balance<>2000 OR promo_balance<>0 OR main_balance+backup_balance+promo_balance<>2900 FROM public.bbj_pools WHERE id='77700000-0000-0000-0000-000000000001') THEN RAISE EXCEPTION 'main100 payment changed original bank/reserve';END IF;
 IF (SELECT chip_balance FROM public.club_members WHERE club_id='20000000-0000-0000-0000-000000000001' AND user_id='10000000-0000-0000-0000-000000000001')<>175 OR (SELECT chip_balance FROM public.club_members WHERE club_id='20000000-0000-0000-0000-000000000001' AND user_id='10000000-0000-0000-0000-000000000002')<>125 THEN RAISE EXCEPTION 'main100 recipient wallets differ';END IF;
 IF (SELECT amount FROM public.bbj_payout_recipients WHERE user_id='10000000-0000-0000-0000-000000000001')<>75 OR (SELECT amount FROM public.bbj_payout_recipients WHERE user_id='10000000-0000-0000-0000-000000000002')<>25 OR (SELECT count(*) FROM public.bbj_payout_recipients)<>2 THEN RAISE EXCEPTION 'main100 original recipient amounts differ';END IF;
 IF public.fn_ca_promo_profit_locked_at('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','player_wallet','10000000-0000-0000-0000-000000000001')<>37.5 THEN RAISE EXCEPTION 'actual constructor did not tag exact37.5 original-source winnings';END IF;
 IF public.fn_ca_promo_locked_at('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','player_wallet','10000000-0000-0000-0000-000000000001')<>50 OR public.fn_ca_promo_restricted_at('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','player_wallet','10000000-0000-0000-0000-000000000001')<>87.5 THEN RAISE EXCEPTION 'BBJ payment changed original P or counted W union incorrectly';END IF;
 s:=public.fn_ca_promo_play_through_summary('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001');
 IF (s->>'fee_target')::numeric<>200 OR (s->>'profit_fee_target')::numeric<>100 OR (SELECT count(*) FROM public.ca_promo_play_through_grants)<>1 THEN RAISE EXCEPTION 'BBJ realization changed original200/100 targets or added gift: %',s;END IF;
 IF (SELECT count(*) FROM public.bbj_payouts WHERE total_amount=100)<>1 OR (SELECT count(*) FROM public.bbj_winners WHERE total_payout=100)<>1 OR EXISTS(SELECT 1 FROM public.bbj_unclaimed_shares WHERE paid_at IS NULL) THEN RAISE EXCEPTION 'main100 original allocation/reporting remains incomplete';END IF;
 IF (SELECT main_balance+backup_balance+promo_balance FROM public.bbj_pools WHERE id='77700000-0000-0000-0000-000000000001')+(SELECT sum(chip_balance) FROM public.club_members WHERE club_id='20000000-0000-0000-0000-000000000001')<>3200 THEN RAISE EXCEPTION 'main100 actual bank/wallet conservation differs';END IF;
 before_state:=pg_temp.bbj_money_state();
 SELECT * INTO STRICT result FROM public.bbj_atomic_payout_v2('77700000-0000-0000-0000-000000000001','88100000-0000-0000-0000-000000000001',990091,10,'10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',ARRAY['10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002']::uuid[],ARRAY[]::uuid[],'{}');
 IF result.applied OR NOT result.already_paid OR result.recovered THEN RAISE EXCEPTION 'original same-intent BBJ replay receipt differs %',row_to_json(result);END IF;
 IF before_state IS DISTINCT FROM pg_temp.bbj_money_state() THEN RAISE EXCEPTION 'original same-intent BBJ replay changed bank/wallet/source/journal';END IF;
END $$;
SET CONSTRAINTS ALL IMMEDIATE;COMMIT;
-- A second unpaid original hand is only the late-constructor fault intent;
-- it never commits a second payment. Its source vector is an explicit opening.
BEGIN;
SET LOCAL session_replication_role=replica;
INSERT INTO public.hand_history(id,table_id,hand_number,pot_size,game_variant,community_cards,actions,winners)
VALUES('88400000-0000-0000-0000-000000000092','88100000-0000-0000-0000-000000000001',990092,200,'nlh','{}','[]','[]');
SET LOCAL session_replication_role=origin;
INSERT INTO public.ca_promo_cash_hand_clocks(hand_id,table_id,hand_number,accepted_at,profit_capture_version)
VALUES('88400000-0000-0000-0000-000000000092','88100000-0000-0000-0000-000000000001',990092,clock_timestamp(),NULL);
INSERT INTO public.ca_promo_profit_cash_investment(hand_id,grant_id,club_id,user_id,table_id,phase_id,principal_contribution,profit_contribution,eligible_contribution,total_contribution)
SELECT '88400000-0000-0000-0000-000000000092',g.id,g.club_id,g.user_id,'88100000-0000-0000-0000-000000000001',f.id,50,0,50,100 FROM public.ca_promo_play_through_grants g JOIN public.ca_promo_profit_fee_phases f ON f.grant_id=g.id AND f.closed_at IS NULL WHERE g.source_ref='bbj-financial-original';
UPDATE public.ca_promo_cash_hand_clocks SET profit_capture_version=1 WHERE hand_id='88400000-0000-0000-0000-000000000092';
INSERT INTO public.rake_attributions(hand_id,player_id,club_id,rake_amount) VALUES('88400000-0000-0000-0000-000000000092','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',0),('88400000-0000-0000-0000-000000000092','10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001',0);
COMMIT;
CREATE FUNCTION pg_temp.bbj_after_money_fault() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 IF (SELECT main_balance FROM public.bbj_pools WHERE id='77700000-0000-0000-0000-000000000001')<>810 OR (SELECT chip_balance FROM public.club_members WHERE club_id='20000000-0000-0000-0000-000000000001' AND user_id='10000000-0000-0000-0000-000000000001')<>242.5 OR public.fn_ca_promo_profit_locked_at('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','player_wallet','10000000-0000-0000-0000-000000000001')<>71.25 THEN RAISE EXCEPTION 'fault did not occur after original bank, recipient money and real W constructor';END IF;
 RAISE EXCEPTION 'native_constructor_after_actual_money' USING ERRCODE='XX001';END $$;
CREATE TRIGGER native_bbj_after_money_fault BEFORE INSERT ON public.ca_promo_profit_realization_receipts FOR EACH ROW WHEN(NEW.source_kind='bbj') EXECUTE FUNCTION pg_temp.bbj_after_money_fault();
BEGIN;
SET LOCAL request.jwt.claim.role='service_role';SET LOCAL request.jwt.claim.sub='10000000-0000-0000-0000-000000000001';
DO $$DECLARE before_state jsonb;caught boolean:=false;BEGIN
 before_state:=pg_temp.bbj_money_state();
 BEGIN
  PERFORM public.bbj_atomic_payout_v2('77700000-0000-0000-0000-000000000001','88100000-0000-0000-0000-000000000001',990092,10,'10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',ARRAY['10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002']::uuid[],ARRAY[]::uuid[],'{}');
 EXCEPTION WHEN SQLSTATE 'XX001' THEN caught:=true;END;
 IF NOT caught THEN RAISE EXCEPTION 'actual BBJ owner swallowed late constructor failure';END IF;
 IF before_state IS DISTINCT FROM pg_temp.bbj_money_state() THEN RAISE EXCEPTION 'late BBJ constructor failure retained bank/recipient/source/journal/receipt';END IF;
END $$;
SET CONSTRAINTS ALL IMMEDIATE;COMMIT;
DROP TRIGGER native_bbj_after_money_fault ON public.ca_promo_profit_realization_receipts;
