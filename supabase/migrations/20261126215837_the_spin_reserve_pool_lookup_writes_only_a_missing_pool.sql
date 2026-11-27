-- @live-proof: strpos(pg_get_functiondef('public.fn_spin_reserve_pool(uuid)'::regprocedure), 'A LOOKUP NEVER WRITES AN EXISTING POOL') > 0
-- @live-proof: has_function_privilege('service_role', 'public.fn_spin_reserve_pool(uuid)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.fn_spin_reserve_pool(uuid)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.fn_spin_reserve_pool(uuid)', 'EXECUTE')
-- @replaces-md5: public.fn_spin_reserve_pool(uuid)=d3596faa39ba012e437d769386f8a057
-- 20261126215837_the_spin_reserve_pool_lookup_writes_only_a_missing_pool.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- rpc/fn_spin_draw_and_settle_atomic answered 500 nine times in the 24 hours
-- to 2026-11-26 21:45 UTC (00:54:24-00:55:21 seven times in a row, then
-- twice more to 04:33), every one "canceling statement due to lock timeout"
-- with this exact context (postgres_logs):
--
--   while locking tuple (12,2) in relation "clubs"
--   SELECT 1 FROM public.clubs c WHERE c.id IN (v_club_id, v_old_club_id)
--     ORDER BY c.id FOR KEY SHARE
--   PL/pgSQL function fn_guard_retired_club_mutation() line 114
--   INSERT INTO public.spin_bonus_pools (club_id, owner_kind) ...
--     ON CONFLICT (club_id) DO NOTHING
--   PL/pgSQL function fn_spin_reserve_pool(uuid) line 6
--   SELECT COALESCE(sum(...)) FROM public.tournaments t WHERE t.variant='spin'
--     ... AND public.fn_spin_reserve_pool(t.club_id) = v_owner ...
--   PL/pgSQL function fn_spin_draw_multiplier(...) line 22
--   PL/pgSQL function fn_spin_draw_and_settle_atomic(...) line 276
--
-- ROOT CAUSE. fn_spin_reserve_pool answers "which pool owns this club" and,
-- as a side effect, makes sure the pool row exists with an
-- INSERT ... ON CONFLICT DO NOTHING. Postgres runs BEFORE ROW INSERT triggers
-- on the proposed row BEFORE it detects the conflict, so every call fired
-- trg_guard_retired_club_mutation (which takes FOR KEY SHARE on the club
-- row), trg_ca_block_browser and the statement-level
-- aaa_ca_refuse_replica_money_write, even though the pool has existed since
-- the club's first Spin. fn_spin_draw_multiplier calls it once PER Spin
-- tournament of the last 24 hours inside its pending-prize aggregate, so one
-- draw key-share-locked the club row of every recent Spin's club. While any
-- one of those club rows was held FOR UPDATE (a club retirement or a
-- certification-fixture cleanup holds a club row that way), the draw waited
-- out its lock_timeout and the whole draw rolled back: a Spin whose three
-- players were seated could not draw its multiplier until an unrelated club
-- row was released.
--
-- FIX. A lookup never writes an existing pool. The pool row is read first (a
-- unique-index probe: no row lock, no trigger); only a genuinely missing pool
-- takes the original INSERT ... ON CONFLICT DO NOTHING path, unchanged, so a
-- new club's first Spin still creates its pool exactly as before, under the
-- same triggers and the same retired-club guard. Return value, owner
-- resolution (fn_spin_reserve_owner), SECURITY DEFINER, search_path and
-- grants are identical to the live definition read on 2026-11-26 (md5
-- d3596faa39ba012e437d769386f8a057, proacl
-- {postgres=X/postgres,service_role=X/postgres}; no installed function pins
-- that md5).
--
-- No money moves, no row is written by this migration, and no repair runs.
--
-- Pinned by tests/a-spin-pool-lookup-never-writes-an-existing-pool.law.test.ts.

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

CREATE OR REPLACE FUNCTION public.fn_spin_reserve_pool(p_club_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_owner uuid;
BEGIN
  v_owner := public.fn_spin_reserve_owner(p_club_id);

  -- A LOOKUP NEVER WRITES AN EXISTING POOL (20261126215837). An INSERT ...
  -- ON CONFLICT DO NOTHING still fires the BEFORE ROW triggers (the
  -- retired-club guard key-share-locks the club row), and the Spin draw calls
  -- this once per recent Spin, so an existing pool is answered by a read.
  IF EXISTS (SELECT 1 FROM public.spin_bonus_pools p WHERE p.club_id = v_owner) THEN
    RETURN v_owner;
  END IF;

  INSERT INTO public.spin_bonus_pools (club_id, owner_kind)
  VALUES (v_owner,
          CASE WHEN EXISTS (SELECT 1 FROM public.unions u WHERE u.id = v_owner)
               THEN 'union' ELSE 'club' END)
  ON CONFLICT (club_id) DO NOTHING;

  RETURN v_owner;
END; $function$;

REVOKE ALL ON FUNCTION public.fn_spin_reserve_pool(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_spin_reserve_pool(uuid) TO service_role;

-- @probe-for: public.fn_spin_reserve_pool
DO $probe$
DECLARE
  v_club uuid;
  v_owner uuid;
BEGIN
  SELECT p.club_id INTO v_club FROM public.spin_bonus_pools p ORDER BY p.club_id LIMIT 1;
  IF v_club IS NOT NULL THEN
    v_owner := public.fn_spin_reserve_pool(v_club);
    IF v_owner IS DISTINCT FROM public.fn_spin_reserve_owner(v_club) THEN
      RAISE EXCEPTION 'fn_spin_reserve_pool probe: owner % is not fn_spin_reserve_owner(%)', v_owner, v_club;
    END IF;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
