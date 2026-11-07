/**
 * TWO UNSELECTED RIVER SKILLS, MEASURED (2026-11-07, Decision Readiness item 25)
 *
 * `riverPositionDefense` and `smallPotNearNutRiverValue` are feature-authority
 * candidates that production keeps unselected (HorseFeatureAuthority.ts). This
 * is the duplicate-deal measurement of each against current main, on the
 * method of RiverBluffBaselineLeague.ts (#9841): one hero horse, arm A = the
 * production brain with the one candidate flag true, arm B = the production
 * brain unchanged (the flag absent, which is false). Every other seat is
 * identical in both passes and only the hero's flag differs.
 *
 *  - Same deals, dealer and seats in both arms, one HorseMind sandbox per arm
 *    for the whole cell, so reads form exactly as at a live table.
 *  - Pools are RiverBluffBaselineLeague's (standard / stations / folders /
 *    mixed) plus `aggressors`: the human-calibrated population widened
 *    preflop and betting most streets it is checked to. That is the player
 *    the defense was written for (the owner report of players who bet rivers
 *    far too often after a check), so the candidate is measured where it is
 *    meant to act, as well as everywhere it must not cost anything.
 *  - Field seats read only their own cards and the public state; the hero
 *    branches on nothing but observed play.
 *
 * The cell reports the paired difference with its standard error, how often
 * each candidate evaluated and acted (its own receipts), and for the acts the
 * outcome: a defense call won or lost at showdown, a value raise called,
 * folded to, or re-raised.
 *
 * Measurement plumbing only: no production caller, no database, no writer.
 */
import type { HorseStyle } from '../types.js';
import type { HorseDecideOpts, HorseProfileMods } from '../engine/HorseLogic.js';
import { HORSE_HYBRID_PROFILES } from '../engine/HorseHybridProfile.js';
import { HorseMind, type HorseMindSandbox } from '../engine/HorseMind.js';
import { restoreFastRandom, saveFastRandom } from '../engine/HorseEval.js';
import { drainFires } from '../engine/BrainTelemetry.js';
import {
  HUMAN_CALIBRATED_POPULATION_ID,
  humanCalibratedProfileFor,
  type HumanCalibratedProfile,
} from './HumanCalibratedPopulation.js';
import { HUMAN_CALIBRATED_OMAHA_DEV_POPULATION_ID } from './HorseLeagueHumanField.js';
import { playHand, type LeagueHandObserver, type LeagueHumanField } from './HorseLeague.js';
import {
  RBLM_HERO_SEAT,
  rblmContext,
  rblmTendencyProfile,
  type RblmFormat,
  type RblmSeats,
  type RblmVariant,
} from './RiverBluffBaselineLeague.js';

export const RVDL_SKILLS = ['riverPositionDefense', 'smallPotNearNutRiverValue'] as const;
export type RvdlSkill = (typeof RVDL_SKILLS)[number];
export const RVDL_POOLS = ['standard', 'stations', 'folders', 'mixed', 'aggressors'] as const;
export type RvdlPool = (typeof RVDL_POOLS)[number];
const BB = 2;

/** Arm A turns exactly one candidate on; arm B is production unchanged. */
export function rvdlArms(skill: RvdlSkill): { a: HorseDecideOpts; b: HorseDecideOpts } {
  return { a: { [skill]: true } as HorseDecideOpts, b: {} };
}

/** The receipts each candidate writes (HorseLogic.ts). */
export const RVDL_RECEIPTS: Readonly<
  Record<RvdlSkill, { evaluated: readonly string[]; acted: readonly string[] }>
> = Object.freeze({
  riverPositionDefense: {
    evaluated: ['river_position_defense_evaluated'],
    acted: ['river_position_defense_call'],
  },
  smallPotNearNutRiverValue: {
    evaluated: ['small_pot_near_nut_value_considered', 'small_pot_near_nut_value_superseded'],
    acted: ['small_pot_near_nut_value_raise', 'small_pot_near_nut_value_flat_exception'],
  },
});

/** Wide preflop, bets 80% of the time it is checked to on every street, and
 *  folds to a bet a little less than the calibrated population. */
export const RVDL_AGGRESSOR_CUTOFFS = Object.freeze({
  preflopUnopened: Object.freeze({ fold: 0.25, raise: 0.6 }),
  preflopFacingRaise: Object.freeze({ fold: 0.35, raise: 0.85 }),
  checkedToBet: 0.2,
  facingBetFold: 0.45,
});

