/**
 * SPOT-CONDITIONED HUMAN-FIELD EVALUATION (2026-11-06).
 *
 * Some layers change one decision in a spot the ordinary card almost never
 * deals. V55 (v55OmahaRiverTripsFlat) changes only a river Omaha decision
 * holding weak trips, and the horse mirror reached it in 2 of 30,000 pairs:
 * no number of nightly runs can measure that. This evaluator deals the same
 * duplicate pairs the human-field card deals (playHand, same seed schedule,
 * same hero seat, same human-calibrated opponents, arm A then arm B on the
 * identical deal) but PLAYS only the deals whose cards can reach the spot.
 *
 * Why skipping deals is unbiased: the two arms differ only in the hero's
 * flag, and the flag's gate needs the hero's FINAL hand (hole cards plus the
 * whole board, both fixed by the deal) to be trips. A deal where the hero's
 * river hand is not trips plays byte-identical poker in both arms, so its
 * paired difference is exactly zero. The skipped deals contribute zero, the
 * conditioned mean is the effect inside the class, and the per-hand effect
 * over all deals is that mean times the class rate. The test file proves the
 * zero-difference claim on skipped deals instead of assuming it.
 *
 * Development measurement only: the Omaha field is the human-calibrated
 * Omaha profile under HUMAN_CALIBRATED_OMAHA_DEV_POPULATION_ID, which misses
 * its flop facing-bet fidelity criterion. Never on the nightly card.
 */
import type { Card } from '../types.js';
import type { HorseDecideOpts, HorseProfileMods } from '../engine/HorseLogic.js';
import { HorseMind } from '../engine/HorseMind.js';
import {
  seedFastRandom,
  saveFastRandom,
  restoreFastRandom,
  fastRandom,
  variantInfo,
  omahaMadeClass,
} from '../engine/HorseEval.js';
import { SUITS, RANKS } from '../engine/PokerEngine.js';
import {
  playHand,
  leagueFieldVariants,
  HUMAN_FIELD_HERO_SEAT,
  type LeagueHumanField,
  type LeagueOpponentPopulation,
} from './HorseLeague.js';

const BB = 2;
const FULL_DECK: Card[] = [];
for (const suit of SUITS) for (const rank of RANKS) FULL_DECK.push({ rank, suit });

/** The cards playHand deals for a seed: same Fisher-Yates on fastRandom. */
export function leagueDealFor(
  handSeed: number,
  numSeats: number,
  gameVariant: string
): { holes: Card[][]; board: Card[] } {
  const holeCount = variantInfo(gameVariant).holeCount;
  const saved = saveFastRandom();
  seedFastRandom(handSeed);
  const deck = [...FULL_DECK];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(fastRandom() * (i + 1));
    const tmp = deck[i];
    deck[i] = deck[j];
    deck[j] = tmp;
  }
  restoreFastRandom(saved);
  const holes: Card[][] = [];
  for (let s = 0; s < numSeats; s++) holes.push(deck.slice(s * holeCount, (s + 1) * holeCount));
  return { holes, board: deck.slice(numSeats * holeCount, numSeats * holeCount + 5) };
}

/** Deal classes an evaluation may condition on. */
export type LeagueDealCondition = 'omaha_river_trips';

/**
 * omaha_river_trips: the hero's final Omaha hand is three of a kind (made
 * category 4). V55's gate is the weak subset of this class (trips through a
 * board pair, or a set on a straight- or flush-possible board), so the class
 * is a superset of every deal V55 can change.
 */
export function dealMeetsCondition(
  condition: LeagueDealCondition,
  hole: Card[],
  board: Card[]
): boolean {
  if (condition === 'omaha_river_trips') return omahaMadeClass(hole, board).category === 4;
  throw new Error(`Unknown deal condition ${String(condition)}`);
}

export interface SpotConditionedMatchup {
  name: string;
  variant: string;
  seats?: number;
  stackBB?: number;
  a: HorseDecideOpts;
  b: HorseDecideOpts;
  modsA?: HorseProfileMods;
  modsB?: HorseProfileMods;
  opponentPopulation: LeagueOpponentPopulation;
  condition: LeagueDealCondition;
}

