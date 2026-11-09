/**
 * LAW: AN ENGINE RELEASE IN FLIGHT IS ONE SHARED, ADVISORY ANSWER (2026-11-09).
 *
 * scripts/ci/engine-release-in-flight.mjs tells every lane whether the Stage
 * reservation or the receiver is mid-release, from the run and job state the
 * release lane already produces, so no lane installs a migration under it.
 *
 * What this pins:
 *   1. The job and step names it reads still exist in the two workflows, so a
 *      rename cannot silently turn the answer into a permanent "no".
 *   2. Stage is in flight from its reservation's cutoff wait until its last
 *      job ends; an unadmitted 20-second run is not. The receiver is in flight
 *      only in its release jobs, never in Horse observation or withdrawal.
 *   3. Unreadable is reported as unknown (inFlight null, exit 2), never "no".
 *   4. It is advisory: it only reads (gh api GETs), and no workflow invokes it,
 *      so it can never gate, wait, retry, dispatch or cancel a release.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import {
  RECEIVER_RELEASE_JOBS,
  STAGE_DETECT_JOB,
  STAGE_LATER_JOBS,
  STAGE_WAIT_STEP_PREFIX,
  read,
  receiverPhase,
  stagePhase,
} from '../scripts/ci/engine-release-in-flight.mjs';

const ROOT = resolve(__dirname, '..');
const text = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const wf = (p: string) => parse(text(p)) as Record<string, any>;
const jobNames = (w: Record<string, any>) => Object.values(w.jobs).map((j: any) => j.name);
const stage = wf('.github/workflows/stage-engine-release.yml');
const receiver = wf('.github/workflows/auto-deploy-hetzner.yml');
const SCRIPT = 'scripts/ci/engine-release-in-flight.mjs';

const step = (name: string, status: string) => ({ name, status });
const job = (name: string, status: string, steps: object[] = []) => ({ name, status, steps });
const WAIT = `${STAGE_WAIT_STEP_PREFIX} and bind protected source`;

describe('an engine release in flight is one shared, advisory answer', () => {
  it('reads job and step names that still exist', () => {
    expect(jobNames(stage)).toEqual(
      expect.arrayContaining([STAGE_DETECT_JOB, ...STAGE_LATER_JOBS])
    );
    const detect: any = Object.values(stage.jobs).find((j: any) => j.name === STAGE_DETECT_JOB);
    expect(
      detect.steps.filter((s: any) => String(s.name).startsWith(STAGE_WAIT_STEP_PREFIX))
    ).toHaveLength(1);
    expect(jobNames(receiver)).toEqual(expect.arrayContaining(RECEIVER_RELEASE_JOBS));
  });

  it('calls Stage in flight from the cutoff wait to its last job, and an unadmitted run not', () => {
    expect(
      stagePhase([
        job(STAGE_DETECT_JOB, 'in_progress', [step('Admit', 'in_progress'), step(WAIT, 'queued')]),
      ])
    ).toBeNull();
    expect(
      stagePhase([job(STAGE_DETECT_JOB, 'in_progress', [step(WAIT, 'in_progress')])])
    ).not.toBeNull();
    expect(
      stagePhase([job(STAGE_DETECT_JOB, 'completed'), job(STAGE_LATER_JOBS[2], 'in_progress')])
    ).toBe(STAGE_LATER_JOBS[2]);
    expect(
      stagePhase([job(STAGE_DETECT_JOB, 'completed'), job(STAGE_LATER_JOBS[0], 'completed')])
    ).toBeNull();
    expect(
      receiverPhase([job('Observe One Private Natural Horse Cohort', 'in_progress')])
    ).toBeNull();
    expect(
      receiverPhase([job('Withdraw One Exact Waiting Original Transaction', 'in_progress')])
    ).toBeNull();
    expect(receiverPhase([job(RECEIVER_RELEASE_JOBS[2], 'in_progress')])).toBe(
      RECEIVER_RELEASE_JOBS[2]
    );
  });

  it('answers from the run list and refuses to call unreadable "no"', () => {
    const api = (path: string) => {
      if (path.includes('stage-engine-release.yml'))
        return { workflow_runs: [{ id: 1, html_url: 'u1', event: 'schedule', created_at: 't' }] };
      if (path.includes('auto-deploy-hetzner.yml')) return { workflow_runs: [] };
      if (path.includes('runs/1/jobs'))
        return { jobs: [job(STAGE_DETECT_JOB, 'in_progress', [step(WAIT, 'in_progress')])] };
      throw new Error(path);
    };
    const answer = read('o/r', api);
    expect(answer.inFlight).toBe(true);
    expect(answer.runs).toHaveLength(1);
    expect(read('o/r', () => ({ workflow_runs: [] })).inFlight).toBe(false);
    expect(() => read('o/r', () => ({ message: 'Bad credentials' }))).toThrow();
    expect(text(SCRIPT)).toContain('inFlight: null');
    expect(text(SCRIPT)).toContain('process.exit(2)');
  });

  it('only reads, and no workflow uses it as a gate', () => {
    const code = text(SCRIPT)
      .split('\n')
      .filter((l) => !/^\s*(\*|\/\*\*|\/\/)/.test(l))
      .join('\n');
    expect(code).not.toMatch(/--method|-X\s|POST|PATCH|DELETE|dispatches|statuses/);
    const users = readdirSync(resolve(ROOT, '.github/workflows')).filter((f) =>
      text(`.github/workflows/${f}`).includes('engine-release-in-flight')
    );
    expect(users).toEqual([]);
  });
});
