-- @live-proof: (SELECT position('promo_position_left_behind_by_cash_seat_move' IN prosrc)>0 FROM pg_proc WHERE oid='smarter_private.hand_source_correction_claim_guard()'::regprocedure)
-- 20261121143102_a_feeder_promo_position_correction_may_claim_on_a_cash_table.sql
--
-- WHAT WAS WRONG
--
-- 20261121142714 certified cash hand dbbc148e #60380607 (submission
-- 9684692d), stranded when a feeder seat move left the player's promo
-- principal behind. The engine's resume then reaches the one correction claim
-- and smarter_private.hand_source_correction_claim_guard refuses it with
-- HAND_SOURCE_CORRECTION_LEASE_REFUSED (postgres_logs, every start since
-- 14:29 UTC): its cash branch admits only the two causes it names.
--
-- WHAT THIS CHANGES
--
-- The cash branch also admits a proof whose source_cause is
-- 'promo_position_left_behind_by_cash_seat_move' with proof_version
-- '20261121142714' (the frozen one-hand proof). Every other check stays as it
-- was: service role, proof re-derived and equal to the certified one, request
-- hash, same transaction, successor generation, not frozen, no tournament,
-- scope cash, and the caller holding a fresh protocol-2 table lease. Exact
-- preimage md5 + single anchor; owner/security/ACL/config unchanged.
--
-- One transaction (club-arena CLAUDE.md production DDL policy).

BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='60s';
SET LOCAL search_path=public;

DO $install$
DECLARE
 sig constant regprocedure:='smarter_private.hand_source_correction_claim_guard()'::regprocedure;
 o text:=$anchor$   OR (proof->>'source_cause'='fixed_limit_null_max_buy_in' AND proof->>'proof_version'='20261105041928'),
$anchor$;
 n text:=$anchor$   OR (proof->>'source_cause'='fixed_limit_null_max_buy_in' AND proof->>'proof_version'='20261105041928')
   -- The cash hand a feeder seat move's stale promo position stranded (2026-11-21).
   OR (proof->>'source_cause'='promo_position_left_behind_by_cash_seat_move' AND proof->>'proof_version'='20261121142714'),
$anchor$;
 d text; before jsonb;
BEGIN
 IF current_user<>'postgres' OR NULLIF(current_setting('request.jwt.claims',true),'') IS NOT NULL THEN RAISE EXCEPTION 'feeder_claim_guard_operator_refused' USING ERRCODE='42501';END IF;
 IF public.fn_platform_frozen() IS DISTINCT FROM false OR public.fn_active_maintenance_release_boundary() IS NOT NULL THEN RAISE EXCEPTION 'feeder_claim_guard_freeze_refused';END IF;
 IF NOT EXISTS(SELECT FROM supabase_migrations.schema_migrations WHERE version='20261121142714') THEN RAISE EXCEPTION 'feeder_claim_guard_proof_missing';END IF;
 d:=pg_get_functiondef(sig);
 IF md5(d)<>'6d11f37437c0906f2a2b58702e8cf6f7' THEN RAISE EXCEPTION 'feeder_claim_guard_preimage_refused';END IF;
 IF (length(d)-length(replace(d,o,'')))/length(o)<>1 THEN RAISE EXCEPTION 'feeder_claim_guard_anchor_refused';END IF;
 SELECT jsonb_build_array(pg_get_userbyid(p.proowner),p.prosecdef,p.provolatile,p.proacl::text,p.proconfig) INTO before FROM pg_proc p WHERE p.oid=sig;
 EXECUTE replace(d,o,n);
 d:=pg_get_functiondef(sig);
 IF position('promo_position_left_behind_by_cash_seat_move' IN d)=0 OR position('fixed_limit_null_max_buy_in' IN d)=0
 OR position('HAND_SOURCE_CORRECTION_LEASE_REFUSED' IN d)=0 OR position('engine_table_leases' IN d)=0 THEN RAISE EXCEPTION 'feeder_claim_guard_postimage_refused';END IF;
 IF (SELECT jsonb_build_array(pg_get_userbyid(p.proowner),p.prosecdef,p.provolatile,p.proacl::text,p.proconfig) FROM pg_proc p WHERE p.oid=sig) IS DISTINCT FROM before THEN RAISE EXCEPTION 'feeder_claim_guard_security_refused';END IF;
END $install$;

COMMIT;
