-- 20261115051140_the_dormant_broken_functions_resolve_or_are_retired.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- 20261115020406 installed the commit-time guard that refuses a plpgsql
-- function calling a signature that does not exist. Its audit of the functions
-- already installed found six that would raise 42883 the first time they ran.
-- Two of them are fixed here; the final-table deal trio and the v2 place-batch
-- branch of fn_tournament_finish_readiness are fixed in their own change.
--
-- 1. public.fn_gto_v31_promote_dataset_epoch(uuid,text,text) is pinned to
--    search_path = public, but hashes the epoch checksum with digest(text,
--    text), which pgcrypto installs in schema extensions on this database.
--    The call can never resolve, so promoting any V31 dataset would fail with
--    "function digest(text, unknown) does not exist" at the last step, after
--    the whole evaluation had passed. Nothing calls it today (the V31 program
--    is formally parked, 20261107130621), which is why it was never seen; the
--    re-open condition of that parking is exactly a promotion, so the defect
--    would surface the first time V31 is allowed to succeed. The root fix is
--    the function's own search_path: add extensions, the schema the rest of
--    the database already resolves pgcrypto from. The body is unchanged.
--    Proved before this file was written with a pg_temp copy of the live
--    definition: the guard helper reports 2 unresolved calls for the current
--    search_path and 0 with extensions added.
--
-- 2. public.pgmigrate(text) is a one-line wrapper, RETURN public.exec_sql(p_sql),
--    and public.exec_sql(text) was dropped on purpose by 20260908042700 as an
--    arbitrary-SQL executor. The wrapper was left behind: it still holds an
--    EXECUTE grant to service_role, nothing in this repository or the database
--    calls it, and it can only ever raise 42883. Worse, it is a ready-made door:
--    if anyone ever recreated an exec_sql, pgmigrate would expose it again under
--    a second name. All future DDL is a named migration, so it is retired the
--    same way exec_sql was.
--
-- Both are guarded by to_regprocedure / IF EXISTS so a schema replay that never
-- created either object installs this file as a no-op.
--
-- @live-proof: EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proconfig) c WHERE p.oid = to_regprocedure('public.fn_gto_v31_promote_dataset_epoch(uuid,text,text)') AND c LIKE 'search_path=%extensions%') AND to_regprocedure('public.pgmigrate(text)') IS NULL

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $gto$
BEGIN
  IF to_regprocedure('public.fn_gto_v31_promote_dataset_epoch(uuid,text,text)') IS NOT NULL THEN
    ALTER FUNCTION public.fn_gto_v31_promote_dataset_epoch(uuid, text, text)
      SET search_path = public, extensions;
  END IF;
END
$gto$;

DROP FUNCTION IF EXISTS public.pgmigrate(text);

COMMIT;
