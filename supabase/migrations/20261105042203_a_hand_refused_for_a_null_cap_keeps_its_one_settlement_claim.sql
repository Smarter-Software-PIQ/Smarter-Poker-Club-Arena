-- @live-proof: position('fixed_limit_null_max_buy_in' in pg_get_functiondef('smarter_private.hand_source_correction_claim_guard()'::regprocedure)) > 0 AND position('cash_original17_fixed_sources_match() IS NOT DISTINCT FROM true' in pg_get_functiondef('smarter_private.hand_source_correction_claim_guard()'::regprocedure)) > 0
-- 20261105042203_a_hand_refused_for_a_null_cap_keeps_its_one_settlement_claim.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- THE ONE-TIME CLAIM GUARD ADMITS THE FIXED-LIMIT NULL-CAP CASH CAUSE
--
-- 20261105041928 (#9516) proved and certified the eight fixed-limit hands the
-- null-cap refusal stranded (source_cause fixed_limit_null_max_buy_in). The
-- eight tables still do not deal: when the engine's resume takes the hand's
-- one correction claim, smarter_private.hand_source_correction_claim_guard
-- refuses it, because its cash branch admits only source_cause
-- 'backup_residue_constraint' (the 2026-10-13 cash correction). Measured after
-- #9516 installed: 8 certified, 0 claims, all 8 tables still killed every few
-- seconds (start_failed:start_seed_hand_count).
--
-- The cash branch now admits either cause: backup_residue_constraint with its
-- fixed-sources pin exactly as before, or fixed_limit_null_max_buy_in (whose
-- proof already requires the door fix 20261105032543 installed and live). The
-- lease check, the proof re-check, the request-hash and transaction checks and
-- the tournament branch are unchanged. Preimage md5 pins the exact live guard.
--
-- Proved first in production in a rolled-back trial: with this guard, the real
-- fn_ca_resume_hand_submission under the engine's live lease settles a retained
-- hand (rake, jackpot and stacks exactly as requested).
--
-- Wrap ALL DDL for one change in ONE transaction: every DDL statement fires
-- Supabase's schema-cache reload, which takes ~28s on this database, and ten
-- loose statements mean ten reloads (club-arena CLAUDE.md, production DDL policy).

BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='60s';
SET LOCAL search_path=public;
DO $guard_install$
DECLARE
 o_g text:=$anchor$  OR proof->>'source_cause' IS DISTINCT FROM 'backup_residue_constraint'
  OR smarter_private.cash_original17_fixed_sources_match() IS DISTINCT FROM true
$anchor$;
 n_g text:=$anchor$  -- Two cash causes have a proof (2026-11-05): the backup-residue constraint,
  -- whose fixed sources must still match, and the fixed-limit null-cap refusal,
  -- whose proof already requires its door fix to be installed and live.
  OR NOT ((proof->>'source_cause'='backup_residue_constraint'
           AND smarter_private.cash_original17_fixed_sources_match() IS NOT DISTINCT FROM true)
       OR proof->>'source_cause'='fixed_limit_null_max_buy_in')
$anchor$;
 sig_g constant regprocedure:='smarter_private.hand_source_correction_claim_guard()'::regprocedure;
 g text; before jsonb;
BEGIN
 IF NOT EXISTS(SELECT FROM supabase_migrations.schema_migrations WHERE version='20261105041928') THEN RAISE EXCEPTION 'fl_claim_guard_cohort_migration_missing';END IF;
 g:=pg_get_functiondef(sig_g);
 IF md5(g)<>'80bfaa3c60aef42e7ccf1963036edbc6' THEN RAISE EXCEPTION 'fl_claim_guard_preimage_refused';END IF;
 IF (length(g)-length(replace(g,o_g,'')))/length(o_g)<>1 THEN RAISE EXCEPTION 'fl_claim_guard_anchor_refused';END IF;
 SELECT jsonb_build_array(pg_get_userbyid(p.proowner),p.prosecdef,p.provolatile,p.proacl::text,p.proconfig) INTO before FROM pg_proc p WHERE p.oid=sig_g;
 EXECUTE replace(g,o_g,n_g);
 g:=pg_get_functiondef(sig_g);
 IF position('fixed_limit_null_max_buy_in' in g)=0
 OR position('cash_original17_fixed_sources_match() IS NOT DISTINCT FROM true' in g)=0
 OR position('HAND_SOURCE_CORRECTION_LEASE_REFUSED' in g)=0
 OR position('HAND_SOURCE_CORRECTION_CLAIM_REFUSED' in g)=0 THEN RAISE EXCEPTION 'fl_claim_guard_postimage_refused';END IF;
 IF (SELECT jsonb_build_array(pg_get_userbyid(p.proowner),p.prosecdef,p.provolatile,p.proacl::text,p.proconfig) FROM pg_proc p WHERE p.oid=sig_g) IS DISTINCT FROM before THEN RAISE EXCEPTION 'fl_claim_guard_attributes_moved';END IF;
END $guard_install$;
COMMIT;
