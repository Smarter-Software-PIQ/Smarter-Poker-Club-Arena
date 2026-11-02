BEGIN;
INSERT INTO clubs(id,asset,chip_treasury) VALUES ('00000000-0000-4000-8000-000000000002','chips',100000);
INSERT INTO union_wallets(union_id,chip_balance) VALUES ('00000000-0000-4000-8000-000000000003',100000);
INSERT INTO tournaments(id,club_id,union_id,name,status,prize_pool,guaranteed_prize,bounty_pool,variant,buy_in_amount,buy_in_fee)
VALUES ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','Fixture','REGISTERING',104,5000,40,'bounty',36,4);
INSERT INTO tournament_escrow(tournament_id,enforced,gross_in,fee_entries_in,bounty_in,prize_balance,bounty_balance)
VALUES ('00000000-0000-4000-8000-000000000001',true,160,16,40,104,40);
UPDATE tournaments SET status='RUNNING';
DO $$ BEGIN
 IF (SELECT prize_pool+bounty_pool FROM tournaments) <> 5000 THEN RAISE EXCEPTION 'start guarantee added bounties twice'; END IF;
 IF (SELECT overlay_in FROM tournament_escrow) <> 4856 THEN RAISE EXCEPTION 'start funding differs'; END IF;
END $$;
-- 91 later entries follow the same escrow rail; 95 total at 40 with 4 rake.
SELECT fn_ca_escrow_apply('00000000-0000-4000-8000-000000000001','late entries',p_gross_in=>3640,p_fee_entries_in=>364,p_bounty_in=>910);
UPDATE tournaments SET prize_pool=prize_pool+2366,bounty_pool=bounty_pool+910;
SELECT fn_ca_return_excess_start_overlay_locked('00000000-0000-4000-8000-000000000001');
DO $$ DECLARE result jsonb; BEGIN
 result:=fn_ca_apply_prize_guarantee_core('00000000-0000-4000-8000-000000000001','native fixture');
 IF result->>'ok' <> 'true' THEN RAISE EXCEPTION 'finalize refused %',result; END IF;
 IF (SELECT prize_pool FROM tournaments) <> 4050 OR (SELECT bounty_pool FROM tournaments) <> 950 THEN RAISE EXCEPTION 'expected4050+950'; END IF;
 IF (SELECT overlay_in FROM tournament_escrow) <> 1580 OR (SELECT prize_balance FROM tournament_escrow) <>4050 THEN RAISE EXCEPTION 'escrow disagrees'; END IF;
 IF (SELECT chip_balance FROM union_wallets) <> 98420 THEN RAISE EXCEPTION 'bank must fund1580'; END IF;
 result:=fn_ca_tournament_prize_funding('00000000-0000-4000-8000-000000000001');
 IF (result->>'collected')::numeric<>3420 OR (result->>'overlay')::numeric<>1580 THEN RAISE EXCEPTION 'funding summary wrong %',result; END IF;
 -- Replay cannot return/debit another chip.
 PERFORM fn_ca_return_excess_start_overlay_locked('00000000-0000-4000-8000-000000000001');
 result:=fn_ca_apply_prize_guarantee_core('00000000-0000-4000-8000-000000000001','native replay');
 IF result->>'ok'<>'true' OR (SELECT chip_balance FROM union_wallets)<>98420 OR (SELECT count(*) FROM chip_ledger)<>2 THEN RAISE EXCEPTION 'replay moved money %',result; END IF;
 IF fn_ca_place_guarantee(5000,0)<>5000 OR fn_ca_place_guarantee(500,950)<>0 THEN RAISE EXCEPTION 'boundary'; END IF;
END $$;
-- Private aggregate access is refused without membership; service role is read-only.
UPDATE tournaments SET is_private=true;
SET LOCAL test.role='authenticated';
DO $$ BEGIN IF fn_ca_tournament_prize_funding('00000000-0000-4000-8000-000000000001') IS NOT NULL THEN RAISE EXCEPTION 'private funding leaked'; END IF; END $$;
ROLLBACK;

-- Finalization without a start overlay exercises the actual bank debit core,
-- its journal and escrow assertions, including an injected journal refusal.
BEGIN;
INSERT INTO clubs(id,asset,chip_treasury) VALUES ('00000000-0000-4000-8000-000000000002','chips',100000);
INSERT INTO union_wallets(union_id,chip_balance) VALUES ('00000000-0000-4000-8000-000000000003',100000);
INSERT INTO tournaments(id,club_id,union_id,name,status,prize_pool,guaranteed_prize,bounty_pool,variant)
VALUES ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','Fixture','RUNNING',2470,5000,950,'bounty');
INSERT INTO tournament_escrow(tournament_id,enforced,gross_in,fee_entries_in,bounty_in,prize_balance,bounty_balance)
VALUES ('00000000-0000-4000-8000-000000000001',true,3800,380,950,2470,950);
CREATE FUNCTION pg_temp.refuse_journal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected journal failure'; END $$;
CREATE TRIGGER refuse_journal BEFORE INSERT ON chip_ledger FOR EACH ROW EXECUTE FUNCTION pg_temp.refuse_journal();
DO $$ DECLARE result jsonb; BEGIN
 result:=fn_ca_apply_prize_guarantee_core('00000000-0000-4000-8000-000000000001','fault');
 IF result->>'ok'<>'false' OR (SELECT chip_balance FROM union_wallets)<>100000 OR (SELECT prize_pool FROM tournaments)<>2470 OR EXISTS(SELECT 1 FROM tournament_guarantee_overlays) THEN RAISE EXCEPTION 'failed journal retained side effects %',result; END IF;
END $$;
DROP TRIGGER refuse_journal ON chip_ledger;
DO $$ DECLARE result jsonb; BEGIN
 result:=fn_ca_apply_prize_guarantee_core('00000000-0000-4000-8000-000000000001','success');
 IF result->>'ok'<>'true' OR (result->>'overlay')::numeric<>1580 OR (SELECT chip_balance FROM union_wallets)<>98420 OR (SELECT prize_balance FROM tournament_escrow)<>4050 THEN RAISE EXCEPTION 'atomic funding failed %',result; END IF;
END $$;
ROLLBACK;
