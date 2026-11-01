/**
 * ═══════════════════════════════════════════════════════════════════════════
 * HORSE RARE-OPPORTUNITY MEMORY v2 (Item 12 Qualification)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Qualifies opportunity-clocked decay + deterministic observation-window
 * time expiry for rare turn/river and multi-raise opponent statistics
 * (`rfi`, `threeBet`, `foldTo3Bet`, `betCheckedTo`, `foldToBet`, `riverCall`),
 * while preserving the v1 `HorseOpponentExploit` model and neutrality contract
 * during transition.
 *
 * Why Item 12 exists:
 *   In v1 (`opponent-exploit-v1`), `decayAndAdd` multiplies EVERY field in
 *   `ExploitCounters` by `EXPLOIT_DECAY = 0.5^(1/30)` (and `EXPLOIT_FAST_DECAY`
 *   for fast fields) on every completed hand in which the player made any
 *   voluntary action (`hands = 1`), regardless of whether the hand offered an
 *   opportunity for a rare statistic such as `riverCall`, `foldTo3Bet`, or
 *   `threeBet`.
 *   Over 90 completed hands where the opponent folded or checked preflop/flop
 *   and faced zero river bets, a real `riverCall` sample of 12 opportunities
 *   decays by `0.5^(90/30) = 0.125` down to `1.5` opportunities — erasing a
 *   valid river read even though zero contradicting river opportunities
 *   occurred.
 *
 * How v2 (`horse-opponent-exploit-v2`) solves this:
 *   1. Opportunity-Clocked Paired Decay:
 *      Each statistic `(successField, opportunityField)` decays ONLY in
 *      proportion to the new opportunities `deltaOpp = increments[opportunityField]`
 *      observed in that hand:
 *        - Long window: `factor = Math.pow(0.5, deltaOpp / halfLifeOpps[stat])`
 *        - Fast window: `fastFactor = Math.pow(0.5, deltaFastOpp / fastHalfLifeOpps[stat])`
 *      When `deltaOpp === 0` (the hand offered no opportunity for `stat`),
 *      `factor === 1`, so neither `successes` nor `opportunities` is diluted
 *      by unrelated hands. When `deltaOpp > 0`, numerator and denominator
 *      decay by the exact same `factor` before adding `(deltaSucc, deltaOpp)`,
 *      preserving `0 <= successes <= opportunities` at every step.
 *   2. Deterministic Observation-Window Time Expiry:
 *      Every v2 record carries explicit model metadata:
 *        - `modelVersion: 'horse-opponent-exploit-v2'`
 *        - `firstObservedAtMs: number`
 *        - `lastObservedAtMs: number`
 *        - `lastOpportunityAtMs: Readonly<Record<ExploitStat, number | null>>`
 *      At read time (`evaluateRareOpportunityReadV2`), the caller supplies a
 *      deterministic `asOfMs` (e.g., the decision's `HorseObservationWindow.asOfIso`
 *      timestamp, never `Date.now()`) and `maxAgeMs`.
 *      - If `asOfMs - record.lastObservedAtMs > maxAgeMs`, the entire record
 *        is classified as `'expired_record'` and returns `read: null`.
 *      - If an individual rare statistic's `lastOpportunityAtMs[stat]` is older
 *        than `statMaxAgeMs` (defaulting to `maxAgeMs`) while the player is
 *        still active in other hands, that stale statistic's effective counters
 *        are zeroed before posterior evaluation and recorded in `expiredStats`.
 *   3. Versioned Serialization / Cache / Read-Frame Boundary:
 *      `serializeRareOpportunityRecordV2` and `deserializeRareOpportunityRecordV2`
 *      enforce explicit `modelVersion === 'horse-opponent-exploit-v2'` schema
 *      validation and reject v1 or malformed payloads without silent coercion.
 */

import type { ReadScope } from './HorseMind.js';
import {
  EXPLOIT_STATS,
  type ExploitCounters,
  type ExploitStat,
  type OpponentExploitRead,
  exploitHandIncrements,
  freshExploitCounters,
  opponentExploitRead,
  type ExploitHandAction,
} from './HorseOpponentExploit.js';

export const RARE_OPPORTUNITY_MODEL_VERSION = 'horse-opponent-exploit-v2' as const;