export function rvdlAggressorProfile(variant: string): Readonly<HumanCalibratedProfile> {
  const base = humanCalibratedProfileFor(variant);
  const c = RVDL_AGGRESSOR_CUTOFFS;
  const cutoffs = { ...(base.cutoffs ?? {}) };
  cutoffs['preflop/unopened'] = { ...c.preflopUnopened };
  cutoffs['preflop/facing_raise'] = { ...c.preflopFacingRaise };
  for (const street of ['flop', 'turn', 'river'] as const) {
    cutoffs[`${street}/checked_to`] = { bet: c.checkedToBet };
    cutoffs[`${street}/facing_bet`] = {
      ...(cutoffs[`${street}/facing_bet`] ?? {}),
      fold: c.facingBetFold,
    };
  }
  return Object.freeze({ ...base, id: `${base.id}-rvdl-aggressors`, cutoffs });
}

export type RvdlSeatKind = 'horse' | 'calibrated' | 'stations' | 'folders' | 'aggressors';
export function rvdlSeatKind(
  pool: RvdlPool,
  seatIdx: number,
  seats: RblmSeats = 6,
  pairIdx = 0
): RvdlSeatKind | 'hero' {
  if (seatIdx === RBLM_HERO_SEAT) return 'hero';
  if (pool === 'standard') return 'horse';
  if (pool === 'stations' || pool === 'folders' || pool === 'aggressors') return pool;
  if (seats === 2) return (['horse', 'calibrated', 'stations', 'folders'] as const)[pairIdx % 4];
  return (['horse', 'calibrated', 'stations', 'folders', 'horse'] as const)[(seatIdx - 1) % 5];
}

export interface RvdlArmStats {
  hands: number;
  netBB: number;
  showdowns: number;
  showdownWins: number;
  /** candidate receipts on hero decisions */
  evaluated: number;
  acted: number;
  /** hands containing an act, their net, and how they ended */
  actHands: number;
  actNetBB: number;
  actShowdowns: number;
  actShowdownWins: number;
  /** value raise only: the opponent folded to it */
  actFoldedTo: number;
}

export interface RvdlCellResult {
  skill: RvdlSkill;
  variant: RblmVariant;
  format: RblmFormat;
  pool: RvdlPool;
  seats: RblmSeats;
  pairs: number;
  seed: number;
  bb100: number;
  stderr: number;
  ci95: [number, number];
  divergentPairs: number;
  /** net bb of the divergent pairs (A - B), summed */
  divergentNetBB: number;
  armA: RvdlArmStats & { bb100: number; se: number };
  armB: RvdlArmStats & { bb100: number; se: number };
  illegalActions: number;
  truncatedStreets: number;
  brainExceptionFallbacks: number;
  durationMs: number;
}

function emptyArm(): RvdlArmStats {
  return {
    hands: 0,
    netBB: 0,
    showdowns: 0,
    showdownWins: 0,
    evaluated: 0,
    acted: 0,
    actHands: 0,
    actNetBB: 0,
    actShowdowns: 0,
    actShowdownWins: 0,
    actFoldedTo: 0,
  };
}

