-- Synthetic opening state, written BEFORE the candidate migration under the
-- live (November 2) Free Buy trigger, so every event starts in the PKO shape
-- production holds today. No production identity or player data.
BEGIN;
INSERT INTO clubs(id,name,asset,is_platform,union_id) VALUES
 ('fade0000-0000-0000-0000-000000000001','Midway','chips',false,'fade0000-0000-0000-0000-000000000001'),
 ('c0000000-0000-0000-0000-000000000009','Other Club','chips',false,NULL);
INSERT INTO union_wallets(union_id,chip_balance,promo_wallet) VALUES('fade0000-0000-0000-0000-000000000001',100000,100);
INSERT INTO profiles(id,display_name,is_horse) VALUES
 ('30000000-0000-0000-0000-000000000001','Human',false),
 ('30000000-0000-0000-0000-000000000002','Horse',true);
INSERT INTO club_members(user_id,club_id,chip_balance) VALUES
 ('30000000-0000-0000-0000-000000000001','fade0000-0000-0000-0000-000000000001',100),
 ('30000000-0000-0000-0000-000000000002','fade0000-0000-0000-0000-000000000001',100);
INSERT INTO tournaments(id,name,union_id,club_id,tournament_type,variant,free_buy,status,start_time,
  buy_in_amount,buy_in_fee,starting_chips,late_reg_levels,rebuy_levels,rebuy_chips,max_players,max_rebuys,max_reentries,
  is_bounty,is_pko,is_mystery_bounty,all_in_or_fold,prize_pool,bounty_pool,total_rake,current_players,
  format_contract,mystery_bounty_stage)
SELECT v.id::uuid,v.name,'fade0000-0000-0000-0000-000000000001','fade0000-0000-0000-0000-000000000001',
  'MTT','freezeout',true,'REGISTERING',now()+v.lead::interval,0,0,3000,12,12,3000,NULL,NULL,NULL,
  true,true,false,false,0,0,0,0,'mtt-v2','pending'
FROM (VALUES
 ('10000000-0000-0000-0000-000000000101','Morning Free Buy (NLH)','1 day'),
 ('10000000-0000-0000-0000-000000000102','Afternoon Free Buy (NLH)','1 day 8 hours'),
 ('10000000-0000-0000-0000-000000000103','Prime Time Free Buy (NLH)','1 day 12 hours'),
 ('10000000-0000-0000-0000-000000000104','Midday Free Buy (NLH)','1 day 4 hours'),
 ('10000000-0000-0000-0000-000000000105','Morning Free Buy (NLH)','2 days'),
 ('10000000-0000-0000-0000-000000000106','Midnight Free Buy (NLH)','16 hours')) v(id,name,lead);
INSERT INTO tournament_escrow(tournament_id,enforced) SELECT id,true FROM tournaments;
-- Event 105 already has an entrant: the reshape must skip it and it stays PKO.
INSERT INTO tournament_players(id,tournament_id,user_id,status,current_bounty,chips)
 VALUES('20000000-0000-0000-0000-000000000105','10000000-0000-0000-0000-000000000105',
 '30000000-0000-0000-0000-000000000001','registered',1,3000);
DO $$BEGIN
 IF EXISTS(SELECT 1 FROM tournaments WHERE NOT is_pko OR bounty_amount<>1 OR guaranteed_prize<>0
   OR add_on_available) THEN RAISE EXCEPTION 'Opening is not the live PKO shape'; END IF;
END $$;
COMMIT;
