import assert from 'node:assert/strict';
import {schemaRestoreOwnerBeginSql,schemaRestoreOwnerEndSql,schemaRestorePsqlArguments,schemaRestoreOwnerEnvironment} from './schema-restore-owner.mjs';

// An isolated rollback-only qualification of the actual managed library route.
// Real restoration retains the owner's full single-transaction file arguments.
const probeSchema='fixture_schema_restore_probe';
const snapshotSql=`SELECT current_database()='club_arena_qualification' AND inet_server_addr() IS NULL
 AND current_user='postgres' AND session_user='postgres'
 AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname=current_user)
 AND current_setting('server_version_num')::integer BETWEEN 170000 AND 179999
 AND current_setting('session_preload_libraries')='supautils'
 AND current_setting('supautils.superuser')='supabase_admin' AS context_exact,
 NOT EXISTS(SELECT FROM pg_namespace WHERE nspname='${probeSchema}')
 AND NOT EXISTS(SELECT FROM pg_roles WHERE rolname='fixture_schema_restore_owner')
 AND NOT EXISTS(SELECT FROM pg_event_trigger WHERE evtname IN('fixture_restore_pg_event','fixture_restore_admin_event')) AS probes_absent,
 md5(jsonb_build_object(
 'roles',(SELECT jsonb_agg(to_jsonb(r)-'rolpassword' ORDER BY oid) FROM pg_roles r),
 'memberships',(SELECT jsonb_agg(to_jsonb(r) ORDER BY oid) FROM pg_auth_members r),
 'defaults',(SELECT jsonb_agg(to_jsonb(r) ORDER BY oid) FROM pg_default_acl r),
 'settings',(SELECT jsonb_agg(to_jsonb(r) ORDER BY setdatabase,setrole) FROM pg_db_role_setting r),
 'namespaces',(SELECT jsonb_agg(to_jsonb(r) ORDER BY oid) FROM pg_namespace r),
 -- Storage estimates and freeze horizons are background-maintained, not DDL identities.
 'relations',(SELECT jsonb_agg(to_jsonb(r)-ARRAY['relpages','reltuples','relallvisible','relallfrozen','relfrozenxid','relminmxid'] ORDER BY oid) FROM pg_class r),
 'attributes',(SELECT jsonb_agg(to_jsonb(r) ORDER BY attrelid,attnum) FROM pg_attribute r),
 'functions',(SELECT jsonb_agg(to_jsonb(r) ORDER BY oid) FROM pg_proc r),
 'events',(SELECT jsonb_agg(to_jsonb(r) ORDER BY oid) FROM pg_event_trigger r),
 'extensions',(SELECT jsonb_agg(to_jsonb(r) ORDER BY oid) FROM pg_extension r),
 'initial_acl',(SELECT jsonb_agg(to_jsonb(r) ORDER BY objoid,classoid,objsubid) FROM pg_init_privs r),
 'global_preload',current_setting('session_preload_libraries'),
 'shared_preload',current_setting('shared_preload_libraries'),
 'library_superuser',current_setting('supautils.superuser'),
 'library_extension_owner',current_setting('supautils.privileged_extensions_superuser'),
 'library_privileged_role',current_setting('supautils.privileged_role'),
 'library_extensions',current_setting('supautils.privileged_extensions'),
 'library_reserved_roles',current_setting('supautils.reserved_roles'),
 'library_reserved_memberships',current_setting('supautils.reserved_memberships'))::text) AS catalogue_sha256`;
