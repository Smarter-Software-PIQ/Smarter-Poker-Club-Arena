/**
 * THE BASELINE RIVER BLUFF RANGE, MEASURED (2026-11-07)
 *
 * #9803 shipped `riverBluffBaseline` (HorseRiverBluffRange.ts) default on
 * with no league measurement and no duplicate-deal ablation. This is that
 * measurement: one hero horse at a six-handed table, arm A = production
 * (baseline on), arm B = `riverBluffBaseline: false`, every other seat
 * identical in both passes.
 *
 *  - DUPLICATE DEALS. Each pair replays one deal seed twice: same cards, same
 *    dealer, same hero seat, same field. Only the hero's flag differs, so card
 *    luck cancels in (A net - B net) and the paired standard error is the CI.
 *    One HorseMind sandbox per arm lives for the whole cell, so the hero's
 *    reads of the field (station, river fold rate) and the field horses'
 *    reads of the hero develop exactly as at a live table.
 *  - OPPONENT POOLS (the field around the hero):
 *      standard  - five production horses (the Hybrid profile and the default
 *                  brain for this game mode; HORSES ARE PLAYERS, so the same
 *                  brain the hero faces in production),
 *      stations  - the human-calibrated population with its facing-bet fold
 *                  cutoffs lowered (calls almost every river),
 *      folders   - the same population with its fold cutoffs raised (an
 *                  over-folder: gives up most one-pair hands to a river bet),
 *      mixed     - horse, calibrated human, station, over-folder, horse.
 *    The scripted seats read only their own cards and the public state (the
 *    calibrated population's own contract) and are seated as humans; the
 *    hero has no idea which is which and branches on nothing but observed
 *    play.
 *  - FORMATS: cash (100bb) and tournament chip EV (40bb, mid-MTT, big-blind
 *    ante, outside the bubble).
 *
 * The cell reports bb/100 per arm and the paired difference with its standard
 * error, river betting and showdown frequencies per arm, and for the bluffs
 * the baseline itself placed (its `river_bluff_baseline_*` receipt on the
 * decision) how often the opponent folded against the break-even fold share
 * of the size bet.
 *
 * Measurement plumbing only: no production caller, no database, no writer.
 * HorseLeague's playHand is the street engine, validation and settlement;
 * this file adds nothing to how a hand is played.
 */
import type { Card } from '../types.js';
import type { HorseDecideOpts, HorseProfileMods } from '../engine/HorseLogic.js';
import type { HorseStyle } from '../types.js';
import { HORSE_HYBRID_PROFILES } from '../engine/HorseHybridProfile.js';
import { HorseMind, type HorseMindSandbox } from '../engine/HorseMind.js';
import {
  restoreFastRandom,
  saveFastRandom,
  scoreHoldem,
  scoreOmahaHi,
  variantInfo,
} from '../engine/HorseEval.js';
import { drainFires } from '../engine/BrainTelemetry.js';
import { RANK_VALUES } from '../engine/PokerEngine.js';
import {
  HUMAN_CALIBRATED_POPULATION_ID,
  humanCalibratedProfileFor,
  type HumanCalibratedProfile,
} from './HumanCalibratedPopulation.js';
import { HUMAN_CALIBRATED_OMAHA_DEV_POPULATION_ID } from './HorseLeagueHumanField.js';
import {
  playHand,
  type LeagueGameContext,
  type LeagueHandObserver,
  type LeagueHumanField,
} from './HorseLeague.js';

export const RBLM_VARIANTS = ['nlh', 'plo4', 'plo5', 'plo6'] as const;
export type RblmVariant = (typeof RBLM_VARIANTS)[number];
export const RBLM_POOLS = ['standard', 'stations', 'folders', 'mixed'] as const;
export type RblmPool = (typeof RBLM_POOLS)[number];
export const RBLM_FORMATS = ['cash', 'tournament'] as const;
export type RblmFormat = (typeof RBLM_FORMATS)[number];

/** Six-handed is the production shape. Heads-up (2) concentrates the spot the
 *  baseline owns - every river is heads-up - so a per-spot verdict needs far
 *  fewer hands; it is reported separately, never pooled with six-handed. */
