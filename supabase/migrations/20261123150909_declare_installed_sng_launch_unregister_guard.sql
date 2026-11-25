-- 20261123150909_declare_installed_sng_launch_unregister_guard.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- Record the omitted guard declaration for immutable, already-installed
-- 20261122222254_a_sit_and_go_whose_launch_has_begun_cannot_be_unregistered.sql.
--
-- WHAT WENT WRONG. Installed migration 20261122222254 patched watched guard
-- public.fn_poker_diamond_tournament_unregister(uuid,uuid,uuid) via
-- pg_get_functiondef('public.fn_poker_diamond_tournament_unregister(...)'::regprocedure)
-- and EXECUTE without calling fn_ca_declare_guard_redefinition in the same
-- transaction. The law test a-declared-guard-change-is-recorded-not-raised
-- only recognized p.proname = '<guard>' asserted-substitution patches, so it
-- missed the ::regprocedure form. fn_ca_guard_defs_watch observed the new hash
-- 87057141df59ad86d5bcbad4e6d4a0b7 at 2026-11-22 23:25:00Z and opened INFO
-- drift incident 90d4fdff-011a-46c4-85e7-87d1519e2107.
--
-- WHY THIS FILE RECORDS FORWARD. Installed migration 20261122222254 is
-- immutable in supabase_migrations.schema_migrations. This file records only
-- the declaration after proving the exact installed migration sha256, live
-- function hash, owner, and privileges. It carries no DDL and modifies no
-- function body, grant, or incident row (incident 90d4fdff is resolved in
-- companion migration 20261123151024 once this declaration is recorded).
--
-- @live-proof: EXISTS (SELECT 1 FROM public.ca_guard_defs WHERE proname = 'fn_poker_diamond_tournament_unregister' AND declared_ref LIKE '%20261123150909%')

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

DO $declare_installed_sng_launch_unregister_guard$
DECLARE
  v_ref constant text := 'migration 20261122222254_a_sit_and_go_whose_launch_has_begun_cannot_be_unregistered; omitted declaration recorded by migration 20261123150909_declare_installed_sng_launch_unregister_guard';
  v_expected constant text := '87057141df59ad86d5bcbad4e6d4a0b7';
  v_declared text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
     WHERE version = '20261122222254'
       AND name = 'a_sit_and_go_whose_launch_has_begun_cannot_be_unregistered'
       AND cardinality(statements) = 1
       AND encode(extensions.digest(convert_to(array_to_string(statements, E'\n'), 'UTF8'), 'sha256'), 'hex')
         = '678ac1b98f096a0651e0b95ca91c123dc743f5f7e40daaa3029c202ad236f87d'
  ) THEN
    RAISE EXCEPTION 'sng launch unregister guard declaration refuses unmatched installed migration history for 20261122222254';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.oid=to_regprocedure('public.fn_ca_declare_guard_redefinition(text,text)')
       AND md5(pg_get_functiondef(p.oid))='3a3746dc6e0a5b7a1db97805588c0eb8'
       AND pg_get_userbyid(p.proowner)='postgres'
       AND p.proacl::text='{postgres=X/postgres,service_role=X/postgres}'
  ) THEN
    RAISE EXCEPTION 'sng launch unregister guard declaration refuses changed declaration helper';
  END IF;

  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname='fn_poker_diamond_tournament_unregister') <> 1
     OR NOT EXISTS (
       SELECT 1 FROM pg_proc p
        WHERE p.oid=to_regprocedure('public.fn_poker_diamond_tournament_unregister(uuid,uuid,uuid)')
          AND md5(pg_get_functiondef(p.oid))=v_expected
          AND pg_get_userbyid(p.proowner)='postgres'
          AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
          AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
          AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
     ) THEN
    RAISE EXCEPTION 'declaration refuses changed definition, owner, or grants for fn_poker_diamond_tournament_unregister';
  END IF;

  v_declared := public.fn_ca_declare_guard_redefinition(
    'fn_poker_diamond_tournament_unregister',
    v_ref
  );
  IF v_declared IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'declaration hash moved during recording for fn_poker_diamond_tournament_unregister';
  END IF;
END
$declare_installed_sng_launch_unregister_guard$;

COMMIT;
