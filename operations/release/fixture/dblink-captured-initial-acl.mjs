// Genuine dblink remains the provider. Disposable extension-context GRANTs record
// the independently captured PostgreSQL17 initial ACL; no catalogue writes.
const memberInventory = Object.freeze([
  [
    "dblink",
    "25",
    false
  ],
  [
    "dblink",
    "25 16",
    false
  ],
  [
    "dblink",
    "25 25",
    false
  ],
  [
    "dblink",
    "25 25 16",
    false
  ],
  [
    "dblink_build_sql_delete",
    "25 22 23 1009",
    false
  ],
  [
    "dblink_build_sql_insert",
    "25 22 23 1009 1009",
    false
  ],
  [
    "dblink_build_sql_update",
    "25 22 23 1009 1009",
    false
  ],
  [
    "dblink_cancel_query",
    "25",
    false
  ],
  [
    "dblink_close",
    "25",
    false
  ],
  [
    "dblink_close",
    "25 16",
    false
  ],
  [
    "dblink_close",
    "25 25",
    false
  ],
  [
    "dblink_close",
    "25 25 16",
    false
  ],
  [
    "dblink_connect",
    "25",
    false
  ],
  [
    "dblink_connect",
    "25 25",
    false
  ],
  [
    "dblink_connect_u",
    "25",
    true
  ],
  [
    "dblink_connect_u",
    "25 25",
    true
  ],
  [
    "dblink_current_query",
    "",
    false
  ],
  [
    "dblink_disconnect",
    "",
    false
  ],
  [
    "dblink_disconnect",
    "25",
    false
  ],
  [
    "dblink_error_message",
    "25",
    false
  ],
  [
    "dblink_exec",
    "25",
    false
  ],
  [
    "dblink_exec",
    "25 16",
    false
  ],
  [
    "dblink_exec",
    "25 25",
    false
  ],
  [
    "dblink_exec",
    "25 25 16",
    false
  ],
  [
    "dblink_fdw_validator",
    "1009 26",
    false
  ],
  [
    "dblink_fetch",
    "25 23",
    false
  ],
  [
    "dblink_fetch",
    "25 23 16",
    false
  ],
  [
    "dblink_fetch",
    "25 25 23",
    false
  ],
  [
    "dblink_fetch",
    "25 25 23 16",
    false
  ],
  [
    "dblink_get_connections",
    "",
    false
  ],
  [
    "dblink_get_notify",
    "",
    false
  ],
  [
    "dblink_get_notify",
    "25",
    false
  ],
  [
    "dblink_get_pkey",
    "25",
    false
  ],
  [
    "dblink_get_result",
    "25",
    false
  ],
  [
    "dblink_get_result",
    "25 16",
    false
  ],
  [
    "dblink_is_busy",
    "25",
    false
  ],
  [
    "dblink_open",
    "25 25",
    false
  ],
  [
    "dblink_open",
    "25 25 16",
    false
  ],
  [
    "dblink_open",
    "25 25 25",
    false
  ],
  [
    "dblink_open",
    "25 25 25 16",
    false
  ],
  [
    "dblink_send_query",
    "25 25",
    false
  ]
].map((row) => Object.freeze(row)));
const context = `current_database()='club_arena_qualification'
  AND inet_server_addr() IS NULL AND current_user='supabase_admin' AND session_user='supabase_admin'
  AND current_setting('server_version_num')::integer BETWEEN 170000 AND 179999
  AND current_setting('search_path')='pg_catalog'
  AND EXISTS(SELECT FROM pg_catalog.pg_roles WHERE oid=10 AND rolname=current_user AND rolsuper)
  AND EXISTS(SELECT FROM pg_catalog.pg_roles WHERE rolname='postgres' AND NOT rolsuper)
  AND EXISTS(SELECT FROM pg_catalog.pg_extension e WHERE e.extname='dblink' AND e.extowner=10
    AND e.extversion='1.2' AND e.extnamespace='extensions'::regnamespace
    AND (SELECT count(*) FROM pg_catalog.pg_depend d WHERE d.refclassid='pg_catalog.pg_extension'::regclass
      AND d.refobjid=e.oid AND d.classid='pg_catalog.pg_proc'::regclass AND d.deptype='e')=41)`;
const members = `WITH expected(name,args,owner_only) AS (VALUES ${memberInventory.map(
  ([name,args,ownerOnly]) => `('${name}','${args}',${ownerOnly})`).join(',')})
  SELECT p.oid,p.proowner,p.proacl,p.prosecdef,expected.owner_only FROM pg_catalog.pg_extension e
  JOIN pg_catalog.pg_depend d ON d.refclassid='pg_catalog.pg_extension'::regclass AND d.refobjid=e.oid
    AND d.classid='pg_catalog.pg_proc'::regclass AND d.deptype='e'
  JOIN pg_catalog.pg_proc p ON p.oid=d.objid JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  JOIN expected ON expected.name=p.proname AND expected.args=p.proargtypes::text
  WHERE e.extname='dblink' AND n.nspname='extensions'`;