export const RBLM_SEATS = 6;
export type RblmSeats = 2 | 6;
export const RBLM_HERO_SEAT = 0;
const BB = 2;

/** Arm A is production; arm B ablates the baseline. Nothing else differs. */
export const RBLM_ARMS: Readonly<{ a: HorseDecideOpts; b: HorseDecideOpts }> = Object.freeze({
  a: {},
  b: { riverBluffBaseline: false },
});

/** Facing-bet fold cutoffs (equity against one random holding) that turn the
 *  calibrated population into a station or an over-folder. Raise and
 *  checked-to cutoffs keep the calibrated values. */
export const RBLM_TENDENCY_CUTOFFS = Object.freeze({
  stations: Object.freeze({ flop: 0.25, turn: 0.25, river: 0.12 }),
  folders: Object.freeze({ flop: 0.6, turn: 0.7, river: 0.8 }),
});

export function rblmTendencyProfile(
  variant: string,
  tendency: 'stations' | 'folders'
): Readonly<HumanCalibratedProfile> {
  const base = humanCalibratedProfileFor(variant);
  const c = RBLM_TENDENCY_CUTOFFS[tendency];
  const cutoffs = { ...(base.cutoffs ?? {}) };
  for (const street of ['flop', 'turn', 'river'] as const) {
    const node = `${street}/facing_bet` as const;
    cutoffs[node] = { ...(cutoffs[node] ?? {}), fold: c[street] };
  }
  return Object.freeze({ ...base, id: `${base.id}-rblm-${tendency}`, cutoffs });
}

/** What sits in field seat s (1..5) for each pool. */
export type RblmSeatKind = 'horse' | 'calibrated' | 'stations' | 'folders';
export function rblmSeatKind(
  pool: RblmPool,
  seatIdx: number,
  seats: RblmSeats = 6,
  pairIdx = 0
): RblmSeatKind | 'hero' {
  if (seatIdx === RBLM_HERO_SEAT) return 'hero';
  if (pool === 'standard') return 'horse';
  if (pool === 'stations') return 'stations';
  if (pool === 'folders') return 'folders';
  // Heads-up the one opponent rotates through the mixed field by deal.
  if (seats === 2) return (['horse', 'calibrated', 'stations', 'folders'] as const)[pairIdx % 4];
  return (['horse', 'calibrated', 'stations', 'folders', 'horse'] as const)[(seatIdx - 1) % 5];
}

export function rblmContext(format: RblmFormat): { context: LeagueGameContext; stackBB: number } {
  if (format === 'cash')
    return { context: { gameMode: 'cash', format: 'cash', ante: 0 }, stackBB: 100 };
  return {
    stackBB: 40,
    context: {
      gameMode: 'tournament',
      format: 'mtt',
      ante: BB,
      bigBlindAnte: true,
      tournament: { playersLeft: 60, spotsPaid: 12, avgStackChips: 80 },
    },
  };
}

export interface RblmArmStats {
  hands: number;
  netBB: number;
  /** hero reached showdown */
  showdowns: number;
  /** hero won at showdown */
  showdownWins: number;
  /** river spots with nothing to call where the hero acted */
  riverCheckedTo: number;
  /** river bets/shoves from those spots */
  riverBets: number;
  /** ... of which with a weak hand (Hold'em: high card or a board pair;
   *  Omaha: one pair or less) */
  riverWeakBets: number;
  riverBetsFolded: number;
  riverWeakBetsFolded: number;
  riverBetsShowdown: number;
  riverWeakBetsShowdown: number;
  /** bets carrying the baseline's own receipt */
  baselineBluffs: number;
  baselineBluffsFolded: number;
  /** sum of size/pot for baseline bluffs, and of the break-even fold share */
  baselineSizeSum: number;
  baselineBreakEvenSum: number;
  /** net bb of the hands containing a baseline bluff */
  baselineBluffNetBB: number;
  /** baseline eligible spots that checked */
  baselineChecks: number;
  /** Skill measurement (RblmCellOptions.skillFeatures): hands in which the
   *  hero fired one of the skill's acting features, how many of those the
   *  field folded to (hero live, hand ended by folds), their net bb, and every
   *  hero fire of a feature with one of the skill's prefixes, by name. */
  skillHands: number;
  skillFolded: number;
  skillNetBB: number;
  skillFires: Record<string, number>;
}

