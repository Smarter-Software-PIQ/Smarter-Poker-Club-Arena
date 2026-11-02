import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {dblinkCapturedInitialAclInstallSql as install,dblinkCapturedInitialAclObservationSql as observe} from '../dblink-captured-initial-acl.mjs';
const root=new URL('../',import.meta.url);
test('captured dblink initial ACL uses only genuine native GRANTs in disposable non-provider extension',async()=>{
 const sql=await readFile(new URL('fixture_dblink_acl_baseline--1.0.sql',root),'utf8');
 assert.equal(sql,'GRANT EXECUTE ON FUNCTION extensions.dblink_connect_u(text), extensions.dblink_connect_u(text,text) TO postgres, anon, authenticated, service_role;\n');
 assert.ok(!/UPDATE|INSERT|DELETE|CREATE|ALTER|binary_upgrade/i.test(sql));
 const control=await readFile(new URL('fixture_dblink_acl_baseline.control',root),'utf8');
 assert.equal(control,"comment = 'Disposable captured dblink initial ACL baseline; not a dblink provider'\ndefault_version = '1.0'\nschema = 'pg_catalog'\nrelocatable = false\nsuperuser = true\ntrusted = false\n");
});
test('dblink source requires exact disposable PG17 identity and rejects unknown or repeated initial baseline',()=>{
 for(const marker of ["current_database()='club_arena_qualification'",'inet_server_addr() IS NULL',"session_user='supabase_admin'",'BETWEEN 170000 AND 179999',"search_path')='pg_catalog'",'oid=10',"extversion='1.2'",'count(*)=41','proowner=10','prosecdef=owner_only',"p.proargtypes::text","i.privtype='e'",'i.objsubid=0',"{supabase_admin=X/supabase_admin,postgres=X*/supabase_admin}",'FIXTURE_DBLINK_INITIAL_ACL_PREIMAGE_REQUIRED','FIXTURE_DBLINK_INITIAL_ACL_EMPTY_HELPER_REQUIRED','FIXTURE_DBLINK_INITIAL_ACL_POSTIMAGE_REQUIRED','DROP EXTENSION fixture_dblink_acl_baseline RESTRICT;',"NOT relocatable AND schema='pg_catalog' AND requires IS NULL"])
 assert.ok(install.includes(marker),marker);
 assert.ok(install.indexOf('DROP EXTENSION')<install.lastIndexOf('TO postgres WITH GRANT OPTION;'));
 assert.ok(!/IF NOT EXISTS|CASCADE|binary_upgrade|UPDATE pg_|INSERT INTO pg_/i.test(install));
 for(const marker of ['AS dblink_captured_initial_acl_exact',"{supabase_admin=X/supabase_admin}","{supabase_admin=X/supabase_admin,postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin}","extname='fixture_dblink_acl_baseline'",'count(*)=2'])assert.ok(observe.includes(marker),marker);
});


test('all captured service ACL inputs belong to the reviewed build and receipt', async () => {
  const docker = await readFile(new URL('Dockerfile', root), 'utf8');
  const builder = await readFile(new URL('build-image.sh', root), 'utf8');
  const receipt = await readFile(new URL('../../ci/fixture-smoke.py', import.meta.url), 'utf8');
  for (const name of ['auth-captured-acls.mjs', 'realtime-captured-acls.mjs',
    'dblink-captured-initial-acl.mjs', 'fixture_dblink_acl_baseline.control',
    'fixture_dblink_acl_baseline--1.0.sql']) {
    assert.ok(docker.includes(name), name);
    assert.ok(builder.includes(name), name);
    assert.ok(receipt.includes("'" + name + "'"), name);
  }
  assert.ok(docker.includes('COPY fixture_dblink_acl_baseline.control fixture_dblink_acl_baseline--1.0.sql /usr/share/postgresql/17/extension/'));
});
