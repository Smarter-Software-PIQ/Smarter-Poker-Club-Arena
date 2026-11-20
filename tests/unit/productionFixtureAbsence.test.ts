import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { classifyFixtureAbsence } from '../../scripts/ci/classify-fixture-absence.mjs';
import { decide, readVerdict } from '../../scripts/ci/record-post-deploy-verdict.mjs';
import {
  FIXTURE_ABSENCE_UNPROVEN,
  PRODUCTION_LACKS_FIXTURE,
  SELECTOR_MISSED_FIXTURE,
  ProductionLacksFixture,
  catalogueFromLobbyRows,
  catalogueFromServiceRows,
  fixtureKind,
  missingFixtureError,
  proveCashSubjectAbsence,
  proveFixtureAbsence,
  proveSeatMoveDestinationAbsence,
  selectSeatMoveDestinations,
  type CatalogueTable,
  type FixtureRequirement,
} from '../e2e/support/productionFixture';

const ROOT = resolve(__dirname, '../..');
const CLASSIFY_SCRIPT = join(ROOT, 'scripts/ci/classify-fixture-absence.mjs');
const LIVE_COVERAGE_SCRIPT = join(ROOT, 'scripts/ci/live-table-certificate-coverage.mjs');

function makeReport(
  tests: Array<{
    title: string;
    status: string;
    results?: Array<{ status: string; errors?: Array<{ message?: string; value?: string }> }>;
  }>,
  extra: Record<string, unknown> = {}
) {
  return {
    errors: [],
    suites: [
      {
        specs: tests.map((t) => ({
          title: t.title,
          tests: [{ status: t.status, results: t.results ?? [] }],
        })),
      },
    ],
    ...extra,
  };
}

