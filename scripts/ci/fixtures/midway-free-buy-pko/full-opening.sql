BEGIN;
SET LOCAL session_replication_role=replica;
INSERT INTO auth.users(id) VALUES('2d1cd6c3-5700-4af9-a271-d4863fdab20d') ON CONFLICT DO NOTHING;
INSERT INTO public.users(id,username) VALUES('2d1cd6c3-5700-4af9-a271-d4863fdab20d','smarterpoker') ON CONFLICT DO NOTHING;
INSERT INTO public.clubs(id,club_id,name) VALUES('fade0000-0000-0000-0000-000000000001',991003,'Midway Native Fixture');
INSERT INTO public.unions(id,name,owner_id,slug) VALUES('fade0000-0000-0000-0000-000000000001','Midway Native Fixture','2d1cd6c3-5700-4af9-a271-d4863fdab20d','midway-native');
INSERT INTO public.union_wallets(union_id,promo_wallet) VALUES('fade0000-0000-0000-0000-000000000001',1000);
INSERT INTO public.tournaments(id,name,union_id,club_id,tournament_type,free_buy,is_pko,is_bounty,is_mystery_bounty,buy_in_amount,buy_in_fee,bounty_amount,guaranteed_prize,status,prize_pool,bounty_pool,total_rake,starting_chips,start_time,current_players,max_players,current_level,entry_contract_locked)
VALUES('10000000-0000-0000-0000-000000000001','Midway Full Native Free Buy','fade0000-0000-0000-0000-000000000001','fade0000-0000-0000-0000-000000000001','MTT',true,false,false,false,0,0,0,250,'REGISTERING',0,0,0,3000,now()+interval '1 day',412,1000,0,false);
INSERT INTO auth.users(id) SELECT md5('midway-native-'||g)::uuid FROM generate_series(1,412)g;
INSERT INTO public.users(id,username) SELECT md5('midway-native-'||g)::uuid,'midway_native_'||g FROM generate_series(1,412)g;
INSERT INTO public.profiles(id,username,display_name) SELECT md5('midway-native-'||g)::uuid,'midway_native_'||g,'Midway Native '||g FROM generate_series(1,412)g;
INSERT INTO public.tournament_players(id,tournament_id,user_id,status,current_bounty,chips)
SELECT md5('midway-registration-'||g)::uuid,'10000000-0000-0000-0000-000000000001',md5('midway-native-'||g)::uuid,'registered',0,3000 FROM generate_series(1,412)g;
COMMIT;
