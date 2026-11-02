// Only the fresh private initdb administrator child uses this ordinary PG route.
// Application/service connections keep their managed non-superuser identity.
export const schemaRestoreOwnerEnvironment = Object.freeze({
  PGOPTIONS: '-c search_path=pg_catalog -c session_preload_libraries=',
});
const privateAdmin = `current_database()='club_arena_qualification'
  AND inet_server_addr() IS NULL AND current_user='supabase_admin' AND session_user='supabase_admin'
  AND current_setting('server_version_num')::integer BETWEEN 170000 AND 179999
  AND current_setting('session_preload_libraries')=''
  AND current_setting('search_path')='pg_catalog'
  AND EXISTS(SELECT FROM pg_catalog.pg_roles WHERE oid=10 AND rolname=current_user AND rolsuper)
  AND EXISTS(SELECT FROM pg_catalog.pg_roles WHERE rolname='postgres' AND NOT rolsuper)`;
const applicationRole = `(SELECT jsonb_build_object(
  'role',(SELECT to_jsonb(r)-'rolpassword' FROM pg_catalog.pg_roles r WHERE r.rolname='postgres'),
  'settings',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.setdatabase,s.setrole) FROM pg_catalog.pg_db_role_setting s
    WHERE s.setrole=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='postgres')),
  'memberships',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.roleid,m.member,m.grantor) FROM pg_catalog.pg_auth_members m
    WHERE (SELECT oid FROM pg_catalog.pg_roles WHERE rolname='postgres') IN(m.roleid,m.member,m.grantor))))`;
const roleName = 'fixture_schema_restore_owner';
const roleAbsent = `NOT EXISTS(SELECT FROM pg_catalog.pg_roles WHERE rolname='${roleName}')`;
const roleExact = `EXISTS(SELECT FROM pg_catalog.pg_roles WHERE rolname='${roleName}'
  AND rolsuper AND NOT rolcanlogin AND NOT rolinherit AND NOT rolcreatedb AND NOT rolcreaterole
  AND NOT rolreplication AND NOT rolbypassrls AND rolconfig IS NULL AND rolvaliduntil IS NULL AND rolconnlimit=-1)`;
const noDependencies = `NOT EXISTS(SELECT FROM pg_catalog.pg_shdepend d
  WHERE d.refclassid='pg_catalog.pg_authid'::regclass
    AND d.refobjid=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='${roleName}'))
  AND NOT EXISTS(SELECT FROM pg_catalog.pg_auth_members m
    WHERE (SELECT oid FROM pg_catalog.pg_roles WHERE rolname='${roleName}') IN(m.roleid,m.member,m.grantor))
  AND NOT EXISTS(SELECT FROM pg_catalog.pg_default_acl d
    WHERE d.defaclrole=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='${roleName}')
    OR EXISTS(SELECT FROM pg_catalog.aclexplode(d.defaclacl) a
      WHERE (SELECT oid FROM pg_catalog.pg_roles WHERE rolname='${roleName}') IN(a.grantor,a.grantee)))`;
export const schemaRestoreOwnerBeginSql = `SAVEPOINT fixture_schema_restore_owner_guard;
DO $fixture_restore_owner_begin$
BEGIN
  IF (${privateAdmin}) IS DISTINCT FROM TRUE OR (${roleAbsent}) IS DISTINCT FROM TRUE
    OR NULLIF(current_setting('fixture.schema_restore_active',true),'') IS NOT NULL
  THEN RAISE EXCEPTION 'FIXTURE_SCHEMA_RESTORE_OWNER_PREIMAGE_REQUIRED'; END IF;
  PERFORM set_config('fixture.schema_restore_pg',(${applicationRole})::text,true);
  CREATE ROLE fixture_schema_restore_owner NOLOGIN SUPERUSER NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  IF (${roleExact}) IS DISTINCT FROM TRUE OR (${noDependencies}) IS DISTINCT FROM TRUE
  THEN RAISE EXCEPTION 'FIXTURE_SCHEMA_RESTORE_OWNER_EMPTY_ROLE_REQUIRED'; END IF;
  PERFORM set_config('fixture.schema_restore_active','on',true);
END $fixture_restore_owner_begin$;
SET LOCAL ROLE fixture_schema_restore_owner;`;
export const schemaRestoreOwnerEndSql = `RESET ROLE;
SET LOCAL search_path=pg_catalog;
DO $fixture_restore_owner_end$
BEGIN
  IF (${privateAdmin}) IS DISTINCT FROM TRUE OR (${roleExact}) IS DISTINCT FROM TRUE
    OR current_setting('fixture.schema_restore_active',true) IS DISTINCT FROM 'on'
    OR NULLIF(current_setting('fixture.schema_restore_pg',true),'') IS NULL
    OR ${applicationRole} IS DISTINCT FROM current_setting('fixture.schema_restore_pg',true)::jsonb
  THEN RAISE EXCEPTION 'FIXTURE_SCHEMA_RESTORE_OWNER_CONTEXT_CHANGED'; END IF;
  IF (${noDependencies}) IS DISTINCT FROM TRUE
  THEN RAISE EXCEPTION 'FIXTURE_SCHEMA_RESTORE_OWNER_RESIDUE_REQUIRED'; END IF;
  -- DROP ROLE is inherently restrictive; PostgreSQL has no RESTRICT clause here.
  DROP ROLE fixture_schema_restore_owner;
  IF (${roleAbsent}) IS DISTINCT FROM TRUE
    OR ${applicationRole} IS DISTINCT FROM current_setting('fixture.schema_restore_pg',true)::jsonb
  THEN RAISE EXCEPTION 'FIXTURE_SCHEMA_RESTORE_OWNER_POSTIMAGE_REQUIRED'; END IF;
  PERFORM set_config('fixture.schema_restore_active','finished',true);
  PERFORM set_config('fixture.schema_restore_pg','',true);
END $fixture_restore_owner_end$;
RELEASE SAVEPOINT fixture_schema_restore_owner_guard;`;
export const schemaRestorePsqlArguments = Object.freeze([
  '-X',
  '--single-transaction',
  '-v',
  'ON_ERROR_STOP=1',
  '-v',
  'VERBOSITY=sqlstate',
  '-h',
  '/run/postgresql',
  '-U',
  'supabase_admin',
  '-d',
  'club_arena_qualification',
  '-c',
  schemaRestoreOwnerBeginSql,
  '-f',
  '/run/club-arena-qualification/private/schema/schema.sql',
  '-c',
  schemaRestoreOwnerEndSql,
]);