describe('classify-fixture-absence.mjs', () => {
  it('returns pass when no tests failed', () => {
    const report = makeReport([
      { title: 'green spec', status: 'expected', results: [{ status: 'passed' }] },
      { title: 'skipped spec', status: 'skipped', results: [{ status: 'skipped' }] },
    ]);
    expect(classifyFixtureAbsence(report)).toEqual({
      verdict: 'pass',
      reason: 'nothing failed',
      kinds: [],
      failures: [],
    });
  });

  it('returns non-verdict when every failed test failed once solely on PRODUCTION_LACKS_FIXTURE', () => {
    const report = makeReport([
      {
        title: 'nine-seat layout proof',
        status: 'unexpected',
        results: [
          {
            status: 'failed',
            errors: [
              {
                message:
                  'Error: PRODUCTION_LACKS_FIXTURE cash/9-seat/2+seated/running: the tables catalogue lists no cash/9-seat/2+seated/running table',
              },
            ],
          },
        ],
      },
      {
        title: 'seat-move notice proof',
        status: 'unexpected',
        results: [
          {
            status: 'failed',
            errors: [
              {
                message:
                  'ProductionLacksFixture: PRODUCTION_LACKS_FIXTURE cash/second-destination-table: only 1 named table',
              },
            ],
          },
        ],
      },
    ]);
    const res = classifyFixtureAbsence(report);
    expect(res.verdict).toBe('non-verdict');
    expect(res.kinds).toEqual(['cash/9-seat/2+seated/running', 'cash/second-destination-table']);
    expect(res.failures).toEqual(['nine-seat layout proof', 'seat-move notice proof']);
  });

  it('fails closed on selector misses, unproven absences, mixed failures, timeouts, retries, and unreadable reports', () => {
    expect(
      classifyFixtureAbsence(
        makeReport([
          {
            title: 'missed table',
            status: 'unexpected',
            results: [
              {
                status: 'failed',
                errors: [
                  {
                    message:
                      'Error: SELECTOR_MISSED_FIXTURE cash/9-seat/2+seated/running: catalogue had 2 dealing tables',
                  },
                ],
              },
            ],
          },
        ])
      ).verdict
    ).toBe('fail');

    expect(
      classifyFixtureAbsence(
        makeReport([
          {
            title: 'unproven absence',
            status: 'unexpected',
            results: [
              {
                status: 'failed',
                errors: [
                  {
                    message:
                      'Error: FIXTURE_ABSENCE_UNPROVEN cash/2+seated/running: catalogue unreadable',
                  },
                ],
              },
            ],
          },
        ])
      ).verdict
    ).toBe('fail');

    expect(
      classifyFixtureAbsence(
        makeReport([
          {
            title: 'lacks fixture',
            status: 'unexpected',
            results: [
              {
                status: 'failed',
                errors: [{ message: 'PRODUCTION_LACKS_FIXTURE cash/2+seated/running: none' }],
              },
            ],
          },
          {
            title: 'real regression',
            status: 'unexpected',
            results: [{ status: 'failed', errors: [{ message: 'Expected 1 to be 2' }] }],
          },
        ])
      ).verdict
    ).toBe('fail');

    // Timed out or retried must stay fail
    expect(
      classifyFixtureAbsence(
        makeReport([
          {
            title: 'timed out',
            status: 'unexpected',
            results: [
              {
                status: 'timedOut',
                errors: [{ message: 'PRODUCTION_LACKS_FIXTURE cash/2+seated/running: none' }],
              },
            ],
          },
        ])
      ).verdict
    ).toBe('fail');

    expect(
      classifyFixtureAbsence(
        makeReport([
          {
            title: 'retried',
            status: 'unexpected',
            results: [
              {
                status: 'failed',
                errors: [{ message: 'PRODUCTION_LACKS_FIXTURE cash/2+seated/running: none' }],
              },
              {
                status: 'failed',
                errors: [{ message: 'PRODUCTION_LACKS_FIXTURE cash/2+seated/running: none' }],
              },
            ],
          },
        ])
      ).verdict
    ).toBe('fail');

    expect(classifyFixtureAbsence(null).verdict).toBe('fail');
    expect(classifyFixtureAbsence(makeReport([], { notRunReason: 'no specs' })).verdict).toBe(
      'fail'
    );
    expect(classifyFixtureAbsence(makeReport([], { errors: [{ message: 'boom' }] })).verdict).toBe(
      'fail'
    );
  });

  it('exits 3 on non-verdict, writes GITHUB_STEP_SUMMARY, and exits 0/1 for pass/fail via CLI', () => {
    const dir = mkdtempSync(join(tmpdir(), 'classify-fixture-'));
    try {
      const nonVerdictPath = join(dir, 'nv.json');
      const passPath = join(dir, 'pass.json');
      const summaryPath = join(dir, 'summary.md');
      writeFileSync(
        nonVerdictPath,
        JSON.stringify(
          makeReport([
            {
              title: 'seat-move proof',
              status: 'unexpected',
              results: [
                {
                  status: 'failed',
                  errors: [
                    {
                      message:
                        'PRODUCTION_LACKS_FIXTURE cash/must_move/2+seated/running: none running',
                    },
                  ],
                },
              ],
            },
          ])
        )
      );
      writeFileSync(
        passPath,
        JSON.stringify(
          makeReport([{ title: 'ok', status: 'expected', results: [{ status: 'passed' }] }])
        )
      );

      const nv = spawnSync(process.execPath, [CLASSIFY_SCRIPT, nonVerdictPath], {
        encoding: 'utf8',
        env: { ...process.env, GITHUB_STEP_SUMMARY: summaryPath },
      });
      expect(nv.status).toBe(3);
      expect(nv.stdout).toContain('::warning::UNKNOWN: NON-VERDICT:');
      expect(readFileSync(summaryPath, 'utf8')).toContain('NON-VERDICT:');

      const ok = spawnSync(process.execPath, [CLASSIFY_SCRIPT, passPath], { encoding: 'utf8' });
      expect(ok.status).toBe(0);

      const missing = spawnSync(process.execPath, [CLASSIFY_SCRIPT, join(dir, 'missing.json')], {
        encoding: 'utf8',
      });
      expect(missing.status).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('productionFixture.ts', () => {
  const req: FixtureRequirement = {
    format: 'cash',
    capacity: 9,
    minSeated: 2,
    clubIds: ['club-1'],
  };

  const row = (overrides: Partial<CatalogueTable> = {}): CatalogueTable => ({
    id: 't-1',
    clubId: 'club-1',
    format: 'cash',
    status: 'running',
    capacity: 9,
    seated: 4,
    clusterMode: null,
    ...overrides,
  });

  it('distinguishes unproven, absent, and missed fixtures accurately', () => {
    expect(fixtureKind(req)).toBe('cash/9-seat/2+seated/running');

    const unproven = proveFixtureAbsence({
      requirement: req,
      catalogue: null,
      catalogueError: 'network error',
      considered: new Set(),
    });
    expect(unproven.verdict).toBe('unproven');
    expect(missingFixtureError(unproven).message).toContain(FIXTURE_ABSENCE_UNPROVEN);

    const noMatches = proveFixtureAbsence({
      requirement: req,
      catalogue: [row({ capacity: 6 })],
      considered: new Set(),
    });
    expect(noMatches.verdict).toBe('absent');
    const err = missingFixtureError(noMatches);
    expect(err).toBeInstanceOf(ProductionLacksFixture);
    expect(err.message).toContain(PRODUCTION_LACKS_FIXTURE);

    const noneDealing = proveFixtureAbsence({
      requirement: req,
      catalogue: [row({ id: 't-9' })],
      certifiable: new Set(),
      considered: new Set(),
    });
    expect(noneDealing.verdict).toBe('absent');

    const missed = proveFixtureAbsence({
      requirement: req,
      catalogue: [row({ id: 't-9' })],
      certifiable: new Set(['t-9']),
      considered: new Set(['t-6']),
    });
    expect(missed.verdict).toBe('missed');
    expect(missingFixtureError(missed).message).toContain(SELECTOR_MISSED_FIXTURE);

    const allConsidered = proveFixtureAbsence({
      requirement: req,
      catalogue: [row({ id: 't-9' })],
      certifiable: new Set(['t-9']),
      considered: new Set(['t-9']),
    });
    expect(allConsidered.verdict).toBe('absent');
  });

  it('selects seat-move destinations by role and proves destination absence honestly', () => {
    const isMain = (table: { role?: string | null }) => table.role === 'main';
    const cat = [
      { id: 'src', name: 'Cluster A', role: 'feeder' },
      { id: 't-main', name: 'NLH 0.50/1 Classic', role: 'main' },
      { id: 't-other', name: 'NLH Table 2', role: 'feeder' },
    ];
    expect(selectSeatMoveDestinations(cat, 'src', isMain)).toEqual({
      main: { id: 't-main', name: 'NLH 0.50/1 Classic', role: 'main' },
      other: { id: 't-other', name: 'NLH Table 2', role: 'feeder' },
    });

    // No role=main table -> absent
    const noMainCat = [
      { id: 'src', name: 'Cluster A', role: 'feeder' },
      { id: 't-1', name: 'NLH Table 1', role: 'feeder' },
      { id: 't-2', name: 'NLH Table 2', role: 'feeder' },
    ];
    expect(selectSeatMoveDestinations(noMainCat, 'src', isMain)).toBeNull();
    expect(proveSeatMoveDestinationAbsence(noMainCat, 'src', isMain).verdict).toBe('absent');

    // Only a role=main table and no non-main destination -> absent
    const onlyMain = [
      { id: 'src', name: 'Cluster A', role: 'feeder' },
      { id: 't-main', name: 'NLH 0.50/1 Classic', role: 'main' },
    ];
    expect(selectSeatMoveDestinations(onlyMain, 'src', isMain)).toBeNull();
    expect(proveSeatMoveDestinationAbsence(onlyMain, 'src', isMain).verdict).toBe('absent');

    // Valid pair exists -> missed if selector failed to pick
    expect(proveSeatMoveDestinationAbsence(cat, 'src', isMain).verdict).toBe('missed');
  });

  it('normalizes lobby and service catalogue rows and refuses unproven cash subject absence', () => {
    expect(proveCashSubjectAbsence([], null).verdict).toBe('unproven');
    const lobbyRows = [
      {
        id: 'c-1',
        club_id: 'club-1',
        status: 'running',
        max_players: 9,
        current_players: 3,
        cluster: { cluster_mode: 'must_move' },
      },
    ];
    expect(catalogueFromLobbyRows(lobbyRows)).toEqual([
      {
        id: 'c-1',
        clubId: 'club-1',
        format: 'cash',
        status: 'running',
        capacity: 9,
        seated: 3,
        clusterMode: 'must_move',
      },
    ]);
    expect(proveCashSubjectAbsence([], lobbyRows, 'must_move').verdict).toBe('missed');
    expect(proveCashSubjectAbsence(['c-1'], lobbyRows, 'must_move').verdict).toBe('absent');

    const serviceRows = [
      {
        id: 's-1',
        club_id: 'club-1',
        status: 'running',
        max_players: 3,
        tournament_id: 'tour-1',
        tournament: { tournament_type: 'SPIN' },
      },
    ];
    expect(catalogueFromServiceRows(serviceRows, new Map([['s-1', 3]]))).toEqual([
      {
        id: 's-1',
        clubId: 'club-1',
        format: 'spin',
        status: 'running',
        capacity: 3,
        seated: 3,
        clusterMode: null,
      },
    ]);
  });
});

describe('record-post-deploy-verdict.mjs NON_VERDICT_LANES', () => {
  const baseEnv = {
    WORKFLOW_LABEL: 'Post-Deploy E2E',
    ALERT_SOURCE: 'club-arena.post-deploy-e2e',
    ALERT_NAME: 'PostDeployVerificationIncomplete',
    RUN_ID: '12345',
    RUN_URL: 'https://github.com/example/repo/actions/runs/12345',
    HEAD_SHA: 'a'.repeat(40),
    GATE_NAME: 'Confirm The Hetzner Web Publish Reached Production',
    GATE_RESULT: 'success',
    GATE_SHOULD_RUN: 'true',
    LANES: 'success|Client browser verification\nsuccess|Live-table and engine verification',
  };

  it('neither fires nor closes an open firing episode when a green lane is a non-verdict', () => {
    const verdict = readVerdict({
      ...baseEnv,
      NON_VERDICT_LANES: 'Live-table and engine verification\n',
    });
    const openEpisode = {
      status: 'firing',
      investigation_status: 'open',
      details: { failed_head_shas: ['b'.repeat(40)] },
    };
    const decision = decide(verdict, openEpisode, { ancestors: new Set(['b'.repeat(40)]) });
    expect(decision.action).toBe('none');
    expect(decision.exitCode).toBe(0);
    expect(decision.reason).toContain('non-verdict');
    expect(decision.reason).toContain('Live-table and engine verification');
  });

  it('never excuses a failed lane listed in NON_VERDICT_LANES and rejects unknown lane names', () => {
    const verdict = readVerdict({
      ...baseEnv,
      LANES: 'success|Client browser verification\nfailure|Live-table and engine verification',
      NON_VERDICT_LANES: 'Live-table and engine verification',
    });
    const decision = decide(verdict, null);
    expect(decision.action).toBe('fire');

    expect(() => readVerdict({ ...baseEnv, NON_VERDICT_LANES: 'No Such Lane' })).toThrow(
      /NON_VERDICT_LANES names no lane/
    );
  });
});

describe('live-table-certificate-coverage.mjs non-verdict refusal', () => {
  it('sets complete=false when any spec carries a non-verdict annotation even if all four required cases passed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'live-coverage-nv-'));
    try {
      const reportPath = join(dir, 'report.json');
      const outputPath = join(dir, 'github-output.txt');
      const requiredTitles = [
        'an already-running MTT table stays realtime and recovers one owner',
        'an already-running SPIN table stays realtime and recovers one owner',
        'an already-running SNG table stays realtime and recovers one owner',
        'an already-running table stays live and recovers one owner after a network loss',
      ];
      writeFileSync(
        reportPath,
        JSON.stringify({
          errors: [],
          suites: [
            {
              specs: [
                ...requiredTitles.map((title) => ({
                  file: 'production-live-table-realtime.spec.ts',
                  title,
                  ok: true,
                  tests: [
                    {
                      projectName: 'webkit-live-table-realtime',
                      expectedStatus: 'passed',
                      status: 'expected',
                      results: [{ status: 'passed' }],
                    },
                  ],
                })),
                {
                  file: 'production-live-table-realtime.spec.ts',
                  title: 'occupied 6-seat and 9-seat mobile layouts hold',
                  ok: true,
                  tests: [
                    {
                      projectName: 'webkit-live-table-realtime',
                      expectedStatus: 'passed',
                      status: 'skipped',
                      annotations: [
                        {
                          type: 'non-verdict',
                          description:
                            'PRODUCTION_LACKS_FIXTURE cash/9-seat/2+seated/running: none dealing',
                        },
                      ],
                      results: [{ status: 'skipped' }],
                    },
                  ],
                },
              ],
            },
          ],
        })
      );
      const res = spawnSync(process.execPath, [LIVE_COVERAGE_SCRIPT, reportPath], {
        encoding: 'utf8',
        env: { ...process.env, GITHUB_OUTPUT: outputPath },
      });
      expect(res.status).toBe(0);
      const parsed = JSON.parse(res.stdout.split('\n')[0]);
      expect(parsed.complete).toBe(false);
      expect(parsed.missing.some((m: string) => m.startsWith('non-verdict:'))).toBe(true);
      expect(readFileSync(outputPath, 'utf8')).toContain('complete=false');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
