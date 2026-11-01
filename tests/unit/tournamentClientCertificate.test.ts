import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, it, expect } from 'vitest';
import {
  admitTournamentOnly,
  assertTournamentReport,
  browserCases,
  liveCases,
} from '../../scripts/ci/tournament-client-certificate.mjs';
const workflow = parse(readFileSync('.github/workflows/post-deploy-e2e.yml', 'utf8'));
const report = (cases: string[][]) => ({
  errors: [],
  suites: [
    {
      specs: cases.map(([file, title, projectName]) => ({
        file,
        title,
        ok: true,
        tests: [
          {
            projectName,
            status: 'expected',
            expectedStatus: 'passed',
            results: [{ status: 'passed', retry: 0 }],
          },
        ],
      })),
    },
  ],
});
describe('closed tournament acceptance selection', () => {
  it('rejects caller-selected code, mixed modes and nonliteral input', () => {
    expect(admitTournamentOnly({ tournament_only: true })).toBe(true);
    for (const payload of [
      null,
      {},
      { tournament_only: false },
      { tournament_only: 'true' },
      { tournament_only: true, engine_sha: 'a'.repeat(40) },
      { tournament_only: true, natural_addon_tournament_id: 'x' },
      { tournament_only: true, spec: 'x' },
    ])
      expect(() => admitTournamentOnly(payload)).toThrow();
  });
  it('executes the actual dispatch admission and refuses mixed modes before fallback', () => {
    const gate = workflow.jobs['publication-gate'].steps.find((s: any) => s.id === 'origin');
    const dir = mkdtempSync(join(tmpdir(), 'tournament-admit-'));
    try {
      for (const payload of [
        { tournament_only: true },
        { tournament_only: 'true' },
        { tournament_only: true, engine_sha: 'a'.repeat(40) },
      ]) {
        const result = spawnSync('bash', ['-c', gate.run], {
          encoding: 'utf8',
          timeout: 10000,
          env: {
            ...process.env,
            EVENT_NAME: 'repository_dispatch',
            CLIENT_NAVIGATION_PAYLOAD: JSON.stringify(payload),
            GITHUB_OUTPUT: join(dir, 'output'),
          },
        });
        expect(result.status, result.stderr).toBe(
          Object.keys(payload).length === 1 && payload.tournament_only === true ? 0 : 1
        );
      }
      expect(readFileSync(join(dir, 'output'), 'utf8')).toContain('tournament_only=true');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('requires exactly seven browser and three natural cases without skips, retries or unrelated extras', () => {
    for (const [mode, cases] of [
      ['browser', browserCases],
      ['live', liveCases],
    ] as const) {
      expect(assertTournamentReport(report(cases), mode)).toBe(true);
      for (const mutate of [
        (r: any) => {
          r.suites[0].specs.pop();
        },
        (r: any) => {
          r.suites[0].specs.push(r.suites[0].specs[0]);
        },
        (r: any) => {
          r.errors.push({ message: 'setup failed' });
        },
        (r: any) => {
          r.suites[0].specs[0].tests[0].results[0].status = 'skipped';
        },
        (r: any) => {
          r.suites[0].specs[0].tests[0].results[0].retry = 1;
        },
        (r: any) => {
          r.suites[0].specs[0].tests[0].projectName = 'wrong';
        },
      ]) {
        const r = report(cases);
        mutate(r);
        expect(() => assertTournamentReport(r, mode)).toThrow();
      }
    }
  });
  it('preserves auth, fixture cleanup, provenance and default coverage in the existing lanes', () => {
    const client = workflow.jobs['production-e2e'];
    const live = workflow.jobs['live-table-e2e'];
    expect(client.concurrency.group).toBe('post-deploy-e2e-production');
    for (const lane of [client, live]) {
      const preserve = lane.steps.find(
        (s: any) => s.name === 'Preserve the closed tournament report validator'
      );
      expect(lane.steps.indexOf(preserve)).toBeLessThan(
        lane.steps.findIndex((s: any) => s.id === 'align')
      );
      expect(
        lane.steps.find((s: any) => s.run === 'node scripts/ci/production-e2e-account.mjs cleanup')
          .if
      ).toContain('always()');
      const final = lane.steps.find((s: any) => s.name.startsWith('Require exact tournament'));
      expect(final.if).toContain('always()');
      expect(final.run).toContain('CLEANUP_OUTCOME');
      expect(final.run).toContain('CASE_OUTCOME');
    }
    const browser = client.steps.find((s: any) => s.id === 'tournament_browser');
    expect(browser.env.E2E_REQUIRE_AUTH).toBe('1');
    expect(browser.run).toContain('--retries=0');
    expect(browser.run).toContain(
      'tournament-buy-in-dialog.spec.ts tests/e2e/tournament-watch.spec.ts'
    );
    expect(
      client.steps.find((s: any) => s.name === 'Run the specs that need a deployed page').if
    ).toContain("tournament_only != 'true'");
    expect(live.steps.find((s: any) => s.id === 'engine').env.TOURNAMENT_ONLY).toBe(
      '${{ needs.publication-gate.outputs.tournament_only }}'
    );
    const continuity = live.steps.find((s: any) => s.id === 'continuity');
    expect(continuity.run).toContain('(MTT|SPIN|SNG)');
    expect(continuity.run).toContain('else');
    expect(continuity.env.LIVE_TABLE_REALTIME_CERTIFICATION).toBe('1');
    expect(live.steps.find((s: any) => s.id === 'live_coverage').run).toContain(
      'live-table-certificate-coverage.mjs'
    );
    expect(live.steps.find((s: any) => s.id === 'live_coverage').if).toContain(
      "tournament_only != 'true'"
    );
    expect(workflow.jobs['tournament-only-verdict'].steps[0].run).toContain(
      'test "$CLIENT_SHA" = "$LIVE_SHA"'
    );
    for (const name of [
      'phase1-customization-cutover-seal',
      'post-deploy-verdict',
      'club-channel-lifecycle-e2e',
    ])
      expect(workflow.jobs[name].if).toContain("tournament_only != 'true'");
  });
});
