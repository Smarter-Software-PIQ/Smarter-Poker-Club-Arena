import test from 'node:test';
import assert from 'node:assert/strict';
import {qualifySchemaRestoreOwner} from '../schema-restore-owner-proof.mjs';
import {schemaRestoreOwnerBeginSql,schemaRestoreOwnerEndSql,schemaRestoreOwnerEnvironment} from '../schema-restore-owner.mjs';
function harness({invalid=false,drift=false,missing=false,fail=false}={}) {
 const calls=[],queries=[];
 const db={async query(sql){queries.push(sql);return {rows:[{context_exact:!invalid,probes_absent:true,catalogue_sha256:drift&&queries.length===2?'b'.repeat(32):'a'.repeat(32)}]};}};
 const supervisor={async command(...args){calls.push(args);if(fail)throw Object.assign(new Error('PRIVATE SQL'),{stdout:'PRIVATE',stderr:'PRIVATE',code:3});return {stdout:missing?'PRIVATE':' FIXTURE_SCHEMA_RESTORE_OWNER_PROOF_PASSED\n',stderr:''};}};
 return {db,supervisor,calls,queries};
}
test('rollback-only owner qualification invokes fixed genuine psql route and both exact event-owner paths',async()=>{
 const h=harness();const result=await qualifySchemaRestoreOwner(h);
 assert.deepEqual(result,{scope:'native-schema-restore-owner',success:true,temporary_role_absent:true,application_role_unchanged:true,catalogue_unchanged:true,genuine_managed_event_triggers:true});
 assert.ok(Object.isFrozen(result));assert.equal(h.calls.length,1);assert.equal(h.queries.length,2);
 assert.equal(h.queries[0],h.queries[1]);
 const [binary,args,env]=h.calls[0];assert.equal(binary,'/usr/lib/postgresql/17/bin/psql');assert.equal(env,schemaRestoreOwnerEnvironment);
 assert.ok(args.includes('supabase_admin')&&args.includes('/run/postgresql')&&args.includes('club_arena_qualification'));
 assert.ok(!args.includes('--single-transaction')&&!args.includes('-f'));
 assert.equal(args.filter(x=>x==='-c').length,1);
 const sql=args.at(-1);assert.ok(Buffer.byteLength(sql,'utf8')+1<131072,'actual Linux argv includes terminating NUL');assert.ok(sql.startsWith('BEGIN;\n'+schemaRestoreOwnerBeginSql));
 assert.ok(sql.includes(schemaRestoreOwnerEndSql+'\nROLLBACK;'));
 assert.match(sql,/LOAD 'supautils';\nSET LOCAL ROLE postgres;\nCREATE EVENT TRIGGER fixture_restore_pg_event/);
 assert.match(sql,/ALTER EVENT TRIGGER fixture_restore_pg_event OWNER TO postgres;\nSET LOCAL ROLE fixture_schema_restore_owner;\nCREATE EVENT TRIGGER fixture_restore_admin_event/);
 assert.match(sql,/ALTER EVENT TRIGGER fixture_restore_admin_event OWNER TO supabase_admin/);
 assert.doesNotMatch(sql,/ALTER ROLE postgres|ALTER USER postgres|COMMIT;|CASCADE/);
 assert.ok(sql.indexOf('DROP SCHEMA fixture_schema_restore_probe')<sql.indexOf(schemaRestoreOwnerEndSql));
 for(const catalogue of ['pg_roles','pg_auth_members','pg_default_acl','pg_db_role_setting','pg_namespace','pg_class','pg_attribute','pg_proc','pg_event_trigger','pg_extension','pg_init_privs'])assert.ok(h.queries[0].includes(catalogue),catalogue);
});
test('unknown context, changed catalogue, missing proof and native command failures refuse without private errors',async()=>{
 for(const option of [{invalid:true},{drift:true},{missing:true},{fail:true}]){
  const h=harness(option);
  await assert.rejects(qualifySchemaRestoreOwner(h),error=>{
   assert.equal(error.message,'FIXTURE_SCHEMA_RESTORE_OWNER_QUALIFICATION_REQUIRED');
   assert.equal(error.cause,undefined);assert.equal(error.stderr,undefined);assert.equal(error.stdout,undefined);
   assert.ok(!String(error.stack).includes('PRIVATE'));return true;
  });
  assert.equal(h.calls.length,option.invalid?0:1);
  if(option.fail||option.missing)assert.equal(h.queries.length,1);
 }
});
