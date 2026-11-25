-- 20261123083628_the_original_cluster_tick_retires_and_readiness_reads_the_un.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- THE ORIGINAL CLUSTER TICK RETIRES AND READINESS READS THE UNCAPPED TICK
--
-- WHY THIS EXISTS. Migration 20261112154904 created two uncapped copies of the
-- cluster tick (`fn_cash_cluster_tick_uncapped(uuid, integer)` and
-- `fn_cash_clusters_tick_all_uncapped(jsonb)`) and left the old capped copies
-- (`fn_cash_cluster_tick(uuid, integer)` and
-- `fn_cash_clusters_tick_all(jsonb)`) in place only while older engine builds
-- finished rolling off. Since then:
--
--   1. Every serving engine calls only the `_uncapped` copies; production edge
--      logs and pg_stat_statements confirm zero callers of the old copies.
--   2. Leaving two near-identical tick copies in `public` is a recurring trap:
--      a fix applied to `fn_cash_cluster_tick` silently misses the live
--      `fn_cash_cluster_tick_uncapped` copy that the engine actually executes
--      (hit on PR #11790, caught only by TheUncappedTickStaysInStep).
--   3. `public.fn_lightning_rollout_readiness(uuid)` had a hidden regprocedure
--      reference to `'public.fn_cash_clusters_tick_all(jsonb)'::regprocedure`
--      in its anti-manipulation invariant check (`v_anti`). That meant
--      readiness was auditing the dead copy instead of the live `_uncapped`
--      pass, and dropping the dead copy without repointing readiness first
--      would break the Lightning operator page.
--
-- WHAT THIS DOES (one bounded transaction):
--   1. Verifies both `_uncapped` functions exist.
--   2. Anchored edit of `public.fn_lightning_rollout_readiness(uuid)` to audit
--      `'public.fn_cash_clusters_tick_all_uncapped(jsonb)'::regprocedure`
--      instead of `'public.fn_cash_clusters_tick_all(jsonb)'::regprocedure`,
--      preserving exact owner, ACL, config, volatility and reversibility.
--   3. Fails closed if any other function in `public` or `smarter_private`
--      still calls or references the retired original tick functions.
--   4. Drops `public.fn_cash_clusters_tick_all(jsonb)` and
--      `public.fn_cash_cluster_tick(uuid, integer)`.
--   5. Probes `public.fn_lightning_rollout_readiness(uuid)` after the drop so
--      install proves readiness runs cleanly and its anti-manipulation check
--      evaluates the live `_uncapped` pass.
--
-- MONEY AND GAMEPLAY. No tables, columns, rows, balances, or game decisions
-- change. Nothing reads `is_horse`.
--
-- Proof: scripts/dev/prove-the-original-cluster-tick-retires.sh
-- Law: server/src/cluster/TheUncappedTickStaysInStep.law.test.ts
-- Changelog: docs/changelog/2026-11-23-the-original-cluster-tick-retires.md
--
-- @live-proof: (SELECT to_regprocedure('public.fn_cash_cluster_tick(uuid,integer)') IS NULL AND to_regprocedure('public.fn_cash_clusters_tick_all(jsonb)') IS NULL AND to_regprocedure('public.fn_cash_cluster_tick_uncapped(uuid,integer)') IS NOT NULL AND to_regprocedure('public.fn_cash_clusters_tick_all_uncapped(jsonb)') IS NOT NULL)
-- @live-proof: (SELECT pg_get_functiondef('public.fn_lightning_rollout_readiness(uuid)'::regprocedure) LIKE '%fn_cash_clusters_tick_all_uncapped(jsonb)%' AND pg_get_functiondef('public.fn_lightning_rollout_readiness(uuid)'::regprocedure) NOT LIKE '%fn_cash_clusters_tick_all(jsonb)%')

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $retire_original_tick$
DECLARE
  v_readiness_oid oid := 'public.fn_lightning_rollout_readiness(uuid)'::regprocedure;
  v_tick_oid      oid := to_regprocedure('public.fn_cash_cluster_tick(uuid,integer)');
  v_tick_all_oid  oid := to_regprocedure('public.fn_cash_clusters_tick_all(jsonb)');
  v_before        text;
  v_after         text;
  v_catalog       record;
  v_stragglers    text[];
  v_old           text := $o$'public.fn_cash_clusters_tick_all(jsonb)'::regprocedure$o$;
  v_new           text := $r$'public.fn_cash_clusters_tick_all_uncapped(jsonb)'::regprocedure$r$;
BEGIN
  -- 1. Never retire the originals unless both uncapped doors are installed.
  IF to_regprocedure('public.fn_cash_cluster_tick_uncapped(uuid,integer)') IS NULL
     OR to_regprocedure('public.fn_cash_clusters_tick_all_uncapped(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'uncapped cluster tick functions must exist before retiring the originals';
  END IF;

  -- 2. Repoint fn_lightning_rollout_readiness(uuid) so its anti-manipulation
  --    invariant audits the live uncapped tick pass before the old pass drops.
  SELECT pg_get_functiondef(v_readiness_oid) INTO v_before;
  SELECT proowner, proacl, proconfig, prosecdef, provolatile
    INTO v_catalog
    FROM pg_proc
   WHERE oid = v_readiness_oid;

  IF position(v_new IN v_before) > 0 THEN
    RAISE EXCEPTION 'fn_lightning_rollout_readiness already reads fn_cash_clusters_tick_all_uncapped: re-read before editing';
  END IF;
  IF (length(v_before) - length(replace(v_before, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'fn_lightning_rollout_readiness original tick reference was expected exactly once';
  END IF;

  v_after := replace(v_before, v_old, v_new);
  EXECUTE v_after;

  IF replace(pg_get_functiondef(v_readiness_oid), v_new, v_old) <> v_before
     OR EXISTS (
       SELECT 1 FROM pg_proc
        WHERE oid = v_readiness_oid
          AND (proowner IS DISTINCT FROM v_catalog.proowner
               OR proacl IS DISTINCT FROM v_catalog.proacl
               OR proconfig IS DISTINCT FROM v_catalog.proconfig
               OR prosecdef IS DISTINCT FROM v_catalog.prosecdef
               OR provolatile IS DISTINCT FROM v_catalog.provolatile)
     ) THEN
    RAISE EXCEPTION 'fn_lightning_rollout_readiness repoint changed unrelated source or authority';
  END IF;

  -- 3. Fail closed if any remaining function in public or smarter_private
  --    still references the retired original tick functions in non-comment SQL.
  SELECT array_agg(n.nspname || '.' || p.proname ORDER BY n.nspname, p.proname)
    INTO v_stragglers
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('public', 'smarter_private')
     AND p.prokind = 'f'
     AND p.oid IS DISTINCT FROM v_tick_oid
     AND p.oid IS DISTINCT FROM v_tick_all_oid
     AND regexp_replace(pg_get_functiondef(p.oid), '--[^' || chr(10) || ']*', '', 'g')
         ~ '(fn_cash_cluster_tick|fn_cash_clusters_tick_all)\s*(\(|''::regproc)';
  IF cardinality(v_stragglers) > 0 THEN
    RAISE EXCEPTION 'refusing to drop original cluster tick while other functions reference it: %', v_stragglers;
  END IF;
END
$retire_original_tick$;

-- 4. Drop the retired capped originals.
DROP FUNCTION IF EXISTS public.fn_cash_clusters_tick_all(jsonb);
DROP FUNCTION IF EXISTS public.fn_cash_cluster_tick(uuid, integer);

-- 5. Verify post-state.
DO $verify_retired$
BEGIN
  IF to_regprocedure('public.fn_cash_clusters_tick_all(jsonb)') IS NOT NULL
     OR to_regprocedure('public.fn_cash_cluster_tick(uuid,integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'original cluster tick functions are still present after DROP';
  END IF;
  IF to_regprocedure('public.fn_cash_clusters_tick_all_uncapped(jsonb)') IS NULL
     OR to_regprocedure('public.fn_cash_cluster_tick_uncapped(uuid,integer)') IS NULL THEN
    RAISE EXCEPTION 'uncapped cluster tick functions disappeared';
  END IF;
  IF position('''public.fn_cash_clusters_tick_all_uncapped(jsonb)''::regprocedure'
              IN pg_get_functiondef('public.fn_lightning_rollout_readiness(uuid)'::regprocedure)) = 0
     OR position('''public.fn_cash_clusters_tick_all(jsonb)''::regprocedure'
                 IN pg_get_functiondef('public.fn_lightning_rollout_readiness(uuid)'::regprocedure)) > 0 THEN
    RAISE EXCEPTION 'fn_lightning_rollout_readiness did not repoint cleanly to the uncapped tick';
  END IF;
END
$verify_retired$;

-- @probe-for: public.fn_lightning_rollout_readiness
DO $probe_readiness$
DECLARE
  v_cluster uuid;
  v_out     jsonb;
BEGIN
  -- Execute the repointed readiness read after the originals are dropped.
  -- On a cluster row this runs v_anti against fn_cash_clusters_tick_all_uncapped(jsonb).
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  SELECT g.id INTO v_cluster FROM public.cash_games g ORDER BY g.id LIMIT 1;
  v_out := public.fn_lightning_rollout_readiness(COALESCE(v_cluster, gen_random_uuid()));
  IF v_cluster IS NOT NULL THEN
    IF COALESCE((v_out ->> 'ok')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'fn_lightning_rollout_readiness probe returned ok=false: %', v_out;
    END IF;
    IF COALESCE((v_out -> 'evidence' -> 'invariants' ->> 'anti_manipulation')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'fn_lightning_rollout_readiness anti_manipulation failed against uncapped tick: %', v_out;
    END IF;
  ELSIF v_out ->> 'code' IS DISTINCT FROM 'NOT_FOUND' THEN
    RAISE EXCEPTION 'fn_lightning_rollout_readiness probe expected NOT_FOUND on empty catalog, got %', v_out;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END
$probe_readiness$;

COMMIT;
