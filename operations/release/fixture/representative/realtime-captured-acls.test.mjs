import test from 'node:test';
import assert from 'node:assert/strict';
import * as module from '../realtime-captured-acls.mjs';

const { realtimeCapturedAclInstallSql: install, realtimeCapturedAclObservationSql: observe } =
  module;
const owner = 'supabase_realtime_admin=arwdDxtm/supabase_realtime_admin';
const dashboard = 'dashboard_user=arwdDxtm/supabase_realtime_admin';
const api =
  'anon=arw/supabase_realtime_admin,authenticated=arw/supabase_realtime_admin,service_role=arw/supabase_realtime_admin';
const nativeChild = `{${owner},postgres=arwdDxtm/supabase_realtime_admin,${dashboard}}`;
const targetChild = `{${owner},postgres=a*r*wdDxtm/supabase_realtime_admin,${dashboard}}`;
const nativeParent = nativeChild.slice(0, -1) + ',' + api + '}';
const targetParent = targetChild.slice(0, -1) + ',' + api + '}';

// These source contracts preserve the private transaction boundary. Genuine PG17
// executions separately qualify raw dump parity and transactional refusals.
test('captured Realtime configuration exposes only fixed install and observer SQL', () => {
  assert.deepEqual(Object.keys(module).sort(), [
    'realtimeCapturedAclInstallSql',
    'realtimeCapturedAclObservationSql',
  ]);
  assert.equal(typeof install, 'string');
  assert.equal(typeof observe, 'string');
  assert.doesNotMatch(install, /\bCOMMIT\b|\bROLLBACK\b|IF NOT EXISTS|\bCASCADE\b/);
});

test('the native ACL order and captured SELECT INSERT grant options remain exact', () => {
  for (const acl of [nativeParent, nativeChild, targetParent, targetChild])
    assert.ok(install.includes("'" + acl + "'"));
  assert.ok(observe.includes("'" + targetParent + "'"));
  assert.ok(observe.includes("'" + targetChild + "'"));
  assert.ok(!observe.includes("'" + nativeParent + "'"));
  assert.ok(!observe.includes("'" + nativeChild + "'"));
});

test('private bootstrap identity is checked before any relation lock or mutation', () => {
  const firstRefusal = install.indexOf("RAISE EXCEPTION 'FIXTURE_REALTIME_ACL_CONTEXT_REQUIRED'");
  assert.ok(firstRefusal > 0 && firstRefusal < install.indexOf('LOCK TABLE'));
  for (const token of [
    "current_database()='club_arena_qualification'",
    'inet_server_addr() IS NULL',
    "current_user='supabase_admin' AND session_user='supabase_admin'",
    'oid=10 AND rolname=current_user AND rolsuper',
    "current_setting('search_path')='pg_catalog'",
    "to_regnamespace('_realtime') IS NULL",
  ])
    assert.ok(install.slice(0, firstRefusal).includes(token), token);
});

test('only six genuine table relations and five consecutive bounded children qualify', () => {
  for (const text of [install, observe]) {
    for (const token of [
      "c.relkind IN ('r','p')",
      'count(*)=6',
      'count(*)=5',
      'max(day)-min(day)=4',
      'count(DISTINCT day)=5',
      "'^messages_[0-9]{4}_[0-9]{2}_[0-9]{2}$'",
      "to_char(day,'YYYY_MM_DD')=substring(relname FROM 10)",
      "'FOR VALUES FROM (%L) TO (%L)'",
      "inhparent='realtime.messages'::regclass",
      "pg_get_partkeydef(c.oid)='RANGE (inserted_at)'",
    ])
      assert.ok(text.includes(token), token);
    assert.doesNotMatch(text, /messages_20[0-9]{2}_/);
  }
});

test('the exact migration ledger, empty message set and absent initial ACLs are prerequisites', () => {
  for (const token of [
    'count(*)=83',
    'min(version)=20211116024918',
    'max(version)=20260827120000',
    "'262da2efb4aa494a7d90cf451fc9cce5'",
    'OR EXISTS(SELECT 1 FROM realtime.messages)',
    'pg_catalog.pg_init_privs',
    "p.classoid='pg_catalog.pg_class'::regclass",
    "RAISE EXCEPTION 'FIXTURE_REALTIME_ACL_PREIMAGE_REQUIRED'",
  ])
    assert.ok(install.includes(token), token);
  assert.ok(
    install.indexOf('FIXTURE_REALTIME_ACL_PREIMAGE_REQUIRED') < install.indexOf('SET LOCAL ROLE')
  );
});

test('the owner grants only the two captured options to PostgreSQL on validated identifiers', () => {
  assert.match(install, /SET LOCAL ROLE supabase_realtime_admin;[\s\S]*RESET ROLE;/);
  assert.equal((install.match(/EXECUTE format\(/g) || []).length, 1);
  assert.ok(
    install.includes(
      "format('GRANT SELECT, INSERT ON TABLE realtime.%I TO postgres WITH GRANT OPTION',item.relname)"
    )
  );
  assert.doesNotMatch(
    install,
    /GRANT ALL|TO anon|TO authenticated|TO service_role|REVOKE|INSERT INTO pg_|UPDATE pg_|DELETE FROM pg_|ALTER DEFAULT PRIVILEGES/
  );
});

test('unrelated relation attributes, defaults, constraints, indexes, ancestry and ledger are unchanged', () => {
  for (const token of [
    "to_jsonb(c)-'relacl'",
    'pg_catalog.pg_attribute',
    'pg_catalog.pg_attrdef',
    'pg_catalog.pg_constraint',
    'pg_catalog.pg_index',
    'pg_catalog.pg_inherits',
    'jsonb_agg(to_jsonb(m) ORDER BY m.version)',
    'IS DISTINCT FROM original_metadata',
    "RAISE EXCEPTION 'FIXTURE_REALTIME_ACL_POSTIMAGE_REQUIRED'",
  ])
    assert.ok(install.includes(token), token);
});

test('the separate observer requires exact target ACLs and unchanged table boundaries', () => {
  assert.match(observe, /^SELECT /);
  assert.match(observe, /AS realtime_captured_acl_exact$/);
  assert.ok(observe.includes('c.relacl::text='));
  assert.ok(observe.includes('c.relowner='));
  assert.ok(observe.includes('NOT c.relforcerowsecurity'));
  assert.ok(observe.includes('pg_catalog.pg_init_privs'));
  assert.doesNotMatch(observe, /\bGRANT\b|\bREVOKE\b|\bCREATE\b|\bALTER\b|\bDROP\b/);
});
