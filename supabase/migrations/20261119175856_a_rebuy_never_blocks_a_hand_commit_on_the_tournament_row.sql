-- 20261119175856_a_rebuy_never_blocks_a_hand_commit_on_the_tournament_row.sql
--
-- A REBUY NEVER BLOCKS A HAND COMMIT ON THE TOURNAMENT ROW (incident 075013fd,
-- lag-finish lane 3). Owner rules: "REBUYS IN A TOURNAMENT SHOULD NOT PAUSE THE
-- ACTION" (Dan, 2026-08-30); "i just don't want any 'un intended delays'"
-- (Dan, 2026-11-18).
--
-- WHAT B7, E2 AND E3 LEFT. After lanes R2 (20261119011750), B7 (20261119013430),
-- E2 (20261119053909) and E3 (20261119054539), every rebuy, re-entry, add-on
-- and bounty settle runs on the event's shared change lane (R(id) exclusive,
-- G and T(id) shared), so F06 hand begins, finishes, card writes, snapshots
-- and post-commit projections do not wait. One remaining lock still stalled
-- every table's hand commit and hand retention behind an in-flight rebuy:
--
--   1. Every hand commit (fn_ca_commit_hand_settlement_exact_before_obligations)
--      and hand retention (fn_ca_retain_hand_submission) locked the event's
--      public.tournaments row FOR SHARE.
--   2. Every rebuy, add-on, bounty settle, money core, claimant-table lane and
--      launch-proof trigger locked public.tournaments FOR UPDATE and updated
--      non-key pool/rake columns (prize_pool, bounty_pool, total_rake,
--      bounty_pool_paid).
--
-- In PostgreSQL, FOR SHARE conflicts with both FOR UPDATE and non-key UPDATE
-- (FOR NO KEY UPDATE), so every table in the tournament queued its hand commit
-- on the tournaments row until the rebuy committed.
--
-- THE FIX (PostgreSQL native row-lock hierarchy, same pattern as the 2026-09-10
-- engine_tournament_leases FOR KEY SHARE / FOR NO KEY UPDATE split).
--   1. Hand commit (fn_ca_commit_hand_settlement_exact_before_obligations) and
--      hand retention (fn_ca_retain_hand_submission) lock public.tournaments
--      FOR KEY SHARE instead of FOR SHARE.
--   2. The shared-lane rebuy / add-on / bounty-settle / money-core / launch-
--      proof-parent path locks public.tournaments FOR NO KEY UPDATE instead of
--      FOR UPDATE (and only ever updates non-key columns: prize_pool,
--      bounty_pool, total_rake, bounty_pool_paid):
--        - fn_ca_lock_tournament_rebuy_acquisition
--        - process_tournament_rebuy (add-on path)
--        - fn_ca_process_tournament_chip_purchase_money_v1
--        - fn_ca_settle_bounty_rebuy_generation_v1
--        - fn_claim_bounty_legacy_candidate_20260907
--        - fn_ca_share_tournament_lane_for_tables
--        - fn_collect_bounty
--        - fn_lock_tournament_launch_proof_parents
--
-- SAFETY & INVARIANTS.
--   - FOR KEY SHARE is 100% compatible with FOR NO KEY UPDATE and with non-key
--     UPDATEs (prize_pool, bounty_pool, total_rake, bounty_pool_paid).
--   - FOR KEY SHARE still conflicts with FOR UPDATE (and DELETE / key UPDATE),
--     and hand commits/retains still hold G and T(id) SHARED, so terminal
--     settlement, cancellation, launch completion and every lifecycle transition
--     remain 100% excluded.
--   - FOR NO KEY UPDATE still conflicts with FOR UPDATE, FOR NO KEY UPDATE,
--     FOR SHARE and UPDATE, so concurrent pool writers and lifecycle authorities
--     remain 100% serialized (and within the change lane by R(id) exclusive).
--   - Deadlock freedom:
--       * Unrelated table hand commit vs rebuy: zero overlapping conflicting
--         locks (0 ms wait).
--       * Busted player's own table hand commit vs rebuy: both take candidate
--         table FOR UPDATE before atomic-table:<table> before roster/seats.
--       * Knocker's table hand commit vs bounty rebuy: hand commit locks only
--         its own table; rebuy locks claimant tables inside its 500 ms
--         lock_timeout settle window (acyclic wait-for graph).
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
-- @live-proof: (SELECT md5(pg_get_functiondef('public.fn_ca_commit_hand_settlement_exact_before_obligations(uuid,bigint,jsonb,numeric,numeric,text,numeric,jsonb,jsonb,text,uuid)'::regprocedure)) = '749876c1ba017b3ed645ab7878347ae9' AND md5(pg_get_functiondef('public.fn_ca_retain_hand_submission(jsonb)'::regprocedure)) = '727394a228663ae69b55a3597691a36e' AND md5(pg_get_functiondef('public.fn_ca_lock_tournament_rebuy_acquisition(uuid,uuid,uuid)'::regprocedure)) = '994a5f635442c907a9619186a718b9d3' AND md5(pg_get_functiondef('public.process_tournament_rebuy(uuid,uuid,text,numeric,numeric,integer,text)'::regprocedure)) = 'c436fb6301b260a6dd66731878c8c3bc' AND md5(pg_get_functiondef('public.fn_ca_process_tournament_chip_purchase_money_v1(uuid,uuid,text,numeric,numeric,integer,text)'::regprocedure)) = '3f70346d08dab755b774459900f89795' AND md5(pg_get_functiondef('public.fn_ca_settle_bounty_rebuy_generation_v1(uuid,uuid,uuid)'::regprocedure)) = '1d249875178e01b1277bf11048b69d15' AND md5(pg_get_functiondef('public.fn_claim_bounty_legacy_candidate_20260907(uuid,uuid,integer,numeric,uuid,uuid,bigint,timestamp with time zone,uuid,jsonb,numeric,boolean)'::regprocedure)) = '21c58bf9251403a57304172f3ce39ae7' AND md5(pg_get_functiondef('public.fn_ca_share_tournament_lane_for_tables(uuid,uuid,uuid[],boolean)'::regprocedure)) = 'da69a271d8cbcf56efdf61740fb4dcca' AND md5(pg_get_functiondef('public.fn_collect_bounty(uuid,uuid,uuid,jsonb)'::regprocedure)) = '5cb29ef05c152217a3f4cf954522c1ad' AND md5(pg_get_functiondef('public.fn_lock_tournament_launch_proof_parents(uuid[])'::regprocedure)) = 'c5cd3f9bd38ad283df7cdff0c572cf17')

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Exact anchored substitutions on all 10 pinned production pre-images.
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
    ('public.fn_ca_commit_hand_settlement_exact_before_obligations(uuid,bigint,jsonb,numeric,numeric,text,numeric,jsonb,jsonb,text,uuid)',
     'c555fb7b83c889312995bc0038c1b275', '749876c1ba017b3ed645ab7878347ae9',
     ARRAY[$o1$    PERFORM 1
      FROM public.tournaments t
     WHERE t.id = v_tournament_id
     FOR SHARE;$o1$],
     ARRAY[$n1$    PERFORM 1
      FROM public.tournaments t
     WHERE t.id = v_tournament_id
     FOR KEY SHARE;$n1$]),

    ('public.fn_ca_retain_hand_submission(jsonb)',
     '736eda060e559571cf3c07ceb470a8a3', '727394a228663ae69b55a3597691a36e',
     ARRAY[$o2$ IF tour IS NOT NULL THEN PERFORM 1 FROM public.tournaments WHERE id=tour FOR SHARE; END IF;$o2$],
     ARRAY[$n2$ IF tour IS NOT NULL THEN PERFORM 1 FROM public.tournaments WHERE id=tour FOR KEY SHARE; END IF;$n2$]),

    ('public.fn_ca_lock_tournament_rebuy_acquisition(uuid,uuid,uuid)',
     '2ea19582f62ecd683304b1f85f17466c', '994a5f635442c907a9619186a718b9d3',
     ARRAY[$o3$  FROM public.tournaments t
  WHERE t.id = p_tournament_id
  FOR UPDATE;$o3$],
     ARRAY[$n3$  FROM public.tournaments t
  WHERE t.id = p_tournament_id
  FOR NO KEY UPDATE;$n3$]),

    ('public.process_tournament_rebuy(uuid,uuid,text,numeric,numeric,integer,text)',
     '8acb45633fa7bfbd7d63dbb256138e53', 'c436fb6301b260a6dd66731878c8c3bc',
     ARRAY[$o4$    SELECT * INTO v_t FROM public.tournaments t
     WHERE t.id=p_tournament_id FOR UPDATE;$o4$],
     ARRAY[$n4$    SELECT * INTO v_t FROM public.tournaments t
     WHERE t.id=p_tournament_id FOR NO KEY UPDATE;$n4$]),

    ('public.fn_ca_process_tournament_chip_purchase_money_v1(uuid,uuid,text,numeric,numeric,integer,text)',
     '5ae262f9a0cffeb1908172c756ca5bf8', '3f70346d08dab755b774459900f89795',
     ARRAY[$o5$    FROM public.tournaments
   WHERE id=p_tournament_id
   FOR UPDATE;$o5$],
     ARRAY[$n5$    FROM public.tournaments
   WHERE id=p_tournament_id
   FOR NO KEY UPDATE;$n5$]),

    ('public.fn_ca_settle_bounty_rebuy_generation_v1(uuid,uuid,uuid)',
     'c879b710d42ee6514e603c1983558330', '1d249875178e01b1277bf11048b69d15',
     ARRAY[$o6$    FROM public.tournaments t
   WHERE t.id=p_tournament_id
   FOR UPDATE;$o6$],
     ARRAY[$n6$    FROM public.tournaments t
   WHERE t.id=p_tournament_id
   FOR NO KEY UPDATE;$n6$]),

    ('public.fn_claim_bounty_legacy_candidate_20260907(uuid,uuid,integer,numeric,uuid,uuid,bigint,timestamp with time zone,uuid,jsonb,numeric,boolean)',
     'd219ceeed1041eed5cf2c543315eb91b', '21c58bf9251403a57304172f3ce39ae7',
     ARRAY[$o7$  SELECT * INTO v_t FROM public.tournaments t
   WHERE t.id=p_tournament_id FOR UPDATE;$o7$],
     ARRAY[$n7$  SELECT * INTO v_t FROM public.tournaments t
   WHERE t.id=p_tournament_id FOR NO KEY UPDATE;$n7$]),

    ('public.fn_ca_share_tournament_lane_for_tables(uuid,uuid,uuid[],boolean)',
     '76dddeb34b3508a48b777c2c79442072', 'da69a271d8cbcf56efdf61740fb4dcca',
     ARRAY[$o8$    PERFORM 1 FROM public.tournaments t WHERE t.id = p_tournament_id FOR UPDATE;$o8$],
     ARRAY[$n8$    PERFORM 1 FROM public.tournaments t WHERE t.id = p_tournament_id FOR NO KEY UPDATE;$n8$]),

    ('public.fn_collect_bounty(uuid,uuid,uuid,jsonb)',
     '208d836177414ccc989bd47e941d83bb', '5cb29ef05c152217a3f4cf954522c1ad',
     ARRAY[$o9a$  PERFORM 1 FROM public.tournaments t WHERE t.id=p_tournament_id FOR UPDATE;$o9a$,
           $o9b$      INTO v_t FROM tournaments WHERE id = p_tournament_id FOR UPDATE;$o9b$],
     ARRAY[$n9a$  PERFORM 1 FROM public.tournaments t WHERE t.id=p_tournament_id FOR NO KEY UPDATE;$n9a$,
           $n9b$      INTO v_t FROM tournaments WHERE id = p_tournament_id FOR NO KEY UPDATE;$n9b$]),

    ('public.fn_lock_tournament_launch_proof_parents(uuid[])',
     '77e46e6a692bfadfa5537fe634791b9f', 'c5cd3f9bd38ad283df7cdff0c572cf17',
     ARRAY[$o10$  PERFORM 1
    FROM public.tournaments t
   WHERE t.id = ANY(v_ids)
   ORDER BY t.id
   FOR UPDATE;$o10$],
     ARRAY[$n10$  PERFORM 1
    FROM public.tournaments t
   WHERE t.id = ANY(v_ids)
   ORDER BY t.id
   FOR NO KEY UPDATE;$n10$])
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

