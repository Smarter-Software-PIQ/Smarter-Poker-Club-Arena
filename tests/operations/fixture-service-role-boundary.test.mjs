import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  serviceRoleBootstrapSql,
  prepareFixtureAuthLegacyMigrationLedger,
  assertNativeServiceRoleBoundary,
  serviceBoundaryReceipt,
  createFixtureApplicationOwner,
  assertApplicationOwnerBoundary,
  assertManagedPostgresBoundary,
  sealFixtureAuthMigrationLedger,
  alignFixtureAuthPlatformHelperGrants,
  assertFixtureAuthPlatformHelpers,
  assertFixtureAuthPlatformWriteDenied,
} from '../../operations/release/fixture/service-role-boundary.mjs';

const boundary = {
  owned_database: true,
  application_owner_flags: true,
  managed_owner_membership: true,
  api_managed_membership_denied: true,
  realtime_bootstrap_superuser: true,
  auth_admin_boundary: true,
  authenticator_boundary: true,
  authenticator_memberships: 3,
  set_only_memberships: 3,
  extra_admin_memberships: 0,
  auth_schema_owner: true,
  auth_schema_migration_access: true,
  public_create_denied: true,
  auth_ledger_read_only: true,
  application_schema_boundary: true,
};

test('Auth grant alignment refuses a non-bootstrap connection before mutation', async () => {
  const calls = [];
  await assert.rejects(
    alignFixtureAuthPlatformHelperGrants({
      query: async (sql) => {
        calls.push(sql);
        return { rows: [{ owned_service_bootstrap: false }] };
      },
    }),
    /FIXTURE_SERVICE_BOOTSTRAP_IDENTITY_REQUIRED/
  );
  assert.equal(calls.length, 1);
});

test('wrong service ownership aborts before changing migrated helper grants', async () => {
  const calls = [];
  await assert.rejects(
    alignFixtureAuthPlatformHelperGrants({
      query: async (sql) => {
        calls.push(sql);
        if (sql.includes('AS owned_service_bootstrap'))
          return { rows: [{ owned_service_bootstrap: true }] };
        if (sql.includes('AS auth_platform_owned'))
          return { rows: [{ auth_platform_owned: false }] };
        return { rows: [] };
      },
    }),
    /FIXTURE_AUTH_PLATFORM_OWNER_REQUIRED/
  );
  assert.equal(calls.at(-1), 'ROLLBACK');
  assert.ok(!calls.includes('SET LOCAL ROLE supabase_auth_admin'));
  assert.ok(!calls.includes('COMMIT'));
});

test('mismatched migrated Auth definitions abort before any grant change', async () => {
  const calls = [];
  await assert.rejects(
    alignFixtureAuthPlatformHelperGrants({
      query: async (sql) => {
        calls.push(sql);
        if (sql.includes('AS owned_service_bootstrap'))
          return { rows: [{ owned_service_bootstrap: true }] };
        if (sql.includes('AS auth_platform_owned'))
          return { rows: [{ auth_platform_owned: true }] };
        return { rows: [] };
      },
    }),
    /FIXTURE_GOTRUE_PLATFORM_PREIMAGE_REQUIRED/
  );
  assert.equal(calls.at(-1), 'ROLLBACK');
  assert.ok(!calls.includes('SET LOCAL ROLE supabase_auth_admin'));
  assert.ok(!calls.includes('COMMIT'));
});

test('missing Auth catalog identities are never a successful installation', async () => {
  await assert.rejects(
    assertFixtureAuthPlatformHelpers({ query: async () => ({ rows: [] }) }),
    /FIXTURE_AUTH_PLATFORM_IDENTITY_REQUIRED/
  );
});

for (const code of ['42704', undefined]) {
  test(`unexpected Auth replacement error ${String(code)} propagates after rollback`, async () => {
    const calls = [];
    const failure = Object.assign(new Error('unexpected database failure'), { code });
    await assert.rejects(
      assertFixtureAuthPlatformWriteDenied({
        query: async (sql) => {
          calls.push(sql);
          if (sql.includes('AS application_owner_boundary'))
            return { rows: [{ owned_database: true, application_owner_boundary: true }] };
          if (sql.startsWith('CREATE OR REPLACE FUNCTION')) throw failure;
          return { rows: [] };
        },
      }),
      (error) => error === failure
    );
    assert.equal(calls.at(-1), 'ROLLBACK');
  });
}

