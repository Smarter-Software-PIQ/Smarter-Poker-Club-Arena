-- 20261119175856_a_rebuy_never_blocks_a_hand_commit_on_the_tournament_row.sql
--
-- A REBUY NEVER BLOCKS A HAND COMMIT ON THE TOURNAMENT ROW (incident 075013fd,
-- lag-finish lane 3). Owner rules: "REBUYS IN A TOURNAMENT SHOULD NOT PAUSE THE
-- ACTION" (Dan, 2026-08-30); "i just don't want any 'un intended delays'"
-- (Dan, 2026-11-18).
--
-- COORDINATION WITH 20261119181500 (#11437 / #11451, installed on production).
-- Migration 20261119181500 already moved fn_ca_commit_hand_settlement_exact_
-- before_obligations to FOR KEY SHARE (95863075b8d44c6177dd893c946cd1b4) and
-- moved fn_ca_share_tournament_lane_for_tables, fn_lock_tournament_launch_
-- proof_parents, fn_ca_lock_tournament_rebuy_acquisition, process_tournament_
-- rebuy, fn_ca_process_tournament_chip_purchase_money_v1, fn_ca_settle_bounty_
-- rebuy_generation_v1 and fn_collect_bounty to FOR NO KEY UPDATE.
--
-- Two functions on the rebuy / hand-retention path were still left on the old
-- conflicting locks by 20261119181500 and 20261119232617:
--   1. public.fn_ca_retain_hand_submission(jsonb) still locked
--      public.tournaments FOR SHARE, so a hand retention at Table B still waited
--      behind any FOR NO KEY UPDATE rebuy, add-on, move, break or bust at Table A.
--   2. public.fn_claim_bounty_legacy_candidate_20260907(...) still locked
--      public.tournaments FOR UPDATE; every still-open bounty rebuy calls it via
--      fn_ca_settle_bounty_rebuy_generation_v1, upgrading the rebuy's FOR NO KEY
--      UPDATE lock back to FOR UPDATE and blocking every other table's FOR KEY
--      SHARE hand commit.
--
-- This migration requires 20261119181500 to be installed and closes both
-- remaining gaps cleanly without touching any function already updated by
-- 20261119181500 or 20261119175942:
--   - public.fn_ca_retain_hand_submission(jsonb): FOR SHARE -> FOR KEY SHARE
--   - public.fn_claim_bounty_legacy_candidate_20260907(...): FOR UPDATE -> FOR NO KEY UPDATE
--
-- SAFETY & INVARIANTS.
--   - FOR KEY SHARE is 100% compatible with FOR NO KEY UPDATE and non-key pool/
--     rake UPDATEs (prize_pool, bounty_pool, total_rake, bounty_pool_paid).
--   - FOR KEY SHARE still conflicts with FOR UPDATE (and DELETE / key UPDATE),
--     and retains still hold T(id) SHARED, so terminal settlement, cancellation,
--     launch completion and every lifecycle transition remain 100% excluded.
--   - FOR NO KEY UPDATE still conflicts with FOR UPDATE, FOR NO KEY UPDATE,
--     FOR SHARE and UPDATE, so concurrent pool/bounty writers and lifecycle
--     authorities remain 100% serialized.
--   - Zero schema changes, zero moved columns, 100% of financial accounting
--     invariants preserved unchanged.
--
-- Native proof (PostgreSQL 16/17, production pre-images md5-pinned):
-- scripts/ci/test-a-rebuy-never-blocks-a-hand-commit-on-the-tournament-row.py.
-- Law: tests/a-rebuy-never-blocks-a-hand-commit-on-the-tournament-row.law.test.ts.
--
-- LOCK FOOTPRINT. CREATE OR REPLACE FUNCTION only: no table or row lock, no
-- install window, one bounded transaction.
--
-- @live-proof: (SELECT md5(pg_get_functiondef('public.fn_ca_retain_hand_submission(jsonb)'::regprocedure)) = '727394a228663ae69b55a3597691a36e' AND md5(pg_get_functiondef('public.fn_claim_bounty_legacy_candidate_20260907(uuid,uuid,integer,numeric,uuid,uuid,bigint,timestamp with time zone,uuid,jsonb,numeric,boolean)'::regprocedure)) = 'c68823f888768992d7f6dd8a5062ed05')

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Require 20261119181500 (#11437) to be live before closing the remaining two gaps.
DO $requires$
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('public.fn_ca_commit_hand_settlement_exact_before_obligations(uuid,bigint,jsonb,numeric,numeric,text,numeric,jsonb,jsonb,text,uuid)'))) IS DISTINCT FROM '95863075b8d44c6177dd893c946cd1b4'
     OR md5(pg_get_functiondef(to_regprocedure('public.fn_ca_share_tournament_lane_for_tables(uuid,uuid,uuid[],boolean)'))) IS DISTINCT FROM 'da69a271d8cbcf56efdf61740fb4dcca'
     OR md5(pg_get_functiondef(to_regprocedure('public.fn_lock_tournament_launch_proof_parents(uuid[])'))) IS DISTINCT FROM 'c5cd3f9bd38ad283df7cdff0c572cf17'
     OR md5(pg_get_functiondef(to_regprocedure('public.fn_ca_lock_tournament_rebuy_acquisition(uuid,uuid,uuid)'))) IS DISTINCT FROM '994a5f635442c907a9619186a718b9d3'
     OR md5(pg_get_functiondef(to_regprocedure('public.fn_ca_process_tournament_chip_purchase_money_v1(uuid,uuid,text,numeric,numeric,integer,text)'))) IS DISTINCT FROM '3f70346d08dab755b774459900f89795'
     OR md5(pg_get_functiondef(to_regprocedure('public.fn_ca_settle_bounty_rebuy_generation_v1(uuid,uuid,uuid)'))) IS DISTINCT FROM '1d249875178e01b1277bf11048b69d15'
     OR md5(pg_get_functiondef(to_regprocedure('public.fn_collect_bounty(uuid,uuid,uuid,jsonb)'))) IS DISTINCT FROM '5cb29ef05c152217a3f4cf954522c1ad' THEN
    RAISE EXCEPTION 'rebuy-off-tournament-row: 20261119181500 must be installed first';
  END IF;
