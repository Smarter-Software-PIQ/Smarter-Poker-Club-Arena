/**
 * Tournament payout equity.
 *
 * Phase 7 evaluates resulting stack vectors rather than applying one global
 * bubble multiplier. Final tables of up to ten live players use exact
 * Malmuth-Harville recursion; winner-take-all curves use exact chip share at
 * every field size. Larger multi-place fields use direct deterministic Monte
 * Carlo of the same Plackett-Luce finishing-order distribution: independent
 * exponential clocks with stack-sized rates. No player or paid place is
 * bucketed, merged, or discarded.
 *
 * All functions are pure. No database, clock, network, or action-clock I/O.
 */

const EXACT_MAX_PLAYERS = 10;
const MC_MAX_TRIALS = 1_200;
const MC_MIN_TRIALS = 96;
const MC_TARGET_CLOCK_DRAWS = 240_000;
/** Two-sided Hoeffding confidence outside the reported Monte Carlo radius. */
const MC_ERROR_ALPHA = 0.001;

export type IcmMethod = 'exact_mh' | 'plackett_luce_mc';

export interface IcmEstimate {
  /** Expected prize in the same unit as the supplied payout curve. */
  equity: number;
  /** 99.9% confidence half-width in payout units; zero for exact recursion. */
  errorBound: number;
  method: IcmMethod;
  modeledPlayers: number;
  trials?: number;
  standardError?: number;
}

/**
 * One action-wide ICM workspace. Large-field random clocks are generated once
 * and reused across every candidate stack vector. `mutableIndices` names the
 * table-local stacks that may change; every other stack is checked immutable.
 */
export interface IcmEquityEstimator {
  /** Optional bounded prefix of the same clocks; never regenerates or extends them. */
  estimate(stacks: number[], maximumTrials?: number): IcmEstimate;
  /** Strongest method used by this workspace; each estimate names its own method. */
  method: IcmMethod;
  trials: number;
  randomClockDraws: number;
}

const cleanStacks = (stacks: number[]): number[] =>
  stacks.map((stack) => (Number.isFinite(stack) && stack > 0 ? stack : 0));

const cleanPayouts = (payouts: number[]): number[] =>
  payouts.map((payout) => (Number.isFinite(payout) && payout > 0 ? payout : 0));

const payoutMass = (payouts: number[]): number =>
  payouts.reduce((sum, payout) => sum + (Number.isFinite(payout) && payout > 0 ? payout : 0), 0);

/**
 * True for equal-seat curves, including a final sub-seat cash remainder.
 * Classification is retained for legacy strategy reads; the ICM calculator
 * itself always prices every place value and never flattens the remainder.
 */
export function isFlatPayoutCurve(payouts: number[]): boolean {
  const positive = payouts.filter((payout) => Number.isFinite(payout) && payout > 0);
  if (positive.length < 2) return false;
  const first = positive[0];
  const core =
    positive.length >= 3 && positive.at(-1)! < first * 0.5 ? positive.slice(0, -1) : positive;
  return core.length >= 2 && core.every((payout) => Math.abs(payout - first) <= first * 0.05);
}

/** Precomputed bit-manipulation lookup tables for exact <=10-player Malmuth-Harville DP. */
const EXACT_STATE_COUNT = 1 << EXACT_MAX_PLAYERS;
const EXACT_POPCOUNT = new Uint8Array(EXACT_STATE_COUNT);
const EXACT_MSB = new Uint8Array(EXACT_STATE_COUNT);
for (let mask = 1; mask < EXACT_STATE_COUNT; mask++) {
  EXACT_POPCOUNT[mask] = EXACT_POPCOUNT[mask >> 1] + (mask & 1);
  EXACT_MSB[mask] = 31 - Math.clz32(mask);
}
/** Module-level synchronous DP scratch (exactCleanIcmEquity never invokes caller callbacks). */
const EXACT_TOTAL_SCRATCH = new Float64Array(EXACT_STATE_COUNT);
const EXACT_DP_SCRATCH = new Float64Array(EXACT_STATE_COUNT);

/**
 * Bounded per-process LRU for exact <=10-player Malmuth-Harville equities.
 * Keyed by exact (hero slot, live stacks in order, paid-depth prize prefix);
 * pure deterministic function of those inputs, so reuse is bit-identical.
 */
export const ICM_EXACT_EQUITY_CACHE_MAX = 4_096;
const exactEquityCache = new Map<string, number>();
let exactEquityCacheHits = 0;
let exactEquityCacheBuilds = 0;

/** Reuse counters of the exact Malmuth-Harville equity cache (benchmarks and tests). */
export function icmExactCacheStats(): { hits: number; builds: number; size: number } {
  return {
    hits: exactEquityCacheHits,
    builds: exactEquityCacheBuilds,
    size: exactEquityCache.size,
  };
}

/** Tests and benchmarks only: forget every cached exact ICM equity. */
export function resetIcmExactCacheForTest(): void {
  exactEquityCache.clear();
  exactEquityCacheHits = 0;
  exactEquityCacheBuilds = 0;
}

/** Uncached exact Malmuth-Harville equity, for differential tests only. */
export function exactIcmEquityUncachedForTest(
  stacks: number[],
  payouts: number[],
  heroIdx: number
): number {
  const original = cleanStacks(stacks);
  const prizes = cleanPayouts(payouts);
  return exactCleanIcmEquityUncached(original, prizes, heroIdx, payoutMass(prizes));
}

/**
 * Exact Malmuth-Harville equity for one player.
 *
 * Winner-take-all needs only exact chip share. Otherwise a bit-mask dynamic
 * program visits at most 2^10 states. Zero-stack entries
 * are compacted first, so ten live finalists remain exact even when the input
 * vector retains already-busted identities.
 */
