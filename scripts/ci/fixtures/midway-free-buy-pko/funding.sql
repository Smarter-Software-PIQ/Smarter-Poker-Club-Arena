\set ON_ERROR_STOP on
INSERT INTO union_wallets(union_id,promo_wallet) VALUES('fade0000-0000-0000-0000-000000000001',10);
INSERT INTO tournaments(id,union_id,club_id,tournament_type,free_buy,is_pko,is_bounty,is_mystery_bounty,
 buy_in_amount,buy_in_fee,bounty_amount,guaranteed_prize,status,prize_pool,bounty_pool)
VALUES('10000000-0000-0000-0000-000000000001','fade0000-0000-0000-0000-000000000001',
 'fade0000-0000-0000-0000-000000000001','MTT',true,true,true,false,0,0,1,0,'REGISTERING',0,0);
INSERT INTO tournament_escrow(tournament_id,enforced)
 VALUES('10000000-0000-0000-0000-000000000001',true);
INSERT INTO tournament_players(id,tournament_id,user_id,status,current_bounty)
 VALUES('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',
 '30000000-0000-0000-0000-000000000001','registered',1);
DO $$DECLARE t uuid:='10000000-0000-0000-0000-000000000001'; p uuid:='20000000-0000-0000-0000-000000000001'; n numeric;
BEGIN
 n:=fn_ca_midway_free_buy_promo_head(t,p,false);
 IF n<>1 THEN RAISE EXCEPTION 'Initial funding did not move exactly one chip'; END IF;
 UPDATE tournaments SET bounty_pool=bounty_pool+n WHERE id=t;
 IF (SELECT promo_wallet FROM union_wallets)<>9
    OR (SELECT bounty_balance FROM tournament_escrow)<>1
    OR (SELECT prize_balance FROM tournament_escrow)<>0
    OR (SELECT fee_balance FROM tournament_escrow)<>0
    OR (SELECT count(*) FROM chip_ledger)<>1 THEN RAISE EXCEPTION 'Initial conservation failed'; END IF;
 IF fn_ca_midway_free_buy_promo_head(t,p,false)<>0
    OR (SELECT promo_wallet FROM union_wallets)<>9 THEN RAISE EXCEPTION 'Duplicate funding charged twice'; END IF;
 n:=fn_ca_midway_free_buy_promo_head(t,p,true);
 IF n<>1 OR (SELECT promo_wallet FROM union_wallets)<>10
    OR (SELECT bounty_balance FROM tournament_escrow)<>0
    OR (SELECT bounty_pool FROM tournaments)<>0
    OR (SELECT count(*) FROM chip_ledger)<>2 THEN RAISE EXCEPTION 'Withdrawal conservation failed'; END IF;
 IF fn_ca_midway_free_buy_promo_head(t,p,true)<>0
    OR (SELECT promo_wallet FROM union_wallets)<>10 THEN RAISE EXCEPTION 'Duplicate return credited twice'; END IF;
END $$;
INSERT INTO tournament_players(id,tournament_id,user_id,status,current_bounty)
 VALUES('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001',
 '30000000-0000-0000-0000-000000000002','registered',1);
UPDATE union_wallets SET promo_wallet=0;
DO $$BEGIN
 BEGIN
  PERFORM fn_ca_midway_free_buy_promo_head('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002',false);
  RAISE EXCEPTION 'Insufficient funding was accepted' USING ERRCODE='XX000';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'Midway promo funds cannot fund this entry' THEN RAISE; END IF;
 END;
 IF (SELECT promo_wallet FROM union_wallets)<>0 OR (SELECT count(*) FROM chip_ledger)<>2
    OR (SELECT bounty_balance FROM tournament_escrow)<>0 THEN RAISE EXCEPTION 'Refusal changed money'; END IF;
END $$;
UPDATE union_wallets SET promo_wallet=10;
BEGIN;
SELECT fn_ca_midway_free_buy_promo_head('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002',false);
ROLLBACK;
DO $$BEGIN
 IF (SELECT promo_wallet FROM union_wallets)<>10 OR (SELECT count(*) FROM chip_ledger)<>2
    OR (SELECT bounty_balance FROM tournament_escrow)<>0 THEN RAISE EXCEPTION 'Interrupted registration did not roll back'; END IF;
 IF has_function_privilege('authenticated','fn_ca_midway_free_buy_promo_head(uuid,uuid,boolean)','execute')
    OR has_function_privilege('service_role','fn_ca_midway_free_buy_promo_head(uuid,uuid,boolean)','execute') THEN
   RAISE EXCEPTION 'Internal funding helper exposed';
 END IF;
END $$;
SELECT 'PASS: funded entry, replay, return, replayed return, insufficient funds, rollback, private helper';
