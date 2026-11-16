-- Cash add-on application receipts are recorded when funding is applied or returned.
-- The production heap was 7.5 MiB. A short transactional build avoids the
-- unrelated old snapshots that interrupted concurrent validation; the limits
-- bound admission and execution for both a new installation and its recovery.
-- @live-proof: (SELECT indisvalid AND indisready AND indislive FROM pg_index WHERE indexrelid=to_regclass('public.weekly_pnl_cash_application_transaction') AND indrelid='public.cash_funding_application_receipts'::regclass AND pg_get_indexdef(indexrelid,1,true)='transaction_id')
BEGIN;
SET LOCAL lock_timeout='250ms';
SET LOCAL statement_timeout='2s';
DO $cash_index$
DECLARE
 idx regclass := to_regclass('public.weekly_pnl_cash_application_transaction');
 valid boolean;
BEGIN
 IF idx IS NULL THEN
  CREATE INDEX weekly_pnl_cash_application_transaction ON public.cash_funding_application_receipts(transaction_id);
 ELSE
  SELECT i.indisvalid INTO STRICT valid FROM pg_index i
   JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_am a ON a.oid=c.relam
   WHERE i.indexrelid=idx AND i.indrelid='public.cash_funding_application_receipts'::regclass
    AND i.indisready AND i.indislive AND NOT i.indisunique AND NOT i.indisexclusion
    AND a.amname='btree' AND i.indpred IS NULL AND i.indnatts=1
    AND pg_get_indexdef(i.indexrelid)='CREATE INDEX weekly_pnl_cash_application_transaction ON public.cash_funding_application_receipts USING btree (transaction_id)';
  IF NOT valid THEN
   REINDEX INDEX public.weekly_pnl_cash_application_transaction;
  END IF;
 END IF;
 IF NOT EXISTS(SELECT FROM pg_index i WHERE i.indexrelid='public.weekly_pnl_cash_application_transaction'::regclass
   AND i.indisvalid AND i.indisready AND i.indislive) THEN
  RAISE EXCEPTION 'Original cash application transaction index did not become valid';
 END IF;
END $cash_index$;
COMMIT;