export function exactIcmEquity(stacks: number[], payouts: number[], heroIdx: number): number {
  const original = cleanStacks(stacks);
  const prizes = cleanPayouts(payouts);
  return exactCleanIcmEquity(original, prizes, heroIdx, payoutMass(prizes));
}

function exactEquityKey(
  compactHero: number,
  clean: number[],
  prizes: number[],
  paidDepth: number
): string {
  let key = `${compactHero}|${clean[0]}`;
  for (let i = 1; i < clean.length; i++) key += `,${clean[i]}`;
  key += `|${prizes[0]}`;
  for (let i = 1; i < paidDepth; i++) key += `,${prizes[i]}`;
  return key;
}

/**
 * Bottom-up exact Malmuth-Harville DP preserving bit-identical IEEE-754 order:
 *  - totals[mask] adds clean[msb(mask)] last -> exact ascending-index sum order;
 *  - winner iterates lowest-set-bit first -> exact ascending-index winner sum order.
 */
function exactDpCore(
  clean: number[],
  prizes: number[],
  compactHero: number,
  paidDepth: number,
  dp: Float64Array
): number {
  const n = clean.length;
  const fullMask = (1 << n) - 1;
  const heroBit = 1 << compactHero;
  const totals = EXACT_TOTAL_SCRATCH;
  totals[0] = 0;
  for (let mask = 1; mask <= fullMask; mask++) {
    const hi = EXACT_MSB[mask];
    totals[mask] = totals[mask ^ (1 << hi)] + clean[hi];
  }

  const minRemaining = n - paidDepth + 1;
  for (let mask = heroBit; mask <= fullMask; mask++) {
    if ((mask & heroBit) === 0) {
      mask = (mask | heroBit) - 1;
      continue;
    }
    const remaining = EXACT_POPCOUNT[mask];
    if (remaining < minRemaining) {
      dp[mask] = 0;
      continue;
    }
    const total = totals[mask];
    if (total <= 0) {
      dp[mask] = 0;
      continue;
    }
    const prize = prizes[n - remaining];
    let equity = 0;
    let bits = mask;
    while (bits !== 0) {
      const lsb = bits & -bits;
      const winner = EXACT_MSB[lsb];
      bits ^= lsb;
      const probability = clean[winner] / total;
      equity += winner === compactHero ? probability * prize : probability * dp[mask ^ lsb];
    }
    dp[mask] = equity;
  }
  return dp[fullMask];
}

function exactCleanIcmEquityUncached(
  original: number[],
  prizes: number[],
  heroIdx: number,
  prizeMass: number,
  scratch?: Float64Array
): number {
  if (
    original.length === 0 ||
    heroIdx < 0 ||
    heroIdx >= original.length ||
    original[heroIdx] <= 0 ||
    prizeMass <= 0
  ) {
    return 0;
  }

  // First-place probability in Malmuth-Harville is chip share, independent
  // of field size. No finishing-order recursion or sampling is required.
  if (isWinnerTakeAll(prizes)) {
    if (!Number.isSafeInteger(heroIdx)) return 0;
    return (original[heroIdx] / original.reduce((sum, stack) => sum + stack, 0)) * prizes[0];
  }

  const clean: number[] = [];
  let compactHero = -1;
  for (let index = 0; index < original.length; index++) {
    if (original[index] <= 0) continue;
    if (index === heroIdx) compactHero = clean.length;
    clean.push(original[index]);
  }
  if (clean.length > EXACT_MAX_PLAYERS) return 0;
  if (compactHero < 0) return 0;

  const paidDepth = Math.min(clean.length, prizes.length);
  return exactDpCore(clean, prizes, compactHero, paidDepth, scratch ?? EXACT_DP_SCRATCH);
}

/** Sanitization is owned by the public entry point or admitted estimator.
 * The exact DP retains the exact ascending sums and winner order.
 * An action-local scratch array contains no returned values or caller aliases. */
function exactCleanIcmEquity(
  original: number[],
  prizes: number[],
  heroIdx: number,
  prizeMass: number,
  scratch?: Float64Array
): number {
  if (
    original.length === 0 ||
    heroIdx < 0 ||
    heroIdx >= original.length ||
    original[heroIdx] <= 0 ||
    prizeMass <= 0
  ) {
    return 0;
  }

  // First-place probability in Malmuth-Harville is chip share, independent
  // of field size. No finishing-order recursion or sampling is required.
  if (isWinnerTakeAll(prizes)) {
    if (!Number.isSafeInteger(heroIdx)) return 0;
    return (original[heroIdx] / original.reduce((sum, stack) => sum + stack, 0)) * prizes[0];
  }

  const clean: number[] = [];
  let compactHero = -1;
  for (let index = 0; index < original.length; index++) {
    if (original[index] <= 0) continue;
    if (index === heroIdx) compactHero = clean.length;
    clean.push(original[index]);
  }
  if (clean.length > EXACT_MAX_PLAYERS) return 0;
  if (compactHero < 0) return 0;

  const paidDepth = Math.min(clean.length, prizes.length);
  if (clean.length <= 2) {
    return exactDpCore(clean, prizes, compactHero, paidDepth, scratch ?? EXACT_DP_SCRATCH);
  }
  const key = exactEquityKey(compactHero, clean, prizes, paidDepth);
  const cached = exactEquityCache.get(key);
  if (cached !== undefined) {
    exactEquityCacheHits++;
    exactEquityCache.delete(key);
    exactEquityCache.set(key, cached);
    return cached;
  }
  const value = exactDpCore(clean, prizes, compactHero, paidDepth, scratch ?? EXACT_DP_SCRATCH);
  exactEquityCacheBuilds++;
  exactEquityCache.set(key, value);
  while (exactEquityCache.size > ICM_EXACT_EQUITY_CACHE_MAX) {
    const oldest = exactEquityCache.keys().next().value;
    if (oldest === undefined) break;
    exactEquityCache.delete(oldest);
  }
  return value;
}

