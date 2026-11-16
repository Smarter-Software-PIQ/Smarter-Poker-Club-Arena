-- The original tournament refund key is present in both certified P&L readers.
-- Publish its expression statistics independently of the cash funding index.
-- @live-proof: (SELECT indisvalid AND indisready AND indislive FROM pg_index WHERE indexrelid=to_regclass('public.weekly_pnl_refund_entitlement_key')) AND (EXISTS (SELECT FROM pg_stats WHERE schemaname='public' AND tablename='weekly_pnl_refund_entitlement_key') OR NOT EXISTS (SELECT FROM public.tournament_refund_entitlements))
CREATE INDEX CONCURRENTLY IF NOT EXISTS weekly_pnl_refund_entitlement_key
 ON public.tournament_refund_entitlements (('tourney:' || tournament_id::text || ':refund-entitlement:' || id::text));
BEGIN;
SET LOCAL lock_timeout='1s';
DO $verify$
BEGIN
 IF NOT EXISTS (SELECT FROM pg_index i WHERE i.indexrelid='public.weekly_pnl_refund_entitlement_key'::regclass
  AND i.indrelid='public.tournament_refund_entitlements'::regclass AND i.indisvalid AND i.indisready AND i.indislive
  AND i.indpred IS NULL AND i.indnatts=1 AND pg_get_indexdef(i.indexrelid,1,true)=
   $key$((('tourney:'::text || tournament_id::text) || ':refund-entitlement:'::text) || id::text)$key$) THEN
  RAISE EXCEPTION 'Weekly P&L refund entitlement index definition mismatch';
 END IF;
END $verify$;
ANALYZE public.tournament_refund_entitlements;
COMMIT;
