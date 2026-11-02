// Disposable PG17 extension-context GRANTs reproduce captured namespace initial ACLs.
// This installs no GraphQL implementation and writes no PostgreSQL catalog directly.
const context = `current_database()='club_arena_qualification'
  AND inet_server_addr() IS NULL AND current_user='supabase_admin' AND session_user='supabase_admin'
  AND current_setting('server_version_num')::integer BETWEEN 170000 AND 179999
  AND current_setting('search_path')='pg_catalog'
  AND EXISTS(SELECT FROM pg_catalog.pg_roles WHERE oid=10 AND rolname=current_user AND rolsuper)`;
const acl = "ARRAY['anon=U/supabase_admin','authenticated=U/supabase_admin','postgres=U*/supabase_admin','service_role=U/supabase_admin','supabase_admin=UC/supabase_admin']::text[]";
const namespaces = `SELECT n.oid,n.nspname,n.nspowner,n.nspacl FROM pg_catalog.pg_namespace n
  WHERE n.nspname IN ('graphql','graphql_public')`;
const currentExact = `(SELECT count(*)=2 AND bool_and((n.nspowner=10
  AND (SELECT array_agg(a::text ORDER BY a::text) FROM unnest(n.nspacl) a)=${acl}
  AND NOT EXISTS(SELECT FROM pg_catalog.pg_depend d WHERE d.classid='pg_catalog.pg_namespace'::regclass
    AND d.objid=n.oid AND d.objsubid=0 AND d.deptype='e')) IS TRUE) FROM (${namespaces}) n)`;
const helperAbsent = `NOT EXISTS(SELECT FROM pg_catalog.pg_extension WHERE extname='fixture_graphql_acl_baseline')`;
const initialAbsent = `NOT EXISTS(SELECT FROM pg_catalog.pg_init_privs p
  WHERE p.classoid='pg_catalog.pg_namespace'::regclass AND p.objoid IN (SELECT oid FROM (${namespaces}) n))`;
const initialExact = `(SELECT count(*)=2 AND bool_and((p.objsubid=0 AND p.privtype='e'
  AND p.initprivs=n.nspacl) IS TRUE) FROM (${namespaces}) n
  JOIN pg_catalog.pg_init_privs p ON p.objoid=n.oid AND p.classoid='pg_catalog.pg_namespace'::regclass)`;
export const graphqlLegacyAclObservationSql = `SELECT (${context}) AND ${currentExact}
  AND ${helperAbsent} AND ${initialExact} AS graphql_legacy_acl_exact`;
export const graphqlLegacyAclInstallSql = `DO $graphql_acl_preimage$
BEGIN
  IF (${context}) IS DISTINCT FROM TRUE OR ${currentExact} IS DISTINCT FROM TRUE
    OR (${helperAbsent}) IS DISTINCT FROM TRUE OR (${initialAbsent}) IS DISTINCT FROM TRUE
    OR (SELECT count(*)=1 AND bool_and((version='1.0' AND superuser AND NOT trusted
      AND NOT relocatable AND schema='pg_catalog' AND requires IS NULL) IS TRUE)
      FROM pg_catalog.pg_available_extension_versions WHERE name='fixture_graphql_acl_baseline') IS DISTINCT FROM TRUE
  THEN RAISE EXCEPTION 'FIXTURE_GRAPHQL_ACL_PREIMAGE_REQUIRED'; END IF;
END $graphql_acl_preimage$;
CREATE EXTENSION fixture_graphql_acl_baseline WITH SCHEMA pg_catalog VERSION '1.0';
DO $graphql_acl_members$
BEGIN
  IF (SELECT count(*)=1 AND bool_and((e.extowner=10 AND e.extversion='1.0'
    AND e.extnamespace='pg_catalog'::regnamespace AND NOT EXISTS(SELECT FROM pg_catalog.pg_depend d
      WHERE d.refclassid='pg_catalog.pg_extension'::regclass AND d.refobjid=e.oid AND d.deptype='e')) IS TRUE)
    FROM pg_catalog.pg_extension e WHERE e.extname='fixture_graphql_acl_baseline') IS DISTINCT FROM TRUE
  THEN RAISE EXCEPTION 'FIXTURE_GRAPHQL_ACL_EMPTY_HELPER_REQUIRED'; END IF;
END $graphql_acl_members$;
DROP EXTENSION fixture_graphql_acl_baseline RESTRICT;
DO $graphql_acl_postimage$
BEGIN
  IF (${context}) IS DISTINCT FROM TRUE OR ${currentExact} IS DISTINCT FROM TRUE
    OR (${helperAbsent}) IS DISTINCT FROM TRUE OR ${initialExact} IS DISTINCT FROM TRUE
  THEN RAISE EXCEPTION 'FIXTURE_GRAPHQL_ACL_POSTIMAGE_REQUIRED'; END IF;
END $graphql_acl_postimage$;`;
