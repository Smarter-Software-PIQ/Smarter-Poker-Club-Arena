import test from 'node:test';
import assert from 'node:assert/strict';
import * as owner from '../schema-restore-owner.mjs';
const {
  schemaRestoreOwnerBeginSql: begin,
  schemaRestoreOwnerEndSql: end,
  schemaRestoreOwnerEnvironment: env,
  schemaRestorePsqlArguments: args,
} = owner;
test('one fixed fresh-administrator psql child owns all three commands in one transaction', () => {
  assert.deepEqual(Object.keys(owner).sort(), [
    'schemaRestoreOwnerBeginSql',
    'schemaRestoreOwnerEndSql',
    'schemaRestoreOwnerEnvironment',
    'schemaRestorePsqlArguments',
  ]);
  assert.deepEqual(env, { PGOPTIONS: '-c search_path=pg_catalog -c session_preload_libraries=' });
  assert.ok(Object.isFrozen(env));
  assert.ok(Object.isFrozen(args));
  assert.deepEqual(args, [
    '-X',
    '--single-transaction',
    '-v',
    'ON_ERROR_STOP=1',
    '-v',
    'VERBOSITY=sqlstate',
    '-h',
    '/run/postgresql',
    '-U',
    'supabase_admin',
    '-d',
    'club_arena_qualification',
    '-c',
    begin,
    '-f',
    '/run/club-arena-qualification/private/schema/schema.sql',
    '-c',
    end,
  ]);
  assert.equal(args.filter((x) => x === '-f').length, 1);
  assert.equal(args.filter((x) => x === '-c').length, 2);
});
test('missing transaction and unknown private bootstrap preimages fail before role creation', () => {
  assert.match(begin, /^SAVEPOINT fixture_schema_restore_owner_guard;/);
  const first = begin.indexOf('CREATE ROLE fixture_schema_restore_owner');
  for (const marker of [
    "current_database()='club_arena_qualification'",
    'inet_server_addr() IS NULL',
    "current_user='supabase_admin' AND session_user='supabase_admin'",
    'BETWEEN 170000 AND 179999',
    "current_setting('session_preload_libraries')=''",
    "current_setting('search_path')='pg_catalog'",
    'oid=10 AND rolname=current_user AND rolsuper',
    "rolname='postgres' AND NOT rolsuper",
    'FIXTURE_SCHEMA_RESTORE_OWNER_PREIMAGE_REQUIRED',
    "current_setting('fixture.schema_restore_active',true)",
  ])
    assert.ok(begin.slice(0, first).includes(marker), marker);
  assert.ok(first > 0);
  assert.ok(
    begin.includes('NOLOGIN SUPERUSER NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS')
  );
  assert.match(begin, /SET LOCAL ROLE fixture_schema_restore_owner;$/);
});
test('the defaultless creator has no memberships or initial persistent dependencies', () => {
  for (const marker of [
    'pg_catalog.pg_shdepend',
    "d.refclassid='pg_catalog.pg_authid'::regclass",
    'pg_catalog.pg_auth_members',
    'IN(m.roleid,m.member,m.grantor)',
    'pg_catalog.pg_default_acl',
    'pg_catalog.aclexplode(d.defaclacl)',
    'IN(a.grantor,a.grantee)',
    'rolconfig IS NULL AND rolvaliduntil IS NULL AND rolconnlimit=-1',
    'FIXTURE_SCHEMA_RESTORE_OWNER_EMPTY_ROLE_REQUIRED',
  ])
    assert.ok(begin.includes(marker), marker);
  assert.doesNotMatch(
    begin + '\n' + end,
    /ALTER ROLE|GRANT .* TO|REASSIGN OWNED|DROP OWNED|ALTER DEFAULT PRIVILEGES|UPDATE pg_|INSERT INTO pg_|DELETE FROM pg_|\bCASCADE\b|\bCOMMIT\b/
  );
});
test('credential-free application role/settings/membership snapshot must survive both ends unchanged', () => {
  for (const sql of [begin, end])
    for (const marker of [
      "to_jsonb(r)-'rolpassword'",
      'pg_catalog.pg_roles',
      'pg_catalog.pg_db_role_setting',
      'pg_catalog.pg_auth_members',
      'fixture.schema_restore_pg',
    ])
      assert.ok(sql.includes(marker), marker);
  assert.match(end, /^RESET ROLE;\nSET LOCAL search_path=pg_catalog;/);
  assert.ok(
    end.includes("IS DISTINCT FROM current_setting('fixture.schema_restore_pg',true)::jsonb")
  );
  assert.ok(end.includes('FIXTURE_SCHEMA_RESTORE_OWNER_CONTEXT_CHANGED'));
});
test('cleanup refuses owner ACL default or membership residue rather than repairing ownership', () => {
  const drop = end.indexOf('DROP ROLE fixture_schema_restore_owner;');
  assert.ok(drop > end.indexOf('FIXTURE_SCHEMA_RESTORE_OWNER_RESIDUE_REQUIRED'));
  for (const marker of [
    'pg_catalog.pg_shdepend',
    'pg_catalog.pg_auth_members',
    'pg_catalog.pg_default_acl',
  ])
    assert.ok(end.slice(0, drop).includes(marker), marker);
  assert.ok(end.slice(drop).includes('FIXTURE_SCHEMA_RESTORE_OWNER_POSTIMAGE_REQUIRED'));
  assert.ok(end.includes("set_config('fixture.schema_restore_active','finished',true)"));
  assert.match(end, /RELEASE SAVEPOINT fixture_schema_restore_owner_guard;$/);
  assert.doesNotMatch(end, /DROP ROLE fixture_schema_restore_owner (?:CASCADE|RESTRICT)/);
});
