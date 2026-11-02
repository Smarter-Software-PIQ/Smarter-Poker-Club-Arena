-- Exercise the exact maintained operation and actual enabled guard functions.
SET ROLE postgres;
SET test.role='authenticated';
DO $$ BEGIN
 BEGIN
  UPDATE tournaments SET prize_pool=4050;
  RAISE EXCEPTION 'unreceipted correction passed';
 EXCEPTION WHEN check_violation THEN NULL; END;
 PERFORM set_config('app.owner_bounty_guarantee_correction','tourney:6b72abc3-bd16-488c-aea5-54b1eace98d5:owner_bounty_guarantee_20261102',false);
 BEGIN
  UPDATE tournaments SET prize_pool=4050;
  RAISE EXCEPTION 'GUC-only correction passed';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
-- Inject a journal refusal after the source-bank credit. The owning operation
-- must abort everything, including the bank, escrow, ladder and close receipt.
CREATE FUNCTION reject_owner_correction_journal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'native injected correction journal failure'; END $$;
CREATE TRIGGER reject_owner_correction_journal BEFORE INSERT ON chip_ledger
FOR EACH ROW WHEN (NEW.metadata->>'kind'='owner_bounty_guarantee_correction')
EXECUTE FUNCTION reject_owner_correction_journal();
\set ON_ERROR_STOP off
\ir ../../scripts/operations/owner-bounty-guarantee-6b72abc3.sql
COMMIT;
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF (SELECT chip_balance FROM union_wallets)<>100000
 OR (SELECT prize_pool FROM tournaments)<>5000
 OR (SELECT overlay_in FROM tournament_escrow)<>2530
 OR (SELECT prize_balance FROM tournament_escrow)<>4720.5
 OR (SELECT final_prize_pool FROM tournament_entry_close_receipts)<>5000
 OR EXISTS(SELECT 1 FROM chip_ledger WHERE metadata->>'kind'='owner_bounty_guarantee_correction')
 THEN RAISE EXCEPTION 'journal failure left a partial correction'; END IF;
END $$;
DROP TRIGGER reject_owner_correction_journal ON chip_ledger;
DROP FUNCTION reject_owner_correction_journal();
\ir ../../scripts/operations/owner-bounty-guarantee-6b72abc3.sql
DO $$ BEGIN
 IF (SELECT prize_pool+bounty_pool FROM tournaments)<>5000
  OR (SELECT prize_balance FROM tournament_escrow)<>3770.5
  OR (SELECT overlay_in FROM tournament_escrow)<>1580
  OR (SELECT chip_balance FROM union_wallets)<>100950
  OR (SELECT final_prize_pool FROM tournament_entry_close_receipts)<>4050
  OR (SELECT sum(amount) FROM fn_ca_tournament_place_amounts('6b72abc3-bd16-488c-aea5-54b1eace98d5'))<>4050
  OR (SELECT amount FROM fn_ca_tournament_place_amounts('6b72abc3-bd16-488c-aea5-54b1eace98d5') WHERE place=15)<>136
  OR (SELECT amount FROM fn_ca_tournament_place_amounts('6b72abc3-bd16-488c-aea5-54b1eace98d5') WHERE place=14)<>143.5
 THEN RAISE EXCEPTION 'correction conservation or paid awards failed'; END IF;
 BEGIN
  UPDATE tournaments SET guaranteed_prize=4000;
  RAISE EXCEPTION 'unrelated contract change passed';
 EXCEPTION WHEN check_violation OR raise_exception THEN
  IF SQLERRM='unrelated contract change passed' THEN RAISE; END IF;
 END;
END $$;
COMMIT;
-- Same operation identity must not refund another950 on replay.
\ir ../../scripts/operations/owner-bounty-guarantee-6b72abc3.sql
DO $$ BEGIN
 IF (SELECT chip_balance FROM union_wallets)<>100950
 OR (SELECT count(*) FROM chip_ledger WHERE metadata->>'kind'='owner_bounty_guarantee_correction')<>1
 THEN RAISE EXCEPTION 'replay duplicated return'; END IF;
END $$;
ROLLBACK;