/** Exact all-player vector for golden/differential checks and final tables. */
export function exactIcmVector(stacks: number[], payouts: number[]): number[] {
  return stacks.map((_, heroIdx) => exactIcmEquity(stacks, payouts, heroIdx));
}

function mcTrials(players: number): number {
  return Math.max(
    MC_MIN_TRIALS,
    Math.min(MC_MAX_TRIALS, Math.floor(MC_TARGET_CLOCK_DRAWS / Math.max(1, players)))
  );
}

function isWinnerTakeAll(prizes: number[]): boolean {
  return prizes[0] > 0 && prizes.slice(1).every((prize) => prize === 0);
}

/**
 * Build an exact WTA or direct Plackett-Luce estimator with common random numbers.
 *
 * Independent exponential clocks are still the exact MH ranking model. For
 * an action, remote stacks never change, so their clocks are sorted once per
 * trial. Each candidate then needs one binary search plus at most the local
 * table size, rather than another full-field pass with another Math.log for
 * every resulting vector.
 */
export function createIcmEquityEstimator(
  stacks: number[],
  payouts: number[],
  heroIdx: number,
  mutableIndices: number[] = stacks.map((_, index) => index),
  maximumTrials: number = MC_MAX_TRIALS
): IcmEquityEstimator {
  const reference = cleanStacks(stacks);
  const prizes = cleanPayouts(payouts);
  const live = reference.filter((stack) => stack > 0).length;
  const mutable = [...new Set([...mutableIndices, heroIdx])]
    .filter((index) => Number.isSafeInteger(index) && index >= 0 && index < reference.length)
    .sort((left, right) => left - right);
  const mutableSet = new Set(mutable);
  if (
    isWinnerTakeAll(prizes) &&
    Number.isSafeInteger(heroIdx) &&
    heroIdx >= 0 &&
    heroIdx < reference.length
  ) {
    return {
      method: 'exact_mh',
      trials: 0,
      randomClockDraws: 0,
      estimate(vector: number[]): IcmEstimate {
        if (vector.length !== reference.length) {
          throw new Error('ICM candidate vector length changed inside one action');
        }
        const clean = cleanStacks(vector);
        let total = 0;
        let modeledPlayers = 0;
        for (let index = 0; index < reference.length; index++) {
          if (!mutableSet.has(index) && Math.abs(clean[index] - reference[index]) > 0.005) {
            throw new Error('ICM remote stack changed inside one action');
          }
          total += clean[index];
          if (clean[index] > 0) modeledPlayers++;
        }
        return {
          equity: total > 0 ? (clean[heroIdx] / total) * prizes[0] : 0,
          errorBound: 0,
          method: 'exact_mh',
          modeledPlayers,
        };
      },
    };
  }
  if (live <= EXACT_MAX_PLAYERS) {
    // One bounded buffer per action instead of one per candidate/rollout vector.
    // Each estimate clears every reachable mask, including after a bust/revival.
    const exactScratch = new Float64Array(1 << EXACT_MAX_PLAYERS);
    const prizeMass = payoutMass(prizes);
    let revivedField: IcmEquityEstimator | undefined;
    return {
      get method() {
        return revivedField?.method ?? 'exact_mh';
      },
      get trials() {
        return revivedField?.trials ?? 0;
      },
      get randomClockDraws() {
        return revivedField?.randomClockDraws ?? 0;
      },
      estimate(vector: number[], trialLimit?: number): IcmEstimate {
        if (vector.length !== reference.length) {
          throw new Error('ICM candidate vector length changed inside one action');
        }
        const clean = cleanStacks(vector);
        for (let index = 0; index < reference.length; index++) {
          if (!mutableSet.has(index) && Math.abs(clean[index] - reference[index]) > 0.005) {
            throw new Error('ICM remote stack changed inside one action');
          }
        }
        const modeledPlayers = clean.filter((stack) => stack > 0).length;
        if (modeledPlayers > EXACT_MAX_PLAYERS) {
          // Committed all-in chips are absent from the reference stacks, but
          // an award or permitted recovery can restore a live entrant. Keep
          // <=10-player candidates exact and use one original-input MC clock
          // population for larger candidates, rather than returning exact zero.
          revivedField ??= sharedMonteCarloEquityEstimator(
            reference,
            prizes,
            heroIdx,
            mutable,
            maximumTrials
          );
          return revivedField.estimate(clean, trialLimit);
        }
        return {
          equity: exactCleanIcmEquity(clean, prizes, heroIdx, prizeMass, exactScratch),
          errorBound: 0,
          method: 'exact_mh',
          modeledPlayers,
        };
      },
    };
  }

  return sharedMonteCarloEquityEstimator(reference, prizes, heroIdx, mutable, maximumTrials);
}

/**
 * THE CLOCK POPULATION IS REUSED ACROSS DECISIONS (TASK #8, 2026-11-20).
 *
 * Production 2026-11-21 00:00-00:26Z: the tournament-utility node (Phase 7, HorseTournamentUtility) took
 * 205,203 ms of 468,753 ms of all Horse decision time (44%), about 26.5 ms per tournament decision, and NLH
 * decisions averaged 29 ms (cash 5-10 ms, tournaments 25-100 ms). Every tournament decision built this
 * estimator afresh: up to 240,000 exponential clock draws and one numeric sort per trial over the remote field
 * (the comment above calls it the dominant Phase 7 action-clock cost), although the same Horse at the same
 * table decides several times a hand against the same remote field.
 *
 * The estimator is a pure function of its inputs: its own seeded generator (seed from the hero index, field
 * length and payout count), clocks written once at construction and only read by estimate(), which mutates
 * nothing but a memo of scalar error bounds. A mutable (table-local) slot's stack never enters construction
 * except through the live count. So an estimator built for identical (field length, hero index, payout curve,
 * mutable slots, trial cap, live count, every non-mutable stack exactly) is the same object in every value it
 * can return, and reusing it changes no decision. Anything else builds a new one. Bounded LRU per process
 * (each entry holds at most 240,000 doubles, about 1.9 MB).
 */