export interface SpotConditionedResult {
  name: string;
  /** Deals examined (seed schedule positions). */
  scannedDeals: number;
  /** Deals in the class, each played once per arm. */
  conditionedPairs: number;
  /** conditionedPairs / scannedDeals. */
  classRate: number;
  divergentPairs: number;
  /** Hero edge of A over B per 100 hero hands INSIDE the class. */
  conditionedBb100: number;
  conditionedStderr: number;
  /** The same edge per 100 hero hands over ALL deals (x classRate). */
  bb100: number;
  stderr: number;
  /** Per-divergent-pair mean edge in bb (what one changed decision is worth). */
  perDivergentPairBb: number;
  illegalActions: number;
  truncatedStreets: number;
  durationMs: number;
}

/**
 * Plays `pairs` in-class duplicate pairs (or stops at `maxScan` deals) on the
 * human-field schedule: handSeed = (runSeed ^ (p * 2654435761)) >>> 0 || 1,
 * dealer = p % seats + 1, hero at HUMAN_FIELD_HERO_SEAT, exactly as
 * runHumanFieldMatchup deals position p.
 */
export function runSpotConditionedMatchup(
  m: SpotConditionedMatchup,
  pairs: number,
  runSeed: number,
  maxScan: number = pairs * 1000
): SpotConditionedResult {
  const variants = leagueFieldVariants(m.opponentPopulation);
  if (!variants || !variants.includes(m.variant)) {
    throw new Error(`${m.name}: ${m.opponentPopulation} cannot deal ${m.variant}`);
  }
  const SEATS = m.seats ?? 6;
  const HERO = HUMAN_FIELD_HERO_SEAT;
  const stackBB = m.stackBB ?? 100;
  const t0 = Date.now();
  const counters = { illegal: 0, truncated: 0 };
  const field: LeagueHumanField = {
    population: m.opponentPopulation,
    isHuman: (s) => s !== HERO,
  };
  const rngBefore = saveFastRandom();
  const sb1 = HorseMind.createSandbox();
  const sb2 = HorseMind.createSandbox();
  const diffs: number[] = [];
  let divergent = 0;
  let scanned = 0;
  try {
    for (let p = 0; p < maxScan && diffs.length < pairs; p++) {
      scanned++;
      const handSeed = (runSeed ^ (p * 2654435761)) >>> 0 || 1;
      const dealerSeat = (p % SEATS) + 1;
      const deal = leagueDealFor(handSeed, SEATS, m.variant);
      if (!dealMeetsCondition(m.condition, deal.holes[HERO], deal.board)) continue;
      const play = (opts: HorseDecideOpts, mods: HorseProfileMods, sb: typeof sb1) =>
        playHand(
          handSeed,
          dealerSeat,
          () => opts,
          counters,
          sb,
          m.variant,
          SEATS,
          stackBB,
          undefined,
          () => mods,
          field
        )[HERO];
      const a = play(m.a, m.modsA ?? {}, sb1);
      const b = play(m.b, m.modsB ?? {}, sb2);
      diffs.push((a - b) / BB);
      if (a !== b) divergent++;
    }
  } finally {
    restoreFastRandom(rngBefore);
  }
  const n = diffs.length;
  const mean = diffs.reduce((s, x) => s + x, 0) / Math.max(1, n);
  const v = diffs.reduce((s, x) => s + (x - mean) * (x - mean), 0) / Math.max(1, n - 1);
  const se = Math.sqrt(v) / Math.sqrt(Math.max(1, n));
  const rate = scanned > 0 ? n / scanned : 0;
  return {
    name: m.name,
    scannedDeals: scanned,
    conditionedPairs: n,
    classRate: rate,
    divergentPairs: divergent,
    conditionedBb100: mean * 100,
    conditionedStderr: se * 100,
    bb100: mean * 100 * rate,
    stderr: se * 100 * rate,
    perDivergentPairBb: divergent > 0 ? (mean * n) / divergent : 0,
    illegalActions: counters.illegal,
    truncatedStreets: counters.truncated,
    durationMs: Date.now() - t0,
  };
}
