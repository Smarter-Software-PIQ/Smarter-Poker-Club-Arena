-- Typed prior accepted/funded-entry opening; every new bounty credit and
-- reentry charge below uses the original owner and all original money guards.
UPDATE public.hand_atomic_commits SET stack_result=jsonb_set(stack_result,'{written,b7100000-0000-4000-8000-000000000004}','100') WHERE hand_id='b7600000-0000-4000-8000-000000000002';
UPDATE public.settlement_idempotency_keys SET result=jsonb_set(result,'{written,b7100000-0000-4000-8000-000000000004}','100') WHERE hand_id='b7700000-0000-4000-8000-000000000002';
UPDATE public.tournament_knockout_candidates c SET created_at=a.committed_at-interval '1 second' FROM public.hand_atomic_commits a WHERE c.hand_id=a.hand_id AND c.id='b7800000-0000-4000-8000-000000000002';
UPDATE public.hand_history h SET created_at=a.committed_at-interval '1 second' FROM public.hand_atomic_commits a WHERE h.id=a.hand_id AND h.id='b7600000-0000-4000-8000-000000000002';
UPDATE public.hand_atomic_commits SET stack_result=jsonb_set(stack_result,'{written,b7100000-0000-4000-8000-000000000006}','100') WHERE hand_id='b7600000-0000-4000-8000-000000000003';
UPDATE public.settlement_idempotency_keys SET result=jsonb_set(result,'{written,b7100000-0000-4000-8000-000000000006}','100') WHERE hand_id='b7700000-0000-4000-8000-000000000003';
UPDATE public.tournament_knockout_candidates c SET created_at=a.committed_at-interval '1 second' FROM public.hand_atomic_commits a WHERE c.hand_id=a.hand_id AND c.id='b7800000-0000-4000-8000-000000000003';
UPDATE public.hand_history h SET created_at=a.committed_at-interval '1 second' FROM public.hand_atomic_commits a WHERE h.id=a.hand_id AND h.id='b7600000-0000-4000-8000-000000000003';
SET LOCAL session_replication_role=origin;
UPDATE public.ca_promo_play_through_settings SET enforced_from=clock_timestamp()-interval '1 hour';
-- Explicit historical source investment opening for the existing PKO winner.
-- The earning and positive wallet credit below still run the actual public payer.
INSERT INTO public.ca_promo_play_through_grants(id,club_id,user_id,amount,remaining,multiplier,source_kind,source_ref,funded_from_type,funded_from_id,cycle_started_at,granted_at,expires_at)
 VALUES('b7900000-0000-4000-8000-000000000001','20000000-0000-0000-0000-000000000001','b7100000-0000-4000-8000-000000000004',1,1,4,'other_promo','fixture_original_PKO_investment','promo_wallet','20000000-0000-0000-0000-000000000001',clock_timestamp()-interval '1 hour',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '30 days');
SET LOCAL session_replication_role=replica;
INSERT INTO public.chip_ledger(id,performed_by,from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id,tournament_id,status,metadata)
 VALUES('b7900000-0000-4000-8000-000000000002','b7100000-0000-4000-8000-000000000004','player_wallet','b7100000-0000-4000-8000-000000000004','prize_liability','b7200000-0000-4000-8000-000000000002',1,'tournament_buyin','20000000-0000-0000-0000-000000000001','b7200000-0000-4000-8000-000000000002','posted','{}');
INSERT INTO public.tournament_refund_entitlements(id,tournament_id,user_id,entitlement_kind,charge_category,refund_wallet_club_id,gross,refund_prize,refund_bounty,refund_fee,source_ledger_id,registration_id,escrow_bucket,evidence_kind)
 VALUES('b7900000-0000-4000-8000-000000000003','b7200000-0000-4000-8000-000000000002','b7100000-0000-4000-8000-000000000004','wallet_charge','tournament_buyin','20000000-0000-0000-0000-000000000001',1,1,0,0,'b7900000-0000-4000-8000-000000000002',NULL,'wallet_gross','atomic_wallet_charge');
INSERT INTO public.ca_promo_event_fee_consumption_receipts(charge_ledger_id,entitlement_id,gross_fee,original_promo,charge_amount,principal,club_id,player_id)
 VALUES('b7900000-0000-4000-8000-000000000002','b7900000-0000-4000-8000-000000000003',0,1,1,0,'20000000-0000-0000-0000-000000000001','b7100000-0000-4000-8000-000000000004');
