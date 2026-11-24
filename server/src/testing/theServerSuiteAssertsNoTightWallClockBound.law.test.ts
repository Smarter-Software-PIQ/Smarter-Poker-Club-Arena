// ---------------------------------------------------------------------------
// LAW: a server test does not hold a tight upper bound on real elapsed time.
//
// Registry: docs/laws.d/server-src-testing-theServerSuiteAssertsNoTightWallClockBound.md
//
// 2026-11-24. "Server Engine shard 4/4" failed on PR #11910 (run 45375939160):
//
//   src/engine/HoldemHotpathLatencyBitIdentical.law.test.ts
//   AssertionError: expected 29.081768999999895 to be less than 25
//
// and passed on a rerun of the same commit. The timed work takes about 1.6 ms;
// the runner was busy. The server shards are required checks, and the engine
// prequalification runs them on the exact commit of every release candidate,
// so a bound like that one decides merges and three-hour release cycles by how
// loaded a shared machine was. waitBudget.ts records the same suite running
// pure arithmetic for 3,045 ms on an oversubscribed runner.
//
// THE RULE. In server/src, an assertion that holds an upper bound on a value
// measured with the real clock must be one of:
//
//   - under a fake or stubbed clock (no real time is measured);
//   - relative: the bound is itself measured in the same test, or the value is
//     the `ratio` of measureRelativeCost (src/testing/relativeCost.ts);
//   - at least TIGHT_BOUND_MS: a ceiling that only stops a hang;
//   - named in KNOWN below, with the reason it is there.
//
// KNOWN is closed: an entry that no longer matches an assertion fails this
// law, so the list only shrinks. Do not add an entry for a new timing test;
// write it with measureRelativeCost. Raising a number until it stops failing
// is not a repair either: the bound stays absolute and the next busy runner
// finds it.
//
// What the survey reads, and what it cannot, is in wallClockBoundSurvey.ts.
// ---------------------------------------------------------------------------
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { surveyWallClockBounds } from './wallClockBoundSurvey.js';
import { measureRelativeCost } from './relativeCost.js';

const SRC = join(__dirname, '..');

/** Below this many milliseconds an absolute bound on real time is a measurement of the runner. */
const TIGHT_BOUND_MS = 1_000;

interface Known {
  /** Path under server/src. */
  file: string;
  /** `<subject> < <bound>` exactly as the survey reports it. */
  assertion: string;
  /**
   * hang: the bound only tells "returned" from "never returned"; its real size is seconds.
   * debt: a tight absolute bound of the kind this law exists to end, not yet converted.
   */
  kind: 'hang' | 'debt';
  reason: string;
}

const NO_REFERENCE =
  'tight absolute bound; the test has no reference computation to divide by, and the file belongs to ' +
  'another lane. Convert with measureRelativeCost against a reference chosen by that lane.';

