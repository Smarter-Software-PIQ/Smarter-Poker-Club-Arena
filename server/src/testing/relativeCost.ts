// ---------------------------------------------------------------------------
// A COST IS MEASURED AGAINST OTHER WORK ON THE SAME MACHINE, NEVER AGAINST A
// NUMBER OF MILLISECONDS.
//
// WHY THIS FILE EXISTS (2026-11-24, PR #11910, run 45375939160).
//
// "Server Engine shard 4/4" went red on unchanged code:
//
//   FAIL src/engine/HoldemHotpathLatencyBitIdentical.law.test.ts
//   AssertionError: expected 29.081768999999895 to be less than 25
//
// and passed on a rerun. The work it timed takes about 1.6 ms. A hosted runner
// that shares its cores took the thread away for 27 ms in the middle of one
// timed window, and an absolute ceiling cannot tell that from a regression.
// The same shards gate every merge, and the engine prequalification runs them
// on the exact commit of every release candidate, so one stolen time slice
// costs a merge or a three-hour release cycle with nothing wrong in the code.
//
// THE FORM THAT DOES NOT DEPEND ON THE RUNNER. Time the subject and a
// reference that does comparable work, in the same process, in alternating
// rounds, and keep the fastest round of each. A stall can only make a round
// slower, so the minimum of several rounds is the code's own cost; a slow or
// busy machine slows both sides alike, so their quotient stays put. A real
// regression slows every round of the subject and none of the reference, so
// the quotient moves by the size of the regression. Assert the quotient.
//
// theServerSuiteAssertsNoTightWallClockBound.law.test.ts keeps the absolute
// form from coming back.
// ---------------------------------------------------------------------------
import { performance } from 'node:perf_hooks';

export interface RelativeCost {
  /** The fastest timed round of the subject, in milliseconds. */
  subjectMs: number;
  /** The fastest timed round of the reference, in milliseconds. */
  referenceMs: number;
  /** subjectMs / referenceMs: the only figure a test may hold a bound on. */
  ratio: number;
  /** How many timed rounds each side ran. */
  rounds: number;
}

export interface RelativeCostOptions {
  /** Untimed rounds of each side first, so the JIT has compiled both. Default 3. */
  warmupRounds?: number;
  /** Timed, alternating rounds of each side. Default 15. */
  rounds?: number;
  /** The clock, in milliseconds. Injected by this file's own test only. */
  now?: () => number;
}

/**
 * The fastest of `rounds` alternating timed runs of `subject` and of
 * `reference`, after `warmupRounds` untimed runs of each, and their quotient.
 * Both callbacks must do the same work on every call.
 */
export function measureRelativeCost(
  subject: () => unknown,
  reference: () => unknown,
  options: RelativeCostOptions = {}
): RelativeCost {
  const warmupRounds = options.warmupRounds ?? 3;
  const rounds = options.rounds ?? 15;
  const now = options.now ?? (() => performance.now());
  if (!Number.isInteger(rounds) || rounds < 3)
    throw new Error(`measureRelativeCost needs at least 3 timed rounds, got ${rounds}`);
  if (!Number.isInteger(warmupRounds) || warmupRounds < 1)
    throw new Error(`measureRelativeCost needs at least 1 warm-up round, got ${warmupRounds}`);
  for (let i = 0; i < warmupRounds; i++) {
    reference();
    subject();
  }
  let subjectMs = Number.POSITIVE_INFINITY;
  let referenceMs = Number.POSITIVE_INFINITY;
  for (let i = 0; i < rounds; i++) {
    const r0 = now();
    reference();
    const r1 = now();
    subject();
    const r2 = now();
    if (r1 - r0 < referenceMs) referenceMs = r1 - r0;
    if (r2 - r1 < subjectMs) subjectMs = r2 - r1;
  }
  if (!(referenceMs > 0))
    throw new Error(
      'measureRelativeCost: the reference finished inside the clock resolution; give it more work'
    );
  return { subjectMs, referenceMs, ratio: subjectMs / referenceMs, rounds };
}