/** Default maximum age (in milliseconds) before an unobserved opponent record expires (24 hours). */
export const DEFAULT_RARE_OPPORTUNITY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Default maximum age (in milliseconds) for an individual rare statistic without new opportunities (6 hours). */
export const DEFAULT_RARE_STAT_OPPORTUNITY_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/**
 * Per-statistic opportunity half-lives (long window).
 * - `vpip` and `pfr` occur on every voluntary hand (`hands`), so their
 *   opportunity clock is 30 hands (matching v1 `EXPLOIT_HALF_LIFE_HANDS`).
 * - Rare postflop / multi-raise stats decay on their own opportunity clock
 *   so unrelated hands with 0 opportunities do not erase valid evidence.
 */
export const RARE_STAT_HALF_LIFE_OPPS: Readonly<Record<ExploitStat, number>> = Object.freeze({
  vpip: 30,
  pfr: 30,
  rfi: 24,
  threeBet: 16,
  foldTo3Bet: 12,
  betCheckedTo: 20,
  foldToBet: 20,
  riverCall: 12,
});

/** Per-statistic fast-window opportunity half-lives for style-change detection. */
export const RARE_STAT_FAST_HALF_LIFE_OPPS: Readonly<Partial<Record<ExploitStat, number>>> =
  Object.freeze({
    pfr: 8,
    rfi: 8,
    threeBet: 6,
    betCheckedTo: 8,
    foldToBet: 8,
    riverCall: 6,
  });

const LONG_STAT_PAIRS: Readonly<
  Record<ExploitStat, readonly [succ: keyof ExploitCounters, opp: keyof ExploitCounters]>
> = {
  vpip: ['vpip', 'hands'],
  pfr: ['pfr', 'hands'],
  rfi: ['rfi', 'rfiOpp'],
  threeBet: ['threeBet', 'threeBetOpp'],
  foldTo3Bet: ['foldTo3Bet', 'foldTo3BetOpp'],
  betCheckedTo: ['betCheckedTo', 'betCheckedToOpp'],
  foldToBet: ['foldToBet', 'foldToBetOpp'],
  riverCall: ['riverCall', 'riverCallOpp'],
};

const FAST_STAT_PAIRS: Readonly<
  Partial<Record<ExploitStat, readonly [succ: keyof ExploitCounters, opp: keyof ExploitCounters]>>
> = {
  pfr: ['fPfr', 'fHands'],
  rfi: ['fRfi', 'fRfiOpp'],
  threeBet: ['fThreeBet', 'fThreeBetOpp'],
  betCheckedTo: ['fBetCheckedTo', 'fBetCheckedToOpp'],
  foldToBet: ['fFoldToBet', 'fFoldToBetOpp'],
  riverCall: ['fRiverCall', 'fRiverCallOpp'],
};

export interface RareOpportunityRecordV2 {
  readonly modelVersion: typeof RARE_OPPORTUNITY_MODEL_VERSION;
  readonly scope: ReadScope;
  readonly counters: ExploitCounters;
  readonly firstObservedAtMs: number;
  readonly lastObservedAtMs: number;
  readonly totalHandsObserved: number;
  readonly lastOpportunityAtMs: Readonly<Record<ExploitStat, number | null>>;
}

export interface RareOpportunityDecayOptions {
  readonly halfLifeOpps?: Partial<Record<ExploitStat, number>>;
  readonly fastHalfLifeOpps?: Partial<Record<ExploitStat, number>>;
  readonly statMaxAgeMs?: number;
}

export interface RareOpportunityReadOptions {
  readonly asOfMs: number;
  readonly maxAgeMs?: number;
  readonly statMaxAgeMs?: number;
  readonly variant?: string | null;
  readonly corroborating?: ReadonlyArray<OpponentExploitRead | null | undefined>;
}

export interface RareOpportunityReadResultV2 {
  readonly modelVersion: typeof RARE_OPPORTUNITY_MODEL_VERSION;
  readonly status: 'active' | 'expired_record' | 'empty' | 'invalid_clock';
  readonly read: OpponentExploitRead | null;
  readonly effectiveCounters: ExploitCounters;
  readonly expiredStats: readonly ExploitStat[];
  readonly recordAgeMs: number | null;
}

/**
 * Create a fresh v2 rare-opportunity memory record for `scope`.
 */