END $requires$;

-- Exact anchored substitutions on the remaining 2 pinned production pre-images.
-- Preserves owner, ACL, SECURITY DEFINER and proconfig on every function.
DO $subs$
DECLARE
  r record;
  i integer;
  v_sig regprocedure;
  v_def text;
  v_n integer;
  v_acl text; v_owner oid; v_definer boolean; v_config text[];
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
    ('public.fn_ca_retain_hand_submission(jsonb)',
     '736eda060e559571cf3c07ceb470a8a3', '727394a228663ae69b55a3597691a36e',
     ARRAY[$o1$ IF tour IS NOT NULL THEN PERFORM 1 FROM public.tournaments WHERE id=tour FOR SHARE; END IF;$o1$],
     ARRAY[$n1$ IF tour IS NOT NULL THEN PERFORM 1 FROM public.tournaments WHERE id=tour FOR KEY SHARE; END IF;$n1$]),

    ('public.fn_claim_bounty_legacy_candidate_20260907(uuid,uuid,integer,numeric,uuid,uuid,bigint,timestamp with time zone,uuid,jsonb,numeric,boolean)',
     '7b4725dcb4a512ba8e22addaaecf079e', 'c68823f888768992d7f6dd8a5062ed05',
     ARRAY[$o2$  SELECT * INTO v_t FROM public.tournaments t
   WHERE t.id=p_tournament_id FOR UPDATE;$o2$],
     ARRAY[$n2$  SELECT * INTO v_t FROM public.tournaments t
   WHERE t.id=p_tournament_id FOR NO KEY UPDATE;$n2$])
    ) AS t(sig, pre_md5, post_md5, olds, news)
  LOOP
    v_sig := r.sig::regprocedure;
    SELECT proacl::text, proowner, prosecdef, proconfig
      INTO v_acl, v_owner, v_definer, v_config
      FROM pg_catalog.pg_proc WHERE oid = v_sig;
    v_def := pg_get_functiondef(v_sig);
    IF md5(v_def) <> r.pre_md5 THEN
      RAISE EXCEPTION 'rebuy-off-tournament-row: % pre-image drifted (got %, expected %)',
        r.sig, md5(v_def), r.pre_md5;
    END IF;
    FOR i IN 1..array_length(r.olds, 1) LOOP
      v_n := (length(v_def) - length(replace(v_def, r.olds[i], ''))) / length(r.olds[i]);
      IF v_n <> 1 THEN
        RAISE EXCEPTION 'rebuy-off-tournament-row: % anchor % found % times, expected 1',
          r.sig, i, v_n;
      END IF;
      v_def := replace(v_def, r.olds[i], r.news[i]);
    END LOOP;
    EXECUTE v_def;
    IF md5(pg_get_functiondef(v_sig)) <> r.post_md5 THEN
      RAISE EXCEPTION 'rebuy-off-tournament-row: % post-image mismatch (got %, expected %)',
        r.sig, md5(pg_get_functiondef(v_sig)), r.post_md5;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc
       WHERE oid = v_sig
         AND (proacl::text IS DISTINCT FROM v_acl
              OR proowner IS DISTINCT FROM v_owner
              OR prosecdef IS DISTINCT FROM v_definer
              OR proconfig IS DISTINCT FROM v_config)
    ) THEN
      RAISE EXCEPTION 'rebuy-off-tournament-row: % metadata changed on replace', r.sig;
    END IF;
  END LOOP;
END $subs$;

-- Install-time probe (always rolled back via probe-unwind).

-- @probe-for: public.fn_claim_bounty_legacy_candidate_20260907
DO $probe$
DECLARE v_r jsonb;
BEGIN
  v_r := public.fn_claim_bounty_legacy_candidate_20260907(
    gen_random_uuid(), gen_random_uuid(), 1, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false);
  IF v_r->>'reason' IS DISTINCT FROM 'missing_identity' THEN
    RAISE EXCEPTION 'claim_bounty_legacy_candidate probe unexpected: %', v_r;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-exempt: public.fn_ca_retain_hand_submission requires a live protocol-2 lease and table row; executed natively by the PG proof harness

COMMIT;