test('an application role that can replace Auth helpers fails qualification after rollback', async () => {
  const calls = [];
  await assert.rejects(
    assertFixtureAuthPlatformWriteDenied({
      query: async (sql) => {
        calls.push(sql);
        if (sql.includes('AS application_owner_boundary'))
          return { rows: [{ owned_database: true, application_owner_boundary: true }] };
        return { rows: [] };
      },
    }),
    /FIXTURE_APPLICATION_AUTH_REPLACEMENT_MUST_REFUSE/
  );
  assert.equal(calls.at(-1), 'ROLLBACK');
});

test('bootstrap SQL accepts only the fixture random hex password, never a SQL fragment', () => {
  for (const bad of [
    undefined,
    '',
    'a'.repeat(63),
    'a'.repeat(65),
    "'; GRANT ALL TO PUBLIC; --",
    'g'.repeat(64),
  ]) {
    assert.throws(() => serviceRoleBootstrapSql(bad), /FIXTURE_RANDOM_DATABASE_PASSWORD_REQUIRED/);
  }
  const sql = serviceRoleBootstrapSql('a'.repeat(64));
  assert.equal(sql.includes('CREATE SCHEMA _realtime'), false);
  assert.match(sql, /supabase_auth_admin LOGIN NOINHERIT CREATEROLE/);
  assert.match(sql, /CREATE SCHEMA auth AUTHORIZATION supabase_admin/);
  assert.ok(!sql.includes('TO supabase_admin WITH ADMIN OPTION'));
});

test('managed native probe rejects a superuser before creating any probe objects', async () => {
  let calls = 0;
  await assert.rejects(
    assertManagedPostgresBoundary({
      query: async () => {
        calls++;
        return { rows: [{ owned_database: true, application_owner_boundary: false }] };
      },
    }),
    /FIXTURE_NON_SUPERUSER_APPLICATION_OWNER_REQUIRED/
  );
  assert.equal(calls, 1);
});

test('Auth ledger permissions refuse an unowned connection before any mutation', async () => {
  const calls = [];
  await assert.rejects(
    sealFixtureAuthMigrationLedger({
      query: async (sql) => {
        calls.push(sql);
        return { rows: [{ owned_auth_ledger: false }] };
      },
    }),
    /FIXTURE_AUTH_LEDGER_OWNER_REQUIRED/
  );
  assert.equal(calls.length, 1);
});

for (const failure of ['grant', 'commit']) {
  test(`Auth ledger ${failure} failure rolls back its complete privilege transaction`, async () => {
    const calls = [];
    const original = new Error(`ledger ${failure} refused`);
    await assert.rejects(
      sealFixtureAuthMigrationLedger({
        query: async (sql) => {
          calls.push(sql);
          if (sql.includes('AS owned_auth_ledger')) return { rows: [{ owned_auth_ledger: true }] };
          if (
            (failure === 'grant' && sql.startsWith('SET LOCAL ROLE')) ||
            (failure === 'commit' && sql === 'COMMIT')
          )
            throw original;
          return { rows: [] };
        },
      }),
      (error) => error === original
    );
    assert.equal(calls.at(-1), 'ROLLBACK');
    if (failure === 'grant') assert.ok(!calls.includes('COMMIT'));
  });
}

test('managed probe failure rolls back before verifying owned object absence', async () => {
  const calls = [];
  await assert.rejects(
    assertManagedPostgresBoundary({
      query: async (sql) => {
        calls.push(sql);
        if (sql.includes('AS application_owner_boundary'))
          return { rows: [{ owned_database: true, application_owner_boundary: true }] };
        if (sql.includes('AS managed_membership')) return { rows: [{ managed_membership: true }] };
        if (sql.includes('AS absent')) return { rows: [{ absent: true }] };
        if (sql.startsWith('CREATE SCHEMA')) throw new Error('probe DDL refused');
        return { rows: [] };
      },
    }),
    /probe DDL refused/
  );
  assert.equal(calls.at(-2), 'ROLLBACK');
  assert.match(calls.at(-1), /AS absent/);
});