INSERT INTO public.ca_promo_event_principal_lots(grant_id,tournament_id,charge_ledger_id,source_ref,original_amount,remaining)
 VALUES('b7900000-0000-4000-8000-000000000001','b7200000-0000-4000-8000-000000000002','b7900000-0000-4000-8000-000000000002','fixture_original_PKO_charge',1,1);
UPDATE public.ca_promo_principal_custody SET amount=0 WHERE grant_id='b7900000-0000-4000-8000-000000000001' AND kind='player_wallet';
INSERT INTO public.ca_promo_principal_custody VALUES('b7900000-0000-4000-8000-000000000001','event','b7200000-0000-4000-8000-000000000002',1);
INSERT INTO public.ca_promo_profit_event_charge_receipts VALUES('b7900000-0000-4000-8000-000000000002','20000000-0000-0000-0000-000000000001','b7100000-0000-4000-8000-000000000004',0,0);
SET LOCAL session_replication_role=origin;
SELECT public.fn_ca_promo_profit_record_charge_generation('b7900000-0000-4000-8000-000000000002','b7500000-0000-4000-8000-000000000004');
DO $initial_head_source_opening$
DECLARE r record;gid uuid;
BEGIN
 FOR r IN SELECT * FROM public.tournament_players WHERE tournament_id IN('b7200000-0000-4000-8000-000000000002','b7200000-0000-4000-8000-000000000003') LOOP
  gid:=public.fn_ca_promo_profit_initial_generation(r.id);
  INSERT INTO public.ca_promo_profit_head_components(operation_ref,tournament_id,user_id,head_generation_id,generation_id,earning_club_id,charge_ledger_ids,amount,source_kind,earned_at)
  VALUES('fixture_original_bought_head:'||r.id,r.tournament_id,r.user_id,gid,gid,r.club_id,'{}',5,'bought_head',clock_timestamp()-interval '1 minute');
 END LOOP;
END $initial_head_source_opening$;
SELECT public.fn_ca_promo_profit_capture_tournament_hand('b7600000-0000-4000-8000-000000000002','b7300000-0000-4000-8000-000000000002','[{"user_id":"b7100000-0000-4000-8000-000000000003","stack":0},{"user_id":"b7100000-0000-4000-8000-000000000004","stack":100}]');
SELECT public.fn_ca_promo_profit_capture_tournament_hand('b7600000-0000-4000-8000-000000000003','b7300000-0000-4000-8000-000000000003','[{"user_id":"b7100000-0000-4000-8000-000000000005","stack":0},{"user_id":"b7100000-0000-4000-8000-000000000006","stack":100}]');
SET LOCAL app.ca_promo_profit_admission='{"sentinel":"original admission"}';
SET LOCAL app.ca_promo_profit_earning_source='original earning sentinel';
DO $actual_public_pko_source$
DECLARE result jsonb;again jsonb;
BEGIN
 result:=public.process_tournament_rebuy('b7200000-0000-4000-8000-000000000002','b7100000-0000-4000-8000-000000000003','reentry',10,100,1,'generation-public-pko-reentry');
 IF result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'original public PKO/reentry refused: %',result;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_head_components WHERE source_kind='earned_head' AND user_id='b7100000-0000-4000-8000-000000000004' AND amount=2.5) THEN RAISE EXCEPTION 'actual public PKO never reached earning head source callback';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_head_retirements WHERE reason='knockout') THEN RAISE EXCEPTION 'actual public PKO never reached old head retirement';END IF;
 IF (SELECT chip_balance FROM public.club_members WHERE club_id='20000000-0000-0000-0000-000000000001' AND user_id='b7100000-0000-4000-8000-000000000004')<>2.5 THEN RAISE EXCEPTION 'original bounty payer did not credit exact cash half';END IF;
 IF public.fn_ca_promo_locked_at('20000000-0000-0000-0000-000000000001','b7100000-0000-4000-8000-000000000004','player_wallet','b7100000-0000-4000-8000-000000000004')<>1 OR public.fn_ca_promo_profit_locked_at('20000000-0000-0000-0000-000000000001','b7100000-0000-4000-8000-000000000004','player_wallet','b7100000-0000-4000-8000-000000000004')<>1.5 THEN RAISE EXCEPTION 'actual public PKO credit did not retain original P1 and derived W1.5';END IF;
 IF (SELECT current_bounty FROM public.tournament_players WHERE tournament_id='b7200000-0000-4000-8000-000000000002' AND user_id='b7100000-0000-4000-8000-000000000004')<>7.5 THEN RAISE EXCEPTION 'original bounty payer did not add exact head half';END IF;
 IF (SELECT chip_balance FROM public.club_members WHERE club_id='20000000-0000-0000-0000-000000000001' AND user_id='b7100000-0000-4000-8000-000000000003')<>90 THEN RAISE EXCEPTION 'original reentry did not debit ten once';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_generation_heads h JOIN public.tournament_players tp ON tp.id=h.registration_id WHERE tp.user_id='b7100000-0000-4000-8000-000000000003' AND h.generation_id='b7800000-0000-4000-8000-000000000002') THEN RAISE EXCEPTION 'actual new original purchase did not advance generation';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_head_components WHERE source_kind='bought_head' AND head_generation_id='b7800000-0000-4000-8000-000000000002' AND amount=5 AND cardinality(charge_ledger_ids)=1) THEN RAISE EXCEPTION 'actual entry entitlement failed bought-head source';END IF;
 again:=public.process_tournament_rebuy('b7200000-0000-4000-8000-000000000002','b7100000-0000-4000-8000-000000000003','reentry',10,100,1,'generation-public-pko-reentry');
 IF again IS DISTINCT FROM result THEN RAISE EXCEPTION 'original purchase receipt replay changed';END IF;
 IF (SELECT count(*) FROM public.ca_promo_profit_realization_receipts WHERE grant_id='b7900000-0000-4000-8000-000000000001')<>1 THEN RAISE EXCEPTION 'actual public PKO replay duplicated W earning';END IF;
 IF (SELECT count(*) FROM public.ca_promo_profit_head_components WHERE source_kind='earned_head' AND user_id='b7100000-0000-4000-8000-000000000004')<>1 THEN RAISE EXCEPTION 'actual response-loss replay duplicated earned head';END IF;
