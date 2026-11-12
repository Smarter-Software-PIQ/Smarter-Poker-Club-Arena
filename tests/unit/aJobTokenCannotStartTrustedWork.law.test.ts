/**
 * A JOB TOKEN CANNOT START TRUSTED WORK (owner authorization 2026-11-11).
 *
 * A merge-group run executes the queued commit's own workflow files, so queued
 * code can grant its job token write scopes and use it to send
 * workflow_dispatch or repository_dispatch events. Those run main's trusted
 * workflows with the queued code's inputs. Every job that reads a secret in a
 * workflow such an event can start therefore refuses a dispatch whose
 * triggering actor is the job token (github-actions[bot]). The three trusted
 * senders that legitimately dispatch with the job token first record the exact
 * intent (operation, inputs, sender run, attempt, head SHA, nonce) as an
 * artifact of their own run, and every receiver job that admits the job token
 * proves its dispatch is that exact intent, once, before it reads anything
 * (scripts/ci/dispatch-intent.mjs). Citing a recent sender run is not enough.
 *
 * The same review capped the queue-reachable token in ci.yml, refused fork
 * pull requests at the Money trigger reporter without minting its App token,
 * and bound two workflow_run readers to this repository's own events.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
// @ts-expect-error untyped CI module
import { OPERATIONS, RECEIVERS } from '../../scripts/ci/dispatch-intent.mjs';

const DIR = join(process.cwd(), '.github', 'workflows');
const read = (f: string) => readFileSync(join(DIR, f), 'utf8');
// A workflow only a dispatch (or a pull request) can start compares the actor;
// one that other events also start refuses only the dispatch from the job token.
// Both actors are compared: github.actor is the run's first actor and survives
// a re-run, so a person re-running a forged dispatch never skips the refusal.
const SHORT =
  "(github.actor != 'github-actions[bot]' && github.triggering_actor != 'github-actions[bot]')";
const FULL =
  "!((github.event_name == 'workflow_dispatch' || github.event_name == 'repository_dispatch') && (github.actor == 'github-actions[bot]' || github.triggering_actor == 'github-actions[bot]'))";
// A re-run the job token starts is refused on every secret-holding job and on
// every sender, whatever event started the run; a person's re-run still works.
const RERUN = "!(github.run_attempt != '1' && github.triggering_actor == 'github-actions[bot]')";
const SENDERS: Array<[string, string]> = [
  ['auto-deploy-hetzner.yml', 'certify-production'],
  ['dispatch-merged-migrations.yml', 'dispatch-merged-migrations'],
  ['gto-v31-qualification.yml', 'recheck-after-release'],
];
const DISPATCH_ONLY = new Set([
  'workflow_dispatch',
  'repository_dispatch',
  'pull_request',
  'pull_request_target',
]);
// Receivers of a job-token dispatch: the event that is admitted, the
// dispatch-intent receiver its admitting jobs prove, and the jobs that can
// never see the admitted dispatch (with the clause that excludes it).
const ADMITTED: Record<
  string,
  { admitted: string; receiver?: string; unreachable?: Record<string, string> }
> = {
  'apply-merged-migration.yml': {
    admitted:
      "github.event_name == 'repository_dispatch' && github.event.action == 'apply-merged-migration'",
    receiver: 'apply-merged-migration',
  },
  'post-deploy-e2e.yml': {
    admitted:
      "github.event_name == 'repository_dispatch' && github.event.action == 'run-post-deploy-e2e'",
    receiver: 'post-deploy-e2e',
  },
  // The seal's run-post-deploy-e2e dispatch also refreshes Backup.
  'backup-engine.yml': {
    admitted:
      "github.event_name == 'repository_dispatch' && github.event.action == 'run-post-deploy-e2e'",
    receiver: 'backup-after-seal',
  },
  'gto-v31-qualification.yml': {
    admitted: "github.event_name == 'workflow_dispatch' && inputs.operation == 'recheck'",
    receiver: 'gto-recheck',
    unreachable: {
      'recheck-after-release': "github.event_name == 'workflow_run'",
      promote: "inputs.operation == 'promote'",
    },
  },
  // The engine receiver proves its selection run against prequalification
  // (read-engine-prequalification.py verify_selection).
  'auto-deploy-hetzner.yml': {
    admitted:
      "github.event_name == 'repository_dispatch' && github.event.action == 'deploy-club-arena-engine'",
  },
};
// GitHub's id for a workflow file, for a listener whose law forbids naming it.
const WORKFLOW_IDS: Record<string, number> = { '.github/workflows/ci.yml': 247739539 };
const PROVE = 'Prove a job-token dispatch is the exact intent its trusted sender recorded';
// Owned by the pull-request environment lane, and the deleted one-shot mover.
// The PR-environment lane's file, the deleted one-shot mover, and the Money
// trigger reporter (its own guard is pinned below).
const OUT_OF_SCOPE = new Set([
  'settlement-lane-doctrine.yml',
  'copy-repository-secrets-to-environments.yml',
  'money-trigger-recovery.yml',
]);

// The dispatch refusal is read with the re-run refusal (pinned separately
// below) and the parentheses it added around the original condition removed.
const withoutRerun = (raw: string) => {
  let c = raw.replace(/^\$\{\{ ?(.*?) ?\}\}$/, '$1');
  const tail = ` && ${RERUN}`;
  if (!c.endsWith(tail)) return raw;
  c = c.slice(0, -tail.length);
  if (c.startsWith('(') && c.endsWith(')')) {
    let depth = 0;
    const whole = [...c].every((ch, i) => {
      depth += ch === '(' ? 1 : ch === ')' ? -1 : 0;
      return depth > 0 || i === c.length - 1;
    });
    if (whole) c = c.slice(1, -1);
  }
  return c;
};

type Job = Record<string, unknown> & { if?: unknown; steps?: Array<Record<string, unknown>> };
const files = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f));
const dispatchable = files.filter((f) => {
  const on = (parse(read(f)) as { on?: Record<string, unknown> }).on ?? {};
  return typeof on === 'object' && ('workflow_dispatch' in on || 'repository_dispatch' in on);
});
const holdsSecret = (job: Job) => {
  const text = JSON.stringify(job);
  return 'environment' in job || /secrets\./.test(text) || job.secrets === 'inherit';
};

describe('a job token cannot start trusted work', () => {
  it('finds the dispatchable workflows it guards', () => {
    expect(dispatchable.length).toBeGreaterThan(40);
  });

  for (const f of dispatchable) {
    if (OUT_OF_SCOPE.has(f)) continue;
    const doc = parse(read(f)) as { on: Record<string, unknown>; jobs: Record<string, Job> };
    const base = Object.keys(doc.on).every((t) => DISPATCH_ONLY.has(t)) ? SHORT : FULL;
    const admitted = ADMITTED[f]?.admitted;
    const guard = admitted ? `(${base} || (${admitted}))` : base;
    for (const [name, job] of Object.entries(doc.jobs)) {
      if (!holdsSecret(job)) continue;
      it(`${f} ${name} refuses a job-token dispatch`, () => {
        const condition = withoutRerun(String(job.if ?? '').replace(/\s+/g, ' '));
        // A job whose own condition already admits only a dispatch event
        // carries the short form: the event clause would be redundant.
        // So does a job pinned to an action other than the admitted one: the
        // admitted event can never reach it.
        const admittedAction = admitted?.match(/github\.event\.action == '([^']+)'/)?.[1];
        const ownAction = condition.match(/^github\.event\.action == '([^']+)' && /)?.[1];
        const otherActionJob = !!admittedAction && !!ownAction && ownAction !== admittedAction;
        const dispatchOnlyJob =
          otherActionJob ||
          (!admitted &&
            /^(?:\$\{\{ )?github\.event_name == '(?:repository|workflow)_dispatch' && /.test(
              condition
            ) &&
            !condition.includes('||'));
        const expected = dispatchOnlyJob ? SHORT : guard;
        const whole = String(job.if ?? '').replace(/\s+/g, ' ');
        expect(condition.includes(expected) || whole.includes(expected), `${condition}`).toBe(true);
      });
      const receiver = ADMITTED[f]?.receiver;
      if (receiver && Array.isArray(job.steps)) {
        const excluded = ADMITTED[f].unreachable?.[name];
        it(`${f} ${name} ${excluded ? 'can never see the admitted dispatch' : 'proves the exact dispatch intent first'}`, () => {
          const condition = String(job.if ?? '').replace(/\s+/g, ' ');
          if (excluded) {
            expect(
              condition.startsWith(`(${excluded}`) ||
                condition.startsWith(`${excluded}`) ||
                condition.includes(`(${excluded} `) ||
                condition.includes(` && ${excluded} &&`)
            ).toBe(true);
            expect(job.steps!.some((st) => st.name === PROVE)).toBe(false);
            return;
          }
          const first = job.steps![0];
          expect(first.name).toBe(PROVE);
          // Proved whenever any bot other than the Autopilot App started the
          // run or re-ran it: github.actor survives a person's re-run.
          expect(String(first.if)).toContain(
            "((endsWith(github.actor, '[bot]') && github.actor != 'smarter-poker-autopilot[bot]') || (endsWith(github.triggering_actor, '[bot]') && github.triggering_actor != 'smarter-poker-autopilot[bot]'))"
          );
          expect(String(first.run)).toContain(
            'contents/scripts/ci/dispatch-intent.mjs?ref=$GITHUB_SHA'
          );
          expect(String(first.run)).toContain(`prove --receiver ${receiver}`);
          expect(RECEIVERS[receiver].path).toBe(`.github/workflows/${f}`);
        });
      }
    }
  }

  it('no secret-holding job and no sender honours a re-run the job token started', () => {
    let guarded = 0;
    for (const f of files) {
      const jobs = (parse(read(f)) as { jobs?: Record<string, Job> }).jobs ?? {};
      for (const [name, job] of Object.entries(jobs)) {
        const sender = SENDERS.some(([sf, sj]) => sf === f && sj === name);
        if (!holdsSecret(job) && !sender) continue;
        expect(String(job.if ?? '').replace(/\s+/g, ' '), `${f} ${name}`).toContain(RERUN);
        guarded++;
      }
    }
    expect(guarded).toBeGreaterThan(100);
  });

  it('no receiver trusts a cited run by age, and every intent receiver names its file', () => {
    for (const f of files) {
      const text = read(f);
      expect(text, f).not.toContain('dispatcher_run_id');
      expect(text, f).not.toContain('DISPATCHER_RUN_ID');
      expect(text, f).not.toMatch(/fromdateiso8601\) - \(\.updated_at/);
    }
    for (const [name, r] of Object.entries(RECEIVERS) as Array<[string, { path: string }]>) {
      expect(read(r.path.replace('.github/workflows/', '')), name).toContain(
        `prove --receiver ${name}`
      );
    }
  });

  it('the three job-token senders record the exact intent on their own run before sending it', () => {
    const migrations = readFileSync('.github/scripts/dispatch-merged-migrations.sh', 'utf8');
    expect(migrations).toContain('dispatch-intent.mjs write --operation apply-merged-migration');
    expect(migrations).toContain('client_payload[intent_nonce]=$NONCE');
    const deploy = read('auto-deploy-hetzner.yml');
    expect(deploy).toContain('write --operation engine-certification');
    expect(deploy).toContain(
      'gh api --method POST "repos/$REPO/dispatches" --input "$RUNNER_TEMP/certification-dispatch.json"'
    );
    expect(readFileSync('scripts/ci/gto-v31-recheck-dispatch.mjs', 'utf8')).toContain(
      "operation: 'gto-recheck'"
    );
    for (const f of [
      'dispatch-merged-migrations.yml',
      'auto-deploy-hetzner.yml',
      'gto-v31-qualification.yml',
    ]) {
      expect(read(f), f).toContain('name: dispatch-intents-${{ github.run_attempt }}');
    }
    for (const [op, spec] of Object.entries(OPERATIONS) as Array<[string, { sender: string }]>) {
      expect(read(spec.sender.replace('.github/workflows/', '')), op).toContain(
        'dispatch-intents-${{ github.run_attempt }}'
      );
    }
  });

  it('no ci.yml job that runs queued or pull request code holds a write token', () => {
    const jobs = (parse(read('ci.yml')) as { jobs: Record<string, Job> }).jobs;
    for (const [name, job] of Object.entries(jobs)) {
      const perms = (job.permissions ?? {}) as Record<string, string>;
      const writes = Object.entries(perms).filter(([, v]) => v === 'write');
      if (!writes.length) continue;
      expect(name).toBe('retire_superseded');
      expect(String(job.if)).toContain("github.event_name == 'pull_request'");
      const checkout = (job.steps ?? []).find((s) =>
        String(s.uses ?? '').startsWith('actions/checkout')
      );
      expect((checkout?.with as Record<string, string>).ref).toBe(
        '${{ github.event.repository.default_branch }}'
      );
    }
    expect((jobs.changes.permissions as Record<string, string>).actions).toBeUndefined();
  });

  it('a fork pull request never mints the Money trigger reporter token', () => {
    const jobs = (parse(read('money-trigger-recovery.yml')) as { jobs: Record<string, Job> }).jobs;
    expect(String(jobs.verify.if)).toContain(
      'github.event.pull_request.head.repo.full_name == github.repository'
    );
    expect(String(jobs.verify.if)).toContain("github.triggering_actor != 'github-actions[bot]'");
    expect(jobs['fork-refused'].permissions).toEqual({});
    expect(JSON.stringify(jobs['fork-refused'])).not.toMatch(/secrets\.|environment/);
  });

  it('every workflow_run listener names its exact sender file, events and repository', () => {
    // A listener matches its sender by NAME, and any workflow on any branch,
    // in a pull request or a merge group, can carry that name.
    const byName = new Map<string, string>();
    for (const f of files) {
      const name = (parse(read(f)) as { name?: string }).name;
      if (name) byName.set(name, `.github/workflows/${f}`);
    }
    let listeners = 0;
    for (const f of files) {
      const doc = parse(read(f)) as {
        on?: { workflow_run?: { workflows?: string[] } };
        jobs: Record<string, Job>;
      };
      const senders = doc.on?.workflow_run?.workflows;
      if (!Array.isArray(senders)) continue;
      listeners++;
      const text = read(f).replace(/\s+/g, ' ');
      for (const sender of senders) {
        const path = byName.get(sender);
        expect(path, `${f} listens to ${sender}`).toBeTruthy();
        // By path, or by the numeric id GitHub assigned that one file.
        const byId = WORKFLOW_IDS[path ?? ''];
        expect(
          text.includes(`github.event.workflow_run.path == '${path}'`) ||
            (!!byId && text.includes(`github.event.workflow_run.workflow_id == ${byId}`)),
          `${f} binds ${sender} to ${path}`
        ).toBe(true);
      }
      expect(text, f).toContain(
        'github.event.workflow_run.head_repository.full_name == github.repository'
      );
      expect(text, f).toMatch(/github\.event\.workflow_run\.event(?: ==|\))/);
    }
    expect(listeners).toBeGreaterThanOrEqual(10);
  });

  it('a publisher listener proves the revision it selects is on protected main before using it', () => {
    const script = readFileSync('scripts/ci/selected-revision-is-on-main.sh', 'utf8');
    expect(script).toContain("'+refs/heads/main:refs/remotes/protected/main'");
    expect(script).toContain('merge-base --is-ancestor "$sha" refs/remotes/protected/main');
    const create = read('club-create-certification.yml');
    expect(create.indexOf('bash scripts/ci/selected-revision-is-on-main.sh')).toBeGreaterThan(0);
    expect(create.indexOf('bash scripts/ci/selected-revision-is-on-main.sh')).toBeLessThan(
      create.indexOf('- name: Checkout The Exact Published Revision')
    );
    expect(create).toContain(
      'publisher-run "$SOURCE_RUN_ID" "$SOURCE_TRIGGER_SHA" "$REPOSITORY_ID"'
    );
    const e2e = parse(read('post-deploy-e2e.yml')) as { jobs: Record<string, Job> };
    const gate = e2e.jobs['publication-gate'];
    const outputs = gate.outputs as Record<string, string>;
    for (const key of ['should_run', 'client_target_sha', 'verification_sha'])
      expect(outputs[key], key).toContain("steps.on-main.outputs.proved == 'true'");
    expect(JSON.stringify(gate.steps)).toContain('publisher-run');
    // IndexNow checks out the default branch only; its sender binding is pinned above.
    expect(read('indexnow-public-routes.yml')).not.toMatch(/workflow_run\.head_sha/);
  });
});
