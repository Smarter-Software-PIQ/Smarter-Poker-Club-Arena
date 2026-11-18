import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  admitDispatch,
  assertCases,
  assertPins,
  CASES,
  COMPONENT_PATHS,
} from '../../scripts/verification-harness/cashier-ui-proof.mjs';
const sha = 'a'.repeat(40);
const env = {
  GITHUB_EVENT_NAME: 'repository_dispatch',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_REPOSITORY_ID: '1132369872',
  GITHUB_SHA: sha,
  PROOF_RUN_ID: '123',
  GITHUB_REPOSITORY: 'Smarter-Software-PIQ/Smarter-Poker-Club-Arena',
};
const event = { action: 'verify-cashier-ui', client_payload: {} };
const report = () => ({
  suites: [
    {
      file: 'production-cashier.spec.ts',
      specs: CASES.map((title) => ({
        title,
        ok: true,
        tests: [
          {
            projectName: 'chromium',
            status: 'expected',
            expectedStatus: 'passed',
            results: [{ status: 'passed', retry: 0 }],
          },
        ],
      })),
    },
  ],
});
const pin = () => ({
  schema: 1,
  clientSha: sha,
  verificationSha: sha,
  runId: '123',
  publisherRunId: '456',
  publisherVerified: true,
  endpoints: ['https://ca-static.smarter.poker', 'https://smarter.poker/hub/club-arena'].map(
    (origin) => ({ origin, clientSha: sha, publisherRunId: '456' })
  ),
  components: Object.fromEntries(COMPONENT_PATHS.map((p) => [p, sha])),
});
describe('closed scoped cashier proof', () => {
  it('admits only the fixed protected dispatch', () => {
    expect(() => admitDispatch(env, event)).not.toThrow();
    for (const changed of [
      { GITHUB_EVENT_NAME: 'workflow_dispatch' },
      { GITHUB_REF: 'refs/heads/other' },
      { GITHUB_REPOSITORY_ID: '1' },
      { GITHUB_SHA: 'bad' },
      { PROOF_RUN_ID: '' },
    ])
      expect(() => admitDispatch({ ...env, ...changed }, event)).toThrow();
    for (const payload of [null, [], { grep: 'anything' }])
      expect(() => admitDispatch(env, { ...event, client_payload: payload })).toThrow();
  });
  it('requires exactly all scoped cases once with no skips or retries', () => {
    expect(assertCases(report())).toHaveLength(3);
    for (const change of [
      (r) => r.suites[0].specs.pop(),
      (r) => r.suites[0].specs.push(r.suites[0].specs[0]),
      (r) => (r.errors = ['failure']),
      (r) => (r.suites[0].specs[0].tests[0].results[0].retry = 1),
      (r) => (r.suites[0].specs[0].tests[0].results[0].status = 'skipped'),
      (r) => (r.suites[0].specs[0].tests[0].projectName = 'firefox'),
    ]) {
      const value = report();
      change(value);
      expect(() => assertCases(value)).toThrow();
    }
  });
  it('requires stable two-origin publisher provenance and verified own cleanup', () => {
    expect(() => assertPins(pin(), pin(), { verified: true, runId: '123' })).not.toThrow();
    for (const change of [
      (p) => (p.clientSha = 'b'.repeat(40)),
      (p) => (p.publisherVerified = false),
      (p) => p.endpoints.pop(),
      (p) => (p.components = {}),
      (p) => (p.runId = '999'),
    ]) {
      const after = pin();
      change(after);
      expect(() => assertPins(pin(), after, { verified: true, runId: '123' })).toThrow();
    }
    expect(() => assertPins(pin(), pin(), { verified: true, runId: '999' })).toThrow();
    expect(() => assertPins(pin(), pin(), { verified: false, runId: '123' })).toThrow();
  });
});

it('binds a personal claim preview to the authenticated roster identity', () => {
  const browser = readFileSync('tests/e2e/production-cashier.spec.ts', 'utf8');
  const claim = browser.slice(browser.indexOf("test('offers reclaim return wallets"));
  expect(claim).toContain("pathname.endsWith('/rpc/fn_club_cashier_members')");
  expect(claim).toContain('row.user_id === ownerId');
  expect(claim).toContain('expect(ownRows).toHaveLength(1)');
  expect(claim).toContain('expect(ownWalletRows[0].user_id).toBe(ownerId)');
  expect(claim).toContain('JSON.stringify([ownerId])');
  expect(claim).toContain('My Account|${escapedName}');
  expect(claim).not.toContain("toContainText('My Account')");
});

it('admits only the fixed ECO profile without accepting caller-controlled tests or URLs', () => {
  expect(() =>
    admitDispatch(env, { ...event, client_payload: { eco_components: true } })
  ).not.toThrow();
  for (const payload of [
    { eco_components: false },
    { eco_components: true, url: 'foreign' },
    { eco_components: 'true' },
  ])
    expect(() => admitDispatch(env, { ...event, client_payload: payload })).toThrow();
});