/** Optional generalisation (2026-11-07, Item 25 qualification of the dormant
 *  river skills): the same duplicate-deal cell with any two arms, and the
 *  telemetry features that mark the skill acting. Omitted: the baseline
 *  measurement exactly as #9841 ran it. */
export interface RblmCellOptions {
  arms?: Readonly<{ a: HorseDecideOpts; b: HorseDecideOpts }>;
  /** fire names that mean the skill acted this hand */
  skillFeatures?: readonly string[];
  /** fire-name prefixes counted into skillFires */
  skillPrefixes?: readonly string[];
}

export interface RblmCellResult {
  variant: RblmVariant;
  format: RblmFormat;
  pool: RblmPool;
  seats: RblmSeats;
  pairs: number;
  seed: number;
  /** paired difference (A - B), bb/100 hero hands, with its standard error */
  bb100: number;
  stderr: number;
  /** 95% interval: bb100 +/- 1.96 stderr */
  ci95: [number, number];
  divergentPairs: number;
  armA: RblmArmStats & { bb100: number; se: number };
  armB: RblmArmStats & { bb100: number; se: number };
  /** field seats' response to a hero river bet: folds / responses */
  fieldRiverFoldA: number;
  illegalActions: number;
  truncatedStreets: number;
  brainExceptionFallbacks: number;
  durationMs: number;
}

function emptyArm(): RblmArmStats {
  return {
    hands: 0,
    netBB: 0,
    showdowns: 0,
    showdownWins: 0,
    riverCheckedTo: 0,
    riverBets: 0,
    riverWeakBets: 0,
    riverBetsFolded: 0,
    riverWeakBetsFolded: 0,
    riverBetsShowdown: 0,
    riverWeakBetsShowdown: 0,
    baselineBluffs: 0,
    baselineBluffsFolded: 0,
    baselineSizeSum: 0,
    baselineBreakEvenSum: 0,
    baselineBluffNetBB: 0,
    baselineChecks: 0,
    skillHands: 0,
    skillFolded: 0,
    skillNetBB: 0,
    skillFires: {},
  };
}

/** Hold'em: high card, or one pair made only by the board. Omaha: one pair or less. */
export function rblmWeakHand(hole: Card[], board: Card[], variant: string): boolean {
  const vi = variantInfo(variant);
  if (vi.isOmaha) return Math.floor(scoreOmahaHi(hole, board) / 0x100000) <= 2;
  const cat = Math.floor(scoreHoldem(hole.concat(board), hole.length + 5, false) / 0x100000);
  if (cat <= 1) return true;
  if (cat !== 2) return false;
  if (hole.length === 2 && hole[0].rank === hole[1].rank) return false;
  const boardRanks = new Set(board.map((c) => RANK_VALUES[c.rank]));
  return !hole.some((c) => boardRanks.has(RANK_VALUES[c.rank]));
}

interface HandTrace {
  riverBet: null | {
    weak: boolean;
    baseline: boolean;
    sizeFrac: number;
    foldedOut: boolean;
  };
  baselineCheck: boolean;
  fieldResponses: number;
  fieldFolds: number;
}

