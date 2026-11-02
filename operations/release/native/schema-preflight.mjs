import { recordCatalogueParityFailure } from '../fixture/runtime-files.mjs';
// A fixed, no-game admission preflight. It cannot start an engine or issue a
// product certificate. Candidate readiness stays false until all real facts pass.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { schemaCataloguePayload } from './component-semantic-observations.mjs';
import { captureRoleCatalogue } from '../fixture/schema-snapshot.mjs';
import { buildCatalogueRestorePlan } from '../fixture/schema-catalogue-restore-map.mjs';
import { assertFixtureCronCatalog } from '../fixture/cron-provider.mjs';
import { assertCanonicalSignup } from '../fixture/auth-bootstrap-proof.mjs';
import {
  assertFixtureAuthPlatformHelpers,
  assertFixtureAuthPlatformWriteDenied,
} from '../fixture/service-role-boundary.mjs';

export const SCHEMA_PREFLIGHT_STAGES = Object.freeze([
  'catalogue-inputs', 'catalogue-restore-map', 'catalogue-snapshot', 'role-snapshot',
  'catalogue-parity', 'auth-platform-helpers', 'cron-catalogue', 'auth-write-denial',
  'auth-start', 'auth-ready', 'auth-users', 'auth-mfa', 'canonical-signup',
  'postgrest-start', 'postgrest-own-profile', 'empty-game-state', 'healthy',
]);

const normalized = (value) => {
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, normalized(value[key])])
    );
  return value;
};
export function assertPreflightParity({
  expected,
  observed,
  expectedRoles,
  observedRoles,
  template,
  recordParityFailure = recordCatalogueParityFailure,
}) {
  let gate = 'template-ready';
  try {
    gate = 'template-ready';
    assert.equal(template.source_contract.current_database_contract_ready, false);
    gate = 'template-exclusions';
    assert.deepEqual(template.source_contract.exclusions, ['native-preflight-pending']);
    gate = 'expected-encoding';
    assert.equal(expected.encoding, 'postgres-jsonb-text-sha256/v1');
    gate = 'observed-encoding';
    assert.equal(observed.encoding, expected.encoding);
    gate = 'catalogue-digest';
    assert.equal(observed.catalogue_digest, expected.catalogue_digest);
    // Full exact PG encoding is compared too. No managed schema, extra role,
    // default/effective ACL or object is silently discarded from either side.
    gate = 'catalogue-text';
    assert.equal(observed.catalogue_text, expected.catalogue_text);
    gate = 'role-scope';
    assert.equal(expectedRoles.scope, 'password-free-role-catalogue');
    gate = 'role-safety';
    assert.equal(expectedRoles.contains_passwords_or_user_rows, false);
    gate = 'role-catalogue';
    assert.deepEqual(normalized(observedRoles), normalized(expectedRoles));
  } catch (error) {
    try { recordParityFailure(error, gate, {expected, observed, expectedRoles, observedRoles}); }
    catch { /* Diagnostic failure never replaces the original assertion. */ }
    throw error;
  }
}

export async function preflightSchema({ db, supervisor, env, api, template, applicationOwner, recordParityFailure, onStage = () => {} }) {
  onStage('catalogue-inputs');
  const expected = JSON.parse(await readFile('/inputs/production-catalogue.json', 'utf8'));
  const expectedRoles = JSON.parse(await readFile('/inputs/role-catalogue.json', 'utf8'));
  // Derive the sole public-only physical-slot adapter from ORIGINAL bytes,
  // before reading the actual restored catalogue. Auth ordinals remain exact.
  onStage('catalogue-restore-map');
  const restoration = await buildCatalogueRestorePlan(db, expected);
  const restoredExpected = { ...expected,
    catalogue_text: restoration.expected_catalogue_text,
    catalogue_digest: restoration.expected_catalogue_digest };
  onStage('catalogue-snapshot');
  const observed = await schemaCataloguePayload(db);
  onStage('role-snapshot');
  const observedRoles = await captureRoleCatalogue(db);
  onStage('catalogue-parity');
  assertPreflightParity({ expected: restoredExpected, observed, expectedRoles, observedRoles, template, recordParityFailure });
  onStage('auth-platform-helpers');
  await assertFixtureAuthPlatformHelpers(db);
  onStage('cron-catalogue');
  await assertFixtureCronCatalog(db);
  onStage('auth-write-denial');
  await assertFixtureAuthPlatformWriteDenied(db);
  onStage('auth-start');
  await supervisor.start('auth', '/usr/local/bin/auth', ['serve'], env.auth);
  onStage('auth-ready');
  await supervisor.until(async () => {
    const response = await fetch('http://127.0.0.1:9999/health', {
      signal: supervisor.abort.signal,
    });
    return response.ok;
  });
  onStage('auth-users');
  const users = await api.createUsers();
  onStage('auth-mfa');
  users[2] = await api.enrollMfa(users[2]);
  onStage('canonical-signup');
  const signup = await assertCanonicalSignup(
    db,
    users.map((user) => user.id)
  );
  onStage('postgrest-start');
  await supervisor.start('postgrest', '/usr/local/bin/postgrest', [], env.rest);
  onStage('postgrest-own-profile');
  await supervisor.until(async () => {
    const response = await fetch('http://127.0.0.1:3000/profiles?select=id&id=eq.' + users[0].id, {
      headers: { authorization: 'Bearer ' + users[0].session.access_token },
      signal: supervisor.abort.signal,
    });
    if (!response.ok) return false;
    const rows = await response.json();
    assert.deepEqual(rows, [{ id: users[0].id }]);
    return true;
  });
  onStage('empty-game-state');
  const empty = (
    await db.query(`SELECT
    (SELECT count(*)::int FROM public.clubs) AS clubs,
    (SELECT count(*)::int FROM public.tables) AS tables,
    (SELECT count(*)::int FROM public.table_seats) AS seats,
    (SELECT count(*)::int FROM public.chip_ledger) AS chip_ledger`)
  ).rows[0];
  assert.deepEqual(empty, { clubs: 0, tables: 0, seats: 0, chip_ledger: 0 });
  onStage('healthy');
  supervisor.assertHealthy();
  return {
    version: 1,
    scope: 'isolated-full-schema-preflight',
    product_certificate: false,
    success: true,
    catalogue_digest: observed.catalogue_digest,
    original_catalogue_digest: expected.catalogue_digest,
    // Private changed_rows never leave this process or enter a public receipt.
    catalogue_restore_mapping: restoration.mapping.public_receipt,
    role_catalogue_equal: true,
    effective_acl_catalogue_equal: true,
    current_database_contract_ready: true,
    ordinary_auth: { users: 3, mfa: true, canonical_signup: signup, postgrest_own_profile: true },
    application_owner: applicationOwner,
    no_game_or_club_created: true,
    cleanup: { complete: false, owner: 'outer-native-driver' },
  };
}