/**
 * Bounded per-process LRU for Monte Carlo clock populations.
 * Because remote clocks only retain the paid-place prefix `min(fixed, prizes)`
 * in a flat Float64Array (~160-350 KB for typical MTT fields instead of 1.9 MB),
 * 32 entries fit 4 concurrent 8-seat tables on one worker under a strict 16 MB
 * byte ceiling without thrashing across seats.
 */
export const ICM_MC_ESTIMATOR_CACHE_MAX = 32;
export const ICM_MC_ESTIMATOR_CACHE_MAX_BYTES = 16 * 1024 * 1024;
const MC_ESTIMATE_MEMO_MAX = 1_024;

interface CachedMcEstimator {
  estimator: IcmEquityEstimator;
  bytes: number;
}

const mcEstimatorCache = new Map<string, CachedMcEstimator>();
let mcEstimatorCacheBytes = 0;
let mcEstimatorCacheHits = 0;
let mcEstimatorCacheBuilds = 0;

function monteCarloEstimatorKey(
  reference: number[],
  prizes: number[],
  heroIdx: number,
  mutable: number[],
  maximumTrials: number
): string {
  const mutableSet = new Set(mutable);
  let live = 0;
  const fixed: string[] = [];
  for (let index = 0; index < reference.length; index++) {
    const stack = reference[index];
    if (stack > 0) live++;
    fixed.push(mutableSet.has(index) ? '*' : String(stack));
  }
  return `${reference.length}|${heroIdx}|${String(maximumTrials)}|${live}|${prizes.join(',')}|${mutable.join(',')}|${fixed.join(',')}`;
}

function sharedMonteCarloEquityEstimator(
  reference: number[],
  prizes: number[],
  heroIdx: number,
  mutable: number[],
  maximumTrials: number
): IcmEquityEstimator {
  const key = monteCarloEstimatorKey(reference, prizes, heroIdx, mutable, maximumTrials);
  const cached = mcEstimatorCache.get(key);
  if (cached) {
    mcEstimatorCacheHits++;
    mcEstimatorCache.delete(key);
    mcEstimatorCache.set(key, cached);
    return cached.estimator;
  }
  const built = createMonteCarloEquityEstimatorWithSize(
    reference,
    prizes,
    heroIdx,
    mutable,
    maximumTrials
  );
  mcEstimatorCacheBuilds++;
  mcEstimatorCache.set(key, built);
  mcEstimatorCacheBytes += built.bytes;
  while (
    mcEstimatorCache.size > ICM_MC_ESTIMATOR_CACHE_MAX ||
    (mcEstimatorCacheBytes > ICM_MC_ESTIMATOR_CACHE_MAX_BYTES && mcEstimatorCache.size > 1)
  ) {
    const oldestKey = mcEstimatorCache.keys().next().value;
    if (oldestKey === undefined) break;
    const evicted = mcEstimatorCache.get(oldestKey);
    mcEstimatorCache.delete(oldestKey);
    if (evicted) mcEstimatorCacheBytes -= evicted.bytes;
  }
  return built.estimator;
}

/** Reuse counters of the Monte Carlo clock population (benchmarks and tests). */
export function icmEstimatorCacheStats(): {
  hits: number;
  builds: number;
  size: number;
  bytes: number;
} {
  return {
    hits: mcEstimatorCacheHits,
    builds: mcEstimatorCacheBuilds,
    size: mcEstimatorCache.size,
    bytes: mcEstimatorCacheBytes,
  };
}

/** Tests and benchmarks only: forget every cached clock population. */
export function resetIcmEstimatorCacheForTest(): void {
  mcEstimatorCache.clear();
  mcEstimatorCacheBytes = 0;
  mcEstimatorCacheHits = 0;
  mcEstimatorCacheBuilds = 0;
}

/** The uncached construction, for differential tests only. */
export function buildMonteCarloEquityEstimatorUncachedForTest(
  stacks: number[],
  payouts: number[],
  heroIdx: number,
  mutableIndices: number[],
  maximumTrials: number = MC_MAX_TRIALS
): IcmEquityEstimator {
  const reference = cleanStacks(stacks);
  const mutable = [...new Set([...mutableIndices, heroIdx])]
    .filter((index) => Number.isSafeInteger(index) && index >= 0 && index < reference.length)
    .sort((left, right) => left - right);
  return createMonteCarloEquityEstimator(
    reference,
    cleanPayouts(payouts),
    heroIdx,
    mutable,
    maximumTrials
  );
}

function createMonteCarloEquityEstimator(
  reference: number[],
  prizes: number[],
  heroIdx: number,
  mutable: number[],
  maximumTrials: number
): IcmEquityEstimator {
  return createMonteCarloEquityEstimatorWithSize(reference, prizes, heroIdx, mutable, maximumTrials)
    .estimator;
}