function playArm(
  arm: HorseDecideOpts,
  sandbox: HorseMindSandbox,
  handSeed: number,
  dealerSeat: number,
  variant: RblmVariant,
  format: RblmFormat,
  pool: RblmPool,
  counters: { illegal: number; truncated: number; brainFallback?: number },
  stats: RblmArmStats,
  seats: RblmSeats,
  pairIdx: number,
  skill: RblmCellOptions = {}
): { net: number; trace: HandTrace } {
  const { context, stackBB } = rblmContext(format);
  const hybrid = HORSE_HYBRID_PROFILES[format === 'tournament' ? 'tournament' : 'cash'];
  const kinds = Array.from({ length: seats }, (_, s) => rblmSeatKind(pool, s, seats, pairIdx));
  const stations = rblmTendencyProfile(variant, 'stations');
  const folders = rblmTendencyProfile(variant, 'folders');
  const scripted = (s: number) =>
    kinds[s] === 'calibrated' || kinds[s] === 'stations' || kinds[s] === 'folders';
  const field: LeagueHumanField | undefined = kinds.some((k, s) => scripted(s) && k !== 'hero')
    ? {
        population:
          variant === 'nlh'
            ? HUMAN_CALIBRATED_POPULATION_ID
            : HUMAN_CALIBRATED_OMAHA_DEV_POPULATION_ID,
        isHuman: scripted,
        profileOf: (s) =>
          kinds[s] === 'stations' ? stations : kinds[s] === 'folders' ? folders : undefined,
      }
    : undefined;
  const trace: HandTrace = {
    riverBet: null,
    baselineCheck: false,
    fieldResponses: 0,
    fieldFolds: 0,
  };
  let heroRiverBetPending = false;
  let heroCards: Card[] = [];
  let skillActed = false;
  const skillFeatures = skill.skillFeatures ?? [];
  const skillPrefixes = skill.skillPrefixes ?? [];
  const observer: LeagueHandObserver = {
    onAction: (e) => {
      if (e.seatIdx === RBLM_HERO_SEAT) {
        const fires = drainFires();
        for (const f of fires) {
          if (skillFeatures.includes(f.feature)) skillActed = true;
          if (skillPrefixes.some((x) => f.feature.startsWith(x)))
            stats.skillFires[f.feature] = (stats.skillFires[f.feature] ?? 0) + 1;
        }
        const baselineBet = fires.some(
          (f) =>
            f.feature.startsWith('river_bluff_baseline_') &&
            f.feature !== 'river_bluff_baseline_check' &&
            f.feature !== 'river_bluff_baseline_illegal' &&
            !f.feature.startsWith('river_bluff_baseline_skip_')
        );
        if (fires.some((f) => f.feature === 'river_bluff_baseline_check'))
          trace.baselineCheck = true;
        if (e.stage === 'river' && e.toCall === 0) {
          stats.riverCheckedTo++;
          if (e.action === 'bet' || e.action === 'raise' || e.action === 'all_in') {
            trace.riverBet = {
              weak: false,
              baseline: baselineBet,
              sizeFrac: e.pot > 0 ? e.amount / e.pot : 0,
              foldedOut: false,
            };
            heroRiverBetPending = true;
          }
        }
      } else if (heroRiverBetPending && e.stage === 'river') {
        trace.fieldResponses++;
        if (e.action === 'fold') trace.fieldFolds++;
      }
    },
    onEnd: (e) => {
      heroCards = e.cards[RBLM_HERO_SEAT];
      const heroLive = !e.folded[RBLM_HERO_SEAT];
      const showdown = heroLive && !e.endedByFolds;
      if (showdown) {
        stats.showdowns++;
        if (e.net[RBLM_HERO_SEAT] > 0) stats.showdownWins++;
      }
      if (trace.riverBet) {
        trace.riverBet.weak = rblmWeakHand(heroCards, e.board, variant);
        trace.riverBet.foldedOut = heroLive && e.endedByFolds;
        const rb = trace.riverBet;
        stats.riverBets++;
        if (rb.foldedOut) stats.riverBetsFolded++;
        if (showdown) stats.riverBetsShowdown++;
        if (rb.weak) {
          stats.riverWeakBets++;
          if (rb.foldedOut) stats.riverWeakBetsFolded++;
          if (showdown) stats.riverWeakBetsShowdown++;
        }
        if (rb.baseline) {
          stats.baselineBluffs++;
          if (rb.foldedOut) stats.baselineBluffsFolded++;
          stats.baselineSizeSum += rb.sizeFrac;
          stats.baselineBreakEvenSum += rb.sizeFrac / (1 + rb.sizeFrac);
          stats.baselineBluffNetBB += e.net[RBLM_HERO_SEAT] / BB;
        }
      }
      if (trace.baselineCheck) stats.baselineChecks++;
      if (skillActed) {
        stats.skillHands++;
        if (heroLive && e.endedByFolds) stats.skillFolded++;
        stats.skillNetBB += e.net[RBLM_HERO_SEAT] / BB;
      }
    },
  };
  drainFires();
  const net = playHand(
    handSeed,
    dealerSeat,
    (s) => (s === RBLM_HERO_SEAT ? { ...arm, telemetry: true } : { telemetry: false }),
    counters,
    sandbox,
    variant,
    seats,
    stackBB,
    context,
    () => ({ ...hybrid.mods }) as HorseProfileMods,
    field,
    (): HorseStyle => hybrid.style,
    true,
    observer
  )[RBLM_HERO_SEAT];
  stats.hands++;
  stats.netBB += net / BB;
  return { net, trace };
}

