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
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

  it('dispatches one workflow and sends one note, nothing else; the key lives only in the note step', () => {
    expect(job.permissions).toEqual({ actions: 'write', contents: 'read' });
    expect(job.environment).toBe('ci-main');
    expect(job['continue-on-error']).toBeUndefined();
    type Step = {
      id?: string;
      run?: string;
      env?: Record<string, string>;
      if?: string;
      'continue-on-error'?: boolean;
    };
    const steps = job.steps as Step[];
    const withSecrets = steps.filter((s) => /secrets\./.test(JSON.stringify(s)));
    expect(withSecrets).toHaveLength(1);
    const noteStep = withSecrets[0];
    const env = noteStep.env ?? {};
    expect(
      Object.keys(env)
        .filter((k) => /secrets\./.test(env[k]))
        .sort()
    ).toEqual(['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL']);
    expect(noteStep.if).toBe("steps.next.outputs.did_not_seal == 'true'");
    expect(noteStep['continue-on-error']).toBe(true);
    expect(noteStep.run).toContain('"$SUPABASE_URL/rest/v1/rpc/fn_ca_note_cycle_did_not_seal"');
    expect(noteStep.run?.match(/curl /g)).toHaveLength(1);
    const next = steps.find((s) => s.id === 'next');
    expect(JSON.stringify(next)).not.toMatch(/secrets\./);
    expect(next?.run).toContain('echo "did_not_seal=true" >> "$GITHUB_OUTPUT"');
    const run = steps.map((s) => s.run ?? '').join('\n');
    const writes = [...run.matchAll(/gh api --method (\w+) "([^"]+)"/g)].map(
      (m) => `${m[1]} ${m[2]}`
    );
    expect(writes).toEqual(['POST repos/$REPO/actions/workflows/backup-engine.yml/dispatches']);
    // 2026-11-26: the body is the recorded intent (scripts/ci/dispatch-intent.mjs),
    // published on this run attempt before it is sent.
    expect(run).toContain('--input "$RUNNER_TEMP/backup-after-keep-serving.json"');
    expect(run).toContain(
      'node scripts/ci/dispatch-intent.mjs write --operation backup-after-keep-serving'
    );
    const names = steps.map((s) => (s as { name?: string }).name ?? '');
    expect(names.indexOf('Publish the intent on this exact run attempt')).toBeLessThan(
      names.indexOf('Start exactly the recorded Backup')
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

// The database side (one note per cycle, service_role only) is pinned by
// tests/a-missed-cycle-note-reaches-the-owner-once.law.test.ts with migration 20261126031810.
describe('the owner note says it plainly, once per cycle', () => {
  const sel = (o: object) => {
    const f = join(tmpdir(), `sel-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(f, JSON.stringify(o));
    return f;
  };
  const noteFor = (cycle: string, selected: string, selection: object) =>
    py('note', '--cycle', cycle, '--selected', selected, '--selection', sel(selection)).out.note ??
    '';
  const NO_EVIDENCE = 'No newer protected candidate has complete current evidence by the cutoff.';

  it('names the cycle and the next one in Chicago time and gives one plain reason', () => {
    expect(noteFor('2026-11-25T22', 'false', { reason: NO_EVIDENCE, deferredCandidates: [] })).toBe(
      'Engine cutover at 10:00 PM CST did not happen: no new build passed its test in time. The current engine keeps running, and the next build is being tested for the 1:00 AM CST cutover.'
    );
    expect(
      noteFor('2026-11-25T07', 'false', {
        reason: 'x',
        deferredCandidates: [
          { sha: 'a', reason: 'serving rollback rehearsal unavailable' },
          { sha: 'b', reason: 'Backup copy lacks installed migration 20261125171024' },
        ],
      })
    ).toContain('did not happen: a database update landed after the new build was tested.');
    expect(
      noteFor('2026-11-25T13', 'false', {
        reason: 'x',
        deferredCandidates: [{ sha: 'a', reason: 'serving rollback rehearsal unavailable' }],
      })
    ).toContain('the newest build had been tested against an older engine');
    expect(noteFor('2026-11-25', 'true', {})).toBe(
      'Engine cutover at 4:00 AM CST did not happen: the new build was chosen but the swap did not complete. The current engine keeps running, and the next build is being tested for the 7:00 AM CST cutover.'
    );
    expect(noteFor('2026-11-25T16', 'false', { reason: 'something new' })).toContain(
      'no new build was ready'
    );
  });

  it('says nothing when the cycle had nothing new to ship', () => {
    expect(noteFor('2026-11-25T16', 'false', { reason: 'current', deferredCandidates: [] })).toBe(
      ''
    );
  });

  it('is plain copy: no em dash, no SHA, within the database limit', () => {
    for (const n of [
      noteFor('2026-11-25T22', 'false', { reason: NO_EVIDENCE }),
      noteFor('2026-11-25', 'true', {}),
    ]) {
      expect(n.length).toBeGreaterThan(0);
      expect(n).not.toContain('—');
      expect(n).not.toMatch(/[0-9a-f]{12}/);
      expect(n.length).toBeLessThanOrEqual(500);
    }
  });
});

describe('the kept-serving Backup is a proved job-token intent (2026-11-26)', () => {
  // The O27 dispatch used the job token; backup-engine.yml refuses job-token
  // dispatches in refresh and certify, so the run certified nothing.
  const backupDoc = backup;
  it('Backup admits it only through the intent proof, in refresh and certify', () => {
    for (const name of ['refresh', 'certify']) {
      const job = backupDoc.jobs[name];
      expect(String(job.if)).toContain(
        "(github.event_name == 'workflow_dispatch' && inputs.after_cycle != '')"
      );
      const prove = job.steps[0];
      expect(prove.name).toBe(
        'Prove a job-token dispatch is the exact intent its trusted sender recorded'
      );
      expect(String(prove.if)).toContain("github.event_name == 'workflow_dispatch'");
      expect(String(prove.run)).toContain('prove --receiver backup-after-keep-serving');
    }
    for (const input of ['intent_run_id', 'intent_run_attempt', 'intent_nonce'])
      expect(backupDoc.on.workflow_dispatch.inputs[input].default).toBe('');
  });
});
