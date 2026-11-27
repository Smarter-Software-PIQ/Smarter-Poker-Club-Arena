/**
 * A PRODUCTION CERTIFICATE THAT KEEPS FAILING REACHES A PERSON (2026-11-24).
 *
 * Club Create Certification failed on every run from about 2026-11-18 to
 * 2026-11-24 and Rabbit Hunt Certification on every daily run that week; each
 * was only a red check run and nothing reached the operational inbox. Every
 * production certification workflow (a workflow whose name ends in
 * "Certification") now ends with a job that rides its own run: two failed
 * certificate runs in a row on main open one ProductionCertificationFailing
 * episode through scripts/ci/record-post-deploy-verdict.mjs (the route
 * post-deploy-e2e.yml uses), later failures bump it, and a passing run that
 * covers it closes it. This file pins that wiring and the decision rules.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import {
  decide,
  certificateConclusion,
  firstErrorLine,
  readPrevious,
  SUPERSEDED_STEP,
  // @ts-expect-error untyped CI module
} from '../../scripts/ci/certification-failure-streak.mjs';
import {
  assertReceiptOrigins,
  retainedRuntimeSupersededBy,
  // @ts-expect-error untyped CI module
} from '../../scripts/ci/client-runtime-retention.mjs';
import { createHash } from 'node:crypto';

const DIR = join(process.cwd(), '.github', 'workflows');
type Step = { name?: string; run?: string; if?: string; env?: Record<string, string> };
type Job = {
  needs?: string | string[];
  if?: string;
  environment?: string;
  steps?: Step[];
  permissions?: Record<string, string>;
};
type Workflow = { name?: string; jobs?: Record<string, Job> };

const certifications = readdirSync(DIR)
  .filter((f) => /\.ya?ml$/.test(f))
  .map((file) => ({ file, wf: parse(readFileSync(join(DIR, file), 'utf8')) as Workflow }))
  .filter(({ wf }) => typeof wf?.name === 'string' && / Certification$/.test(wf.name));

describe('every production certification admits a failure streak to the operational inbox', () => {
  it('finds the production certification workflows (the scan is not silently empty)', () => {
    const names = certifications.map(({ wf }) => wf.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'Club Create Certification',
        'Heads-Up Rematch Certification',
        'Rabbit Hunt Certification',
      ])
    );
  });

  for (const { file, wf } of certifications) {
    it(`${file} ends with the streak verdict job`, () => {
      const jobs = wf.jobs || {};
      const entry = Object.entries(jobs).find(([, job]) =>
        (job.steps || []).some((step) =>
          /scripts\/ci\/certification-failure-streak\.mjs/.test(step.run || '')
        )
      );
      expect(entry, `${file} has no job running certification-failure-streak.mjs`).toBeTruthy();
      const [, job] = entry as [string, Job];
      const needs = Array.isArray(job.needs) ? job.needs : [job.needs];
      expect(needs).toContain('certify');
      // always(): a failed or cancelled certificate still admits its verdict.
      expect(String(job.if)).toContain('always()');
      expect(String(job.if)).toContain("needs.certify.result != 'skipped'");
      expect(job.environment).toBe('ci-main');
      expect(job.permissions?.actions).toBe('read');
      const steps = job.steps || [];
      const streak = steps.find((s) => /certification-failure-streak\.mjs/.test(s.run || ''));
      expect(streak?.env?.WORKFLOW_FILE).toBe(file);
      expect(streak?.env?.CERT_JOB).toBe('certify');
      expect(streak?.env?.CERT_RESULT).toBe('${{ needs.certify.result }}');
      const recorder = steps.find((s) => /record-post-deploy-verdict\.mjs/.test(s.run || ''));
      expect(recorder, `${file} does not record the verdict`).toBeTruthy();
      expect(String(recorder?.if)).toContain("outputs.record == 'yes'");
      expect(recorder?.env?.ALERT_NAME).toBe('ProductionCertificationFailing');
      expect(recorder?.env?.ALERT_SOURCE).toBe(`club-arena.${file.replace(/\.ya?ml$/, '')}`);
      expect(recorder?.env?.WORKFLOW_LABEL).toBe(wf.name);
      expect(recorder?.env?.LANES).toContain('${{ needs.certify.result }}|certify');
      expect(recorder?.env?.FAILURE_DETAIL).toContain('outputs.detail');
      expect(recorder?.env?.DATABASE_URL).toBe('${{ secrets.DATABASE_URL }}');
    });
  }
});

describe('the streak rules', () => {
  it('a pass is always admitted, so it can close an open episode', () => {
    expect(decide({ result: 'success', previous: 'failure' }).record).toBe(true);
    expect(decide({ result: 'success', previous: 'none' }).record).toBe(true);
  });
  it('a second failure in a row alarms; a first failure stays a red check', () => {
    expect(decide({ result: 'failure', previous: 'failure' }).record).toBe(true);
    expect(decide({ result: 'failure', previous: 'success' }).record).toBe(false);
    expect(decide({ result: 'failure', previous: 'none' }).record).toBe(false);
    expect(decide({ result: 'cancelled', previous: 'failure' }).record).toBe(true);
  });
  it('an unread history is never a pass', () => {
    expect(decide({ result: 'failure', previous: 'unknown' }).record).toBe(true);
  });
  it('a certificate that did not run records nothing', () => {
    expect(decide({ result: 'skipped', previous: 'failure' }).record).toBe(false);
  });
  it('reads the certificate job, not the run conclusion, and passes over runs where it did not run', async () => {
    // 2026-11-20..22: Club Create runs ended success with the certify job skipped.
    const runs = {
      workflow_runs: [
        { id: 3, created_at: '2026-11-24T09:00:00Z', html_url: 'u3' },
        { id: 2, created_at: '2026-11-24T08:00:00Z', html_url: 'u2' },
        { id: 1, created_at: '2026-11-24T07:00:00Z', html_url: 'u1' },
      ],
    };
    const jobs: Record<string, unknown> = {
      2: {
        jobs: [
          { name: 'publication', conclusion: 'success' },
          { name: 'certify', conclusion: 'skipped' },
        ],
      },
      1: { jobs: [{ name: 'certify', conclusion: 'failure' }] },
    };
    const read = async (path: string) => {
      if (path.includes('/workflows/')) return runs;
      const id = path.match(/runs\/(\d+)\/jobs/)?.[1] as string;
      return jobs[id];
    };
    const out = await readPrevious({
      token: 't',
      repo: 'o/r',
      workflowFile: 'x.yml',
      runId: '3',
      jobName: 'certify',
      read,
    });
    expect(out).toEqual({ previous: 'failure', runId: 1, runUrl: 'u1' });
    const none = await readPrevious({
      token: 't',
      repo: 'o/r',
      workflowFile: 'x.yml',
      runId: '3',
      jobName: 'certify',
      read: async (path: string) =>
        path.includes('/workflows/') ? { workflow_runs: [] } : { jobs: [] },
    });
    expect(none.previous).toBe('unknown');
    const broken = await readPrevious({
      token: 't',
      repo: 'o/r',
      workflowFile: 'x.yml',
      runId: '3',
      jobName: 'certify',
      read: async () => {
        throw new Error('GitHub 502');
      },
    });
    expect(broken.previous).toBe('unknown');
  });
  // A paged history, newest first; certify ran only where `ran` says.
  const pagedHistory = (total: number, ran: Record<number, string>) => {
    const runs = Array.from({ length: total }, (_, i) => ({
      id: 1000 - i,
      created_at: new Date(Date.UTC(2026, 10, 24, 12) - i * 60_000).toISOString(),
      html_url: `u${1000 - i}`,
    }));
    const calls: string[] = [];
    const read = async (path: string) => {
      calls.push(path);
      if (path.includes('/workflows/')) {
        const page = Number(path.match(/[?&]page=(\d+)/)?.[1]);
        const perPage = Number(path.match(/[?&]per_page=(\d+)/)?.[1]);
        expect(perPage).toBe(100);
        expect(path).toContain('branch=main');
        expect(path).toContain('status=completed');
        return { workflow_runs: runs.slice((page - 1) * perPage, page * perPage) };
      }
      const id = Number(path.match(/runs\/(\d+)\/jobs/)?.[1]);
      const conclusion = ran[id] ?? 'skipped';
      return {
        jobs: [
          { name: 'publication', conclusion: 'success' },
          { name: 'certify', conclusion },
        ],
      };
    };
    return { read, calls };
  };

  it('finds a failed certificate behind twenty runs that skipped it', async () => {
    const { read } = pagedHistory(21, { 980: 'failure' });
    const out = await readPrevious({
      token: 't',
      repo: 'o/r',
      workflowFile: 'x.yml',
      runId: '1',
      jobName: 'certify',
      read,
    });
    expect(out).toEqual({ previous: 'failure', runId: 980, runUrl: 'u980' });
    expect(decide({ result: 'failure', previous: out.previous }).record).toBe(true);
  });

  it('stops at thirty job-list reads: a certificate run beyond the cap is unknown, and alerts', async () => {
    const { read, calls } = pagedHistory(250, { 950: 'success' });
    const out = await readPrevious({
      token: 't',
      repo: 'o/r',
      workflowFile: 'x.yml',
      runId: '1',
      jobName: 'certify',
      read,
    });
    expect(out.previous).toBe('unknown');
    expect(out.error).toMatch(/no run that executed certify within 30 job-list reads on main/);
    expect(calls.filter((c) => /\/runs\/\d+\/jobs/.test(c)).length).toBe(30);
    expect(decide({ result: 'failure', previous: out.previous }).record).toBe(true);
  });

  it('only skipped runs is unknown, and alerts, after exactly thirty job reads and one page', async () => {
    const { read, calls } = pagedHistory(400, {});
    const out = await readPrevious({
      token: 't',
      repo: 'o/r',
      workflowFile: 'x.yml',
      runId: '1',
      jobName: 'certify',
      read,
    });
    expect(out.previous).toBe('unknown');
    expect(calls.filter((c) => /\/runs\/\d+\/jobs/.test(c)).length).toBe(30);
    expect(calls.filter((c) => c.includes('/workflows/')).length).toBe(1);
    expect(decide({ result: 'failure', previous: out.previous }).record).toBe(true);
  });

  it('an exhausted short history with no certificate run is unknown, and alerts', async () => {
    const { read, calls } = pagedHistory(12, {});
    const out = await readPrevious({
      token: 't',
      repo: 'o/r',
      workflowFile: 'x.yml',
      runId: '1',
      jobName: 'certify',
      read,
    });
    expect(out.previous).toBe('unknown');
    expect(out.error).toMatch(/no run that executed certify among 12 completed runs on main/);
    expect(calls.filter((c) => /\/runs\/\d+\/jobs/.test(c)).length).toBe(12);
    expect(calls.filter((c) => c.includes('/workflows/')).length).toBe(1);
  });

  it('classifies a job list', () => {
    expect(
      certificateConclusion({ jobs: [{ name: 'certify', conclusion: 'timed_out' }] }, 'certify')
    ).toBe('failure');
    expect(
      certificateConclusion({ jobs: [{ name: 'certify', conclusion: 'cancelled' }] }, 'certify')
    ).toBeNull();
    expect(certificateConclusion({ jobs: [] }, 'certify')).toBeNull();
    expect(certificateConclusion(null, 'certify')).toBe('unknown');
  });
  it('names the real first error, never the generic exit line', () => {
    const log = [
      '2026-11-24T08:30:00.0000000Z ##[warning]Node.js 20 is deprecated.',
      '2026-11-24T08:30:01.0000000Z [rabbit-hunt-cert] FAIL two reserved certification players seated with certification-club chips',
      '2026-11-24T08:30:02.0000000Z ##[error]Process completed with exit code 1.',
    ].join('\n');
    expect(firstErrorLine(log)).toBe(
      '[rabbit-hunt-cert] FAIL two reserved certification players seated with certification-club chips'
    );
    expect(
      firstErrorLine(
        '    Error: expect(locator).toBeVisible() failed\n##[error]Process completed with exit code 1.'
      )
    ).toBe('Error: expect(locator).toBeVisible() failed');
    expect(firstErrorLine('##[error]Process completed with exit code 1.')).toBeNull();
  });
});

/* 2026-11-25: Club Create Certification runs 45346014580 and 45499309914
   waited ten minutes for a revision a later publish had already replaced, then
   failed. Nothing was wrong with club creation, yet two such runs in a row
   would open a false ProductionCertificationFailing episode. A superseded run
   now stops on one named step before any fixture exists, its own verdict job
   stands down, and the streak reader passes over it. */