const meanSe = (xs: number[]): { mean: number; se: number } => {
  const n = Math.max(1, xs.length);
  const m = xs.reduce((s, x) => s + x, 0) / n;
  const v = xs.reduce((s, x) => s + (x - m) * (x - m), 0) / Math.max(1, xs.length - 1);
  return { mean: m, se: Math.sqrt(v / n) };
};

/** One duplicate-dealt cell: `pairs` deals, each played by arm A then arm B. */
export async function runRiverBluffBaselineCell(
  variant: RblmVariant,
  format: RblmFormat,
  pool: RblmPool,
  pairs: number,
  seed: number,
  seats: RblmSeats = RBLM_SEATS,
  options: RblmCellOptions = {}
): Promise<RblmCellResult> {
  const arms = options.arms ?? RBLM_ARMS;
  const t0 = Date.now();
  const counters: { illegal: number; truncated: number; brainFallback?: number } = {
    illegal: 0,
    truncated: 0,
  };
  const sbA = HorseMind.createSandbox();
  const sbB = HorseMind.createSandbox();
  const a = emptyArm();
  const b = emptyArm();
  const diff: number[] = [];
  const netsA: number[] = [];
  const netsB: number[] = [];
  let divergent = 0;
  let fieldResp = 0;
  let fieldFolds = 0;
  const rng = saveFastRandom();
  try {
    for (let p = 0; p < pairs; p++) {
      if (p > 0 && (p & 0x0f) === 0) await new Promise((res) => setImmediate(res));
      const handSeed = (seed ^ (p * 2654435761)) >>> 0 || 1;
      const dealerSeat = (p % seats) + 1;
      const ra = playArm(
        arms.a,
        sbA,
        handSeed,
        dealerSeat,
        variant,
        format,
        pool,
        counters,
        a,
        seats,
        p,
        options
      );
      const rb = playArm(
        arms.b,
        sbB,
        handSeed,
        dealerSeat,
        variant,
        format,
        pool,
        counters,
        b,
        seats,
        p,
        options
      );
      if (ra.trace.riverBet) {
        fieldResp += ra.trace.fieldResponses;
        fieldFolds += ra.trace.fieldFolds;
      }
      netsA.push(ra.net / BB);
      netsB.push(rb.net / BB);
      diff.push((ra.net - rb.net) / BB);
      if (ra.net !== rb.net) divergent++;
    }
  } finally {
    restoreFastRandom(rng);
  }
  const d = meanSe(diff);
  const sa = meanSe(netsA);
  const sb = meanSe(netsB);
  const bb100 = d.mean * 100;
  const stderr = d.se * 100;
  return {
    variant,
    format,
    pool,
    seats,
    pairs,
    seed,
    bb100,
    stderr,
    ci95: [bb100 - 1.96 * stderr, bb100 + 1.96 * stderr],
    divergentPairs: divergent,
    armA: { ...a, bb100: sa.mean * 100, se: sa.se * 100 },
    armB: { ...b, bb100: sb.mean * 100, se: sb.se * 100 },
    fieldRiverFoldA: fieldResp > 0 ? fieldFolds / fieldResp : 0,
    illegalActions: counters.illegal,
    truncatedStreets: counters.truncated,
    brainExceptionFallbacks: counters.brainFallback ?? 0,
    durationMs: Date.now() - t0,
  };
}
