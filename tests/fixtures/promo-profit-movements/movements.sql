-- Exact actual earning/hold OPENING is typed; no source earning-producer claim.
-- All tested transfers, wallet debits/credits, seat effects and journal rows
-- below execute original owners with origin-mode money/tally guards enabled.
BEGIN;
SET LOCAL session_replication_role=replica;
UPDATE public.clubs SET promo_balance=1000,asset='chips' WHERE id='20000000-0000-0000-0000-000000000001';
UPDATE public.club_members SET chip_balance=80 WHERE club_id='20000000-0000-0000-0000-000000000001' AND user_id='10000000-0000-0000-0000-000000000001';
INSERT INTO public.agents(club_id,user_id,role,status,agent_wallet_balance,promo_wallet_balance,is_prepaid,credit_limit,credit_used,commission_rate,player_rakeback_rate)
VALUES('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','agent','active',0,0,true,0,0,0,0);
SET LOCAL session_replication_role=origin;
SET LOCAL request.jwt.claim.sub='10000000-0000-0000-0000-000000000001';SET LOCAL request.jwt.claim.role='authenticated';
UPDATE public.ca_promo_play_through_settings SET enforced_from=clock_timestamp()-interval '1 second';
DO $$DECLARE r jsonb;gid uuid;n numeric;BEGIN
 r:=public.fn_promo_disburse('club','20000000-0000-0000-0000-000000000001','player','10000000-0000-0000-0000-000000000001',50,'Native W Opening Gift','20000000-0000-0000-0000-000000000001','a9000000-0000-0000-0000-000000000001');
 IF r->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'original promo producer refused %',r;END IF;
 SELECT id INTO STRICT gid FROM public.ca_promo_play_through_grants WHERE user_id='10000000-0000-0000-0000-000000000001' AND closed_at IS NULL;
 -- Existing accounted80 includes the exact original-source W40 in this typed
 -- opening. The actual constructor tags40, creates no credit or new gift.
 n:=public.fn_ca_promo_profit_credit_owned('cash_win','a9000000-0000-0000-0000-000000000002',gid,'20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','player_wallet','10000000-0000-0000-0000-000000000001',40);
 IF n<>40 THEN RAISE EXCEPTION 'actual original W constructor differs %',n;END IF;
 IF public.fn_ca_promo_profit_credit_owned('cash_win','a9000000-0000-0000-0000-000000000002',gid,'20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','player_wallet','10000000-0000-0000-0000-000000000001',40)<>40 THEN RAISE EXCEPTION 'actual constructor replay differs';END IF;
 INSERT INTO public.ca_promo_integrity_cases(id,hand_id,source_club_id,source_user_id,club_id,recipient_id,amount,evidence)
 VALUES('a9000000-0000-0000-0000-000000000003','a9000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',20,'{"fixture":"typed retained original review opening, not case producer proof"}');
 INSERT INTO public.ca_promo_integrity_custody VALUES('a9000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','player_wallet','10000000-0000-0000-0000-000000000001',20);
 INSERT INTO public.ca_promo_profit_integrity_overlap VALUES(gid,'a9000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','player_wallet','10000000-0000-0000-0000-000000000001',10);
 IF public.fn_ca_promo_restricted_at('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','player_wallet','10000000-0000-0000-0000-000000000001')<>100 OR (public.fn_ca_promo_play_through_summary('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001')->>'cashable')::numeric<>30 THEN RAISE EXCEPTION 'original130 union opening differs';END IF;
END $$;
SET CONSTRAINTS ALL IMMEDIATE;COMMIT;

-- Include original money receipts and every custody/overlap/source lot in
-- unknown/replay comparisons. No financial function is replaced.
CREATE FUNCTION pg_temp.movement_state() RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE n text;v jsonb;s jsonb:='{}';BEGIN
 FOREACH n IN ARRAY ARRAY['clubs','club_members','agents','chip_ledger','chip_transactions','cashier_rpc_operation_intents','ca_promo_play_through_grants','ca_promo_principal_custody','ca_promo_profit_custody','ca_promo_integrity_custody','ca_promo_profit_integrity_overlap','ca_promo_funding_custody_receipts','ca_promo_profit_funding_sources','ca_promo_profit_funding_lots'] LOOP
  EXECUTE format('SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),''[]''::jsonb) FROM public.%I t',n) INTO v;s:=s||jsonb_build_object(n,v);
 END LOOP;RETURN s;END $$;
