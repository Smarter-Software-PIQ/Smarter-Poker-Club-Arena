-- SECOND HALF of the 2026-11-09 union round-3 refusal (first half: the
-- balance model expects the split late returns, 20261109123440). With the
-- player-wallet model fixed, the batch now reaches commit and the deferred
-- ledger-conservation guard refuses the CLUB TREASURY instead:
-- balance_moved_without_its_ledger_row, club_treasury a0000000..., off by
-- exactly that club's split late returns (601.94). Standalone, each return
-- writes one chip_ledger leg (player_wallet -> club_treasury, category
-- club_bank_claim; 636 historical rows confirm it, latest 03:14Z today).
-- Inside the rakeback stage's transaction the stage has stood the
-- autoledger down for club_members with its own declared member legs, and
-- fn_ca_horse_split_return_late_credit clears only
-- app.ledger_autoskip_clubs before writing its chip_transactions record, so
-- the member side of its leg stays suppressed and the leg never lands:
-- the treasury's balance moves with no leg and the whole batch is refused
-- at commit, outside the trigger's own deferral handler. The trigger
-- already saves and restores BOTH autoskip keys; it just never needed to
-- clear the member one standalone, where it is empty anyway. This
-- migration clears app.ledger_autoskip_club_members alongside the existing
-- clubs clear, immediately before the trigger's record insert. Standalone
-- behavior is unchanged (the key is already empty there); inside any
-- foreign door the return's leg now writes, and both account guards
-- balance. Dan's 2026-11-03 ruling is preserved exactly: the late prize
-- still returns to the club bank, receipted.
-- @live-proof: position('app.ledger_autoskip_club_members'', '''', true);' in pg_get_functiondef('public.fn_ca_horse_split_return_late_credit()'::regprocedure)) > 0
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $patch$
DECLARE
 src text;
 needle text := $o$    PERFORM set_config('app.ledger_autoskip_clubs', '', true);$o$;
 repl text := $n$    PERFORM set_config('app.ledger_autoskip_clubs', '', true);
    PERFORM set_config('app.ledger_autoskip_club_members', '', true);$n$;
BEGIN
 src := pg_get_functiondef('public.fn_ca_horse_split_return_late_credit()'::regprocedure);
 IF md5(src) IS DISTINCT FROM '702e02688fc458ee7954baee99e0f65b' THEN
  RAISE EXCEPTION 'split_return_trigger_preimage_changed md5=%', md5(src);
 END IF;
 IF (length(src)-length(replace(src,needle,'')))/length(needle) <> 1 THEN
  RAISE EXCEPTION 'expected exactly one autoskip_clubs clear';
 END IF;
 src := replace(src, needle, repl);
 EXECUTE src;
 src := pg_get_functiondef('public.fn_ca_horse_split_return_late_credit()'::regprocedure);
 IF position($p$'app.ledger_autoskip_club_members', '', true$p$ in src) = 0 THEN
  RAISE EXCEPTION 'postimage missing member autoskip clear';
 END IF;
END $patch$;
COMMIT;
