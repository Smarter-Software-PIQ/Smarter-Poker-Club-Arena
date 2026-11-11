/**
 * A JOB TOKEN CANNOT START TRUSTED WORK (owner authorization 2026-11-11).
 *
 * A merge-group run executes the queued commit's own workflow files, so queued
 * code can grant its job token write scopes and use it to send
 * workflow_dispatch or repository_dispatch events. Those run main's trusted
 * workflows with the queued code's inputs. Every job that reads a secret in a
 * workflow such an event can start therefore refuses a dispatch whose
 * triggering actor is the job token (github-actions[bot]). The three trusted
 * senders that legitimately dispatch with the job token pass their own run id,
 * and the receiver proves that run is a current run of the expected sender
 * workflow before it reads anything.
 *
 * The same review capped the queue-reachable token in ci.yml, refused fork
 * pull requests at the Money trigger reporter without minting its App token,
 * and bound two workflow_run readers to this repository's own events.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const DIR = join(process.cwd(), '.github', 'workflows');
const read = (f: string) => readFileSync(join(DIR, f), 'utf8');
// A workflow only a dispatch (or a pull request) can start compares the actor;
// one that other events also start refuses only the dispatch from the job token.
const SHORT = "github.triggering_actor != 'github-actions[bot]'";
const FULL =
  "!((github.event_name == 'workflow_dispatch' || github.event_name == 'repository_dispatch') && github.triggering_actor == 'github-actions[bot]')";
const DISPATCH_ONLY = new Set([
  'workflow_dispatch',
  'repository_dispatch',
  'pull_request',
  'pull_request_target',
]);
// Receivers of a job-token dispatch: the event that is admitted, and the
// workflow and event of the only run allowed to send it.
const ADMITTED: Record<string, { admitted: string; sender?: string; event?: string }> = {
  'apply-merged-migration.yml': {
    admitted:
      "github.event_name == 'repository_dispatch' && github.event.action == 'apply-merged-migration'",
    sender: '.github/workflows/dispatch-merged-migrations.yml',
    event: 'pull_request',
  },
  'post-deploy-e2e.yml': {
    admitted:
      "github.event_name == 'repository_dispatch' && github.event.action == 'run-post-deploy-e2e'",
    sender: '.github/workflows/auto-deploy-hetzner.yml',
    event: 'repository_dispatch',
  },
  // The seal's run-post-deploy-e2e dispatch also refreshes Backup.
  'backup-engine.yml': {
    admitted:
      "github.event_name == 'repository_dispatch' && github.event.action == 'run-post-deploy-e2e'",
    sender: '.github/workflows/auto-deploy-hetzner.yml',
    event: 'repository_dispatch',
  },
  'gto-v31-qualification.yml': {
    admitted: "github.event_name == 'workflow_dispatch' && inputs.operation == 'recheck'",
    sender: '.github/workflows/gto-v31-qualification.yml',
    event: 'workflow_run',
  },
  // The engine receiver proves its selection run against prequalification.
  'auto-deploy-hetzner.yml': {
    admitted:
      "github.event_name == 'repository_dispatch' && github.event.action == 'deploy-club-arena-engine'",
  },
};
// Owned by the pull-request environment lane, and the deleted one-shot mover.
// The PR-environment lane's file, the deleted one-shot mover, and the Money
// trigger reporter (its own guard is pinned below).
const OUT_OF_SCOPE = new Set([
  'settlement-lane-doctrine.yml',
  'copy-repository-secrets-to-environments.yml',
  'money-trigger-recovery.yml',
]);

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
        const condition = String(job.if ?? '').replace(/\s+/g, ' ');
        // A job whose own condition already admits only a dispatch event
        // carries the short form: the event clause would be redundant.
        const dispatchOnlyJob =
          !admitted &&
          /^(?:\$\{\{ )?github\.event_name == '(?:repository|workflow)_dispatch' && /.test(
            condition
          ) &&
          !condition.includes('||');
        expect(condition).toContain(dispatchOnlyJob ? SHORT : guard);
      });
      const sender = ADMITTED[f]?.sender;
      if (sender && Array.isArray(job.steps)) {
        it(`${f} ${name} proves the sender run first`, () => {
          const first = job.steps![0];
          expect(first.name).toBe('Prove a job-token dispatch came from its trusted sender');
          const env = first.env as Record<string, string>;
          expect(env.EXPECTED_PATH).toBe(sender);
          expect(env.EXPECTED_EVENT).toBe(ADMITTED[f].event);
          expect(String(first.run)).toContain('.head_repository.full_name == $repo');
        });
      }
    }
  }

  it('the three job-token senders name their own run', () => {
    expect(readFileSync('.github/scripts/dispatch-merged-migrations.sh', 'utf8')).toContain(
      'client_payload[dispatcher_run_id]=$GITHUB_RUN_ID'
    );
    const deploy = read('auto-deploy-hetzner.yml');
    expect(deploy).toMatch(
      /event_type=run-post-deploy-e2e \\\n\s+-f "client_payload\[dispatcher_run_id\]=\$GITHUB_RUN_ID"/
    );
    expect(readFileSync('scripts/ci/gto-v31-recheck-dispatch.mjs', 'utf8')).toContain(
      'recheckDispatchBody(d.dataset, process.env.GITHUB_RUN_ID)'
    );
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

  it('two workflow_run readers accept only this repository and its own events', () => {
    const gto = (parse(read('gto-v31-qualification.yml')) as { jobs: Record<string, Job> }).jobs;
    expect(String(gto['recheck-after-release'].if)).toContain(
      "github.event.workflow_run.head_repository.full_name == github.repository && github.event.workflow_run.event == 'repository_dispatch'"
    );
    const alerts = (
      parse(read('operational-alert-addressing.yml')) as { jobs: Record<string, Job> }
    ).jobs;
    expect(String(alerts['live-addressing'].if)).toContain(
      `github.event.workflow_run.head_repository.full_name == github.repository && github.event.workflow_run.head_branch == 'main' && contains(fromJSON('["schedule","repository_dispatch"]'), github.event.workflow_run.event)`
    );
  });
});
