import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it, vi } from 'vitest';

// Subprocess contract suite: these tests drive REAL child processes, so their
// wall time scales with machine load, not with the code under test. vitest's
// 5000ms default is a UNIT-test budget: the slowest test here measures 299ms
// solo, and the pre-push hook runs this file in a 90-file suite at full width,
// where contention has been measured to stretch these runs by 7.1x and time
// them out. 90s is 301x the measured solo runtime - past anything observed,
// and still a real bound, so a genuinely hung child still fails the suite.
// File-scoped on purpose: no global testTimeout, no --no-file-parallelism.
vi.setConfig({ testTimeout: 90_000 });
import {
  classifyChangedPaths,
  gitEnvironmentForCwd,
} from '../../scripts/ci/classify-ci-changes.mjs';

const root = resolve(__dirname, '../..');
const workflow = (name: string) =>
  parse(readFileSync(join(root, '.github/workflows', name), 'utf8'));
const stage = workflow('stage-engine-release.yml');
const publisher = workflow('publish-club-arena.yml');
const transaction = workflow('publish-club-arena-transaction.yml');

describe('bounded read-only recovery checkouts', () => {
  it('hydrates only stage admission files while retaining exact-source full history', () => {
    const job = stage.jobs.detect;
    const checkout = job.steps.find((step: any) => step.uses === 'actions/checkout@v4');
    expect(job['timeout-minutes']).toBe(3);
    expect(checkout.with.ref).toBe('${{ github.sha }}');
    expect(checkout.with['fetch-depth']).toBe(0);
    expect(checkout.with.filter).toBe('blob:none');
    expect(checkout.with['sparse-checkout-cone-mode']).toBe(false);
    expect(checkout.with['sparse-checkout'].trim().split('\n')).toEqual([
      '/server/scripts/engine-release-seal.py',
      '/server/release/owner-maintenance-windows.json',
      '/server/release/activation-floor.json',
    ]);
  });

  it('keeps historical source witnesses readable without hydrating unrelated blobs', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ca-sparse-admission-'));
    const env = {
      ...gitEnvironmentForCwd(),
      GIT_AUTHOR_NAME: 'Fixture',
      GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
      GIT_COMMITTER_NAME: 'Fixture',
      GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    };
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
    const put = (path: string, content: string) => {
      mkdirSync(dirname(join(cwd, path)), { recursive: true });
      writeFileSync(join(cwd, path), content);
    };
    try {
      git('init', '-q');
      const paths = stage.jobs.detect.steps
        .find((step: any) => step.uses === 'actions/checkout@v4')
        .with['sparse-checkout'].trim()
        .split('\n');
      for (const path of paths) put(path.slice(1), 'admission');
      const witness = 'supabase/migrations/20261103000000_fixture.sql';
      put(witness, 'original witness');
      put('public/unrelated-client-asset.bin', 'not needed');
      git('add', '.');
      git('commit', '-qm', 'original');
      const original = git('rev-parse', 'HEAD');
      put(witness, 'new witness');
      git('add', '.');
      git('commit', '-qm', 'later');
      git('sparse-checkout', 'set', '--no-cone', ...paths);
      for (const path of paths) expect(existsSync(join(cwd, path.slice(1)))).toBe(true);
      expect(existsSync(join(cwd, witness))).toBe(false);
      expect(existsSync(join(cwd, 'public/unrelated-client-asset.bin'))).toBe(false);
      expect(git('show', `${original}:${witness}`)).toBe('original witness');
      expect(git('show', `HEAD:${witness}`)).toBe('new witness');
      expect(git('rev-parse', '--is-shallow-repository')).toBe('false');
      expect(git('rev-list', '--count', 'HEAD')).toBe('2');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('hydrates the self-contained scoped observer without changing its authority', () => {
    const job = workflow('production-integrity-audit.yml').jobs.scoped_runtime_errors;
    const checkout = job.steps.find((step: any) => step.uses === 'actions/checkout@v4');
    expect(job['timeout-minutes']).toBe(2);
    expect(checkout.with.ref).toBe('main');
    expect(checkout.with['persist-credentials']).toBe(false);
    expect(checkout.with['sparse-checkout-cone-mode']).toBe(false);
    expect(checkout.with['sparse-checkout'].trim()).toBe(
      '/scripts/ci/read-scoped-runtime-errors.py'
    );
    expect(job.steps.find((step: any) => step.run)?.run).toBe(
      'python3 scripts/ci/read-scoped-runtime-errors.py'
    );
  });
});

describe('client delivery never inherits the engine activation window', () => {
  it.each([
    ['client behavior', ['src/pages/ClubHomePage.tsx'], false],
    ['client styling', ['src/components/table/Table.css'], false],
    ['client assets', ['public/assets/table.webp'], false],
    ['instructions', ['PUBLISHING.md'], false],
    ['server tests only', ['server/src/maintenance/new.test.ts'], false],
    ['server simulations only', ['server/sim/example.ts'], false],
    ['server implementation', ['server/src/GameServer.ts'], true],
    ['server release control', ['server/scripts/engine-release-transaction.sh'], true],
    ['mixed client and engine', ['src/pages/ClubHomePage.tsx', 'server/src/GameServer.ts'], true],
    [
      'large client diff',
      Array.from({ length: 310 }, (_, i) => `src/fixtures/route-${i}.ts`),
      false,
    ],
  ] as const)('executes the actual staging detector for %s', (_name, paths, expected) => {
    const cwd = mkdtempSync(join(tmpdir(), 'ca-release-routing-'));
    const env = {
      ...gitEnvironmentForCwd(),
      GIT_AUTHOR_NAME: 'Routing fixture',
      GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
      GIT_COMMITTER_NAME: 'Routing fixture',
      GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    };
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
    const put = (path: string, content: string) => {
      mkdirSync(dirname(join(cwd, path)), { recursive: true });
      writeFileSync(join(cwd, path), content);
    };
    try {
      git('init', '-q');
      put('server/src/GameServer.ts', 'baseline');
      git('add', '.');
      git('commit', '-qm', 'baseline');
      const before = git('rev-parse', 'HEAD');
      for (const path of paths) put(path, 'changed');
      git('add', '.');
      git('commit', '-qm', 'candidate');
      const after = git('rev-parse', 'HEAD');
      const output = join(cwd, 'github-output');
      const detector = stage.jobs.detect.steps.find(
        (step: { id?: string }) => step.id === 'change'
      );
      execFileSync('bash', ['-c', detector.run], {
        cwd,
        env: {
          ...env,
          BEFORE_SHA: before,
          AFTER_SHA: after,
          EVENT_NAME: 'push',
          GITHUB_OUTPUT: output,
        },
        timeout: 10000,
        stdio: 'pipe',
      });
      expect(readFileSync(output, 'utf8')).toContain(`release_required=${expected}\n`);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('routes ordinary client changes away from server and native fixture checks', () => {
    for (const path of [
      'src/pages/ClubHomePage.tsx',
      'src/components/table/Table.css',
      'public/logo.png',
    ]) {
      expect(classifyChangedPaths([path])).toMatchObject({
        server: false,
        phase4: false,
        fixture: false,
      });
    }
    // Financial client changes can require database/server tests without an engine deployment.
    expect(classifyChangedPaths(['src/services/DiamondGamesService.ts']).server).toBe(true);
  });

  it('keeps client publication independent of engine cutover with exact-target scheduling', () => {
    expect(publisher.on.push.branches).toEqual(['main']);
    expect(publisher.on).not.toHaveProperty('schedule');
    expect(publisher.on).not.toHaveProperty('workflow_run');
    const preparation = workflow('publish-club-arena-client.yml');
    expect(publisher.jobs['client-publication'].needs).toBe('publish-needed');
    expect(preparation.jobs.production.needs).toEqual([
      'admit',
      'client-tests',
      'build-and-store',
      'publication-floor',
    ]);
    const executable = [
      ...Object.values(publisher.jobs),
      ...Object.values(preparation.jobs),
      ...Object.values(transaction.jobs),
    ]
      .flatMap((job: any) => job.steps ?? [])
      .map((step: any) => step.run ?? '')
      .join('\n');
    expect(executable).not.toMatch(
      /maintenance_certificate|readyForRestart|engine-release-transaction|deploy-club-arena-engine|\bdate\s+(?:-[a-zA-Z]+\s+)*['"]?\+%M(?:['"\s;)]|$)/
    );
    expect(preparation.jobs.production.concurrency.group).not.toBe(
      workflow('auto-deploy-hetzner.yml').concurrency.group
    );
  });
});