CREATE FUNCTION pg_temp.movement_unknown_fault() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'native_unknown_after_original_money_and_W_movement' USING ERRCODE='XX001';END $$;
CREATE TRIGGER native_unknown_after_money BEFORE INSERT ON public.ca_promo_profit_funding_lots FOR EACH ROW EXECUTE FUNCTION pg_temp.movement_unknown_fault();
BEGIN;
SET LOCAL request.jwt.claim.sub='10000000-0000-0000-0000-000000000001';SET LOCAL request.jwt.claim.role='authenticated';
DO $$DECLARE before_state jsonb;r jsonb;caught boolean:=false;BEGIN
 before_state:=pg_temp.movement_state();
 BEGIN
  r:=public.fn_club_wallet_claim_back('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',100,'player_wallet','agent_wallet','Native Own W Claim','a9000000-0000-0000-0000-000000000005',NULL);
 EXCEPTION WHEN SQLSTATE 'XX001' THEN caught:=true;END;
 IF NOT caught THEN RAISE EXCEPTION 'original money owner hid unknown source failure %',r;END IF;
 IF before_state IS DISTINCT FROM pg_temp.movement_state() THEN RAISE EXCEPTION 'unknown source failure retained money, target, receipt or P H W movement';END IF;
END $$;
SET CONSTRAINTS ALL IMMEDIATE;COMMIT;
DROP TRIGGER native_unknown_after_money ON public.ca_promo_profit_funding_lots;
BEGIN;
SET LOCAL request.jwt.claim.sub='10000000-0000-0000-0000-000000000001';SET LOCAL request.jwt.claim.role='authenticated';
DO $$DECLARE r jsonb;s jsonb;l uuid;BEGIN
 r:=public.fn_club_wallet_claim_back('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',100,'player_wallet','agent_wallet','Native Own W Claim','a9000000-0000-0000-0000-000000000005',NULL);
 IF r->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'actual own claim refused %',r;END IF;
 SELECT id INTO STRICT l FROM public.chip_ledger WHERE idempotency_key='club_wallet_claim:a9000000-0000-0000-0000-000000000005';
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_funding_lots WHERE ledger_id=l AND profit_moved=40 AND overlap_moved=10) OR NOT EXISTS(SELECT 1 FROM public.ca_promo_funding_custody_receipts WHERE ledger_id=l AND principal_moved=20) THEN RAISE EXCEPTION 'actual own claim source lots differ';END IF;
 IF (SELECT chip_balance FROM public.club_members WHERE club_id='20000000-0000-0000-0000-000000000001' AND user_id='10000000-0000-0000-0000-000000000001')<>30 OR (SELECT agent_wallet_balance FROM public.agents WHERE club_id='20000000-0000-0000-0000-000000000001' AND user_id='10000000-0000-0000-0000-000000000001')<>100 THEN RAISE EXCEPTION 'actual own claim balances differ';END IF;
 IF public.fn_ca_promo_restricted_at('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','agent_wallet','10000000-0000-0000-0000-000000000001')<>70 THEN RAISE EXCEPTION 'actual own claim union differs';END IF;
 s:=pg_temp.movement_state();r:=public.fn_club_wallet_claim_back('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',100,'player_wallet','agent_wallet','Native Own W Claim','a9000000-0000-0000-0000-000000000005',NULL);
 IF r->>'replayed' IS DISTINCT FROM 'true' OR s IS DISTINCT FROM pg_temp.movement_state() THEN RAISE EXCEPTION 'actual own claim replay changed money or source';END IF;
 r:=public.fn_club_wallet_claim_back('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',99,'player_wallet','agent_wallet','Native Own W Claim','a9000000-0000-0000-0000-000000000005',NULL);
 IF r->>'success' IS DISTINCT FROM 'false' OR s IS DISTINCT FROM pg_temp.movement_state() THEN RAISE EXCEPTION 'changed original claim intent mutated source';END IF;
