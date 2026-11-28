import { describe, expect, it, vi } from 'vitest';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyChangedPaths } from '../../scripts/ci/classify-ci-changes.mjs';
import {
  engineRelatedVerdict,
  relatedServerTests,
} from '../../scripts/ci/prepush-engine-related-count.mjs';

// LAW: a widely imported engine file is crawled once, by the required hosted
// Server Engine check, and the local pre-push gate may leave that crawl to it
// ONLY while the hosted check provably runs everything the crawl would.
//
// 2026-11-22: two pushes that changed server/src/engine/HorseLogic.ts held the
// machine's one push lock for 49 and 54 minutes of a 60 minute cap. 41 minutes
// of each was `vitest related --run` selecting 1,503 server test files that the
// four hosted Server Engine shards then ran again on the same commit.
//
// The guarantee has three legs, and each is pinned here:
//   1. the hosted shards run the WHOLE server project (not a selection),
//   2. they are admitted for any changed path under server/, and feed the
//      required `Server Engine (typecheck + tests)` aggregate, which fails
//      closed on an unexpected skip,
//   3. the hook hands the crawl over only on HOSTED_SERVER=yes plus a numeric
//      count above the limit, after the changed tests, the source-contract laws
//      and the server compiler have run locally; anything else runs the crawl.
vi.setConfig({ testTimeout: 120_000 });

const hook = readFileSync('.husky/pre-push', 'utf8');
const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
const SCRIPT = 'scripts/ci/prepush-engine-related-count.mjs';
const MARK = '# A WIDELY IMPORTED ENGINE FILE IS READ BY THE HOSTED ENGINE CHECK';
const LIMIT = Number(/CA_LOCAL_ENGINE_RELATED_LIMIT=(\d+)/.exec(hook)?.[1]);

function job(name: string) {
  const start = ci.search(new RegExp(`^  ${name}:\\s*$`, 'm'));
  expect(start, `ci.yml has no ${name} job`).toBeGreaterThan(0);
  const rest = ci.slice(start + 1);
  const next = rest.search(/^ {2}[A-Za-z0-9_-]+:\s*$/m);
  return next < 0 ? rest : rest.slice(0, next);
}

// The real decision block of the hook, run inside a throwaway tree.
function decide(tree: string, files: string, srvSrc: string) {
  const start = hook.indexOf(MARK);
  const end = hook.indexOf('\nfi\n\nif [ "$FAIL" -ne 0 ]');
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const script = [
    'FAIL=0; CA_TREE_TOP=$PWD; SERVER_DEPENDENCY_MODE=local; SRV_TESTS=""; SRV_CONTRACTS=""',
    `FILES="${files}"; SRV_SRC="${srvSrc}"; SERVER_VITEST="$PWD/server/vitest-stub.sh"`,
    'if true; then',
    hook.slice(start, end),
    'echo "FAIL=$FAIL"',
  ].join('\n');
  const run = spawnSync('bash', ['-c', script], { cwd: tree, encoding: 'utf8' });
  expect(run.status, run.stderr).toBe(0);
  return run.stdout;
}

function tree(options: { readers: number; classifier: string; withScript?: boolean }) {
  const root = mkdtempSync(join(tmpdir(), 'engine-crawl-'));
  mkdirSync(join(root, 'scripts/ci'), { recursive: true });
  mkdirSync(join(root, 'server/src/engine'), { recursive: true });
  if (options.withScript !== false) copyFileSync(SCRIPT, join(root, SCRIPT));
  writeFileSync(join(root, 'scripts/ci/classify-ci-changes.mjs'), options.classifier);
  writeFileSync(join(root, 'server/src/engine/Hub.ts'), 'export const hub = 1;\n');
  writeFileSync(
    join(root, 'server/src/engine/Spoke.ts'),
    "import { hub } from './Hub.js';\nexport const spoke = hub;\n"
  );
  for (let i = 0; i < options.readers; i += 1) {
    writeFileSync(
      join(root, `server/src/engine/reader${i}.test.ts`),
      "import { spoke } from './Spoke.js';\nvoid spoke;\n"
    );
  }
  const stub = join(root, 'server/vitest-stub.sh');
  writeFileSync(stub, '#!/bin/bash\necho "RELATED_RAN $*"\n');
  chmodSync(stub, 0o755);
  return root;
}

const ADMITS = 'export function classifyChangedPaths() { return { server: true }; }\n';
const REFUSES = 'export function classifyChangedPaths() { return { server: false }; }\n';
const THROWS = 'export function classifyChangedPaths() { throw new Error("unreadable"); }\n';
const HUB = 'server/src/engine/Hub.ts';

