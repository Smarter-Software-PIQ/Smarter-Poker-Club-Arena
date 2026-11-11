import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error untyped CI module
import { artifactName, proveIntent, writeIntent } from '../../scripts/ci/dispatch-intent.mjs';

const REPO = 'Smarter-Software-PIQ/Smarter-Poker-Club-Arena';
const MAIN = 'a'.repeat(40);
const ENGINE = 'b'.repeat(40);
// Real event shapes: a pull_request_target run's GITHUB_SHA is the base tip
// while GitHub records the pull request head as run.head_sha; a push-side or
// workflow_run sender binds the head_sha of its own run record.
const BASE_TIP = 'd'.repeat(40);
const PR_HEAD = 'e'.repeat(40);
const PR = 77;
const NONCE = '0123456789abcdef0123456789abcdef';
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function senderEnv(path: string, event: string, attempt = '1') {
  return {
    GITHUB_REPOSITORY: REPO,
    GITHUB_WORKFLOW_REF: `${REPO}/${path}@refs/heads/main`,
    GITHUB_RUN_ID: '500',
    GITHUB_RUN_ATTEMPT: attempt,
    GITHUB_SHA: event === 'pull_request_target' ? BASE_TIP : MAIN,
    GITHUB_EVENT_NAME: event,
  };
}
const prEvent = (over: Record<string, unknown> = {}) => ({
  repository: { default_branch: 'main' },
  pull_request: {
    number: PR,
    merged: true,
    base: { ref: 'main', repo: { full_name: REPO } },
    head: { sha: PR_HEAD, repo: { full_name: REPO } },
    ...over,
  },
});
const ownRun = { id: 500, head_sha: MAIN };

function world(opts: {
  operation: string;
  inputs: Record<string, unknown>;
  senderPath: string;
  senderEvent: string;
  receiverPath: string;
  receiverEvent: string;
  title: string;
  headBranch?: string;
  earlier?: number[];
}) {
  const dir = mkdtempSync(join(tmpdir(), 'intent-test-'));
  dirs.push(dir);
  const prt = opts.senderEvent === 'pull_request_target';
  const head = prt ? PR_HEAD : MAIN;
  const sent = writeIntent({
    operation: opts.operation,
    inputs: opts.inputs,
    dir,
    nonce: NONCE,
    env: senderEnv(opts.senderPath, opts.senderEvent),
    ...(prt ? { event: prEvent() } : { ownRun }),
  });
  const record = readFileSync(join(dir, `${NONCE}.json`), 'utf8');
  const runs: Record<string, any> = {
    'actions/runs/900': {
      id: 900,
      run_attempt: 1,
      path: opts.receiverPath,
      event: opts.receiverEvent,
      display_title: opts.title,
    },
    'actions/runs/500/attempts/1': {
      id: 500,
      run_attempt: 1,
      path: opts.senderPath,
      event: opts.senderEvent,
      head_branch: opts.headBranch ?? 'main',
      head_sha: head,
      created_at: '2026-11-11T20:00:00Z',
      repository: { full_name: REPO },
      head_repository: { full_name: REPO },
    },
    [`compare/${MAIN}...main`]: { status: 'identical' },
    [`pulls/${PR}`]: {
      number: PR,
      merged: true,
      base: { ref: 'main', repo: { full_name: REPO } },
      head: { sha: PR_HEAD, repo: { full_name: REPO } },
    },
  };
  const state = { record, runs, earlier: opts.earlier ?? [] };
  const api = async (path: string) => {
    if (path.startsWith('actions/runs/500/artifacts'))
      return {
        artifacts: [
          {
            id: 7,
            name: artifactName('1'),
            expired: false,
            workflow_run: { id: 500, head_sha: head },
          },
        ],
      };
    if (path.startsWith('actions/workflows/'))
      return {
        workflow_runs: [
          { id: 900, display_title: opts.title },
          ...state.earlier.map((id) => ({ id, display_title: opts.title })),
        ],
      };
    if (!(path in state.runs)) throw new Error(`unexpected ${path}`);
    return state.runs[path];
  };
  const readIntent = async (_a: unknown, nonce: string) => (nonce === NONCE ? state.record : '');
  return { sent, state, api, readIntent };
}

const engine = (over: Partial<Parameters<typeof world>[0]> = {}) =>
  world({
    operation: 'engine-certification',
    inputs: { engine_sha: ENGINE, release_run_key: '500-1', gameplay_receipt: '{"x":1}' },
    senderPath: '.github/workflows/auto-deploy-hetzner.yml',
    senderEvent: 'repository_dispatch',
    receiverPath: '.github/workflows/post-deploy-e2e.yml',
    receiverEvent: 'repository_dispatch',
    title: `Post-Deploy E2E ${ENGINE} ${NONCE}`,
    ...over,
  });
