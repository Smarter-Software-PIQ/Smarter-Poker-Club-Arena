-- Both original P&L readers prove a tournament refund using the complete
-- ledger key, and cash funding using the original transaction and amount.
-- Preserve these statements and their proof-generation fingerprints.
-- @live-proof: (SELECT count(*)=2 FROM pg_index WHERE indexrelid IN (to_regclass('public.weekly_pnl_refund_entitlement_key'),to_regclass('public.weekly_pnl_cash_application_transaction')) AND indisvalid AND indisready AND indislive)
CREATE INDEX CONCURRENTLY IF NOT EXISTS weekly_pnl_refund_entitlement_key
 ON public.tournament_refund_entitlements (('tourney:' || tournament_id::text || ':refund-entitlement:' || id::text));
CREATE INDEX CONCURRENTLY IF NOT EXISTS weekly_pnl_cash_application_transaction
 ON public.cash_funding_application_receipts (transaction_id);
BEGIN;
SET LOCAL lock_timeout='1s';
-- New expression statistics let the planner estimate an exact ledger key.
ANALYZE public.tournament_refund_entitlements;
DO $verify$
BEGIN
 IF NOT EXISTS (SELECT FROM pg_index i WHERE i.indexrelid='public.weekly_pnl_refund_entitlement_key'::regclass
  AND i.indrelid='public.tournament_refund_entitlements'::regclass AND i.indisvalid AND i.indisready AND i.indislive
  AND i.indpred IS NULL AND i.indnatts=1 AND pg_get_indexdef(i.indexrelid,1,true)=
   $key$((('tourney:'::text || tournament_id::text) || ':refund-entitlement:'::text) || id::text)$key$)
 OR NOT EXISTS (SELECT FROM pg_index i WHERE i.indexrelid='public.weekly_pnl_cash_application_transaction'::regclass
  AND i.indrelid='public.cash_funding_application_receipts'::regclass AND i.indisvalid AND i.indisready AND i.indislive
  AND i.indpred IS NULL AND i.indnatts=1 AND pg_get_indexdef(i.indexrelid,1,true)='transaction_id') THEN
  RAISE EXCEPTION 'Weekly P&L original receipt lookup index does not match the required definition';
 END IF;
END $verify$;
COMMIT;