describe('a newer publish is not a failed certificate (2026-11-25)', () => {
  const superseded = {
    name: 'certify',
    conclusion: 'failure',
    steps: [
      { name: 'Wait For This Exact Revision On Both Public Endpoints', conclusion: 'success' },
      { name: SUPERSEDED_STEP, conclusion: 'failure' },
      { name: 'Certify Authenticated Club Creation And Cleanup', conclusion: 'skipped' },
    ],
  };

  it('a certificate job that failed on the superseded step certified nothing', () => {
    expect(certificateConclusion({ jobs: [superseded] }, 'certify')).toBeNull();
  });

  it('a GREEN run in which the superseded step ran is no verdict, so it cannot break a streak', () => {
    const green = {
      name: 'certify',
      conclusion: 'success',
      steps: [
        { name: 'Wait For This Exact Revision On Both Public Endpoints', conclusion: 'success' },
        { name: SUPERSEDED_STEP, conclusion: 'success' },
        { name: 'Certify Authenticated Club Creation And Cleanup', conclusion: 'skipped' },
      ],
    };
    expect(certificateConclusion({ jobs: [green] }, 'certify')).toBeNull();
    // A real pass (the superseded step skipped) is still a pass.
    expect(
      certificateConclusion(
        {
          jobs: [
            {
              name: 'certify',
              conclusion: 'success',
              steps: [{ name: SUPERSEDED_STEP, conclusion: 'skipped' }],
            },
          ],
        },
        'certify'
      )
    ).toBe('success');
  });

  it('every other failure is still a failure, whatever else was skipped', () => {
    expect(
      certificateConclusion(
        {
          jobs: [
            {
              name: 'certify',
              conclusion: 'failure',
              steps: [
                {
                  name: 'Wait For This Exact Revision On Both Public Endpoints',
                  conclusion: 'failure',
                },
                { name: SUPERSEDED_STEP, conclusion: 'skipped' },
              ],
            },
          ],
        },
        'certify'
      )
    ).toBe('failure');
    expect(
      certificateConclusion({ jobs: [{ name: 'certify', conclusion: 'failure' }] }, 'certify')
    ).toBe('failure');
  });

  it('the streak reader passes over a superseded run and finds the real verdict behind it', async () => {
    const runs = [3, 2].map((id) => ({
      id,
      created_at: new Date(Date.UTC(2026, 10, 25, 0, id)).toISOString(),
      html_url: `u${id}`,
    }));
    const read = async (path: string) => {
      if (path.includes('/workflows/')) return { workflow_runs: runs };
      const id = Number(path.match(/runs\/(\d+)\/jobs/)?.[1]);
      return { jobs: [id === 3 ? superseded : { name: 'certify', conclusion: 'failure' }] };
    };
    await expect(
      readPrevious({
        token: 't',
        repo: 'o/r',
        workflowFile: 'x.yml',
        runId: '9',
        jobName: 'certify',
        read,
      })
    ).resolves.toEqual({ previous: 'failure', runId: 2, runUrl: 'u2' });
    // Two real failures around a superseded run are still a streak.
    expect(decide({ result: 'failure', previous: 'failure' }).record).toBe(true);
  });

  it('club-create-certification.yml stands down exactly that way', () => {
    const wf = parse(
      readFileSync(join(DIR, 'club-create-certification.yml'), 'utf8')
    ) as Workflow & { jobs: Record<string, Job & { outputs?: Record<string, string> }> };
    const certify = wf.jobs.certify;
    const steps = certify.steps || [];
    const names = steps.map((step) => step.name);
    const wait = steps.find(
      (step) => step.name === 'Wait For This Exact Revision On Both Public Endpoints'
    ) as Step & { id?: string };
    expect(wait.id).toBe('live');
    // Superseded only when both endpoints agree on a main descendant of this revision.
    expect(wait.run).toContain('"$origin_sha" == "$public_sha"');
    expect(wait.run).toContain('git merge-base --is-ancestor "$expected" "$origin_sha"');
    expect(wait.run).toContain(
      'git merge-base --is-ancestor "$origin_sha" refs/remotes/origin/main'
    );
    expect(wait.run).toContain('echo "superseded=true" >> "$GITHUB_OUTPUT"');
    // A revision that never arrives still fails the wait itself.
    expect(wait.run).toContain('did not converge on exact revision');

    const stop = steps.find((step) => step.name === SUPERSEDED_STEP) as Step;
    expect(stop.if).toBe("steps.live.outputs.superseded == 'true'");
    // Not red (2026-11-26): it ends green and every fixture step is skipped.
    expect(stop.run).not.toMatch(/exit [1-9]/);
    const fixtureSteps = steps
      .slice(names.indexOf(SUPERSEDED_STEP) + 1)
      .filter((step) => !String(step.if || '').includes('always()'));
    expect(fixtureSteps.length).toBeGreaterThanOrEqual(4);
    for (const step of fixtureSteps)
      expect(step.if, step.name).toBe("steps.live.outputs.superseded != 'true'");
    // It stops the run before the first fixture, account or club is created.
    expect(names.indexOf(SUPERSEDED_STEP)).toBe(names.indexOf(wait.name) + 1);
    expect(names.indexOf(SUPERSEDED_STEP)).toBeLessThan(
      names.indexOf('Verify Opening Grant Capacity Before Creating Fixtures')
    );

    expect(certify.outputs?.superseded).toBe('${{ steps.live.outputs.superseded }}');
    expect(wf.jobs['certification-verdict'].if).toContain(
      "needs.certify.outputs.superseded != 'true'"
    );
  });
});

