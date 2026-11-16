INSERT INTO clubs VALUES(md5('club')::uuid,'Fixture');
INSERT INTO profiles(id,alias) SELECT md5(x)::uuid,x FROM unnest(ARRAY['agent','child','grandchild','other'])x;
INSERT INTO club_members(user_id,club_id,role,agent_id,status) VALUES
 (md5('agent')::uuid,md5('club')::uuid,'agent',NULL,'active'),
 (md5('child')::uuid,md5('club')::uuid,'sub_agent',md5('agent')::uuid,'active'),
 (md5('grandchild')::uuid,md5('club')::uuid,'player',md5('child')::uuid,'active'),
 (md5('other')::uuid,md5('club')::uuid,'player',NULL,'active');
INSERT INTO member_record_daily_facts(club_id,user_id,played_on,game_variant,is_mtt,hands,net)
SELECT md5('club')::uuid,md5(u)::uuid,'2026-11-16','nlh',false,h,n FROM (VALUES('agent',2,10),('child',3,20),('grandchild',5,-7),('other',1000,1000))x(u,h,n);
INSERT INTO ca_club_rake_daily_user SELECT md5('club')::uuid,md5(u)::uuid,'2026-11-16',c FROM (VALUES('agent',101),('child',202),('grandchild',303),('other',100000))x(u,c);
INSERT INTO test_money SELECT md5('club')::uuid,md5(u)::uuid,'2026-11-16 16:00Z',m FROM (VALUES('agent',5),('child',-3),('grandchild',8),('other',9000))x(u,m);
INSERT INTO chip_ledger(club_id,to_entity_id,from_entity_id,to_type,from_type,status,amount,created_at) VALUES(md5('club')::uuid,md5('agent')::uuid,md5('club')::uuid,'agent_wallet','club_treasury','posted',50,'2026-11-16 16:00Z');
ALTER TABLE chip_ledger ADD COLUMN category text;UPDATE chip_ledger SET category='commission';
INSERT INTO chip_transactions(club_id,from_user_id,to_user_id,transaction_type,amount,created_at) VALUES(md5('club')::uuid,md5('agent')::uuid,md5('child')::uuid,'rakeback',10,'2026-11-16 16:01Z');
INSERT INTO chip_ledger(club_id,to_entity_id,from_entity_id,to_type,from_type,status,amount,created_at,category) VALUES(md5('club')::uuid,md5('child')::uuid,md5('agent')::uuid,'player_wallet','agent_wallet','posted',10,'2026-11-16 16:01Z','rakeback');
-- BREAKDOWN ASSERTIONS
DO $$DECLARE d jsonb;BEGIN
 d:=ca_club_member_detail(md5('club')::uuid,md5('agent')::uuid,'2026-11-16','2026-11-16');
 IF (d->'stats'->>'hands')::int<>2 OR (d->'activity_breakdown'->'downline'->>'hands')::int<>8 OR (d->'activity_breakdown'->'combined'->>'hands')::int<>10 THEN RAISE EXCEPTION 'individual/full recursive downline/combined hands: %',d;END IF;
 IF d->'activity_breakdown'->'combined'->>'total_fee_text'<>'6.06' OR (d->'activity_breakdown'->'combined'->>'mtt_winnings')::numeric<>10 THEN RAISE EXCEPTION 'group fees or winnings';END IF;
 IF (d->'stats'->>'claimed_back')::numeric<>50 OR (d->'stats'->>'sent_out')::numeric<>10 OR (d->'activity_breakdown'->'combined'->>'claimed_back')::numeric<>60 THEN RAISE EXCEPTION 'ledger commission/rakeback direction or internal duplicate';END IF;
 d:=ca_club_member_detail(md5('club')::uuid,md5('agent')::uuid,'2026-11-17','2026-11-17');
 IF (d->'activity_breakdown'->'combined'->>'hands')::int<>0 OR (d->'activity_breakdown'->'combined'->>'claimed_back')::numeric<>0 THEN RAISE EXCEPTION 'dates mixed';END IF;
 d:=ca_club_member_detail(md5('club')::uuid,md5('grandchild')::uuid,'2026-11-16','2026-11-16');
 IF d ? 'activity_breakdown' OR (d->'stats'->>'hands')::int<>5 THEN RAISE EXCEPTION 'player must be individual only';END IF;
 PERFORM set_config('test.access','identity',true);
 d:=ca_club_member_detail(md5('club')::uuid,md5('agent')::uuid,'2026-11-16','2026-11-16');
 IF d ? 'activity_breakdown' OR d->'stats'<>'null'::jsonb THEN RAISE EXCEPTION 'private breakdown leaked';END IF;