export function createRareOpportunityRecordV2(
  scope: ReadScope,
  observedAtMs: number
): RareOpportunityRecordV2 {
  if (!Number.isFinite(observedAtMs) || observedAtMs < 0) {
    throw new Error(`createRareOpportunityRecordV2: invalid observedAtMs ${String(observedAtMs)}`);
  }
  const emptyLastOpp = {} as Record<ExploitStat, number | null>;
  for (const stat of EXPLOIT_STATS) {
    emptyLastOpp[stat] = null;
  }
  return Object.freeze({
    modelVersion: RARE_OPPORTUNITY_MODEL_VERSION,
    scope,
    counters: freshExploitCounters(),
    firstObservedAtMs: observedAtMs,
    lastObservedAtMs: observedAtMs,
    totalHandsObserved: 0,
    lastOpportunityAtMs: Object.freeze(emptyLastOpp),
  });
}

/**
 * Apply one completed hand's raw increments (`increments`) to `counters` using
 * opportunity-clocked paired decay.
 *
 * Unlike v1 `decayAndAdd` (which decays every counter on every hand), each
 * statistic `(succ, opp)` decays ONLY when `increments[opp] > 0`, by:
 *   `0.5 ^ (increments[opp] / halfLifeOpps[stat])`
 * This guarantees:
 *   1. Unrelated hands with `increments[opp] === 0` leave `counters[succ]` and
 *      `counters[opp]` untouched (`factor = 1`).
 *   2. Numerator and denominator decay by the exact same factor whenever an
 *      opportunity occurs (`0 <= counters[succ] <= counters[opp]`).
 */
export function decayByOpportunityAndAdd(
  counters: ExploitCounters,
  increments: ExploitCounters,
  options?: RareOpportunityDecayOptions
): void {
  const halfLives = options?.halfLifeOpps;
  const fastHalfLives = options?.fastHalfLifeOpps;

  // Long-window stats: note that `vpip` and `pfr` share the `hands` denominator,
  // so we decay `hands` once and apply the same factor to `vpip` and `pfr`.
  const deltaHands = Math.max(0, Number(increments.hands ?? 0));
  const handsHalfLife = Math.max(
    1,
    Number(halfLives?.pfr ?? halfLives?.vpip ?? RARE_STAT_HALF_LIFE_OPPS.pfr)
  );
  const handsFactor = deltaHands > 0 ? Math.pow(0.5, deltaHands / handsHalfLife) : 1;

  counters.hands = Math.max(0, Number(counters.hands ?? 0)) * handsFactor + deltaHands;
  counters.vpip = Math.min(
    counters.hands,
    Math.max(0, Number(counters.vpip ?? 0)) * handsFactor +
      Math.max(0, Number(increments.vpip ?? 0))
  );
  counters.pfr = Math.min(
    counters.hands,
    Math.max(0, Number(counters.pfr ?? 0)) * handsFactor + Math.max(0, Number(increments.pfr ?? 0))
  );

  // Remaining long-window opportunity-clocked stats
  for (const stat of EXPLOIT_STATS) {
    if (stat === 'vpip' || stat === 'pfr') continue;
    const [succField, oppField] = LONG_STAT_PAIRS[stat];
    const deltaOpp = Math.max(0, Number(increments[oppField] ?? 0));
    const deltaSucc = Math.max(0, Math.min(deltaOpp, Number(increments[succField] ?? 0)));
    const hl = Math.max(1, Number(halfLives?.[stat] ?? RARE_STAT_HALF_LIFE_OPPS[stat]));
    const factor = deltaOpp > 0 ? Math.pow(0.5, deltaOpp / hl) : 1;
    const nextOpp = Math.max(0, Number(counters[oppField] ?? 0)) * factor + deltaOpp;
    const nextSucc = Math.min(
      nextOpp,
      Math.max(0, Number(counters[succField] ?? 0)) * factor + deltaSucc
    );
    counters[oppField] = nextOpp;
    counters[succField] = nextSucc;
  }

  // Fast-window stats: `fPfr` uses `fHands`; others use their own `f*Opp`
  const deltaFastHands = Math.max(0, Number(increments.fHands ?? increments.hands ?? 0));
  const fastHandsHalfLife = Math.max(
    1,
    Number(fastHalfLives?.pfr ?? RARE_STAT_FAST_HALF_LIFE_OPPS.pfr ?? 8)
  );
  const fastHandsFactor =
    deltaFastHands > 0 ? Math.pow(0.5, deltaFastHands / fastHandsHalfLife) : 1;
  counters.fHands = Math.max(0, Number(counters.fHands ?? 0)) * fastHandsFactor + deltaFastHands;
  counters.fPfr = Math.min(
    counters.fHands,
    Math.max(0, Number(counters.fPfr ?? 0)) * fastHandsFactor +
      Math.max(0, Number(increments.fPfr ?? increments.pfr ?? 0))
  );

  for (const stat of EXPLOIT_STATS) {
    if (stat === 'pfr' || stat === 'vpip') continue;
    const pair = FAST_STAT_PAIRS[stat];
    if (!pair) continue;
    const [fSuccField, fOppField] = pair;
    const [longSuccField, longOppField] = LONG_STAT_PAIRS[stat];
    const deltaFastOpp = Math.max(
      0,
      Number(increments[fOppField] ?? increments[longOppField] ?? 0)
    );
    const deltaFastSucc = Math.max(
      0,
      Math.min(deltaFastOpp, Number(increments[fSuccField] ?? increments[longSuccField] ?? 0))
    );
    const fHl = Math.max(
      1,
      Number(fastHalfLives?.[stat] ?? RARE_STAT_FAST_HALF_LIFE_OPPS[stat] ?? 6)
    );
    const fFactor = deltaFastOpp > 0 ? Math.pow(0.5, deltaFastOpp / fHl) : 1;
    const nextFOpp = Math.max(0, Number(counters[fOppField] ?? 0)) * fFactor + deltaFastOpp;
    const nextFSucc = Math.min(
      nextFOpp,
      Math.max(0, Number(counters[fSuccField] ?? 0)) * fFactor + deltaFastSucc
    );
    counters[fOppField] = nextFOpp;
    counters[fSuccField] = nextFSucc;
  }
}

