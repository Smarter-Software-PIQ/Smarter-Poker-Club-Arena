import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as module from '../cron-captured-sequence-acls.mjs';
import { fileURLToPath } from 'node:url';
const {cronCapturedSequenceAclInstallSql: install, cronCapturedSequenceAclObservationSql: observe} = module;
const file = name => readFile(new URL(`../${name}`, import.meta.url), 'utf8');
test('captured cron sequence configuration has only two owner-only privilege targets', async () => {
  assert.deepEqual(Object.keys(module).sort(), ['cronCapturedSequenceAclInstallSql','cronCapturedSequenceAclObservationSql']);
  assert.equal(await file('fixture_cron_sequence_acl_baseline--1.0.sql'),
    'REVOKE SELECT ON SEQUENCE cron.jobid_seq, cron.runid_seq FROM PUBLIC RESTRICT;\n');
  const control = await file('fixture_cron_sequence_acl_baseline.control');
  assert.match(control, /superuser = true\ntrusted = false\n$/);
  assert.match(control, /schema = 'pg_catalog'\nrelocatable = false/);
  assert.doesNotMatch(install, /\bCOMMIT\b|\bROLLBACK\b|IF NOT EXISTS|\bCASCADE\b|INSERT INTO|UPDATE pg_|DELETE FROM|ALTER TABLE|ALTER EXTENSION|binary_upgrade|set_config/);
  assert.doesNotMatch(observe, /\bGRANT\b|\bREVOKE\b|\bCREATE\b|\bALTER\b|\bDROP\b/);
});
test('only the original isolated admin and unchanged genuine disabled scheduler may configure sequences', () => {
  const refusal = install.indexOf("RAISE EXCEPTION 'FIXTURE_CRON_SEQUENCE_ACL_CONTEXT_REQUIRED'");
  assert.ok(refusal > 0 && refusal < install.indexOf('original_metadata :='));
  for (const text of ["current_database()='club_arena_qualification'", 'inet_server_addr() IS NULL',
    "current_user='supabase_admin' AND session_user='supabase_admin'", 'oid=10 AND rolname=current_user AND rolsuper',
    "rolname='postgres' AND NOT rolsuper", "current_setting('search_path')='pg_catalog'", 'BETWEEN 170000 AND 179999',
    "current_setting('cron.database_name')=current_database()", "current_setting('cron.launch_active_jobs')='off'",
    "current_setting('cron.enable_superuser_jobs')='off'", "e.extversion='1.6.4' AND e.extowner=10 AND e.extnamespace='pg_catalog'::regnamespace"])
    assert.ok(install.slice(0, refusal).includes(text), text);
});
test('unknown native grants, initial privileges, sequence definitions, jobs and replay refuse before mutation', () => {
  const create = install.indexOf("EXECUTE 'CREATE EXTENSION fixture_cron_sequence_acl_baseline");
  const before = install.slice(0, create);
  for (const text of ["c.relname IN('jobid_seq','runid_seq')", 'count(*)=2', "s.seqtypid='pg_catalog.int8'::regtype",
    's.seqstart=1 AND s.seqincrement=1', 's.seqmin=1 AND s.seqmax=9223372036854775807',
    's.seqcache=1 AND NOT s.seqcycle', "d.deptype='e' AND e.extname='pg_cron'", "i.privtype='e'", 'i.objsubid=0',
    'i.initprivs::text=c.relacl::text', "'{supabase_admin=rwU/supabase_admin,=r/supabase_admin}'",
    'OR EXISTS(SELECT 1 FROM cron.job) OR EXISTS(SELECT 1 FROM cron.job_run_details)',
    "name='fixture_cron_sequence_acl_baseline'", 'requires IS NULL', 'FIXTURE_CRON_SEQUENCE_ACL_PREIMAGE_REQUIRED'])
    assert.ok(before.includes(text), text);
  assert.ok(create > install.indexOf('FIXTURE_CRON_SEQUENCE_ACL_PREIMAGE_REQUIRED'));
});
test('empty helper restrictive retirement and complete unrelated metadata are asserted before accepting', () => {
  assert.ok(install.includes('FIXTURE_CRON_SEQUENCE_ACL_EMPTY_HELPER_REQUIRED'));
  assert.ok(install.includes("EXECUTE 'DROP EXTENSION fixture_cron_sequence_acl_baseline RESTRICT'"));
  assert.ok(install.includes('IS DISTINCT FROM original_metadata'));
  for (const text of ['pg_catalog.pg_sequence','pg_catalog.pg_attribute','pg_catalog.pg_attrdef','pg_catalog.pg_constraint',
    'pg_catalog.pg_policy','pg_catalog.pg_index','pg_catalog.pg_trigger','pg_catalog.pg_init_privs','pg_catalog.pg_depend',
    'pg_catalog.pg_default_acl','pg_catalog.pg_extension',"'{supabase_admin=rwU/supabase_admin}'"])
    assert.ok(install.includes(text), text);
  assert.match(observe, /AS cron_captured_sequence_acl_exact$/);
});
test('current-application bootstrap owns atomic installation and a different post-commit observer', async () => {
  const source = await file('current-application-roles.mjs');
  const begin = source.indexOf('await bootstrap.query("BEGIN; SET LOCAL lock_timeout=');
  const installAt = source.indexOf('await bootstrap.query(cronCapturedSequenceAclInstallSql)');
  const commit = source.indexOf("await bootstrap.query('COMMIT')", installAt);
  const observer = source.indexOf('await legacyObserver.query(cronCapturedSequenceAclObservationSql)');
  assert.ok(begin >= 0 && installAt > begin && commit > installAt && observer > commit);
  assert.ok(source.includes('assert.notEqual(legacyObserver.processID, bootstrap.processID)'));
  assert.ok(source.includes("await bootstrap.query('ROLLBACK').catch(() => {})"));
  assert.ok(source.includes('FIXTURE_ASSERT_CRON_CAPTURED_SEQUENCE_ACL_POSTIMAGE'));
});
test('new SQL guards cross the actual closed producer and independent decoder without private data', async () => {
  const {nativeFailureDiagnostic} = await import('../runtime-files.mjs');
  const {spawnSync} = await import('node:child_process');
  const stage = 'fixture-preflight-current-application-role-extension';
  const good = ['CONTEXT','PREIMAGE','EMPTY_HELPER','POSTIMAGE'].map(site => {
    const row = nativeFailureDiagnostic(stage, Object.assign(new Error(`FIXTURE_CRON_SEQUENCE_ACL_${site}_REQUIRED`),
      {name:'error',code:'P0001',detail:'PRIVATE_CANARY_SQL'}));
    assert.equal(row.sql_guard_site, `CRON_SEQUENCE_ACL_${site}`);
    assert.ok(!JSON.stringify(row).includes('PRIVATE_CANARY_SQL'));
    return row;
  });
  const invalid = good.map(row => ({...row,extra:'PRIVATE_CANARY_SQL'}));
  const code = "import importlib.util,json,sys;spec=importlib.util.spec_from_file_location('smoke',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);good,bad=json.load(sys.stdin);assert all(len(m.native_failures(json.dumps(row)))==1 for row in good);assert all(m.native_failures(json.dumps(row))==[] for row in bad);print('cron guards decoded')";
  const result = spawnSync('python3',['-B','-c',code,fileURLToPath(new URL('../../ci/fixture-smoke.py',import.meta.url))],
    {input:JSON.stringify([good,invalid]),encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/cron guards decoded/);
});