/** Inputs are detached and sanitized by the public workspace admission. */
function createMonteCarloEquityEstimatorWithSize(
  reference: number[],
  prizes: number[],
  heroIdx: number,
  mutable: number[],
  maximumTrials: number
): CachedMcEstimator {
  const live = reference.filter((stack) => stack > 0).length;
  const mutableSet = new Set(mutable);
  const mutableSlot = new Map(mutable.map((index, slot) => [index, slot]));
  const immutable = reference
    .map((stack, index) => ({ stack, index }))
    .filter((entry) => !mutableSet.has(entry.index));
  let fixedCount = 0;
  let drawCount = 0;
  for (let index = 0; index < reference.length; index++) {
    const stack = reference[index];
    const isMutable = mutableSet.has(index);
    if (stack <= 0 && !isMutable) continue;
    drawCount++;
    if (!isMutable) fixedCount++;
  }
  const drawSlots = new Int32Array(drawCount);
  const drawStacks = new Float64Array(drawCount);
  let planIdx = 0;
  for (let index = 0; index < reference.length; index++) {
    const stack = reference[index];
    const slot = mutableSlot.get(index);
    if (slot === undefined && stack <= 0) continue;
    drawSlots[planIdx] = slot === undefined ? -1 : slot;
    drawStacks[planIdx] = stack;
    planIdx++;
  }

  const trials = Math.min(
    mcTrials(live),
    Math.max(
      MC_MIN_TRIALS,
      Math.min(
        MC_MAX_TRIALS,
        Number.isFinite(maximumTrials) ? Math.floor(maximumTrials) : MC_MAX_TRIALS
      )
    )
  );
  const mutableCount = mutable.length;
  const prizesLength = prizes.length;
  // Ranks beyond prizes.length always pay zero, so retaining only the smallest
  // `min(fixedCount, prizesLength)` sorted remote clocks per trial is bit-identical
  // to keeping the whole remote array while using 6-10x less memory in contiguous RAM.
  const remoteCap = Math.min(fixedCount, prizesLength);
  const flatMutable = new Float64Array(trials * mutableCount);
  const flatRemote = new Float64Array(trials * remoteCap);
  const sortScratch = new Float64Array(fixedCount);

  let seed =
    0x9e3779b9 ^
    ((heroIdx + 1) * 0x85ebca6b) ^
    (reference.length * 0xc2b2ae35) ^
    (prizesLength << 16);
  const rand = (): number => {
    seed ^= seed << 13;
    seed >>>= 0;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    seed >>>= 0;
    return Math.max(Number.EPSILON, seed / 0x1_0000_0000);
  };

  for (let trial = 0; trial < trials; trial++) {
    const mBase = trial * mutableCount;
    let clockIndex = 0;
    for (let k = 0; k < drawCount; k++) {
      const exponential = -Math.log(rand());
      const slot = drawSlots[k];
      if (slot >= 0) flatMutable[mBase + slot] = exponential;
      else sortScratch[clockIndex++] = exponential / drawStacks[k];
    }
    if (clockIndex !== fixedCount) {
      throw new Error('ICM fixed-clock workspace did not match its live remote field');
    }
    sortScratch.sort();
    const rBase = trial * remoteCap;
    for (let rank = 0; rank < remoteCap; rank++) {
      flatRemote[rBase + rank] = sortScratch[rank];
    }
  }

  const heroSlot = mutableSlot.get(heroIdx);
  if (heroSlot === undefined) throw new Error('ICM estimator requires a mutable hero index');
  const maximum = prizes.reduce((largest, payout) => Math.max(largest, payout), 0);
  const errorBound = maximum * Math.sqrt(Math.log(2 / MC_ERROR_ALPHA) / (2 * trials));
  const prizeMass = payoutMass(prizes);
  const prefixErrorBounds = new Map<number, number>([[trials, errorBound]]);
  // Bounded per-estimator memo of pure (sampleTrials, localStacks) scalar results.
  // Each estimate() returns a fresh object so caller mutations can never pollute it.
  const estimateMemo = new Map<
    string,
    { equity: number; errorBound: number; standardError: number }
  >();

  const estimator: IcmEquityEstimator = {
    method: 'plackett_luce_mc',
    trials,
    randomClockDraws: trials * (fixedCount + mutableCount),
    estimate(vector: number[], trialLimit: number = trials): IcmEstimate {
      if (vector.length !== reference.length) {
        throw new Error('ICM candidate vector length changed inside one action');
      }
      // Only table-local rates enter the trial loop. Preserve the exact
      // sanitization and immutable-field check without allocating a cleaned
      // copy of a thousand-player field for each candidate/future vector.
      const localStacks = new Array<number>(mutableCount);
      for (let slot = 0; slot < mutableCount; slot++) {
        const stack = vector[mutable[slot]];
        localStacks[slot] = Number.isFinite(stack) && stack > 0 ? stack : 0;
      }
      // Per-invocation ownership preserves reentrant caller-vector reads.
      // The retained slots follow exactly the prior ascending comparison order.
      const activeOpponentSlots: number[] = [];
      const activeOpponentStacks: number[] = [];
      let modeledPlayers = fixedCount;
      for (let slot = 0; slot < mutableCount; slot++) {
        const stack = localStacks[slot];
        if (stack <= 0) continue;
        modeledPlayers++;
        if (slot !== heroSlot) {
          activeOpponentSlots.push(slot);
          activeOpponentStacks.push(stack);
        }
      }
      for (let i = 0; i < immutable.length; i++) {
        const entry = immutable[i];
        const raw = vector[entry.index];
        // Equal reference values already have their validated live count.
        // The slow path retains sanitization and the numeric drift boundary.
        if (raw === entry.stack) continue;
        const stack = Number.isFinite(raw) && raw > 0 ? raw : 0;
        if (Math.abs(stack - entry.stack) > 0.005) {
          throw new Error('ICM remote stack changed inside one action');
        }
        if (stack > 0 && entry.stack <= 0) modeledPlayers++;
        else if (stack <= 0 && entry.stack > 0) modeledPlayers--;
      }
      const heroStack = localStacks[heroSlot];
      const sampleTrials = Math.min(
        trials,
        Math.max(MC_MIN_TRIALS, Number.isFinite(trialLimit) ? Math.floor(trialLimit) : trials)
      );
      if (heroStack <= 0 || prizeMass <= 0) {
        return {
          equity: 0,
          errorBound: 0,
          method: 'plackett_luce_mc',
          modeledPlayers,
          trials: sampleTrials,
          standardError: 0,
        };
      }

      let memoKey = `${sampleTrials}|${localStacks[0]}`;
      for (let slot = 1; slot < mutableCount; slot++) memoKey += `,${localStacks[slot]}`;
      const memoized = estimateMemo.get(memoKey);
      if (memoized !== undefined) {
        estimateMemo.delete(memoKey);
        estimateMemo.set(memoKey, memoized);
        return {
          equity: memoized.equity,
          errorBound: memoized.errorBound,
          method: 'plackett_luce_mc',
          modeledPlayers,
          trials: sampleTrials,
          standardError: memoized.standardError,
        };
      }

      const oppCount = activeOpponentSlots.length;
      const linearRemote = remoteCap <= 6;
      const lastRemoteOffset = remoteCap - 1;
      let mean = 0;
      let m2 = 0;
      for (let trial = 0; trial < sampleTrials; trial++) {
        const mBase = trial * mutableCount;
        const heroClock = flatMutable[mBase + heroSlot] / heroStack;
        const rBase = trial * remoteCap;
        let playersAhead: number;
        if (remoteCap === 0) {
          playersAhead = 0;
        } else if (flatRemote[rBase + lastRemoteOffset] < heroClock) {
          playersAhead = remoteCap;
        } else if (linearRemote) {
          playersAhead = 0;
          while (playersAhead < lastRemoteOffset && flatRemote[rBase + playersAhead] < heroClock) {
            playersAhead++;
          }
        } else if (flatRemote[rBase] >= heroClock) {
          playersAhead = 0;
        } else {
          let low = 1;
          let high = lastRemoteOffset;
          while (low < high) {
            const mid = (low + high) >>> 1;
            if (flatRemote[rBase + mid] < heroClock) low = mid + 1;
            else high = mid;
          }
          playersAhead = low;
        }
        if (playersAhead < prizesLength) {
          for (let active = 0; active < oppCount; active++) {
            if (
              flatMutable[mBase + activeOpponentSlots[active]] / activeOpponentStacks[active] <
              heroClock
            ) {
              playersAhead++;
              if (playersAhead >= prizesLength) break;
            }
          }
        }
        const value = playersAhead < prizesLength ? prizes[playersAhead] : 0;
        const sample = trial + 1;
        const delta = value - mean;
        mean += delta / sample;
        m2 += delta * (value - mean);
      }

      const variance = sampleTrials > 1 ? m2 / (sampleTrials - 1) : 0;
      let prefixErrorBound = prefixErrorBounds.get(sampleTrials);
      if (prefixErrorBound === undefined) {
        // Keep the original expression and IEEE-754 operation order exactly.
        prefixErrorBound = maximum * Math.sqrt(Math.log(2 / MC_ERROR_ALPHA) / (2 * sampleTrials));
        prefixErrorBounds.set(sampleTrials, prefixErrorBound);
      }
      const standardError = Math.sqrt(Math.max(0, variance) / sampleTrials);
      estimateMemo.set(memoKey, { equity: mean, errorBound: prefixErrorBound, standardError });
      if (estimateMemo.size > MC_ESTIMATE_MEMO_MAX) {
        const oldest = estimateMemo.keys().next().value;
        if (oldest !== undefined) estimateMemo.delete(oldest);
      }
      return {
        equity: mean,
        errorBound: prefixErrorBound,
        method: 'plackett_luce_mc',
        modeledPlayers,
        trials: sampleTrials,
        standardError,
      };
    },
  };

  return {
    estimator,
    bytes: flatMutable.byteLength + flatRemote.byteLength,
  };
}

