/**
 * LAW: server tests do not introduce unpinned Date.now() or Math.random()
 * (shift-left anti-flake determinism guard, Wave A-1).
 *
 * Unpinned wall-clock reads and unmocked Math.random() calls in server/src
 * tests cause CI / prequalification flakes that depend on runner timing or
 * random draws (#12247-class flakes). `scripts/ci/check-server-test-determinism.mjs`
 * scans every `server/src` test file against a closed ratchet baseline and is
 * wired into `.github/workflows/ci.yml`'s required `Invariant guards (parallel)`
 * step.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error ESM CI script tested through its public exports.
import {
  analyzeTestSource,
  evaluateDeterminism,
  runCheck,
} from '../scripts/ci/check-server-test-determinism.mjs';

const ROOT = join(__dirname, '..');

describe('server test determinism guard', () => {
  it('refuses unpinned Date.now() and Math.random() in new test files', () => {
    const analysis = analyzeTestSource(
      `
      import { describe, it, expect } from 'vitest';
      describe('flaky', () => {
        it('reads wall clock and Math.random without pinning', () => {
          const ts = Date.now();
          const r = Math.random();
          expect(ts).toBeGreaterThan(0);
          expect(r).toBeGreaterThanOrEqual(0);
        });
      });
      `,
      'server/src/engine/NewFlakyTest.test.ts'
    );
    expect(analysis.dateNowLines).toEqual([5]);
    expect(analysis.mathRandomLines).toEqual([6]);

    const violations = evaluateDeterminism([analysis], { files: {} });
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('new_unpinned');
    expect(violations[0].message).toContain('NewFlakyTest.test.ts');
  });

  it('allows Date.now() when the clock is frozen or spied, and Math.random() when spied/mocked', () => {
    const fakeTimers = analyzeTestSource(
      `
      vi.useFakeTimers();
      vi.setSystemTime(Date.UTC(2026, 10, 28, 12, 0, 0));
      const t = Date.now();
      `,
      'server/src/engine/PinnedClock.test.ts'
    );
    expect(fakeTimers.clockPinned).toBe(true);
    expect(fakeTimers.dateNowLines).toEqual([]);

    const spiedDateAndMath = analyzeTestSource(
      `
      vi.spyOn(Date, 'now').mockReturnValue(1770000000000);
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const t = Date.now();
      const r = Math.random();
      `,
      'server/src/engine/SpiedBoth.test.ts'
    );
    expect(spiedDateAndMath.clockPinned).toBe(true);
    expect(spiedDateAndMath.randomPinned).toBe(true);
    expect(spiedDateAndMath.dateNowLines).toEqual([]);
    expect(spiedDateAndMath.mathRandomLines).toEqual([]);
  });

  it('ignores comments and plain prose strings while still catching template interpolations', () => {
    const commentOnly = analyzeTestSource(
      `
      // Date.now() and Math.random() in a comment must not trip the guard
      /* block Date.now() Math.random() */
      const doc = "never call Date.now() or Math.random() here";
      `,
      'server/src/engine/CommentOnly.test.ts'
    );
    expect(commentOnly.dateNowLines).toEqual([]);
    expect(commentOnly.mathRandomLines).toEqual([]);

    const templateInterp = analyzeTestSource(
      'const id = `hand-${Date.now()}`;',
      'server/src/engine/TemplateDate.test.ts'
    );
    expect(templateInterp.dateNowLines).toEqual([1]);

    // Template literal containing // (URL) must NOT blank ${Date.now()}.
    const templateUrl = analyzeTestSource(
      'const url = `https://example.com/${Date.now()}`;',
      'server/src/engine/TemplateUrl.test.ts'
    );
    expect(templateUrl.dateNowLines).toEqual([1]);

    // Template literal containing apostrophes must NOT blank ${Math.random()}.
    const templateQuotes = analyzeTestSource(
      "const msg = `it's ${Math.random()} and it's ok`;",
      'server/src/engine/TemplateQuotes.test.ts'
    );
    expect(templateQuotes.mathRandomLines).toEqual([1]);

    // Nested template literal with // and braces inside ${...}.
    const nestedTemplate = analyzeTestSource(
      'const s = `outer ${`https://x.test/${({ t: Date.now() }).t}`}`;',
      'server/src/engine/NestedTemplate.test.ts'
    );
    expect(nestedTemplate.dateNowLines).toEqual([1]);

    // Static prose inside template literal (no interpolation) must NOT false-positive.
    const templateProse = analyzeTestSource(
      'const err = `Date.now() failed and Math.random() failed`;',
      'server/src/engine/TemplateProse.test.ts'
    );
    expect(templateProse.dateNowLines).toEqual([]);
    expect(templateProse.mathRandomLines).toEqual([]);

    // Regex literal containing // or ' must NOT swallow subsequent calls.
    const afterRegex = analyzeTestSource(
      "const re = /https:\\/\\/example\\.com\\/'/;\nconst t = Date.now();",
      'server/src/engine/AfterRegex.test.ts'
    );
    expect(afterRegex.dateNowLines).toEqual([2]);
  });

  it('honors an explicit documented @determinism-exempt annotation', () => {
    const exempt = analyzeTestSource(
      `
      // @determinism-exempt: stress probe intentionally samples live clock
      const t = Date.now();
      const r = Math.random();
      `,
      'server/src/engine/ExplicitExempt.test.ts'
    );
    expect(exempt.exempt).toBe(true);
    expect(exempt.dateNowLines).toEqual([]);
    expect(exempt.mathRandomLines).toEqual([]);
  });

  it('enforces a strict count ratchet on grandfathered baseline entries (blocks growth and stale entries)', () => {
    const file = 'server/src/engine/Legacy.test.ts';
    const base = { files: { [file]: { dateNow: 1, mathRandom: 0 } } };

    // Exact match passes
    expect(evaluateDeterminism([analyzeTestSource('const a = Date.now();', file)], base)).toEqual(
      []
    );

    // Growing above baseline fails
    const grown = evaluateDeterminism(
      [analyzeTestSource('const a = Date.now();\nconst b = Date.now();', file)],
      base
    );
    expect(grown).toHaveLength(1);
    expect(grown[0].kind).toBe('baseline_exceeded');

    // Fixing without shrinking baseline fails (ratchet)
    const stale = evaluateDeterminism([analyzeTestSource('const a = 42;', file)], base);
    expect(stale).toHaveLength(1);
    expect(stale[0].kind).toBe('stale_baseline');

    // Deleted file left in baseline fails
    const missing = evaluateDeterminism([], base);
    expect(missing).toHaveLength(1);
    expect(missing[0].kind).toBe('missing_baseline_file');
  });

  it('passes cleanly on the real repository tree with zero violations', () => {
    const result = runCheck({ rootDir: ROOT });
    expect(result.scanned).toBeGreaterThan(2000);
    expect(result.violations).toEqual([]);
  });

  it('is wired into .github/workflows/ci.yml parallel invariant guards', () => {
    const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
    const guardsBlock =
      /- name: Invariant guards \(parallel\)[\s\S]*?<<'GUARDS'\n([\s\S]*?)\n\s*GUARDS\n/.exec(ci);
    expect(guardsBlock, 'Invariant guards (parallel) block missing in ci.yml').toBeTruthy();
    expect(guardsBlock![1]).toContain('node scripts/ci/check-server-test-determinism.mjs');
  });
});
