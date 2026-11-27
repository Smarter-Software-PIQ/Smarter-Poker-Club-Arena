/**
 * THE ESTATE APP STARTS THE NEXT CYCLE (2026-11-27, release custody)
 *
 * WHY. A cycle is owned by the first eligible Stage run created inside its
 * election window, and one of the eligible events is the completion of a
 * Backup run. Two Backup runs exist to be that event when nobody pushes: the
 * post-seal Backup the receiver starts after every seal (O24, O25) and the
 * "Backup after keep-serving" run the Stage owner starts after a cycle that
 * did not seal (O27). Both were started with the Actions job token, and GitHub
 * raises no workflow_run event for a run the job token started. So their
 * completions created no Stage run, and a window with no push had no owner:
 * the 10:00 Chicago cycles of 2026-11-25 and 2026-11-26 never ran. The cover
 * was a cron on the owner's Mac, which works only while that Mac is on.
 *
 * THE FIX. Those two dispatches are sent as the estate GitHub App
 * (smarter-poker-autopilot[bot]). A run the App starts raises workflow_run
 * like a person's, and Stage's election already admits it. Nothing else
 * changes: no trigger, no timer, no election rule.
 *
 * Laws:
 *  1. Both dispatches are sent with a token minted from the App key, in a job
 *     of the main-only environment github-app-main, scoped to this repository
 *     and to the one permission the dispatch needs.
 *  2. A missing App token never fails the job: the mint step cannot fail it,
 *     and the send falls back to the job token, as before, and says so.
 *  3. The App is not a way round the intent proof: every receiver job proves
 *     an App dispatch that cites an intent exactly as it proves the job
 *     token's, and an App dispatch that cites none is treated as before.
 *  4. Stage's election admits the completion of an App-started Backup, and
 *     none of its readers asks who started it.
 *  5. No timer, schedule or trigger was added, and the operator fallback on
 *     the Mac stays in place for the fallback case.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const ROOT = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
type Step = {
  id?: string;
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
  with?: Record<string, string>;
  'continue-on-error'?: boolean;
  'timeout-minutes'?: number;
};
type Job = {
  if?: string;
  needs?: string | string[];
  environment?: unknown;
  permissions?: Record<string, string>;
  outputs?: Record<string, string>;
  steps: Step[];
};
type Workflow = { on: Record<string, any>; jobs: Record<string, Job>; 'run-name': string };
const workflow = (file: string) => parse(read(`.github/workflows/${file}`)) as Workflow;

const APP = 'smarter-poker-autopilot[bot]';
const JOB_TOKEN = 'github-actions[bot]';
const stage = workflow('stage-engine-release.yml');
const receiver = workflow('auto-deploy-hetzner.yml');
const backup = workflow('backup-engine.yml');
const e2e = workflow('post-deploy-e2e.yml');

// The two sending jobs: the workflow, the job, the exact POST, the one
// permission the App token asks for and the receiver title each one reads back.
const SENDERS = [
  {
    label: 'the keep-serving Backup (Stage)',
    jobs: stage.jobs,
    job: 'start-backup-as-estate-app',
    post: 'gh api --method POST "repos/$REPO/actions/workflows/backup-engine.yml/dispatches" --input "$RUNNER_TEMP/keep-serving-dispatch.json"',
    permission: 'permission-actions',
  },
  {
    label: 'the post-seal Backup (receiver)',
    jobs: receiver.jobs,
    job: 'certify-production',
    post: 'gh api --method POST "repos/$REPO/dispatches" --input "$RUNNER_TEMP/certification-dispatch.json"',
    permission: 'permission-contents',
  },
] as const;

/** A small evaluator for the GitHub expressions this law reads. */
const evaluate = (expression: string, context: Record<string, unknown>) => {
  const body = expression
    .replace(/^\$\{\{\s*/, '')
    .replace(/\s*\}\}$/, '')
    .replace(
      /\b(?:github|inputs|needs)(?:\.[A-Za-z_-]+)+/g,
      (path) => `get(${JSON.stringify(path)})`
    );
  const get = (path: string) =>
    path
      .split('.')
      .reduce<unknown>(
        (value, key) =>
          value !== null && typeof value === 'object'
            ? ((value as Record<string, unknown>)[key] ?? '')
            : '',
        context
      );
  const startsWith = (value: unknown, prefix: string) =>
    String(value ?? '')
      .toLowerCase()
      .startsWith(prefix.toLowerCase());
  const endsWith = (value: unknown, suffix: string) =>
    String(value ?? '')
      .toLowerCase()
      .endsWith(suffix.toLowerCase());
  return Boolean(
    new Function('get', 'startsWith', 'endsWith', `return (${body});`)(get, startsWith, endsWith)
  );
};

