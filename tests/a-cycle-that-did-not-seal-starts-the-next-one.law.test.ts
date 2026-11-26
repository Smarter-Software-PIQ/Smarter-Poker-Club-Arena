/**
 * LAW: A CYCLE THAT DID NOT SEAL STARTS THE NEXT ONE (O27, 2026-11-25)
 *
 * After a seal the receiver starts "Backup after seal", whose completion is the
 * next cycle's election trigger (O24/O25). After a kept-serving cycle, or a
 * selected cycle whose receiver did not seal, nothing did: GitHub delivered 8
 * of Stage's 96 scheduled runs a day on 2026-11-24/25, so a cycle was prepared
 * only if somebody pushed inside its window. On 2026-11-25 the 07:00 Chicago
 * cycle kept serving and the 10:00 cycle had no Stage run at all (no Stage run
 * created between 13:32Z and 16:37Z).
 *
 * Stage's owner run now waits once to the cycle start + 25 minutes, reads live
 * /health and, when the cycle did not seal, starts ONE Backup of main titled
 * "Backup after keep-serving <cycle>"; Stage admits that run's successful
 * completion as the next election trigger.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';

const root = join(__dirname, '..');
const SCRIPT = join(root, 'scripts/release/next-candidate-after-cycle.py');
const stageText = readFileSync(join(root, '.github/workflows/stage-engine-release.yml'), 'utf8');
const stage = parse(stageText);
const backupText = readFileSync(join(root, '.github/workflows/backup-engine.yml'), 'utf8');
const backup = parse(backupText);
const JOB = 'next-candidate-after-cycle';

const py = (...args: string[]) => {
  const r = spawnSync('python3', ['-B', SCRIPT, ...args], { encoding: 'utf8', timeout: 30_000 });
  const out: Record<string, string> = {};
  for (const line of r.stdout.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1);
  }
  return { status: r.status, out, stderr: r.stderr };
};
const epoch = (iso: string) => Math.floor(Date.parse(iso) / 1000);

const evaluate = (expression: string, context: Record<string, unknown>) => {
  const body = expression
    .replace(/^\$\{\{\s*/, '')
    .replace(/\s*\}\}$/, '')
    .replace(/\b(?:github|inputs)(?:\.[A-Za-z_]+)+/g, (path) => `get(${JSON.stringify(path)})`);
  const get = (path: string) =>
    path
      .split('.')
      .reduce<unknown>(
        (value, key) =>
          value !== null && typeof value === 'object'
            ? ((value as Record<string, unknown>)[key] ?? null)
            : null,
        context
      );
  const format = (template: string, ...values: unknown[]) =>
    template.replace(/\{(\d+)\}/g, (_, i) => String(values[Number(i)] ?? ''));
  const startsWith = (value: unknown, prefix: string) =>
    String(value ?? '')
      .toLowerCase()
      .startsWith(prefix.toLowerCase());
  return new Function('get', 'startsWith', 'format', `return (${body});`)(get, startsWith, format);
};
const completion = (run: Record<string, unknown>) => ({
  github: {
    event_name: 'workflow_run',
    repository: 'test/repo',
    ref: 'refs/heads/main',
    event: {
      workflow_run: {
        event: 'push',
        path: '.github/workflows/backup-engine.yml',
        head_repository: { full_name: 'test/repo' },
        head_branch: 'main',
        run_attempt: 1,
        conclusion: 'success',
        display_title: 'fix: something (#1)',
        ...run,
      },
    },
  },
  inputs: {},
});

