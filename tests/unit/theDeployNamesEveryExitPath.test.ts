/**
 * PHASE 6 (2026-10-31): 0 of 22+ engine releases sealed from 2026-10-29, and
 * every receipt said "did not prove a completed durable Hetzner release
 * transaction" because the deploy job's `release` step wrote no `result=` on
 * the path it exited by. These tests EXECUTE the workflow's own shell.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { deployExitPath } from '../../scripts/ci/record-engine-deploy-exit.mjs';
import { refusalText } from '../../scripts/ci/check-engine-doors-exist.mjs';
import { sliceYamlEntry } from '../helpers/sourceWindow';

const deploy = readFileSync(
  resolve(__dirname, '../..', '.github/workflows/auto-deploy-hetzner.yml'),
  'utf8'
);

/** The `run: |` body of the named step, de-indented exactly as Actions does. */
function stepScript(name: string): string {
  const start = deploy.indexOf(`      - name: ${name}\n`);
  expect(start, `missing step ${name}`).toBeGreaterThan(-1);
  const rest = deploy.slice(start + 1);
  const next = rest.search(/^ {6}- name: |^ {2}[A-Za-z0-9_-]+:\s*$/m);
  const step = next === -1 ? rest : rest.slice(0, next);
  const body = step.slice(step.indexOf('        run: |\n') + '        run: |\n'.length);
  return body
    .split('\n')
    .map((line) => line.slice(10))
    .join('\n');
}

function outputsOf(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const at = line.indexOf('=');
    if (at > 0) out[line.slice(0, at)] = line.slice(at + 1);
  }
  return out;
}

function run(script: string, env: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'deploy-exit-'));
  const output = join(dir, 'out');
  writeFileSync(output, '');
  const result = spawnSync('bash', ['-euo', 'pipefail', '-c', script], {
    encoding: 'utf8',
    timeout: 5000,
    env: { PATH: process.env.PATH, GITHUB_OUTPUT: output, RUNNER_TEMP: dir, ...env },
  });
  return { status: result.status, stderr: result.stderr, outputs: outputsOf(output) };
}

describe('the release step always writes result=', () => {
  const script = stepScript('Dispatch the staged SHA through the durable Hetzner intake');

  it('installs an EXIT trap before its first refusal', () => {
    const trap = script.indexOf('trap name_release_exit EXIT');
    const firstRefusal = script.indexOf('[ $((RELEASE_JOB_DEADLINE_EPOCH');
    expect(trap).toBeGreaterThan(-1);
    expect(trap).toBeLessThan(firstRefusal);
    expect(script).toContain('echo "result=failed:$RELEASE_STAGE" >> "$GITHUB_OUTPUT"');
  });

  it('a budget refusal exits non-zero AND names its stage', () => {
    const r = run(script, {
      RELEASE_JOB_DEADLINE_EPOCH: '1000',
      RELEASE_DISPATCH_DEADLINE_EPOCH: '900',
      POST_RELEASE_RESERVE_SECONDS: '600',
    });
    expect(r.status).not.toBe(0);
    expect(r.outputs.result).toBe('failed:budget');
    expect(r.outputs.failed_stage).toMatch(/^budget \(exit \d+\)$/);
  });

  it('every path that writes an outcome marks it written, so the trap stays quiet', () => {
    expect(script).toMatch(
      /echo "result=superseded" >> "\$GITHUB_OUTPUT"[\s\S]*?RESULT_EMITTED=true/
    );
    expect(script).toMatch(/echo "result=\$RESULT" >> "\$GITHUB_OUTPUT"\n\s*RESULT_EMITTED=true/);
    for (const stage of ['intake', 'observe', 'reattach', 'receipt'])
      expect(script).toContain(`RELEASE_STAGE=${stage}`);
  });

  it('exposes the failed stage to the receipt', () => {
    expect(deploy).toContain("release_failure: ${{ steps.release.outputs.failed_stage || '' }}");
    expect(deploy).toContain('needs.deploy.outputs.release_failure && format(');
  });
});