END $$;
SET CONSTRAINTS ALL IMMEDIATE;COMMIT;
BEGIN;
SET LOCAL request.jwt.claim.sub='10000000-0000-0000-0000-000000000001';SET LOCAL request.jwt.claim.role='authenticated';
DO $$DECLARE r jsonb;s jsonb;BEGIN
 r:=public.fn_agent_wallet_self_stake('20000000-0000-0000-0000-000000000001',100,'Native Own W Return','a9000000-0000-0000-0000-000000000006');
 IF r->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'actual own reverse refused %',r;END IF;
 IF (SELECT agent_wallet_balance FROM public.agents WHERE club_id='20000000-0000-0000-0000-000000000001' AND user_id='10000000-0000-0000-0000-000000000001')<>0 OR (SELECT chip_balance FROM public.club_members WHERE club_id='20000000-0000-0000-0000-000000000001' AND user_id='10000000-0000-0000-0000-000000000001')<>130 THEN RAISE EXCEPTION 'actual own reverse balances differ';END IF;
 IF public.fn_ca_promo_restricted_at('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','player_wallet','10000000-0000-0000-0000-000000000001')<>100 THEN RAISE EXCEPTION 'actual reverse lost original union';END IF;
 s:=pg_temp.movement_state();r:=public.fn_agent_wallet_self_stake('20000000-0000-0000-0000-000000000001',100,'Native Own W Return','a9000000-0000-0000-0000-000000000006');
 IF r->>'replayed' IS DISTINCT FROM 'true' OR s IS DISTINCT FROM pg_temp.movement_state() THEN RAISE EXCEPTION 'actual own reverse replay changed money';END IF;
 IF (SELECT count(*) FROM public.ca_promo_play_through_grants WHERE user_id='10000000-0000-0000-0000-000000000001')<>1 OR (SELECT fee_target FROM public.ca_promo_play_through_grants WHERE user_id='10000000-0000-0000-0000-000000000001')<>200 THEN RAISE EXCEPTION 'actual moves created another gift or fee target';END IF;
END $$;
SET CONSTRAINTS ALL IMMEDIATE;COMMIT;

-- The third flow is original cash admission -> real midhand pending debit ->
-- original partial application/refund -> original whole-seat cashout/replay.
BEGIN;
SET LOCAL request.jwt.claim.role='service_role';
INSERT INTO public.cash_games(id,club_id,name,template_name,variant,sb,bb,handedness,ruleset_snapshot,must_move) VALUES('a9000000-0000-0000-0000-000000000009','20000000-0000-0000-0000-000000000001','Native Original W Game','classic','nlh',0.25,0.5,6,'{}',false);
INSERT INTO public.tables(id,club_id,name,game_type,game_variant,small_blind,big_blind,min_buy_in,max_buy_in,max_players,status,is_private,cluster_id,role,lifecycle)
VALUES('a9000000-0000-0000-0000-000000000010','20000000-0000-0000-0000-000000000001','Native Original W Cash','cash','nlh',0.25,0.5,20,200,6,'waiting',true,'a9000000-0000-0000-0000-000000000009','main','live');
SELECT public.atomic_table_buyin('10000000-0000-0000-0000-000000000001','a9000000-0000-0000-0000-000000000010',1,40,false,'20000000-0000-0000-0000-000000000001','a9000000-0000-0000-0000-000000000011');
DO $$DECLARE n bigint;BEGIN
 SELECT count(*) INTO n FROM public.chip_ledger WHERE category='buyin' AND from_entity_id='10000000-0000-0000-0000-000000000001' AND to_entity_id='a9000000-0000-0000-0000-000000000010' AND amount=40;
 IF n<>1 OR public.fn_ca_promo_profit_locked_at('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','table_stack','a9000000-0000-0000-0000-000000000010')<>10 THEN RAISE EXCEPTION 'actual cash admission source differs';END IF;
 PERFORM public.atomic_table_buyin('10000000-0000-0000-0000-000000000001','a9000000-0000-0000-0000-000000000010',1,40,false,'20000000-0000-0000-0000-000000000001','a9000000-0000-0000-0000-000000000011');
 IF (SELECT count(*) FROM public.cash_participant_funding_receipts WHERE operation_key='a9000000-0000-0000-0000-000000000011')<>1 THEN RAISE EXCEPTION 'actual buyin replay duplicated original funding';END IF;
