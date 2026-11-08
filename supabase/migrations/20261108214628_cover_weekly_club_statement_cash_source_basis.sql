-- 20261108214628_cover_weekly_club_statement_cash_source_basis
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-08 21:46:28 UTC.
--
-- The first Midway visit after bounding the private deposit proof recorded
-- a timeout in the club statement's original source totals and fingerprint.
-- The same read for the week ending October 26 timed out at 120 seconds.
-- Its plan estimated 1.35 million cash heap rows for one club. An existing
-- club-week cover lacks union_id, which the statement needs to distinguish
-- union and private rake. Cover the exact scope and scalar proof columns.
-- The original source views, authorization, fingerprint and totals stay intact.
-- @live-proof: EXISTS(SELECT 1 FROM pg_index i WHERE i.indexrelid=to_regclass('public.accounting_cash_weekly_statement_basis_cover') AND i.indrelid='public.accounting_cash_rake_sources'::regclass AND i.indisvalid AND i.indisready AND i.indislive AND pg_get_indexdef(i.indexrelid)='CREATE INDEX accounting_cash_weekly_statement_basis_cover ON public.accounting_cash_rake_sources USING btree (club_id, coordinator_union_id, earned_at) INCLUDE (id, rake_record_id, union_id, rake_credit)')

CREATE INDEX CONCURRENTLY IF NOT EXISTS accounting_cash_weekly_statement_basis_cover
 ON public.accounting_cash_rake_sources (club_id, coordinator_union_id, earned_at)
 INCLUDE (id, rake_record_id, union_id, rake_credit);

BEGIN;
SET LOCAL statement_timeout = '8s';
SET LOCAL lock_timeout = '1s';
SET LOCAL search_path = pg_catalog, public;

DO $weekly_statement_basis_cover$
BEGIN
  IF session_user<>'postgres' OR current_user<>'postgres'
     OR NULLIF(current_setting('request.jwt.claims',true),'') IS NOT NULL
     OR public.fn_platform_frozen() IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'WEEKLY_STATEMENT_BASIS_COVER_OPERATOR_OR_FREEZE_REFUSED';
  END IF;
  IF md5(pg_get_functiondef('public.fn_club_weekly_accounting_summary(uuid)'::regprocedure))
     IS DISTINCT FROM '0b5f87114dd95cb3f2b9802f20a564ec'
     OR md5(pg_get_viewdef('public.accounting_payable_earning_sources'::regclass,true))
     IS DISTINCT FROM '4b5df14ee82835c51a81745b0d1be413'
     OR md5(pg_get_viewdef('public.accounting_effective_cash_rake_sources'::regclass,true))
     IS DISTINCT FROM '47a6e58eed8d5b3656869164d52a3b52' THEN
    RAISE EXCEPTION 'WEEKLY_STATEMENT_BASIS_COVER_SOURCE_CHANGED';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
    WHERE i.indexrelid=to_regclass('public.accounting_cash_weekly_statement_basis_cover')
      AND i.indrelid='public.accounting_cash_rake_sources'::regclass
      AND c.relowner='postgres'::regrole AND c.relkind='i' AND c.relpersistence='p'
      AND c.reloptions IS NULL AND i.indisvalid AND i.indisready AND i.indislive
      AND NOT i.indisunique AND NOT i.indisprimary AND NOT i.indisexclusion
      AND pg_get_indexdef(i.indexrelid)='CREATE INDEX accounting_cash_weekly_statement_basis_cover ON public.accounting_cash_rake_sources USING btree (club_id, coordinator_union_id, earned_at) INCLUDE (id, rake_record_id, union_id, rake_credit)'
  ) THEN
    RAISE EXCEPTION 'WEEKLY_STATEMENT_BASIS_COVER_EXACT_INDEX_REQUIRED';
  END IF;
END
$weekly_statement_basis_cover$;

COMMIT;
