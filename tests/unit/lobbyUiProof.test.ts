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
  FAVORITE_ACTION,
  FAVORITE_CASES,
  FAVORITE_COMPONENT_PATHS,
  FILTER_ACTION,
  FILTER_FINISH_ACTION,
  FILTER_FINISH_CASES,
  FILTER_FINISH_COMPONENT_PATHS,
  STICKY_TAIL_ACTION,
  STICKY_TAIL_CASES,
  FILTER_CASES,
  FILTER_COMPONENT_PATHS,
  MTT_ENTRIES_ACTION,
  MTT_ENTRIES_CASES,
  MTT_ENTRIES_COMPONENT_PATHS,
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

describe('focused production MTT entries proof', () => {
  const entryReport = () => ({
    suites: [
      {
        specs: MTT_ENTRIES_CASES.map(({ file, title }) => ({
          ...report().suites[0].specs[0],
          file,
          title,
        })),
      },
    ],
  });
  const entryPin = () => ({
    ...pin(),
    action: MTT_ENTRIES_ACTION,
    components: Object.fromEntries(MTT_ENTRIES_COMPONENT_PATHS.map((path) => [path, sha])),
  });
  it('admits only the fixed entry case and pins its counter through cleanup', () => {
    expect(() =>
      admitDispatch(env, { action: MTT_ENTRIES_ACTION, client_payload: {} })
    ).not.toThrow();
    expect(() =>
      admitDispatch(env, { action: MTT_ENTRIES_ACTION, client_payload: { grep: 'other' } })
    ).toThrow();
    expect(assertCases(entryReport(), MTT_ENTRIES_ACTION)).toHaveLength(1);
    const wrong = entryReport();
    wrong.suites[0].specs[0].title = 'unrelated case';
    expect(() => assertCases(wrong, MTT_ENTRIES_ACTION)).toThrow();
    const cleanup = { verified: true, runId: '123' };
    expect(() => assertPins(entryPin(), entryPin(), cleanup, MTT_ENTRIES_ACTION)).not.toThrow();
    const missingCounter = entryPin();
    delete missingCounter.components['src/hooks/useMttLobbyEntryCounts.ts'];
    expect(() => assertPins(entryPin(), missingCounter, cleanup, MTT_ENTRIES_ACTION)).toThrow();
  });
  it('keeps the complete original filter selection and uses the same production account route', async () => {
    const { readFileSync } = await import('node:fs');
    const workflow = readFileSync('.github/workflows/lobby-ui-proof.yml', 'utf8');
    const block = workflow.slice(
      workflow.indexOf('- name: Verify live MTT entries'),
      workflow.indexOf('- name: Verify every lobby filter')
    );
    expect(FILTER_CASES).toHaveLength(9);
    expect(block).toContain("if: github.event.action == 'verify-mtt-entries'");
    expect(block).toContain(
      "--grep 'live MTT entries match committed counts and Buy-In typography$'"
    );
    expect(block).toContain('--project=chromium --workers=1 --retries=0 --trace=off');
    expect(workflow).toContain('cleanupProductionE2EAccount() !== true');
  });
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
  const dispatchTypes = workflow
    .match(/types:\s*\[([\s\S]*?)\]/)?.[1]
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  expect(dispatchTypes).toEqual([
    'verify-lobby-ui',
    'verify-spectator-notifications',
    'verify-tournament-favorites',
    'verify-lobby-filters',
    'verify-lobby-filter-finish',
    STICKY_TAIL_ACTION,
    MTT_ENTRIES_ACTION,
  ]);
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
  const tournamentDoor = journey.slice(
    journey.indexOf('tournamentId = await tournament.getAttribute')
  );
  expect(tournamentDoor).not.toContain('await expect(panel).toHaveCount(1)');
  expect(tournamentDoor).not.toContain("await panel.getByRole('button', { name: 'Details'");
  expect(tournamentDoor.indexOf("page.on('framenavigated', observeRoute)")).toBeLessThan(
    tournamentDoor.indexOf("tournament.getByRole('button', { name: /^Details:/ }).click()")
  );
  expect(journey).toContain("url.searchParams.get('user_id') === `eq.${ownerId}`");
  expect(journey).toContain("document.dispatchEvent(new Event('visibilitychange'))");
  expect(journey).toContain('expect(await refreshed.json()');
  expect(journey).toContain("name: 'Close Lobby', exact: true");
  expect(journey).toContain("name: 'Move Left', exact: true");
  expect(journey).toContain("locator('[data-tabid]').nth(1)");
  expect(journey).toContain("route.abort('blockedbyclient')");
});

