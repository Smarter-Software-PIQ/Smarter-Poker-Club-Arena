-- Version reserved by scripts/reserve-migration-version.sh against protected main and worktrees.
-- The original weekly union P&L report (fn_union_pnl_evidence_report) proves
-- each club's generated rake by reading the week's payable earning sources of
-- the Union (the "rake" CTE before the pnl_clubs certificate). For Midway Union
-- that is ~4.5 million cash rake sources a week, read through
-- accounting_cash_rake_sources_bank_period (union_id, earned_at) and then the
-- 34 GB heap for id, club_id and rake_credit: measured read-only on production
-- 2026-10-31 at 110.2 seconds. With the report's other uncached guards (~125 s)
-- in front of it, every 240-second close attempt is cancelled before pnl_clubs
-- is certified, so the 2026-10-19..26 book (money already paid) can never close
-- its settlement marks, ECO invoices and statements, and every later Midway
-- week would deadlock the same way.
-- The table's catalog reports 98.2 percent all-visible pages, so a covering
-- index lets the same original query use visibility-safe index-only access.
--
-- No function, view, source generation, financial rule, receipt, cache or
-- budget changes. The installer guard pins the original report, the three
-- source views and the inventory generation exactly. Native qualification
-- (scripts/ci/test-union-week-rake-cover-postgres.py) checks the original
-- query's full result bag before/after, the covering index-only plan, a
-- committed-change visibility fallback, and refusal of wrong leftovers.
-- The maintained concurrent-preamble installer protects live writers.
-- @live-proof: EXISTS(SELECT 1 FROM pg_index i WHERE i.indexrelid=to_regclass('public.accounting_cash_union_week_rake_cover') AND i.indrelid='public.accounting_cash_rake_sources'::regclass AND i.indisvalid AND i.indisready AND i.indislive AND NOT i.indisunique AND i.indnkeyatts=2 AND i.indnatts=5)
CREATE INDEX CONCURRENTLY IF NOT EXISTS accounting_cash_union_week_rake_cover
 ON public.accounting_cash_rake_sources (union_id, earned_at) INCLUDE(id, club_id, rake_credit) WHERE (union_id IS NOT NULL);

BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';
SET LOCAL search_path=pg_catalog,public;

DO $original_authority$
BEGIN
 IF session_user<>'postgres' OR current_user<>'postgres'
  OR NULLIF(current_setting('request.jwt.claims',true),'') IS NOT NULL
  OR public.fn_platform_frozen() IS DISTINCT FROM false THEN
  RAISE EXCEPTION 'union_week_rake_cover_operator_or_freeze_refused';
 END IF;
 IF smarter_private.original_inventory_proof_sources_match() IS DISTINCT FROM true
  OR smarter_private.original_inventory_basis_generation() IS DISTINCT FROM
   'original-inventory-245-v1:05f51b14eb6ebcb361fd88f7ba7a7343'
  OR md5(pg_get_functiondef('public.fn_union_pnl_evidence_report(uuid,timestamptz,timestamptz)'::regprocedure))
   IS DISTINCT FROM 'ca8931142b7e8ad6bbac07bd0913d268'
  OR md5(pg_get_viewdef('public.accounting_payable_earning_sources'::regclass)) IS DISTINCT FROM 'c71b1095aacf430538f9247f350dfd54'
  OR md5(pg_get_viewdef('public.accounting_effective_cash_rake_sources'::regclass)) IS DISTINCT FROM '141fcabcfe9af1057fdb16fad212d65c'
  OR md5(pg_get_viewdef('public.accounting_effective_tournament_fee_sources'::regclass)) IS DISTINCT FROM '0cfaf19d80c2371877064502abd15dfa' THEN
  RAISE EXCEPTION 'union_week_rake_cover_original_authority_changed';
 END IF;
END $original_authority$;

DO $exact_index$
BEGIN
 IF NOT EXISTS(
  SELECT FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
   JOIN pg_am a ON a.oid=c.relam
  WHERE i.indexrelid=to_regclass('public.accounting_cash_union_week_rake_cover')
   AND i.indrelid='public.accounting_cash_rake_sources'::regclass
   AND c.relowner='postgres'::regrole AND c.relkind='i' AND c.relpersistence='p'
   AND c.reloptions IS NULL AND a.amname='btree'
   AND i.indisvalid AND i.indisready AND i.indislive AND i.indimmediate
   AND NOT i.indisunique AND NOT i.indisprimary AND NOT i.indisexclusion
   AND NOT i.indnullsnotdistinct AND i.indnkeyatts=2 AND i.indnatts=5
   AND i.indexprs IS NULL
   AND pg_get_expr(i.indpred,i.indrelid)='(union_id IS NOT NULL)'
   AND i.indkey[0]=(SELECT attnum FROM pg_attribute WHERE attrelid=i.indrelid AND attname='union_id' AND NOT attisdropped)
   AND i.indkey[1]=(SELECT attnum FROM pg_attribute WHERE attrelid=i.indrelid AND attname='earned_at' AND NOT attisdropped)
   AND i.indkey[2]=(SELECT attnum FROM pg_attribute WHERE attrelid=i.indrelid AND attname='id' AND NOT attisdropped)
   AND i.indkey[3]=(SELECT attnum FROM pg_attribute WHERE attrelid=i.indrelid AND attname='club_id' AND NOT attisdropped)
   AND i.indkey[4]=(SELECT attnum FROM pg_attribute WHERE attrelid=i.indrelid AND attname='rake_credit' AND NOT attisdropped)
   AND i.indoption[0]=0 AND i.indoption[1]=0
 ) THEN RAISE EXCEPTION 'union_week_rake_cover_exact_valid_shape_required'; END IF;
END $exact_index$;

COMMENT ON INDEX public.accounting_cash_union_week_rake_cover IS
 'Original weekly union P&L report: visibility-safe id/club/rake coverage for the unchanged union-week payable-source read; no payment or evidence-generation change.';
COMMIT;