describe('both dispatches are sent as the estate App from a github-app-main job', () => {
  for (const sender of SENDERS) {
    const job = sender.jobs[sender.job];
    const steps = job?.steps ?? [];
    const mintAt = steps.findIndex((s) =>
      String(s.uses ?? '').startsWith('actions/create-github-app-token@')
    );
    const sendAt = steps.findIndex((s) => String(s.run ?? '').includes(sender.post));
    const mint = steps[mintAt];
    const send = steps[sendAt];

    it(`${sender.label}: the job is in github-app-main and mints the App token the estate way`, () => {
      expect(job, sender.job).toBeTruthy();
      expect(job.environment).toBe('github-app-main');
      expect(mintAt).toBeGreaterThan(-1);
      // The established pattern on main (estate-integrity.yml and others).
      expect(mint.uses).toBe('actions/create-github-app-token@v3');
      expect(mint.with?.['app-id']).toBe('${{ vars.AUTOPILOT_APP_ID }}');
      expect(mint.with?.['private-key']).toBe('${{ secrets.AUTOPILOT_APP_PRIVATE_KEY }}');
      // Scoped down: this repository, and the one permission the dispatch needs.
      expect(mint.with?.owner).toBe('${{ github.repository_owner }}');
      expect(mint.with?.repositories).toBe('Smarter-Poker-Club-Arena');
      const permissions = Object.keys(mint.with ?? {}).filter((k) => k.startsWith('permission-'));
      expect(permissions).toEqual([sender.permission]);
      expect(mint.with?.[sender.permission]).toBe('write');
      // The key is read by the mint step and by nothing else in the job.
      const readers = steps.filter((s) => JSON.stringify(s).includes('AUTOPILOT_APP_PRIVATE_KEY'));
      expect(readers).toEqual([mint]);
    });

    it(`${sender.label}: the dispatch is sent with the App token, after the mint, once`, () => {
      expect(sendAt).toBeGreaterThan(mintAt);
      expect(send.env?.APP_TOKEN).toBe(`\${{ steps.${mint.id}.outputs.token }}`);
      expect(send.env?.GH_TOKEN).toBe('${{ github.token }}');
      const run = String(send.run);
      // One send function holds the one POST; the App token is tried first.
      expect(run.split(sender.post).length - 1).toBe(1);
      expect(run).toContain(`GH_TOKEN="$1" ${sender.post}`);
      expect(run).toMatch(/if \[ -n "\$APP_TOKEN" \]; then\n\s+if send "\$APP_TOKEN"; then/);
      // The App token is used for the POST and for nothing else in the job.
      const users = steps.filter((s) => JSON.stringify(s.env ?? {}).includes('.outputs.token'));
      expect(users).toEqual([send]);
      expect(run.match(/\$APP_TOKEN/g)).toHaveLength(2);
      // No other step of the job, and no other job of the workflow, sends it.
      for (const [name, other] of Object.entries(sender.jobs))
        for (const step of other.steps ?? [])
          if (step !== send)
            expect(String(step.run ?? ''), `${name}`).not.toContain(sender.post.slice(0, 60));
    });

    it(`${sender.label}: a missing App token never fails the job; the job token sends as before and says so`, () => {
      // The mint step cannot fail the job, and cannot hang it.
      expect(mint['continue-on-error']).toBe(true);
      expect(mint['timeout-minutes']).toBeLessThanOrEqual(3);
      expect(mint.if).toBeUndefined();
      // The send step runs whatever the mint step did.
      expect(send.if).toBeUndefined();
      expect(send['continue-on-error']).toBeUndefined();
      const run = String(send.run);
      // No token: the job-token send, announced as a warning (never an error).
      expect(run).toMatch(
        /else\n\s*echo ['"]::warning title=NO ESTATE APP TOKEN, JOB TOKEN FALLBACK::[^\n]+\n\s*send "\$GH_TOKEN"\n\s*fi\n/
      );
      // A refused App POST: look once for the run, then the job-token send.
      expect(run).toMatch(
        /echo ['"]::warning title=ESTATE APP DISPATCH FAILED, JOB TOKEN FALLBACK::[^\n]+\n\s*send "\$GH_TOKEN"\n/
      );
      expect(run).toContain('::warning title=ESTATE APP DISPATCH ANSWER LOST::');
      for (const line of run.split('\n').filter((l) => l.includes('JOB TOKEN FALLBACK::'))) {
        expect(line).toContain('with the job token exactly as before 2026-11-27');
        expect(line).toContain('starts no election');
        expect(line).toContain('The operator fallback on the Mac covers the next cycle.');
      }
      expect(run).not.toMatch(/::error[^\n]*ESTATE APP/);
      // The job token can still make the same POST.
      expect(job.permissions?.[sender.permission.replace('permission-', '')]).toBe('write');
      // Who started the run is read back from GitHub, not assumed (10.86).
      expect(run).toContain("= 'smarter-poker-autopilot[bot]' ]; then");
      expect(run).toContain('.triggering_actor.login // .actor.login // "unknown"');
      expect(run).toContain('::warning title=ESTATE APP RUN NOT ATTRIBUTED::');
    });

    it(`${sender.label}: the job refuses a job-token dispatch and a job-token re-run like every secret-holding job`, () => {
      const condition = String(job.if);
      expect(condition).toContain(
        "!(github.run_attempt != '1' && github.triggering_actor == 'github-actions[bot]')"
      );
      // The dispatch refusal, in the form its workflow's triggers call for
      // (tests/unit/aJobTokenCannotStartTrustedWork.law.test.ts pins which).
      expect(condition).toMatch(
        /github\.actor (?:!=|==) 'github-actions\[bot\]' (?:&&|\|\|) github\.triggering_actor (?:!=|==) 'github-actions\[bot\]'/
      );
      expect(condition).not.toContain('always()');
    });
  }

  it('the Stage sending job only sends: it needs the job that decided and recorded, and holds no other secret', () => {
    const job = stage.jobs['start-backup-as-estate-app'];
    expect(job.needs).toEqual(['detect', 'next-candidate-after-cycle']);
    expect(String(job.if)).toContain(
      "needs.next-candidate-after-cycle.outputs.did_not_seal == 'true'"
    );
    expect(String(job.if)).toContain('github.run_attempt == 1');
    expect(job.permissions).toEqual({ actions: 'write' });
    expect(job.steps).toHaveLength(2);
    expect(job.steps.some((s) => String(s.uses ?? '').startsWith('actions/checkout'))).toBe(false);
    const secrets = [...JSON.stringify(job).matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]);
    expect(secrets).toEqual(['AUTOPILOT_APP_PRIVATE_KEY']);
    // The deciding job keeps ci-main (the Messenger note) and never sees the App key.
    const decides = stage.jobs['next-candidate-after-cycle'];
    expect(decides.environment).toBe('ci-main');
    expect(JSON.stringify(decides)).not.toContain('AUTOPILOT_APP');
    // No job of either workflow needs the sending job: it can delay nothing.
    for (const [name, other] of Object.entries(stage.jobs))
      expect([other.needs ?? []].flat(), name).not.toContain('start-backup-as-estate-app');
    for (const [name, other] of Object.entries(receiver.jobs))
      expect([other.needs ?? []].flat(), name).not.toContain('certify-production');
  });

  it('the receiver job held no environment before, so no other secret moved', () => {
    const job = receiver.jobs['certify-production'];
    const secrets = [...JSON.stringify(job).matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]);
    expect(secrets).toEqual(['AUTOPILOT_APP_PRIVATE_KEY']);
    expect(job.needs).toEqual(['preflight', 'deploy', 'record-receipt']);
    expect(job.permissions).toEqual({ actions: 'read', contents: 'write' });
    // Only these two jobs of the three release workflows read the App key.
    for (const [file, wf] of [
      ['stage-engine-release.yml', stage],
      ['auto-deploy-hetzner.yml', receiver],
      ['backup-engine.yml', backup],
    ] as const)
      for (const [name, other] of Object.entries(wf.jobs)) {
        const mints = JSON.stringify(other).includes('AUTOPILOT_APP_PRIVATE_KEY');
        const expected =
          (file === 'stage-engine-release.yml' && name === 'start-backup-as-estate-app') ||
          (file === 'auto-deploy-hetzner.yml' && name === 'certify-production');
        expect(mints, `${file} ${name}`).toBe(expected);
      }
  });
});