END$$;
SELECT 'PASS individual, recursive downline, combined, exact fees, dates, ledger earnings, ordinary-player and private access';
-- Cycle-safe unique ancestry, including more descendants than the visible page.
UPDATE club_members SET agent_id=md5('grandchild')::uuid WHERE user_id=md5('agent')::uuid;
INSERT INTO profiles(id,alias) SELECT md5('leaf-'||g)::uuid,'Leaf '||g FROM generate_series(1,51)g;
INSERT INTO club_members(user_id,club_id,role,agent_id,status) SELECT md5('leaf-'||g)::uuid,md5('club')::uuid,'player',md5('child')::uuid,'active' FROM generate_series(1,51)g;
INSERT INTO member_record_daily_facts(club_id,user_id,played_on,game_variant,is_mtt,hands,net) SELECT md5('club')::uuid,md5('leaf-'||g)::uuid,'2026-11-16','nlh',false,1,0 FROM generate_series(1,51)g;
DO $$DECLARE d jsonb;BEGIN
 d:=ca_club_member_detail(md5('club')::uuid,md5('agent')::uuid,'2026-11-16','2026-11-16');
 IF (d->'activity_breakdown'->'downline'->>'hands')::int<>59 OR (d->'activity_breakdown'->'combined'->>'hands')::int<>61 THEN RAISE EXCEPTION 'cycle, duplicate, or visible-page limit in hierarchy';END IF;
END$$;
SELECT 'PASS unique cycle-safe hierarchy with 53 descendants, beyond the 50 visible rows';

UPDATE member_record_daily_facts SET net=9007199254740993.12 WHERE user_id=md5('grandchild')::uuid;
DO $$DECLARE d jsonb;BEGIN
 d:=ca_club_member_detail(md5('club')::uuid,md5('agent')::uuid,'2026-11-16','2026-11-16');
 IF d->'activity_breakdown'->'combined'->>'total_winnings_text'<>'9007199254741023.12' THEN RAISE EXCEPTION 'aggregate lost decimal precision';END IF;
 IF has_function_privilege('authenticated','ca_member_activity_group(uuid,uuid[],date,date)','execute') OR has_function_privilege('authenticated','ca_member_activity_tx_totals(uuid,uuid[],timestamptz,timestamptz)','execute') THEN RAISE EXCEPTION 'private helper exposed';END IF;
END$$;
CREATE OR REPLACE FUNCTION ca_club_member_jackpot_money(uuid,uuid,timestamptz,timestamptz,text DEFAULT NULL) RETURNS numeric LANGUAGE sql STABLE AS $$SELECT CASE WHEN $2=md5('grandchild')::uuid THEN NULL::numeric ELSE 0::numeric END$$;
DO $$DECLARE d jsonb;BEGIN
 d:=ca_club_member_detail(md5('club')::uuid,md5('agent')::uuid,'2026-11-16','2026-11-16');
 IF d->'activity_breakdown'->'combined'->'total_winnings'<>'null'::jsonb OR d->'activity_breakdown'->'downline'->'total_winnings'<>'null'::jsonb THEN RAISE EXCEPTION 'unknown downline winnings coerced to zero';END IF;
END$$;
SELECT 'PASS exact aggregate decimal text, mirrored rakeback once, private helper ACL and unknown cash result propagation';

-- The same operation can book its receipt milliseconds after its wallet leg.
INSERT INTO chip_transactions(club_id,from_user_id,to_user_id,transaction_type,amount,created_at,metadata) VALUES(md5('club')::uuid,md5('agent')::uuid,md5('child')::uuid,'promo_wallet_send',50,'2026-11-16 16:02:00.0166Z',jsonb_build_object('source','promo_wallet','destination','player_wallet','op_id',md5('promo-op')::uuid::text));
INSERT INTO chip_ledger(club_id,to_entity_id,from_entity_id,to_type,from_type,status,amount,created_at,category,correlation_id) VALUES(md5('club')::uuid,md5('child')::uuid,md5('agent')::uuid,'player_wallet','promo_wallet','posted',50,'2026-11-16 16:02Z','promo_send',md5('promo-op')::uuid), (md5('club')::uuid,md5('child')::uuid,md5('agent')::uuid,'player_wallet','agent_wallet','posted',50,'2026-11-16 16:02Z','agent_send',md5('promo-op')::uuid);
DO $$DECLARE total numeric;BEGIN
 SELECT sent_out INTO total FROM ca_member_activity_tx_totals(md5('club')::uuid,ARRAY[md5('agent')::uuid],'2026-11-16 06:00Z','2026-11-17 06:00Z');
 IF total<>110 THEN RAISE EXCEPTION 'correlated promo mirror or distinct wallet counted incorrectly: %',total;END IF;
END$$;
SELECT 'PASS activity counts correlated millisecond transfer once and preserves distinct wallets';