-- Install-time probes (always rolled back via probe-unwind).

-- @probe-for: public.fn_ca_commit_hand_settlement_exact_before_obligations
DO $probe$
DECLARE v_r jsonb;
BEGIN
  v_r := public.fn_ca_commit_hand_settlement_exact_before_obligations(
    gen_random_uuid(), 1, '[]'::jsonb, 0, 0, 'probe', 0, '{}'::jsonb, '[]'::jsonb, 'probe', gen_random_uuid());
  IF v_r->>'reason' IS DISTINCT FROM 'table_not_found' THEN
    RAISE EXCEPTION 'commit_hand_settlement_exact probe unexpected: %', v_r;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_ca_lock_tournament_rebuy_acquisition
DO $probe$
DECLARE v_r jsonb;
BEGIN
  v_r := public.fn_ca_lock_tournament_rebuy_acquisition(NULL, NULL, NULL);
  IF v_r->>'reason' IS DISTINCT FROM 'missing_user_id' THEN
    RAISE EXCEPTION 'lock_tournament_rebuy_acquisition probe unexpected: %', v_r;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.process_tournament_rebuy
DO $probe$
DECLARE v_t uuid := gen_random_uuid(); v_u uuid := gen_random_uuid(); v_key text; v_r jsonb;
BEGIN
  v_key := 'tourney:'||v_t::text||':addon:'||v_u::text;
  INSERT INTO public.entry_purchase_idempotency_receipts(key_domain,idempotency_key,request,response,claimed_at,completed_at)
  VALUES('tournament_chip_purchase',v_key,
    jsonb_build_object('version','v1','tournament_id',v_t,'user_id',v_u,'rebuy_type','addon','idempotency_key',v_key),
    jsonb_build_object('success',true,'seated',true,'atomic_tournament_chip_purchase','v1','rebuy_type','addon',
      'table_id',gen_random_uuid(),'seat_id',gen_random_uuid(),'stack',1),
    clock_timestamp(),clock_timestamp());
  v_r := public.process_tournament_rebuy(v_t,v_u,'addon',NULL,NULL,NULL,NULL);
  IF v_r->>'atomic_tournament_chip_purchase' IS DISTINCT FROM 'v1' THEN
    RAISE EXCEPTION 'process_tournament_rebuy probe did not replay its receipt: %', v_r;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

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