/** Direct Monte Carlo of a hero's place in a stack-weighted MH ranking. */
function plackettLuceEstimate(stacks: number[], payouts: number[], heroIdx: number): IcmEstimate {
  const clean = cleanStacks(stacks);
  const live = clean.map((stack, index) => ({ stack, index })).filter((entry) => entry.stack > 0);
  const hero = live.find((entry) => entry.index === heroIdx);
  if (!hero || payoutMass(payouts) <= 0) {
    return {
      equity: 0,
      errorBound: 0,
      method: 'plackett_luce_mc',
      modeledPlayers: live.length,
      trials: 0,
      standardError: 0,
    };
  }
  return createIcmEquityEstimator(clean, payouts, heroIdx).estimate(clean);
}

/** Backward-compatible probability-only satellite helper. */
export function flatPayoutSurvival(stacks: number[], seats: number, heroIdx: number): number {
  const clean = cleanStacks(stacks);
  const live = clean.filter((stack) => stack > 0).length;
  if (heroIdx < 0 || heroIdx >= clean.length || clean[heroIdx] <= 0 || seats <= 0) return 0;
  if (live <= seats) return 1;
  const prizes = Array.from({ length: Math.max(0, Math.floor(seats)) }, () => 1);
  return live <= EXACT_MAX_PLAYERS
    ? exactIcmEquity(clean, prizes, heroIdx)
    : plackettLuceEstimate(clean, prizes, heroIdx).equity;
}