function playArm(
  skill: RvdlSkill,
  arm: HorseDecideOpts,
  sandbox: HorseMindSandbox,
  handSeed: number,
  dealerSeat: number,
  variant: RblmVariant,
  format: RblmFormat,
  pool: RvdlPool,
  counters: { illegal: number; truncated: number; brainFallback?: number },
  stats: RvdlArmStats,
  seats: RblmSeats,
  pairIdx: number
): number {
  const { context, stackBB } = rblmContext(format);
  const hybrid = HORSE_HYBRID_PROFILES[format === 'tournament' ? 'tournament' : 'cash'];
  const kinds = Array.from({ length: seats }, (_, s) => rvdlSeatKind(pool, s, seats, pairIdx));
  const profiles: Partial<Record<RvdlSeatKind, Readonly<HumanCalibratedProfile>>> = {
    stations: rblmTendencyProfile(variant, 'stations'),
    folders: rblmTendencyProfile(variant, 'folders'),
    aggressors: rvdlAggressorProfile(variant),
  };
  const scripted = (s: number) => kinds[s] !== 'hero' && kinds[s] !== 'horse';
  const field: LeagueHumanField | undefined = kinds.some((_, s) => scripted(s))
    ? {
        population:
          variant === 'nlh'
            ? HUMAN_CALIBRATED_POPULATION_ID
            : HUMAN_CALIBRATED_OMAHA_DEV_POPULATION_ID,
        isHuman: scripted,
        profileOf: (s) => profiles[kinds[s] as RvdlSeatKind],
      }
    : undefined;
  const receipts = RVDL_RECEIPTS[skill];
  let acted = false;
  let actedRaisePending = false;
  let foldedTo = false;
  const observer: LeagueHandObserver = {
    onAction: (e) => {
      if (e.seatIdx === RBLM_HERO_SEAT) {
        const fires = drainFires();
        stats.evaluated += fires.filter((f) => receipts.evaluated.includes(f.feature)).length;
        const n = fires.filter((f) => receipts.acted.includes(f.feature)).length;
        if (n > 0) {
          stats.acted += n;
          acted = true;
          actedRaisePending = e.action === 'raise' || e.action === 'all_in';
        }
      } else if (actedRaisePending && e.stage === 'river') {
        if (e.action === 'fold') foldedTo = true;
        actedRaisePending = false;
      }
    },
    onEnd: (e) => {
      const heroLive = !e.folded[RBLM_HERO_SEAT];
      const showdown = heroLive && !e.endedByFolds;
      if (showdown) {
        stats.showdowns++;
        if (e.net[RBLM_HERO_SEAT] > 0) stats.showdownWins++;
      }
      if (acted) {
        stats.actHands++;
        stats.actNetBB += e.net[RBLM_HERO_SEAT] / BB;
        if (showdown) {
          stats.actShowdowns++;
          if (e.net[RBLM_HERO_SEAT] > 0) stats.actShowdownWins++;
        }
        if (foldedTo && heroLive && e.endedByFolds) stats.actFoldedTo++;
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
  return net;
}

const meanSe = (xs: number[]): { mean: number; se: number } => {
  const n = Math.max(1, xs.length);
  const m = xs.reduce((s, x) => s + x, 0) / n;
  const v = xs.reduce((s, x) => s + (x - m) * (x - m), 0) / Math.max(1, xs.length - 1);
  return { mean: m, se: Math.sqrt(v / n) };
};

/** One duplicate-dealt cell: `pairs` deals, each played by arm A then arm B. */
export async function runRiverValueDefenseCell(
  skill: RvdlSkill,
  variant: RblmVariant,
  format: RblmFormat,
  pool: RvdlPool,
  pairs: number,
  seed: number,
  seats: RblmSeats = 6
): Promise<RvdlCellResult> {
  const t0 = Date.now();
  const counters: { illegal: number; truncated: number; brainFallback?: number } = {
    illegal: 0,
    truncated: 0,
  };
  const arms = rvdlArms(skill);
  const sbA = HorseMind.createSandbox();
  const sbB = HorseMind.createSandbox();
  const a = emptyArm();
  const b = emptyArm();
  const diff: number[] = [];
  const netsA: number[] = [];
  const netsB: number[] = [];
  let divergent = 0;
  let divergentNet = 0;
  const rng = saveFastRandom();
  try {
    for (let p = 0; p < pairs; p++) {
      if (p > 0 && (p & 0x0f) === 0) await new Promise((res) => setImmediate(res));
      const handSeed = (seed ^ (p * 2654435761)) >>> 0 || 1;
      const dealerSeat = (p % seats) + 1;
      const na = playArm(
        skill,
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
        p
      );
      const nb = playArm(
        skill,
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
        p
      );
      netsA.push(na / BB);
      netsB.push(nb / BB);
      diff.push((na - nb) / BB);
      if (na !== nb) {
        divergent++;
        divergentNet += (na - nb) / BB;
      }
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
    skill,
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
    divergentNetBB: divergentNet,
    armA: { ...a, bb100: sa.mean * 100, se: sa.se * 100 },
    armB: { ...b, bb100: sb.mean * 100, se: sb.se * 100 },
    illegalActions: counters.illegal,
    truncatedStreets: counters.truncated,
    brainExceptionFallbacks: counters.brainFallback ?? 0,
    durationMs: Date.now() - t0,
  };
}