-- @probe-for: public.fn_ca_share_tournament_lane_for_tables
DO $probe$
DECLARE v_id uuid := gen_random_uuid();
BEGIN
  IF NOT public.fn_ca_share_tournament_lane_for_tables(v_id, NULL, ARRAY[gen_random_uuid()]) THEN
    RAISE EXCEPTION 'share_tournament_lane_for_tables probe returned false';
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_collect_bounty
DO $probe$
DECLARE v_r jsonb;
BEGIN
  v_r := public.fn_collect_bounty(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), '[]'::jsonb);
  IF v_r->>'reason' IS DISTINCT FROM 'tournament_not_found' THEN
    RAISE EXCEPTION 'collect_bounty probe unexpected: %', v_r;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_lock_tournament_launch_proof_parents
DO $probe$
BEGIN
  PERFORM * FROM public.fn_lock_tournament_launch_proof_parents(ARRAY[]::uuid[]);
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-exempt: public.fn_ca_retain_hand_submission requires a live protocol-2 lease and table row; executed natively by the PG proof harness
-- @probe-exempt: public.fn_ca_process_tournament_chip_purchase_money_v1 requires a live tournament, roster and wallet row; executed natively by the PG proof harness
-- @probe-exempt: public.fn_ca_settle_bounty_rebuy_generation_v1 requires a live running bounty tournament and knockout candidate; executed natively by the PG proof harness

COMMIT;
