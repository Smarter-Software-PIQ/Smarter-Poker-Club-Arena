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
 * "Backup after keep-serving <cycle> <nonce>".
 *
 * O27b (2026-11-26). Live, run 45775146770 was dispatched with the job token,
 * had refresh and certify skipped by Backup's job-token refusal and ended
 * green in nine seconds, and no Stage run followed it. So:
 *   - Stage records the exact dispatch intent on its own run BEFORE sending,
 *     and Backup's refresh and certify admit exactly that event and prove it;
 *   - a keep-serving Backup that certified nothing is red, and Stage fails
 *     when the run it started skipped its refresh job;
 *   - GitHub creates no workflow_run for a run the job token started, so
 *     that completion is NOT an election trigger; Stage's listener clause
 *     admits the titled run only when GitHub delivers it (a person's run).
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

  it('a real certification is written before the next cutoff, and a completion inside 25 minutes is never a certificate', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    const constant = (name: string) => Number(new RegExp(`^${name} = (\\d+)$`, 'm').exec(src)?.[1]);
    const wait = constant('WAIT_AFTER_START_MINUTES');
    const cutoff = constant('NEXT_CUTOFF_AFTER_START_MINUTES');
    const opens = constant('ELECTION_OPENS_AFTER_START_MINUTES');
    const certification = constant('CERTIFICATION_MINUTES');
    expect(wait).toBe(25);
    // Opens after the +10 migration window and the 04:15 freeze release.
    expect(wait).toBeGreaterThan(15);
    // Three-hourly: next start = start + 180; cutoff = next - 30; the election
    // window is the 100 minutes before the cutoff.
    expect(cutoff).toBe(180 - 30);
    expect(opens).toBe(cutoff - 100);
    // plan 1 + refresh 15 + certify 55, inside the job timeouts Backup allows.
    expect(certification).toBe(1 + 15 + 55);
    expect(backup.jobs.certify['timeout-minutes']).toBeGreaterThanOrEqual(55);
    // The certificate is written 54 minutes before the cutoff.
    expect(wait + certification).toBe(96);
    expect(cutoff - (wait + certification)).toBe(54);
    // A run of 25 to 124 minutes completes inside [start + 50, start + 150);
    // a real certification (71) is one, a three-minute run never is.
    expect(wait + 25).toBe(opens);
    expect(wait + 124).toBeLessThan(cutoff);
    expect(wait + certification).toBeGreaterThanOrEqual(opens);
    expect(wait + 3).toBeLessThan(opens);
    // The script says plainly what the completion does not do.
    expect(src).toContain('does NOT start the next election');
    expect(src).not.toContain('admitted exactly like a push Backup');
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

  // 2026-11-27 (the estate App starts the next cycle): the send moved to its
  // own job, start-backup-as-estate-app, because the App key lives in another
  // main-only environment than the Messenger note's. The pins below follow the
  // send to that job unchanged; the recording job can no longer send at all.
  const sender = stage.jobs['start-backup-as-estate-app'];
  it('dispatches one workflow and sends one note, nothing else; the key lives only in the note step', () => {
    expect(job.permissions).toEqual({ actions: 'read', contents: 'read' });
    expect(sender.permissions).toEqual({ actions: 'write' });
    expect(sender.needs).toEqual(['detect', 'next-candidate-after-cycle']);
    expect(sender['continue-on-error']).toBeUndefined();
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
    const writesOf = (text: string) =>
      [...text.matchAll(/gh api --method (\w+) "([^"]+)"/g)].map((m) => `${m[1]} ${m[2]}`);
    // The recording job writes nothing to GitHub; the sending job writes the
    // one dispatch, once in its source (one send function, one body).
    expect(writesOf(run)).toEqual([]);
    const sending = (sender.steps as Step[]).map((s) => s.run ?? '').join('\n');
    expect(writesOf(sending)).toEqual([
      'POST repos/$REPO/actions/workflows/backup-engine.yml/dispatches',
    ]);
    // O27b: the body is the one the recorded intent printed, never typed here.
    expect(run).not.toContain('inputs[refresh]');
    expect(sending).not.toContain('inputs[refresh]');
    expect(run).toContain(
      'echo "dispatch_body=$(cat "$RUNNER_TEMP/keep-serving-dispatch.json")" >> "$GITHUB_OUTPUT"'
    );
    expect(sending).toContain(
      'printf \'%s\' "$DISPATCH_BODY" > "$RUNNER_TEMP/keep-serving-dispatch.json"'
    );
    expect(sending).toContain(
      'gh api --method POST "repos/$REPO/actions/workflows/backup-engine.yml/dispatches" --input "$RUNNER_TEMP/keep-serving-dispatch.json"'
    );
    // One wait, bounded by the plan and the job timeout.
    expect(run.match(/sleep "\$wait"/g)).toHaveLength(1);
    expect(job['timeout-minutes']).toBe(80);
    expect(job['timeout-minutes']).toBeGreaterThan(70 + 5);
  });

  it('names the run it started or fails out loud', () => {
    const run = sender.steps.map((s: { run?: string }) => s.run ?? '').join('\n');
    expect(run).toContain('title="Backup after keep-serving $RELEASE_DATE $INTENT_NONCE"');
    expect(run).toContain('no \\"$title\\" run appeared');
  });

  it('records the exact intent on its own run before it sends anything (O27b)', () => {
    type Step = {
      id?: string;
      name?: string;
      run?: string;
      uses?: string;
      if?: string;
      with?: Record<string, string>;
    };
    const steps = job.steps as Step[];
    const at = (test: (s: Step) => boolean) => steps.findIndex(test);
    const decided = at((s) => s.id === 'next');
    const wrote = at((s) => s.id === 'intent');
    const published = at((s) => String(s.uses ?? '').startsWith('actions/upload-artifact@'));
    expect(decided).toBeGreaterThan(0);
    expect(wrote).toBeGreaterThan(decided);
    expect(published).toBe(wrote + 1);
    // Nothing in the recording job sends; the send is the job that needs it,
    // so it can only start after the intent is recorded and published.
    expect(at((s) => String(s.run ?? '').includes('/dispatches'))).toBe(-1);
    for (const index of [wrote, published])
      expect(steps[index].if).toBe("steps.next.outputs.did_not_seal == 'true'");
    expect(job.outputs).toEqual({
      did_not_seal: '${{ steps.next.outputs.did_not_seal }}',
      reason: '${{ steps.next.outputs.reason }}',
      nonce: '${{ steps.intent.outputs.nonce }}',
      dispatch_body: '${{ steps.intent.outputs.dispatch_body }}',
    });
    const sendSteps = sender.steps as Step[];
    const sent = sendSteps.findIndex((s) => String(s.run ?? '').includes('/dispatches'));
    expect(sent).toBeGreaterThan(-1);
    expect(sender.needs).toContain(JOB);
    expect(sender.if).toContain(`needs.${JOB}.outputs.did_not_seal == 'true'`);
    expect(sender.if).toContain('github.run_attempt == 1');
    expect(sender.if).not.toContain('always()');
    expect(steps[wrote].run).toContain(
      'node scripts/ci/dispatch-intent.mjs write --operation backup-after-keep-serving --dir "$RUNNER_TEMP/dispatch-intents"'
    );
    expect(steps[wrote].run).toContain('--input "after_cycle=$RELEASE_DATE" --input refresh=true');
    expect(steps[published].with).toMatchObject({
      name: 'dispatch-intents-${{ github.run_attempt }}',
      path: '${{ runner.temp }}/dispatch-intents',
      'if-no-files-found': 'error',
    });
    // The sender checks the body it is about to send against what was
    // decided and against this exact run attempt, and admits no other field.
    expect(sendSteps[sent].run).toContain(
      '.ref == "main" and .inputs.after_cycle == $cycle and .inputs.refresh == "true" and .inputs.intent_nonce == $nonce'
    );
    expect(sendSteps[sent].run).toContain(
      'and .inputs.intent_run_id == $run and .inputs.intent_run_attempt == $attempt and ((.inputs | keys | length) == 5) and ((keys | length) == 2)'
    );
    expect(sendSteps[sent].run).toContain('[[ "$INTENT_NONCE" =~ ^[0-9a-f]{32}$ ]]');
    // The sparse checkout carries the script it runs.
    expect(JSON.stringify(steps[0])).toContain('scripts/ci/dispatch-intent.mjs');
    // The wait/decide step sends nothing any more.
    expect(steps[decided].run).not.toContain('gh api');
  });

  it('fails when the run it started skipped its refresh job, and says "could not tell" as a warning (O27b)', () => {
    const run = sender.steps.map((s: { run?: string }) => s.run ?? '').join('\n');
    expect(run).toContain('"repos/$REPO/actions/runs/$backup_id/jobs?per_page=100"');
    expect(run).toContain(
      'if . == null then "unknown" elif .conclusion == "skipped" then "skipped" else "admitted" end'
    );
    expect(run).toMatch(
      /if \[ "\$refresh" = skipped \]; then\n\s+echo "::error title=KEEP-SERVING BACKUP REFUSED::[^\n]+\n\s+exit 1/
    );
    expect(run).toContain('::warning title=KEEP-SERVING BACKUP UNKNOWN::');
    // Bounded reads, no open-ended loop.
    expect(run).toContain('for _ in $(seq 1 24); do');
    expect(run).not.toMatch(/while (true|:)/);
    // It claims the completion starts the election only for a run GitHub
    // itself records as started by the estate App (read back, never assumed
    // from the token that was used), and says the opposite for any other.
    expect(run).not.toContain('starts the next election');
    expect(run).toMatch(
      /if \[ "\$actor" = 'smarter-poker-autopilot\[bot\]' \]; then\n\s*elects="Its completion starts the next cycle's election \(started by \$actor\)\."\n\s*else\n\s*elects="Its completion does not start the election/
    );
    expect(run.match(/Its completion starts the next cycle's election/g)).toHaveLength(1);
  });
});

describe('the keep-serving Backup proves its intent and is never green for nothing (O27b)', () => {
  const ADMITTED = "(github.event_name == 'workflow_dispatch' && inputs.after_cycle != '')";
  const REFUSAL =
    "!((github.event_name == 'workflow_dispatch' || github.event_name == 'repository_dispatch') && (github.actor == 'github-actions[bot]' || github.triggering_actor == 'github-actions[bot]'))";
  const PROVE = 'Prove a job-token dispatch is the exact intent its trusted sender recorded';

  it.each(['refresh', 'certify'])(
    '%s admits exactly the after_cycle dispatch and proves it first',
    (name) => {
      const job = backup.jobs[name];
      expect(job.if).toContain(
        `(${REFUSAL} || (github.event_name == 'repository_dispatch' && github.event.action == 'run-post-deploy-e2e') || ${ADMITTED})`
      );
      const first = job.steps[0];
      expect(first.name).toBe(PROVE);
      expect(first.if).toContain(
        "(github.event_name == 'repository_dispatch' || github.event_name == 'workflow_dispatch')"
      );
      expect(first.run).toMatch(
        /if \[ "\$\{GITHUB_EVENT_NAME:-\}" = workflow_dispatch \]; then\n\s+node "\$RUNNER_TEMP\/dispatch-intent\.mjs" prove --receiver backup-after-keep-serving\n\s*else\n\s+node "\$RUNNER_TEMP\/dispatch-intent\.mjs" prove --receiver backup-after-seal\n\s*fi/
      );
      // Nothing of the job runs before the proof.
      expect(JSON.stringify(first)).not.toMatch(/secrets\./);
    }
  );

  it('declares the three intent inputs, empty for a person, and an empty default for sha', () => {
    const inputs = backup.on.workflow_dispatch.inputs;
    for (const key of ['intent_run_id', 'intent_run_attempt', 'intent_nonce'])
      expect(inputs[key]).toMatchObject({ required: false, type: 'string', default: '' });
    expect(inputs.sha).toMatchObject({ required: false, type: 'string', default: '' });
    expect(Object.keys(inputs).sort()).toEqual([
      'after_cycle',
      'intent_nonce',
      'intent_run_attempt',
      'intent_run_id',
      'refresh',
      'sha',
    ]);
  });

  it('a keep-serving Backup whose work was skipped is red', () => {
    const job = backup.jobs['keep-serving-outcome'];
    expect(job.needs).toEqual(['plan', 'refresh', 'certify']);
    expect(job.if).toBe(
      "always() && github.event_name == 'workflow_dispatch' && inputs.after_cycle != ''"
    );
    expect(job.permissions).toEqual({});
    expect(job.environment).toBeUndefined();
    expect(JSON.stringify(job)).not.toMatch(/secrets\.|github\.token/);
    const step = job.steps[0];
    expect(step.env).toMatchObject({
      PLAN: '${{ needs.plan.result }}',
      PLANNED: '${{ needs.plan.outputs.sha }}',
      REFRESH: '${{ needs.refresh.result }}',
      DEFERRED: '${{ needs.refresh.outputs.deferred }}',
      CERTIFY: '${{ needs.certify.result }}',
    });
    // Run the step's own script against the outcomes that matter.
    const outcome = (env: Record<string, string>) =>
      spawnSync('bash', ['-c', step.run], {
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH ?? '',
          CYCLE: '2026-11-26T01',
          GITHUB_STEP_SUMMARY: '/dev/null',
          ...env,
        },
      });
    const sha = 'c'.repeat(40);
    // Run 45775146770: planned, then both jobs skipped by the refusal.
    const refused = outcome({
      PLAN: 'success',
      PLANNED: sha,
      REFRESH: 'skipped',
      DEFERRED: '',
      CERTIFY: 'skipped',
    });
    expect(refused.status).toBe(1);
    expect(refused.stdout).toContain('KEEP-SERVING BACKUP CERTIFIED NOTHING');
    expect(
      outcome({
        PLAN: 'success',
        PLANNED: sha,
        REFRESH: 'success',
        DEFERRED: '',
        CERTIFY: 'skipped',
      }).status
    ).toBe(1);
    expect(
      outcome({
        PLAN: 'success',
        PLANNED: sha,
        REFRESH: 'failure',
        DEFERRED: '',
        CERTIFY: 'failure',
      }).status
    ).toBe(1);
    expect(
      outcome({
        PLAN: 'success',
        PLANNED: sha,
        REFRESH: 'success',
        DEFERRED: '',
        CERTIFY: 'cancelled',
      }).status
    ).toBe(1);
    expect(
      outcome({
        PLAN: 'failure',
        PLANNED: '',
        REFRESH: 'skipped',
        DEFERRED: '',
        CERTIFY: 'skipped',
      }).status
    ).toBe(1);
    // Certified, or one of the two documented nothing-to-certify outcomes.
    expect(
      outcome({
        PLAN: 'success',
        PLANNED: sha,
        REFRESH: 'success',
        DEFERRED: '',
        CERTIFY: 'success',
      }).status
    ).toBe(0);
    expect(
      outcome({
        PLAN: 'success',
        PLANNED: sha,
        REFRESH: 'success',
        DEFERRED: '1',
        CERTIFY: 'skipped',
      }).status
    ).toBe(0);
    expect(
      outcome({
        PLAN: 'success',
        PLANNED: '',
        REFRESH: 'skipped',
        DEFERRED: '',
        CERTIFY: 'skipped',
      }).status
    ).toBe(0);
  });

  it("a person's manual dispatch is untouched: the refusal names only the job token", () => {
    for (const name of ['refresh', 'certify']) {
      const condition = String(backup.jobs[name].if);
      expect(condition).toContain("github.actor == 'github-actions[bot]'");
      expect(condition).not.toMatch(/inputs\.sha|inputs\.intent_/);
    }
    // plan holds no secret and admits the dispatch as before.
    expect(backup.jobs.plan.if).toBe(
      "github.ref == 'refs/heads/main' && (github.event_name != 'repository_dispatch' || github.event.client_payload.release_run_key != '')"
    );
  });
});

// O27b: GitHub delivers this completion only for a run a person (or a push)
// started. The run Stage starts with the job token fires no workflow_run, so
// these pins describe what Stage admits WHEN the event exists, nothing more.
describe('Stage admits a delivered keep-serving Backup completion', () => {
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
    // O27b: Stage's dispatch carries its one-time nonce in the title (the
    // one-time rule of dispatch-intent.mjs), still under the same prefix.
    const nonce = '0123456789abcdef0123456789abcdef';
    expect(
      evaluate(
        backup['run-name'],
        ctx('workflow_dispatch', { after_cycle: '2026-11-25T10', intent_nonce: nonce })
      )
    ).toBe(`Backup after keep-serving 2026-11-25T10 ${nonce}`);
    expect(evaluate(backup['run-name'], ctx('workflow_dispatch', { intent_nonce: nonce }))).toBe(
      ''
    );
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
    // O32 (2026-11-26): a Backup that failed or timed out elects like one
    // that succeeded (the election needs an event, not a certificate; pinned
    // by tests/every-cycle-has-an-owner-or-says-so.law.test.ts). A cancelled
    // or skipped one still does not.
    {
      event: 'workflow_dispatch',
      display_title: 'Backup after keep-serving 2026-11-25T10',
      conclusion: 'cancelled',
    },
    {
      event: 'workflow_dispatch',
      display_title: 'Backup after keep-serving 2026-11-25T10',
      conclusion: 'skipped',
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
    expect(evaluate(stage['run-name'], ctx)).toBe(outside);
    expect(evaluate(stage.jobs.detect.if, ctx)).toBe(false);
  });

  it.each(['failure', 'timed_out'])(
    'admits its first-attempt completion on main when the Backup ended %s (O32)',
    (conclusion) => {
      const ctx = completion({
        event: 'workflow_dispatch',
        display_title: 'Backup after keep-serving 2026-11-25T10',
        conclusion,
      });
      expect(evaluate(stage['run-name'], ctx)).toBe(reservation);
      expect(evaluate(stage.jobs.detect.if, ctx)).toBe(true);
    }
  );

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

  it('reads refusedCandidates so pending soak, safety refusal, and failed prequal give exact plain reasons', () => {
    expect(
      noteFor('2026-11-27T13', 'false', {
        reason: NO_EVIDENCE,
        deferredCandidates: [],
        refusedCandidates: [{ sha: 'f'.repeat(40), reason: 'Backup certificate is pending' }],
      })
    ).toBe(
      'Engine cutover at 1:00 PM CST did not happen: the newest build was still finishing its test at the cutoff. The current engine keeps running, and the next build is being tested for the 4:00 PM CST cutover.'
    );
    expect(
      noteFor('2026-11-27T07', 'false', {
        reason: NO_EVIDENCE,
        deferredCandidates: [],
        refusedCandidates: [
          {
            sha: 'a'.repeat(40),
            reason: 'Engine release prequalification unavailable (failure)',
          },
        ],
      })
    ).toContain(
      'did not happen: the newest build did not pass pre-release checks before the cutoff.'
    );
    expect(
      noteFor('2026-11-27T07', 'false', {
        reason: NO_EVIDENCE,
        deferredCandidates: [],
        refusedCandidates: [{ sha: 'b'.repeat(40), reason: 'Backup Engine refused the candidate' }],
      })
    ).toContain('did not happen: the newest build failed its safety test before the cutoff.');
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
