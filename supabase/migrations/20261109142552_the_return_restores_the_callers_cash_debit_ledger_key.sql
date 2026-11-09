-- RECONCILIATION with 20261109132114 (PR #10164), which REFUSED on install
-- at 2026-11-09 14:09Z with split_late_return_preimage_changed: it was
-- authored against preimage 702e02688fc458ee7954baee99e0f65b, but
-- 20261109132254 had already changed fn_ca_horse_split_return_late_credit
-- four minutes earlier. Its first intent - the single wallet->bank return
-- leg - is delivered by 20261109140919 (PR #10167), which clears
-- app.ledger_autoskip_club_members immediately before the member debit.
-- This migration carries 20261109132114's second, still-missing intent:
-- 'app.cash_original_debit_ledger' joins the return trigger's saved and
-- restored caller keys, so the autoledger leg the return now writes can
-- never leave a caller's declared cash-debit journal state changed, even
-- across multiple returns in one transaction. 20261109132114 itself is
-- marked SUPERSEDED BY 20261109140919 in the same pull request.
-- @live-proof: md5(pg_get_functiondef('public.fn_ca_horse_split_return_late_credit()'::regprocedure))='b4d29a312a1d98b8a1b9c9ef7d0bb19b'
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $patch$
DECLARE
 src text;
 needle text := $o$'app.ledger_autoskip_club_members'];$o$;
 repl text := $n$'app.ledger_autoskip_club_members', 'app.cash_original_debit_ledger'];$n$;
BEGIN
 src := pg_get_functiondef('public.fn_ca_horse_split_return_late_credit()'::regprocedure);
 IF md5(src) = 'e1bd766347c196e52e891da762e76403' THEN
  RAISE EXCEPTION 'requires 20261109140919 installed first (function is still at its preimage)';
 END IF;
 IF md5(src) IS DISTINCT FROM 'b4d29a312a1d98b8a1b9c9ef7d0bb19b' THEN
  RAISE EXCEPTION 'split_return_trigger_preimage_changed md5=%', md5(src);
 END IF;
 IF (length(src)-length(replace(src,needle,'')))/length(needle) <> 1 THEN
  RAISE EXCEPTION 'expected exactly one saved-keys terminator';
 END IF;
 EXECUTE replace(src, needle, repl);
 IF md5(pg_get_functiondef('public.fn_ca_horse_split_return_late_credit()'::regprocedure))
    IS DISTINCT FROM '11e4e7463bc340aae5a503fdde91aca7' THEN
  RAISE EXCEPTION 'split_return_trigger_postimage_changed';
 END IF;
END $patch$;
COMMIT;
