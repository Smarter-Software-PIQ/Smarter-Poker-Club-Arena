-- SUPERSEDED BY 20261109140919
-- The split return owns its wallet debit, even when its caller journals
-- the original payment explicitly. Keep the bank autoledger suppressed so
-- exactly one player-wallet -> club-treasury leg accounts for the return.
-- @live-proof: md5(pg_get_functiondef('public.fn_ca_horse_split_return_late_credit()'::regprocedure))='8c1170f0f4228359c95c20a6d3820948'
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
 IF md5(source) IS DISTINCT FROM '702e02688fc458ee7954baee99e0f65b'
 OR cardinality(string_to_array(source,before_line)) IS DISTINCT FROM 2
 OR cardinality(string_to_array(source,saved_before)) IS DISTINCT FROM 2 THEN
  RAISE EXCEPTION 'split_late_return_preimage_changed';
 END IF;
 EXECUTE replace(replace(source,before_line,after_line),saved_before,saved_after);
 IF md5(pg_get_functiondef('public.fn_ca_horse_split_return_late_credit()'::regprocedure))
    IS DISTINCT FROM '8c1170f0f4228359c95c20a6d3820948' THEN
  RAISE EXCEPTION 'split_late_return_postimage_changed';
 END IF;
END $patch$;
COMMIT;