describe('closed tournament favorite priority proof', () => {
  const favoriteReport = () => ({
    suites: [
      {
        specs: FAVORITE_CASES.map(({ file, title, project }) => ({
          file,
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
        })),
      },
    ],
  });
  const favoritePin = () => ({
    ...pin(),
    action: FAVORITE_ACTION,
    components: Object.fromEntries(FAVORITE_COMPONENT_PATHS.map((path) => [path, sha])),
  });
  it('admits only its fixed empty request and exactly one Chromium case', () => {
    expect(() => admitDispatch(env, { action: FAVORITE_ACTION, client_payload: {} })).not.toThrow();
    expect(() =>
      admitDispatch(env, { action: FAVORITE_ACTION, client_payload: { grep: 'other' } })
    ).toThrow();
    expect(assertCases(favoriteReport(), FAVORITE_ACTION)).toHaveLength(1);
    expect(() => assertCases(report(), FAVORITE_ACTION)).toThrow();
    for (const change of [
      (r) => r.suites[0].specs.pop(),
      (r) => r.suites[0].specs.push(r.suites[0].specs[0]),
      (r) => (r.suites[0].specs[0].file = 'other.spec.ts'),
      (r) => (r.suites[0].specs[0].tests[0].projectName = 'webkit-footer'),
      (r) => (r.suites[0].specs[0].tests[0].results[0].retry = 1),
      (r) => (r.suites[0].specs[0].tests[0].results[0].status = 'skipped'),
      (r) => (r.errors = ['unhandled failure']),
    ]) {
      const value = favoriteReport();
      change(value);
      expect(() => assertCases(value, FAVORITE_ACTION)).toThrow();
    }
  });
  it('requires the favorite consumer sources, stable publisher and verified own cleanup', () => {
    const cleanup = { verified: true, runId: '123' };
    expect(() => assertPins(favoritePin(), favoritePin(), cleanup, FAVORITE_ACTION)).not.toThrow();
    expect(() => assertPins(pin(), pin(), cleanup, FAVORITE_ACTION)).toThrow();
    for (const path of [
      'src/components/lobby/LobbyTable.tsx',
      'src/components/lobby/tournamentFavoriteOrder.ts',
      'src/pages/ClubHomePage.tsx',
      'src/lib/featuredOnItsDay.ts',
      'src/hooks/usePlayerPreference.ts',
      'src/lib/tableSettingIntents.ts',
    ]) {
      const after = favoritePin();
      delete after.components[path];
      expect(() => assertPins(favoritePin(), after, cleanup, FAVORITE_ACTION)).toThrow();
    }
    expect(() =>
      assertPins(favoritePin(), favoritePin(), { verified: false, runId: '123' }, FAVORITE_ACTION)
    ).toThrow();
    expect(() =>
      assertPins(favoritePin(), favoritePin(), { verified: true, runId: '999' }, FAVORITE_ACTION)
    ).toThrow();
    const advanced = favoritePin();
    advanced.clientSha = 'b'.repeat(40);
    expect(() => assertPins(favoritePin(), advanced, cleanup, FAVORITE_ACTION)).toThrow();
  });
  it('uses the maintained supported browser host and one fixed isolated journey', async () => {
    const { readFileSync } = await import('node:fs');
    const workflow = readFileSync('.github/workflows/lobby-ui-proof.yml', 'utf8');
    expect(workflow).toContain('runs-on: ubuntu-24.04');
    const block = workflow.match(
      /- name: Verify only tournament favorite[\s\S]*?(?=\n {6}- (?:name:|uses:)|$)/
    )?.[0];
    expect(block).toBeTruthy();
    expect(block).toContain("if: github.event.action == 'verify-tournament-favorites'");
    expect(block).toContain(`--grep '${FAVORITE_CASES[0].title}$'`);
    expect(block).toContain('--project=chromium --workers=1 --retries=0 --trace=off');
    expect(block).not.toContain('the selected game list');
    expect(block).not.toContain('spectator');
    expect(workflow).toContain('cleanupProductionE2EAccount() !== true');
    const browser = readFileSync('tests/e2e/production-mobile-lobby-chrome.spec.ts', 'utf8');
    const journey = browser.slice(
      browser.indexOf(`test('${FAVORITE_CASES[0].title}'`),
      browser.indexOf("test('the footer frame")
    );
    for (const contract of [
      // The account's own favorite records, read and saved as the owner.
      'favoritesRead(',
      'favoriteSaveAccepted(response, owner, chosen, enabled)',
      'expect(unstarred.find((row) => row.game_id === chosen)?.active).toBe(false)',
      "'Add To Favorites'",
      "'Remove From Favorites'",
      "chooseSort('Most Players')",
      "chooseSort('Stakes: High To Low')",
      'await page.reload',
      'const persistedResponse = await readback',
      'expect(participation).toEqual([])',
      "route.abort('blockedbyclient')",
    ])
      expect(journey).toContain(contract);
  });
});