END $actual_public_pko_source$;
DO $actual_public_mystery_source$
DECLARE result jsonb;again jsonb;
BEGIN
 result:=public.process_tournament_rebuy('b7200000-0000-4000-8000-000000000003','b7100000-0000-4000-8000-000000000005','rebuy',10,100,1,'generation-public-mystery-rebuy');
 IF result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'original public mystery/rebuy refused: %',result;END IF;
 IF (SELECT chip_balance FROM public.club_members WHERE club_id='20000000-0000-0000-0000-000000000001' AND user_id='b7100000-0000-4000-8000-000000000006')<>5 THEN RAISE EXCEPTION 'original public mystery payer failed exact chest cash';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_earning_sources WHERE user_id='b7100000-0000-4000-8000-000000000006' AND amount=5 AND source_kind='mystery_bounty') THEN RAISE EXCEPTION 'actual public mystery never reached original earning callback';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_head_retirements x JOIN public.ca_promo_profit_head_components h ON h.id=x.component_id WHERE h.user_id='b7100000-0000-4000-8000-000000000005' AND x.reason='knockout') THEN RAISE EXCEPTION 'actual public mystery did not retire exact old head component';END IF;
 IF (SELECT chip_balance FROM public.club_members WHERE club_id='20000000-0000-0000-0000-000000000001' AND user_id='b7100000-0000-4000-8000-000000000005')<>90 THEN RAISE EXCEPTION 'original mystery rebuy did not debit ten';END IF;
 again:=public.process_tournament_rebuy('b7200000-0000-4000-8000-000000000003','b7100000-0000-4000-8000-000000000005','rebuy',10,100,1,'generation-public-mystery-rebuy');
 IF again IS DISTINCT FROM result OR (SELECT count(*) FROM public.ca_promo_profit_earning_sources WHERE user_id='b7100000-0000-4000-8000-000000000006' AND source_kind='mystery_bounty')<>1 THEN RAISE EXCEPTION 'actual mystery original replay duplicated source';END IF;
 IF current_setting('app.ca_promo_profit_admission',true)<>'{"sentinel": "original admission"}' AND current_setting('app.ca_promo_profit_admission',true)<>'{"sentinel":"original admission"}' THEN RAISE EXCEPTION 'original admission context was not restored';END IF;
 IF current_setting('app.ca_promo_profit_earning_source',true)<>'original earning sentinel' THEN RAISE EXCEPTION 'original earning context was not restored';END IF;
END $actual_public_mystery_source$;
SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;