/* A RETAINED RUNTIME A NEWER PUBLISH REPLACED IS NOT RED (2026-11-26).
   Runs 45758383418, 45770507484 (wait step, `harness`) and 45774223349,
   45892509266 (Resolve step, `receive`) failed with "The actual origin no
   longer serves retained runtime ..." although both endpoints already served a
   protected-main descendant of it (8db042af -> a5e97180, abf538c6 -> 14bd55d8,
   73243beb -> cc88b0de, 2238a163 -> ffbc3e3d): the retained-runtime check ran
   before the wait's supersede rule. It now stands down the same way. */
describe('a retained runtime replaced by a newer main publish stands down as superseded', () => {
  const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  const info = (sha: string, run: string) =>
    Buffer.from(JSON.stringify({ ca_sha: sha, run_id: run, built_by: 'publish-club-arena.yml' }));
  const manifest = Buffer.from('retained manifest');
  const retained = info('8'.repeat(40), '45755697806');
  const receipt = {
    runtimeSha: '8'.repeat(40),
    verificationSha: 'c'.repeat(40),
    originalPublisherRunId: '45755697806',
    buildInfoSHA256: sha256(retained),
    manifestSHA256: sha256(manifest),
  };
  const movedTo = (a: Buffer, b: Buffer) => {
    try {
      assertReceiptOrigins(receipt, [a, b], [Buffer.from('newer'), Buffer.from('newer')]);
    } catch (error) {
      return error;
    }
    throw new Error('origin did not move');
  };
  const newer = 'a'.repeat(40);
  const onMainAbove = (ancestor: string, descendant: string) =>
    descendant === newer && [receipt.runtimeSha, receipt.verificationSha].includes(ancestor);

  it('both endpoints on one main descendant of the runtime and its source: superseded by it', () => {
    const error = movedTo(info(newer, '45757794102'), info(newer, '45757794102'));
    expect(retainedRuntimeSupersededBy(error, receipt, onMainAbove)).toBe(newer);
  });

  it('endpoints that disagree, one endpoint still on the runtime, or garbage: still a failure', () => {
    const other = 'b'.repeat(40);
    expect(
      retainedRuntimeSupersededBy(movedTo(info(newer, '1'), info(other, '2')), receipt, () => true)
    ).toBeNull();
    expect(
      retainedRuntimeSupersededBy(movedTo(info(newer, '1'), retained), receipt, () => true)
    ).toBeNull();
    expect(
      retainedRuntimeSupersededBy(
        movedTo(Buffer.from('{}'), Buffer.from('{}')),
        receipt,
        () => true
      )
    ).toBeNull();
  });

  it('a revision that is not a main descendant of BOTH the runtime and its source: still a failure', () => {
    const error = movedTo(info(newer, '1'), info(newer, '1'));
    expect(retainedRuntimeSupersededBy(error, receipt, () => false)).toBeNull();
    expect(
      retainedRuntimeSupersededBy(error, receipt, (a: string) => a === receipt.runtimeSha)
    ).toBeNull();
    expect(
      retainedRuntimeSupersededBy(error, receipt, (a: string) => a === receipt.verificationSha)
    ).toBeNull();
  });

  it('any other receipt failure is never called superseded', () => {
    expect(
      retainedRuntimeSupersededBy(
        new Error('The complete client backlog differs from its receipt.'),
        receipt,
        () => true
      )
    ).toBeNull();
  });

  it('the retention script stands down only when the caller opts in', () => {
    const body = readFileSync(
      join(process.cwd(), 'scripts/ci/client-runtime-retention.mjs'),
      'utf8'
    );
    expect(body).toContain("process.env.RETAINED_RUNTIME_SUPERSEDE !== 'stand-down'");
    expect(body.match(/await requireCurrentOrSuperseded\(receipt\)/g)?.length).toBe(2);
    // Other workflows that receive or harness a retained runtime keep the strict refusal.
    for (const file of readdirSync(DIR).filter((f) => f !== 'club-create-certification.yml'))
      expect(readFileSync(join(DIR, file), 'utf8'), file).not.toContain(
        'RETAINED_RUNTIME_SUPERSEDE'
      );
  });

  it('club-create-certification.yml opts in on Resolve and the wait, and carries a Resolve stand-down', () => {
    const wf = parse(readFileSync(join(DIR, 'club-create-certification.yml'), 'utf8')) as Workflow;
    const steps = (wf.jobs?.certify.steps || []) as (Step & { id?: string })[];
    const resolve = steps.find((step) => step.id === 'published') as Step;
    const wait = steps.find((step) => step.id === 'live') as Step;
    expect(resolve.env?.RETAINED_RUNTIME_SUPERSEDE).toBe('stand-down');
    expect(wait.env?.RETAINED_RUNTIME_SUPERSEDE).toBe('stand-down');
    expect(resolve.run).toContain('client-runtime-retention.mjs receive');
    const run = wait.run || '';
    const standDown = run.indexOf("'${{ steps.published.outputs.superseded }}' = 'true'");
    expect(standDown).toBeGreaterThan(-1);
    expect(standDown).toBeLessThan(run.indexOf('client-runtime-retention.mjs harness'));
    expect(run).toContain('echo "superseded_by=${{ steps.published.outputs.superseded_by }}"');
    expect(run).toMatch(
      /harness[^\n]*\n\s*if grep -qx 'superseded=true' "\$GITHUB_OUTPUT"; then exit 0; fi/
    );
  });
});
