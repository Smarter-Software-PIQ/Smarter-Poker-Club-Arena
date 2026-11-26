/**
 * LAW - A PULL_REQUEST_TARGET JOB NEVER RUNS FORK CODE BESIDE A CREDENTIAL
 *
 * This repository is public, so anyone can open a pull request from a fork.
 * A pull_request_target workflow runs with the repository's secrets (the
 * service role key, the database URL, the GitHub App key) even for such a
 * pull request. Every such job here already follows one of two patterns:
 *
 *   - it checks out the default branch only and treats the pull request as
 *     data it never runs (settlement-lane-doctrine, hand-path-shared-writes,
 *     migration-ledger-reconciled), or
 *   - it reads the pull request's own code, and its `if:` admits only a
 *     pull request whose head is in this repository (pr-engine-doors,
 *     window-migrations-install-before-merge, money-trigger-recovery).
 *
 * On 2026-11-26 a review listed three of the first kind as "no fork gate".
 * They need none, because no pull-request code runs beside the key. This law
 * keeps that true for every pull_request_target job, current and future:
 *
 *   1. a job that holds a secret and reads the pull request's code (checks out
 *      a ref that is not the default branch, or fetches refs/pull/ or the head
 *      commit) is fork-gated in its own `if:` or through a job it needs;
 *   2. a job that holds a secret and is not fork-gated names the default
 *      branch on every checkout, so the code beside the key is always main's.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const DIR = join(__dirname, '..', '.github', 'workflows');
const FORK_GATE = /(head\.repo|head_repository)\.full_name\s*==\s*github\.repository/;
const SECRET = /secrets\.(?!GITHUB_TOKEN\b)[A-Za-z_][A-Za-z0-9_]*/;
const DEFAULT_REF = /^\$\{\{\s*github\.event\.repository\.default_branch\s*\}\}$/;
const READS_PR_IN_SHELL =
  /refs\/pull\/|pull_request\.head\.(sha|ref)|github\.head_ref|\$\{?HEAD_SHA\b/;

type Step = { uses?: string; run?: string; with?: Record<string, unknown> };
type Job = { if?: unknown; needs?: string | string[]; steps?: Step[] };

const isCheckout = (s: Step) => /^actions\/checkout@/.test(s.uses ?? '');

function readsPullRequest(job: Job): boolean {
  return (job.steps ?? []).some((s) => {
    if (isCheckout(s)) {
      const ref = String(s.with?.ref ?? '');
      return ref !== '' && !DEFAULT_REF.test(ref) && !/pull_request\.base\./.test(ref);
    }
    return READS_PR_IN_SHELL.test(s.run ?? '');
  });
}

const targetWorkflows = readdirSync(DIR)
  .filter((f) => /\.ya?ml$/.test(f))
  .map((f) => ({ file: f, wf: parse(readFileSync(join(DIR, f), 'utf8')) }))
  .filter(({ wf }) => {
    const on = wf?.on ?? wf?.[true as unknown as string];
    return on && typeof on === 'object' && 'pull_request_target' in on;
  });

function gatedJobs(jobs: Record<string, Job>): Set<string> {
  const gated = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const [id, job] of Object.entries(jobs)) {
      if (gated.has(id)) continue;
      const cond = String(job.if ?? '');
      const needs = ([] as string[]).concat(job.needs ?? []);
      // A dependent of a skipped job is skipped too, unless its condition
      // forces it to run regardless; then it must name a success of the gate.
      const viaNeeds = needs.some(
        (n) =>
          gated.has(n) &&
          (!/always\(\)|!\s*cancelled\(\)/.test(cond) ||
            new RegExp(`needs\\.${n}\\.(result\\s*==\\s*'success'|outputs\\.)`).test(cond))
      );
      if (FORK_GATE.test(cond) || viaNeeds) {
        gated.add(id);
        grew = true;
      }
    }
  }
  return gated;
}

describe('LAW: a pull_request_target job never runs fork code beside a credential', () => {
  it('finds the pull_request_target workflows', () => {
    expect(targetWorkflows.length).toBeGreaterThan(5);
  });

  it('a job that holds a secret and reads the pull request is fork-gated', () => {
    const offenders: string[] = [];
    for (const { file, wf } of targetWorkflows) {
      const jobs = (wf.jobs ?? {}) as Record<string, Job>;
      const gated = gatedJobs(jobs);
      for (const [id, job] of Object.entries(jobs)) {
        if (SECRET.test(JSON.stringify(job)) && readsPullRequest(job) && !gated.has(id)) {
          offenders.push(`${file}:${id}`);
        }
      }
    }
    expect(offenders, 'gate it on head.repo.full_name == github.repository').toEqual([]);
  });

  it('an ungated job that holds a secret checks out the default branch by name', () => {
    const offenders: string[] = [];
    for (const { file, wf } of targetWorkflows) {
      const jobs = (wf.jobs ?? {}) as Record<string, Job>;
      const gated = gatedJobs(jobs);
      for (const [id, job] of Object.entries(jobs)) {
        if (gated.has(id) || !SECRET.test(JSON.stringify(job))) continue;
        for (const s of (job.steps ?? []).filter(isCheckout)) {
          if (!DEFAULT_REF.test(String(s.with?.ref ?? ''))) offenders.push(`${file}:${id}`);
        }
      }
    }
    expect(offenders, 'add ref: ${{ github.event.repository.default_branch }}').toEqual([]);
  });

  it('the gate recognizes the patterns the guarded workflows use', () => {
    const doors = targetWorkflows.find((w) => w.file === 'pr-engine-doors.yml');
    expect(doors).toBeDefined();
    expect(gatedJobs(doors!.wf.jobs).has('doors')).toBe(true);
    expect(readsPullRequest(doors!.wf.jobs.doors)).toBe(true);
  });
});