describe('closed complete lobby filter proof', () => {
  const filterReport = () => ({
    suites: [
      {
        specs: FILTER_CASES.map(({ file, title, project }) => ({
          file,
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
        })),
      },
    ],
  });
  const filterPin = () => ({
    ...pin(),
    action: FILTER_ACTION,
    components: Object.fromEntries(FILTER_COMPONENT_PATHS.map((path) => [path, sha])),
  });
  it('admits exactly seven tab audits, shared controls and the spectator name journey without caller input', () => {
    expect(() => admitDispatch(env, { action: FILTER_ACTION, client_payload: {} })).not.toThrow();
    expect(() =>
      admitDispatch(env, { action: FILTER_ACTION, client_payload: { type: 'MTT' } })
    ).toThrow();
    expect(assertCases(filterReport(), FILTER_ACTION)).toHaveLength(9);
    for (const change of [
      (r) => r.suites[0].specs.pop(),
      (r) => r.suites[0].specs.push(r.suites[0].specs[0]),
      (r) => (r.suites[0].specs[0].tests[0].results[0].retry = 1),
      (r) => (r.suites[0].specs[0].tests[0].results[0].status = 'skipped'),
      (r) => (r.suites[0].specs[0].tests[0].projectName = 'firefox'),
    ]) {
      const value = filterReport();
      change(value);
      expect(() => assertCases(value, FILTER_ACTION)).toThrow();
    }
  });
  it('requires all filter producers, consumers and sticky art consumers with stable publication', () => {
    const cleanup = { verified: true, runId: '123' };
    expect(() => assertPins(filterPin(), filterPin(), cleanup, FILTER_ACTION)).not.toThrow();
    for (const path of FILTER_COMPONENT_PATHS) {
      const after = filterPin();
      delete after.components[path];
      expect(() => assertPins(filterPin(), after, cleanup, FILTER_ACTION)).toThrow();
    }
    expect(() =>
      assertPins(filterPin(), filterPin(), { verified: false, runId: '123' }, FILTER_ACTION)
    ).toThrow();
    const drift = filterPin();
    drift.publisherRunId = '999';
    expect(() => assertPins(filterPin(), drift, cleanup, FILTER_ACTION)).toThrow();
  });
  it('uses only the fixed live audit file and preserves the original modes', async () => {
    const { readFileSync } = await import('node:fs');
    const workflow = readFileSync('.github/workflows/lobby-ui-proof.yml', 'utf8');
    const block = workflow.slice(
      workflow.indexOf('- name: Verify every lobby filter'),
      workflow.indexOf('- name: Pin the published client after')
    );
    expect(block).toContain("if: github.event.action == 'verify-lobby-filters'");
    expect(block).toContain('tests/e2e/production-lobby-filter-audit.spec.ts');
    expect(block).toContain('tests/e2e/production-player-name-layout.spec.ts');
    expect(block).toContain('--project=chromium --workers=1 --retries=0 --trace=off');
    expect(block).not.toContain('production-mobile-lobby-chrome.spec.ts');
    expect(workflow).toContain('cleanupProductionE2EAccount() !== true');
    for (const mode of ['verify-lobby-ui', RECOVERY_ACTION, FAVORITE_ACTION])
      expect(workflow).toContain(`if: github.event.action == '${mode}'`);
  });
});

