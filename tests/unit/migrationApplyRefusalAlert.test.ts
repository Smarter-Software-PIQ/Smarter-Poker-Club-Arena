import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
// @ts-expect-error untyped CI module
import {
  ALERT_PREFIX,
  APPLY_WORKFLOW_PATH,
  LOG_ISSUE,
  alreadyReported,
  dedupMarker,
  extractFailureSummary,
  extractMigrationFile,
  formatLogIssueComment,
  formatPrComment,
  pickOwningCommit,
  reportMigrationApplyRefusal,
  resolveOwningPr,
} from '../../scripts/ci/migration-apply-refusal-alert.mjs';

const ROOT = resolve(__dirname, '../..');
const WORKFLOW_PATH = resolve(ROOT, '.github/workflows/migration-apply-refusal-alert.yml');

describe('migration-apply-refusal-alert pure helpers', () => {
  it('extracts the migration filename from display_title, name, or job name', () => {
    expect(
      extractMigrationFile({
        display_title:
          'Apply Merged Migration 20261126203947_the_bbj_drift_alarm_reads_its_window_once.sql 4a180d7bfd06134ae423199c3512a859',
      })
    ).toBe('20261126203947_the_bbj_drift_alarm_reads_its_window_once.sql');

    expect(
      extractMigrationFile({ display_title: 'Apply Merged Migration' }, [
        { name: 'Apply 20261126195422_the_spin_reserve_gauge_reads_each_table_once.sql' },
      ])
    ).toBe('20261126195422_the_spin_reserve_gauge_reads_each_table_once.sql');

    expect(extractMigrationFile({ display_title: 'unrelated' }, [])).toBeNull();
  });

  it('extracts verdict, duration, and actual error lines while ignoring echoed shell source and redacting credentials', () => {
    const log = [
      '2026-11-26T22:17:45.990Z # echo "[apply] REFUSED: comment line"',
      '2026-11-26T22:17:45.991Z     echo "[apply] REFUSED: could not read the applier queue." | tee /tmp/apply.log',
      '2026-11-26T22:18:48.750Z psql:postgresql://postgres:secret@db.example:5432/postgres FATAL: terminating connection due to transaction timeout (25P04)',
      '2026-11-26T22:18:48.755Z [apply] REFUSED after 12156ms',
      '2026-11-26T22:18:48.769Z     1) echo "- result: **REFUSED**"',
    ].join('\n');

    const summary = extractFailureSummary(log);
    expect(summary.verdict).toBe('REFUSED');
    expect(summary.durationMs).toBe(12156);
    expect(summary.summaryLines).toHaveLength(2);
    expect(summary.summaryLines[0]).toContain('<redacted-db-url>');
    expect(summary.summaryLines[0]).not.toContain('secret');
    expect(summary.summaryLines[1]).toBe('[apply] REFUSED after 12156ms');
  });

  it('picks the non-revert owning commit and resolves the merged PR number', () => {
    const commits = [
      {
        sha: '45b110c9d873',
        commit: { message: 'revert: the BBJ drift alarm migration (#12129) (#12154)' },
      },
      {
        sha: '4dc04652224f',
        commit: { message: 'fix(db): the BBJ drift alarm reads its window once (#12129)' },
      },
    ];
    const picked = pickOwningCommit(commits);
    expect(picked.sha).toBe('4dc04652224f');
    expect(resolveOwningPr(picked, [])).toEqual({ number: 12129, url: null });
    expect(
      resolveOwningPr(picked, [
        {
          number: 12129,
          merged_at: '2026-11-26T22:15:00Z',
          html_url: 'https://github.com/o/r/pull/12129',
        },
      ])
    ).toEqual({ number: 12129, url: 'https://github.com/o/r/pull/12129' });
  });

  it('never emits Cycle:, Result:, Sealed SHA:, or Serving SHA: lines on release custody issue #11599', () => {
    const comment = formatLogIssueComment({
      runId: '45903772035',
      runUrl: 'https://github.com/o/r/actions/runs/45903772035',
      migrationFile: '20261126203947_the_bbj_drift_alarm_reads_its_window_once.sql',
      verdict: 'REFUSED',
      durationMs: 12156,
      owningPrNumber: 12129,
      owningPrUrl: 'https://github.com/o/r/pull/12129',
      summaryLines: ['Cycle: spoofed', 'Result: SEALED', '[apply] REFUSED after 12156ms'],
      observedAt: '2026-11-26T22:18:52Z',
    });

    for (const line of comment.split('\n')) {
      expect(line).not.toMatch(/^(?:Cycle|Result|Sealed SHA|Serving SHA):/i);
    }
    expect(comment.startsWith(`${ALERT_PREFIX} for run 45903772035:`)).toBe(true);
    expect(comment).toContain(dedupMarker('45903772035'));
    expect(alreadyReported([{ body: comment }], '45903772035')).toBe(true);
    expect(alreadyReported([{ body: comment }], '99999999999')).toBe(false);
  });

  it('formats PR comment with dedup marker and actionable impact note', () => {
    const body = formatPrComment({
      runId: '45903772035',
      runUrl: 'https://github.com/o/r/actions/runs/45903772035',
      migrationFile: '20261126203947_the_bbj_drift_alarm_reads_its_window_once.sql',
      verdict: 'REFUSED',
      durationMs: 12156,
      failedSteps: ['Apply the migration'],
      summaryLines: ['[apply] REFUSED after 12156ms'],
      observedAt: '2026-11-26T22:18:52Z',
    });
    expect(body).toContain('NOT installed');
    expect(body).toContain('20261126203947_the_bbj_drift_alarm_reads_its_window_once.sql');
    expect(body).toContain(dedupMarker('45903772035'));
  });
});

