\set ON_ERROR_STOP on
INSERT INTO union_wallets(union_id,promo_wallet) VALUES('fade0000-0000-0000-0000-000000000001',1000);
INSERT INTO tournaments(id,union_id,club_id,tournament_type,free_buy,is_pko,is_bounty,is_mystery_bounty,
 buy_in_amount,buy_in_fee,bounty_amount,guaranteed_prize,status,prize_pool,bounty_pool)
VALUES('10000000-0000-0000-0000-000000000001','fade0000-0000-0000-0000-000000000001',
 'fade0000-0000-0000-0000-000000000001','MTT',true,false,false,false,0,0,0,500,'REGISTERING',0,0);
INSERT INTO tournament_escrow(tournament_id,enforced) VALUES('10000000-0000-0000-0000-000000000001',true);
INSERT INTO tournament_players(id,tournament_id,user_id,status,current_bounty)
SELECT gen_random_uuid(),'10000000-0000-0000-0000-000000000001',gen_random_uuid(),'registered',0 FROM generate_series(1,412);
DO $$BEGIN
 BEGIN
  UPDATE tournaments SET guaranteed_prize=0;
  RAISE EXCEPTION 'Ordinary registered guarantee change was accepted';
 EXCEPTION WHEN check_violation OR raise_exception THEN
  IF SQLERRM='Ordinary registered guarantee change was accepted' THEN RAISE; END IF;
 END;
END $$;
\timing on
BEGIN;
DO $$BEGIN
 IF fn_ca_convert_midway_free_buy('10000000-0000-0000-0000-000000000001')<>412 THEN
  RAISE EXCEPTION 'Wrong conversion count'; END IF;
 IF (SELECT promo_wallet FROM union_wallets)<>588
    OR (SELECT bounty_balance FROM tournament_escrow)<>412
    OR (SELECT prize_balance FROM tournament_escrow)<>0
    OR (SELECT fee_balance FROM tournament_escrow)<>0
    OR (SELECT sum(current_bounty) FROM tournament_players)<>412
    OR (SELECT count(*) FROM chip_ledger WHERE performed_by IS NOT NULL)<>412 THEN
   RAISE EXCEPTION 'Conversion did not conserve promo-funded heads'; END IF;
 IF fn_ca_convert_midway_free_buy('10000000-0000-0000-0000-000000000001')<>0 THEN
   RAISE EXCEPTION 'Duplicate conversion moved money'; END IF;
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
DO $$BEGIN
 IF (SELECT promo_wallet FROM union_wallets)<>1000 OR (SELECT count(*) FROM chip_ledger)<>0
    OR (SELECT sum(current_bounty) FROM tournament_players)<>0
    OR (SELECT guaranteed_prize FROM tournaments)<>500 THEN
   RAISE EXCEPTION 'Conversion rollback was incomplete'; END IF;
END $$;
SELECT 'PASS: 412-entry conversion with actual ledger tally and registered-contract guards, replay, and rollback';

DO $$DECLARE old_row jsonb; new_row jsonb;
BEGIN
 SELECT to_jsonb(t) INTO old_row FROM tournaments t;
 new_row:=old_row||'{"is_bounty":true,"is_pko":true,"is_mystery_bounty":false,"bounty_amount":1,"guaranteed_prize":0,"is_rebuy":true,"is_reentry":true,"rebuy_cost":1,"add_on_available":false,"addon_from_start":false,"addon_cost":null,"addon_chips":null,"addon_levels":null}'::jsonb;
 IF fn_ca_midway_free_buy_conversion_transition(old_row,new_row) THEN RAISE EXCEPTION 'Transition accepted without owning context'; END IF;
 PERFORM set_config('app.midway_free_buy_conversion',old_row->>'id',true);
 IF NOT fn_ca_midway_free_buy_conversion_transition(old_row,new_row) THEN RAISE EXCEPTION 'Exact transition refused'; END IF;
 IF fn_ca_midway_free_buy_conversion_transition(old_row,new_row||'{"starting_chips":999999}'::jsonb)
    OR fn_ca_midway_free_buy_conversion_transition(old_row||'{"status":"RUNNING"}'::jsonb,new_row||'{"status":"RUNNING"}'::jsonb)
    OR fn_ca_midway_free_buy_conversion_transition(old_row,new_row||'{"rebuy_cost":2}'::jsonb) THEN
   RAISE EXCEPTION 'Conversion exception admits an unrelated rule change'; END IF;
 IF has_function_privilege('service_role','fn_ca_convert_midway_free_buy(uuid)','EXECUTE')
    OR has_function_privilege('authenticated','fn_ca_convert_midway_free_buy(uuid)','EXECUTE') THEN
   RAISE EXCEPTION 'Private migration converter is remotely callable'; END IF;
END $$;
SELECT 'PASS: conversion authority is exact, pre-start and private';
