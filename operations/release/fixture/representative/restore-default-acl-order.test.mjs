import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {renderSequenceDefaultAclOrderSql} from '../schema-restore-owner.mjs';
import {renderSchemaRestorePlan} from '../../native/schema-restore-plan.mjs';
import {composeSchema,schemaHash} from '../schema-compose.mjs';
const catalogue={scope:'password-free-role-catalogue',contains_passwords_or_user_rows:false,default_acl:[
 {creator:'postgres',schema:'GLOBAL',type:'S',acl:[{grantor:'postgres',grantee:'postgres',privilege:'USAGE',grantable:false},{grantor:'postgres',grantee:'authenticated',privilege:'SELECT',grantable:false}]},
 {creator:'postgres',schema:'public',type:'r',acl:[{grantor:'postgres',grantee:'anon',privilege:'SELECT',grantable:false}]},
]};
const prefix='-- PostgreSQL database dump\nSET statement_timeout = 0;\n';
const footer='-- PostgreSQL database dump complete\n';
const block=(name,type,schema,owner,sql)=>`-- Name: ${name}; Type: ${type}; Schema: ${schema}; Owner: ${owner}\n--\n\n${sql}\n\n`;
const sequence=block('s','SEQUENCE','public','postgres','CREATE SEQUENCE public.s;\nALTER SEQUENCE public.s OWNER TO postgres;');
const defaults=block('DEFAULT PRIVILEGES FOR SEQUENCES','DEFAULT ACL','-','postgres','ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT SELECT ON SEQUENCES TO authenticated;');
test('source-bound full-plan sequence reset guards surround unchanged original late DEFAULT ACL bytes',()=>{
 const raw=prefix+sequence+defaults+footer;
 const order=renderSequenceDefaultAclOrderSql(catalogue);
 const plan=renderSchemaRestorePlan(raw,{roleCatalogue:catalogue});
 assert.equal(plan.sql,prefix+order.begin+sequence+defaults+order.end+footer);
 assert.equal(plan.receipt.deferred_sequence_default_acl_blocks,1);
 assert.equal(plan.receipt.original_sha256,schemaHash(raw));
 assert.ok(order.begin.includes("WHERE d.defaclobjtype='S'"));
 assert.ok(order.begin.includes('REVOKE ALL ON SEQUENCES'));
 assert.ok(!order.begin.includes('REVOKE ALL ON TABLES'));
 assert.ok(order.begin.includes('FIXTURE_SEQUENCE_DEFAULT_PREIMAGE_REQUIRED'));
 assert.ok(order.begin.includes('source_expected CONSTANT jsonb'));
 assert.equal(order.begin.split(JSON.stringify(catalogue.default_acl)).length-1,1,'independent original default ACL appears exactly once');
 assert.ok(order.begin.includes("set_config('fixture.sequence_default_expected',source_expected::text,true)"));
 assert.ok(order.end.includes('FIXTURE_SEQUENCE_DEFAULT_POSTIMAGE_REQUIRED'));
 assert.ok(order.end.includes('fixture.sequence_default_roles'));
 assert.ok(!order.begin.includes('UPDATE pg_') && !order.begin.includes('CASCADE'));
});
test('missing source, altered identities/order and malformed source refuse without schema details',()=>{
 for(const [sql,roles] of [[prefix+sequence+defaults+footer,undefined],
 [prefix+defaults+sequence+footer,catalogue],
 [prefix+sequence+defaults.replace('Owner: postgres','Owner: foreign')+footer,catalogue]])
 assert.throws(()=>renderSchemaRestorePlan(sql,{roleCatalogue:roles}),/SCHEMA_RESTORE_PLAN_REFUSED/);
 for(const mutate of [x=>x.scope='private-canary',x=>x.default_acl[0].acl[0].grantor='other',
 x=>x.default_acl[0].type='private-canary',x=>x.default_acl.push(x.default_acl[0]),x=>x.default_acl[0].extra='private-canary']) {
 const value=structuredClone(catalogue);mutate(value);
 assert.throws(()=>renderSequenceDefaultAclOrderSql(value),error=>error.message==='FIXTURE_SEQUENCE_DEFAULT_SOURCE_REQUIRED');
 }
});
test('composer retains only byte-exact source/native matching sequence defaults and classifies original binding',()=>{
 const managed=[block('auth','SCHEMA','-','supabase_admin','CREATE SCHEMA auth;'),
 ...['email()','jwt()','role()','uid()'].map(name=>block(name,'FUNCTION','auth','supabase_auth_admin','SELECT 1;')),
 block('pg_cron','EXTENSION','-','-','CREATE EXTENSION pg_cron;'),
 block('SCHEMA "cron"','ACL','-','supabase_admin','GRANT USAGE ON SCHEMA cron TO postgres;'),
 ...['alter_job','job_cache_invalidate','schedule','schedule_in_database','unschedule'].map((name,i)=>i===2||i===4?[
 block(`FUNCTION "${name}"(${name==='schedule'?'"schedule" "text", "command" "text"':'"job_id" bigint'})`,'ACL','cron','supabase_admin','SELECT 1;'),
 block(`FUNCTION "${name}"(${name==='schedule'?'"job_name" "text", "schedule" "text", "command" "text"':'"job_name" "text"'})`,'ACL','cron','supabase_admin','SELECT 1;')]:
 block(`FUNCTION "${name}"(${name==='alter_job'?'"job_id" bigint, "schedule" "text", "command" "text", "database" "text", "username" "text", "active" boolean':name==='job_cache_invalidate'?'':'"job_name" "text", "schedule" "text", "command" "text", "database" "text", "username" "text", "active" boolean'})`,'ACL','cron','supabase_admin','SELECT 1;'))].flat().join('');
 const result=composeSchema(prefix+managed+sequence+defaults+footer,prefix+managed+defaults+footer);
 assert.equal(result.sql,prefix+sequence+defaults+footer);
 assert.equal(result.manifest.deferred_sequence_default_acls.length,1);
 assert.deepEqual(result.manifest.deferred_sequence_default_acls[0],result.manifest.retained.at(-1));
 assert.equal(result.manifest.deferred_sequence_default_acls[0].sha256,schemaHash(defaults));
 assert.throws(()=>composeSchema(prefix+managed+sequence+defaults+footer,prefix+managed+defaults.replace('SELECT ON SEQUENCES','USAGE ON SEQUENCES')+footer));
});
test('actual full restore validates original role catalogue before clearing and mandatory native proof retains roundtrip/fault rollback',async()=>{
 const server=await readFile(new URL('../fixture-server.mjs',import.meta.url),'utf8');
 assert.ok(server.indexOf('captureRoleCatalogue(db)')<server.indexOf('renderSchemaRestorePlan(originalSchema,{roleCatalogue:originalRoles})'));
 assert.ok(server.includes("'/inputs/role-catalogue.json'"));
 const proof=await readFile(new URL('../schema-restore-owner-proof.mjs',import.meta.url),'utf8');
 assert.ok(proof.includes('extendedRolePreimage'));
 assert.ok(proof.includes('ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY'));
 assert.ok(proof.includes('FIXTURE_SEQUENCE_DEFAULT_ROUNDTRIP_REQUIRED'));
 assert.ok(proof.includes('EXCEPTION WHEN division_by_zero'));
 assert.ok(proof.includes('${sequenceProofSql}\n${schemaRestoreOwnerEndSql}'));
});
