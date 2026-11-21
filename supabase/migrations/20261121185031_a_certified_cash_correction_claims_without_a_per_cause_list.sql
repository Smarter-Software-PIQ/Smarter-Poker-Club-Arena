-- @live-proof: (SELECT position('ANY_CERTIFIED_CASH_CORRECTION_V1' IN prosrc)>0 AND position('promo_position_left_behind_by_cash_seat_move' IN prosrc)>0 FROM pg_proc WHERE oid='smarter_private.hand_source_correction_claim_guard()'::regprocedure)
-- 20261121185031_a_certified_cash_correction_claims_without_a_per_cause_list.sql
--
-- WHAT WAS WRONG (incident 887c0008 recovery, 2026-11-21)
--
-- Settling one stranded cash hand took THREE migrations during an outage:
--   20261121142714 wrote the frozen one-hand proof, hooked it into the
--                  dispatcher original_hand_source_correction_proof and
--                  certified the submission;
--   20261121143102 then had to add the SAME cause to a hard-coded list inside
--                  smarter_private.hand_source_correction_claim_guard, because
--                  the guard's cash branch admitted only the causes it named,
--                  and every engine start until then failed with
--                  HAND_SOURCE_CORRECTION_LEASE_REFUSED (table dbbc148e stayed
--                  down for those extra minutes).
-- The list added no protection the certification did not already give:
--   * a certification row (hand_submission_source_corrections) can be written
--     only by postgres, i.e. only by a migration;
--   * the guard already re-derives the proof through the dispatcher and
--     requires it to EQUAL the certified one, and the dispatcher returns a
--     proof only for the exact submissions its frozen proof functions pin.
-- So the list was a third copy of a decision two pinned places already made,
-- and forgetting it turned a finished recovery into a second outage.
--
-- WHAT THIS CHANGES (the line that produced it)
--
-- The cash branch admits:
--   * backup_residue_constraint exactly as before (it alone carries an extra
--     live condition, cash_original17_fixed_sources_match());
--   * the two causes it already named, exactly as before;
--   * ANY OTHER certified cash proof whose source_cause is a plain identifier
--     and whose proof_version is a 14-digit migration version, i.e. a proof
--     that a migration froze and certified.
-- Every other check is unchanged: service role, proof re-derived and equal to
-- the certified one, request hash, same transaction, successor generation, not
-- frozen, no tournament, scope 'cash', and a fresh protocol-2 table lease held
-- by the caller. Exact preimage md5 + single anchor; owner, security, ACL and
-- config unchanged. Tournament branch untouched.
--
-- One transaction (club-arena CLAUDE.md production DDL policy).

BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='60s';
SET LOCAL search_path=public;

DO $install$
DECLARE
 sig constant regprocedure:='smarter_private.hand_source_correction_claim_guard()'::regprocedure;
 o text:=$anchor$   OR (proof->>'source_cause'='promo_position_left_behind_by_cash_seat_move' AND proof->>'proof_version'='20261121142714'),
   false)
$anchor$;
 n text:=$anchor$   OR (proof->>'source_cause'='promo_position_left_behind_by_cash_seat_move' AND proof->>'proof_version'='20261121142714')
   -- ANY_CERTIFIED_CASH_CORRECTION_V1 (2026-11-21): any other cause a migration
   -- froze and certified. Certification is postgres-only and the proof above is
   -- re-derived and must equal it, so no per-cause list is kept here.
   OR (COALESCE(proof->>'source_cause','')<>'backup_residue_constraint'
       AND COALESCE(proof->>'source_cause','') ~ '^[a-z][a-z0-9_]{2,119}$'
       AND COALESCE(proof->>'proof_version','') ~ '^[0-9]{14}$'),
   false)
$anchor$;
 d text; before jsonb;
BEGIN
 IF current_user<>'postgres' OR NULLIF(current_setting('request.jwt.claims',true),'') IS NOT NULL THEN RAISE EXCEPTION 'certified_cash_claim_operator_refused' USING ERRCODE='42501';END IF;
 IF public.fn_platform_frozen() IS DISTINCT FROM false OR public.fn_active_maintenance_release_boundary() IS NOT NULL THEN RAISE EXCEPTION 'certified_cash_claim_freeze_refused';END IF;
 d:=pg_get_functiondef(sig);
 IF md5(d)<>'e5b531a56e0c67c85f183a6a6e116aec' THEN RAISE EXCEPTION 'certified_cash_claim_preimage_refused';END IF;
 IF (length(d)-length(replace(d,o,'')))/length(o)<>1 THEN RAISE EXCEPTION 'certified_cash_claim_anchor_refused';END IF;
 SELECT jsonb_build_array(pg_get_userbyid(p.proowner),p.prosecdef,p.provolatile,p.proacl::text,p.proconfig) INTO before FROM pg_proc p WHERE p.oid=sig;
 EXECUTE replace(d,o,n);
 d:=pg_get_functiondef(sig);
 IF position('ANY_CERTIFIED_CASH_CORRECTION_V1' IN d)=0 OR position('backup_residue_constraint' IN d)=0
 OR position('cash_original17_fixed_sources_match' IN d)=0 OR position('c.proof IS DISTINCT FROM proof' IN d)=0
 OR position('HAND_SOURCE_CORRECTION_LEASE_REFUSED' IN d)=0 OR position('engine_table_leases' IN d)=0 THEN RAISE EXCEPTION 'certified_cash_claim_postimage_refused';END IF;
 IF (SELECT jsonb_build_array(pg_get_userbyid(p.proowner),p.prosecdef,p.provolatile,p.proacl::text,p.proconfig) FROM pg_proc p WHERE p.oid=sig) IS DISTINCT FROM before THEN RAISE EXCEPTION 'certified_cash_claim_security_refused';END IF;
END $install$;

COMMIT;
