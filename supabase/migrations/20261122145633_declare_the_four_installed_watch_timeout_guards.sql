-- Record the four omitted guard declarations for immutable, already-installed
-- 20261121154220_cashout_hotpath_active_seat_floor_guard_exit_and_watch_locks.sql.
--
-- WHAT WENT WRONG. Installed migration 20261121154220 added bounded
-- lock_timeout ('2s') and statement_timeout ('30s') to every public
-- fn_ca_%_watch function via dynamic metadata statements without calling
-- fn_ca_declare_guard_redefinition in the same transaction. Four of those
-- functions are on fn_ca_guard_watchlist(), and pg_get_functiondef() includes
-- SET lock_timeout / SET statement_timeout, so fn_ca_guard_defs_watch observed
-- four undeclared hash changes at 2026-11-21 20:25:00Z and opened four INFO
-- drift incidents on the board:
--
--   54d7fe1e-661d-436a-a5e1-6b60720d00fb  fn_ca_guard_defs_watch        f933e6ebd08b2fa9f68999456c8bfa7d
--   f4733687-4d8d-4577-a996-729688975e9d  fn_ca_negative_balance_watch  ee71aca875e86f31b8a1c3f50057a983
--   77b028f4-5c18-4564-a568-1ae4bdc098aa  fn_ca_mint_velocity_watch     89a724afafa6c53c6394113e0b9f1a02
--   1e303f5e-fade-456a-ab9e-bd92c632f0b3  fn_ca_cron_failure_watch      abfdb87ae401c6792e508afa416cc83f
--
-- WHY THIS FILE RECORDS FORWARD. Installed migration 20261121154220 is
-- immutable in supabase_migrations.schema_migrations. This file records only
-- the four declarations after proving the exact installed migration digest,
-- live function hashes, owner, and service_role grants. It carries no DDL and
-- modifies no function body, grant, or incident row.
--
-- @live-proof: (SELECT count(*) FROM public.ca_guard_defs WHERE proname IN ('fn_ca_guard_defs_watch','fn_ca_negative_balance_watch','fn_ca_mint_velocity_watch') AND declared_ref LIKE '%20261122145633%') = 3 AND EXISTS (SELECT 1 FROM public.ca_guard_defs WHERE proname = 'fn_ca_cron_failure_watch' AND declared_ref IS NOT NULL AND declared_ref NOT LIKE '%20261120222900%')
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

