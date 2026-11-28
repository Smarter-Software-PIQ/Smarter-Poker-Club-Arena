/**
 * LAW: engine prequalification and PR Server Engine run 8 lockstep shards, and
 * a passing main prequalification non-destructively retires only strictly older
 * ancestor runs (Wave B-1, 2026-11-28).
 *
 * When multiple engine-touching PRs merge rapidly into main, older in-flight
 * `engine-release-prequalification.yml` runs stay queued/running on superseded
 * commits and compete for runner capacity. Once a newer commit's full
 * prequalification (`qualify` 1..8 + `prestage`) has SUCCEEDED on `refs/heads/main`,
 * the final `prequalification` gate job cancels strictly older ancestor runs
 * (proven via `git merge-base --is-ancestor`), while NEVER cancelling:
 *   - itself or another run of the same SHA,
 *   - any newer commit (descendant of HEAD),
 *   - any unrelated/diverged non-ancestor commit,
 *   - anything at all when `qualify` or `prestage` did not succeed or ref != main.
 * Unreadable GitHub API responses or transient cancel errors always fail safe
 * without failing the passing prequalification run.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const ROOT = resolve(__dirname, '..');
const SCRIPT_PATH = join(ROOT, 'scripts/ci/retire-superseded-prequalification.mjs');

const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

function gitIn(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
    },
  }).trim();
}

function makeGitFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'prequal-retire-ancestry-'));
  gitIn(dir, ['init', '-q', '-b', 'main']);
  const commit = (file: string, content: string, msg: string) => {
    writeFileSync(join(dir, file), content);
    gitIn(dir, ['add', file]);
    gitIn(dir, ['commit', '-qm', msg]);
    return gitIn(dir, ['rev-parse', 'HEAD']);
  };

  const olderSha = commit('a.txt', 'v1\n', 'older');
  const currentSha = commit('a.txt', 'v2\n', 'current');
  const newerSha = commit('a.txt', 'v3\n', 'newer');

  // Create a diverged branch from olderSha so unrelatedSha is NOT an ancestor of currentSha.
  gitIn(dir, ['checkout', '-qb', 'side', olderSha]);
  const unrelatedSha = commit('side.txt', 'side\n', 'unrelated');
  gitIn(dir, ['checkout', '-q', 'main']);

  return {
    dir,
    olderSha,
    currentSha,
    newerSha,
    unrelatedSha,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

describe('8-shard lockstep expansion across prequalification, PR CI, and reader', () => {
  it('expands engine-release-prequalification.yml qualify to 8 shards and schedules historical qualification on shard 7', () => {
    const wf = parse(read('.github/workflows/engine-release-prequalification.yml'));
    const qualify = wf.jobs.qualify;
    expect(qualify.name).toBe('Qualify exact engine (${{ matrix.shard }}/8)');
    expect(qualify.strategy.matrix.shard).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(qualify['continue-on-error']).toBeUndefined();
    expect(qualify.permissions).toBeUndefined();
    const step = qualify.steps.find(
      (s: { name?: string }) => s.name === 'Compile and test the exact server tree'
    );
    expect(step).toBeTruthy();
    expect(step.run).toContain('[[ "$RELEASE_TEST_SHARD" =~ ^[1-8]$ ]]');
    expect(step.run).toContain('if [ "$RELEASE_TEST_SHARD" = 7 ]; then');
    expect(step.run).not.toContain('if [ "$RELEASE_TEST_SHARD" = 2 ]; then');
    expect(step.run).toContain('npm run build');
    expect(step.run).toContain(
      'npm test -- --exclude src/engine/RetainedHistoricalCheckpointQualification.test.ts --shard="$RELEASE_TEST_SHARD/8"'
    );
  });

  it('expands ci.yml server_shards to 8 shards in exact lockstep with max-parallel 8', () => {
    const ci = parse(read('.github/workflows/ci.yml'));
    const shards = ci.jobs.server_shards;
    expect(shards.name).toBe('Server Engine shard ${{ matrix.shard }}/8');
    expect(shards.strategy['max-parallel']).toBe(8);
    expect(shards.strategy.matrix.shard).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const full = shards.steps.find((s: { name?: string }) => s.name === 'Full server test suite');
    expect(full).toBeTruthy();
    expect(full.run).toContain('[[ "$SERVER_TEST_SHARD" =~ ^[1-8]$ ]]');
    expect(full.run).toContain(
      'npm test -- --exclude src/engine/RetainedHistoricalCheckpointQualification.test.ts --shard="$SERVER_TEST_SHARD/8"'
    );
  });

  it('wires the final passing prequalification gate job with least-privilege actions:write and fail-safe execution', () => {
    const wf = parse(read('.github/workflows/engine-release-prequalification.yml'));
    expect(wf.permissions).toEqual({ contents: 'read' });
    expect(wf.jobs.prestage.permissions).toBeUndefined();

    const gate = wf.jobs.prequalification;
    expect(gate, 'prequalification job missing').toBeTruthy();
    expect(gate.name).toBe('Retire superseded prequalification runs');
    expect(gate.needs).toEqual(['qualify', 'prestage']);
    expect(gate.if).toContain("github.ref == 'refs/heads/main'");
    expect(gate.if).toContain("needs.qualify.result == 'success'");
    expect(gate.if).toContain("needs.prestage.result == 'success'");
    expect(gate.if).not.toMatch(/always\(\)|failure\(\)/);
    expect(gate.permissions).toEqual({ contents: 'read', actions: 'write' });
    expect(gate['timeout-minutes']).toBe(10);
    expect(gate.environment).toBeUndefined();
    expect(JSON.stringify(gate)).not.toMatch(/secrets\.(?!GITHUB_TOKEN\b)/);

    const checkout = gate.steps.find((s: { uses?: string }) =>
      String(s.uses ?? '').startsWith('actions/checkout@')
    );
    expect(checkout?.['continue-on-error']).toBe(true);
    expect(checkout?.with?.['fetch-depth']).toBe(0);
    expect(checkout?.with?.['sparse-checkout-cone-mode']).toBe(false);
    expect(String(checkout?.with?.['sparse-checkout'] ?? '').trim()).toBe(
      'scripts/ci/retire-superseded-prequalification.mjs'
    );
    expect(checkout?.with?.['persist-credentials']).toBe(false);

    const retire = gate.steps.find(
      (s: { run?: string }) =>
        typeof s.run === 'string' &&
        s.run.includes('node scripts/ci/retire-superseded-prequalification.mjs')
    );
    expect(retire, 'retire-superseded-prequalification.mjs step missing').toBeTruthy();
    expect(retire['continue-on-error']).toBe(true);
    expect(retire.run).toContain(
      'if [ -f scripts/ci/retire-superseded-prequalification.mjs ]; then'
    );
    expect(retire.env?.GH_TOKEN).toBe('${{ github.token }}');
    expect(retire.env?.QUALIFY_RESULT).toBe('${{ needs.qualify.result }}');
    expect(retire.env?.PRESTAGE_RESULT).toBe('${{ needs.prestage.result }}');
  });

  it('keeps scripts/ci/read-engine-prequalification.py aligned with all 8 shards plus prestage and non-blocking retire conclusions', () => {
    const reader = read('scripts/ci/read-engine-prequalification.py');
    expect(reader).toContain('Qualify exact engine ({n}/8)');
    expect(reader).toContain('range(1, 9)');
    expect(reader).toContain('Retire superseded prequalification runs');
    expect(reader).toContain('("success", "neutral", "skipped")');
  });
});

describe('non-destructive prequalification runner-storm suppression', () => {
  const repository = 'Smarter-Software-PIQ/Smarter-Poker-Club-Arena';
  const workflowPath = '.github/workflows/engine-release-prequalification.yml';

  async function loadModule() {
    expect(existsSync(SCRIPT_PATH), `${SCRIPT_PATH} must exist`).toBe(true);
    return (await import(SCRIPT_PATH)) as {
      isStrictGitAncestor: (candidateSha: string, currentSha: string, cwd?: string) => boolean;
      retireSupersededPrequalification: (opts: {
        repository: string;
        runId: number;
        headSha: string;
        ref: string;
        qualifyResult: string;
        prestageResult: string;
        request: (method: string, path: string) => Promise<unknown>;
        isStrictAncestor: (oldSha: string, currentSha: string) => boolean;
        log?: (msg: string) => void;
        warn?: (msg: string) => void;
      }) => Promise<{
        cancelled: number[];
        skipped: Array<{ id: number; reason: string }>;
        errors: Array<{ id?: number; message: string }>;
        reason: string;
      }>;
    };
  }

  it('cancels strictly older ancestor queued/in-progress runs when current run succeeds, and never cancels newer, same-SHA, self, or unrelated commits', async () => {
    const { isStrictGitAncestor, retireSupersededPrequalification } = await loadModule();
    const git = makeGitFixture();
    try {
      const unknownSha = '9'.repeat(40);
      const writes: string[] = [];
      const baseRun = {
        path: workflowPath,
        head_branch: 'main',
        repository: { full_name: repository },
        head_repository: { full_name: repository },
      };

      const queuedRuns = [
        { ...baseRun, id: 501, status: 'queued', head_sha: git.olderSha },
        { ...baseRun, id: 502, status: 'queued', head_sha: git.newerSha },
        { ...baseRun, id: 503, status: 'queued', head_sha: git.unrelatedSha },
        { ...baseRun, id: 504, status: 'queued', head_sha: unknownSha },
      ];
      const inProgressRuns = [
        { ...baseRun, id: 600, status: 'in_progress', head_sha: git.currentSha }, // self
        { ...baseRun, id: 601, status: 'in_progress', head_sha: git.currentSha }, // duplicate same SHA
        { ...baseRun, id: 602, status: 'in_progress', head_sha: git.olderSha }, // strictly older ancestor
        { ...baseRun, id: 603, status: 'in_progress', head_sha: git.newerSha }, // newer descendant
        { ...baseRun, id: 604, status: 'completed', head_sha: git.olderSha }, // already completed
        {
          ...baseRun,
          id: 605,
          status: 'in_progress',
          head_sha: git.olderSha,
          head_branch: 'topic',
        },
        {
          ...baseRun,
          id: 606,
          status: 'in_progress',
          head_sha: git.olderSha,
          path: '.github/workflows/ci.yml',
        },
        {
          ...baseRun,
          id: 607,
          status: 'in_progress',
          head_sha: git.olderSha,
          repository: { full_name: 'other/fork' },
        },
      ];

      const request = async (method: string, path: string) => {
        if (method === 'POST') {
          writes.push(path);
          return {};
        }
        if (path.includes('status=in_progress')) return { workflow_runs: inProgressRuns };
        if (path.includes('status=queued')) return { workflow_runs: queuedRuns };
        throw new Error(`Unexpected request: ${method} ${path}`);
      };

      const result = await retireSupersededPrequalification({
        repository,
        runId: 600,
        headSha: git.currentSha,
        ref: 'refs/heads/main',
        qualifyResult: 'success',
        prestageResult: 'success',
        request,
        isStrictAncestor: (oldSha, currentSha) => isStrictGitAncestor(oldSha, currentSha, git.dir),
        log: () => {},
        warn: () => {},
      });

      expect(result.reason).toBe('complete');
      expect(result.errors).toEqual([]);
      expect(result.cancelled).toEqual([602, 501]);
      expect(writes).toEqual([
        `repos/${repository}/actions/runs/602/cancel`,
        `repos/${repository}/actions/runs/501/cancel`,
      ]);
      // Explicitly prove newer, unrelated, unknown, same-SHA, and self were never cancelled.
      for (const safeId of [502, 503, 504, 600, 601, 603, 604, 605, 606, 607]) {
        expect(writes.some((w) => w.includes(`/runs/${safeId}/cancel`))).toBe(false);
      }
    } finally {
      git.cleanup();
    }
  });

  it.each([
    [
      'qualify failed',
      { qualifyResult: 'failure', prestageResult: 'success', ref: 'refs/heads/main' },
    ],
    [
      'prestage failed',
      { qualifyResult: 'success', prestageResult: 'failure', ref: 'refs/heads/main' },
    ],
    [
      'qualify cancelled',
      { qualifyResult: 'cancelled', prestageResult: 'success', ref: 'refs/heads/main' },
    ],
    [
      'prestage skipped',
      { qualifyResult: 'success', prestageResult: 'skipped', ref: 'refs/heads/main' },
    ],
    [
      'non-main ref',
      { qualifyResult: 'success', prestageResult: 'success', ref: 'refs/heads/feature' },
    ],
  ])('never cancels anything when %s', async (_label, gateState) => {
    const { retireSupersededPrequalification } = await loadModule();
    let apiCalls = 0;
    const result = await retireSupersededPrequalification({
      repository,
      runId: 700,
      headSha: 'a'.repeat(40),
      ...gateState,
      request: async () => {
        apiCalls++;
        return { workflow_runs: [] };
      },
      isStrictAncestor: () => true,
      log: () => {},
      warn: () => {},
    });
    expect(apiCalls).toBe(0);
    expect(result.cancelled).toEqual([]);
    expect(result.reason).toBe('gate-not-passed');
  });

  it('fails safe when the GitHub API is unreadable or a cancel request returns an error', async () => {
    const { retireSupersededPrequalification } = await loadModule();
    const warnings: string[] = [];

    // Case 1: inventory read throws (API outage / rate limit)
    const unreadable = await retireSupersededPrequalification({
      repository,
      runId: 800,
      headSha: 'b'.repeat(40),
      ref: 'refs/heads/main',
      qualifyResult: 'success',
      prestageResult: 'success',
      request: async () => {
        throw new Error('HTTP 503 Service Unavailable');
      },
      isStrictAncestor: () => true,
      log: () => {},
      warn: (m) => warnings.push(m),
    });
    expect(unreadable.cancelled).toEqual([]);
    expect(unreadable.errors.length).toBeGreaterThan(0);
    expect(warnings.some((w) => w.includes('503'))).toBe(true);

    // Case 2: one cancel fails (409 already completed) while another succeeds
    const older1 = '1'.repeat(40);
    const older2 = '2'.repeat(40);
    const partialWarnings: string[] = [];
    const partial = await retireSupersededPrequalification({
      repository,
      runId: 801,
      headSha: 'b'.repeat(40),
      ref: 'refs/heads/main',
      qualifyResult: 'success',
      prestageResult: 'success',
      request: async (method, path) => {
        if (method === 'GET' && path.includes('status=in_progress')) {
          return {
            workflow_runs: [
              {
                id: 790,
                status: 'in_progress',
                head_sha: older1,
                head_branch: 'main',
                path: workflowPath,
                repository: { full_name: repository },
                head_repository: { full_name: repository },
              },
              {
                id: 791,
                status: 'in_progress',
                head_sha: older2,
                head_branch: 'main',
                path: workflowPath,
                repository: { full_name: repository },
                head_repository: { full_name: repository },
              },
            ],
          };
        }
        if (method === 'GET') return { workflow_runs: [] };
        if (path.includes('/runs/790/cancel')) throw new Error('HTTP 409 Conflict');
        return {};
      },
      isStrictAncestor: () => true,
      log: () => {},
      warn: (m) => partialWarnings.push(m),
    });
    expect(partial.cancelled).toEqual([791]);
    expect(partial.errors).toEqual([{ id: 790, message: 'HTTP 409 Conflict' }]);
    expect(partialWarnings.some((w) => w.includes('790'))).toBe(true);

    // Case 3: CLI entrypoint exits 0 with warning even when GH_TOKEN is absent
    const cli = spawnSync(process.execPath, [SCRIPT_PATH], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        GITHUB_REPOSITORY: repository,
        GITHUB_RUN_ID: '802',
        GITHUB_SHA: 'b'.repeat(40),
        GITHUB_REF: 'refs/heads/main',
        QUALIFY_RESULT: 'success',
        PRESTAGE_RESULT: 'success',
      },
    });
    expect(cli.status, cli.stderr).toBe(0);
    expect(cli.stderr).toContain('::warning::');
  });
});