const probeSql=`BEGIN;
${schemaRestoreOwnerBeginSql}
CREATE SCHEMA ${probeSchema} AUTHORIZATION postgres;
CREATE FUNCTION ${probeSchema}.plain() RETURNS integer LANGUAGE sql AS 'SELECT 1';
ALTER FUNCTION ${probeSchema}.plain() OWNER TO supabase_admin;
CREATE TABLE ${probeSchema}.storage_probe(id integer);
ALTER TABLE ${probeSchema}.storage_probe OWNER TO supabase_storage_admin;
CREATE FUNCTION ${probeSchema}.pg_event() RETURNS event_trigger LANGUAGE plpgsql AS 'BEGIN RETURN; END';
ALTER FUNCTION ${probeSchema}.pg_event() OWNER TO postgres;
CREATE FUNCTION ${probeSchema}.admin_event() RETURNS event_trigger LANGUAGE plpgsql AS 'BEGIN RETURN; END';
ALTER FUNCTION ${probeSchema}.admin_event() OWNER TO supabase_admin;
LOAD 'supautils';
SET LOCAL ROLE postgres;
CREATE EVENT TRIGGER fixture_restore_pg_event ON ddl_command_end EXECUTE FUNCTION ${probeSchema}.pg_event();
ALTER EVENT TRIGGER fixture_restore_pg_event OWNER TO postgres;
SET LOCAL ROLE fixture_schema_restore_owner;
CREATE EVENT TRIGGER fixture_restore_admin_event ON ddl_command_end EXECUTE FUNCTION ${probeSchema}.admin_event();
ALTER EVENT TRIGGER fixture_restore_admin_event OWNER TO supabase_admin;
DO $proof$
BEGIN
 IF (SELECT nspowner=(SELECT oid FROM pg_roles WHERE rolname='postgres') FROM pg_namespace WHERE nspname='${probeSchema}') IS DISTINCT FROM TRUE
 OR (SELECT proowner=10 FROM pg_proc WHERE oid='${probeSchema}.plain()'::regprocedure) IS DISTINCT FROM TRUE
 OR (SELECT relowner=(SELECT oid FROM pg_roles WHERE rolname='supabase_storage_admin') FROM pg_class WHERE oid='${probeSchema}.storage_probe'::regclass) IS DISTINCT FROM TRUE
 OR (SELECT count(*)=2 AND bool_and((evtowner=CASE evtname WHEN 'fixture_restore_pg_event' THEN (SELECT oid FROM pg_roles WHERE rolname='postgres') ELSE 10 END
 AND evtfoid=CASE evtname WHEN 'fixture_restore_pg_event' THEN '${probeSchema}.pg_event()'::regprocedure ELSE '${probeSchema}.admin_event()'::regprocedure END
 AND evtevent='ddl_command_end' AND evtenabled='O' AND evttags IS NULL) IS TRUE)
 FROM pg_event_trigger WHERE evtname IN('fixture_restore_pg_event','fixture_restore_admin_event')) IS DISTINCT FROM TRUE
 THEN RAISE EXCEPTION 'FIXTURE_SCHEMA_RESTORE_OWNER_PROBE_REQUIRED'; END IF;
END $proof$;
RESET ROLE;
DROP EVENT TRIGGER fixture_restore_pg_event;
DROP EVENT TRIGGER fixture_restore_admin_event;
DROP TABLE ${probeSchema}.storage_probe;
DROP FUNCTION ${probeSchema}.plain(),${probeSchema}.pg_event(),${probeSchema}.admin_event();
DROP SCHEMA ${probeSchema};
SET LOCAL ROLE fixture_schema_restore_owner;
${schemaRestoreOwnerEndSql}
ROLLBACK;
SELECT 'FIXTURE_SCHEMA_RESTORE_OWNER_PROOF_PASSED';`;
const proof=Object.freeze({scope:'native-schema-restore-owner',success:true,temporary_role_absent:true,application_role_unchanged:true,catalogue_unchanged:true,genuine_managed_event_triggers:true});
export async function qualifySchemaRestoreOwner({supervisor,db}) {
 try {
  const before=await db.query(snapshotSql);
  assert.equal(before.rows.length,1); assert.equal(before.rows[0].context_exact,true);
  assert.equal(before.rows[0].probes_absent,true); assert.match(before.rows[0].catalogue_sha256,/^[0-9a-f]{32}$/);
  const prefix=schemaRestorePsqlArguments.slice(0,schemaRestorePsqlArguments.indexOf('-c')).filter(value=>value!=='--single-transaction');
  const result=await supervisor.command('/usr/lib/postgresql/17/bin/psql',[...prefix,'-c',probeSql],schemaRestoreOwnerEnvironment);
  assert.equal(typeof result.stdout,'string');
  assert.equal(result.stdout.split('\n').filter(line=>line.trim()==='FIXTURE_SCHEMA_RESTORE_OWNER_PROOF_PASSED').length,1);
  const after=await db.query(snapshotSql); assert.deepEqual(after.rows,before.rows);
  return proof;
 } catch { throw new Error('FIXTURE_SCHEMA_RESTORE_OWNER_QUALIFICATION_REQUIRED'); }
}