it('requires one exact ECO browser case and its own complete component provenance', async () => {
  const { ECO_CASE, ECO_COMPONENT_PATHS, readEcoIdentity } =
    await import('../../scripts/verification-harness/cashier-ui-proof.mjs');
  const value = report();
  value.suites[0].file = 'production-union-eco.spec.ts';
  value.suites[0].specs = [value.suites[0].specs[0]];
  value.suites[0].specs[0].title = ECO_CASE;
  expect(assertCases(value, true)).toEqual([ECO_CASE]);
  const before = {
    ...pin(),
    profile: 'union-eco',
    components: Object.fromEntries(ECO_COMPONENT_PATHS.map((p) => [p, sha])),
  };
  expect(() => assertPins(before, before, null, true)).not.toThrow();
  expect(() => assertPins(before, before, { verified: true, runId: '123' }, true)).toThrow();
  expect(() => assertPins(pin(), pin(), null, true)).toThrow();
  const environment = {
    SUPABASE_URL: 'https://kuklfnapbkmacvwxktbh.supabase.co',
    VITE_SUPABASE_ANON_KEY: 'test-public-key',
    SP_EMAIL: 'daniel@smarter.poker',
    SP_PASS: 'test-only',
  };
  const session = {
    access_token: 'memory-only',
    user: { id: 'test-owner', email: 'daniel@smarter.poker' },
  };
  const union = {
    owner_id: 'test-owner',
    settings: {
      eco_cash_enabled: true,
      eco_cash_rate: 0.1,
      eco_tournament_enabled: true,
      eco_tournament_rate: 0.1,
    },
  };
  const requests = [];
  const transport = (rows) => async (url, options) => {
    requests.push([url, options.method || 'GET']);
    return {
      ok: true,
      json: async () =>
        url.includes('/auth/')
          ? session
          : url.includes('/profiles?')
            ? [{ role: 'God' }]
            : url.includes('/rpc/ca_can_oversee_union')
              ? true
              : rows,
    };
  };
  expect(await readEcoIdentity({ environment, fetchImpl: transport([union]) })).toEqual({
    session,
    ownerSettingsAuthorized: true,
    configuredTermsConfirmed: true,
  });
  expect(requests.map((r) => r[1])).toEqual(['POST', 'GET', 'POST', 'GET']);
  const beforePersonal = requests.length;
  await expect(
    readEcoIdentity({
      environment: { ...environment, SP_EMAIL: 'personal@example.invalid' },
      fetchImpl: transport([union]),
    })
  ).rejects.toThrow(/canonical/);
  expect(requests.length).toBe(beforePersonal);
  await expect(
    readEcoIdentity({
      environment,
      fetchImpl: async (url) => ({
        ok: true,
        json: async () => (url.includes('/auth/') ? session : [{ role: 'owner' }]),
      }),
    })
  ).rejects.toThrow(/God role/);
  expect(
    (
      await readEcoIdentity({
        environment,
        fetchImpl: transport([{ ...union, owner_id: 'foreign' }]),
      })
    ).ownerSettingsAuthorized
  ).toBe(false);
  expect(
    (await readEcoIdentity({ environment, fetchImpl: transport([{ ...union, settings: {} }]) }))
      .configuredTermsConfirmed
  ).toBe(false);
  await expect(
    readEcoIdentity({
      environment,
      fetchImpl: async (url) => ({
        ok: true,
        json: async () =>
          url.includes('/auth/') ? session : url.includes('/profiles?') ? [{ role: 'God' }] : false,
      }),
    })
  ).rejects.toThrow(/unauthorized/);
  const { ecoProofScope } = await import('../../scripts/verification-harness/cashier-ui-proof.mjs');
  expect(
    ecoProofScope({ authorized: true, ownerControls: false, configuredTermsConfirmed: true })
  ).toEqual({ verdict: 'partial', boardVerified: true, ownerSettingsVerified: false });
  expect(() =>
    ecoProofScope({ authorized: false, ownerControls: true, configuredTermsConfirmed: true })
  ).toThrow();
});

it('keeps the ECO case read only and excludes private browser data from retained artifacts', () => {
  const workflow = readFileSync('.github/workflows/cashier-ui-proof.yml', 'utf8');
  const eco = workflow.slice(workflow.indexOf('  union-eco:'));
  expect(eco).toContain('secrets.SP_EMAIL');
  expect(eco).toContain('eco-preflight');
  expect(eco).not.toContain('production-e2e-account');
  expect(eco).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
  expect(eco).not.toMatch(/path:[\s\S]*(report\.json|\.png|error-context|browser\.log)/);
  const browser = readFileSync('tests/e2e/production-union-eco.spec.ts', 'utf8');
  expect(browser).not.toContain('test.skip');
  expect(browser).not.toContain('Save Settings');
  expect(browser).toContain('mutationAttempted');
  expect(browser).toContain('page.reload');
});
