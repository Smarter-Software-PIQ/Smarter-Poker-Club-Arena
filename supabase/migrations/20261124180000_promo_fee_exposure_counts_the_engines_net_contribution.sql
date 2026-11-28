-- 20261124180000_promo_fee_exposure_counts_the_engines_net_contribution.sql
--
-- PROMO FEE EXPOSURE COUNTS THE ENGINE'S NET CONTRIBUTION (2026-11-24).
--
-- The accepted cash hand carries contributions and returned_uncalled in
-- _accepted_post_commit_facts. Since the weighted contributed rake
-- (2026-08-29) the engine's contribution is the chips a seat left at risk:
-- HandController.returnUncalledBet takes the returned amount OFF
-- totalInvested, which becomes contributions[user]. returned_uncalled is
-- kept only for audit. Production, read only, 2026-11-24: in the latest 500
-- non-tournament rake rows that have a returned uncalled bet, the
-- contributions add up to the pot in 500 of 500 and contributions minus
-- returned_uncalled add up to it in 0.
--
-- The three Promo Play Through readers of these facts were written
-- 2026-11-16 as though contributions were gross. Each one subtracts
-- returned_uncalled a second time:
--   fn_ca_promo_accept_cash_hand       -> ca_promo_cash_hand_funding.contribution
--                                          and promo_contribution, which
--                                          fn_ca_promo_cash_payable_contract
--                                          reads as the promo-funded fee basis
--   fn_ca_promo_profit_capture_cash    -> the winnings capture's investment
--   fn_ca_promo_integrity_accept_hand  -> the integrity hold's investment
-- On production since enforcement, 274 of the 1,292 cash-hand funding rows
-- (21%) belong to a seat with a returned uncalled bet. In all 274 the stored
-- contribution is the double-subtracted figure, 2,198.17 chips short in
-- total. Stack movement (principal_lost) is unaffected.
--
-- This deletes the second subtraction in each function: investment becomes
-- GREATEST(contributions[user],0). Nothing else changes. No stored row is
-- rewritten: the 274 historical rows are reported to the owner, not repaired
-- here. Each function is rewritten from its live text at exactly one anchor,
-- the rewrite is idempotent, and a function that still subtracts afterwards
-- refuses the whole file.
--
-- The engine side of this contract is pinned by
-- server/src/engine/thePromoHandCommitPayloadKeepsItsContract.test.ts and
-- scripts/ci/fixtures/promo-hand-commit-payload/contract.json. The native
-- proof is scripts/ci/test-promo-custody.py, which feeds the engine's own
-- golden payload through the promo capture.
-- @live-proof: NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid IN('public.fn_ca_promo_accept_cash_hand(uuid,uuid,jsonb,jsonb,jsonb)'::regprocedure,'public.fn_ca_promo_profit_capture_cash(uuid,uuid,jsonb,jsonb,jsonb)'::regprocedure,'public.fn_ca_promo_integrity_accept_hand(uuid,uuid,jsonb,jsonb,jsonb,numeric)'::regprocedure) AND (position($a$-COALESCE((p_facts->'returned_uncalled'->>$a$ IN pg_get_functiondef(p.oid))>0 OR NOT p.prosecdef OR p.proowner<>'postgres'::regrole OR p.proacl::text<>'{postgres=X/postgres}'))
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='60s';
DO $net$
DECLARE f record; d text; n integer; role text;
BEGIN
 FOR f IN SELECT * FROM (VALUES
  ('public.fn_ca_promo_accept_cash_hand(uuid,uuid,jsonb,jsonb,jsonb)',
   $a$-COALESCE((p_facts->'returned_uncalled'->>r.user_id::text)::numeric,0)$a$),
  ('public.fn_ca_promo_profit_capture_cash(uuid,uuid,jsonb,jsonb,jsonb)',
   $a$-COALESCE((p_facts->'returned_uncalled'->>(s->>'user_id'))::numeric,0)$a$),
  ('public.fn_ca_promo_integrity_accept_hand(uuid,uuid,jsonb,jsonb,jsonb,numeric)',
   $a$-COALESCE((p_facts->'returned_uncalled'->>(r->>'user_id'))::numeric,0)$a$)
 ) v(sig,anchor) LOOP
  IF to_regprocedure(f.sig) IS NULL THEN CONTINUE; END IF;
  d:=pg_get_functiondef(f.sig::regprocedure);
  n:=(length(d)-length(replace(d,f.anchor,'')))/length(f.anchor);
  IF n>1 THEN RAISE EXCEPTION 'PROMO_NET_CONTRIBUTION_ANCHOR_NOT_EXACTLY_ONCE %',f.sig; END IF;
  IF n=1 THEN
   EXECUTE replace(d,f.anchor,'');
   FOREACH role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role) THEN
     EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.sig,role);
    END IF;
   END LOOP;
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.sig);
  END IF;
  -- Whatever the starting text was, no reader may subtract the uncalled
  -- return from the engine's net contribution once this file commits.
  IF position($a$-COALESCE((p_facts->'returned_uncalled'->>$a$ IN pg_get_functiondef(f.sig::regprocedure))>0 THEN
   RAISE EXCEPTION 'PROMO_NET_CONTRIBUTION_NOT_INSTALLED %',f.sig;
  END IF;
 END LOOP;
END $net$;

-- @probe-for: public.fn_ca_promo_accept_cash_hand
DO $probe$
BEGIN
  BEGIN
    -- Present on production; a native proof world may install a subset.
    IF to_regprocedure('public.fn_ca_promo_accept_cash_hand(uuid,uuid,jsonb,jsonb,jsonb)') IS NOT NULL THEN
      PERFORM public.fn_ca_promo_accept_cash_hand(gen_random_uuid(),gen_random_uuid(),
        '[]'::jsonb,'{"contributions":{},"returned_uncalled":{},"insurance":[]}'::jsonb,'{}'::jsonb);
    END IF;
  EXCEPTION WHEN check_violation THEN
    -- A random hand has no accepted commit: the cash clock refuses it by name.
    IF SQLERRM <> 'promo_cash_original_accepted_hand_missing' THEN RAISE; END IF;
  END;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_ca_promo_profit_capture_cash
DO $probe$
BEGIN
  BEGIN
    IF to_regprocedure('public.fn_ca_promo_profit_capture_cash(uuid,uuid,jsonb,jsonb,jsonb)') IS NOT NULL THEN
      PERFORM public.fn_ca_promo_profit_capture_cash(gen_random_uuid(),gen_random_uuid(),
        '[]'::jsonb,'{"contributions":{},"returned_uncalled":{},"insurance":[]}'::jsonb,'{}'::jsonb);
    END IF;
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'promo_cash_original_accepted_hand_missing' THEN RAISE; END IF;
  END;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_ca_promo_integrity_accept_hand
DO $probe$
BEGIN
  IF to_regprocedure('public.fn_ca_promo_integrity_accept_hand(uuid,uuid,jsonb,jsonb,jsonb,numeric)') IS NOT NULL THEN
    PERFORM public.fn_ca_promo_integrity_accept_hand(gen_random_uuid(),gen_random_uuid(),
      '[]'::jsonb,'{"contributions":{},"returned_uncalled":{},"insurance":[]}'::jsonb,'{}'::jsonb,0);
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
