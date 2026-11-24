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
  // @ts-expect-error untyped CI module
} from '../../scripts/ci/certification-failure-streak.mjs';

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
