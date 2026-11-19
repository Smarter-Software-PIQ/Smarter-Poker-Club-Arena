/**
 * WHOLE-TOURNAMENT SWITCH CARD (2026-11-19, Horse Switch lane, TOURNAMENTS
 * improvement 1 and 5).
 *
 * The flag cards of HorseTournamentFlagContract.ts measure one fixed PLO option
 * (v53PloTourneyIcm) with every non-hero Horse on release defaults ({}). A
 * switch card measures ANY registered option on prize equity instead:
 *   - variant nlh, plo4 or plo5;
 *   - `base`: production's full switch set, option -> boolean (a map, entries or
 *     an arms.json; HorseSwitchArms.ts). Arm B = base; arm A = base with `flag`
 *     changed (candidateValue, default the opposite of the base's value);
 *   - EVERY Horse entrant plays arm B in both tournaments of a pair; only the
 *     designated hero plays arm A in the candidate tournament. The two
 *     tournaments of a pair are dealt from the same seed (paired seeds);
 *   - statistic: per pair, the hero's funded-pool return A minus B (prize plus
 *     bounty for PKO / mystery); mean and its standard error over pairs. The
 *     prize share and the bounty share are reported apart (switchSummary);
 *   - startingStacks 'uneven' (for ICM cards): every entrant starts with a
 *     different stack (0.25x to 1.75x the 2,000-chip average in equal steps,
 *     total unchanged), assigned by a seeded permutation of the tournament seed,
 *     so both tournaments of a pair start with the same stacks and the hero's
 *     stack varies from pair to pair. 'equal' (default): 2,000 each, as before.
 *
 * A switch card never promotes and never activates anything
 * (promotionEligible false). It refuses every reserved seed (flag holdout and
 * historical, Phase 8 promotion). It runs in-process (runTournamentLeague); the
 * compute-worker response validator does not accept its result keys, which is
 * the fail-closed answer for a worker route that was never declared for it.
 */
import { HUMAN_CALIBRATED_POPULATION_ID } from './HumanCalibratedPopulation.js';
import { horseSwitchArms, type HorseSwitchSet } from './HorseSwitchArms.js';
import {
  TOURNAMENT_FLAG_HISTORICAL_SEEDS,
  TOURNAMENT_FLAG_HOLDOUT_SEEDS,
} from './HorseTournamentFlagContract.js';

export const TOURNAMENT_SWITCH_VARIANTS = ['nlh', 'plo4', 'plo5'] as const;
export type TournamentSwitchVariant = (typeof TOURNAMENT_SWITCH_VARIANTS)[number];
export const TOURNAMENT_SWITCH_STACKS = ['equal', 'uneven'] as const;
export type TournamentSwitchStacks = (typeof TOURNAMENT_SWITCH_STACKS)[number];
/** Same seed values as TOURNAMENT_PROMOTION_SEEDS (HorseTournamentLeague.ts), repeated to avoid an import cycle. */
const PROMOTION_SEEDS = [8101101, 8102203, 8103307] as const;
export const TOURNAMENT_SWITCH_RESERVED_SEEDS: readonly number[] = Object.freeze([
  ...TOURNAMENT_FLAG_HOLDOUT_SEEDS,
  ...TOURNAMENT_FLAG_HISTORICAL_SEEDS,
  ...PROMOTION_SEEDS,
]);
export const TOURNAMENT_SWITCH_START_STACK = 2000;

/** The card as a request carries it. */
export interface TournamentSwitchCard {
  name: string;
  variant: TournamentSwitchVariant;
  flag: string;
  /** Production's switch set: option -> boolean map, entries, or an arms.json. */
  base: unknown;
  candidateValue?: boolean;
  startingStacks?: TournamentSwitchStacks;
}

/** The card after validation: what the league plays and what the result records. */
export interface ResolvedTournamentSwitchCard {
  name: string;
  variant: TournamentSwitchVariant;
  flag: string;
  candidateValue: boolean;
  baseValue: boolean | null;
  startingStacks: TournamentSwitchStacks;
  a: HorseSwitchSet;
  b: HorseSwitchSet;
  ignored: readonly string[];
  digest: string;
}

export interface TournamentSwitchPair {
  index: number;
  /** Funded-pool return of the hero, arm A tournament and arm B tournament. */
  candidate: number;
  reference: number;
  /** Prize share of the prize pool (payout percent / 100; satellite: seat share). */
  candidatePrize: number;
  referencePrize: number;
  /** Bounty paid to the hero / funded bounty pool (0 without bounties). */
  candidateBounty: number;
  referenceBounty: number;
  heroStartStack: number;
}

export interface TournamentSwitchMoment {
  mean: number;
  standardError: number;
}
export interface TournamentSwitchSummary {
  statistic: 'mean_per_tournament_pair_candidate_minus_reference';
  pairs: number;
  fundedReturn: TournamentSwitchMoment;
  prizeShare: TournamentSwitchMoment;
  /** Null when the objective pays no bounty. */
  bountyShare: TournamentSwitchMoment | null;
  /** Hero decisions in arm A whose arm B counterfactual differs. */
  changedDecisions: number;
  decisionsCompared: number;
}

