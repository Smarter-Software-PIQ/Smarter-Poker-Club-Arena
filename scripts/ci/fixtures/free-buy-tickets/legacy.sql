-- Written BEFORE the candidate migration, under the rotation-era promo owner
-- (20261105035220): registrations that already exist when tickets ship.
-- Each was promo-funded with 1 chip at signup. Synthetic identities only.
BEGIN;
-- Opening balances are fixture state, not a chip movement: written with
-- triggers off so the conservation invariant judges only what follows.
SET LOCAL session_replication_role=replica;
UPDATE union_wallets SET promo_wallet=100000;
SET LOCAL session_replication_role=origin;
-- 300 players with 1,000 chips each (players 3 and 251 buy the rebuys: 5,000) in the Midway club.
INSERT INTO profiles(id,display_name,is_horse)
 SELECT ('40000000-0000-0000-0000-'||lpad(g::text,12,'0'))::uuid,'P'||g,false FROM generate_series(1,300) g;
INSERT INTO club_members(user_id,club_id,chip_balance)
 SELECT ('40000000-0000-0000-0000-'||lpad(g::text,12,'0'))::uuid,'fade0000-0000-0000-0000-000000000001',
        CASE WHEN g IN (3,251) THEN 5000 ELSE 1000 END
   FROM generate_series(1,300) g;

CREATE FUNCTION fixture_event(p_id uuid, p_name text, p_kind text, p_start timestamptz) RETURNS void
 LANGUAGE sql AS $$
 INSERT INTO tournaments(id,name,union_id,club_id,tournament_type,variant,free_buy,status,start_time,
   buy_in_amount,buy_in_fee,starting_chips,late_reg_levels,rebuy_levels,rebuy_chips,max_players,max_rebuys,max_reentries,
   is_bounty,is_pko,is_mystery_bounty,all_in_or_fold,prize_pool,bounty_pool,total_rake,current_players,
   format_contract,mystery_bounty_stage)
 VALUES(p_id,p_name,'fade0000-0000-0000-0000-000000000001','fade0000-0000-0000-0000-000000000001',
   'MTT','freezeout',true,'REGISTERING',p_start,0,0,3000,4,4,3000,NULL,NULL,NULL,
   p_kind IN ('pko','mystery'),p_kind='pko',p_kind='mystery',p_kind='aiof',0,0,0,0,'mtt-v2','pending');
 INSERT INTO tournament_escrow(tournament_id,enforced) VALUES(p_id,true);
$$;
CREATE FUNCTION fixture_register(p_t uuid, p_user uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE j jsonb;
BEGIN
 PERFORM set_config('fixture.uid',p_user::text,true);
 j:=fn_register_for_tournament_before_atomic_capacity_20260907(p_t,false);
 IF NOT COALESCE((j->>'ok')::boolean,false) THEN RAISE EXCEPTION 'registration % % refused: %',p_t,p_user,j; END IF;
 RETURN j;
END $$;

-- L1: All-In Or Fold, 500 guarantee, 3 pre-ticket entries (3 promo prize chips).
-- L2: Mystery, 2 pre-ticket entries (0.50 bounty + 0.50 prize each).
-- L3: All-In Or Fold, 500 guarantee, 3 pre-ticket entries; its players will
--     pay 600 in rebuys, so the 3 promo chips are more than U = 0.
SELECT fixture_event('50000000-0000-0000-0000-0000000000a1','Afternoon Free Buy (NLH)','aiof','2026-11-19 16:30 America/Chicago');
SELECT fixture_event('50000000-0000-0000-0000-0000000000a2','Prime Time Free Buy (NLH)','mystery','2026-11-19 20:30 America/Chicago');
SELECT fixture_event('50000000-0000-0000-0000-0000000000a3','Afternoon Free Buy (NLH)','aiof','2026-11-18 16:30 America/Chicago');
SELECT fixture_register('50000000-0000-0000-0000-0000000000a1',('40000000-0000-0000-0000-'||lpad(g::text,12,'0'))::uuid) FROM generate_series(1,3) g;
SELECT fixture_register('50000000-0000-0000-0000-0000000000a2',('40000000-0000-0000-0000-'||lpad(g::text,12,'0'))::uuid) FROM generate_series(1,2) g;
SELECT fixture_register('50000000-0000-0000-0000-0000000000a3',('40000000-0000-0000-0000-'||lpad(g::text,12,'0'))::uuid) FROM generate_series(1,3) g;
DO $$BEGIN
 IF (SELECT promo_wallet FROM union_wallets)<>100000-8
  OR (SELECT prize_pool FROM tournaments WHERE id='50000000-0000-0000-0000-0000000000a1')<>3
  OR (SELECT prize_pool FROM tournaments WHERE id='50000000-0000-0000-0000-0000000000a2')<>1
  OR (SELECT bounty_pool FROM tournaments WHERE id='50000000-0000-0000-0000-0000000000a2')<>1 THEN
  RAISE EXCEPTION 'Legacy opening is not the rotation-era 1-chip promo funding'; END IF;
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;
