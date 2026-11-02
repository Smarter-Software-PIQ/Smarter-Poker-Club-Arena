import assert from 'node:assert/strict';
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
    OR current_setting('fixture.sequence_defaults_active',true) IS NOT DISTINCT FROM 'on'
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

// Only full-source restoration uses this guard. Generic owner qualification
// and ordinary archives without sequence DEFAULT ACL blocks remain unchanged.
const semanticDefaultsSql = `(SELECT jsonb_agg(jsonb_build_object(
 'creator',pg_get_userbyid(d.defaclrole),'schema',CASE WHEN d.defaclnamespace=0 THEN 'GLOBAL' ELSE n.nspname END,
 'type',d.defaclobjtype,'acl',(SELECT jsonb_agg(jsonb_build_object(
 'grantor',pg_get_userbyid(a.grantor),'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
 'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY pg_get_userbyid(a.grantor),
 CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,a.privilege_type,a.is_grantable)
 FROM pg_catalog.aclexplode(d.defaclacl) a)) ORDER BY pg_get_userbyid(d.defaclrole),
 CASE WHEN d.defaclnamespace=0 THEN 'GLOBAL' ELSE n.nspname END,d.defaclobjtype)
 FROM pg_catalog.pg_default_acl d LEFT JOIN pg_catalog.pg_namespace n ON n.oid=d.defaclnamespace)`;
const semanticRoleGraphSql = `(SELECT jsonb_build_object(
 'roles',(SELECT jsonb_agg(jsonb_build_array(rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,
 rolcanlogin,rolreplication,rolbypassrls,rolconnlimit,extract(epoch FROM rolvaliduntil),rolconfig) ORDER BY rolname)
 FROM pg_catalog.pg_roles WHERE rolname<>'fixture_schema_restore_owner'),
 'memberships',(SELECT jsonb_agg(jsonb_build_array(pg_get_userbyid(roleid),pg_get_userbyid(member),
 pg_get_userbyid(grantor),admin_option,inherit_option,set_option) ORDER BY pg_get_userbyid(roleid),
 pg_get_userbyid(member),pg_get_userbyid(grantor)) FROM pg_catalog.pg_auth_members),
 'settings',(SELECT jsonb_agg(jsonb_build_array(CASE WHEN setrole=0 THEN 'ALL' ELSE pg_get_userbyid(setrole) END,
 CASE WHEN setdatabase=0 THEN 'ALL' WHEN setdatabase=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database())
 THEN 'OWNED_DATABASE' ELSE 'OTHER_DATABASE' END,setconfig) ORDER BY setrole,setdatabase)
 FROM pg_catalog.pg_db_role_setting)))`;
