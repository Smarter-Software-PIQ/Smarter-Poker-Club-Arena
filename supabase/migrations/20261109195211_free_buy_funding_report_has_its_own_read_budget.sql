-- 20261109195211_free_buy_funding_report_has_its_own_read_budget
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-09 19:52:11 UTC.
--
-- The signed Nov7 digest returned an unavailable report section: this read
-- inherits service_role's 8s statement budget although its measured query takes
-- 22.85s. Give only this report the same 60s budget as the player reports.
-- The assembler already has a shared 150s report budget and a 300s route limit.
-- No query, funding rule, ACL, global role setting or financial row changes.
-- @live-proof: (SELECT proconfig @> ARRAY['statement_timeout=60s'] AND md5(prosrc)='59f51949fde459c23eaeaaed636f0daa' FROM pg_proc WHERE oid='public.fn_sp_digest_free_buy_funding(date)'::regprocedure)

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '15s';
DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE oid='public.fn_sp_digest_free_buy_funding(date)'::regprocedure
      AND md5(pg_get_functiondef(oid))='6c8132b0872c00e85eaa46f1649ef797'
      AND md5(prosrc)='59f51949fde459c23eaeaaed636f0daa'
      AND proowner='postgres'::regrole AND prosecdef AND provolatile='s'
      AND proconfig=ARRAY['search_path=pg_catalog, public, smarter_private, pg_temp']
      AND proacl=ARRAY['postgres=X/postgres','service_role=X/postgres']::aclitem[]
  ) THEN RAISE EXCEPTION 'FUNDING_REPORT_BUDGET_PREIMAGE_CHANGED'; END IF;
END $guard$;

ALTER FUNCTION public.fn_sp_digest_free_buy_funding(date) SET statement_timeout = '60s';

DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE oid='public.fn_sp_digest_free_buy_funding(date)'::regprocedure
      AND md5(prosrc)='59f51949fde459c23eaeaaed636f0daa'
      AND proowner='postgres'::regrole AND prosecdef AND provolatile='s'
      AND proconfig=ARRAY['search_path=pg_catalog, public, smarter_private, pg_temp','statement_timeout=60s']
      AND proacl=ARRAY['postgres=X/postgres','service_role=X/postgres']::aclitem[]
  ) THEN RAISE EXCEPTION 'FUNDING_REPORT_BUDGET_POSTIMAGE_CHANGED'; END IF;
END $guard$;
COMMIT;
