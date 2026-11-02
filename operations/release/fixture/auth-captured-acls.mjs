// Captured Auth ACL ordering only. Effective privileges remain identical.
export const authCapturedAclInventory = Object.freeze([
  Object.freeze(['audit_log_entries', 'r']), Object.freeze(['instances', 'r']),
  Object.freeze(['refresh_tokens', 'r']), Object.freeze(['refresh_tokens_id_seq', 'S']),
  Object.freeze(['users', 'r']),
]);
const tableBefore = '{postgres=ar*wdDxtm/supabase_auth_admin,supabase_auth_admin=arwdDxtm/supabase_auth_admin,dashboard_user=arwdDxtm/supabase_auth_admin}';
const tableAfter = '{supabase_auth_admin=arwdDxtm/supabase_auth_admin,dashboard_user=arwdDxtm/supabase_auth_admin,postgres=ar*wdDxtm/supabase_auth_admin}';
const sequenceBefore = '{postgres=rwU/supabase_auth_admin,supabase_auth_admin=rwU/supabase_auth_admin,dashboard_user=rwU/supabase_auth_admin}';
const sequenceAfter = '{supabase_auth_admin=rwU/supabase_auth_admin,dashboard_user=rwU/supabase_auth_admin,postgres=rwU/supabase_auth_admin}';
const context = `current_database()='club_arena_qualification'
  AND inet_server_addr() IS NULL AND current_user='supabase_admin' AND session_user='supabase_admin'
  AND current_setting('server_version_num')::integer BETWEEN 170000 AND 179999
  AND current_setting('search_path')='pg_catalog'
  AND EXISTS(SELECT FROM pg_catalog.pg_roles WHERE oid=10 AND rolname=current_user AND rolsuper)
  AND (SELECT count(*)=3 AND bool_and(NOT rolsuper) FROM pg_catalog.pg_roles
    WHERE rolname IN ('supabase_auth_admin','postgres','dashboard_user'))`;
const inventory = `WITH expected(name,kind) AS (VALUES ${authCapturedAclInventory.map(([name, kind]) => `('${name}','${kind}')`).join(',')})
  SELECT c.oid,c.relname,c.relkind,c.relowner,c.relacl,expected.kind
  FROM expected JOIN pg_catalog.pg_namespace n ON n.nspname='auth'
  JOIN pg_catalog.pg_class c ON c.relnamespace=n.oid AND c.relname=expected.name`;
const exact = (table, sequence) => `(SELECT count(*)=5 AND bool_and((c.relkind::text=c.kind
  AND c.relowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='supabase_auth_admin')
  AND c.relacl::text=CASE WHEN c.kind='S' THEN '${sequence}' ELSE '${table}' END
  AND NOT EXISTS(SELECT FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attacl IS NOT NULL)
  AND NOT EXISTS(SELECT FROM pg_catalog.pg_init_privs p
    WHERE p.classoid='pg_catalog.pg_class'::regclass AND p.objoid=c.oid)
  AND NOT EXISTS(SELECT FROM pg_catalog.pg_depend d WHERE d.classid='pg_catalog.pg_class'::regclass
    AND d.objid=c.oid AND d.deptype='e')) IS TRUE) FROM (${inventory}) c)`;
export const authCapturedAclObservationSql = `SELECT (${context})
  AND ${exact(tableAfter, sequenceAfter)} AS auth_captured_acl_exact`;
export const authCapturedAclInstallSql = `DO $auth_acl_preimage$
BEGIN
  IF (${context}) IS DISTINCT FROM TRUE OR ${exact(tableBefore, sequenceBefore)} IS DISTINCT FROM TRUE
  THEN RAISE EXCEPTION 'FIXTURE_AUTH_CAPTURED_ACL_PREIMAGE_REQUIRED'; END IF;
END $auth_acl_preimage$;
SET LOCAL ROLE supabase_auth_admin;
${authCapturedAclInventory.map(([name,kind]) => kind === 'S'
  ? `REVOKE ALL ON SEQUENCE auth.${name} FROM postgres, dashboard_user RESTRICT;
GRANT ALL ON SEQUENCE auth.${name} TO dashboard_user;
GRANT ALL ON SEQUENCE auth.${name} TO postgres;`
  : `REVOKE ALL ON TABLE auth.${name} FROM postgres, dashboard_user RESTRICT;
GRANT ALL ON TABLE auth.${name} TO dashboard_user;
GRANT ALL ON TABLE auth.${name} TO postgres;
GRANT SELECT ON TABLE auth.${name} TO postgres WITH GRANT OPTION;`).join('\n')}
RESET ROLE;
DO $auth_acl_postimage$
BEGIN
  IF (${context}) IS DISTINCT FROM TRUE OR ${exact(tableAfter, sequenceAfter)} IS DISTINCT FROM TRUE
  THEN RAISE EXCEPTION 'FIXTURE_AUTH_CAPTURED_ACL_POSTIMAGE_REQUIRED'; END IF;
END $auth_acl_postimage$;`;