const fresh = '{supabase_admin=X/supabase_admin,postgres=X*/supabase_admin}';
const ownerOnly = '{supabase_admin=X/supabase_admin}';
const captured = '{supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin}';
const ordinaryFresh = '{=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X*/supabase_admin}';
const helperAbsent = `NOT EXISTS(SELECT FROM pg_catalog.pg_extension WHERE extname='fixture_dblink_acl_baseline')`;
const targets = `SELECT * FROM (${members}) m WHERE owner_only`;
const initial = value => `(SELECT count(*)=2 AND bool_and((i.objsubid=0 AND i.privtype='e'
  AND i.initprivs::text='${value}') IS TRUE) FROM (${targets}) m
  JOIN pg_catalog.pg_init_privs i ON i.objoid=m.oid AND i.classoid='pg_catalog.pg_proc'::regclass)`;
const targetCurrent = value => `(SELECT count(*)=2 AND bool_and((proowner=10 AND prosecdef
  AND proacl::text='${value}') IS TRUE) FROM (${targets}) m)`;
const freshAll = `(SELECT count(*)=41 AND bool_and((proowner=10 AND prosecdef=owner_only
  AND proacl::text=CASE WHEN owner_only THEN '${fresh}' ELSE '${ordinaryFresh}' END) IS TRUE)
  FROM (${members}) m)`;
export const dblinkCapturedInitialAclObservationSql = `SELECT (${context}) AND ${helperAbsent}
  AND ${targetCurrent(ownerOnly)} AND ${initial(captured)} AS dblink_captured_initial_acl_exact`;
export const dblinkCapturedInitialAclInstallSql = `DO $dblink_initial_preimage$
BEGIN
  IF (${context}) IS DISTINCT FROM TRUE OR ${freshAll} IS DISTINCT FROM TRUE
    OR (${helperAbsent}) IS DISTINCT FROM TRUE OR ${initial(fresh)} IS DISTINCT FROM TRUE
    OR (SELECT count(*)=1 AND bool_and((version='1.0' AND superuser AND NOT trusted
      AND NOT relocatable AND schema='pg_catalog' AND requires IS NULL) IS TRUE)
      FROM pg_catalog.pg_available_extension_versions WHERE name='fixture_dblink_acl_baseline') IS DISTINCT FROM TRUE
  THEN RAISE EXCEPTION 'FIXTURE_DBLINK_INITIAL_ACL_PREIMAGE_REQUIRED'; END IF;
END $dblink_initial_preimage$;
REVOKE GRANT OPTION FOR EXECUTE ON FUNCTION extensions.dblink_connect_u(text), extensions.dblink_connect_u(text,text) FROM postgres RESTRICT;
CREATE EXTENSION fixture_dblink_acl_baseline WITH SCHEMA pg_catalog VERSION '1.0';
DO $dblink_initial_members$
BEGIN
  IF (SELECT count(*)=1 AND bool_and((e.extowner=10 AND e.extversion='1.0'
    AND e.extnamespace='pg_catalog'::regnamespace AND NOT EXISTS(SELECT FROM pg_catalog.pg_depend d
      WHERE d.refclassid='pg_catalog.pg_extension'::regclass AND d.refobjid=e.oid AND d.deptype='e')) IS TRUE)
    FROM pg_catalog.pg_extension e WHERE e.extname='fixture_dblink_acl_baseline') IS DISTINCT FROM TRUE
    OR ${initial(captured)} IS DISTINCT FROM TRUE
  THEN RAISE EXCEPTION 'FIXTURE_DBLINK_INITIAL_ACL_EMPTY_HELPER_REQUIRED'; END IF;
END $dblink_initial_members$;
DROP EXTENSION fixture_dblink_acl_baseline RESTRICT;
REVOKE EXECUTE ON FUNCTION extensions.dblink_connect_u(text), extensions.dblink_connect_u(text,text) FROM anon, authenticated, service_role RESTRICT;
GRANT EXECUTE ON FUNCTION extensions.dblink_connect_u(text), extensions.dblink_connect_u(text,text) TO postgres WITH GRANT OPTION;
DO $dblink_initial_postimage$
BEGIN
  IF (${context}) IS DISTINCT FROM TRUE OR ${freshAll} IS DISTINCT FROM TRUE
    OR (${helperAbsent}) IS DISTINCT FROM TRUE OR ${initial(captured)} IS DISTINCT FROM TRUE
  THEN RAISE EXCEPTION 'FIXTURE_DBLINK_INITIAL_ACL_POSTIMAGE_REQUIRED'; END IF;
END $dblink_initial_postimage$;`;
