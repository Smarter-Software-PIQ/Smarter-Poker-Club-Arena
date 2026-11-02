-- Version reserved by scripts/reserve-migration-version.sh against protected main and worktrees.
-- THE HORSE CLUB SPLIT'S MONEY FUNCTIONS ARE REGISTERED BEFORE THEY EXIST (2026-11-02).
--
-- Apply Merged Migration refused 20261102141229_horses_belong_to_one_assigned_club
-- at 16:04Z with "fn_ca_horse_split_wallet_leg writes balance columns and is not
-- in ca_money_rpc_registry" (ab_ca_money_rpc_registered). The whole transaction
-- rolled back; nothing was installed. That migration's two money functions are
-- registered here, so its merged bytes install unchanged on the next dispatch:
--
--   fn_ca_horse_split_wallet_leg   - one Club Bank claim or send leg for the
--     owner-ordered horse club split: horse player wallet or agent wallet into
--     its own club bank, or 10,000 from the assigned club bank; declared ledger
--     category and correlation, chip_transactions row on a deterministic op id,
--     a receipt row per leg; revoked from every role but the owner.
--   fn_ca_horse_club_split_execute - the split operation: refuses until the
--     week's payout has released, the fleet is off and no horse holds a seat,
--     entry, cashout, escrow or ticket; departs with records retained, joins the
--     assigned club at zero, mints only the verified shortfall within the
--     operator cap, funds each horse through the leg above; trusted callers only.
--
-- DML only: no DDL, no schema reload.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';

INSERT INTO public.ca_money_rpc_registry(proname, status, notes) VALUES
 ('fn_ca_horse_split_wallet_leg', 'approved',
  'Horse club split (Dan 2026-11-02): one Club Bank claim/send leg, declared ledger + correlation, chip_transactions op id, receipt row; owner-only execute.'),
 ('fn_ca_horse_club_split_execute', 'approved',
  'Horse club split (Dan 2026-11-02): preconditioned on the week payout and a drained fleet; records-retained departures, assigned-club joins at zero, capped shortfall mint, 10,000 per horse; trusted callers only.')
ON CONFLICT (proname) DO NOTHING;

DO $guard$ BEGIN
  IF (SELECT count(*) FROM public.ca_money_rpc_registry
       WHERE proname IN ('fn_ca_horse_split_wallet_leg','fn_ca_horse_club_split_execute') AND status='approved') <> 2 THEN
    RAISE EXCEPTION 'horse_club_split_money_functions_not_registered' USING ERRCODE='42501';
  END IF;
END $guard$;
COMMIT;
