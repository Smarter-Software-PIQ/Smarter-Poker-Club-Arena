import { describe, expect, it } from 'vitest';
import {
  admitDispatch,
  assertCases,
  assertPins,
  CASES,
  CASE_PAIRS,
  COMPONENT_PATHS,
  RECOVERY_ACTION,
  RECOVERY_CASES,
  RECOVERY_COMPONENT_PATHS,
} from '../../scripts/verification-harness/lobby-ui-proof.mjs';
const sha = 'a'.repeat(40);
const env = {
  GITHUB_EVENT_NAME: 'repository_dispatch',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_REPOSITORY_ID: '1132369872',
  GITHUB_SHA: sha,
  PROOF_RUN_ID: '123',
  GITHUB_REPOSITORY: 'Smarter-Software-PIQ/Smarter-Poker-Club-Arena',
};
const event = { action: 'verify-lobby-ui', client_payload: {} };
const report = () => ({
  suites: [
    {
      specs: CASE_PAIRS.map(([file, title]) => ({
        file,
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
describe('closed scoped lobby proof', () => {
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
    expect(() => admitDispatch(env, { ...event, action: 'verify-cashier-ui' })).toThrow();
    for (const payload of [null, [], { grep: 'anything' }])
      expect(() => admitDispatch(env, { ...event, client_payload: payload })).toThrow();
  });
  it('requires exactly three file and title pairs once with no skips or retries', () => {
    expect(assertCases(report())).toHaveLength(3);
    for (const change of [
      (r) => r.suites[0].specs.pop(),
      (r) => r.suites[0].specs.push(r.suites[0].specs[0]),
      (r) => (r.errors = ['failure']),
      (r) => (r.suites[0].specs[0].file = 'other.spec.ts'),
      (r) => (r.suites[0].specs[0].file = 'production-row-channel-owners.spec.ts'),
      (r) => (r.suites[0].specs[2].file = 'production-mobile-lobby-chrome.spec.ts'),
      (r) => r.suites[0].specs.push({ ...r.suites[0].specs[0], title: 'unrelated case' }),
      (r) => (r.suites[0].specs[0].tests[0].annotations = [{ type: 'skip' }]),
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
      (p) => (p.publisherRunId = '999'),
      (p) => (p.verificationSha = 'b'.repeat(40)),
      (p) => (p.endpoints[0].clientSha = 'b'.repeat(40)),
    ]) {
      const after = pin();
      change(after);
      expect(() => assertPins(pin(), after, { verified: true, runId: '123' })).toThrow();
    }
    expect(() => assertPins(pin(), pin(), { verified: true, runId: '999' })).toThrow();
    expect(() => assertPins(pin(), pin(), { verified: false, runId: '123' })).toThrow();
  });
});

describe('closed spectator and notification recovery proof', () => {
  const recoveryReport = () => ({
    suites: RECOVERY_CASES.map(({ file, title, project }) => ({
      file,
      specs: [
        {
          title,
          ok: true,
          tests: [
            {
              projectName: project,
              status: 'expected',
              expectedStatus: 'passed',
              results: [{ status: 'passed', retry: 0 }],
            },
          ],
        },
      ],
    })),
  });
  const recoveryPin = () => ({
    ...pin(),
    action: RECOVERY_ACTION,
    components: Object.fromEntries(RECOVERY_COMPONENT_PATHS.map((path) => [path, sha])),
  });
  it('admits only the closed action with no caller-selected input', () => {
    expect(() => admitDispatch(env, { action: RECOVERY_ACTION, client_payload: {} })).not.toThrow();
    expect(() =>
      admitDispatch(env, { action: RECOVERY_ACTION, client_payload: { project: 'chromium' } })
    ).toThrow();
  });
  it('requires precisely the original Chromium spectator and WebKit reconnect cases once', () => {
    expect(assertCases(recoveryReport(), RECOVERY_ACTION)).toHaveLength(2);
    expect(() => assertCases(report(), RECOVERY_ACTION)).toThrow();
    for (const change of [
      (r) => r.suites.pop(),
      (r) => r.suites.push(r.suites[0]),
      (r) => (r.suites[1].specs[0].tests[0].projectName = 'chromium'),
      (r) => (r.suites[0].specs[0].tests[0].results[0].retry = 1),
      (r) => (r.suites[1].specs[0].tests[0].results[0].status = 'skipped'),
    ]) {
      const value = recoveryReport();
      change(value);
      expect(() => assertCases(value, RECOVERY_ACTION)).toThrow();
    }
  });
  it('binds the new action and preference source to stable provenance and cleanup', () => {
    const cleanup = { verified: true, runId: '123' };
    expect(() => assertPins(recoveryPin(), recoveryPin(), cleanup, RECOVERY_ACTION)).not.toThrow();
    expect(() => assertPins(pin(), pin(), cleanup, RECOVERY_ACTION)).toThrow();
    const after = recoveryPin();
    delete after.components['src/hooks/usePlayerPreference.ts'];
    expect(() => assertPins(recoveryPin(), after, cleanup, RECOVERY_ACTION)).toThrow();
    expect(() =>
      assertPins(recoveryPin(), recoveryPin(), { verified: false, runId: '123' }, RECOVERY_ACTION)
    ).toThrow();
  });
});

it('keeps each closed mode limited to its owned browser journeys with cleanup', async () => {
  const { readFileSync } = await import('node:fs');
  const workflow = readFileSync('.github/workflows/lobby-ui-proof.yml', 'utf8');
  expect(workflow).toContain('types: [verify-lobby-ui, verify-spectator-notifications]');
  expect(workflow).toContain('npx playwright install --with-deps chromium webkit');
  expect(readFileSync('tests/e2e/production-mobile-lobby-chrome.spec.ts', 'utf8')).toContain(
    "...devices['iPhone 13']"
  );
  expect(workflow).not.toContain('workflow_dispatch:');
  expect(workflow).not.toContain('schedule:');
  expect(workflow).not.toContain('client_payload.');
  expect(workflow).toContain('node scripts/ci/await-certification-cleanup-safety.mjs');
  expect(workflow).toContain('cleanupProductionE2EAccount() !== true');
  expect(workflow).toContain('--workers=1 --retries=0 --trace=off');
  for (const title of CASES) expect(workflow).toContain(title);
  for (const { title, file } of RECOVERY_CASES) {
    expect(workflow).toContain(title);
    expect(workflow).toContain(file);
  }
  expect(workflow).toContain("if: github.event.action == 'verify-lobby-ui'");
  expect(workflow).toContain("if: github.event.action == 'verify-spectator-notifications'");
  expect(workflow).toContain('tests/e2e/production-row-channel-owners.spec.ts');
  expect(workflow).toContain('timeout-minutes: 12');
  expect(COMPONENT_PATHS).toContain('src/hooks/useMasterBusChannel.ts');
  expect(COMPONENT_PATHS).toContain('src/core/MasterBus.ts');
  const browser = readFileSync('tests/e2e/production-mobile-lobby-chrome.spec.ts', 'utf8');
  const journey = browser.slice(
    browser.indexOf("test('tournament Details stays inside"),
    browser.indexOf("test('the footer frame")
  );
  expect(journey).toContain("url.searchParams.get('user_id') === `eq.${ownerId}`");
  expect(journey).toContain("document.dispatchEvent(new Event('visibilitychange'))");
  expect(journey).toContain('expect(await refreshed.json()');
  expect(journey).toContain("name: 'Close Lobby', exact: true");
  expect(journey).toContain("name: 'Move Left', exact: true");
  expect(journey).toContain("locator('[data-tabid]').nth(1)");
  expect(journey).toContain("route.abort('blockedbyclient')");
});
