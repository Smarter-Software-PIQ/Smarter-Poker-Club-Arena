import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { managedPostgresArguments, assertBootstrapPostgresConfiguration } from '../service-role-boundary.mjs';

test('private full-schema restore reserves its native-qualified lock capacity', () => {
  assert.ok(Object.isFrozen(managedPostgresArguments));
  assert.deepEqual(managedPostgresArguments.filter(value => value.startsWith('max_locks_per_transaction=')), ['max_locks_per_transaction=512']);
});

test('both private PostgreSQL entrypoints assert live capacity before creating application roles', async () => {
  for (const name of ['fixture-server.mjs', 'native-smoke.mjs']) {
    const source = await readFile(new URL('../' + name, import.meta.url), 'utf8');
    const start = source.indexOf('...managedPostgresArguments');
    const observe = source.indexOf('await assertBootstrapPostgresConfiguration(');
    const roles = source.indexOf('await createFixtureApplicationOwner(');
    assert.equal(source.split('...managedPostgresArguments').length - 1, 1, name);
    assert.ok(start >= 0 && start < observe && observe < roles, name);
  }
});

test('missing private server capacity refuses bootstrap without an application-role mutation', async () => {
  for (const configured of [true, false]) {
    let queries = 0;
    const result = assertBootstrapPostgresConfiguration({ query: async sql => {
      queries++;
      assert.match(sql, /current_setting\('max_locks_per_transaction'\)='512'/);
      return { rows: [{ configured }] };
    }});
    if (configured) await result;
    else await assert.rejects(result, /FIXTURE_BOOTSTRAP_POSTGRES_CONFIGURATION_REQUIRED/);
    assert.equal(queries, 1);
  }
});
