-- Build the wider equivalent before the daily cutover, through the existing
-- nonblocking index preamble. The original index remains active until the swap.
-- @live-proof: EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid='public.diamond_transactions'::regclass AND i.indisvalid AND (i.indexrelid=to_regclass('public.wheel_stage_trivia_family_created_idx') OR (i.indexrelid=to_regclass('public.diamond_transactions_trivia_family_created_idx') AND EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=i.indrelid AND attname='amount' AND atttypid='bigint'::regtype))))
CREATE INDEX CONCURRENTLY IF NOT EXISTS wheel_stage_trivia_family_created_idx ON public.diamond_transactions (created_at)
 WHERE wheel_amount64<>0 AND public.trivia_ledger_platform_family(coalesce(nullif(btrim(transaction_type),''),type),reference_id) IS NOT NULL;
BEGIN;
SET LOCAL lock_timeout='1s';
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_index s JOIN pg_index o ON o.indrelid=s.indrelid
  WHERE s.indexrelid='public.wheel_stage_trivia_family_created_idx'::regclass
   AND o.indexrelid='public.diamond_transactions_trivia_family_created_idx'::regclass
   AND s.indisvalid AND s.indisready AND o.indisvalid AND s.indkey=o.indkey
   AND replace(pg_get_expr(s.indpred,s.indrelid),'wheel_amount64','amount')=pg_get_expr(o.indpred,o.indrelid))
 THEN RAISE EXCEPTION 'The staged trivia reconciliation index does not match the canonical index'; END IF;
END $$;
COMMIT;