/** Equity plus the method/error receipt consumed by the Phase 7 ledger. */
export function icmEquityEstimate(
  stacks: number[],
  payouts: number[],
  heroIdx: number
): IcmEstimate {
  const clean = cleanStacks(stacks);
  const live = clean.filter((stack) => stack > 0).length;
  if (
    clean.length === 0 ||
    heroIdx < 0 ||
    heroIdx >= clean.length ||
    clean[heroIdx] <= 0 ||
    payoutMass(payouts) <= 0
  ) {
    return { equity: 0, errorBound: 0, method: 'exact_mh', modeledPlayers: live };
  }

  if (live <= EXACT_MAX_PLAYERS) {
    return {
      equity: exactIcmEquity(clean, payouts, heroIdx),
      errorBound: 0,
      method: 'exact_mh',
      modeledPlayers: live,
    };
  }
  return plackettLuceEstimate(clean, payouts, heroIdx);
}

/** Prize equity only, retained for all existing callers. */
export function icmEquity(stacks: number[], payouts: number[], heroIdx: number): number {
  return icmEquityEstimate(stacks, payouts, heroIdx).equity;
}

/**
 * Hero's prize equity after a pot in which hero may have lost every chip
 * (2026-11-15, hand 59441335). icmEquity prices a zero stack at 0, but a
 * player who busts in this hand still finishes in a place: behind every stack
 * that was live before it, at place `live` of the vector before the risk. In
 * the money that place is paid (nine left with 13 paid, the bust is ninth and
 * collects ninth's payout either way); outside the money it pays 0, which is
 * what this returned before.
 */
let bustPaysPlace = false;
/**
 * OPTION icmBustPaysPlace (HorseDecideOpts, default OFF, Hand Analysis B3 2026-11-15): HorseLogic.decide runs each
 * decision inside withIcmBustPaysPlace(opts.icmBustPaysPlace === true, ...), so the paid-bust valuation is switched
 * live like every other Horse decision change. Off, a bust is valued at 0 exactly as before.
 */
export function withIcmBustPaysPlace<T>(on: boolean, fn: () => T, onFactorChanged?: () => void): T {
  const previous = bustPaysPlace;
  // Receipt only (2026-11-18): onFactorChanged is called once when fn returns, if the paid-bust value moved at least
  // one bubble factor while it ran (a nested scope's moves are included). It reads a counter and decides nothing.
  const changesBefore = bustPaysPlaceFactorChanges;
  bustPaysPlace = on;
  let value: T;
  try {
    value = fn();
  } finally {
    bustPaysPlace = previous;
  }
  if (on && onFactorChanged && bustPaysPlaceFactorChanges !== changesBefore) onFactorChanged();
  return value;
}
export function icmBustPaysPlaceOn(): boolean {
  return bustPaysPlace;
}
/**
 * Receipt only (icm_bust_pays_place_factor_changed_seen, 2026-11-18): how many bubble factors (bubbleFactor,
 * pairwiseBubbleFactor) the paid-bust valuation moved off the factor the 0 valuation gives, since the process
 * started. Monotonic; withIcmBustPaysPlace compares it before and after fn. Read by nothing that decides.
 */
let bustPaysPlaceFactorChanges = 0;
export function icmBustPaysPlaceFactorChangeCount(): number {
  return bustPaysPlaceFactorChanges;
}
/** The clamped factor, counting it when the paid bust moved it (off, a bust is 0 and the loss is the whole equity). */
function bubbleFactorOf(now: number, loss: number, gain: number, busts: boolean): number {
  const factor = Math.max(1, Math.min(5, loss / gain));
  if (bustPaysPlace && busts && factor !== Math.max(1, Math.min(5, now / gain)))
    bustPaysPlaceFactorChanges++;
  return factor;
}

function equityAfterPot(before: number[], after: number[], payouts: number[], idx: number): number {
  if (!bustPaysPlace || (after[idx] ?? 0) > 0) return icmEquity(after, payouts, idx);
  const live = cleanStacks(before).filter((stack) => stack > 0).length;
  return cleanPayouts(payouts)[live - 1] ?? 0;
}

/**
 * Bubble factor retained for legacy layers (icmRisk's V16 premium, the
 * payout-aware push/fold tables). Phase 7's final action arbiter no longer
 * uses this single global multiplier; it evaluates each action's stack
 * vectors directly. A bust is valued at the place hero finishes
 * (equityAfterPot): until 2026-11-15 it was valued at 0, so in the money a
 * whole-stack risk was charged every payout, including the one a bust
 * collects anyway, and a final-table short stack read the cap of 5.
 */
export function bubbleFactor(
  stacks: number[],
  payouts: number[],
  heroIdx: number,
  riskChips: number
): number {
  if (riskChips <= 0) return 1;
  const hero = stacks[heroIdx] ?? 0;
  if (hero <= 0) return 1;

  let opponentIdx = -1;
  for (let index = 0; index < stacks.length; index++) {
    if (index === heroIdx) continue;
    if (opponentIdx === -1 || stacks[index] > stacks[opponentIdx]) opponentIdx = index;
  }
  if (opponentIdx === -1) return 1;
  const risk = Math.min(riskChips, hero, stacks[opponentIdx]);
  if (risk <= 0) return 1;

  const now = icmEquity(stacks, payouts, heroIdx);
  const up = stacks.slice();
  up[heroIdx] = hero + risk;
  up[opponentIdx] = stacks[opponentIdx] - risk;
  const down = stacks.slice();
  down[heroIdx] = hero - risk;
  down[opponentIdx] = stacks[opponentIdx] + risk;
  const gain = icmEquity(up, payouts, heroIdx) - now;
  const loss = now - equityAfterPot(stacks, down, payouts, heroIdx);
  if (gain <= 1e-12) return 5;
  return bubbleFactorOf(now, loss, gain, (down[heroIdx] ?? 0) <= 0);
}

export function premiumFromBubbleFactor(factor: number): number {
  return Math.max(0, Math.min(0.14, (factor - 1) * 0.04));
}

