-- Rotation cases, run after the exact candidate migration. One transaction;
-- the deferred ledger invariant is forced at the end, before COMMIT.
BEGIN;
CREATE FUNCTION pg_temp.agree(t uuid,label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE e tournament_escrow%ROWTYPE; s record; r tournaments%ROWTYPE;
BEGIN
 SELECT * INTO e FROM tournament_escrow WHERE tournament_id=t;
 SELECT * INTO s FROM fn_ca_tournament_escrow_chips(t);
 SELECT * INTO r FROM tournaments WHERE id=t;
 IF r.prize_pool IS DISTINCT FROM e.prize_balance OR r.bounty_pool IS DISTINCT FROM e.bounty_balance
    OR r.total_rake<>0 OR e.fee_balance<>0
    OR s.prize_balance IS DISTINCT FROM e.prize_balance OR s.bounty_balance IS DISTINCT FROM e.bounty_balance
    OR s.fee_balance IS DISTINCT FROM e.fee_balance THEN
  RAISE EXCEPTION '% escrow disagreement: pools %/% escrow %/%/% shadow %/%/%',label,
   r.prize_pool,r.bounty_pool,e.prize_balance,e.bounty_balance,e.fee_balance,
   s.prize_balance,s.bounty_balance,s.fee_balance;
 END IF;
END $$;
CREATE FUNCTION pg_temp.expect(t uuid,label text,prize numeric,bounty numeric) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_temp.agree(t,label);
 IF (SELECT prize_pool FROM tournaments WHERE id=t)<>prize OR (SELECT bounty_pool FROM tournaments WHERE id=t)<>bounty THEN
  RAISE EXCEPTION '% pools are %/%, expected %/%',label,(SELECT prize_pool FROM tournaments WHERE id=t),
   (SELECT bounty_pool FROM tournaments WHERE id=t),prize,bounty;
 END IF;
END $$;

-- 1. The reshape: three unregistered events took their slot format; the
-- registered one and the PKO slots did not change.
DO $$BEGIN
 IF fn_ca_midway_free_buy_format('10000000-0000-0000-0000-000000000101')<>'regular'
  OR fn_ca_midway_free_buy_format('10000000-0000-0000-0000-000000000102')<>'aiof'
  OR fn_ca_midway_free_buy_format('10000000-0000-0000-0000-000000000103')<>'mystery'
  OR fn_ca_midway_free_buy_format('10000000-0000-0000-0000-000000000104')<>'pko'
  OR fn_ca_midway_free_buy_format('10000000-0000-0000-0000-000000000105')<>'pko'
  OR fn_ca_midway_free_buy_format('10000000-0000-0000-0000-000000000106')<>'pko'
  OR NOT fn_ca_midway_free_buy_pko('10000000-0000-0000-0000-000000000104')
  OR fn_ca_midway_free_buy_pko('10000000-0000-0000-0000-000000000101') THEN
  RAISE EXCEPTION 'Reshape formats wrong'; END IF;
 IF NOT EXISTS(SELECT 1 FROM tournaments WHERE id='10000000-0000-0000-0000-000000000101'
   AND guaranteed_prize=250 AND add_on_available AND addon_from_start AND addon_cost=1 AND addon_chips=3000
   AND addon_levels=1 AND rebuy_levels=12 AND rebuy_cost=1 AND bounty_amount=0 AND NOT all_in_or_fold
   AND short_description LIKE 'Free Entry. Midway Promo Funds Your Entry. 250 Chip Guarantee.%')
 OR NOT EXISTS(SELECT 1 FROM tournaments WHERE id='10000000-0000-0000-0000-000000000102'
   AND guaranteed_prize=500 AND all_in_or_fold AND NOT add_on_available AND addon_cost IS NULL
   AND short_description LIKE 'All-In Or Fold.%')
 OR NOT EXISTS(SELECT 1 FROM tournaments WHERE id='10000000-0000-0000-0000-000000000103'
   AND guaranteed_prize=0 AND variant='mystery_bounty' AND bounty_amount=0.50 AND mystery_bounty_min=0.25
   AND mystery_bounty_max=5 AND mystery_bounty_pool_percent=100 AND mystery_bounty_regular_pool_percent=0
   AND add_on_available AND addon_from_start AND addon_levels=1 AND short_description LIKE 'Mystery Bounty.%') THEN
  RAISE EXCEPTION 'Reshaped column shape wrong'; END IF;
END $$;
DO $$BEGIN
 IF has_function_privilege('authenticated','fn_ca_midway_free_buy_format(uuid)','execute')
  OR has_function_privilege('anon','fn_ca_midway_free_buy_format(uuid)','execute')
  OR NOT has_function_privilege('service_role','fn_ca_midway_free_buy_format(uuid)','execute')
  OR has_function_privilege('service_role','fn_ca_midway_free_buy_promo_head(uuid,uuid,boolean)','execute')
  OR has_function_privilege('authenticated','smarter_private.daily_window_start_carveout(uuid,uuid,text,time)','execute') THEN
  RAISE EXCEPTION 'Execution boundaries changed'; END IF;
END $$;
SELECT 'PASS: reshape (regular/aiof/mystery; PKO slots and the registered event unchanged)';

-- 2. Registration: human and horse, one promo chip each, into the right pool(s).
DO $$DECLARE t uuid; j jsonb; tid text[]:=ARRAY['101','102','103','104'];
 exp numeric[][]:=ARRAY[[2,0],[2,0],[1,1],[0,2]]; i int; before numeric;
BEGIN
 FOR i IN 1..4 LOOP
  t:=('10000000-0000-0000-0000-000000000'||tid[i])::uuid;
  before:=(SELECT promo_wallet FROM union_wallets);
  PERFORM set_config('fixture.uid','30000000-0000-0000-0000-000000000001',true);
  j:=fn_register_for_tournament_before_atomic_capacity_20260907(t,false);
  IF NOT (j->>'ok')::boolean OR (j->>'cost')::numeric<>0 OR (j->>'rake')::numeric<>0 THEN RAISE EXCEPTION 'human % %',tid[i],j; END IF;
  j:=fn_register_horse_for_tournament_before_maintenance_gate(t,'30000000-0000-0000-0000-000000000002');
  IF NOT (j->>'ok')::boolean THEN RAISE EXCEPTION 'horse % %',tid[i],j; END IF;
  IF (SELECT promo_wallet FROM union_wallets)<>before-2 THEN RAISE EXCEPTION 'promo debit % wrong',tid[i]; END IF;
  IF (SELECT count(*) FROM chip_ledger WHERE tournament_id=t AND metadata->>'kind'='midway_free_buy_promo_head'
      AND category='promo_send' AND amount=1)<>2 THEN RAISE EXCEPTION 'promo journal % wrong',tid[i]; END IF;
  PERFORM pg_temp.expect(t,'registration '||tid[i],exp[i][1],exp[i][2]);
 END LOOP;
 IF (SELECT sum(chip_balance) FROM club_members)<>200 THEN RAISE EXCEPTION 'A free entry charged a wallet'; END IF;
 IF (SELECT current_bounty FROM tournament_players WHERE tournament_id='10000000-0000-0000-0000-000000000103' LIMIT 1)<>0.50
  OR (SELECT current_bounty FROM tournament_players WHERE tournament_id='10000000-0000-0000-0000-000000000104' LIMIT 1)<>1
 THEN RAISE EXCEPTION 'Bounty heads wrong'; END IF;
END $$;
SELECT 'PASS: registration (human + horse) promo-funds 1 chip: regular/aiof prize, mystery 0.50/0.50, pko bounty';

-- 3. Player-wallet rebuy and add-on, zero fee, into the right pool(s).
INSERT INTO tables(id,tournament_id,status) SELECT gen_random_uuid(),id,'active' FROM tournaments WHERE id::text ~ '10[1-4]$';
INSERT INTO table_seats(id,table_id,user_id,stack,joined_at)
 SELECT gen_random_uuid(),tb.id,'30000000-0000-0000-0000-000000000001',0,now() FROM tables tb;
DO $$DECLARE t uuid; j jsonb; tid text[]:=ARRAY['101','102','103','104'];
 exp numeric[][]:=ARRAY[[4,0],[3,0],[2,2],[0,3]]; i int; refused boolean;
BEGIN
 PERFORM set_config('fixture.uid','30000000-0000-0000-0000-000000000001',true);
 FOR i IN 1..4 LOOP
  t:=('10000000-0000-0000-0000-000000000'||tid[i])::uuid;
  j:=fn_ca_process_tournament_chip_purchase_money_v1(t,'30000000-0000-0000-0000-000000000001','rebuy',1,3000,1,'tok-'||tid[i]);
  IF (j->>'fee')::numeric<>0 OR (j->>'cost')::numeric<>1 THEN RAISE EXCEPTION 'rebuy % %',tid[i],j; END IF;
  refused:=false;
  BEGIN
   j:=fn_ca_process_tournament_chip_purchase_money_v1(t,'30000000-0000-0000-0000-000000000001','addon',1,3000,1,'tok-a-'||tid[i]);
   IF (j->>'fee')::numeric<>0 THEN RAISE EXCEPTION 'addon fee % %',tid[i],j; END IF;
  EXCEPTION WHEN raise_exception THEN
   IF SQLERRM<>'Add-ons are not offered in this tournament' THEN RAISE; END IF; refused:=true;
  END;
  IF refused<>(tid[i] IN ('102','104')) THEN RAISE EXCEPTION 'add-on availability wrong for %',tid[i]; END IF;
  PERFORM pg_temp.expect(t,'purchases '||tid[i],exp[i][1],exp[i][2]);
 END LOOP;
 IF (SELECT chip_balance FROM club_members WHERE user_id='30000000-0000-0000-0000-000000000001')<>94
  OR EXISTS(SELECT 1 FROM rake_records) THEN RAISE EXCEPTION 'Wallet debit or fee wrong'; END IF;
 IF NOT EXISTS(SELECT 1 FROM tournament_refund_entitlements WHERE tournament_id='10000000-0000-0000-0000-000000000103'
     AND charge_category='addon' AND refund_prize=0.50 AND refund_bounty=0.50 AND refund_fee=0)
  OR NOT EXISTS(SELECT 1 FROM tournament_refund_entitlements WHERE tournament_id='10000000-0000-0000-0000-000000000103'
     AND charge_category='rebuy' AND refund_prize=0.50 AND refund_bounty=0.50 AND refund_fee=0)
  OR NOT EXISTS(SELECT 1 FROM tournament_refund_entitlements WHERE tournament_id='10000000-0000-0000-0000-000000000101'
     AND charge_category='addon' AND refund_prize=1 AND refund_bounty=0 AND refund_fee=0)
  OR NOT EXISTS(SELECT 1 FROM tournament_refund_entitlements WHERE tournament_id='10000000-0000-0000-0000-000000000102'
     AND charge_category='rebuy' AND refund_prize=1 AND refund_bounty=0 AND refund_fee=0)
  OR NOT EXISTS(SELECT 1 FROM tournament_refund_entitlements WHERE tournament_id='10000000-0000-0000-0000-000000000104'
     AND charge_category='rebuy' AND refund_prize=0 AND refund_bounty=1 AND refund_fee=0) THEN
  RAISE EXCEPTION 'Refund entitlements do not carry the format split'; END IF;
END $$;
SELECT 'PASS: rebuys and add-ons from the player wallet, zero fee: regular/aiof prize, mystery 0.50/0.50 (add-on too), pko bounty; aiof/pko refuse add-ons';

-- 4. Unplayed cancellation returns the promo chip from the same components.
DO $$DECLARE t uuid; reg uuid; tid text[]:=ARRAY['101','102','103','104'];
 exp numeric[][]:=ARRAY[[3,0],[2,0],[1.5,1.5],[0,2]]; i int; before numeric; first numeric; again numeric;
BEGIN
 FOR i IN 1..4 LOOP
  t:=('10000000-0000-0000-0000-000000000'||tid[i])::uuid;
  SELECT id INTO reg FROM tournament_players WHERE tournament_id=t AND user_id='30000000-0000-0000-0000-000000000002';
  before:=(SELECT promo_wallet FROM union_wallets);
  first:=fn_ca_midway_free_buy_promo_head(t,reg,true); again:=fn_ca_midway_free_buy_promo_head(t,reg,true);
  IF first<>1 OR again<>0 OR (SELECT promo_wallet FROM union_wallets)<>before+1 THEN
   RAISE EXCEPTION 'return % wrong: % then %, wallet % from %',tid[i],first,again,(SELECT promo_wallet FROM union_wallets),before; END IF;
  PERFORM pg_temp.expect(t,'return '||tid[i],exp[i][1],exp[i][2]);
 END LOOP;
END $$;
SELECT 'PASS: unplayed return credits the promo wallet once and reverses the same pool components; escrow shadow agrees';

-- 5. Shapes: a registered event stays frozen; an unregistered one follows the engine.
SET LOCAL ROLE service_role;
UPDATE tournaments SET is_pko=false,is_bounty=false,add_on_available=true WHERE id='10000000-0000-0000-0000-000000000105';
UPDATE tournaments SET is_mystery_bounty=true,is_bounty=true,add_on_available=false WHERE id='10000000-0000-0000-0000-000000000101';
INSERT INTO tournaments(id,name,union_id,club_id,tournament_type,variant,free_buy,status,start_time,buy_in_amount,
  buy_in_fee,starting_chips,late_reg_levels,rebuy_levels,is_bounty,is_pko,is_mystery_bounty,all_in_or_fold,format_contract)
 VALUES('10000000-0000-0000-0000-000000000107','Afternoon Free Buy (NLH)','fade0000-0000-0000-0000-000000000001',
  'fade0000-0000-0000-0000-000000000001','MTT','freezeout',true,'REGISTERING',now()+interval '3 days',0,0,3000,12,12,
  true,true,false,false,'mtt-v2'),
 ('10000000-0000-0000-0000-000000000108','Morning Free Buy (NLH)','fade0000-0000-0000-0000-000000000001',
  'fade0000-0000-0000-0000-000000000001','MTT','freezeout',true,'REGISTERING',now()+interval '3 days',0,0,3000,12,12,
  false,false,false,false,'mtt-v2');
UPDATE tournaments SET is_pko=false,is_bounty=false,all_in_or_fold=true,add_on_available=false
 WHERE id='10000000-0000-0000-0000-000000000107';
RESET ROLE;
DO $$BEGIN
 IF fn_ca_midway_free_buy_format('10000000-0000-0000-0000-000000000105')<>'pko'
  OR fn_ca_midway_free_buy_format('10000000-0000-0000-0000-000000000101')<>'regular'
  OR (SELECT add_on_available FROM tournaments WHERE id='10000000-0000-0000-0000-000000000101') IS NOT TRUE
  OR (SELECT add_on_available FROM tournaments WHERE id='10000000-0000-0000-0000-000000000105') IS NOT FALSE THEN
  RAISE EXCEPTION 'A registered event changed format'; END IF;
 IF fn_ca_midway_free_buy_format('10000000-0000-0000-0000-000000000107')<>'aiof'
  OR (SELECT guaranteed_prize FROM tournaments WHERE id='10000000-0000-0000-0000-000000000107')<>500
  OR fn_ca_midway_free_buy_format('10000000-0000-0000-0000-000000000108')<>'regular'
  OR (SELECT guaranteed_prize FROM tournaments WHERE id='10000000-0000-0000-0000-000000000108')<>250 THEN
  RAISE EXCEPTION 'An unregistered event did not take the engine format'; END IF;
END $$;
SET LOCAL ROLE service_role;
UPDATE tournaments SET is_mystery_bounty=true,is_pko=false,add_on_available=true WHERE id='10000000-0000-0000-0000-000000000107';
RESET ROLE;
DO $$BEGIN
 IF fn_ca_midway_free_buy_format('10000000-0000-0000-0000-000000000107')<>'mystery'
  OR NOT EXISTS(SELECT 1 FROM tournaments WHERE id='10000000-0000-0000-0000-000000000107' AND guaranteed_prize=0
    AND bounty_amount=0.50 AND NOT all_in_or_fold AND addon_levels=1 AND mystery_bounty_regular_pool_percent=0) THEN
  RAISE EXCEPTION 'Unregistered aiof did not become mystery'; END IF;
END $$;
SELECT 'PASS: registered events stay frozen; an unregistered PKO row follows the engine to aiof, regular and mystery';

-- 6. The one daily-window carve-out.
DO $$DECLARE m jsonb:=jsonb_build_object('clubId','fade0000-0000-0000-0000-000000000001',
  'unionId','fade0000-0000-0000-0000-000000000001','name','Midnight Free Buy (NLH)','config','{}'::jsonb,
  'timeZone','America/Chicago','startTimesUtc',jsonb_build_array('00:30'));
BEGIN
 PERFORM set_config('fixture.uid','30000000-0000-0000-0000-000000000001',true);
 IF fn_upsert_tournament_schedule(m)->>'error'='tournament_start_outside_daily_hours'
  OR fn_upsert_tournament_schedule(m||jsonb_build_object('startTimesUtc',jsonb_build_array('01:00')))->>'error'<>'tournament_start_outside_daily_hours'
  OR fn_upsert_tournament_schedule(m||jsonb_build_object('name','Graveyard'))->>'error'<>'tournament_start_outside_daily_hours'
  OR fn_upsert_tournament_schedule(m||jsonb_build_object('clubId','c0000000-0000-0000-0000-000000000009','unionId',NULL))->>'error'<>'tournament_start_outside_daily_hours'
  OR fn_upsert_tournament_schedule(m||jsonb_build_object('startTimesUtc',jsonb_build_array('05:30'),'timeZone','UTC'))->>'error'<>'tournament_start_outside_daily_hours'
 THEN RAISE EXCEPTION 'Daily window carve-out is not exactly the Midway Midnight 00:30'; END IF;
END $$;
SELECT 'PASS: schedule writer admits only the Midway Midnight Free Buy at 00:30 Chicago';
SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;
SELECT 'PASS: ledger/store conservation held at commit';
