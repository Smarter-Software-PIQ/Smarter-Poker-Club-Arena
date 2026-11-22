/**
 * LAW: THE FAST NON-ENGINE LOCAL PRE-PUSH SELECTOR FAILS CLOSED AND NEVER WEAKENS REQUIRED GATES.
 *
 * Wave 2 Enhancement 2.3 cuts local pre-push time for strictly isolated non-runtime diffs
 * (non-SQL scripts/ops/**, non-PG/E2E tests/unit/**, non-policy docs/**, and strictly
 * benchmark-only server/src/benchmark/** + server/src/scripts/horseLeagueCard.ts) without
 * skipping any static repo guard, server tsc, law-registry, or exact changed/companion test.
 *
 * Any mixed diff touching even a single runtime engine, lightning, services, tournament,
 * client src/**, migration, workflow, release, or policy file MUST fail closed to the exact
 * unchanged full local pre-push suite. GitHub CI is untouched and always runs 100% of
 * required checks.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { sliceBetween } from './helpers/sourceWindow';

// Spawns isolated bash + node subprocesses per case; give headroom under shared-host I/O load.
vi.setConfig({ testTimeout: 120_000 });

const ROOT = resolve(__dirname, '..');
const HOOK = readFileSync(join(ROOT, '.husky/pre-push'), 'utf8');
const HELPER = readFileSync(join(ROOT, 'scripts/agent-push.sh'), 'utf8');

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Execute the real scope-selector + client preflight + server tsc + server gate sections
 * sliced straight from `.husky/pre-push` inside an isolated sandbox with recording runners.
 */
function runHookStages({
  files,
  treeFiles = {},
  clientVitestExit = 0,
  serverTscExit = 0,
  serverVitestExit = 0,
}: {
  files: string[];
  treeFiles?: Record<string, string>;
  clientVitestExit?: number;
  serverTscExit?: number;
  serverVitestExit?: number;
}) {
  const start = HOOK.indexOf('\nCA_HEAVY_PATHS=');
  expect(start, 'CA_HEAVY_PATHS marker missing in .husky/pre-push').toBeGreaterThan(0);
  const stageScript = HOOK.slice(start);

  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ca-fast-prepush-law-')));
  tempDirs.push(dir);

  // Copy real selector + inventory helpers so the actual production code runs.
  for (const supportFile of [
    'scripts/ci/prepush-fast-selector.mjs',
    'scripts/ci/classify-ci-changes.mjs',
    'scripts/ci/source-contract-inventory.mjs',
    'scripts/ci/source-contract-inputs.json',
    'scripts/ci/vendor/agentExecution.mjs',
  ]) {
    const dest = join(dir, supportFile);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, readFileSync(join(ROOT, supportFile)));
  }

  // Minimal package.json + law-registry fixture + any caller-supplied files.
  const allFiles: Record<string, string> = {
    'package.json': '{}',
    'server/package.json': '{}',
    'tests/law-registry.law.test.ts': '// law registry fixture\n',
    'tests/unit/noFixedSizeSourceWindows.test.ts': '// source window census fixture\n',
    ...Object.fromEntries(files.map((f) => [f, '// changed file\n'])),
    ...treeFiles,
  };
  for (const [rel, body] of Object.entries(allFiles)) {
    const dest = join(dir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, body);
  }

  const trace = join(dir, 'trace.log');
  const writeRecorder = (relBin: string, label: string, exitCode: number) => {
    const bin = join(dir, relBin);
    mkdirSync(dirname(bin), { recursive: true });
    writeFileSync(
      bin,
      `#!/bin/bash\nprintf "%s %s\\n" "${label}" "$*" >> "${trace}"\nexit ${exitCode}\n`
    );
    chmodSync(bin, 0o755);
  };
  writeRecorder('node_modules/.bin/vitest', 'CLIENT_VITEST', clientVitestExit);
  writeRecorder('server/node_modules/.bin/tsc', 'SERVER_TSC', serverTscExit);
  writeRecorder('server/node_modules/.bin/vitest', 'SERVER_VITEST', serverVitestExit);

  // Stub heavy-queue lib to prove whether ca_heavy_slot was acquired or skipped.
  const hqLib = join(dir, 'scripts/lib/heavy-queue.sh');
  mkdirSync(dirname(hqLib), { recursive: true });
  writeFileSync(
    hqLib,
    `hq_acquire() { printf "HEAVY_QUEUE_ACQUIRED %s\\n" "$*" >> "${trace}"; return 0; }\nhq_release() { return 0; }\n`
  );

  const result = spawnSync('bash', ['-c', `set -e\nFAIL=0\n${stageScript}`], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      PATH: process.env.PATH || '/usr/bin:/bin',
      CA_TREE_TOP: dir,
      CA_HEAVY_QUEUE_DIR: join(dir, 'fake-hq'),
      FILES: files.join('\n'),
      CLIENT_DEPENDENCY_MODE: 'local',
      SERVER_DEPENDENCY_MODE: 'local',
    },
  });

  expect(result.error).toBeUndefined();
  const calls = existsSync(trace)
    ? readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean)
    : [];
  return {
    status: result.status,
    output: result.stdout + result.stderr,
    calls,
  };
}