describe('closed remaining filter proof', () => {
  const finishReport = () => ({
    suites: [
      {
        specs: FILTER_FINISH_CASES.map(({ file, title, project }) => ({
          file,
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
        })),
      },
    ],
  });
  const finishPin = () => ({
    ...pin(),
    action: FILTER_FINISH_ACTION,
    components: Object.fromEntries(FILTER_FINISH_COMPONENT_PATHS.map((path) => [path, sha])),
  });
  it('runs exactly the three unfinished or visually unqualified journeys and refuses arbitrary selection or incomplete results', () => {
    expect(() =>
      admitDispatch(env, { action: FILTER_FINISH_ACTION, client_payload: {} })
    ).not.toThrow();
    expect(() =>
      admitDispatch(env, { action: FILTER_FINISH_ACTION, client_payload: { grep: 'other' } })
    ).toThrow();
    expect(assertCases(finishReport(), FILTER_FINISH_ACTION)).toHaveLength(3);
    expect(FILTER_CASES).toHaveLength(9);
    for (const alter of [
      (r) => r.suites[0].specs.pop(),
      (r) => r.suites[0].specs.push(r.suites[0].specs[0]),
      (r) => (r.suites[0].specs[0].tests[0].results[0].retry = 1),
      (r) => (r.suites[0].specs[0].tests[0].results[0].status = 'skipped'),
      (r) => (r.suites[0].specs[0].title = FILTER_CASES[0].title),
    ]) {
      const value = finishReport();
      alter(value);
      expect(() => assertCases(value, FILTER_FINISH_ACTION)).toThrow();
    }
  });
  it('retains all runtime pins, stable release identity, and verified cleanup', () => {
    const cleanup = { verified: true, runId: '123' };
    expect(() => assertPins(finishPin(), finishPin(), cleanup, FILTER_FINISH_ACTION)).not.toThrow();
    expect(() =>
      assertPins(
        finishPin(),
        { ...finishPin(), clientSha: 'b'.repeat(40) },
        cleanup,
        FILTER_FINISH_ACTION
      )
    ).toThrow();
    expect(() =>
      assertPins(finishPin(), finishPin(), { ...cleanup, verified: false }, FILTER_FINISH_ACTION)
    ).toThrow();
    expect(FILTER_FINISH_COMPONENT_PATHS).toHaveLength(77);
    for (const path of [
      'src/throwables/AtlasSprite.tsx',
      'src/throwables/atlasUrl.ts',
      'src/throwables/artwork.generated.json',
      'public/images/throwables/animated/rocket.webp',
      'src/pages/TablePage.tsx',
      'src/hooks/useTableArt.ts',
    ]) {
      const missing = finishPin();
      delete missing.components[path];
      expect(() => assertPins(missing, missing, cleanup, FILTER_FINISH_ACTION)).toThrow();
    }
  });
});