describe('when the owner run waits until', () => {
  // Every three-hourly slot, CST and CDT: the target is start + 25 minutes, and
  // from the cutoff (start - 30) the wait is 55 minutes.
  const cases: Array<[string, string]> = [
    ['2026-11-25T01', '2026-11-25T07:00:00Z'],
    ['2026-11-25', '2026-11-25T10:00:00Z'],
    ['2026-11-25T07', '2026-11-25T13:00:00Z'],
    ['2026-11-25T10', '2026-11-25T16:00:00Z'],
    ['2026-11-25T13', '2026-11-25T19:00:00Z'],
    ['2026-11-25T16', '2026-11-25T22:00:00Z'],
    ['2026-11-25T19', '2026-11-26T01:00:00Z'],
    ['2026-11-25T22', '2026-11-26T04:00:00Z'],
    ['2026-07-15T22', '2026-07-16T03:00:00Z'],
    ['2026-07-15', '2026-07-15T09:00:00Z'],
  ];
  it.each(cases)(
    'cycle %s starts at %s: target start + 25m, a 55 m wait from the cutoff',
    (cycle, start) => {
      const s = epoch(start);
      const r = py('plan', '--cycle', cycle, '--now', String(s - 30 * 60));
      expect(r.status, r.stderr).toBe(0);
      expect(Number(r.out.target)).toBe(s + 25 * 60);
      expect(Number(r.out.wait)).toBe(55 * 60);
    }
  );

  it('dispatches at once when the target was missed by a slow runner, refuses far outside the bound', () => {
    const s = epoch('2026-11-25T16:00:00Z');
    expect(py('plan', '--cycle', '2026-11-25T10', '--now', String(s + 40 * 60)).out.wait).toBe('0');
    expect(py('plan', '--cycle', '2026-11-25T10', '--now', String(s + 56 * 60)).status).toBe(2);
    expect(py('plan', '--cycle', '2026-11-25T10', '--now', String(s - 46 * 60)).status).toBe(2);
    expect(py('plan', '--cycle', '2026-11-25T10', '--now', String(s - 45 * 60)).status).toBe(0);
    expect(py('plan', '--cycle', 'tomorrow').status).toBe(2);
  });

  it('any certification of 25 to 124 minutes completes inside the next election window [start + 50, start + 150)', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    const wait = Number(/^WAIT_AFTER_START_MINUTES = (\d+)$/m.exec(src)?.[1]);
    expect(wait).toBe(25);
    // Opens after the +10 migration window and the 04:15 freeze release.
    expect(wait).toBeGreaterThan(15);
    expect(wait + 25).toBe(50);
    expect(wait + 125).toBe(150);
  });
});

describe('whether the cycle sealed', () => {
  const A = 'a'.repeat(40);
  const B = 'b'.repeat(40);
  it.each([
    ['false', A, A, 'true', 'kept serving'],
    ['true', A, A, 'true', 'selected but did not seal'],
    ['true', A, B, 'false', 'sealed'],
    ['false', A, B, 'false', 'sealed'],
    ['false', A, 'unknown', 'true', 'kept serving'],
    ['true', A, 'unknown', 'false', 'could not tell'],
    ['false', '', A, 'true', 'kept serving'],
    ['true', '', A, 'false', 'could not tell'],
  ])(
    'selected=%s selection=%s live=%s -> dispatch=%s (%s)',
    (selected, sel, live, dispatch, reason) => {
      const r = py(
        'decide',
        '--selected',
        selected,
        '--selection-serving',
        sel,
        '--live-serving',
        live
      );
      expect(r.status, r.stderr).toBe(0);
      expect(r.out.dispatch).toBe(dispatch);
      expect(r.out.reason).toContain(reason);
    }
  );
});

describe('the Stage job', () => {
  const job = stage.jobs[JOB];
  it('exists, runs only for the scheduled cycle owner, and only after its selection', () => {
    expect(job.needs).toEqual(['detect', 'selection']);
    expect(job.if).toContain("needs.detect.outputs.daily_preparation == 'true'");
    expect(job.if).toContain("needs.detect.outputs.owner_window_id == ''");
    expect(job.if).toContain("needs.selection.result == 'success'");
    expect(job.if).toContain('github.run_attempt == 1');
    expect(job.if).not.toContain('always()');
  });

  it('can dispatch a workflow and nothing else: no environment, no secret, no issue or status write', () => {
    expect(job.permissions).toEqual({ actions: 'write', contents: 'read' });
    expect(job.environment).toBeUndefined();
    expect(JSON.stringify(job)).not.toMatch(/secrets\./);
    expect(job['continue-on-error']).toBeUndefined();
    const run = job.steps.map((s: { run?: string }) => s.run ?? '').join('\n');
    const writes = [...run.matchAll(/gh api --method (\w+) "([^"]+)"/g)].map(
      (m) => `${m[1]} ${m[2]}`
    );
    expect(writes).toEqual(['POST repos/$REPO/actions/workflows/backup-engine.yml/dispatches']);
    expect(run).toContain(
      '-f ref=main -f \'inputs[refresh]=true\' -f "inputs[after_cycle]=$RELEASE_DATE"'
    );
    // One wait, bounded by the plan and the job timeout.
    expect(run.match(/sleep "\$wait"/g)).toHaveLength(1);
    expect(job['timeout-minutes']).toBe(80);
    expect(job['timeout-minutes']).toBeGreaterThan(70 + 5);
  });

  it('names the run it started or fails out loud', () => {
    const run = job.steps.map((s: { run?: string }) => s.run ?? '').join('\n');
    expect(run).toContain('title="Backup after keep-serving $RELEASE_DATE"');
    expect(run).toContain('no \\"$title\\" run appeared');
  });
});

