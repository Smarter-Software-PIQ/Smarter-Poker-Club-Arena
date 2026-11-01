-- 20261101134516_engine_release_reads_which_public_functions_are_missing.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- @live-proof: (SELECT p.provolatile='s' AND NOT p.prosecdef AND p.proconfig @> ARRAY['search_path=pg_catalog'] AND pg_get_userbyid(p.proowner)='postgres' AND has_function_privilege('service_role',p.oid,'EXECUTE') AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE') AND NOT has_function_privilege('anon',p.oid,'EXECUTE') FROM pg_proc p WHERE p.oid='public.fn_ca_engine_release_missing_functions(text[])'::regprocedure)
--
-- WHAT THIS CHANGES, AND WHY:
--
-- A DOOR A QUEUED WINDOW MIGRATION SUPPLIES (2026-11-01). The receiver's door
-- check (scripts/ci/check-engine-doors-exist.mjs) may now admit an engine
-- release whose missing database function is created by a queued
-- daily-maintenance window migration, because that migration is
-- installed inside the same 04:00 America/Chicago freeze the release cuts over
-- in. The host release transaction then has to see, before it seals the
-- candidate, that the window installer really did create every such function.
-- The transaction talks to production only through PostgREST with the
-- engine's service-role key, and pg_catalog is not exposed there, so this is
-- the one read it needs: given names, return the ones schema public lacks.
--
-- It is a catalog read and nothing else: SQL, STABLE, SECURITY INVOKER, no
-- table access, pinned search_path, executable by service_role only. It adds
-- no lock on any live table (CREATE FUNCTION locks nothing a player uses), so
-- it is an ordinary migration, not a window one.

BEGIN;

SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

CREATE FUNCTION public.fn_ca_engine_release_missing_functions(p_names text[])
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $fn$
  SELECT coalesce(array_agg(DISTINCT u.name ORDER BY u.name), '{}'::text[])
    FROM unnest(coalesce(p_names, '{}'::text[])) AS u(name)
   WHERE NOT EXISTS (
     SELECT 1
       FROM pg_catalog.pg_proc p
       JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = u.name)
$fn$;

COMMENT ON FUNCTION public.fn_ca_engine_release_missing_functions(text[]) IS
  'Engine release proof: of the given names, the ones schema public has no function for. Read only. See docs/changelog/2026-11-01-a-door-a-queued-window-migration-supplies.md';

REVOKE ALL ON FUNCTION public.fn_ca_engine_release_missing_functions(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_engine_release_missing_functions(text[]) TO service_role;

COMMIT;