describe('the deploy job names its exit path', () => {
  const script = stepScript("Name this deploy job's exit path");
  const outcomes = (over: Record<string, string>) =>
    [
      'deadline',
      'checkout',
      'freshness',
      'admit',
      'ssh',
      'stage',
      'prepare',
      'floor',
      'release',
      'verify',
    ]
      .map((name) => `${name}=${over[name] ?? 'success'}`)
      .join(' ');

  it('a fully successful, verified run is shipped at stage complete', () => {
    const r = run(script, {
      STEP_OUTCOMES: outcomes({}),
      RELEASE_RESULT: 'sealed',
      RELEASE_FAILED_STAGE: '',
      VERIFIED: 'true',
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.outputs).toMatchObject({ stage: 'complete', outcome: 'shipped', error: '' });
  });

  it('names the first step that failed, not the skipped ones after it', () => {
    const r = run(script, {
      STEP_OUTCOMES: outcomes({
        prepare: 'failure',
        floor: 'skipped',
        release: 'skipped',
        verify: 'skipped',
      }),
      RELEASE_RESULT: '',
      RELEASE_FAILED_STAGE: '',
      VERIFIED: 'false',
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.outputs).toMatchObject({
      stage: 'prepare',
      outcome: 'failure',
      error: 'step prepare ended failure',
    });
  });

  it('a failed release carries the release stage it stopped at', () => {
    const r = run(script, {
      STEP_OUTCOMES: outcomes({ release: 'failure', verify: 'skipped' }),
      RELEASE_RESULT: 'failed:observe',
      RELEASE_FAILED_STAGE: 'observe (exit 70)',
      VERIFIED: 'false',
    });
    expect(r.outputs).toMatchObject({
      stage: 'release',
      outcome: 'failure',
      error: 'release failed at observe (exit 70)',
    });
  });

  it('a superseded release is a stand-down, not a failure', () => {
    const r = run(script, {
      STEP_OUTCOMES: outcomes({ release: 'failure', verify: 'skipped' }),
      RELEASE_RESULT: 'superseded',
      RELEASE_FAILED_STAGE: '',
      VERIFIED: 'false',
    });
    expect(r.outputs).toMatchObject({ stage: 'release', outcome: 'superseded' });
  });

  it('runs on every exit of the job', () => {
    expect(sliceYamlEntry(deploy, "- name: Name this deploy job's exit path")).toContain(
      'if: always()'
    );
  });
});

describe('the recorder writes one row for every exit path', () => {
  it('a refused prerequisite is the engine-doors stage, with the refusal as its error', () => {
    expect(
      deployExitPath({
        DOORS_RESULT: 'failure',
        DOORS_REFUSAL: 'missing database function fn_ca_x()',
        DEPLOY_RESULT: 'skipped',
      })
    ).toEqual({
      stage: 'engine-doors',
      outcome: 'failure',
      error: 'missing database function fn_ca_x()',
    });
  });

  it('a cancelled job that never named itself is still recorded, as what it was', () => {
    expect(deployExitPath({ DOORS_RESULT: 'success', DEPLOY_RESULT: 'cancelled' })).toEqual({
      stage: 'deploy',
      outcome: 'cancelled',
      error: 'deploy job ended cancelled before naming its exit path',
    });
  });

  it('passes the named exit path through', () => {
    expect(
      deployExitPath({
        DOORS_RESULT: 'success',
        DEPLOY_RESULT: 'failure',
        EXIT_STAGE: 'release',
        EXIT_OUTCOME: 'failure',
        EXIT_ERROR: 'release failed at observe (exit 70)',
      })
    ).toEqual({
      stage: 'release',
      outcome: 'failure',
      error: 'release failed at observe (exit 70)',
    });
  });

  it('is wired into the receipt job on always()', () => {
    const at = deploy.indexOf("      - name: Record this run's deploy exit path\n");
    expect(at).toBeGreaterThan(-1);
    const step = sliceYamlEntry(deploy, "- name: Record this run's deploy exit path");
    expect(step).toContain('if: always()');
    expect(step).toContain('node scripts/ci/record-engine-deploy-exit.mjs');
    expect(step).toContain("DOORS_REFUSAL: ${{ needs['engine-doors'].outputs.refusal }}");
  });
});

describe('engine-doors names the missing function', () => {
  it('as one bounded line', () => {
    expect(refusalText('missing', ['fn_ca_a'])).toBe('missing database function fn_ca_a()');
    expect(refusalText('missing', ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])).toBe(
      'missing database functions a(), b(), c(), d(), e(), f(), +2 more'
    );
    expect(refusalText('continuation migration unproved', ['20261031000000'])).toBe(
      'continuation migration unproved 20261031000000'
    );
  });
  it('and the job carries it to the receipt', () => {
    expect(deploy).toContain("refusal: ${{ steps.doors.outputs.refusal || '' }}");
    expect(deploy).toContain(
      "needs['engine-doors'].outputs.refusal || 'the refusal did not name itself'"
    );
  });
});
