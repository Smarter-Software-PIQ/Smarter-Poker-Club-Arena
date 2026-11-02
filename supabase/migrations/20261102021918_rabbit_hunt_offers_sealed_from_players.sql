-- 20261102021918_rabbit_hunt_offers_sealed_from_players.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- #9233 (Dan 2026-11-01) made the engine WRITE public.rabbit_hunt_offers
-- again, so a VIP can rabbit hunt a previous hand from the replayer. The
-- table is RLS-on with no policies, so a direct read returns nothing - but
-- the original 2026-08-23 door into it was never closed:
--
--   public.fn_reveal_rabbit_hunt(uuid, bigint) is SECURITY DEFINER and
--   EXECUTE is granted to `authenticated`. It reads the cards straight out
--   of rabbit_hunt_offers and returns them to any signed-in caller who has
--   been seated at that table in the last five minutes, at its own 2026-08
--   price, with no VIP rule. It has had no caller in the codebase since the
--   economy moved in-engine (fn_consume_rabbit_hunt_v2, engine-only), and it
--   was harmless only because the table it reads stayed empty.
--
-- Verified 2026-11-02 before this change: 0 rows in rabbit_hunt_offers (the
-- serving engine predates #9233), so nothing has been exposed. This closes
-- the door before the first row is written. The engine (service_role) is
-- the only reader the feature needs.
--
-- Also revoked: the table-level SELECT that anon/authenticated still hold.
-- RLS with no policies already returns zero rows; the grant is removed so
-- a future policy mistake cannot reopen the cards on its own.
--
-- The function is kept, not dropped, so the historical fixtures that load
-- it still load; it simply has no browser-reachable caller.

-- @live-proof: NOT has_function_privilege('authenticated','public.fn_reveal_rabbit_hunt(uuid,bigint)','EXECUTE') AND NOT has_function_privilege('anon','public.fn_reveal_rabbit_hunt(uuid,bigint)','EXECUTE') AND NOT has_table_privilege('authenticated','public.rabbit_hunt_offers','SELECT') AND NOT has_table_privilege('anon','public.rabbit_hunt_offers','SELECT')

BEGIN;

REVOKE ALL ON FUNCTION public.fn_reveal_rabbit_hunt(uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_reveal_rabbit_hunt(uuid, bigint) TO service_role;

REVOKE ALL ON TABLE public.rabbit_hunt_offers FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF has_function_privilege('authenticated', 'public.fn_reveal_rabbit_hunt(uuid,bigint)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_reveal_rabbit_hunt(uuid,bigint)', 'EXECUTE')
     OR has_table_privilege('authenticated', 'public.rabbit_hunt_offers', 'SELECT')
     OR has_table_privilege('anon', 'public.rabbit_hunt_offers', 'SELECT') THEN
    RAISE EXCEPTION 'rabbit_hunt_offers is still reachable by a player role';
  END IF;
END $$;

COMMIT;