describe('LAW: fast non-engine local pre-push selector is strictly fail-closed', () => {
  it('runs ALL static repo guards before the fast non-engine selector can activate', () => {
    const fastAt = HOOK.indexOf('CA_FAST_NONENGINE_PREPUSH=no');
    expect(fastAt).toBeGreaterThan(0);
    for (const guard of [
      'docs/agent-policy/agent-policy.mjs" check',
      'scripts/ci/check-explicit-table-access.mjs',
      'scripts/ci/verify-source-bindings.py',
      'scripts/ci/check-migrations-applied.mjs',
      'scripts/ci/check-required-columns.mjs',
      'scripts/ci/check-definer-authorization.mjs',
      'scripts/ci/check-unqualified-writes.mjs',
      'scripts/ci/check-no-orphaned-work.mjs',
      'scripts/ci/check-ui-text.mjs',
      'scripts/ci/check-doctrine-freshness.mjs',
      'copy_case_guard scripts/ci/check-title-case.mjs',
    ]) {
      const idx = HOOK.indexOf(guard);
      expect(idx, `${guard} must remain in .husky/pre-push`).toBeGreaterThan(-1);
      expect(idx, `${guard} must run before fast non-engine selector`).toBeLessThan(fastAt);
    }
  });

  it('strictly isolated ops + unit-test + docs diff selects fast path, skips heavy queue, and runs law-registry + changed tests', () => {
    const r = runHookStages({
      files: [
        'scripts/ops/horse-switch-cli.mjs',
        'tests/unit/horseSwitchCli.test.ts',
        'docs/laws.d/some-ops-law.md',
      ],
      treeFiles: {
        'tests/unit/unrelated.test.ts': '// unrelated\n',
        'tests/unit/directReader.test.ts': '// references scripts/ops/horse-switch-cli.mjs\n',
      },
    });
    expect(r.status, r.output).toBe(0);
    expect(r.output).toContain('fast non-engine exact-candidate mode');
    expect(r.output).toContain('GitHub CI still runs 100% of required checks');
    expect(r.calls.some((c) => c.startsWith('HEAVY_QUEUE_ACQUIRED'))).toBe(false);
    expect(r.calls.some((c) => c.startsWith('SERVER_'))).toBe(false);
    const clientRun = r.calls.find((c) => c.startsWith('CLIENT_VITEST run '));
    expect(clientRun).toBeDefined();
    expect(clientRun).toContain('tests/unit/horseSwitchCli.test.ts');
    expect(clientRun).toContain('tests/unit/directReader.test.ts');
    expect(clientRun).toContain('tests/law-registry.law.test.ts');
    expect(clientRun).toContain('tests/unit/noFixedSizeSourceWindows.test.ts');
    expect(clientRun).not.toContain('tests/unit/unrelated.test.ts');
    expect(r.calls.some((c) => c.startsWith('CLIENT_VITEST related'))).toBe(false);
  });

  it('strictly isolated benchmark-only diff runs server tsc + law-registry + exact companion server tests and skips full server vitest related crawl', () => {
    const r = runHookStages({
      files: ['server/src/benchmark/CardScore.ts', 'server/src/scripts/horseLeagueCard.ts'],
      treeFiles: {
        'server/src/benchmark/CardScore.test.ts': '// companion test\n',
        'server/src/benchmark/HorseLeagueCard.test.ts': '// league card test\n',
        'server/src/engine/UnrelatedHeavy.test.ts': "// mentions 'CardScore.ts'\n",
      },
    });
    expect(r.status, r.output).toBe(0);
    expect(r.output).toContain('fast non-engine exact-candidate mode (categories: benchmark)');
    expect(r.output).toContain('skipping full server vitest related crawl');
    expect(r.calls.some((c) => c.startsWith('HEAVY_QUEUE_ACQUIRED'))).toBe(false);
    expect(r.calls).toContain('SERVER_TSC --noEmit');
    expect(r.calls).toContain('CLIENT_VITEST run tests/law-registry.law.test.ts');
    expect(r.calls).toContain(
      'SERVER_VITEST run src/benchmark/CardScore.test.ts src/benchmark/HorseLeagueCard.test.ts'
    );
    expect(r.calls.some((c) => c.startsWith('SERVER_VITEST related'))).toBe(false);
    expect(r.calls.some((c) => c.includes('UnrelatedHeavy.test.ts'))).toBe(false);
  });

  it('still blocks fast benchmark push when server tsc, law-registry, or exact companion test fails', () => {
    const tscFail = runHookStages({
      files: ['server/src/benchmark/CardScore.ts'],
      treeFiles: { 'server/src/benchmark/CardScore.test.ts': '// companion\n' },
      serverTscExit: 1,
    });
    expect(tscFail.status).toBe(1);
    expect(tscFail.output).toContain('BLOCKED: the server does not type-check.');

    const testFail = runHookStages({
      files: ['server/src/benchmark/CardScore.ts'],
      treeFiles: { 'server/src/benchmark/CardScore.test.ts': '// companion\n' },
      serverVitestExit: 1,
    });
    expect(testFail.status).toBe(1);
    expect(testFail.output).toContain('BLOCKED: a server test you changed is failing.');

    const lawFail = runHookStages({
      files: ['scripts/ops/horse-switch-cli.mjs'],
      clientVitestExit: 1,
    });
    expect(lawFail.status).toBe(1);
    expect(lawFail.output).toContain('BLOCKED: an applicable local test failed.');
  });

  it.each([
    'server/src/engine/HorseLogic.ts',
    'server/src/lightning/LightningManager.ts',
    'server/src/services/supabase/handHistory.ts',
    'server/src/tournament/TournamentEngine.ts',
    'server/src/index.ts',
    'src/App.tsx',
    'supabase/migrations/20261121000000_example.sql',
    '.github/workflows/ci.yml',
    'server/release/plan.json',
    'scripts/release/cutover.sh',
    'scripts/ci/prepush-fast-selector.mjs',
    'package.json',
  ])(
    'mixed diff with %s ALWAYS fails closed to the full unchanged pre-push suite',
    (runtimeFile) => {
      const r = runHookStages({
        files: ['server/src/benchmark/CardScore.ts', runtimeFile],
        treeFiles: {
          'server/src/benchmark/CardScore.test.ts': '// companion\n',
        },
      });
      expect(r.status, r.output).toBe(0);
      expect(r.output).not.toContain('fast non-engine exact-candidate mode');
      expect(r.calls.some((c) => c.startsWith('HEAVY_QUEUE_ACQUIRED'))).toBe(true);
      expect(r.calls).toContain('SERVER_TSC --noEmit');
      // Full unchanged server `vitest related` runs for mixed diffs!
      expect(r.calls.some((c) => c.startsWith('SERVER_VITEST related --run'))).toBe(true);
    }
  );

  it('agent-push.sh heavy_local_stage skips the heavy queue for isolated benchmark diffs and fails closed for mixed diffs', () => {
    const block = sliceBetween(
      HELPER,
      'CA_HEAVY_PATHS=',
      'if [ "$(uname -s)" = Darwin ] && ! heavy_local_stage; then'
    );
    expect(block).toContain('prepush-fast-selector.mjs');

    const runHelperCheck = (changedFiles: string[]) => {
      const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ca-helper-heavy-')));
      tempDirs.push(dir);
      const binDir = join(dir, 'bin');
      mkdirSync(binDir, { recursive: true });
      writeFileSync(
        join(binDir, 'git'),
        `#!/bin/bash
if [ "$1" = merge-base ]; then echo "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"; exit 0; fi
if [ "$1" = diff ]; then printf '%s' "$FAKE_DIFF"; exit 0; fi
exit 1
`,
        { mode: 0o755 }
      );
      const res = spawnSync(
        'bash',
        [
          '-c',
          `REMOTE=origin\nSCRIPT_DIR="${join(ROOT, 'scripts')}"\n${block}\nif heavy_local_stage; then echo HEAVY=yes; else echo HEAVY=no; fi`,
        ],
        {
          encoding: 'utf8',
          env: {
            PATH: `${binDir}:${process.env.PATH || '/usr/bin:/bin'}`,
            FAKE_DIFF: changedFiles.map((f) => `${f}\n`).join(''),
          },
        }
      );
      expect(res.status, res.stderr).toBe(0);
      return res.stdout.trim();
    };

    expect(runHelperCheck(['server/src/benchmark/HorseLeagueCard.ts'])).toBe('HEAVY=no');
    expect(runHelperCheck(['scripts/ops/horse-fleet-status.mjs', 'docs/laws.d/x.md'])).toBe(
      'HEAVY=no'
    );
    expect(
      runHelperCheck(['server/src/benchmark/HorseLeagueCard.ts', 'server/src/engine/HorseLogic.ts'])
    ).toBe('HEAVY=yes');
    expect(runHelperCheck(['supabase/migrations/20261121000000_x.sql'])).toBe('HEAVY=yes');
    expect(runHelperCheck(['package-lock.json'])).toBe('HEAVY=yes');
  });
});