/**
 * Pairwise Malmuth-Harville / Plackett-Luce bubble factor for `actorIdx` in a
 * direct pot collision against `counterpartyIdx` risking `riskChips`. A bust
 * is valued at the place the actor finishes (equityAfterPot), as in
 * bubbleFactor.
 * Pure & deterministic; consumes zero global PRNG draws.
 */
export function pairwiseBubbleFactor(
  stacks: number[],
  payouts: number[],
  actorIdx: number,
  counterpartyIdx: number,
  riskChips: number
): number {
  if (
    riskChips <= 0 ||
    actorIdx < 0 ||
    counterpartyIdx < 0 ||
    actorIdx === counterpartyIdx ||
    actorIdx >= stacks.length ||
    counterpartyIdx >= stacks.length
  ) {
    return 1;
  }
  const actorStack = stacks[actorIdx] ?? 0;
  const counterStack = stacks[counterpartyIdx] ?? 0;
  if (actorStack <= 0 || counterStack <= 0 || payoutMass(payouts) <= 0) return 1;
  const risk = Math.min(riskChips, actorStack, counterStack);
  if (risk <= 0) return 1;

  const now = icmEquity(stacks, payouts, actorIdx);
  const up = stacks.slice();
  up[actorIdx] = actorStack + risk;
  up[counterpartyIdx] = counterStack - risk;
  const down = stacks.slice();
  down[actorIdx] = actorStack - risk;
  down[counterpartyIdx] = counterStack + risk;
  const gain = icmEquity(up, payouts, actorIdx) - now;
  const loss = now - equityAfterPot(stacks, down, payouts, actorIdx);
  if (gain <= 1e-12) return 5;
  return bubbleFactorOf(now, loss, gain, (down[actorIdx] ?? 0) <= 0);
}

export interface AsymmetricCoverPressure {
  heroBubbleFactor: number;
  villainBubbleFactor: number;
  /**
   * Bounded [-1, +1] asymmetric ICM leverage:
   *  > 0 when hero covers a medium/bubble/satellite-cliff villain (villain hurts more than hero);
   *  < 0 when villain covers hero on a pay-jump or satellite survival cliff.
   */
  coverLeverage: number;
}

/**
 * Computes asymmetric cover-stack vs covered-stack ICM / satellite pressure
 * across all variants (NLH, PLO4, PLO5, PLO6).
 */
export function asymmetricCoverPressure(input: {
  stacks: number[];
  payouts: number[];
  heroIdx: number;
  villainIdx: number;
  riskChips: number;
  satellite?: boolean;
  satelliteSeats?: number;
}): AsymmetricCoverPressure {
  const effectivePayouts =
    input.satellite && (input.satelliteSeats ?? 0) > 0
      ? Array.from({ length: Math.max(1, Math.floor(input.satelliteSeats!)) }, () => 1)
      : input.payouts;
  const heroBF = pairwiseBubbleFactor(
    input.stacks,
    effectivePayouts,
    input.heroIdx,
    input.villainIdx,
    input.riskChips
  );
  const villainBF = pairwiseBubbleFactor(
    input.stacks,
    effectivePayouts,
    input.villainIdx,
    input.heroIdx,
    input.riskChips
  );
  const rawDiff = villainBF - heroBF;
  const coverLeverage = Math.max(-1, Math.min(1, rawDiff / 1.5));
  return {
    heroBubbleFactor: heroBF,
    villainBubbleFactor: villainBF,
    coverLeverage,
  };
}

export interface BountyChipEquivalence {
  collectibleCents: number;
  bountyOverlayChips: number;
  bountyOverlayBB: number;
}

/**
 * Converts a target player's PKO / KO / active Mystery Bounty head into exact
 * chip-equivalent pot overlay (`bountyOverlayChips` / `bountyOverlayBB`).
 * At tournament start a standard 50% PKO head equals ~0.25-0.33 starting stacks;
 * as the regular prize pool concentrates per remaining chip, chip value rises
 * and bounty chip-equivalence scales proportionally.
 */
export function bountyChipEquivalence(input: {
  headBountyCents: number;
  isPko: boolean;
  isMysteryBounty?: boolean;
  mysteryBountyActive?: boolean;
  mysteryMeanCents?: number;
  buyInCents: number;
  prizePoolCents?: number;
  totalChipsInPlay?: number;
  startingStackChips: number;
  bigBlind: number;
  heroCoversTarget: boolean;
}): BountyChipEquivalence {
  if (!input.heroCoversTarget) {
    return { collectibleCents: 0, bountyOverlayChips: 0, bountyOverlayBB: 0 };
  }
  const collectibleCents = input.isMysteryBounty
    ? input.mysteryBountyActive
      ? Math.max(0, input.mysteryMeanCents ?? 0)
      : 0
    : input.isPko
      ? Math.max(0, input.headBountyCents) * 0.5
      : Math.max(0, input.headBountyCents);
  if (collectibleCents <= 0 || input.startingStackChips <= 0) {
    return { collectibleCents: 0, bountyOverlayChips: 0, bountyOverlayBB: 0 };
  }
  // Cents of regular prize pool backing each chip currently in play; falls back
  // to starting-stack buy-in density when live pool totals are absent.
  const regularBuyInCents = Math.max(1, input.buyInCents * (input.isPko ? 0.5 : 1));
  const centsPerChip =
    (input.prizePoolCents ?? 0) > 0 && (input.totalChipsInPlay ?? 0) > 0
      ? input.prizePoolCents! / input.totalChipsInPlay!
      : regularBuyInCents / input.startingStackChips;
  const bountyOverlayChips = centsPerChip > 0 ? collectibleCents / centsPerChip : 0;
  const bb = input.bigBlind > 0 ? input.bigBlind : 1;
  return {
    collectibleCents,
    bountyOverlayChips,
    bountyOverlayBB: bountyOverlayChips / bb,
  };
}