describe('closed remaining sticky-tail proof', () => {
  const tailReport = () => ({
    suites: [
      {
        specs: STICKY_TAIL_CASES.map(({ file, title, project }) => ({
          file,
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
        })),
      },
    ],
  });
  const tailPin = () => ({
    ...pin(),
    action: STICKY_TAIL_ACTION,
    components: Object.fromEntries(FILTER_FINISH_COMPONENT_PATHS.map((path) => [path, sha])),
  });
  it('admits only the one unverified tail with complete runtime pins and stable cleanup', () => {
    expect(() =>
      admitDispatch(env, { action: STICKY_TAIL_ACTION, client_payload: {} })
    ).not.toThrow();
    expect(() =>
      admitDispatch(env, { action: STICKY_TAIL_ACTION, client_payload: { grep: 'other' } })
    ).toThrow();
    expect(assertCases(tailReport(), STICKY_TAIL_ACTION)).toHaveLength(1);
    expect(FILTER_CASES).toHaveLength(9);
    expect(FILTER_FINISH_CASES).toHaveLength(3);
    for (const alter of [
      (r) => r.suites[0].specs.pop(),
      (r) => r.suites[0].specs.push(r.suites[0].specs[0]),
      (r) => (r.suites[0].specs[0].tests[0].results[0].retry = 1),
      (r) => (r.suites[0].specs[0].tests[0].results[0].status = 'skipped'),
      (r) => (r.suites[0].specs[0].title = FILTER_CASES[0].title),
    ]) {
      const value = tailReport();
      alter(value);
      expect(() => assertCases(value, STICKY_TAIL_ACTION)).toThrow();
    }
    const cleanup = { verified: true, runId: '123' };
    expect(() => assertPins(tailPin(), tailPin(), cleanup, STICKY_TAIL_ACTION)).not.toThrow();
    for (const field of ['clientSha', 'publisherRunId']) {
      expect(() =>
        assertPins(
          tailPin(),
          { ...tailPin(), [field]: field === 'clientSha' ? 'b'.repeat(40) : '789' },
          cleanup,
          STICKY_TAIL_ACTION
        )
      ).toThrow();
    }
    expect(() =>
      assertPins(tailPin(), tailPin(), { ...cleanup, verified: false }, STICKY_TAIL_ACTION)
    ).toThrow();
    for (const path of FILTER_FINISH_COMPONENT_PATHS) {
      const missing = tailPin();
      delete missing.components[path];
      expect(() => assertPins(missing, missing, cleanup, STICKY_TAIL_ACTION)).toThrow();
    }
  });
  it('keeps one fixed native scroll journey in the protected workflow', async () => {
    const { readFileSync } = await import('node:fs');
    const workflow = readFileSync('.github/workflows/lobby-ui-proof.yml', 'utf8');
    const block = workflow.slice(
      workflow.indexOf('- name: Verify only the remaining cash-family'),
      workflow.indexOf('- name: Pin the published client after')
    );
    expect(block).toContain("if: github.event.action == 'verify-lobby-sticky-tail'");
    expect(block).toContain(
      "--grep 'remaining cash-family and desktop sticky controls stay accessible$'"
    );
    expect(block).toContain('--project=chromium --workers=1 --retries=0 --trace=off');
    expect(block).not.toContain('production-player-name-layout.spec.ts');
    const spec = readFileSync('tests/e2e/production-lobby-filter-audit.spec.ts', 'utf8');
    const helper = spec.slice(
      spec.indexOf('async function assertCashFamilyStickyTail('),
      spec.indexOf("test('remaining cash-family")
    );
    expect(helper).toContain("await h.choose('ALL')");
    expect(helper).toContain('await expect(controls).toBeInViewport()');
    expect(helper).toContain('await expect(rail).toBeHidden()');
    expect(helper).toContain("row.closest('.lobby-table-wrap')?.scrollTop ?? 0");
    const desktop = helper.slice(helper.indexOf('await page.setViewportSize'));
    expect(desktop).toContain(
      '.lobby-table-wrap:visible .lobby-table > tbody > tr.lt-row[data-kind="cash"][data-id]:visible'
    );
    expect(desktop).toContain('await expect.poll(() => desktopRows.count()).toBeGreaterThan(1)');
    expect(desktop).not.toContain('h.rows');
    expect(helper).toContain('.toBeGreaterThan(0)');
    expect(helper).toContain('await assertLobbyControlsInsidePaint(page)');
    expect(helper).toContain('await assertRegistrationInkInsideFrame(page)');
    expect(helper.match(/await assertLobbyControlsInsidePaint\(page\)/g)).toHaveLength(2);
    const paint = spec.slice(
      spec.indexOf('async function assertLobbyControlsInsidePaint('),
      spec.indexOf('/** The native lower glass')
    );
    expect(paint).toContain("machine.dataset.compactLobbyControls === 'true'");
    expect(paint).toContain('expect(families).toHaveLength(0)');
    expect(paint).toContain('expect(families).toHaveLength(2)');
    expect(paint).toContain('.lobby-sticky-filters > button:visible');
    expect(paint).toContain('.toBeGreaterThanOrEqual(2)');
    expect(helper).not.toContain('dispatchEvent');
  });
});
