import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { nativeFailureDiagnostic } from '../runtime-files.mjs';
import {
  alignCurrentApplicationRoles,
  extendedRolePreimage,
  currentRoleSourcePins,
} from '../current-application-roles.mjs';

const base = JSON.parse(await readFile(new URL('../role-alignment-aligned.json', import.meta.url)));
function harness({ drift = false, occupied = false } = {}) {
  let committed = false,
    pid = 100;
  const clients = [];
  class Client {
    constructor(config) {
      this.config = config;
      this.processID = ++pid;
      clients.push(this);
    }
    async connect() {}
    async query(sql) {
      if (sql.includes('AS quiescent')) return { rows: [{ quiescent: true }] };
      if (sql.includes('AS preimage')) {
        const image = structuredClone(committed ? extendedRolePreimage(base) : base);
        if (occupied && !committed) image.roles.push({ name: 'ca_record_gateway' });
        if (drift && committed)
          image.memberships.find((edge) => edge.role === 'engine_lightning_fold').set = true;
        return { rows: [{ preimage: { ...image, observed_at: '2026-10-31 17:36:17+00' } }] };
      }
      if (sql.includes('CREATE ROLE ca_ledger_refusal_recorder')) {
        assert.equal((sql.match(/PASSWORD NULL/g) || []).length, 5);
        assert.ok(!sql.includes('vault.') && !sql.includes('CREATE OR REPLACE'));
        assert.ok(sql.includes("VALID UNTIL '2026-10-15 15:52:57.04123+00'"));
        assert.ok(sql.includes('NOBYPASSRLS'));
        committed = true;
        return [{ command: 'COMMIT' }];
      }
      return { rows: [] };
    }
  }
  const databaseOwner = {
    own: (client) => client,
    end: async (client) => {
      client.closed = true;
    },
  };
  return {
    args: { Client, databaseOwner, applicationClient: { processID: 99 } },
    clients,
    committed: () => committed,
  };
}

test('literal role extension preserves old facts except exact current catalogue deltas', () => {
  const next = extendedRolePreimage(base);
  assert.equal(next.roles.length, 38);
  assert.equal(next.memberships.length, base.memberships.length + 5);
  assert.equal(next.default_acl.length, base.default_acl.length);
  const changedDefaults = next.default_acl.filter(
    (row, index) => JSON.stringify(row) !== JSON.stringify(base.default_acl[index])
  );
  assert.deepEqual(
    changedDefaults.map((row) => [row.creator, row.schema, row.type]),
    [
      ['postgres', 'public', 'r'],
      ['supabase_admin', 'realtime', 'r'],
    ]
  );
  assert.equal(
    changedDefaults[0].acl.length,
    base.default_acl.find(
      (row) => row.creator === 'postgres' && row.schema === 'public' && row.type === 'r'
    ).acl.length - 6
  );
  assert.deepEqual(
    changedDefaults[1].acl
      .filter((grant) => grant.grantable)
      .map((grant) => [grant.grantee, grant.privilege]),
    [
      ['postgres', 'INSERT'],
      ['postgres', 'SELECT'],
    ]
  );
  const changedSchemas = next.schemas.filter((row, index) =>
    JSON.stringify(row) !== JSON.stringify(base.schemas[index]));
  assert.deepEqual(changedSchemas.map((row) => row.name), ['public', 'smarter_private']);
  for (const row of changedSchemas) {
    const old = base.schemas.find((item) => item.name === row.name);
    assert.equal(row.owner, old.owner);
    assert.deepEqual(row.acl.filter((grant) => !old.acl.includes(grant)), row.name === 'public'
      ? ['ca_ledger_refusal_recorder=U/pg_database_owner', 'engine_lease_heartbeat=U/pg_database_owner']
      : ['engine_lightning_fold=U/postgres']);
    assert.ok(old.acl.every((grant) => row.acl.includes(grant)));
  }
  assert.deepEqual(next.extensions, base.extensions);
  assert.deepEqual(
    next.roles.filter(
      (role) =>
        role.name !== 'cli_login_postgres' && base.roles.some((old) => old.name === role.name)
    ),
    base.roles.filter((role) => role.name !== 'cli_login_postgres')
  );
  assert.ok(
    next.roles
      .filter((role) => !base.roles.some((old) => old.name === role.name))
      .every(
        (role) =>
          !role.superuser &&
          !role.inherit &&
          !role.bypass_rls &&
          !role.create_db &&
          !role.create_role &&
          !role.replication
      )
  );
  assert.throws(() =>
    extendedRolePreimage({ ...base, roles: [...base.roles, { name: 'unexpected' }] })
  );
});