export function resolveTournamentSwitchCard(request: {
  switchCard?: TournamentSwitchCard;
  flagCard?: string;
  flagQualification?: unknown;
  phase8PolicyFamily?: unknown;
  candidateMode?: unknown;
  evidenceMode?: unknown;
  seed: number;
  firstPair?: number;
  pairs: number;
  opponentPopulation?: unknown;
}): ResolvedTournamentSwitchCard | undefined {
  const c = request.switchCard;
  if (c === undefined) return undefined;
  if (
    request.flagCard !== undefined ||
    request.flagQualification !== undefined ||
    request.phase8PolicyFamily !== undefined ||
    request.candidateMode !== undefined ||
    request.evidenceMode === 'promotion'
  )
    throw Error('A switch card cannot be combined with a flag card, Phase 8 or promotion');
  if (
    !c ||
    typeof c !== 'object' ||
    typeof c.name !== 'string' ||
    !/^[a-z0-9_.-]{1,96}$/i.test(c.name)
  )
    throw Error('Switch card needs a plain name');
  if (!(TOURNAMENT_SWITCH_VARIANTS as readonly string[]).includes(c.variant))
    throw Error('Switch card variant must be nlh, plo4 or plo5');
  const stacks = c.startingStacks ?? 'equal';
  if (!(TOURNAMENT_SWITCH_STACKS as readonly string[]).includes(stacks))
    throw Error('Switch card startingStacks must be equal or uneven');
  if (c.candidateValue !== undefined && typeof c.candidateValue !== 'boolean')
    throw Error('Switch card candidateValue must be a boolean');
  if (TOURNAMENT_SWITCH_RESERVED_SEEDS.includes(request.seed))
    throw Error('Reserved tournament seed cannot be dealt by a switch card');
  const first = request.firstPair ?? 0;
  if (!Number.isSafeInteger(first) || first < 0) throw Error('Invalid switch card pair range');
  if (
    request.opponentPopulation !== undefined &&
    request.opponentPopulation !== HUMAN_CALIBRATED_POPULATION_ID
  )
    throw Error('Switch card field must be the Horse field or the human-calibrated field');
  const arms = horseSwitchArms(c.base, c.flag, c.candidateValue);
  return Object.freeze({
    name: c.name,
    variant: c.variant,
    flag: arms.flag,
    candidateValue: arms.candidateValue,
    baseValue: arms.baseValue ?? null,
    startingStacks: stacks,
    a: arms.a,
    b: arms.b,
    ignored: arms.ignored,
    digest: arms.digest,
  });
}

function xorshift(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 0x1_0000_0000;
  };
}

/**
 * Starting stacks of one tournament, by entrant index. 'equal': 2,000 each.
 * 'uneven': multipliers 0.25 .. 1.75 of 2,000 in equal steps (mean 1), whole
 * multiples of 10 chips, the last entrant of the permutation absorbing the
 * rounding so the total is exactly entrants x 2,000; entrants are permuted by
 * the tournament seed. A function of (seed, entrants, mode) alone.
 */
export function tournamentSwitchStartingStacks(
  seed: number,
  entrants: number,
  mode: TournamentSwitchStacks
): number[] {
  const avg = TOURNAMENT_SWITCH_START_STACK;
  if (mode === 'equal' || entrants < 2) return Array.from({ length: entrants }, () => avg);
  const levels = Array.from(
    { length: entrants },
    (_, i) => Math.round((avg * (0.25 + (1.5 * i) / (entrants - 1))) / 10) * 10
  );
  const total = avg * entrants;
  levels[entrants - 1]! += total - levels.reduce((s, x) => s + x, 0);
  const order = Array.from({ length: entrants }, (_, i) => i);
  const next = xorshift((seed ^ 0x5bd1e995) >>> 0);
  for (let i = entrants - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const out = Array<number>(entrants);
  for (let i = 0; i < entrants; i++) out[order[i]!] = levels[i]!;
  return out;
}

function moment(xs: readonly number[]): TournamentSwitchMoment {
  const n = xs.length;
  if (!n) return { mean: 0, standardError: 0 };
  const mean = xs.reduce((s, x) => s + x, 0) / n;
  const se = n > 1 ? Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1) / n) : 0;
  return { mean, standardError: se };
}

export function summarizeTournamentSwitchPairs(
  pairs: readonly TournamentSwitchPair[],
  bounties: boolean,
  changedDecisions: number,
  decisionsCompared: number
): TournamentSwitchSummary {
  return {
    statistic: 'mean_per_tournament_pair_candidate_minus_reference',
    pairs: pairs.length,
    fundedReturn: moment(pairs.map((p) => p.candidate - p.reference)),
    prizeShare: moment(pairs.map((p) => p.candidatePrize - p.referencePrize)),
    bountyShare: bounties ? moment(pairs.map((p) => p.candidateBounty - p.referenceBounty)) : null,
    changedDecisions,
    decisionsCompared,
  };
}
