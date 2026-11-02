import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as module from '../managed-bootstrap-functions.mjs';
const { installSql: install, observationSql: observe } = module;
const sql = readFileSync(new URL('../managed-bootstrap-functions.sql', import.meta.url),'utf8');
const expected = {
  grant_pg_cron_access:'3a3917aad6ddd66182bf45b7490c3029',
  grant_pg_graphql_access:'dd3f3e2bb94cff45ef24b9cecb6af1c8',
  grant_pg_net_access:'2ee4e6920eeba3068bcfa838105352e2',
  pgrst_ddl_watch:'7f27b8118fea5c88b0164331292859e3',
  pgrst_drop_watch:'bc09cc3003d66f91844af4cb05e203b7',
  set_graphql_placeholder:'a2bc2d00b2cc2f5e8d2d6b8d73e2c360',
};
test('fixed public bootstrap exposes only install and strict read-only observer',()=>{
  assert.deepEqual(Object.keys(module).sort(),['installSql','observationSql']);
  assert.ok(observe.endsWith('IS TRUE AS managed_bootstrap_functions_exact'));
  assert.doesNotMatch(observe,/\bCREATE\b|\bALTER\b|\bGRANT\b|\bREVOKE\b|\bDROP\b/);
  assert.doesNotMatch(install.replace(sql,''),/\bCOMMIT\b|\bROLLBACK\b|CREATE EXTENSION|CREATE EVENT TRIGGER|\bCASCADE\b|OR REPLACE FUNCTION|IF NOT EXISTS/);
  assert.doesNotMatch(sql,/^CREATE (?:EXTENSION|EVENT TRIGGER)/m);
});
test('six independently captured body hashes remain byte-exact',()=>{
  assert.equal((sql.match(/CREATE FUNCTION extensions\./g)||[]).length,6);
  for(const [name,md5] of Object.entries(expected)){
    const start = sql.indexOf(`CREATE FUNCTION extensions.${name}()`);
    assert.ok(start>=0);
    const declaration = sql.slice(start).match(/AS (\$[^$]*\$)/);
    assert.ok(declaration);
    const from=start+declaration.index+declaration[0].length;
    const body=sql.slice(from,sql.indexOf(declaration[1],from));
    assert.equal(createHash('md5').update(body).digest('hex'),md5,name);
    assert.ok(sql.includes(`ALTER FUNCTION extensions.${name}() SET search_path='';`));
    assert.ok(observe.includes(md5));
  }
});
test('placeholder has exactly the independently identified inner configuration insertion',()=>{
  const section=sql.slice(sql.indexOf('CREATE FUNCTION extensions.set_graphql_placeholder()'));
  const declaration=section.match(/AS (\$[^$]*\$)/);
  const from=declaration.index+declaration[0].length;
  const body=section.slice(from,section.indexOf(declaration[1],from));
  const insertion="    set search_path to ''\n        ";
  assert.equal(body.length,1573); assert.equal(body.split('\n').length-1,49);
  assert.equal(body.slice(573,607),insertion);
  const publicBody=body.slice(0,573)+body.slice(607);
  assert.equal(createHash('md5').update(publicBody).digest('hex'),'768624f64266daa3567685cbfea9b3b6');
});
test('private PG17/Admin identity, exact creator defaults and all overload absence precede CREATE',()=>{
  for(const guard of ["current_database()='club_arena_qualification'",'inet_server_addr() IS NULL',
    "session_user='supabase_admin'",'oid=10',"current_setting('search_path')='pg_catalog'",
    "current_setting('quote_all_identifiers')='off'",'BETWEEN 170000 AND 179999',
    "defaclacl::text='{postgres=X*/supabase_admin}'",'defaclnamespace IN (0,',
    'FIXTURE_MANAGED_BOOTSTRAP_ABSENCE_REQUIRED']) assert.ok(install.includes(guard),guard);
  const guard=install.slice(0,install.indexOf('original_metadata :='));
  assert.doesNotMatch(guard,/pronargs=0/);
  assert.ok(install.indexOf('ABSENCE_REQUIRED')<install.indexOf('CREATE FUNCTION'));
});
test('postimage checks complete definitions, exact ACLs, initial privilege absence and nonmembership',()=>{
  for(const guard of ['md5(pg_get_functiondef(p.oid))','p.proowner=10','p.proconfig=',
    'p.proacl::text=CASE','pg_catalog.pg_init_privs',"d.deptype='e'",'count(*)=6',
    'pg_catalog.pg_extension','pg_catalog.pg_default_acl','pg_catalog.pg_namespace',
    'pg_catalog.pg_event_trigger','IS DISTINCT FROM original_metadata']) assert.ok(install.includes(guard),guard);
  assert.doesNotMatch(sql,/\b(?:UPDATE|INSERT INTO|DELETE FROM)\s+pg_(?:catalog\.)?(?:proc|depend|init_privs)/i);
});


test('managed bootstrap module and reviewed SQL are bound to build and receipt inputs', () => {
  const docker=readFileSync(new URL('../Dockerfile',import.meta.url),'utf8');
  const builder=readFileSync(new URL('../build-image.sh',import.meta.url),'utf8');
  const receipt=readFileSync(new URL('../../ci/fixture-smoke.py',import.meta.url),'utf8');
  for(const name of ['managed-bootstrap-functions.mjs','managed-bootstrap-functions.sql','postgres-extension-captured-acls.mjs','cron-captured-table-acls.mjs','realtime-captured-publication.mjs','schema-restore-diagnostics.mjs']){
    assert.ok(docker.includes(name),name);
    assert.ok(builder.includes(name),name);
    assert.ok(receipt.includes("'"+name+"'"),name);
  }
});