test('actual installer requires fresh post-commit backend and closes every owned client', async () => {
  const h = harness();
  const proof = await alignCurrentApplicationRoles(h.args);
  assert.equal(proof.roles, 38);
  assert.equal(h.clients.length, 2);
  assert.notEqual(h.clients[0].processID, h.clients[1].processID);
  assert.ok(
    h.clients.every(
      (client) =>
        client.closed &&
        client.config.host === '/run/postgresql' &&
        client.config.user === 'supabase_admin'
    )
  );
});

test('occupied preimage never submits installation and changed postimage never passes', async () => {
  for (const settings of [{ occupied: true }, { drift: true }]) {
    const h = harness(settings);
    await assert.rejects(alignCurrentApplicationRoles(h.args), error => {
      assert.deepEqual(nativeFailureDiagnostic('fixture-preimage-current-application-role-extension',error),
        {status:'failed',stage:'fixture-preimage-current-application-role-extension',error:'AssertionError',
         assertion_site:settings.occupied?'ROLE_PREIMAGE':'ROLE_POSTIMAGE'});
      return true;
    });
    if (settings.occupied) assert.equal(h.committed(), false);
    assert.ok(h.clients.every((client) => client.closed));
  }
});

// The runtime literals are an explicitly reviewed fixture adaptation, not
// permission to execute these production migrations or provider operations.
test('native extension retains the exact protected role-owner source bindings', async () => {
  for (const [path, expected] of Object.entries(currentRoleSourcePins)) {
    const source = await readFile(new URL('../../../../' + path, import.meta.url));
    assert.equal(createHash('sha256').update(source).digest('hex'), expected);
  }
});