test('managed native probe refuses a pre-existing object before starting its transaction', async () => {
  const calls = [];
  await assert.rejects(
    assertManagedPostgresBoundary({
      query: async (sql) => {
        calls.push(sql);
        if (sql.includes('AS application_owner_boundary'))
          return { rows: [{ owned_database: true, application_owner_boundary: true }] };
        if (sql.includes('AS managed_membership')) return { rows: [{ managed_membership: true }] };
        return { rows: [{ absent: false }] };
      },
    }),
    /FIXTURE_MANAGED_PROBE_CLEANUP_REQUIRED/
  );
  assert.ok(!calls.includes('BEGIN'));
});

test('native role proof explicitly excludes full production application privilege parity', async () => {
  const proof = await assertNativeServiceRoleBoundary({
    query: async () => ({ rows: [boundary] }),
  });
  assert.deepEqual(proof, serviceBoundaryReceipt);
  assert.equal(proof.production_application_privilege_parity, false);
});

test('an ordinary or later-created superuser cannot create the fixture application owner', async () => {
  let queries = 0;
  await assert.rejects(
    createFixtureApplicationOwner({
      query: async () => {
        queries++;
        return { rows: [{ owned_bootstrap: false }] };
      },
    }),
    /FIXTURE_INITDB_IDENTITY_REQUIRED/
  );
  assert.equal(queries, 1, 'refusal must occur before privileged DDL');
});

test('application signup refuses a restore owner that is still a superuser', async () => {
  await assert.rejects(
    assertApplicationOwnerBoundary({
      query: async () => ({
        rows: [{ owned_database: true, application_owner_boundary: false }],
      }),
    }),
    /FIXTURE_NON_SUPERUSER_APPLICATION_OWNER_REQUIRED/
  );
});

test('application owner flags alone do not certify complete application privileges', async () => {
  const result = await assertApplicationOwnerBoundary({
    query: async () => ({ rows: [{ owned_database: true, application_owner_boundary: true }] }),
  });
  assert.equal(result.superuser, false);
  assert.equal(result.complete_application_acl_parity, false);
});

for (const [field, bad] of [
  ['owned_database', false],
  ['application_owner_flags', false],
  ['managed_owner_membership', false],
  ['api_managed_membership_denied', false],
  ['realtime_bootstrap_superuser', false],
  ['auth_admin_boundary', false],
  ['authenticator_boundary', false],
  ['authenticator_memberships', 4],
  ['set_only_memberships', 2],
  ['extra_admin_memberships', 1],
  ['auth_schema_owner', false],
  ['auth_schema_migration_access', false],
  ['public_create_denied', false],
  ['auth_ledger_read_only', false],
  ['application_schema_boundary', false],
]) {
  test(`native role drift refuses the service boundary: ${field}`, async () => {
    await assert.rejects(
      assertNativeServiceRoleBoundary({
        query: async () => ({ rows: [{ ...boundary, [field]: bad }] }),
      }),
      /FIXTURE_NATIVE_SERVICE_ROLE_BOUNDARY_REQUIRED/
    );
  });
}

function legacyLedgerDb({ bootstrap = true, fresh = true, empty = true, failCreate = null } = {}) {
  const calls = [];
  return {
    calls,
    query: async (sql) => {
      calls.push(sql);
      if (sql.includes('AS owned_service_bootstrap'))
        return { rows: [{ owned_service_bootstrap: bootstrap }] };
      if (sql.includes('AS fresh_auth_ledger')) return { rows: [{ fresh_auth_ledger: fresh }] };
      if (sql.startsWith('CREATE TABLE') && failCreate) throw failCreate;
      if (sql.includes('AS empty_legacy_auth_ledger'))
        return { rows: [{ empty_legacy_auth_ledger: empty }] };
      return { rows: [] };
    },
  };
}

test('legacy Auth ledger preparation refuses the wrong native bootstrap before mutation', async () => {
  const db = legacyLedgerDb({ bootstrap: false });
  await assert.rejects(
    prepareFixtureAuthLegacyMigrationLedger(db),
    /FIXTURE_SERVICE_BOOTSTRAP_IDENTITY_REQUIRED/
  );
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0], /current_database\(\)='club_arena_qualification'/);
  assert.match(db.calls[0], /inet_server_addr\(\) IS NULL/);
  assert.match(db.calls[0], /oid=10 AND rolsuper/);
});