/**
 * Observe one completed hand's increments on an immutable `RareOpportunityRecordV2`
 * at deterministic timestamp `observedAtMs`.
 */
export function observeRareOpportunityHandV2(
  record: RareOpportunityRecordV2 | undefined,
  scope: ReadScope,
  increments: ExploitCounters,
  observedAtMs: number,
  decayOptions?: RareOpportunityDecayOptions
): RareOpportunityRecordV2 {
  if (!Number.isFinite(observedAtMs) || observedAtMs < 0) {
    throw new Error(`observeRareOpportunityHandV2: invalid observedAtMs ${String(observedAtMs)}`);
  }
  const base = record ?? createRareOpportunityRecordV2(scope, observedAtMs);
  if (base.modelVersion !== RARE_OPPORTUNITY_MODEL_VERSION) {
    throw new Error(
      `observeRareOpportunityHandV2: unsupported modelVersion ${String(base.modelVersion)}`
    );
  }
  const statMaxAgeMs = decayOptions?.statMaxAgeMs ?? DEFAULT_RARE_STAT_OPPORTUNITY_MAX_AGE_MS;
  const nextCounters: ExploitCounters = { ...base.counters };

  // Before applying the new hand's opportunity-clocked decay, expire any rare
  // statistic whose previous opportunity is older than `statMaxAgeMs` relative
  // to `observedAtMs`, so stale multi-hour old observations do not merge with
  // a brand-new session's opportunities.
  for (const stat of EXPLOIT_STATS) {
    if (stat === 'vpip' || stat === 'pfr') continue;
    const lastOppMs = base.lastOpportunityAtMs[stat];
    if (lastOppMs !== null && observedAtMs - lastOppMs > statMaxAgeMs) {
      const [succField, oppField] = LONG_STAT_PAIRS[stat];
      nextCounters[succField] = 0;
      nextCounters[oppField] = 0;
      const fastPair = FAST_STAT_PAIRS[stat];
      if (fastPair) {
        nextCounters[fastPair[0]] = 0;
        nextCounters[fastPair[1]] = 0;
      }
    }
  }

  decayByOpportunityAndAdd(nextCounters, increments, decayOptions);

  const nextLastOpp = { ...base.lastOpportunityAtMs };
  for (const stat of EXPLOIT_STATS) {
    const [, oppField] = LONG_STAT_PAIRS[stat];
    if (Number(increments[oppField] ?? 0) > 0) {
      const prev = nextLastOpp[stat];
      nextLastOpp[stat] = prev === null ? observedAtMs : Math.max(prev, observedAtMs);
    }
  }

  return Object.freeze({
    modelVersion: RARE_OPPORTUNITY_MODEL_VERSION,
    scope: base.scope,
    counters: nextCounters,
    firstObservedAtMs: Math.min(base.firstObservedAtMs, observedAtMs),
    lastObservedAtMs: Math.max(base.lastObservedAtMs, observedAtMs),
    totalHandsObserved: base.totalHandsObserved + (Number(increments.hands ?? 0) > 0 ? 1 : 0),
    lastOpportunityAtMs: Object.freeze(nextLastOpp),
  });
}