const receiverEnv = (event: string) => ({
  GITHUB_REPOSITORY: REPO,
  GITHUB_EVENT_NAME: event,
  GITHUB_RUN_ID: '900',
  GITHUB_RUN_ATTEMPT: '1',
});

describe('a job-token dispatch is bound to the exact intent its trusted sender recorded', () => {
  it('admits the exact dispatch the sender wrote', async () => {
    const w = engine();
    const event = {
      action: 'run-post-deploy-e2e',
      client_payload: w.sent.body.client_payload,
      repository: { default_branch: 'main' },
    };
    await expect(
      proveIntent({
        receiverName: 'post-deploy-e2e',
        env: receiverEnv('repository_dispatch'),
        event,
        api: w.api,
        readIntent: w.readIntent,
      })
    ).resolves.toBeTruthy();
  });

  it('refuses a substituted, added or missing input', async () => {
    const w = engine();
    const base = w.sent.body.client_payload;
    for (const payload of [
      { ...base, engine_sha: 'c'.repeat(40) },
      { ...base, extra: '1' },
      { ...base, gameplay_receipt: undefined },
    ]) {
      const clean = JSON.parse(JSON.stringify(payload));
      const event = { action: 'run-post-deploy-e2e', client_payload: clean };
      await expect(
        proveIntent({
          receiverName: 'post-deploy-e2e',
          env: receiverEnv('repository_dispatch'),
          event,
          api: w.api,
          readIntent: w.readIntent,
        })
      ).rejects.toThrow();
    }
  });

  it('refuses a replay: an earlier run of the receiver already carries this intent title', async () => {
    const w = engine({ earlier: [899] });
    const event = { action: 'run-post-deploy-e2e', client_payload: w.sent.body.client_payload };
    await expect(
      proveIntent({
        receiverName: 'post-deploy-e2e',
        env: receiverEnv('repository_dispatch'),
        event,
        api: w.api,
        readIntent: w.readIntent,
      })
    ).rejects.toThrow(/already consumed/);
  });

  it('refuses a sender run of the wrong workflow, a non-main head, or another repository', async () => {
    for (const mutate of [
      (r: any) => {
        r.path = '.github/workflows/ci.yml';
      },
      (r: any) => {
        r.head_branch = 'gh-readonly-queue/main/pr-1';
      },
      (r: any) => {
        r.head_repository = { full_name: 'fork/x' };
      },
      (r: any) => {
        r.event = 'merge_group';
      },
    ]) {
      const w = engine();
      mutate(w.state.runs['actions/runs/500/attempts/1']);
      const event = { action: 'run-post-deploy-e2e', client_payload: w.sent.body.client_payload };
      await expect(
        proveIntent({
          receiverName: 'post-deploy-e2e',
          env: receiverEnv('repository_dispatch'),
          event,
          api: w.api,
          readIntent: w.readIntent,
        })
      ).rejects.toThrow();
    }
    const w = engine();
    w.state.runs[`compare/${MAIN}...main`] = { status: 'diverged' };
    const event = { action: 'run-post-deploy-e2e', client_payload: w.sent.body.client_payload };
    await expect(
      proveIntent({
        receiverName: 'post-deploy-e2e',
        env: receiverEnv('repository_dispatch'),
        event,
        api: w.api,
        readIntent: w.readIntent,
      })
    ).rejects.toThrow(/protected main/);
  });

  it('refuses a forged record that names another operation or nonce, and a dispatch without an intent', async () => {
    const w = engine();
    w.state.record = JSON.stringify({
      ...JSON.parse(w.state.record),
      operation: 'apply-merged-migration',
    });
    const event = { action: 'run-post-deploy-e2e', client_payload: w.sent.body.client_payload };
    await expect(
      proveIntent({
        receiverName: 'post-deploy-e2e',
        env: receiverEnv('repository_dispatch'),
        event,
        api: w.api,
        readIntent: w.readIntent,
      })
    ).rejects.toThrow(/operation/);
    const bare = {
      action: 'run-post-deploy-e2e',
      client_payload: { engine_sha: ENGINE, dispatcher_run_id: '500' },
    };
    await expect(
      proveIntent({
        receiverName: 'post-deploy-e2e',
        env: receiverEnv('repository_dispatch'),
        event: bare,
        api: w.api,
        readIntent: w.readIntent,
      })
    ).rejects.toThrow(/cite/);
  });

  it('refuses a bot re-run, proves a re-run a person started, and refuses a run whose title does not carry the intent', async () => {
    const w = engine();
    const event = { action: 'run-post-deploy-e2e', client_payload: w.sent.body.client_payload };
    await expect(
      proveIntent({
        receiverName: 'post-deploy-e2e',
        env: { ...receiverEnv('repository_dispatch'), GITHUB_RUN_ATTEMPT: '2' },
        event,
        api: w.api,
        readIntent: w.readIntent,
      })
    ).rejects.toThrow(/does not match/);
    w.state.runs['actions/runs/900'].run_attempt = 2;
    w.state.runs['actions/runs/900'].triggering_actor = { login: 'github-actions[bot]' };
    await expect(
      proveIntent({
        receiverName: 'post-deploy-e2e',
        env: {
          ...receiverEnv('repository_dispatch'),
          GITHUB_RUN_ATTEMPT: '2',
          GITHUB_TRIGGERING_ACTOR: 'github-actions[bot]',
        },
        event,
        api: w.api,
        readIntent: w.readIntent,
      })
    ).rejects.toThrow(/person started/);
    w.state.runs['actions/runs/900'].triggering_actor = { login: 'Smarter-Poker' };
    await expect(
      proveIntent({
        receiverName: 'post-deploy-e2e',
        env: {
          ...receiverEnv('repository_dispatch'),
          GITHUB_RUN_ATTEMPT: '2',
          GITHUB_TRIGGERING_ACTOR: 'Smarter-Poker',
        },
        event,
        api: w.api,
        readIntent: w.readIntent,
      })
    ).resolves.toMatchObject({ title: expect.any(String) });
    w.state.runs['actions/runs/900'].run_attempt = 1;
    w.state.runs['actions/runs/900'].display_title = `Post-Deploy E2E ${ENGINE}`;
    await expect(
      proveIntent({
        receiverName: 'post-deploy-e2e',
        env: receiverEnv('repository_dispatch'),
        event,
        api: w.api,
        readIntent: w.readIntent,
      })
    ).rejects.toThrow(/title/);
  });

  it('binds the backup receiver to the sending attempt through release_run_key', async () => {
    const w = engine({
      receiverPath: '.github/workflows/backup-engine.yml',
      title: 'Backup after seal 500-1',
    });
    const event = { action: 'run-post-deploy-e2e', client_payload: w.sent.body.client_payload };
    await expect(
      proveIntent({
        receiverName: 'backup-after-seal',
        env: receiverEnv('repository_dispatch'),
        event,
        api: w.api,
        readIntent: w.readIntent,
      })
    ).resolves.toBeTruthy();
    expect(() =>
      writeIntent({
        operation: 'engine-certification',
        inputs: { engine_sha: ENGINE, release_run_key: '1-1' },
        dir: mkdtempSync(join(tmpdir(), 'x-')),
        env: senderEnv('.github/workflows/auto-deploy-hetzner.yml', 'repository_dispatch'),
      })
    ).not.toThrow();
  });

  it('admits a merged-migration intent from pull_request_target and binds the file and dry_run', async () => {
    const w = world({
      operation: 'apply-merged-migration',
      inputs: { migration: '20261111000000_x.sql', dry_run: false },
      senderPath: '.github/workflows/dispatch-merged-migrations.yml',
      senderEvent: 'pull_request_target',
      headBranch: 'agent/some-pr',
      receiverPath: '.github/workflows/apply-merged-migration.yml',
      receiverEvent: 'repository_dispatch',
      title: `Apply Merged Migration 20261111000000_x.sql ${NONCE}`,
    });
    const event = { action: 'apply-merged-migration', client_payload: w.sent.body.client_payload };
    await expect(
      proveIntent({
        receiverName: 'apply-merged-migration',
        env: receiverEnv('repository_dispatch'),
        event,
        api: w.api,
        readIntent: w.readIntent,
      })
    ).resolves.toBeTruthy();
    const swapped = {
      action: 'apply-merged-migration',
      client_payload: { ...w.sent.body.client_payload, dry_run: 'false' },
    };
    await expect(
      proveIntent({
        receiverName: 'apply-merged-migration',
        env: receiverEnv('repository_dispatch'),
        event: swapped,
        api: w.api,
        readIntent: w.readIntent,
      })
    ).rejects.toThrow(/dry_run/);
  });

  it('a merged-migration intent binds the pull request: merged, same repository, into main, head = run head', async () => {
    for (const mutate of [
      (pr: any) => {
        pr.merged = false;
      },
      (pr: any) => {
        pr.base.ref = 'release/x';
      },
      (pr: any) => {
        pr.head.repo.full_name = 'fork/x';
      },
      (pr: any) => {
        pr.head.sha = 'f'.repeat(40);
      },
    ]) {
      const w = world({
        operation: 'apply-merged-migration',
        inputs: { migration: '20261111000000_x.sql', dry_run: false },
        senderPath: '.github/workflows/dispatch-merged-migrations.yml',
        senderEvent: 'pull_request_target',
        headBranch: 'agent/some-pr',
        receiverPath: '.github/workflows/apply-merged-migration.yml',
        receiverEvent: 'repository_dispatch',
        title: `Apply Merged Migration 20261111000000_x.sql ${NONCE}`,
      });
      mutate(w.state.runs[`pulls/${PR}`]);
      const event = {
        action: 'apply-merged-migration',
        client_payload: w.sent.body.client_payload,
      };
      await expect(
        proveIntent({
          receiverName: 'apply-merged-migration',
          env: receiverEnv('repository_dispatch'),
          event,
          api: w.api,
          readIntent: w.readIntent,
        })
      ).rejects.toThrow();
    }
    const dir = mkdtempSync(join(tmpdir(), 'x-'));
    dirs.push(dir);
    const env = senderEnv(
      '.github/workflows/dispatch-merged-migrations.yml',
      'pull_request_target'
    );
    const inputs = { migration: '20261111000000_x.sql', dry_run: false };
    expect(() => writeIntent({ operation: 'apply-merged-migration', inputs, dir, env })).toThrow(
      /pull request/
    );
    for (const event of [
      prEvent({ merged: false }),
      prEvent({ base: { ref: 'release/x' } }),
      prEvent({ head: { sha: PR_HEAD, repo: { full_name: 'fork/x' } } }),
    ])
      expect(() =>
        writeIntent({ operation: 'apply-merged-migration', inputs, dir, env, event })
      ).toThrow();
  });

  it('a non-pull-request sender binds the head_sha of its own run record, not a re-read of main', () => {
    const dir = mkdtempSync(join(tmpdir(), 'x-'));
    dirs.push(dir);
    const env = senderEnv('.github/workflows/auto-deploy-hetzner.yml', 'repository_dispatch');
    const out = writeIntent({
      operation: 'engine-certification',
      inputs: { engine_sha: ENGINE },
      dir,
      env: { ...env, GITHUB_SHA: BASE_TIP },
      ownRun,
    });
    expect(out.intent.senderHeadSha).toBe(MAIN);
    expect(() =>
      writeIntent({
        operation: 'engine-certification',
        inputs: { engine_sha: ENGINE },
        dir,
        env,
        ownRun: { id: 501, head_sha: MAIN },
      })
    ).toThrow(/this run/);
  });

  it('admits a recheck workflow_dispatch and refuses an operation other than recheck', async () => {
    const dataset = '11111111-2222-4333-8444-555555555555';
    const w = world({
      operation: 'gto-recheck',
      inputs: { dataset, operation: 'recheck', reason: '' },
      senderPath: '.github/workflows/gto-v31-qualification.yml',
      senderEvent: 'workflow_run',
      receiverPath: '.github/workflows/gto-v31-qualification.yml',
      receiverEvent: 'workflow_dispatch',
      title: `V31 qualification recheck ${dataset} ${NONCE}`,
    });
    const event = { inputs: { ...w.sent.body.inputs, engine: '' } };
    await expect(
      proveIntent({
        receiverName: 'gto-recheck',
        env: receiverEnv('workflow_dispatch'),
        event,
        api: w.api,
        readIntent: w.readIntent,
      })
    ).resolves.toBeTruthy();
    const promote = { inputs: { ...w.sent.body.inputs, operation: 'promote' } };
    await expect(
      proveIntent({
        receiverName: 'gto-recheck',
        env: receiverEnv('workflow_dispatch'),
        event: promote,
        api: w.api,
        readIntent: w.readIntent,
      })
    ).rejects.toThrow();
    expect(() =>
      writeIntent({
        operation: 'gto-recheck',
        inputs: { dataset, operation: 'promote', reason: '' },
        dir: mkdtempSync(join(tmpdir(), 'x-')),
        env: senderEnv('.github/workflows/gto-v31-qualification.yml', 'workflow_run'),
      })
    ).toThrow();
  });

  it('a sender outside its workflow or event cannot even write an intent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'x-'));
    dirs.push(dir);
    expect(() =>
      writeIntent({
        operation: 'engine-certification',
        inputs: { engine_sha: ENGINE },
        dir,
        env: senderEnv('.github/workflows/ci.yml', 'merge_group'),
      })
    ).toThrow();
    expect(() =>
      writeIntent({
        operation: 'engine-certification',
        inputs: { engine_sha: ENGINE },
        dir,
        env: senderEnv('.github/workflows/auto-deploy-hetzner.yml', 'merge_group'),
      })
    ).toThrow();
  });
});
