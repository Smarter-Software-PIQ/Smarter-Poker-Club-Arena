-- 20261112135242_lightning_readiness_recognizes_the_exact_horse_arrival_pacin.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY (Production Alerts row 371597, 2026-11-12):
--
-- Since 20261111214248 (#10530) installed fn_lightning_horse_admit_paced, the
-- Lightning rollout readiness read (fn_lightning_rollout_readiness) reports
-- invariants.law_10_5 = false on production, and every Post-Deploy E2E run
-- fails "Certify the authenticated Lightning operator cold loads" with
-- "readiness invariant law_10_5" (run 43210315096, job 131156857551, on
-- 7608c4721). The law_10_5 scan refuses any public fn_lightning_* function
-- whose comment-stripped definition mentions is_horse or horse_id. Read live:
-- exactly two match, fn_lightning_auto_rebuy (already recognised by its exact
-- identity in 20261106155602) and fn_lightning_horse_admit_paced, which
-- nothing recognised.
--
-- fn_lightning_horse_admit_paced is horse fleet plumbing that CLAUDE.md 10.5
-- permits: it paces Horse seat inserts (owner, Dan, 2026-11-11: one Horse
-- arrival every 70 to 90 seconds per game, a lone person's heads-up opponent
-- seated at once). Its only callers are the Horse seat triggers
-- fn_lightning_admission_policy and fn_ca_horse_roster_seat_guard; people
-- never reach it, and only postgres may execute it.
--
-- This adds ONE recognised identity to the law_10_5 scan, built the same way
-- as the rebuy input: the exact signature, the exact installed definition
-- (md5 ba5d6df55992dde8d2dce9a9295816cd, as installed by 20261112005012),
-- owner postgres, and no EXECUTE for service_role, authenticated, anon or
-- PUBLIC. Any later change to that function, its owner or its grants falls
-- straight back under the blanket scan, so a changed definition is refused
-- again until a reviewed migration recognises it (and
-- tests/lightning/a-horse-reading-lightning-function-is-recognised-by-readiness.law.test.ts
-- refuses that change on the branch that makes it).
--
-- Nothing else in the readiness function changes (the migration asserts the
-- reverse replacement restores the predecessor byte for byte). No readiness
-- verdict, rollout flag, seat, wallet, gameplay or configuration row is
-- written. Ordinary route: one CREATE OR REPLACE FUNCTION on a non-hot
-- function, no table locks.
--
-- Read-only probe against production before this file was written
-- (2026-11-12T14:0xZ): the anchor occurs exactly once in the predecessor
-- (md5 d2e611fa3e858c45213a40c80829626c), the replacement reverses byte for
-- byte, the patched law_10_5 predicate evaluates true and the installed one
-- false, and the replaced text hashes to 29c7ce1f7a5e7c36e0d98dea3a221ec5.
-- @live-proof: (SELECT md5(pg_get_functiondef('public.fn_lightning_rollout_readiness(uuid)'::regprocedure))='29c7ce1f7a5e7c36e0d98dea3a221ec5')
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';
DO $repair$
DECLARE
  v_oid oid := 'public.fn_lightning_rollout_readiness(uuid)'::regprocedure;
  v_admit oid := 'public.fn_lightning_horse_admit_paced(uuid,uuid,timestamptz)'::regprocedure;
  v_before text;
  v_after text;
  v_catalog record;
  v_old text := $old$                            AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) a
                                            WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')));$old$;
  v_new text := $new$                            AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) a
                                            WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))
                          AND NOT (p.oid = to_regprocedure('public.fn_lightning_horse_admit_paced(uuid,uuid,timestamp with time zone)')
                            AND md5(pg_get_functiondef(p.oid)) = 'ba5d6df55992dde8d2dce9a9295816cd'
                            AND pg_get_userbyid(p.proowner) = 'postgres'
                            AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
                            AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
                            AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                            AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) a
                                            WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')));$new$;
BEGIN
  -- The function being recognised must be exactly the reviewed one.
  IF md5(pg_get_functiondef(v_admit)) <> 'ba5d6df55992dde8d2dce9a9295816cd'
     OR pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid = v_admit)) <> 'postgres'
     OR has_function_privilege('service_role', v_admit, 'EXECUTE')
     OR has_function_privilege('authenticated', v_admit, 'EXECUTE')
     OR has_function_privilege('anon', v_admit, 'EXECUTE') THEN
    RAISE EXCEPTION 'Lightning horse arrival pacing is not the reviewed definition or authority';
  END IF;

  SELECT pg_get_functiondef(v_oid) INTO v_before;
  SELECT proowner, proacl, proconfig, prosecdef, provolatile INTO v_catalog FROM pg_proc WHERE oid = v_oid;
  IF md5(v_before) <> 'd2e611fa3e858c45213a40c80829626c'
     OR pg_get_userbyid(v_catalog.proowner) <> 'postgres'
     OR NOT v_catalog.prosecdef OR v_catalog.provolatile <> 's'
     OR v_catalog.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp'] THEN
    RAISE EXCEPTION 'Lightning readiness horse pacing boundary predecessor mismatch';
  END IF;
  IF (length(v_before) - length(replace(v_before, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'Lightning readiness law predicate occurrence mismatch';
  END IF;

  v_after := replace(v_before, v_old, v_new);
  EXECUTE v_after;

  IF replace(pg_get_functiondef(v_oid), v_new, v_old) <> v_before
     OR EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_oid AND
       (proowner IS DISTINCT FROM v_catalog.proowner OR proacl IS DISTINCT FROM v_catalog.proacl
        OR proconfig IS DISTINCT FROM v_catalog.proconfig OR prosecdef IS DISTINCT FROM v_catalog.prosecdef
        OR provolatile IS DISTINCT FROM v_catalog.provolatile)) THEN
    RAISE EXCEPTION 'Lightning readiness horse pacing boundary changed unrelated source or authority';
  END IF;

  -- The scan the readiness read performs now finds nothing it does not recognise.
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname LIKE 'fn\_lightning\_%'
                AND regexp_replace(pg_get_functiondef(p.oid), '--[^' || chr(10) || ']*', '', 'g') ~ ('is_' || 'horse|horse_' || 'id')
                AND p.oid NOT IN (to_regprocedure('public.fn_lightning_auto_rebuy(uuid,uuid,timestamp with time zone)'), v_admit)) THEN
    RAISE EXCEPTION 'Lightning readiness law scan still finds an unrecognised horse-reading function';
  END IF;
END $repair$;
COMMIT;