/**
 * Helper to observe a full hand action array for all players into a bounded
 * `Map<string, RareOpportunityRecordV2>` store with LRU eviction matching v1.
 */
export function observeRareOpportunityActionsV2(
  store: Map<string, RareOpportunityRecordV2>,
  scope: ReadScope,
  actions: readonly ExploitHandAction[] | undefined,
  observedAtMs: number,
  cap: number,
  decayOptions?: RareOpportunityDecayOptions
): void {
  const perPlayer = exploitHandIncrements(actions);
  for (const [playerId, inc] of perPlayer) {
    const key = `${scope}|${playerId}`;
    const existing = store.get(key);
    if (existing) {
      store.delete(key);
    } else if (store.size >= cap) {
      const target = Math.floor((cap - 1) * 0.75);
      for (const oldestKey of store.keys()) {
        if (store.size <= target) break;
        store.delete(oldestKey);
      }
    }
    const updated = observeRareOpportunityHandV2(existing, scope, inc, observedAtMs, decayOptions);
    store.set(key, updated);
  }
}

/**
 * Evaluate a `RareOpportunityRecordV2` at deterministic cutoff `options.asOfMs`.
 *
 * - If `record` is absent or has 0 hands, returns `status: 'empty'`.
 * - If `asOfMs - record.lastObservedAtMs > maxAgeMs`, returns
 *   `status: 'expired_record'` with `read: null` and zeroed `effectiveCounters`.
 * - For any individual statistic whose `lastOpportunityAtMs[stat]` is older
 *   than `statMaxAgeMs` (`asOfMs - lastOpp > statMaxAgeMs`), zeroes that
 *   statistic's long and fast counters in `effectiveCounters` and lists `stat`
 *   in `expiredStats` before delegating posterior evaluation to
 *   `opponentExploitRead`.
 */
export function evaluateRareOpportunityReadV2(
  record: RareOpportunityRecordV2 | null | undefined,
  options: RareOpportunityReadOptions
): RareOpportunityReadResultV2 {
  const {
    asOfMs,
    maxAgeMs = DEFAULT_RARE_OPPORTUNITY_MAX_AGE_MS,
    statMaxAgeMs = DEFAULT_RARE_STAT_OPPORTUNITY_MAX_AGE_MS,
    variant = null,
    corroborating = [],
  } = options;

  if (!Number.isFinite(asOfMs) || asOfMs < 0 || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0) {
    return Object.freeze({
      modelVersion: RARE_OPPORTUNITY_MODEL_VERSION,
      status: 'invalid_clock',
      read: null,
      effectiveCounters: freshExploitCounters(),
      expiredStats: Object.freeze([]),
      recordAgeMs: null,
    });
  }

  if (!record || !(record.counters.hands > 0)) {
    return Object.freeze({
      modelVersion: RARE_OPPORTUNITY_MODEL_VERSION,
      status: 'empty',
      read: null,
      effectiveCounters: freshExploitCounters(),
      expiredStats: Object.freeze([]),
      recordAgeMs: null,
    });
  }

  const recordAgeMs = Math.max(0, asOfMs - record.lastObservedAtMs);
  if (recordAgeMs > maxAgeMs) {
    return Object.freeze({
      modelVersion: RARE_OPPORTUNITY_MODEL_VERSION,
      status: 'expired_record',
      read: null,
      effectiveCounters: freshExploitCounters(),
      expiredStats: Object.freeze([...EXPLOIT_STATS]),
      recordAgeMs,
    });
  }

  const effectiveCounters: ExploitCounters = { ...record.counters };
  const expiredStats: ExploitStat[] = [];

  for (const stat of EXPLOIT_STATS) {
    if (stat === 'vpip' || stat === 'pfr') continue;
    const lastOppMs = record.lastOpportunityAtMs[stat];
    if (lastOppMs !== null && asOfMs - lastOppMs > statMaxAgeMs) {
      expiredStats.push(stat);
      const [succField, oppField] = LONG_STAT_PAIRS[stat];
      effectiveCounters[succField] = 0;
      effectiveCounters[oppField] = 0;
      const fastPair = FAST_STAT_PAIRS[stat];
      if (fastPair) {
        effectiveCounters[fastPair[0]] = 0;
        effectiveCounters[fastPair[1]] = 0;
      }
    }
  }

  const read = opponentExploitRead(effectiveCounters, record.scope, variant, corroborating);
  return Object.freeze({
    modelVersion: RARE_OPPORTUNITY_MODEL_VERSION,
    status: 'active',
    read,
    effectiveCounters,
    expiredStats: Object.freeze(expiredStats),
    recordAgeMs,
  });
}

