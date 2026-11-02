import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
// Import the actual full private-controls dependency closure, not a copied stub.
import * as preflightModule from '../../native/schema-preflight.mjs';
const { assertPreflightParity } = preflightModule;
import { requireFixtureSchemaMode } from '../runtime-files.mjs';

const template = {
  source_contract: {
    current_database_contract_ready: false,
    exclusions: ['native-preflight-pending'],
  },
};
const payload = {
  encoding: 'postgres-jsonb-text-sha256/v1',
  catalogue_digest: 'a'.repeat(64),
  catalogue_text: '{"complete": true}',
};
const roles = {
  scope: 'password-free-role-catalogue',
  contains_passwords_or_user_rows: false,
  roles: [{ name: 'ordinary', superuser: false }],
  memberships: [],
  default_acl: [],
  role_settings: [],
};
const valid = {
  expected: payload,
  observed: payload,
  expectedRoles: roles,
  observedRoles: roles,
  template,
};

test('only fixed no-game preflight admits a false schema; ordinary start refuses every incomplete form', () => {
  requireFixtureSchemaMode(template, true);
  assert.throws(() => requireFixtureSchemaMode(template));
  requireFixtureSchemaMode({
    source_contract: { current_database_contract_ready: true, exclusions: [] },
  });
  assert.throws(() =>
    requireFixtureSchemaMode({
      source_contract: { current_database_contract_ready: true, exclusions: ['missing-ACL'] },
    })
  );
  assert.throws(() =>
    requireFixtureSchemaMode(
      { source_contract: { current_database_contract_ready: false, exclusions: [] } },
      true
    )
  );
  assert.throws(() =>
    requireFixtureSchemaMode(
      { source_contract: { current_database_contract_ready: true, exclusions: [] } },
      true
    )
  );
});

test('preflight compares the full expected PG catalogue and every role/settings/default ACL fact', () => {
  assertPreflightParity(valid);
  for (const changed of [
    { observed: { ...payload, catalogue_digest: 'b'.repeat(64) } },
    { observed: { ...payload, catalogue_text: '{"omitted": true}' } },
    { observed: { ...payload, encoding: 'other' } },
    { observedRoles: { ...roles, roles: [...roles.roles, { name: 'extra' }] } },
    { observedRoles: { ...roles, memberships: [{ role: 'elevated', member: 'ordinary' }] } },
    { observedRoles: { ...roles, default_acl: [{ creator: 'ordinary', privilege: 'ALL' }] } },
    { observedRoles: { ...roles, role_settings: [{ key: 'statement_timeout', value: '0' }] } },
    { template: { source_contract: { current_database_contract_ready: true, exclusions: [] } } },
  ])
    assert.throws(() => assertPreflightParity({ ...valid, ...changed }));
});

// Wiring enforcement only: actual PostgreSQL canonical mapping and full restore
// remain required in the protected native operation, never supplied by doubles.
test('preflight derives public-only expected restoration before reading native state and exports no private rows', async () => {
  const source = await readFile(new URL('../../native/schema-preflight.mjs', import.meta.url), 'utf8');
  assert.ok(source.includes("../fixture/schema-catalogue-restore-map.mjs"));
  assert.ok(source.indexOf('await buildCatalogueRestorePlan(db, expected)') < source.indexOf('await schemaCataloguePayload(db)'));
  assert.ok(source.includes('expected: restoredExpected'));
  assert.ok(source.includes('catalogue_text: restoration.expected_catalogue_text'));
  assert.ok(source.includes('catalogue_digest: restoration.expected_catalogue_digest'));
  assert.ok(source.includes('original_catalogue_digest: expected.catalogue_digest'));
  assert.ok(source.includes('catalogue_restore_mapping: restoration.mapping.public_receipt'));
  assert.ok(!source.includes('catalogue_restore_mapping: restoration.mapping,'));
  const controller = await readFile(new URL('../../native/observe-connected-ui.py', import.meta.url), 'utf8');
  assert.ok(controller.includes("'operations/release/fixture/schema-catalogue-restore-map.mjs'"));
  assert.ok(controller.includes("'catalogue_digest': restored_digest"));
  assert.ok(controller.includes("report['catalogue_restore_mapping'] = restore_mapping"));
});

const phases = ['catalogue-inputs', 'catalogue-restore-map', 'catalogue-snapshot', 'role-snapshot',
  'catalogue-parity', 'auth-platform-helpers', 'cron-catalogue', 'auth-write-denial', 'auth-start',
  'auth-ready', 'auth-users', 'auth-mfa', 'canonical-signup', 'postgrest-start',
  'postgrest-own-profile', 'empty-game-state', 'healthy'];

