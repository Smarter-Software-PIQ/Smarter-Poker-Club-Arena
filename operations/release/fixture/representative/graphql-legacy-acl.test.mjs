import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { graphqlLegacyAclInstallSql, graphqlLegacyAclObservationSql } from '../graphql-legacy-acl.mjs';

const root = new URL('../', import.meta.url);
test('GraphQL captured ACL helper is exactly GRANT-only and explicitly not a provider', async () => {
  const control = await readFile(new URL('fixture_graphql_acl_baseline.control', root), 'utf8');
  assert.equal(control, "comment = 'Disposable captured GraphQL namespace ACL baseline; not a GraphQL provider'\ndefault_version = '1.0'\nschema = 'pg_catalog'\nrelocatable = false\nsuperuser = true\ntrusted = false\n");
  const sql = await readFile(new URL('fixture_graphql_acl_baseline--1.0.sql', root), 'utf8');
  assert.equal(sql, 'GRANT USAGE ON SCHEMA graphql, graphql_public TO anon, authenticated, service_role;\nGRANT USAGE ON SCHEMA graphql, graphql_public TO postgres WITH GRANT OPTION;\nGRANT ALL ON SCHEMA graphql, graphql_public TO supabase_admin;\n');
  assert.ok(!/UPDATE|INSERT|DELETE|CREATE|ALTER|binary_upgrade/i.test(sql));
});

test('GraphQL baseline guards refuse unknown state and retain normal extension cleanup', () => {
  for (const marker of ["current_database()='club_arena_qualification'", 'inet_server_addr() IS NULL',
    "current_user='supabase_admin' AND session_user='supabase_admin'", 'BETWEEN 170000 AND 179999',
    'oid=10 AND rolname=current_user AND rolsuper', 'n.nspowner=10', 'count(*)=2',
    "d.deptype='e'", 'p.initprivs=n.nspacl', "p.privtype='e'", 'p.objsubid=0',
    "extname='fixture_graphql_acl_baseline'"])
    assert.ok(graphqlLegacyAclObservationSql.includes(marker), marker);
  assert.ok(graphqlLegacyAclInstallSql.includes('pg_catalog.pg_available_extension_versions'));
  assert.ok(graphqlLegacyAclInstallSql.includes('superuser AND NOT trusted'));
  assert.ok(graphqlLegacyAclInstallSql.includes("NOT relocatable AND schema='pg_catalog' AND requires IS NULL"));
  assert.ok(graphqlLegacyAclInstallSql.includes('FIXTURE_GRAPHQL_ACL_PREIMAGE_REQUIRED'));
  assert.ok(graphqlLegacyAclInstallSql.includes('FIXTURE_GRAPHQL_ACL_EMPTY_HELPER_REQUIRED'));
  assert.ok(graphqlLegacyAclInstallSql.includes('FIXTURE_GRAPHQL_ACL_POSTIMAGE_REQUIRED'));
  assert.ok(graphqlLegacyAclInstallSql.includes('DROP EXTENSION fixture_graphql_acl_baseline RESTRICT;'));
  assert.ok(!/IF NOT EXISTS|CASCADE|binary_upgrade|UPDATE pg_|INSERT INTO pg_/i.test(graphqlLegacyAclInstallSql));
});

test('GraphQL baseline inputs remain in exact build context and sanitized receipt closure', async () => {
  const docker = await readFile(new URL('Dockerfile', root), 'utf8');
  const builder = await readFile(new URL('build-image.sh', root), 'utf8');
  const receipt = await readFile(new URL('../../ci/fixture-smoke.py', import.meta.url), 'utf8');
  for (const name of ['graphql-legacy-acl.mjs', 'fixture_graphql_acl_baseline.control', 'fixture_graphql_acl_baseline--1.0.sql']) {
    assert.ok(docker.includes(name), name);
    assert.ok(builder.includes(name), name);
    assert.ok(receipt.includes("'" + name + "'"), name);
  }
  assert.ok(docker.includes('COPY fixture_graphql_acl_baseline.control fixture_graphql_acl_baseline--1.0.sql /usr/share/postgresql/17/extension/'));
});