test('legacy Auth ledger preparation refuses a preexisting ledger or role drift without DDL', async () => {
  const db = legacyLedgerDb({ fresh: false });
  await assert.rejects(
    prepareFixtureAuthLegacyMigrationLedger(db),
    /FIXTURE_FRESH_AUTH_LEDGER_REQUIRED/
  );
  assert.equal(db.calls.at(-1), 'ROLLBACK');
  assert.ok(!db.calls.some((sql) => sql.startsWith('CREATE TABLE')));
  assert.ok(!db.calls.includes('SET LOCAL ROLE supabase_auth_admin'));
});

test('legacy Auth ledger is empty varchar255 owned by the genuine Auth role, never stamped', async () => {
  const db = legacyLedgerDb();
  await prepareFixtureAuthLegacyMigrationLedger(db);
  const ddl = db.calls.find((sql) => sql.startsWith('CREATE TABLE'));
  assert.match(ddl, /"version" varchar\(255\) NOT NULL/);
  assert.match(ddl, /PRIMARY KEY \("version"\)/);
  assert.ok(!ddl.includes('IF NOT EXISTS'));
  assert.ok(db.calls.indexOf('SET LOCAL ROLE supabase_auth_admin') < db.calls.indexOf(ddl));
  assert.ok(!db.calls.some((sql) => /\b(?:INSERT|UPDATE|DELETE|ALTER|GRANT|REVOKE)\b/.test(sql)));
  const proof = db.calls.find((sql) => sql.includes('AS empty_legacy_auth_ledger'));
  assert.match(proof, /atttypmod=259/);
  assert.match(proof, /NOT EXISTS\(SELECT 1 FROM auth.schema_migrations\)/);
  assert.equal(db.calls.at(-1), 'COMMIT');
});

test('legacy Auth ledger failed postcondition rolls back and does not certify migration history', async () => {
  const db = legacyLedgerDb({ empty: false });
  await assert.rejects(
    prepareFixtureAuthLegacyMigrationLedger(db),
    /FIXTURE_EMPTY_LEGACY_AUTH_LEDGER_REQUIRED/
  );
  assert.equal(db.calls.at(-1), 'ROLLBACK');
  assert.ok(!db.calls.includes('COMMIT'));
});

test('legacy Auth ledger concurrent creation or DDL error propagates after rollback', async () => {
  const failure = Object.assign(new Error('duplicate relation'), { code: '42P07' });
  const db = legacyLedgerDb({ failCreate: failure });
  await assert.rejects(prepareFixtureAuthLegacyMigrationLedger(db), (error) => error === failure);
  assert.equal(db.calls.at(-1), 'ROLLBACK');
  assert.ok(!db.calls.includes('COMMIT'));
});

test('Auth bootstrap retains captured ACL entry order without changing privileges', () => {
  const sql = serviceRoleBootstrapSql('a'.repeat(64));
  const api = sql.indexOf('GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;');
  const admins = sql.indexOf('GRANT USAGE, CREATE ON SCHEMA auth TO supabase_auth_admin, dashboard_user;');
  const owner = sql.indexOf('GRANT USAGE ON SCHEMA auth TO postgres;');
  assert.ok(api >= 0 && api < admins && admins < owner);
  assert.ok(!sql.includes('GRANT ALL ON SCHEMA auth'));
});

test('both genuine Auth entrypoints prepare the empty legacy ledger before closing its admin and migrating', async () => {
  for (const [path, client] of [['fixture-server.mjs', 'db'], ['native-smoke.mjs', 'bootstrap']]) {
    const source = await readFile(new URL('../../operations/release/fixture/' + path, import.meta.url), 'utf8');
    const bootstrap = source.indexOf('await ' + client + '.query(serviceRoleBootstrapSql(');
    const prepare = source.indexOf('await prepareFixtureAuthLegacyMigrationLedger(' + client + ');', bootstrap);
    const close = source.indexOf('databaseOwner.end(' + client + ');', prepare);
    const migrate = source.indexOf("['migrate']", close);
    assert.ok(bootstrap >= 0 && bootstrap < prepare && prepare < close && close < migrate, path);
    assert.ok(source.slice(Math.max(0, bootstrap - 200), bootstrap).includes("user: 'supabase_admin'"), path);
    assert.equal(source.split('await prepareFixtureAuthLegacyMigrationLedger(').length - 1, 1, path);
  }
});