DO $declare_installed_watch_timeout_guards$
DECLARE
  v_ref constant text := 'migration 20261121154220_cashout_hotpath_active_seat_floor_guard_exit_and_watch_locks; omitted declaration recorded by migration 20261122145633_declare_the_four_installed_watch_timeout_guards';
  v_expected text;
  v_declared text;
  v_guard text;
  v_pair record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = '20261121154220'
      AND name = 'cashout_hotpath_active_seat_floor_guard_exit_and_watch_locks'
      AND cardinality(statements) = 1
      AND encode(extensions.digest(convert_to(array_to_string(statements,E'\n'),'UTF8'),'sha256'),'hex')
        = '0cd4353c5263580fc141140e31d7d7fdd054d1538ddcc3cc5621489214d6199b'
  ) THEN
    RAISE EXCEPTION 'watch timeout guard declaration refuses unmatched installed migration history for 20261121154220';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid=to_regprocedure('public.fn_ca_declare_guard_redefinition(text,text)')
      AND md5(pg_get_functiondef(p.oid))='3a3746dc6e0a5b7a1db97805588c0eb8'
      AND pg_get_userbyid(p.proowner)='postgres'
      AND p.proacl::text='{postgres=X/postgres,service_role=X/postgres}'
  ) THEN
    RAISE EXCEPTION 'watch timeout guard declaration refuses changed declaration helper';
  END IF;

  -- Guard 1: fn_ca_guard_defs_watch
  v_guard := 'fn_ca_guard_defs_watch';
  v_expected := 'f933e6ebd08b2fa9f68999456c8bfa7d';
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname=v_guard) <> 1
    OR NOT EXISTS (
      SELECT 1 FROM pg_proc p
      WHERE p.oid=to_regprocedure('public.fn_ca_guard_defs_watch()')
        AND md5(pg_get_functiondef(p.oid))=v_expected
        AND pg_get_userbyid(p.proowner)='postgres'
        AND p.proacl::text='{postgres=X/postgres,service_role=X/postgres}'
    ) THEN
    RAISE EXCEPTION 'declaration refuses changed definition, owner, or grants for %', v_guard;
  END IF;
  v_declared := public.fn_ca_declare_guard_redefinition(
    'fn_ca_guard_defs_watch',
    v_ref
  );
  IF v_declared IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'declaration hash moved during recording for %', v_guard;
  END IF;

  -- Guard 2: fn_ca_negative_balance_watch
  v_guard := 'fn_ca_negative_balance_watch';
  v_expected := 'ee71aca875e86f31b8a1c3f50057a983';
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname=v_guard) <> 1
    OR NOT EXISTS (
      SELECT 1 FROM pg_proc p
      WHERE p.oid=to_regprocedure('public.fn_ca_negative_balance_watch()')
        AND md5(pg_get_functiondef(p.oid))=v_expected
        AND pg_get_userbyid(p.proowner)='postgres'
        AND p.proacl::text='{postgres=X/postgres,service_role=X/postgres}'
    ) THEN
    RAISE EXCEPTION 'declaration refuses changed definition, owner, or grants for %', v_guard;
  END IF;
  v_declared := public.fn_ca_declare_guard_redefinition(
    'fn_ca_negative_balance_watch',
    v_ref
  );
  IF v_declared IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'declaration hash moved during recording for %', v_guard;
  END IF;

  -- Guard 3: fn_ca_mint_velocity_watch
  v_guard := 'fn_ca_mint_velocity_watch';
  v_expected := '89a724afafa6c53c6394113e0b9f1a02';
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname=v_guard) <> 1
    OR NOT EXISTS (
      SELECT 1 FROM pg_proc p
      WHERE p.oid=to_regprocedure('public.fn_ca_mint_velocity_watch()')
        AND md5(pg_get_functiondef(p.oid))=v_expected
        AND pg_get_userbyid(p.proowner)='postgres'
        AND p.proacl::text='{postgres=X/postgres,service_role=X/postgres}'
    ) THEN
    RAISE EXCEPTION 'declaration refuses changed definition, owner, or grants for %', v_guard;
  END IF;
  v_declared := public.fn_ca_declare_guard_redefinition(
    'fn_ca_mint_velocity_watch',
    v_ref
  );
  IF v_declared IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'declaration hash moved during recording for %', v_guard;
  END IF;

  -- Guard 4: fn_ca_cron_failure_watch
  v_guard := 'fn_ca_cron_failure_watch';
  v_expected := 'abfdb87ae401c6792e508afa416cc83f';
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname=v_guard) <> 1
    OR NOT EXISTS (
      SELECT 1 FROM pg_proc p
      WHERE p.oid=to_regprocedure('public.fn_ca_cron_failure_watch()')
        AND md5(pg_get_functiondef(p.oid))=v_expected
        AND pg_get_userbyid(p.proowner)='postgres'
        AND p.proacl::text='{postgres=X/postgres,service_role=X/postgres}'
    ) THEN
    RAISE EXCEPTION 'declaration refuses changed definition, owner, or grants for %', v_guard;
  END IF;
  v_declared := public.fn_ca_declare_guard_redefinition(
    'fn_ca_cron_failure_watch',
    v_ref
  );
  IF v_declared IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'declaration hash moved during recording for %', v_guard;
  END IF;
END;
$declare_installed_watch_timeout_guards$;

COMMIT;
