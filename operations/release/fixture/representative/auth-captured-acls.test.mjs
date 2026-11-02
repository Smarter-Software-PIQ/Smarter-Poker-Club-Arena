import test from 'node:test';
import assert from 'node:assert/strict';
import { serviceRoleBootstrapSql, createFixtureApplicationOwner } from '../service-role-boundary.mjs';
import { authCapturedAclInstallSql, authCapturedAclObservationSql, authCapturedAclInventory } from '../auth-captured-acls.mjs';

const names = ['audit_log_entries','instances','refresh_tokens','refresh_tokens_id_seq','users'];
test('captured Auth adaptation touches only the five exact ACLs through their owner', () => {
  assert.deepEqual(authCapturedAclInventory, names.map(name => [name, name.endsWith('_seq') ? 'S' : 'r']));
  assert.ok(Object.isFrozen(authCapturedAclInventory) && authCapturedAclInventory.every(Object.isFrozen));
  assert.ok(authCapturedAclInstallSql.includes('SET LOCAL ROLE supabase_auth_admin;'));
  assert.ok(authCapturedAclInstallSql.includes('RESET ROLE;'));
  const ownerCommands = authCapturedAclInstallSql.split('SET LOCAL ROLE supabase_auth_admin;')[1].split('RESET ROLE;')[0].trim().split('\n');
  assert.equal(ownerCommands.length, 19);
  for (const command of ownerCommands) {
    const match = /^(?:REVOKE ALL ON (TABLE|SEQUENCE) auth\.([a-z_]+) FROM postgres, dashboard_user RESTRICT;|GRANT (ALL|SELECT) ON (TABLE|SEQUENCE) auth\.([a-z_]+) TO (postgres|dashboard_user)( WITH GRANT OPTION)?;)$/.exec(command);
    assert.ok(match, command);
    assert.ok(names.includes(match[2] ?? match[5]));
  }
  assert.equal(ownerCommands.filter(sql => sql.startsWith('REVOKE')).length, 5);
  assert.equal(ownerCommands.filter(sql => sql.endsWith('WITH GRANT OPTION;')).length, 4);
  assert.ok(!/CASCADE|IF NOT EXISTS|CREATE |ALTER DEFAULT|UPDATE pg_|INSERT INTO pg_|DELETE FROM|ON ALL TABLES/.test(authCapturedAclInstallSql));
});

test('raw Auth ACL before and after preserve every effective grant and reject repeated adaptation', () => {
  const quoted = [...authCapturedAclInstallSql.matchAll(/'(\{[^']+\})'/g)].map(match => match[1]);
  const unique = [...new Set(quoted)];
  assert.equal(unique.length, 4);
  const canonical = acl => acl.slice(1,-1).split(',').sort();
  const table = unique.filter(acl => acl.includes('arwdDxtm'));
  const sequence = unique.filter(acl => acl.includes('=rwU/'));
  for (const pair of [table, sequence]) {
    assert.equal(pair.length, 2);
    assert.notEqual(pair[0], pair[1]);
    assert.deepEqual(canonical(pair[0]), canonical(pair[1]));
  }
  const bootstrap = serviceRoleBootstrapSql('f'.repeat(64));
  assert.ok(bootstrap.includes('GRANT ALL ON TABLES TO postgres, dashboard_user;'));
  assert.ok(bootstrap.includes('GRANT ALL ON SEQUENCES TO postgres, dashboard_user;'));
  assert.ok(authCapturedAclInstallSql.includes('FIXTURE_AUTH_CAPTURED_ACL_PREIMAGE_REQUIRED'));
  assert.ok(authCapturedAclInstallSql.includes('FIXTURE_AUTH_CAPTURED_ACL_POSTIMAGE_REQUIRED'));
  assert.ok(authCapturedAclObservationSql.includes(table[1]));
  assert.ok(!authCapturedAclObservationSql.includes(table[0]));
});

test('Auth ACL installer and independent observer refuse unknown private identity or metadata', () => {
  for (const sql of [authCapturedAclInstallSql, authCapturedAclObservationSql]) {
    for (const expected of ["current_database()='club_arena_qualification'", 'inet_server_addr() IS NULL',
      "current_user='supabase_admin' AND session_user='supabase_admin'", 'BETWEEN 170000 AND 179999',
      "current_setting('search_path')='pg_catalog'", 'oid=10 AND rolname=current_user AND rolsuper',
      'count(*)=3 AND bool_and(NOT rolsuper)', 'count(*)=5', 'c.relkind::text=c.kind',
      'c.relowner=', 'c.relacl::text=CASE', 'a.attacl IS NOT NULL', 'pg_catalog.pg_init_privs', "d.deptype='e'", ') IS TRUE)'])
      assert.ok(sql.includes(expected), expected);
  }
  assert.ok(authCapturedAclInstallSql.includes('IS DISTINCT FROM TRUE'));
  assert.ok(!authCapturedAclObservationSql.includes('REVOKE') && !authCapturedAclObservationSql.includes('GRANT '));
});

test('Auth raw preimage follows actual bootstrap role OID order including the hidden owner entry', async () => {
  const writes = [];
  await createFixtureApplicationOwner({async query(sql) {
    if (sql.includes('AS owned_bootstrap')) return {rows:[{owned_bootstrap:true}]};
    writes.push(sql); return {rows:[]};
  }});
  const bootstrap = writes.join('\n') + serviceRoleBootstrapSql('f'.repeat(64));
  const creationOrder = [...bootstrap.matchAll(/CREATE ROLE ([a-z_]+)/g)].map(match => match[1]);
  for (const name of ['postgres', 'supabase_auth_admin', 'dashboard_user'])
    assert.equal(creationOrder.filter(role => role === name).length, 1, name);
  assert.ok(creationOrder.indexOf('postgres') < creationOrder.indexOf('supabase_auth_admin'));
  assert.ok(creationOrder.indexOf('supabase_auth_admin') < creationOrder.indexOf('dashboard_user'));
  assert.ok(authCapturedAclInstallSql.includes("'{postgres=ar*wdDxtm/supabase_auth_admin,supabase_auth_admin=arwdDxtm/supabase_auth_admin,dashboard_user=arwdDxtm/supabase_auth_admin}'"));
  assert.ok(authCapturedAclInstallSql.includes("'{postgres=rwU/supabase_auth_admin,supabase_auth_admin=rwU/supabase_auth_admin,dashboard_user=rwU/supabase_auth_admin}'"));
  assert.ok(!authCapturedAclInstallSql.includes("'{postgres=ar*wdDxtm/supabase_auth_admin,dashboard_user=arwdDxtm/supabase_auth_admin,supabase_auth_admin=arwdDxtm/supabase_auth_admin}'"));
});
