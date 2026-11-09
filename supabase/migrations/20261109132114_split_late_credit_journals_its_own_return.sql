-- Fix in place: this version was refused atomically and is not installed.
-- Preserve the concurrent 20261109132254 post-write skip clear; the debit
-- requires its own clear BEFORE its UPDATE, where the writer consumes it.
-- The split return owns its wallet debit, even when its caller journals
-- the original payment explicitly. Keep the bank autoledger suppressed so
-- exactly one player-wallet -> club-treasury leg accounts for the return.
-- @live-proof: md5(pg_get_functiondef('public.fn_ca_horse_split_return_late_credit()'::regprocedure))='c1b188449d3bd52568bc6cdd908dcb87'
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='8s';
DO $patch$
DECLARE
 source text:=pg_get_functiondef('public.fn_ca_horse_split_return_late_credit()'::regprocedure);
 before_line constant text:=$before$    PERFORM set_config('app.ledger_correlation', v_key::text, true);$before$;
 after_line constant text:=$after$    PERFORM set_config('app.ledger_correlation', v_key::text, true);
  -- This nested return owns its leg; the caller only owns the original credit.
  PERFORM set_config('app.ledger_autoskip_club_members','',true);$after$;
 saved_before constant text:=$saved_before$    'app.ledger_autoskip_club_members'];$saved_before$;
 saved_after constant text:=$saved_after$    'app.ledger_autoskip_club_members', 'app.cash_original_debit_ledger'];$saved_after$;
BEGIN
 IF md5(source) IS DISTINCT FROM 'e1bd766347c196e52e891da762e76403'
 OR cardinality(string_to_array(source,before_line)) IS DISTINCT FROM 2
 OR cardinality(string_to_array(source,saved_before)) IS DISTINCT FROM 2 THEN
  RAISE EXCEPTION 'split_late_return_preimage_changed';
 END IF;
 EXECUTE replace(replace(source,before_line,after_line),saved_before,saved_after);
 IF md5(pg_get_functiondef('public.fn_ca_horse_split_return_late_credit()'::regprocedure))
    IS DISTINCT FROM 'c1b188449d3bd52568bc6cdd908dcb87' THEN
  RAISE EXCEPTION 'split_late_return_postimage_changed';
 END IF;
END $patch$;
COMMIT;
