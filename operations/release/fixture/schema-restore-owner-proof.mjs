import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {extendedRolePreimage} from './current-application-roles.mjs';
import {schemaRestoreOwnerBeginSql,schemaRestoreOwnerEndSql,schemaRestorePsqlArguments,schemaRestoreOwnerEnvironment,renderSequenceDefaultAclOrderSql} from './schema-restore-owner.mjs';

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
// Source-bound captured role template, not the native observed catalogue.
const defaultRoleTemplate=extendedRolePreimage(JSON.parse(readFileSync(new URL('./role-alignment-aligned.json',import.meta.url),'utf8')));
const sourceSequenceRows=defaultRoleTemplate.default_acl.filter(row=>row.type==='S');
const sequenceOrder=renderSequenceDefaultAclOrderSql({scope:'password-free-role-catalogue',
 contains_passwords_or_user_rows:false,default_acl:defaultRoleTemplate.default_acl});
const identifier=value=>'"'+value.replaceAll('"','""')+'"';
const literal=value=>"'"+value.replaceAll("'","''")+"'";
const replaySequenceDefaults=sourceSequenceRows.flatMap(row=>row.acl.map(grant=>
 `ALTER DEFAULT PRIVILEGES FOR ROLE ${identifier(row.creator)}${row.schema==='GLOBAL'?'':` IN SCHEMA ${identifier(row.schema)}`} GRANT ${grant.privilege} ON SEQUENCES TO ${grant.grantee==='PUBLIC'?'PUBLIC':identifier(grant.grantee)}${grant.grantable?' WITH GRANT OPTION':''};`)).join('\n');
const sequenceProbe='fixture_sequence_acl_probe';
const sequenceDdl=`CREATE SCHEMA ${sequenceProbe} AUTHORIZATION postgres;
 CREATE TABLE ${sequenceProbe}.serial_owner(id bigserial);
 ALTER TABLE ${sequenceProbe}.serial_owner OWNER TO postgres;
 CREATE TABLE ${sequenceProbe}.serial_reader(id bigserial);
 ALTER TABLE ${sequenceProbe}.serial_reader OWNER TO postgres;
 CREATE TABLE ${sequenceProbe}.identity_owner(id bigint NOT NULL);
 ALTER TABLE ${sequenceProbe}.identity_owner OWNER TO postgres;
 ALTER TABLE ${sequenceProbe}.identity_owner ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY;
 CREATE TABLE ${sequenceProbe}.identity_reader(id bigint NOT NULL);
 ALTER TABLE ${sequenceProbe}.identity_reader OWNER TO postgres;
 ALTER TABLE ${sequenceProbe}.identity_reader ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY;
 GRANT SELECT ON SEQUENCE ${sequenceProbe}.serial_reader_id_seq,${sequenceProbe}.identity_reader_id_seq TO authenticated;`;
const ownerOnlySequenceAcl=[['postgres','postgres','SELECT',false],['postgres','postgres','UPDATE',false],['postgres','postgres','USAGE',false]];
const readerSequenceAcl=[['postgres','authenticated','SELECT',false],...ownerOnlySequenceAcl];
const fixedSequenceAssert=`DO $sequence_acl_assert$
BEGIN
 IF (SELECT count(*)=4 AND bool_and(c.relowner=(SELECT oid FROM pg_roles WHERE rolname='postgres')
 AND (SELECT jsonb_agg(jsonb_build_array(pg_get_userbyid(a.grantor),pg_get_userbyid(a.grantee),a.privilege_type,a.is_grantable)
 ORDER BY pg_get_userbyid(a.grantee),a.privilege_type) FROM aclexplode(coalesce(c.relacl,acldefault('s',c.relowner))) a)
 = CASE WHEN c.relname IN('serial_reader_id_seq','identity_reader_id_seq')
 THEN ${literal(JSON.stringify(readerSequenceAcl))}::jsonb ELSE ${literal(JSON.stringify(ownerOnlySequenceAcl))}::jsonb END)
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='${sequenceProbe}' AND c.relkind='S') IS DISTINCT FROM TRUE
 THEN RAISE EXCEPTION 'FIXTURE_SEQUENCE_DEFAULT_ROUNDTRIP_REQUIRED'; END IF;
END $sequence_acl_assert$;`;
const sequenceProofSql=`SAVEPOINT fixture_sequence_default_order;
${sequenceOrder.begin}
${sequenceDdl}
${replaySequenceDefaults}
${sequenceOrder.end}
${fixedSequenceAssert}
ROLLBACK TO SAVEPOINT fixture_sequence_default_order;
RELEASE SAVEPOINT fixture_sequence_default_order;
DO $sequence_default_rollback$
BEGIN
 BEGIN
  EXECUTE ${literal(sequenceOrder.begin+'\n'+sequenceDdl+'\n'+replaySequenceDefaults+'\n'+sequenceOrder.end+'\nSELECT 1/0;')};
  RAISE EXCEPTION 'FIXTURE_SEQUENCE_DEFAULT_FAULT_NOT_REACHED';
 EXCEPTION WHEN division_by_zero THEN NULL;
 END;
 IF EXISTS(SELECT FROM pg_namespace WHERE nspname='${sequenceProbe}')
 OR NULLIF(current_setting('fixture.sequence_defaults_active',true),'') IS NOT NULL
 THEN RAISE EXCEPTION 'FIXTURE_SEQUENCE_DEFAULT_ROLLBACK_REQUIRED'; END IF;
END $sequence_default_rollback$;`;
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
${sequenceProofSql}
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
  // Linux amd64 bounds each individual argv string to MAX_ARG_STRLEN,
  // independently of ARG_MAX. Include the terminating NUL and fail before spawn.
  assert.ok(Buffer.byteLength(probeSql,'utf8')+1<131072,'FIXTURE_OWNER_PROBE_ARGV_LIMIT');
  const result=await supervisor.command('/usr/lib/postgresql/17/bin/psql',[...prefix,'-c',probeSql],schemaRestoreOwnerEnvironment);
  assert.equal(typeof result.stdout,'string');
  assert.equal(result.stdout.split('\n').filter(line=>line.trim()==='FIXTURE_SCHEMA_RESTORE_OWNER_PROOF_PASSED').length,1);
  const after=await db.query(snapshotSql); assert.deepEqual(after.rows,before.rows);
  return proof;
 } catch { throw new Error('FIXTURE_SCHEMA_RESTORE_OWNER_QUALIFICATION_REQUIRED'); }
}
