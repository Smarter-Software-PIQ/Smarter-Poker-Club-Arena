-- @live-proof: (SELECT position('fixed_limit_null_max_buy_in' IN prosrc)>0 FROM pg_proc WHERE oid='smarter_private.hand_source_correction_claim_guard()'::regprocedure)
-- 20261105051411_a_fixed_limit_null_cap_correction_may_claim_on_a_cash_table.sql
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-05.
--
-- WHAT WAS WRONG
--
-- 20261105041928 certified the 8 fixed-limit cash hands stranded by the JSON-null
-- max_buy_in refusal (installed 05:10 UTC; all 8 proofs re-derive identically).
-- The engine's resume then reaches the one correction claim, and the claim
-- trigger smarter_private.hand_source_correction_claim_guard refuses it:
-- postgres_logs show HAND_SOURCE_CORRECTION_LEASE_REFUSED on every start since.
-- Its cash branch admits exactly one source cause, 'backup_residue_constraint'
-- (cash_original17, 20261013035113), and additionally requires
-- cash_original17_fixed_sources_match(), which no longer holds. So no other cash
-- correction can ever claim, and the 8 FLH/FLO8 tables keep restart-looping.
--
-- WHAT THIS CHANGES
--
-- The cash branch admits either the original cause under its original
-- condition (unchanged) OR a proof whose source_cause is
-- 'fixed_limit_null_max_buy_in' with proof_version '20261105041928' (the frozen
-- 8-hand proof). Every other check stays as it was: service role, proof
-- re-derived and equal to the certified one, request hash, same transaction,
-- successor generation, not frozen, no tournament, scope cash, and the caller
-- holding a fresh protocol-2 table lease. Exact preimage md5 + single anchor;
-- owner/security/ACL/config unchanged.
--
-- One transaction (club-arena CLAUDE.md production DDL policy).

BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='60s';
SET LOCAL search_path=public;

DO $install$
DECLARE
 sig constant regprocedure:='smarter_private.hand_source_correction_claim_guard()'::regprocedure;
 o text:=$anchor$  OR proof->>'source_cause' IS DISTINCT FROM 'backup_residue_constraint'
  OR smarter_private.cash_original17_fixed_sources_match() IS DISTINCT FROM true
$anchor$;
 n text:=$anchor$  OR NOT COALESCE(
   (proof->>'source_cause'='backup_residue_constraint' AND smarter_private.cash_original17_fixed_sources_match() IS TRUE)
   -- The 8 fixed-limit hands the JSON-null max buy-in refusal stranded (2026-11-05).
   OR (proof->>'source_cause'='fixed_limit_null_max_buy_in' AND proof->>'proof_version'='20261105041928'),
   false)
$anchor$;
 d text; before jsonb;
BEGIN
 IF current_user<>'postgres' OR NULLIF(current_setting('request.jwt.claims',true),'') IS NOT NULL THEN RAISE EXCEPTION 'fl_claim_guard_operator_refused' USING ERRCODE='42501';END IF;
 IF public.fn_platform_frozen() IS DISTINCT FROM false OR public.fn_active_maintenance_release_boundary() IS NOT NULL THEN RAISE EXCEPTION 'fl_claim_guard_freeze_refused';END IF;
 IF NOT EXISTS(SELECT FROM supabase_migrations.schema_migrations WHERE version='20261105041928') THEN RAISE EXCEPTION 'fl_claim_guard_proof_missing';END IF;
 d:=pg_get_functiondef(sig);
 IF md5(d)<>'80bfaa3c60aef42e7ccf1963036edbc6' THEN RAISE EXCEPTION 'fl_claim_guard_preimage_refused';END IF;
 IF (length(d)-length(replace(d,o,'')))/length(o)<>1 THEN RAISE EXCEPTION 'fl_claim_guard_anchor_refused';END IF;
 SELECT jsonb_build_array(pg_get_userbyid(p.proowner),p.prosecdef,p.provolatile,p.proacl::text,p.proconfig) INTO before FROM pg_proc p WHERE p.oid=sig;
 EXECUTE replace(d,o,n);
 d:=pg_get_functiondef(sig);
 IF position('fixed_limit_null_max_buy_in' IN d)=0 OR position($q$'backup_residue_constraint' AND smarter_private.cash_original17_fixed_sources_match() IS TRUE$q$ IN d)=0
 OR position('HAND_SOURCE_CORRECTION_LEASE_REFUSED' IN d)=0 OR position('engine_table_leases' IN d)=0 THEN RAISE EXCEPTION 'fl_claim_guard_postimage_refused';END IF;
 IF (SELECT jsonb_build_array(pg_get_userbyid(p.proowner),p.prosecdef,p.provolatile,p.proacl::text,p.proconfig) FROM pg_proc p WHERE p.oid=sig) IS DISTINCT FROM before THEN RAISE EXCEPTION 'fl_claim_guard_security_refused';END IF;
END $install$;

COMMIT;
