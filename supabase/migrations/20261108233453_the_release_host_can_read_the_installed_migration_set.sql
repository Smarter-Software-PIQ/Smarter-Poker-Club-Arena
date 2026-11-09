-- ===========================================================================
-- THE RELEASE HOST CAN READ THE INSTALLED MIGRATION SET (2026-11-08)
--
-- A Backup copy is certified for what it contains, never for a clock. Backup
-- run 42519319251 restored at 20:38:05Z; migration 20261108193515 installed
-- in production at 20:38:11Z, six seconds later, and the copy lacked it while
-- every commit and restore time said it was fresh. Run 42521781581 exported
-- while 20261108210509 installed (21:38:56Z) and lacked it too.
--
-- The Backup export records production's installed set (version, name of
-- each supabase_migrations.schema_migrations row; server/standby/schema-
-- evidence.py) bound to its dump, and the certificate names that set. At
-- cutover, after the break admits a release and before the engine lock, the
-- release host re-reads production's set and refuses if a migration installed
-- after certification. The host holds only the engine's REST credential, and
-- PostgREST does not expose supabase_migrations, so this is the narrow door:
-- the same [[version, name], ...] rows the evidence holds, never the
-- statements. service_role only, read-only, no row writes. Proved identical
-- to the evidence query by scripts/ci/test-installed-migration-listing-postgres.py.
-- ===========================================================================

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RAISE EXCEPTION 'PRE-FLIGHT: supabase_migrations.schema_migrations is missing';
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION public.fn_ca_installed_migration_listing()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, pg_temp
AS $function$
  SELECT coalesce(json_agg(json_build_array(m.version, m.name) ORDER BY m.version, m.name), '[]'::json)
    FROM supabase_migrations.schema_migrations m;
$function$;

COMMENT ON FUNCTION public.fn_ca_installed_migration_listing() IS
  'Installed migrations as [[version, name], ...], the rows the Backup schema evidence holds. '
  'Read by the release host before cutover (engine-release-installed-migrations.py status).';

REVOKE ALL ON FUNCTION public.fn_ca_installed_migration_listing() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_installed_migration_listing() TO service_role;

DO $postcheck$
DECLARE
  v_rows bigint;
BEGIN
  SELECT count(*) INTO v_rows FROM supabase_migrations.schema_migrations;
  IF v_rows = 0 OR json_array_length(public.fn_ca_installed_migration_listing()) <> v_rows THEN
    RAISE EXCEPTION 'POST-APPLY: the listing does not hold one row per installed migration';
  END IF;
  IF has_function_privilege('anon', 'public.fn_ca_installed_migration_listing()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_ca_installed_migration_listing()', 'EXECUTE') THEN
    RAISE EXCEPTION 'POST-APPLY: the listing is executable by a browser role';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.fn_ca_installed_migration_listing()', 'EXECUTE') THEN
    RAISE EXCEPTION 'POST-APPLY: service_role cannot read the listing';
  END IF;
END
$postcheck$;

COMMIT;