describe('a wide engine change is crawled by the hosted engine check', () => {
  it('the hosted shards run the whole server project and nothing narrower', () => {
    const shards = job('server_shards');
    expect(shards).toContain('shard: [1, 2, 3, 4, 5, 6, 7, 8]');
    expect(shards).toContain('working-directory: server');
    expect(shards).toContain(
      'npm test -- --exclude src/engine/RetainedHistoricalCheckpointQualification.test.ts --shard="$SERVER_TEST_SHARD/8"'
    );
    // The one excluded file runs by name on shard 1, so no file is left out.
    expect(shards).toContain(
      'run: npm test -- src/engine/RetainedHistoricalCheckpointQualification.test.ts'
    );
    const server = JSON.parse(readFileSync('server/package.json', 'utf8'));
    expect(server.scripts.test).toBe('vitest run');
    const config = readFileSync('server/vitest.config.ts', 'utf8');
    expect(config).toContain(
      "include: ['src/**/*.test.ts', 'src/testing/horseRegression/**/*.test.mjs']"
    );
    expect(config).not.toMatch(/\bexclude\s*:/);
  });

  it('the shards are admitted for a server path and feed a required aggregate that fails closed', () => {
    const shards = job('server_shards');
    expect(shards).toContain("needs.changes.result != 'success' ||");
    expect(shards).toContain("needs.changes.outputs.server == 'true'");
    for (const path of [
      'server/src/engine/HorseLogic.ts',
      'server/src/engine/HorseOptionSwitch.ts',
      'server/src/services/anything/new.ts',
    ]) {
      expect(classifyChangedPaths([path]).server, path).toBe(true);
    }
    const aggregate = job('server');
    expect(aggregate).toContain('name: Server Engine (typecheck + tests)');
    expect(aggregate).toMatch(/needs: \[changes, server_shards, /);
    expect(aggregate).toContain('if: always()');
    expect(aggregate).toContain('Required $suite checks were unexpectedly skipped.');
    expect(readFileSync('scripts/ci/apply-main-ruleset.mjs', 'utf8')).toContain(
      'Server Engine (typecheck + tests)'
    );
  });

  it('the hook hands the crawl over only after its other server stages, and only on all three conditions', () => {
    const at = hook.indexOf(MARK);
    expect(at).toBeGreaterThan(0);
    expect(hook.indexOf(MARK, at + 1)).toBe(-1);
    for (const earlier of [
      'running the server test files you changed...',
      'running the source-contract laws your server changes touch...',
      'BLOCKED: the server does not type-check.',
    ]) {
      const i = hook.indexOf(earlier);
      expect(i, earlier).toBeGreaterThan(0);
      expect(i, earlier).toBeLessThan(at);
    }
    expect(Number.isInteger(LIMIT) && LIMIT >= 100).toBe(true);
    const block = hook.slice(at);
    expect(block).toContain("grep -qx 'HOSTED_SERVER=yes'");
    expect(block).toContain("grep -qE '^[0-9]+$'");
    expect(block).toContain('[ "$CA_ENGINE_RELATED_COUNT" -gt "$CA_LOCAL_ENGINE_RELATED_LIMIT" ]');
    expect(block).toContain('"$SERVER_VITEST" related --run $SRV_SRC');
  });

  it('counts the tests that reach a file through imports, and not through erased type imports', () => {
    const root = tree({ readers: 3, classifier: ADMITS });
    try {
      writeFileSync(
        join(root, 'server/src/engine/typeOnly.test.ts'),
        "import type { hub } from './Hub.js';\nexport type T = typeof hub;\n"
      );
      writeFileSync(
        join(root, 'server/src/engine/dynamic.test.ts'),
        "const m = await import('./Hub.js');\nvoid m;\n"
      );
      expect(relatedServerTests(join(root, 'server'), ['src/engine/Hub.ts'])).toEqual([
        'src/engine/dynamic.test.ts',
        'src/engine/reader0.test.ts',
        'src/engine/reader1.test.ts',
        'src/engine/reader2.test.ts',
      ]);
      expect(relatedServerTests(join(root, 'server'), ['src/engine/Missing.ts'])).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('the real HorseLogic.ts is a widely read input the hosted classifier admits', async () => {
    const verdict = await engineRelatedVerdict('.', ['server/src/engine/HorseLogic.ts']);
    expect(verdict.hostedServer).toBe(true);
    expect(verdict.count).toBeGreaterThan(LIMIT);
  });

  it('a wide change the hosted check is admitted for leaves the crawl to it', () => {
    const root = tree({ readers: LIMIT + 1, classifier: ADMITS });
    try {
      const out = decide(root, HUB, 'src/engine/Hub.ts');
      expect(out).toContain(`${LIMIT + 1} server tests reach your engine change (limit ${LIMIT})`);
      expect(out).toContain('required hosted Server Engine shards');
      expect(out).not.toContain('RELATED_RAN');
      expect(out).toContain('FAIL=0');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('a change at the limit or below keeps the local crawl', () => {
    const root = tree({ readers: LIMIT, classifier: ADMITS });
    try {
      const out = decide(root, HUB, 'src/engine/Hub.ts');
      expect(out).toContain('RELATED_RAN related --run src/engine/Hub.ts');
      expect(out).not.toContain('left to the required hosted');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed to the local crawl when hosted would not run it, or nothing can be proven', () => {
    for (const options of [
      { readers: LIMIT + 1, classifier: REFUSES },
      { readers: LIMIT + 1, classifier: THROWS },
      { readers: LIMIT + 1, classifier: ADMITS, withScript: false },
    ]) {
      const root = tree(options);
      try {
        const out = decide(root, HUB, 'src/engine/Hub.ts');
        expect(out).toContain('RELATED_RAN related --run src/engine/Hub.ts');
        expect(out).not.toContain('left to the required hosted');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });
});