test('native extension installer uses actual owning sessions and refuses wrong versions', async () => {
  const { installCurrentApplicationExtensions, currentApplicationExtensions, currentApplicationExtensionNamespaceSql, currentApplicationExtensionNamespace,
    postgresExtensionOwnerBeginSql, postgresExtensionOwnerEndSql,
    legacyDblinkAclInstallSql, legacyDblinkAclObservationSql } =
    await import('../current-application-roles.mjs');
  for (const drift of [false, 'extension-version', 'extension-owner', 'namespace-acl', 'legacy-acl']) {
    const installed = structuredClone(
      currentApplicationExtensions.filter((item) => ['pg_cron', 'plpgsql'].includes(item.name))
    );
    const statements = [];
    const schemas = new Set(base.schemas.map((item) => item.name));
    let namespaceCreates = 0;
    let temporaryOwnerCreates = 0;
    let applicationDdl = 0;
    let backendPid = 200;
    class Client {
      constructor(options) {
        this.options = options;
        this.processID = ++backendPid;
        this.managed = !options?.options?.includes('session_preload_libraries=');
        this.owner = 'supabase_admin';
      }
      async connect() {}
      async query(sql) {
        if (sql === legacyDblinkAclInstallSql) {
          assert.equal(installed.find((item) => item.name === 'dblink')?.owner, 'supabase_admin');
          assert.ok(sql.includes('REVOKE GRANT OPTION FOR EXECUTE'));
        }
        if (sql === legacyDblinkAclObservationSql) return {rows:[{legacy_dblink_exact:drift !== 'legacy-acl'}]};
        if (sql.includes(' AS owned')) return { rows: [{ owned: true }] };
        if (sql.startsWith('SELECT nspname AS name,'))
          return {rows: [{...structuredClone(currentApplicationExtensionNamespace),
            ...(drift === 'namespace-acl' ? {acl: []} : {})}]};
        if (sql.startsWith('SELECT e.extname'))
          return {
            rows: installed
              .map((item) =>
                drift === 'extension-version' && installed.length === 13 && item.name === 'http'
                  ? { ...item, version: 'wrong' }
                  : drift === 'extension-owner' && installed.length === 13 && item.name === 'pgcrypto'
                    ? {...item, owner:'supabase_admin'} : item
              )
              .sort((a, b) => (a.name < b.name ? -1 : 1)),
          };
        if (sql === currentApplicationExtensionNamespaceSql) {
          assert.equal(schemas.has('vault'), false);
          schemas.add('vault'); namespaceCreates++;
        }
        if (sql === postgresExtensionOwnerBeginSql) {
          assert.equal(this.managed, false);
          assert.equal(this.owner, 'supabase_admin');
          this.owner = 'fixture_postgres_extension_owner'; temporaryOwnerCreates++;
        }
        if (sql === postgresExtensionOwnerEndSql) {
          const owned = installed.filter(item=>item.owner==='fixture_postgres_extension_owner');
          assert.equal(owned.length,3);
          assert.deepEqual(owned.map(item=>item.name).sort(),['pg_stat_statements','pgcrypto','uuid-ossp']);
          for(const item of owned) item.owner='postgres';
          this.owner='supabase_admin';
        }
        if (sql.startsWith('CREATE EXTENSION')) {
          const [, name, schema, version] =
            /^CREATE EXTENSION "([^"]+)" WITH SCHEMA "([^"]+)" VERSION '([^']+)'$/.exec(sql);
          if (!schemas.has(schema)) throw Object.assign(new Error('missing namespace'), {code:'3F000'});
          if(this.owner==='postgres') applicationDdl++;
          // Pinned Supautils creates every privileged extension as its admin,
          // regardless of the application's requested role. Model that owner.
          installed.push({ name, schema, version, owner: this.managed ? 'supabase_admin' : this.owner });
          statements.push(sql);
        }
        return { rows: [] };
      }
    }
    const applicationClient = new Client();
    applicationClient.owner = 'postgres';
    const clients = [];
    const args = {
      applicationClient,
      Client,
      databaseOwner: {
        own: (c) => {
          clients.push(c);
          return c;
        },
        end: async (c) => {
          c.closed = true;
        },
      },
    };
    if (drift) await assert.rejects(installCurrentApplicationExtensions(args), error => {
      if (drift === 'legacy-acl') return error.message === 'FIXTURE_ASSERT_LEGACY_DBLINK_POSTIMAGE';
      assert.deepEqual(nativeFailureDiagnostic('fixture-preimage-current-application-role-extension',error),
        {status:'failed',stage:'fixture-preimage-current-application-role-extension',error:'AssertionError',
         assertion_site:drift==='namespace-acl'?'EXTENSION_NAMESPACE_POSTIMAGE':'EXTENSION_POSTIMAGE'});
      return true;
    });
    else assert.equal((await installCurrentApplicationExtensions(args)).installed, 13);
    assert.equal(statements.length, 11);
    assert.equal(namespaceCreates, 1);
    assert.equal(temporaryOwnerCreates, 1);
    assert.equal(applicationDdl, 0);
    assert.equal(clients.length, 3);
    assert.deepEqual(clients.map(client=>client.options.user),['supabase_admin','supabase_admin','supabase_admin']);
    assert.deepEqual(
      installed.sort((a, b) => (a.name < b.name ? -1 : 1)),
      currentApplicationExtensions
    );
    assert.ok(clients.every((client) => client.closed));
    assert.ok(!statements.some((sql) => sql.includes('pg_net')));
  }
});

test('legacy dblink source refuses unknown ACL elements and preserves the two privileged signatures', async () => {
  const {legacyDblinkAclInstallSql, legacyDblinkAclObservationSql} = await import('../current-application-roles.mjs');
  assert.ok(legacyDblinkAclInstallSql.includes("IS DISTINCT FROM TRUE"));
  assert.ok(legacyDblinkAclInstallSql.includes("proacl::text=") && legacyDblinkAclInstallSql.includes(") IS TRUE)"));
  assert.ok(!legacyDblinkAclInstallSql.includes('ON ALL FUNCTIONS') && !legacyDblinkAclInstallSql.includes('CASCADE'));
  const {legacyDblinkMemberInventory} = await import('../current-application-roles.mjs');
  assert.equal(legacyDblinkMemberInventory.length, 41);
  assert.equal(legacyDblinkMemberInventory.filter((row) => row[2]).length, 2);
  assert.ok(legacyDblinkMemberInventory.filter((row) => row[2]).every((row) => row[0] === 'dblink_connect_u'));
  assert.ok(legacyDblinkAclInstallSql.includes("THEN '{supabase_admin=X/supabase_admin,postgres=X*/supabase_admin}'"));
  assert.ok(legacyDblinkAclObservationSql.includes("THEN '{supabase_admin=X/supabase_admin}'"));
  assert.ok(legacyDblinkAclObservationSql.includes("d.deptype='e')=41"));
});