// Execute the maintained pipeline body verbatim. Only its fixed imported
// boundaries are substituted; no alternate pipeline, SQL or production option.
async function pipelineHarness(failAt = null, checkStage = true) {
  const source = await readFile(new URL('../../native/schema-preflight.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('export async function preflightSchema(');
  assert.ok(start > 0);
  const seen = [], calls = [];
  const failure = new Error('private-boundary-canary');
  const boundary = (name, value) => {
    if (checkStage) assert.equal(seen.at(-1), name, `phase must precede ${name}`);
    calls.push(name);
    if (failAt === name) throw failure;
    return value;
  };
  const users = Array.from({length: 3}, (_, i) => ({id: `actor-${i}`, session: {access_token: `token-${i}`}}));
  const dependencies = {
    assert,
    readFile: async (path) => boundary('catalogue-inputs', JSON.stringify(path.endsWith('role-catalogue.json') ? roles : payload)),
    buildCatalogueRestorePlan: async (_db, original) => {
      assert.deepEqual(original, payload);
      return boundary('catalogue-restore-map', {expected_catalogue_text: payload.catalogue_text,
        expected_catalogue_digest: payload.catalogue_digest, mapping: {public_receipt: {rule: 'public-only'}}});
    },
    schemaCataloguePayload: async () => boundary('catalogue-snapshot', payload),
    captureRoleCatalogue: async () => boundary('role-snapshot', roles),
    assertPreflightParity: (value) => { boundary('catalogue-parity'); assertPreflightParity(value); },
    assertFixtureAuthPlatformHelpers: async () => boundary('auth-platform-helpers'),
    assertFixtureCronCatalog: async () => boundary('cron-catalogue'),
    assertFixtureAuthPlatformWriteDenied: async () => boundary('auth-write-denial'),
    assertCanonicalSignup: async (_db, ids) => { assert.deepEqual(ids, users.map(u => u.id)); return boundary('canonical-signup', {users: 3}); },
    fetch: async (url) => url.includes(':9999/')
      ? boundary('auth-ready', {ok: true})
      : boundary('postgrest-own-profile', {ok: true, json: async () => [{id: users[0].id}]}),
  };
  const run = new Function(...Object.keys(dependencies), source.slice(start).replace('export async function', 'return async function'))(...Object.values(dependencies));
  const options = {
    db: {query: async () => boundary('empty-game-state', {rows: [{clubs: 0, tables: 0, seats: 0, chip_ledger: 0}]})},
    supervisor: {abort: new AbortController(),
      start: async (name) => boundary(name === 'auth' ? 'auth-start' : 'postgrest-start'),
      until: async (callback) => { assert.equal(await callback(), true); },
      assertHealthy: () => boundary('healthy')},
    env: {auth: {}, rest: {}},
    api: {createUsers: async () => boundary('auth-users', users),
      enrollMfa: async (user) => boundary('auth-mfa', user)},
    template, applicationOwner: {unchanged: true},
    onStage: (...args) => { assert.equal(args.length, 1); assert.ok(phases.includes(args[0])); seen.push(args[0]); },
  };
  return {run, options, seen, calls, failure};
}
test('fixed phase enumeration and maintained pipeline preserve all ordered boundaries', async () => {
  assert.deepEqual(preflightModule.SCHEMA_PREFLIGHT_STAGES, phases);
  assert.ok(Object.isFrozen(preflightModule.SCHEMA_PREFLIGHT_STAGES));
  const h = await pipelineHarness();
  const result = await h.run(h.options);
  assert.deepEqual(h.seen, phases);
  assert.equal(result.current_database_contract_ready, true);
  assert.equal(result.product_certificate, false);
  assert.equal(result.catalogue_digest, payload.catalogue_digest);
  assert.deepEqual(result.application_owner, h.options.applicationOwner);
});
test('first actual boundary failure retains exact error and stops at its fixed phase without error payload callbacks', async () => {
  for (const phase of phases) {
    const h = await pipelineHarness(phase);
    await assert.rejects(h.run(h.options), error => error === h.failure);
    assert.deepEqual(h.seen, phases.slice(0, phases.indexOf(phase) + 1));
    assert.equal(h.calls.at(-1), phase);
    assert.ok(!JSON.stringify(h.seen).includes('private-boundary-canary'));
  }
});

test('optional callback defaults to no-op without changing preflight success', async () => {
  const h = await pipelineHarness(null, false);
  delete h.options.onStage;
  const result = await h.run(h.options);
  assert.equal(result.success, true);
  assert.equal(result.product_certificate, false);
  assert.deepEqual(h.seen, []);
  assert.deepEqual(h.calls, [phases[0], ...phases]);
});
test('a refusing diagnostic callback stops before the first imported boundary and propagates unchanged', async () => {
  const h = await pipelineHarness();
  h.options.onStage = () => { throw h.failure; };
  await assert.rejects(h.run(h.options), error => error === h.failure);
  assert.deepEqual(h.calls, []);
});