END $$;
SELECT public.atomic_table_addon('10000000-0000-0000-0000-000000000001','a9000000-0000-0000-0000-000000000010',80,false,'native-original-W-addon');
DO $$DECLARE pending uuid;r record;occ uuid;before_count bigint;BEGIN
 SELECT id INTO STRICT pending FROM public.table_pending_addons WHERE table_id='a9000000-0000-0000-0000-000000000010' AND resolved_at IS NULL;
 IF public.fn_ca_promo_profit_locked_at('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','pending_addon',pending)<>30 THEN RAISE EXCEPTION 'actual pending debit failed W custody';END IF;
 SELECT * INTO STRICT r FROM public.resolve_pending_addon(pending,75);
 IF r.applied<>35 OR r.refunded<>45 OR NOT r.was_resolved THEN RAISE EXCEPTION 'actual original pending split differs %',row_to_json(r);END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_pending_lots WHERE pending_addon_id=pending AND profit_applied=25 AND profit_refunded=5 AND overlap_applied=5 AND overlap_refunded=5) THEN RAISE EXCEPTION 'actual pending WH split differs';END IF;
 SELECT count(*) INTO before_count FROM public.chip_ledger;
 SELECT * INTO STRICT r FROM public.resolve_pending_addon(pending,75);
 IF r.was_resolved OR (SELECT count(*) FROM public.chip_ledger)<>before_count THEN RAISE EXCEPTION 'actual pending replay moved money again';END IF;
 IF (SELECT stack FROM public.table_seats WHERE table_id='a9000000-0000-0000-0000-000000000010' AND left_at IS NULL)<>75 OR (SELECT chip_balance FROM public.club_members WHERE club_id='20000000-0000-0000-0000-000000000001' AND user_id='10000000-0000-0000-0000-000000000001')<>55 THEN RAISE EXCEPTION 'actual pending wallet/seat balances differ';END IF;
END $$;
SET CONSTRAINTS ALL IMMEDIATE;COMMIT;
BEGIN;
SET LOCAL request.jwt.claim.role='service_role';
DO $$DECLARE occ uuid;r jsonb;s jsonb;ledger_count bigint;BEGIN
 SELECT occupancy_id INTO STRICT occ FROM public.table_seats WHERE table_id='a9000000-0000-0000-0000-000000000010' AND left_at IS NULL;
 r:=public.fn_cashout_seat_occupancy('10000000-0000-0000-0000-000000000001','a9000000-0000-0000-0000-000000000010',1,occ,NULL);
 IF r->>'ok' IS DISTINCT FROM 'true' OR (r->>'stack')::numeric<>75 OR r->>'credited' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'actual cashout refused %',r;END IF;
 IF public.fn_ca_promo_restricted_at('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','player_wallet','10000000-0000-0000-0000-000000000001')<>100 OR (SELECT chip_balance FROM public.club_members WHERE club_id='20000000-0000-0000-0000-000000000001' AND user_id='10000000-0000-0000-0000-000000000001')<>130 THEN RAISE EXCEPTION 'actual whole cashout failed source/bank conservation';END IF;
 IF public.fn_ca_promo_profit_locked_at('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','table_stack','a9000000-0000-0000-0000-000000000010')<>0 THEN RAISE EXCEPTION 'actual cashout stranded W on exited seat';END IF;
 s:=pg_temp.movement_state();SELECT count(*) INTO ledger_count FROM public.chip_ledger;
 r:=public.fn_cashout_seat_occupancy('10000000-0000-0000-0000-000000000001','a9000000-0000-0000-0000-000000000010',1,occ,NULL);
 IF r->>'ok' IS DISTINCT FROM 'true' OR s IS DISTINCT FROM pg_temp.movement_state() OR ledger_count<>(SELECT count(*) FROM public.chip_ledger) THEN RAISE EXCEPTION 'actual original occupancy replay moved money or source';END IF;
 IF (public.fn_ca_promo_play_through_summary('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001')->>'cashable')::numeric<>30 THEN RAISE EXCEPTION 'actual full money roundtrip did not preserve own cashable30';END IF;
END $$;
SET CONSTRAINTS ALL IMMEDIATE;COMMIT;