/**
 * Versioned JSON serialization for cache / read-frame / SQL persistence.
 */
export function serializeRareOpportunityRecordV2(record: RareOpportunityRecordV2): string {
  if (!record || record.modelVersion !== RARE_OPPORTUNITY_MODEL_VERSION) {
    throw new Error('serializeRareOpportunityRecordV2: invalid v2 record');
  }
  return JSON.stringify(record);
}

/**
 * Versioned JSON deserialization that strictly validates `modelVersion` and
 * numerator/denominator bounds, returning `null` for v1 or malformed payloads.
 */
export function deserializeRareOpportunityRecordV2(
  raw: string | unknown
): RareOpportunityRecordV2 | null {
  try {
    const parsed =
      typeof raw === 'string'
        ? (JSON.parse(raw) as Record<string, unknown>)
        : (raw as Record<string, unknown>);
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.modelVersion !== RARE_OPPORTUNITY_MODEL_VERSION) return null;
    if (typeof parsed.scope !== 'string' || !parsed.scope.includes(':')) return null;
    if (
      typeof parsed.firstObservedAtMs !== 'number' ||
      !Number.isFinite(parsed.firstObservedAtMs) ||
      typeof parsed.lastObservedAtMs !== 'number' ||
      !Number.isFinite(parsed.lastObservedAtMs) ||
      typeof parsed.totalHandsObserved !== 'number' ||
      !Number.isFinite(parsed.totalHandsObserved)
    ) {
      return null;
    }
    const rawCounters = parsed.counters as Record<string, unknown> | undefined;
    const rawLastOpp = parsed.lastOpportunityAtMs as Record<string, unknown> | undefined;
    if (
      !rawCounters ||
      typeof rawCounters !== 'object' ||
      !rawLastOpp ||
      typeof rawLastOpp !== 'object'
    ) {
      return null;
    }
    const counters = freshExploitCounters();
    for (const key of Object.keys(counters) as (keyof ExploitCounters)[]) {
      const v = Number(rawCounters[key]);
      if (!Number.isFinite(v) || v < 0) return null;
      counters[key] = v;
    }
    const lastOpportunityAtMs = {} as Record<ExploitStat, number | null>;
    for (const stat of EXPLOIT_STATS) {
      const [succField, oppField] = LONG_STAT_PAIRS[stat];
      if (counters[succField] > counters[oppField] + 1e-9) return null;
      counters[succField] = Math.min(counters[succField], counters[oppField]);
      const ts = rawLastOpp[stat];
      if (ts === null || ts === undefined) {
        lastOpportunityAtMs[stat] = null;
      } else if (typeof ts === 'number' && Number.isFinite(ts) && ts >= 0) {
        lastOpportunityAtMs[stat] = ts;
      } else {
        return null;
      }
    }
    return Object.freeze({
      modelVersion: RARE_OPPORTUNITY_MODEL_VERSION,
      scope: parsed.scope as ReadScope,
      counters,
      firstObservedAtMs: parsed.firstObservedAtMs,
      lastObservedAtMs: parsed.lastObservedAtMs,
      totalHandsObserved: parsed.totalHandsObserved,
      lastOpportunityAtMs: Object.freeze(lastOpportunityAtMs),
    });
  } catch {
    return null;
  }
}
