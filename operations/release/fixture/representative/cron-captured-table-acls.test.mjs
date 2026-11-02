import test from 'node:test';
import assert from 'node:assert/strict';
import * as module from '../cron-captured-table-acls.mjs';
const { cronCapturedTableAclInstallSql: install, cronCapturedTableAclObservationSql: observe } =
  module;
test('cron table configuration exposes only the fixed guarded native grants and observer', () => {
  assert.deepEqual(Object.keys(module).sort(), [
    'cronCapturedTableAclInstallSql',
    'cronCapturedTableAclObservationSql',
  ]);
  const grants = install.match(/^  GRANT .*;$/gm);
  assert.deepEqual(grants, [
    '  GRANT SELECT ON TABLE cron.job TO postgres WITH GRANT OPTION;',
    '  GRANT ALL ON TABLE cron.job_run_details TO postgres WITH GRANT OPTION;',
  ]);
  assert.doesNotMatch(
    install,
    /\bCOMMIT\b|\bROLLBACK\b|IF NOT EXISTS|\bCASCADE\b|INSERT INTO|UPDATE pg_|DELETE FROM|ALTER TABLE|ALTER EXTENSION|binary_upgrade/
  );
  assert.match(observe, /^SELECT /);
  assert.match(observe, /AS cron_captured_table_acl_exact$/);
  assert.doesNotMatch(observe, /\bGRANT\b|\bREVOKE\b|\bCREATE\b|\bALTER\b|\bDROP\b/);
});
test('exact private admin, genuine extension and disabled scheduler are checked before locks or grants', () => {
  const first = install.indexOf("RAISE EXCEPTION 'FIXTURE_CRON_TABLE_ACL_CONTEXT_REQUIRED'");
  assert.ok(first > 0 && first < install.indexOf('LOCK TABLE cron.job, cron.job_run_details'));
  for (const marker of [
    "current_database()='club_arena_qualification'",
    'inet_server_addr() IS NULL',
    "current_user='supabase_admin' AND session_user='supabase_admin'",
    'BETWEEN 170000 AND 179999',
    "current_setting('search_path')='pg_catalog'",
    'oid=10 AND rolname=current_user AND rolsuper',
    "rolname='postgres' AND NOT rolsuper",
    "current_setting('cron.database_name')=current_database()",
    "current_setting('cron.launch_active_jobs')='off'",
    "current_setting('cron.enable_superuser_jobs')='off'",
    "e.extversion='1.6.4' AND e.extowner=10 AND e.extnamespace='pg_catalog'::regnamespace",
  ])
    assert.ok(install.slice(0, first).includes(marker), marker);
});
test('raw current and extension initial ACL preimages reject unknown drift and replay', () => {
  for (const marker of [
    'count(*)=2',
    "i.privtype='e'",
    'i.objsubid=0',
    "d.deptype='e' AND e.extname='pg_cron'",
    'c.relrowsecurity AND NOT c.relforcerowsecurity',
    "'{supabase_admin=arwdDxtm/supabase_admin,=r/supabase_admin}'",
    "'{supabase_admin=arwdDxtm/supabase_admin,=rd/supabase_admin}'",
    'OR EXISTS(SELECT 1 FROM cron.job) OR EXISTS(SELECT 1 FROM cron.job_run_details)',
    'FIXTURE_CRON_TABLE_ACL_PREIMAGE_REQUIRED',
  ])
    assert.ok(install.includes(marker), marker);
  for (const marker of [
    'postgres=r*/supabase_admin}',
    'postgres=a*r*w*d*D*x*t*m*/supabase_admin}',
    "md5(shape)='6a168b85b1815f3ba46fbb30212f7ef4'",
  ])
    assert.ok(observe.includes(marker), marker);
});
test('native heap shape and all unrelated catalogs remain exact across the two grants', () => {
  for (const marker of [
    "'am',am.amname",
    'pg_get_indexdef',
    'pg_get_constraintdef',
    'pg_get_triggerdef',
    'pg_get_expr(p.polqual,p.polrelid)',
    "to_jsonb(c)-'relacl'",
    'pg_catalog.pg_attribute',
    'pg_catalog.pg_attrdef',
    'pg_catalog.pg_constraint',
    'pg_catalog.pg_policy',
    'pg_catalog.pg_index',
    'pg_catalog.pg_trigger',
    'pg_catalog.pg_init_privs',
    'pg_catalog.pg_depend',
    'pg_catalog.pg_default_acl',
    'pg_catalog.pg_extension',
    'IS DISTINCT FROM original_metadata',
    'FIXTURE_CRON_TABLE_ACL_POSTIMAGE_REQUIRED',
  ])
    assert.ok(install.includes(marker), marker);
});
