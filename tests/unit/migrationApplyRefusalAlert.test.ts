import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
// @ts-expect-error untyped CI module
import {
  ALERT_PREFIX,
  APPLY_WORKFLOW_PATH,
  GH_ALLOW_ESCAPES_FLAG,
  LOG_ISSUE,
  REPORT_JOB_NAME,
  alreadyReported,
  createGhDeps,
  dedupMarker,
  extractFailureSummary,
  extractMigrationFile,
  formatLogIssueComment,
  formatPrComment,
  ghApiText,
  pickFailedApplyJob,
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

  it('reads the verdict off coloured log lines exactly as off plain ones', () => {
    const E = String.fromCharCode(27);
    const log = [
      `2026-11-27T19:13:10.100Z ${E}[36;1m[queue]${E}[0m nothing ahead`,
      `2026-11-27T19:13:12.500Z ${E}[31mERROR:  canceling statement due to statement timeout${E}[0m`,
      `${E}[1m2026-11-27T19:13:12.600Z${E}[0m ${E}[31;1m[apply] REFUSED after 120011ms${E}[0m${E}[K`,
      `2026-11-27T19:13:12.700Z ${E}]8;;https://example.invalid${E}\\link${E}]8;;${E}\\`,
    ].join('\r\n');
    const summary = extractFailureSummary(log);
    expect(summary.verdict).toBe('REFUSED');
    expect(summary.durationMs).toBe(120011);
    expect(summary.summaryLines).toEqual([
      'ERROR:  canceling statement due to statement timeout',
      '[apply] REFUSED after 120011ms',
    ]);
    expect(summary.summaryLines.join('')).not.toContain(E);
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

describe('the apply run reports its own refusal (the run is still in progress)', () => {
  const FILE = '20261127172908_cron_watchers_materialize_and_prune_without_deadlock.sql';
  const inProgressRun = {
    id: 46054847104,
    path: APPLY_WORKFLOW_PATH,
    status: 'in_progress',
    conclusion: null,
    display_title: `Apply Merged Migration ${FILE} 7470f535023bca7ceba4abba32990485`,
    html_url: 'https://github.com/o/r/actions/runs/46054847104',
    updated_at: '2026-11-27T19:13:19Z',
  };
  const applyJob = (conclusion: string | null, status = 'completed') => ({
    id: 140694717988,
    name: `Apply ${FILE}`,
    status,
    conclusion,
    completed_at: status === 'completed' ? '2026-11-27T19:13:15Z' : null,
    steps: [{ name: 'Apply the migration', conclusion }],
  });
  const reportJob = (over: Record<string, any> = {}) => ({
    id: 140694999999,
    name: REPORT_JOB_NAME,
    status: 'in_progress',
    conclusion: null,
    steps: [],
    ...over,
  });

  function makeDeps(jobs: any[], overrides: Record<string, any> = {}) {
    const posted: Array<{ issue: string | number; body: string }> = [];
    const logReads: Array<string | number> = [];
    return {
      posted,
      logReads,
      deps: {
        getRun: async () => inProgressRun,
        getJobs: async () => jobs,
        getJobLog: async (_repo: string, jobId: string | number) => {
          logReads.push(jobId);
          return '2026-11-27T19:13:12Z ERROR:  canceling statement due to statement timeout\n2026-11-27T19:13:12Z [apply] REFUSED after 120011ms';
        },
        getMigrationCommits: async () => [
          { sha: '7470f535023b', commit: { message: 'fix(db): cron watchers (#12217)' } },
        ],
        getCommitPulls: async () => [],
        listIssueComments: async () => [],
        postComment: async (_repo: string, issue: string | number, body: string) => {
          posted.push({ issue, body });
          return { id: posted.length };
        },
        ...overrides,
      },
    };
  }

  it('reports an in-progress run whose apply job concluded failure', async () => {
    // The report job is listed FIRST and is in progress: it is never the failure.
    const { deps, posted, logReads } = makeDeps([reportJob(), applyJob('failure')]);
    const res = await reportMigrationApplyRefusal({ repo: 'o/r', runId: '46054847104', deps });
    expect(res.status).toBe('reported');
    expect(res.verdict).toBe('REFUSED');
    expect(res.durationMs).toBe(120011);
    expect(res.failedSteps).toEqual(['Apply the migration']);
    expect(res.detailUnread).toBeNull();
    expect(logReads).toEqual([140694717988]);
    expect(posted.map((p) => String(p.issue))).toEqual(['12217', LOG_ISSUE]);
    expect(posted[1].body).toContain('2026-11-27 13:13 CST');
    expect(posted[1].body).toContain('statement timeout');
  });

  it('skips an in-progress run whose apply job succeeded, is running, was cancelled or was skipped', async () => {
    for (const job of [
      applyJob('success'),
      applyJob(null, 'in_progress'),
      applyJob('cancelled'),
      applyJob('skipped'),
    ]) {
      const { deps, posted, logReads } = makeDeps([job, reportJob()]);
      const res = await reportMigrationApplyRefusal({ repo: 'o/r', runId: '46054847104', deps });
      expect(res.status, String(job.conclusion)).toBe('skipped');
      expect(res.reason).toMatch(/no apply job that concluded failure/);
      expect(posted).toHaveLength(0);
      expect(logReads).toHaveLength(0);
    }
    const none = makeDeps([]);
    expect(
      (await reportMigrationApplyRefusal({ repo: 'o/r', runId: '46054847104', deps: none.deps }))
        .status
    ).toBe('skipped');
  });

  it('never chooses the report job as the failed job, even when it is the only failure', async () => {
    const failedReport = reportJob({ status: 'completed', conclusion: 'failure' });
    expect(pickFailedApplyJob([failedReport])).toBeNull();
    expect(pickFailedApplyJob([failedReport, applyJob('success')])).toBeNull();
    expect(pickFailedApplyJob([failedReport, applyJob('failure')])?.id).toBe(140694717988);
    expect(
      pickFailedApplyJob([
        { id: 1, name: 'Some other job', status: 'completed', conclusion: 'failure' },
      ])
    ).toBeNull();
    // A completed, failed RUN whose only failed job is the report job is not a refusal.
    const { deps, posted } = makeDeps([applyJob('success'), failedReport], {
      getRun: async () => ({ ...inProgressRun, status: 'completed', conclusion: 'failure' }),
    });
    const res = await reportMigrationApplyRefusal({ repo: 'o/r', runId: '46054847104', deps });
    expect(res.status).toBe('skipped');
    expect(posted).toHaveLength(0);
  });

  it('says the detail is unread when the job log cannot be read, and still alerts', async () => {
    const { deps, posted } = makeDeps([applyJob('failure'), reportJob()], {
      getJobLog: async () => {
        throw Object.assign(new Error('Command failed: gh api'), {
          stderr: 'the response contains terminal escape sequences\n',
        });
      },
    });
    const res = await reportMigrationApplyRefusal({ repo: 'o/r', runId: '46054847104', deps });
    expect(res.status).toBe('reported');
    expect(res.detailUnread).toContain('the response contains terminal escape sequences');
    expect(posted).toHaveLength(2);
    for (const p of posted) {
      expect(p.body).toMatch(/Detail unread:/);
      expect(p.body).toContain('could not be read');
    }
    const empty = makeDeps([applyJob('failure')], { getJobLog: async () => '' });
    const res2 = await reportMigrationApplyRefusal({
      repo: 'o/r',
      runId: '46054847104',
      deps: empty.deps,
    });
    expect(res2.detailUnread).toBe('the job log came back empty.');
    expect(empty.posted[1].body).toMatch(/Detail unread: the job log came back empty\./);
  });
});

describe('the job log is read on every gh', () => {
  const ghError = (stderr: string) =>
    Object.assign(new Error(`Command failed: gh api\n${stderr}`), { status: 1, stderr });

  it('asks a new gh for the body with the escape-sequence flag, once', () => {
    const calls: string[][] = [];
    const out = ghApiText('repos/o/r/actions/jobs/1/logs', (file: string, args: string[]) => {
      calls.push([file, ...args]);
      return 'log body';
    });
    expect(out).toBe('log body');
    expect(calls).toEqual([['gh', 'api', 'repos/o/r/actions/jobs/1/logs', GH_ALLOW_ESCAPES_FLAG]]);
  });

  it('falls back to the old form only when gh answers "unknown flag"', () => {
    const calls: string[][] = [];
    const out = ghApiText('repos/o/r/actions/jobs/1/logs', (_file: string, args: string[]) => {
      calls.push(args);
      if (args.includes(GH_ALLOW_ESCAPES_FLAG)) {
        throw ghError(
          `unknown flag: ${GH_ALLOW_ESCAPES_FLAG}\n\nUsage:  gh api <endpoint> [flags]`
        );
      }
      return 'old gh log body';
    });
    expect(out).toBe('old gh log body');
    expect(calls).toEqual([
      ['api', 'repos/o/r/actions/jobs/1/logs', GH_ALLOW_ESCAPES_FLAG],
      ['api', 'repos/o/r/actions/jobs/1/logs'],
    ]);
  });

  it('does not retry any other failure, and throws it as it is', () => {
    for (const stderr of [
      'gh: Not Found (HTTP 404)',
      'the response contains terminal escape sequences',
      'unknown flag: --some-other-flag',
    ]) {
      let calls = 0;
      expect(() =>
        ghApiText('repos/o/r/actions/jobs/1/logs', () => {
          calls++;
          throw ghError(stderr);
        })
      ).toThrow(/Command failed/);
      expect(calls, stderr).toBe(1);
    }
  });

  it('createGhDeps reads a job log through the injected gh runner', () => {
    const calls: string[][] = [];
    const deps = createGhDeps({
      run: (_file: string, args: string[]) => {
        calls.push(args);
        return args.some((a) => a.endsWith('/jobs')) ? '{"jobs":[{"id":7}]}' : 'text';
      },
    });
    expect(deps.getJobLog('o/r', 7)).toBe('text');
    expect(deps.getJobs('o/r', 9)).toEqual([{ id: 7 }]);
    expect(calls).toEqual([
      ['api', 'repos/o/r/actions/jobs/7/logs', GH_ALLOW_ESCAPES_FLAG],
      ['api', 'repos/o/r/actions/runs/9/jobs'],
    ]);
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

  it('does not claim the workflow_run door hears a run the job token started', () => {
    expect(raw).not.toMatch(/within ~30 seconds instead of waiting/);
    expect(raw).toMatch(/can NEVER fire for the normal route/);
    expect(wf.on.workflow_dispatch.inputs.apply_run_id.required).toBe(true);
    expect(wf.concurrency.group).toContain('github.event.workflow_run.id || inputs.apply_run_id');
  });
});
