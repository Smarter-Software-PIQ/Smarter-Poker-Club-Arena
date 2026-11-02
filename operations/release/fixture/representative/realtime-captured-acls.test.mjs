import test from 'node:test';
import assert from 'node:assert/strict';
import * as module from '../realtime-captured-acls.mjs';
const { realtimeCapturedAclInstallSql: install, realtimeCapturedAclObservationSql: observe } =
  module;
test('genuine91 supplies exact captured ACLs; bootstrap asserts without another grant/revoke transformation', () => {
  assert.deepEqual(Object.keys(module).sort(), [
    'realtimeCapturedAclInstallSql',
    'realtimeCapturedAclObservationSql',
  ]);
  assert.doesNotMatch(
    install,
    /\b(?:GRANT|REVOKE|CREATE|ALTER|DROP|COMMIT|ROLLBACK|UPDATE|INSERT|DELETE)\b|IF NOT EXISTS|CASCADE/
  );
  for (const text of [install, observe])
    for (const marker of [
      'count(*)=91',
      '20261009120000',
      '07ccff1fbfc0665aee2027f75c40670b',
      'count(*)=8',
      'count(*)=7',
      'max(day)-min(day)=6',
      'count(DISTINCT day)=7',
      "AT TIME ZONE 'UTC'",
      'postgres=a*r*wdDxtm/supabase_realtime_admin',
      'pg_catalog.pg_init_privs',
      "p.classoid='pg_catalog.pg_class'::regclass",
      'c.relacl::text=',
      "inhparent='realtime.messages'::regclass",
      'NOT c.relforcerowsecurity',
    ])
      assert.ok(text.includes(marker), marker);
});
test('private identity, exact native91 ledger, empty parent and bounded UTC partition shape remain mandatory', () => {
  for (const marker of [
    "current_database()='club_arena_qualification'",
    'inet_server_addr() IS NULL',
    "current_user='supabase_admin' AND session_user='supabase_admin'",
    'oid=10 AND rolname=current_user AND rolsuper',
    "current_setting('search_path')='pg_catalog'",
    "to_regnamespace('_realtime') IS NULL",
    "RAISE EXCEPTION 'FIXTURE_REALTIME_ACL_CONTEXT_REQUIRED'",
    "RAISE EXCEPTION 'FIXTURE_REALTIME_ACL_PREIMAGE_REQUIRED'",
    'OR EXISTS(SELECT 1 FROM realtime.messages)',
    "pg_get_partkeydef(c.oid)='RANGE (inserted_at)'",
    "'FOR VALUES FROM (%L) TO (%L)'",
  ])
    assert.ok(install.includes(marker), marker);
  assert.match(observe, /^SELECT /);
  assert.match(observe, /AS realtime_captured_acl_exact$/);
  assert.doesNotMatch(observe, /\b(?:GRANT|REVOKE|CREATE|ALTER|DROP)\b/);
  assert.doesNotMatch(
    install,
    /postgres=arwdDxtm\/supabase_realtime_admin|count\(\*\)=83|20260827120000/
  );
});