describe('reportMigrationApplyRefusal orchestration', () => {
  const baseRun = {
    id: 45903772035,
    path: APPLY_WORKFLOW_PATH,
    conclusion: 'failure',
    display_title:
      'Apply Merged Migration 20261126203947_the_bbj_drift_alarm_reads_its_window_once.sql 4a180d7',
    html_url: 'https://github.com/o/r/actions/runs/45903772035',
    updated_at: '2026-11-26T22:18:52Z',
  };

  function makeDeps(overrides: Record<string, any> = {}) {
    const posted: Array<{ issue: string | number; body: string }> = [];
    return {
      posted,
      deps: {
        getRun: async () => baseRun,
        getJobs: async () => [
          {
            id: 140195538366,
            name: 'Apply 20261126203947_the_bbj_drift_alarm_reads_its_window_once.sql',
            conclusion: 'failure',
            steps: [{ name: 'Apply the migration', conclusion: 'failure' }],
          },
        ],
        getJobLog: async () =>
          '2026-11-26T22:18:48Z FATAL: terminating connection due to transaction timeout\n2026-11-26T22:18:48Z [apply] REFUSED after 12156ms',
        getMigrationCommits: async () => [
          { sha: '4dc04652224f', commit: { message: 'fix(db): bbj drift (#12129)' } },
        ],
        getCommitPulls: async () => [
          {
            number: 12129,
            merged_at: '2026-11-26T22:15:00Z',
            html_url: 'https://github.com/o/r/pull/12129',
          },
        ],
        listIssueComments: async () => [],
        postComment: async (_repo: string, issue: string | number, body: string) => {
          posted.push({ issue, body });
          return { id: posted.length };
        },
        ...overrides,
      },
    };
  }

  it('posts once to owning PR and once to #11599 on a failed Apply Merged Migration run', async () => {
    const { deps, posted } = makeDeps();
    const res = await reportMigrationApplyRefusal({ repo: 'o/r', runId: '45903772035', deps });
    expect(res.status).toBe('reported');
    expect(res.owningPrNumber).toBe(12129);
    expect(res.actions).toEqual({ pr: 'posted', logIssue: 'posted' });
    expect(posted).toHaveLength(2);
    expect(posted.map((p) => String(p.issue))).toEqual(['12129', LOG_ISSUE]);
  });

  it('deduplicates on re-run and never posts twice', async () => {
    const existing = [{ body: `earlier note\n${dedupMarker('45903772035')}` }];
    const { deps, posted } = makeDeps({ listIssueComments: async () => existing });
    const res = await reportMigrationApplyRefusal({ repo: 'o/r', runId: '45903772035', deps });
    expect(res.actions).toEqual({ pr: 'already_reported', logIssue: 'already_reported' });
    expect(posted).toHaveLength(0);
  });

  it('posts nothing in dry_run mode', async () => {
    const { deps, posted } = makeDeps();
    const res = await reportMigrationApplyRefusal({
      repo: 'o/r',
      runId: '45903772035',
      dryRun: true,
      deps,
    });
    expect(res.status).toBe('dry_run');
    expect(res.actions).toEqual({ pr: 'dry_run', logIssue: 'dry_run' });
    expect(posted).toHaveLength(0);
  });

  it('skips non-failure or unrelated workflow runs', async () => {
    const { deps, posted } = makeDeps({
      getRun: async () => ({ ...baseRun, conclusion: 'success' }),
    });
    const res = await reportMigrationApplyRefusal({ repo: 'o/r', runId: '45903772035', deps });
    expect(res.status).toBe('skipped');
    expect(posted).toHaveLength(0);
  });
});

describe('migration-apply-refusal-alert.yml workflow contract', () => {
  const raw = readFileSync(WORKFLOW_PATH, 'utf8');
  const wf = parse(raw) as Record<string, any>;

  it('listens to Apply Merged Migration without timers, secrets, or cancel-in-progress', () => {
    expect(wf.on.workflow_run.workflows).toEqual(['Apply Merged Migration']);
    expect(wf.on.schedule).toBeUndefined();
    expect(wf.permissions).toEqual({});
    expect(wf.concurrency['cancel-in-progress']).toBe(false);
    expect(raw).not.toMatch(/secrets\.(?!GITHUB_TOKEN\b)/);
    expect(raw).toContain(
      "github.event.workflow_run.path == '.github/workflows/apply-merged-migration.yml'"
    );
    expect(raw).toContain(
      'github.event.workflow_run.head_repository.full_name == github.repository'
    );
    expect(raw).toContain("github.event.workflow_run.conclusion == 'failure'");
  });
});