describe('the Backup it starts is the next election trigger', () => {
  const reservation = 'Automatic Backup daily reservation';
  const outside = 'Backup completion outside election';

  it('Backup names a dispatched next-candidate run, and only that', () => {
    const input = backup.on.workflow_dispatch.inputs.after_cycle;
    expect(input).toMatchObject({ required: false, type: 'string', default: '' });
    const ctx = (
      event: string,
      inputs: Record<string, unknown>,
      payload: Record<string, unknown> = {}
    ) => ({
      github: { event_name: event, event: { client_payload: payload } },
      inputs,
    });
    expect(
      evaluate(backup['run-name'], ctx('workflow_dispatch', { after_cycle: '2026-11-25T10' }))
    ).toBe('Backup after keep-serving 2026-11-25T10');
    expect(evaluate(backup['run-name'], ctx('workflow_dispatch', { after_cycle: '' }))).toBe('');
    expect(evaluate(backup['run-name'], ctx('workflow_dispatch', {}))).toBe('');
    expect(evaluate(backup['run-name'], ctx('push', { after_cycle: '2026-11-25T10' }))).toBe('');
    expect(
      evaluate(
        backup['run-name'],
        ctx('repository_dispatch', {}, { release_run_key: '45408673446-1' })
      )
    ).toBe('Backup after seal 45408673446-1');
  });

  it('Stage admits its successful first-attempt completion on main', () => {
    const keep = {
      event: 'workflow_dispatch',
      display_title: 'Backup after keep-serving 2026-11-25T10',
    };
    expect(evaluate(stage['run-name'], completion(keep))).toBe(reservation);
    expect(evaluate(stage.jobs.detect.if, completion(keep))).toBe(true);
  });

  it.each([
    { event: 'workflow_dispatch', display_title: 'Backup Engine (Clone, Stage, Certify)' },
    { event: 'workflow_dispatch', display_title: 'Backup after seal 1-1' },
    {
      event: 'push',
      display_title: 'Backup after keep-serving 2026-11-25T10',
      conclusion: 'failure',
    },
    {
      event: 'workflow_dispatch',
      display_title: 'Backup after keep-serving 2026-11-25T10',
      conclusion: 'failure',
    },
    {
      event: 'workflow_dispatch',
      display_title: 'Backup after keep-serving 2026-11-25T10',
      run_attempt: 2,
    },
    {
      event: 'workflow_dispatch',
      display_title: 'Backup after keep-serving 2026-11-25T10',
      head_branch: 'x',
    },
    { event: 'repository_dispatch', display_title: 'Backup after keep-serving 2026-11-25T10' },
    { event: 'schedule', display_title: 'Backup after keep-serving 2026-11-25T10' },
  ])('refuses %o', (run) => {
    const ctx = completion(run);
    const isPushSuccess =
      run.event === 'push' && (run as { conclusion?: string }).conclusion !== 'failure';
    if (isPushSuccess) return;
    expect(evaluate(stage['run-name'], ctx)).toBe(outside);
    expect(evaluate(stage.jobs.detect.if, ctx)).toBe(false);
  });

  it('keeps the same election title, so every reader still names the same runs', () => {
    expect(stageText).toContain(
      "startsWith(github.event.workflow_run.display_title, 'Backup after keep-serving ')"
    );
    expect(stageText.match(/'Backup after keep-serving '/g)).toHaveLength(2);
  });
});