// The two send steps, run for real against a stand-in `gh` that records which
// token made each call. APP_POST: ok | refused (GitHub starts nothing) | lost
// (GitHub answers with an error and starts the run anyway). JOB_POST: ok | refused.
const FAKE_GH = `#!/usr/bin/env bash
set -euo pipefail
who=other; [ "\${GH_TOKEN:-}" = app-token ] && who=app; [ "\${GH_TOKEN:-}" = job-token ] && who=job
args="$*"
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
start() { echo "$1" > "$FAKE_STATE/started-by"; }
actor() { if [ "$(cat "$FAKE_STATE/started-by")" = app ]; then echo 'smarter-poker-autopilot[bot]'; else echo 'github-actions[bot]'; fi; }
filter=''
for ((i = 1; i <= $#; i++)); do [ "\${!i}" = --jq ] && { j=$((i + 1)); filter="\${!j}"; }; done
emit() { if [ -n "$filter" ]; then jq -r "$filter"; else cat; fi; }
case "$args" in
  *'--method POST'*)
    echo "POST $who" >> "$FAKE_STATE/calls"
    mode="$JOB_POST"; [ "$who" = app ] && mode="$APP_POST"
    case "$mode" in
      ok) start "$who" ;;
      lost) start "$who"; echo 'HTTP 502' >&2; exit 1 ;;
      *) echo 'HTTP 403: Resource not accessible' >&2; exit 1 ;;
    esac ;;
  *'/jobs?per_page=100'*)
    [ "$who" = job ] || exit 1
    echo '{"jobs":[{"name":"refresh","conclusion":null}]}' | emit ;;
  *'/runs?event='*)
    [ "$who" = job ] || { echo "read with $who" >> "$FAKE_STATE/calls"; exit 1; }
    if [ -f "$FAKE_STATE/started-by" ]; then
      title="$E2E_TITLE"; case "$args" in *backup-engine.yml*) title="$BACKUP_TITLE" ;; esac
      jq -n --arg title "$title" --arg at "$(now)" --arg actor "$(actor)" \
        '{workflow_runs:[{id:46100000001,display_title:$title,created_at:$at,actor:{login:$actor},triggering_actor:{login:$actor}}]}' | emit
    else
      echo '{"workflow_runs":[]}' | emit
    fi ;;
  *) echo "unexpected gh call: $args" >&2; exit 9 ;;
esac
`;
const NONCE_HEX = 'd'.repeat(32);
function runSend(
  which: 'stage' | 'receiver',
  scenario: { token: boolean; app?: 'ok' | 'refused' | 'lost'; job?: 'ok' | 'refused' }
) {
  const dir = mkdtempSync(join(tmpdir(), 'estate-app-send-'));
  try {
    writeFileSync(join(dir, 'gh'), FAKE_GH);
    chmodSync(join(dir, 'gh'), 0o755);
    const job =
      which === 'stage'
        ? stage.jobs['start-backup-as-estate-app']
        : receiver.jobs['certify-production'];
    const step = job.steps.find((s) => String(s.run ?? '').includes('send "$APP_TOKEN"'));
    const sha = 'e'.repeat(40);
    const body =
      which === 'stage'
        ? {
            ref: 'main',
            inputs: {
              after_cycle: '2026-11-27T13',
              refresh: 'true',
              intent_run_id: '46000000000',
              intent_run_attempt: '1',
              intent_nonce: NONCE_HEX,
            },
          }
        : {
            event_type: 'run-post-deploy-e2e',
            client_payload: { engine_sha: sha, release_run_key: '46000000000-1' },
          };
    if (which === 'receiver')
      writeFileSync(join(dir, 'certification-dispatch.json'), JSON.stringify(body));
    const r = spawnSync('bash', ['-c', `sleep() { :; }\n${step?.run}`], {
      encoding: 'utf8',
      timeout: 60_000,
      env: {
        PATH: `${dir}:${process.env.PATH}`,
        RUNNER_TEMP: dir,
        FAKE_STATE: dir,
        GITHUB_STEP_SUMMARY: join(dir, 'summary.md'),
        GITHUB_RUN_ID: '46000000000',
        GITHUB_RUN_ATTEMPT: '1',
        GH_TOKEN: 'job-token',
        APP_TOKEN: scenario.token ? 'app-token' : '',
        APP_POST: scenario.app ?? 'ok',
        JOB_POST: scenario.job ?? 'ok',
        REPO: 'Smarter-Software-PIQ/Smarter-Poker-Club-Arena',
        RELEASE_DATE: '2026-11-27T13',
        INTENT_NONCE: NONCE_HEX,
        DISPATCH_BODY: JSON.stringify(body),
        REASON: 'kept serving 0123456789ab',
        ENGINE_SHA: sha,
        RELEASE_RESULT: 'sealed',
        GAMEPLAY_RECEIPT: '{}',
        E2E_TITLE: `Post-Deploy E2E ${sha} ${NONCE_HEX}`,
        BACKUP_TITLE:
          which === 'stage'
            ? `Backup after keep-serving 2026-11-27T13 ${NONCE_HEX}`
            : 'Backup after seal 46000000000-1',
      },
    });
    let calls: string[] = [];
    try {
      calls = readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n');
    } catch {
      calls = [];
    }
    return { status: r.status, out: `${r.stdout}\n${r.stderr}`, calls };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('the send steps, executed: every failure of the App token leaves the cycle where it was before', () => {
  for (const which of ['stage', 'receiver'] as const) {
    it(`${which}: with an App token the one POST is the App's, and the run is read back as the App's`, () => {
      const r = runSend(which, { token: true });
      expect(r.status, r.out).toBe(0);
      expect(r.calls).toEqual(['POST app']);
      expect(r.out).toContain('the estate App');
      expect(r.out).toContain("starts the next cycle's election");
      expect(r.out).not.toContain('::warning');
      expect(r.out).not.toContain('::error');
    });

    it(`${which}: with no App token the job token sends exactly once, the step is green and the log says so`, () => {
      const r = runSend(which, { token: false });
      expect(r.status, r.out).toBe(0);
      expect(r.calls).toEqual(['POST job']);
      expect(r.out).toContain('::warning title=NO ESTATE APP TOKEN, JOB TOKEN FALLBACK::');
      expect(r.out).toContain('does not start the election');
      expect(r.out).not.toContain("starts the next cycle's election");
      expect(r.out).not.toContain('::error');
    });

    it(`${which}: an App dispatch GitHub refuses falls back to the job token, once, and stays green`, () => {
      const r = runSend(which, { token: true, app: 'refused' });
      expect(r.status, r.out).toBe(0);
      expect(r.calls).toEqual(['POST app', 'POST job']);
      expect(r.out).toContain('::warning title=ESTATE APP DISPATCH FAILED, JOB TOKEN FALLBACK::');
      expect(r.out).toContain('does not start the election');
      expect(r.out).not.toContain('::error');
    });

    it(`${which}: an App dispatch GitHub started despite an error answer is never sent twice`, () => {
      const r = runSend(which, { token: true, app: 'lost' });
      expect(r.status, r.out).toBe(0);
      expect(r.calls).toEqual(['POST app']);
      expect(r.out).toContain('::warning title=ESTATE APP DISPATCH ANSWER LOST::');
      expect(r.out).toContain("starts the next cycle's election");
    });

    it(`${which}: when GitHub accepts neither identity the step fails, as it did before with the job token alone`, () => {
      const none = runSend(which, { token: false, job: 'refused' });
      expect(none.status).not.toBe(0);
      expect(none.calls).toEqual(['POST job']);
      const both = runSend(which, { token: true, app: 'refused', job: 'refused' });
      expect(both.status).not.toBe(0);
      expect(both.calls).toEqual(['POST app', 'POST job']);
    });

    it(`${which}: the App token makes the POST and nothing else; every read uses the job token`, () => {
      for (const scenario of [
        { token: true },
        { token: true, app: 'refused' as const },
        { token: true, app: 'lost' as const },
      ])
        expect(runSend(which, scenario).calls.filter((c) => c.startsWith('read with'))).toEqual([]);
    });
  }

  it('stage: a recorded body GitHub dropped between the jobs is rebuilt as the body the intent record prints, and still sent', async () => {
    // @ts-expect-error untyped CI module
    const { writeIntent } = await import('../scripts/ci/dispatch-intent.mjs');
    const dir = mkdtempSync(join(tmpdir(), 'estate-app-rebuild-'));
    try {
      const recorded = writeIntent({
        operation: 'backup-after-keep-serving',
        inputs: { after_cycle: '2026-11-27T13', refresh: 'true' },
        dir: join(dir, 'intents'),
        nonce: NONCE_HEX,
        env: {
          GITHUB_REPOSITORY: 'Smarter-Software-PIQ/Smarter-Poker-Club-Arena',
          GITHUB_EVENT_NAME: 'push',
          GITHUB_WORKFLOW_REF:
            'Smarter-Software-PIQ/Smarter-Poker-Club-Arena/.github/workflows/stage-engine-release.yml@refs/heads/main',
          GITHUB_RUN_ID: '46000000000',
          GITHUB_RUN_ATTEMPT: '1',
          GITHUB_SHA: 'a'.repeat(40),
        },
      }).body;
      writeFileSync(
        join(dir, 'gh'),
        `#!/usr/bin/env bash\nfor a in "$@"; do [ -f "$a" ] && cp "$a" "${dir}/sent.json"; done\nexit 1\n`
      );
      chmodSync(join(dir, 'gh'), 0o755);
      const step = stage.jobs['start-backup-as-estate-app'].steps.find((s) =>
        String(s.run ?? '').includes('send "$APP_TOKEN"')
      );
      const r = spawnSync('bash', ['-c', `sleep() { :; }\n${step?.run}`], {
        encoding: 'utf8',
        timeout: 30_000,
        env: {
          PATH: `${dir}:${process.env.PATH}`,
          RUNNER_TEMP: dir,
          GITHUB_RUN_ID: '46000000000',
          GITHUB_RUN_ATTEMPT: '1',
          GH_TOKEN: 'job-token',
          APP_TOKEN: 'app-token',
          REPO: 'o/r',
          RELEASE_DATE: '2026-11-27T13',
          INTENT_NONCE: NONCE_HEX,
          DISPATCH_BODY: '',
          REASON: 'x',
        },
      });
      expect(`${r.stdout}${r.stderr}`).toContain('::warning title=RECORDED BODY NOT RECEIVED::');
      expect(JSON.parse(readFileSync(join(dir, 'sent.json'), 'utf8'))).toEqual(recorded);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stage: a body that is not the recorded intent for this run attempt is never sent', () => {
    const job = stage.jobs['start-backup-as-estate-app'];
    const step = job.steps.find((s) => String(s.run ?? '').includes('send "$APP_TOKEN"'));
    const base = {
      after_cycle: '2026-11-27T13',
      refresh: 'true',
      intent_run_id: '46000000000',
      intent_run_attempt: '1',
      intent_nonce: NONCE_HEX,
    };
    for (const body of [
      { ref: 'other', inputs: base },
      { ref: 'main', inputs: { ...base, sha: 'f'.repeat(40) } },
      { ref: 'main', inputs: { ...base, refresh: 'false' } },
      { ref: 'main', inputs: { ...base, intent_run_id: '1' } },
      { ref: 'main', inputs: { ...base, after_cycle: '2026-11-27T16' } },
      { ref: 'main', inputs: base, extra: 1 },
    ]) {
      const dir = mkdtempSync(join(tmpdir(), 'estate-app-body-'));
      try {
        writeFileSync(join(dir, 'gh'), `#!/usr/bin/env bash\necho called >> "${dir}/calls"\n`);
        chmodSync(join(dir, 'gh'), 0o755);
        const r = spawnSync('bash', ['-c', String(step?.run)], {
          encoding: 'utf8',
          timeout: 30_000,
          env: {
            PATH: `${dir}:${process.env.PATH}`,
            RUNNER_TEMP: dir,
            GITHUB_RUN_ID: '46000000000',
            GITHUB_RUN_ATTEMPT: '1',
            GH_TOKEN: 'job-token',
            APP_TOKEN: 'app-token',
            REPO: 'o/r',
            RELEASE_DATE: '2026-11-27T13',
            INTENT_NONCE: NONCE_HEX,
            DISPATCH_BODY: JSON.stringify(body),
            REASON: 'x',
          },
        });
        expect(r.status, JSON.stringify(body)).not.toBe(0);
        expect(() => readFileSync(join(dir, 'calls'), 'utf8')).toThrow();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });
});

describe('the App is not a way round the intent proof', () => {
  const PROVE = 'Prove a job-token dispatch is the exact intent its trusted sender recorded';
  const context = (
    event: string,
    actor: string,
    extra: { inputs?: Record<string, string>; payload?: Record<string, string>; action?: string }
  ) => ({
    github: {
      event_name: event,
      actor,
      triggering_actor: actor,
      event: { action: extra.action ?? '', client_payload: extra.payload ?? {} },
    },
    inputs: extra.inputs ?? {},
  });
  const NONCE = 'a'.repeat(32);

  for (const name of ['refresh', 'certify'] as const) {
    const first = backup.jobs[name].steps[0];
    it(`Backup ${name} proves an App dispatch that cites an intent, exactly as the job token's`, () => {
      expect(first.name).toBe(PROVE);
      const condition = String(first.if);
      // The keep-serving send, by either identity.
      for (const actor of [APP, JOB_TOKEN])
        expect(
          evaluate(
            condition,
            context('workflow_dispatch', actor, {
              inputs: { after_cycle: '2026-11-27T13', intent_nonce: NONCE },
            })
          ),
          actor
        ).toBe(true);
      // The post-seal send, by either identity.
      for (const actor of [APP, JOB_TOKEN])
        expect(
          evaluate(
            condition,
            context('repository_dispatch', actor, {
              action: 'run-post-deploy-e2e',
              payload: { release_run_key: '46000000000-1', intent_nonce: NONCE },
            })
          ),
          actor
        ).toBe(true);
      // A person re-running an App-started run still proves it (github.actor survives).
      expect(
        evaluate(condition, {
          github: {
            event_name: 'workflow_dispatch',
            actor: APP,
            triggering_actor: 'a-person',
            event: { client_payload: {} },
          },
          inputs: { after_cycle: '2026-11-27T13', intent_nonce: NONCE },
        })
      ).toBe(true);
      // Unchanged: an App or a person's dispatch that cites no intent is not
      // asked for one, and the job token is always asked.
      expect(evaluate(condition, context('workflow_dispatch', APP, { inputs: {} }))).toBe(false);
      expect(
        evaluate(condition, context('workflow_dispatch', 'a-person', { inputs: { sha: 'x' } }))
      ).toBe(false);
      expect(
        evaluate(
          condition,
          context('workflow_dispatch', 'a-person', { inputs: { intent_nonce: NONCE } })
        )
      ).toBe(false);
      expect(evaluate(condition, context('workflow_dispatch', JOB_TOKEN, { inputs: {} }))).toBe(
        true
      );
      // No event but a dispatch is ever asked.
      expect(evaluate(condition, context('push', APP, { inputs: { intent_nonce: NONCE } }))).toBe(
        false
      );
      // The same proof runs: same script at this commit, same two receivers.
      expect(String(first.run)).toContain('prove --receiver backup-after-keep-serving');
      expect(String(first.run)).toContain('prove --receiver backup-after-seal');
    });

    it(`Backup ${name} admits nothing new: its job guard is the one main had`, () => {
      expect(String(backup.jobs[name].if)).toContain(
        "(!((github.event_name == 'workflow_dispatch' || github.event_name == 'repository_dispatch') && (github.actor == 'github-actions[bot]' || github.triggering_actor == 'github-actions[bot]')) || (github.event_name == 'repository_dispatch' && github.event.action == 'run-post-deploy-e2e') || (github.event_name == 'workflow_dispatch' && inputs.after_cycle != '')) && !(github.run_attempt != '1' && github.triggering_actor == 'github-actions[bot]')"
      );
      expect(String(backup.jobs[name].if)).not.toContain('autopilot');
    });
  }

  it('the proof itself never reads who sent the dispatch, so one record serves both identities', () => {
    const script = read('scripts/ci/dispatch-intent.mjs');
    const prove = script.slice(
      script.indexOf('export async function proveIntent'),
      script.indexOf('export const TRANSIENT_STATUS')
    );
    expect(prove.length).toBeGreaterThan(2000);
    expect(prove).not.toContain('GITHUB_ACTOR');
    expect(prove).not.toMatch(/own\.actor|run\.actor|autopilot|github-actions/);
    // The sender run that recorded the intent is still Stage or the receiver.
    expect(script).toContain("sender: '.github/workflows/stage-engine-release.yml'");
    expect(script).toContain("sender: '.github/workflows/auto-deploy-hetzner.yml'");
  });

  it('Post-Deploy E2E, the other receiver of the post-seal dispatch, proves the App the same way', () => {
    const proving = Object.entries(e2e.jobs).filter(([, job]) =>
      (job.steps ?? []).some((s) => s.name === PROVE)
    );
    expect(proving.length).toBeGreaterThanOrEqual(11);
    for (const [name, job] of proving) {
      const first = job.steps[0];
      expect(first.name, name).toBe(PROVE);
      const condition = String(first.if);
      for (const actor of [APP, JOB_TOKEN])
        expect(
          evaluate(
            condition,
            context('repository_dispatch', actor, {
              action: 'run-post-deploy-e2e',
              payload: { engine_sha: 'b'.repeat(40), intent_nonce: NONCE },
            })
          ),
          `${name} ${actor}`
        ).toBe(true);
      // An App or a person's event that cites no intent is treated as before.
      expect(evaluate(condition, context('repository_dispatch', APP, { payload: {} })), name).toBe(
        false
      );
      expect(
        evaluate(condition, context('repository_dispatch', 'a-person', { payload: {} })),
        name
      ).toBe(false);
    }
  });
});

describe("Stage's election admits the completion of an App-started Backup as written", () => {
  const completion = (run: Record<string, unknown>, actor: string) => ({
    github: {
      event_name: 'workflow_run',
      repository: 'Smarter-Software-PIQ/Smarter-Poker-Club-Arena',
      actor,
      triggering_actor: actor,
      event: {
        workflow_run: {
          path: '.github/workflows/backup-engine.yml',
          head_repository: { full_name: 'Smarter-Software-PIQ/Smarter-Poker-Club-Arena' },
          head_branch: 'main',
          run_attempt: 1,
          conclusion: 'success',
          actor: { login: actor, type: 'Bot' },
          ...run,
        },
      },
    },
    inputs: {},
  });
  const evaluateTitle = (ctx: Record<string, unknown>) => {
    const body = stage['run-name']
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
          ctx
        );
    const startsWith = (value: unknown, prefix: string) =>
      String(value ?? '')
        .toLowerCase()
        .startsWith(prefix.toLowerCase());
    return new Function('get', 'startsWith', `return (${body});`)(get, startsWith);
  };
  const RUNS = [
    {
      event: 'workflow_dispatch',
      display_title: `Backup after keep-serving 2026-11-27T13 ${'c'.repeat(32)}`,
    },
    { event: 'repository_dispatch', display_title: 'Backup after seal 46000000000-1' },
  ];

  it('both App-started runs elect under the title every reader names, whatever their conclusion', () => {
    for (const run of RUNS)
      for (const conclusion of ['success', 'failure', 'timed_out']) {
        const ctx = completion({ ...run, conclusion }, APP);
        expect(evaluateTitle(ctx), run.display_title).toBe('Automatic Backup daily reservation');
        expect(evaluate(String(stage.jobs.detect.if), ctx), run.display_title).toBe(true);
      }
    // Unchanged: a second attempt, another branch and a cancelled run stay outside.
    for (const over of [{ run_attempt: 2 }, { head_branch: 'x' }, { conclusion: 'cancelled' }]) {
      const ctx = completion({ ...RUNS[0], ...over }, APP);
      expect(evaluateTitle(ctx)).toBe('Backup completion outside election');
      expect(evaluate(String(stage.jobs.detect.if), ctx)).toBe(false);
    }
  });

  it('neither the admission nor any Stage job refuses a workflow_run because the App started the Backup', () => {
    // The election clauses name the event, path, branch, attempt, title and
    // conclusion of the Backup run, never its actor.
    expect(String(stage.jobs.detect.if)).not.toMatch(/actor/);
    expect(stage['run-name']).not.toMatch(/workflow_run\.(?:actor|triggering_actor)/);
    // Every Stage job's actor clause is the job-token refusal, scoped to a
    // dispatch event or a re-run; the App name appears in none of them.
    const appRun = completion(RUNS[0], APP);
    for (const [name, job] of Object.entries(stage.jobs)) {
      const condition = String(job.if ?? '');
      expect(condition, name).not.toContain('autopilot');
      for (const clause of condition.match(/github\.(?:triggering_)?actor [!=]= '[^']+'/g) ?? [])
        expect(clause, name).toMatch(/'github-actions\[bot\]'$/);
    }
    // The two guard clauses every secret-holding Stage job carries let it through.
    const FULL =
      "!((github.event_name == 'workflow_dispatch' || github.event_name == 'repository_dispatch') && (github.actor == 'github-actions[bot]' || github.triggering_actor == 'github-actions[bot]'))";
    const RERUN =
      "!(github.run_attempt != '1' && github.triggering_actor == 'github-actions[bot]')";
    expect(evaluate(FULL, appRun)).toBe(true);
    expect(evaluate(RERUN, { github: { ...appRun.github, run_attempt: '1' } })).toBe(true);
    // The admission step lets a workflow_run claim by its own creation time.
    const admission = stage.jobs.detect.steps.find((s) => s.id === 'admission');
    expect(String(admission?.run)).toContain(
      'if [ "$EVENT_NAME" = schedule ] || [ "$EVENT_NAME" = push ] || [ "$EVENT_NAME" = workflow_run ] ||'
    );
  });

  it('the three readers of the election count a workflow_run by event and title only', () => {
    const admission = String(stage.jobs.detect.steps.find((s) => s.id === 'admission')?.run);
    expect(admission).toContain(
      'automatic_backup = run.get("event") == "workflow_run" and (title == "Automatic Backup daily reservation"'
    );
    expect(read('scripts/ci/read-engine-prequalification.py')).toContain(
      '(run["event"] == "workflow_run" and run.get("display_title") == "Automatic Backup daily reservation")'
    );
    expect(read('server/scripts/engine-release-window-doors.py')).toContain(
      "backup = run.get('event') == 'workflow_run' and (title == 'Automatic Backup daily reservation'"
    );
    // Each asks for a User only of the operator's repository_dispatch.
    for (const [file, text] of [
      ['stage admission', admission],
      ['read-engine-prequalification.py', read('scripts/ci/read-engine-prequalification.py')],
      ['engine-release-window-doors.py', read('server/scripts/engine-release-window-doors.py')],
    ] as const)
      for (const line of text.split('\n').filter((l) => /\bactor\b/.test(l) && /User/.test(l)))
        expect(line, file).toContain('repository_dispatch');
  });
});

describe('nothing was added to the clock, and the Mac fallback stays', () => {
  it('no trigger, timer or schedule changed on the three release workflows', () => {
    expect(Object.keys(stage.on)).toEqual([
      'repository_dispatch',
      'workflow_run',
      'workflow_dispatch',
      'push',
      'schedule',
    ]);
    expect(stage.on.schedule).toEqual([
      { cron: '31,35,39,43 0,1,2,3,4,5,6,7,8,9,10,11 * * *' },
      { cron: '31,35,39,43 12,13,14,15,16,17,18,19,20,21,22,23 * * *' },
    ]);
    expect(stage.on.workflow_run).toEqual({
      workflows: ['Backup Engine (Clone, Stage, Certify)'],
      branches: ['main'],
      types: ['completed'],
    });
    expect(Object.keys(receiver.on)).toEqual(['repository_dispatch']);
    expect(Object.keys(backup.on)).toEqual([
      'repository_dispatch',
      'push',
      'schedule',
      'workflow_dispatch',
    ]);
    expect(backup.on.schedule).toEqual([{ cron: '7,23,41 5 * * *' }, { cron: '7,23,41 6 * * *' }]);
    expect(backup.on.workflow_run).toBeUndefined();
    // Neither sending job waits on a clock of its own or polls without a bound.
    for (const sender of SENDERS) {
      const run = sender.jobs[sender.job].steps.map((s) => String(s.run ?? '')).join('\n');
      expect(run).not.toMatch(/while (true|:)/);
      expect(run).not.toMatch(/sleep (?:[6-9]\d|\d{3,})\b/);
    }
  });

  it('the operator fallback on the Mac is still there for a cycle the App could not start', () => {
    const cron = JSON.parse(read('ops/openclaw/ca-cutover-operator-preparation.json'));
    expect(JSON.stringify(cron)).toContain('cutover-operator-preparation.mjs');
    const script = read('scripts/ops/cutover-operator-preparation.mjs');
    expect(script).toContain(
      "run.event === 'workflow_run' && title === 'Automatic Backup daily reservation'"
    );
    // Stage still admits the dispatch it sends.
    expect(stage.on.repository_dispatch.types).toEqual(['prepare-daily-engine']);
  });
});