export function renderSequenceDefaultAclOrderSql(roleCatalogue) {
  try {
    assert.equal(roleCatalogue?.scope,'password-free-role-catalogue');
    assert.equal(roleCatalogue.contains_passwords_or_user_rows,false);
    const rows=roleCatalogue.default_acl;
    assert.ok(Array.isArray(rows) && rows.length<=1024);
    assert.ok(Buffer.byteLength(JSON.stringify(rows))<=1024*1024);
    const seen=new Set();
    for (const row of rows) {
      assert.deepEqual(Object.keys(row).sort(),['acl','creator','schema','type']);
      assert.ok(typeof row.creator==='string' && row.creator.length>0 && row.creator.length<=63);
      assert.ok(typeof row.schema==='string' && row.schema.length>0 && row.schema.length<=63);
      assert.ok(['r','S','f','T','n'].includes(row.type));
      const key=JSON.stringify([row.creator,row.schema,row.type]);assert.ok(!seen.has(key));seen.add(key);
      assert.ok(Array.isArray(row.acl) && row.acl.length<=1024);
      for (const grant of row.acl) {
        assert.deepEqual(Object.keys(grant).sort(),['grantable','grantee','grantor','privilege']);
        assert.equal(grant.grantor,row.creator);
        assert.ok(typeof grant.grantee==='string' && grant.grantee.length>0 && grant.grantee.length<=63);
        assert.equal(typeof grant.grantable,'boolean');
        assert.ok(typeof grant.privilege==='string' && /^[A-Z ]{1,32}$/.test(grant.privilege));
        if (row.type==='S') assert.ok(['SELECT','UPDATE','USAGE'].includes(grant.privilege));
      }
    }
    const sequences=rows.filter(row=>row.type==='S');assert.ok(sequences.length>0);
    const expected="'"+JSON.stringify(rows).replaceAll("'","''")+"'::jsonb";
    const context=`current_database()='club_arena_qualification' AND inet_server_addr() IS NULL
 AND session_user='supabase_admin' AND current_user='fixture_schema_restore_owner'
 AND current_setting('fixture.schema_restore_active',true)='on'
 AND EXISTS(SELECT FROM pg_roles WHERE oid=10 AND rolname=session_user AND rolsuper)
 AND EXISTS(SELECT FROM pg_roles WHERE rolname='postgres' AND NOT rolsuper)`;
    const begin=`DO $fixture_sequence_defaults_begin$
DECLARE source_expected CONSTANT jsonb := ${expected};
 item record; grantee_name text; namespace_clause text; target text;
BEGIN
 IF (${context}) IS DISTINCT FROM TRUE OR (${semanticDefaultsSql}) IS DISTINCT FROM source_expected
 OR NULLIF(current_setting('fixture.sequence_defaults_active',true),'') IS NOT NULL
 THEN RAISE EXCEPTION 'FIXTURE_SEQUENCE_DEFAULT_PREIMAGE_REQUIRED'; END IF;
 PERFORM set_config('fixture.sequence_default_expected',source_expected::text,true);
 PERFORM set_config('fixture.sequence_default_roles',(${semanticRoleGraphSql})::text,true);
 FOR item IN SELECT d.defaclrole,d.defaclnamespace,d.defaclacl,pg_get_userbyid(d.defaclrole)::text AS creator,n.nspname
 FROM pg_catalog.pg_default_acl d LEFT JOIN pg_catalog.pg_namespace n ON n.oid=d.defaclnamespace
 WHERE d.defaclobjtype='S' ORDER BY d.defaclrole,d.defaclnamespace LOOP
  namespace_clause:=CASE WHEN item.defaclnamespace=0 THEN '' ELSE format(' IN SCHEMA %I',item.nspname) END;
  FOR grantee_name IN SELECT DISTINCT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END
  FROM pg_catalog.aclexplode(item.defaclacl) a LOOP
   target:=CASE WHEN grantee_name='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(grantee_name) END;
   EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I%s REVOKE ALL ON SEQUENCES FROM %s RESTRICT',item.creator,namespace_clause,target);
  END LOOP;
  IF item.defaclnamespace=0 THEN
   EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I GRANT SELECT, UPDATE, USAGE ON SEQUENCES TO %I',item.creator,item.creator);
  END IF;
 END LOOP;
 IF EXISTS(SELECT FROM pg_catalog.pg_default_acl WHERE defaclobjtype='S')
 THEN RAISE EXCEPTION 'FIXTURE_SEQUENCE_DEFAULT_BASELINE_REQUIRED'; END IF;
 PERFORM set_config('fixture.sequence_defaults_active','on',true);
END $fixture_sequence_defaults_begin$;
`;
    const end=`DO $fixture_sequence_defaults_end$
BEGIN
 IF (${context}) IS DISTINCT FROM TRUE OR current_setting('fixture.sequence_defaults_active',true) IS DISTINCT FROM 'on'
 OR NULLIF(current_setting('fixture.sequence_default_expected',true),'') IS NULL
 OR (${semanticDefaultsSql}) IS DISTINCT FROM current_setting('fixture.sequence_default_expected',true)::jsonb
 OR (${semanticRoleGraphSql}) IS DISTINCT FROM current_setting('fixture.sequence_default_roles',true)::jsonb
 THEN RAISE EXCEPTION 'FIXTURE_SEQUENCE_DEFAULT_POSTIMAGE_REQUIRED'; END IF;
 PERFORM set_config('fixture.sequence_defaults_active','finished',true);
END $fixture_sequence_defaults_end$;
`;
    return {begin,end,sequenceRows:sequences.map(row=>({creator:row.creator,schema:row.schema}))};
  } catch { throw new Error('FIXTURE_SEQUENCE_DEFAULT_SOURCE_REQUIRED'); }
}
