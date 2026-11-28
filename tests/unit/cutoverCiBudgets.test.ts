/**
 * Unit & contract tests for `scripts/ci/check-cutover-ci-budgets.mjs`
 * (test-file size/split budgets + server/ Docker context hygiene).
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error ESM CI script tested through its public exports.
import {
  countReplayPasses,
  evaluateCutoverCiBudgets,
  parseDockerignore,
  positiveGlobToRegex,
} from '../../scripts/ci/check-cutover-ci-budgets.mjs';

const ROOT = join(__dirname, '../..');

function makeFixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'cutover-ci-budgets-'));
  mkdirSync(join(dir, 'server/src/benchmark'), { recursive: true });
  mkdirSync(join(dir, 'server/src/engine'), { recursive: true });
  writeFileSync(
    join(dir, 'server/.dockerignore'),
    [
      'src/**/*.test.ts',
      'src/**/*.spec.ts',
      'src/**/*.test-support.*',
      'src/testing/**',
      'src/benchmark/fixtures/**',
    ].join('\n') + '\n'
  );
  for (const name of [
    'HoldemPersonaReplayVsMain.test.ts',
    'HoldemPersonaReplayVsMainOptionsFalse.test.ts',
    'HoldemPersonaReplayVsMainReRaiseMixOn.test.ts',
    'HoldemPersonaReplayVsMainPreflopOn.test.ts',
  ]) {
    writeFileSync(join(dir, 'server/src/benchmark', name), `it('pass', () => {});\n`);
  }
  for (const name of [
    'HorseV54RiverBluff.test.ts',
    'HorseV54RiverBluffDeclinedSpots.test.ts',
    'HorseV54RiverBluffGoldenBaseline.test.ts',
  ]) {
    writeFileSync(join(dir, 'server/src/engine', name), `it('v54', () => {});\n`);
  }
  return dir;
}

describe('cutover CI budget guard', () => {
  it('validates positive-glob dockerignore rules and rejects negation/bracket/escape syntax', () => {
    const clean = parseDockerignore('# comment\nsrc/**/*.test.ts\nsrc/testing/**\n');
    expect(clean.syntaxErrors).toEqual([]);
    expect(clean.rules).toEqual(['src/**/*.test.ts', 'src/testing/**']);

    const bad = parseDockerignore('!src/keep.ts\nsrc/[ab].ts\nsrc\\win.ts\n');
    expect(bad.syntaxErrors).toHaveLength(3);

    const re = positiveGlobToRegex('src/**/*.test.ts');
    expect(re.test('src/a.test.ts')).toBe(true);
    expect(re.test('src/engine/deep/b.test.ts')).toBe(true);
    expect(re.test('src/engine/HorseLogic.ts')).toBe(false);

    // Leading and trailing slashes in .dockerignore patterns must normalize cleanly.
    const leadingTrailing = positiveGlobToRegex('/src/testing/');
    expect(leadingTrailing.test('src/testing/helper.ts')).toBe(true);
    expect(leadingTrailing.test('src/testing')).toBe(true);
    expect(leadingTrailing.test('src/other/helper.ts')).toBe(false);

    const leadingGlob = positiveGlobToRegex('/src/**/*.test.ts');
    expect(leadingGlob.test('src/engine/Foo.test.ts')).toBe(true);
  });

  it('counts replay passes accurately, excluding HOLDEM_REPLAY_RECORD', () => {
    expect(
      countReplayPasses(`
        describe('x', () => {
          if (process.env.HOLDEM_REPLAY_RECORD) {
            it('records', () => {});
            return;
          }
          it('absent', () => {});
        });
      `)
    ).toBe(1);
    expect(
      countReplayPasses(`
        for (const [label, extra] of [
          ['false', {}],
          ['preflop false', {}],
        ] as const) {
          it(label, () => {});
        }
      `)
    ).toBe(2);
    expect(
      countReplayPasses(`
        for (const [label, extra] of [
          ['a', {}],
          ['b', {}],
          ['c', {}],
        ] as const) {
          it(label, () => {});
        }
      `)
    ).toBe(3);
    // Nested braces before/inside it(...) in a for-of loop must not prematurely end stripping and double-count it(.
    expect(
      countReplayPasses(`
        for (const [label, extra] of [
          ['false', {}],
          ['preflop false', {}],
        ] as const) {
          const opts = { ...extra, nested: { ok: true } };
          it(label, () => {
            const check = { brace: '}' };
            expect(opts).toBeTruthy();
            expect(check).toBeTruthy();
          });
        }
      `)
    ).toBe(2);
  });

  it('catches Docker context leaks, oversized context, re-monolithed benchmarks, and huge new test files', () => {
    const dir = makeFixtureRepo();
    try {
      expect(evaluateCutoverCiBudgets({ rootDir: dir }).violations).toEqual([]);

      // 1. Oversized new test file (> maxNewServerTestLines)
      writeFileSync(join(dir, 'server/src/engine/GiantNew.test.ts'), 'const x = 1;\n'.repeat(2050));
      expect(
        evaluateCutoverCiBudgets({ rootDir: dir }).violations.some((v: string) =>
          v.includes('GiantNew.test.ts')
        )
      ).toBe(true);
      rmSync(join(dir, 'server/src/engine/GiantNew.test.ts'));

      // 2. Re-monolithed HoldemPersonaReplayVsMain (3 passes in one file)
      writeFileSync(
        join(dir, 'server/src/benchmark/HoldemPersonaReplayVsMain.test.ts'),
        `it('a', () => {});\nit('b', () => {});\nit('c', () => {});\n`
      );
      expect(
        evaluateCutoverCiBudgets({ rootDir: dir }).violations.some((v: string) =>
          v.includes('3 full-hand replay passes')
        )
      ).toBe(true);
      writeFileSync(
        join(dir, 'server/src/benchmark/HoldemPersonaReplayVsMain.test.ts'),
        `it('a', () => {});\n`
      );

      // 3. Docker context total size budget exceeded
      writeFileSync(join(dir, 'server/src/blob.bin'), Buffer.alloc(4096));
      expect(
        evaluateCutoverCiBudgets({ rootDir: dir, maxDockerContextBytes: 2048 }).violations.some(
          (v: string) => v.includes('Docker context total size budget exceeded')
        )
      ).toBe(true);
      rmSync(join(dir, 'server/src/blob.bin'));

      // 4. Docker context leak (a .test.mjs not ignored in fixture .dockerignore)
      writeFileSync(join(dir, 'server/src/engine/Leaked.test.mjs'), 'export {};\n');
      expect(
        evaluateCutoverCiBudgets({ rootDir: dir }).violations.some((v: string) =>
          v.includes('Docker context leak: server/src/engine/Leaked.test.mjs')
        )
      ).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passes cleanly on the real repository tree', () => {
    const { violations, metrics } = evaluateCutoverCiBudgets({ rootDir: ROOT });
    expect(violations).toEqual([]);
    expect(metrics.holdemReplaySplitFiles).toBeGreaterThanOrEqual(4);
    expect(metrics.v54SplitFiles).toBeGreaterThanOrEqual(3);
  });

  it('is wired into .github/workflows/ci.yml parallel invariant guards', () => {
    const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
    const guardsBlock =
      /- name: Invariant guards \(parallel\)[\s\S]*?<<'GUARDS'\n([\s\S]*?)\n\s*GUARDS\n/.exec(ci);
    expect(guardsBlock, 'Invariant guards (parallel) block missing in ci.yml').toBeTruthy();
    expect(guardsBlock![1]).toContain('node scripts/ci/check-cutover-ci-budgets.mjs');
  });
});