const KNOWN: readonly Known[] = [
  {
    file: 'engine/HorseHoldemEliteOverhaul.test.ts',
    assertion: 'elapsedMs < limit.allowedMs',
    kind: 'hang',
    reason: 'a 12 s ceiling on a 50,000-hand benchmark, scaled by load outside hosted CI',
  },
  {
    file: 'transport/aSilentPeerCannotHoldShutdown.law.test.ts',
    assertion: 'elapsed < SHUTDOWN_CLOSE_GRACE_MS + 2_000',
    kind: 'hang',
    reason: 'a 5 s ceiling: the 3 s close grace plus 2 s, against a peer that never answers',
  },
  {
    file: 'services/engineLifecycleLog.test.ts',
    assertion: 'elapsed < 500',
    kind: 'hang',
    reason: 'a flush with a 50 ms timeout against a sink that never resolves: ten times the timer',
  },
  {
    file: 'services/supabase/horseDealtHoleCards.test.ts',
    assertion: 'us < 500',
    kind: 'hang',
    reason: 'microseconds, a mean over 20,000 calls: the asserted total is 10 s',
  },
  {
    file: 'engine/HorseLogic.test.ts',
    assertion: 'avgMs < PERF_BUDGET_MS',
    kind: 'debt',
    reason: `25 ms per decision, fastest of three averaged rounds; ${NO_REFERENCE}`,
  },
  {
    file: 'engine/HorseLogic.test.ts',
    assertion: 'avg < PERF_BUDGET_MS',
    kind: 'debt',
    reason: `25 ms per decision, fastest of three averaged rounds; ${NO_REFERENCE}`,
  },
  {
    file: 'engine/HorseOmahaPreflopHudPriced.law.test.ts',
    assertion: 'p50 < 25',
    kind: 'debt',
    reason: `median of 20 single calls; ${NO_REFERENCE}`,
  },
  {
    file: 'engine/HorseOmahaStreetPlanLayers.test.ts',
    assertion: 'worst < 250',
    kind: 'debt',
    reason: `the slowest of one timed call per spot; ${NO_REFERENCE}`,
  },
  {
    file: 'engine/HorsePhase7TournamentUtility.test.ts',
    assertion: 'samples[Math.floor(samples.length / 2)] < 150',
    kind: 'debt',
    reason: `median of 15 single calls; ${NO_REFERENCE}`,
  },
  {
    file: 'engine/HorseV40Omaha.test.ts',
    assertion: 'perDecision < 60',
    kind: 'debt',
    reason: `one mean over 10 calls; ${NO_REFERENCE}`,
  },
  {
    file: 'engine/IcmModel.test.ts',
    assertion: 'Date.now() - t0 < 200',
    kind: 'debt',
    reason: `one timed call; ${NO_REFERENCE}`,
  },
  {
    file: 'engine/ReconnectStormResync.test.ts',
    assertion: 'elapsedMs < 250',
    kind: 'debt',
    reason: `one timed batch of 60 snapshots; ${NO_REFERENCE}`,
  },
  {
    file: 'engine/omahaMathCore/OmahaMathCoreAcceptance.law.test.ts',
    assertion: 'performance.now() - t0 < 120',
    kind: 'debt',
    reason: `one timed call of a computation with a 15 ms budget; ${NO_REFERENCE}`,
  },
  {
    file: 'engine/omahaMathCore/OmahaMathCorePlaybookBlockers.test.ts',
    assertion: 'ms < 250',
    kind: 'debt',
    reason: `one timed call; ${NO_REFERENCE}`,
  },
  {
    file: 'services/OpponentHudStore.test.ts',
    assertion: 'Date.now() - t0 < 50',
    kind: 'debt',
    reason: `one timed synchronous read; ${NO_REFERENCE}`,
  },
];

function testFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) testFiles(p, out);
    else if (/\.test\.(ts|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

interface Finding {
  file: string;
  line: number;
  assertion: string;
  boundValue: number | null;
}

function tightBounds(): Finding[] {
  const out: Finding[] = [];
  for (const path of testFiles(SRC).sort()) {
    const file = relative(SRC, path).replace(/\\/g, '/');
    // This file quotes the forbidden form in its own fixtures.
    if (file === 'testing/theServerSuiteAssertsNoTightWallClockBound.law.test.ts') continue;
    for (const b of surveyWallClockBounds(readFileSync(path, 'utf8'))) {
      if (b.boundValue !== null && b.boundValue >= TIGHT_BOUND_MS) continue;
      out.push({ file, line: b.line, assertion: b.key, boundValue: b.boundValue });
    }
  }
  return out;
}

const keys = (source: string): string[] => surveyWallClockBounds(source).map((b) => b.key);

describe('a server test does not hold a tight upper bound on real elapsed time', () => {
  // Reads every test file under server/src (about 2,600). The budget only
  // stops a hang on a loaded host; what the law checks does not depend on it.
  it('every tight real-time bound in server/src is in KNOWN, and KNOWN names nothing that is gone', () => {
    const found = tightBounds();
    const known = new Set(KNOWN.map((k) => `${k.file} :: ${k.assertion}`));
    const unlisted = found.filter((f) => !known.has(`${f.file} :: ${f.assertion}`));
    expect(
      unlisted.map((f) => `server/src/${f.file}:${f.line}  expect(${f.assertion})`),
      'These assertions hold an absolute upper bound under ' +
        `${TIGHT_BOUND_MS} ms on time read from the real clock. A busy runner fails them with ` +
        'nothing wrong in the code, on checks that gate every merge and every release candidate. ' +
        'Measure the work against a reference in the same process and assert the quotient: ' +
        'measureRelativeCost in server/src/testing/relativeCost.ts. Do not raise the number and ' +
        'do not add a KNOWN entry.'
    ).toEqual([]);
    const present = new Set(found.map((f) => `${f.file} :: ${f.assertion}`));
    const stale = KNOWN.filter((k) => !present.has(`${k.file} :: ${k.assertion}`));
    expect(
      stale.map((k) => `${k.file} :: ${k.assertion}`),
      'These KNOWN entries match no assertion any more. If the test was converted or removed, ' +
        'delete its entry in the same commit; the list only shrinks.'
    ).toEqual([]);
  }, 300_000);

  it('every KNOWN entry says why it is there, once', () => {
    const seen = new Set<string>();
    for (const k of KNOWN) {
      const key = `${k.file} :: ${k.assertion}`;
      expect(seen.has(key), `${key} is listed twice`).toBe(false);
      seen.add(key);
      expect(k.reason.length, `${key} needs a reason`).toBeGreaterThan(20);
    }
  });

  it('the hot-path law that failed on a busy runner is in the relative form', () => {
    const src = readFileSync(
      join(SRC, 'engine', 'HoldemHotpathLatencyBitIdentical.law.test.ts'),
      'utf8'
    );
    expect(keys(src)).toEqual([]);
    expect(src).toContain('measureRelativeCost(');
    expect(src).toMatch(/expect\(\s*cost\.ratio\b/);
  });

  describe('the survey', () => {
    it('reports the form that failed: a real clock, a subtraction, a number of milliseconds', () => {
      expect(
        keys(`
          it('x', () => {
            const t0 = performance.now();
            work();
            const elapsedMs = performance.now() - t0;
            expect(elapsedMs).toBeLessThan(25);
          });`)
      ).toEqual(['elapsedMs < 25']);
      expect(
        keys(
          `it('x', () => { const t0 = Date.now(); work(); expect(Date.now() - t0).toBeLessThan(200); });`
        )
      ).toEqual(['Date.now() - t0 < 200']);
      expect(
        keys(
          `it('x', () => { const t0 = Date.now(); work(); expect(Date.now() - t0 < 200).toBe(true); });`
        )
      ).toEqual(['Date.now() - t0 < 200']);
    });

    it('follows the value through a derived name, a timing function, an assignment and a push', () => {
      expect(
        keys(`
          it('x', () => {
            const round = (): number => {
              const start = performance.now();
              work();
              return (performance.now() - start) / 30;
            };
            const avgMs = Math.min(round(), round(), round());
            expect(avgMs).toBeLessThan(BUDGET);
          });`)
      ).toEqual(['avgMs < BUDGET']);
      expect(
        keys(`
          it('x', () => {
            const times: number[] = [];
            for (let i = 0; i < 20; i++) {
              const t0 = performance.now();
              work();
              times.push(performance.now() - t0);
            }
            const p50 = times[10];
            expect(p50).toBeLessThan(25);
          });`)
      ).toEqual(['p50 < 25']);
      expect(
        keys(`
          it('x', () => {
            let worst = 0;
            const t0 = performance.now();
            work();
            worst = Math.max(worst, performance.now() - t0);
            expect(worst, 'too slow').toBeLessThanOrEqual(250);
          });`)
      ).toEqual(['worst < 250']);
    });

    it('resolves a numeric constant of the same file, and leaves anything else unresolved', () => {
      const [a] = surveyWallClockBounds(`
        const CEILING = 5_000;
        it('x', () => { const t0 = Date.now(); work(); expect(Date.now() - t0).toBeLessThan(CEILING); });`);
      expect(a.boundValue).toBe(5000);
      const [b] = surveyWallClockBounds(
        `it('x', () => { const t0 = Date.now(); work(); expect(Date.now() - t0).toBeLessThan(limit.allowedMs); });`
      );
      expect(b.boundValue).toBeNull();
    });

    it('judges a mean over N runs by the total it is divided from', () => {
      const [total] = surveyWallClockBounds(`
        it('x', () => {
          const t0 = performance.now();
          for (let n = 0; n < 200; n++) work();
          expect((performance.now() - t0) / 200).toBeLessThan(5);
        });`);
      expect(total.boundValue).toBe(1000);
      const [tight] = surveyWallClockBounds(`
        const RUNS = 10;
        it('x', () => {
          const t0 = performance.now();
          for (let n = 0; n < RUNS; n++) work();
          expect((performance.now() - t0) / RUNS).toBeLessThan(5);
        });`);
      expect(tight.boundValue).toBe(50);
    });

    it('does not report a test under a fake or stubbed clock', () => {
      expect(
        keys(`
          beforeEach(() => { vi.useFakeTimers(); });
          it('x', () => { const t0 = Date.now(); work(); expect(Date.now() - t0).toBeLessThan(25); });`)
      ).toEqual([]);
      expect(
        keys(`
          const freezeClock = () => vi.spyOn(performance, 'now').mockReturnValue(0);
          it('frozen', () => {
            freezeClock();
            const t0 = performance.now();
            expect(performance.now() - t0).toBeLessThan(25);
          });`)
      ).toEqual([]);
    });

    it('still reports a real-clock test when another test in the file stubs the clock', () => {
      expect(
        keys(`
          const freezeClock = () => vi.spyOn(performance, 'now').mockReturnValue(0);
          it('frozen', () => { freezeClock(); expect(performance.now() - 0).toBeLessThan(25); });
          it('real', () => {
            const t0 = performance.now();
            work();
            expect(performance.now() - t0).toBeLessThan(120);
          });`)
      ).toEqual(['performance.now() - t0 < 120']);
    });

    it('does not report the relative forms', () => {
      expect(
        keys(`
          it('x', () => {
            const t0 = performance.now();
            ask();
            const first = performance.now() - t0;
            const t1 = performance.now();
            for (let i = 0; i < 5; i++) ask();
            expect((performance.now() - t1) / 5).toBeLessThan(first / 2);
          });`)
      ).toEqual([]);
      expect(
        keys(`
          it('x', () => {
            const cost = measureRelativeCost(() => fast(), () => reference());
            expect(cost.ratio).toBeLessThan(0.1);
          });`)
      ).toEqual([]);
    });

    it('does not report a lower bound, a deadline that is not elapsed time, or a name from another test', () => {
      expect(
        keys(`
          it('waits', async () => {
            const t0 = Date.now();
            await wait(600);
            const elapsed = Date.now() - t0;
            expect(elapsed).toBeGreaterThanOrEqual(550);
          });
          it('unrelated', () => {
            const elapsed = model.elapsed;
            expect(elapsed).toBeLessThan(3);
            expect(result.equity).toBeLessThan(0.5);
          });`)
      ).toEqual([]);
    });
  });

  describe('measureRelativeCost', () => {
    it('keeps the fastest round of each side, so a stall in some rounds does not move the quotient', () => {
      // A scripted clock: the reference costs 40, the subject 2, and every third
      // round a stall of 500 lands on one side or the other.
      let t = 0;
      let round = 0;
      const cost = measureRelativeCost(
        () => {
          t += 2 + (round % 3 === 1 ? 500 : 0);
        },
        () => {
          round++;
          t += 40 + (round % 3 === 2 ? 500 : 0);
        },
        { warmupRounds: 1, rounds: 9, now: () => t }
      );
      expect(cost.subjectMs).toBe(2);
      expect(cost.referenceMs).toBe(40);
      expect(cost.ratio).toBe(0.05);
      expect(cost.rounds).toBe(9);
    });

    it('moves by the size of a regression in the subject', () => {
      let t = 0;
      const at = (subjectCost: number): number =>
        measureRelativeCost(
          () => {
            t += subjectCost;
          },
          () => {
            t += 40;
          },
          { warmupRounds: 1, rounds: 3, now: () => t }
        ).ratio;
      expect(at(30) / at(2)).toBeCloseTo(15, 9);
    });

    it('refuses too few rounds and a reference too small to time', () => {
      expect(() =>
        measureRelativeCost(
          () => 0,
          () => 0,
          { rounds: 2 }
        )
      ).toThrow(/at least 3/);
      expect(() =>
        measureRelativeCost(
          () => 0,
          () => 0,
          { warmupRounds: 0 }
        )
      ).toThrow(/at least 1 warm-up/);
      expect(() =>
        measureRelativeCost(
          () => 0,
          () => 0,
          { now: () => 7 }
        )
      ).toThrow(/clock resolution/);
    });
  });
});
