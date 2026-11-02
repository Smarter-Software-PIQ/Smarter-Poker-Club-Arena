BEGIN;
INSERT INTO clubs(id,asset,chip_treasury) VALUES ('00000000-0000-4000-8000-000000000002','chips',100000);
INSERT INTO union_wallets(union_id,chip_balance) VALUES ('00000000-0000-4000-8000-000000000003',100000);
INSERT INTO tournaments(id,club_id,union_id,name,status,prize_pool,guaranteed_prize,bounty_pool,variant)
VALUES ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','Fixture','REGISTERING',2470,5000,950,'bounty');
INSERT INTO tournament_escrow(tournament_id,enforced,gross_in,fee_entries_in,bounty_in,prize_balance,bounty_balance)
VALUES ('00000000-0000-4000-8000-000000000001',true,3800,380,950,2470,950);
UPDATE tournaments SET status='RUNNING';
DO $$ BEGIN
 IF (SELECT prize_pool+bounty_pool FROM tournaments) <> 5950 THEN RAISE EXCEPTION 'baseline did not reproduce 5950'; END IF;
 IF (SELECT overlay_in FROM tournament_escrow) <> 2530 THEN RAISE EXCEPTION 'baseline wrong overlay'; END IF;
END $$;
ROLLBACK;
