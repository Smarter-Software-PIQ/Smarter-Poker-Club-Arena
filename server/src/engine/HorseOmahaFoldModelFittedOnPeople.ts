/**
 * THE FOLD MODEL FITTED ON PEOPLE (WooWoo audit lane FOLD-MODEL; option omahaFoldModelFittedOnPeople,
 * default OFF).
 *
 * The v38 EV engine prices a Horse's flop or turn bet with mdfFold: s/(P+s) x foldMul, where foldMul starts
 * from OMAHA_EV_FOLD_MODEL (HorseMind.ts: foldOverMdf 1.289 PLO4 / 1.458 PLO5 x his shrunk fold-to-bet read
 * over the population) and is then raised by the V53 pressure, V86 fold-to-cbet and style multipliers.
 * OMAHA_EV_FOLD_MODEL was fitted with every seat pooled, Horses included, and Horses fold far more than
 * people: heads-up, people folded 617/1,987 = 0.311 to a Horse's first flop bet (2026-11-04..18) where the
 * base model credits 0.379 (archive repairs/FOLD-SHARE/MEASUREMENT.md), which overstates bluff EV against
 * people.
 *
 * With the option on, PLO4/PLO5 cash in the priced scope (omahaPricedInScope), on the flop or the turn,
 * heads-up against a PERSON, facing no bet, his fold share to a bet s into the pot P he sees is
 *
 *   fold = clamp(mdf x pf x R, 0.02, 0.92),  mdf = s / (P + s)
 *   pf   = (d / dPop) ^ personalElasticity                       (his own read, relative to people)
 *   R    = (folds_c + K x r0) / (mdfUnits_c + K)                 (the cell ratio, shrunk to the old model)
 *   r0   = clamp(OMAHA_EV_FOLD_MODEL multiplier for him, 0.4, 1.8) / pf
 *
 * Cell c = variant x street x pot type (preflop raises 0 / 1 / 2 / 3+) x bet-size bucket (s/P <= 0.40,
 * <= 0.60, <= 0.85, above): folds_c people's folds and mdfUnits_c the sum of mdf x pf over the heads-up
 * person answers to a Horse's first bet of that street in that cell (OMAHA_PERSON_FOLD_CELLS). Where the
 * cell is thin R falls back to r0, i.e. to exactly the old model's fold share for him; a long cell speaks for
 * itself. d = (his folds + 16 dPop) / (his faced first postflop bets + 16) from his durable fold-to-bet
 * counters (HorseMind.foldToBetCountersOf, the row omahaEvFoldMulOf reads), dPop the person population of
 * that read. K and personalElasticity are the time-split cross-validated choice (log loss) on the fit window.
 *
 * Every constant is measured: OMAHA_PERSON_FOLD_FIT, 3,417 heads-up person answers (flop 1,995, turn
 * 1,422) to a Horse's first flop or turn bet, PLO4/PLO5 cash, 2026-11-04 10:24Z to 2026-11-18 09:58Z,
 * read-only production (archive repairs/FOLD-MODEL/work/fit.json sha256 8a9e14538fa593a8). No threshold on
 * size, hand class or position decides anything: the size bucket selects which measured cell prices the
 * bet, the size itself enters continuously through mdf, and the bet or check is still chosen by EV.
 *
 * For that opponent this replaces the whole multiplier chain (evFoldMul, V53, V86, style): the cells
 * measure what people did against the bets the live chain made. The hand's card-removal delta still
 * applies on top. Against a Horse or an opponent of unknown kind, multiway, facing a bet, on the river, or
 * out of scope (tournaments, fast-table cash, bomb pots, PLO6): unchanged.
 */
import type { SeatPlayer } from '../types.js';
import type { HorseDecideOpts, HorseGameStateV2 } from './HorseLogic.js';
import { OMAHA_EV_FOLD_MODEL, OMAHA_EV_FOLD_PRIOR_STRENGTH } from './HorseMind.js';
import { omahaPricedInScope } from './HorseOmahaPricedWiring.js';
import { omahaOpponentKindOf } from './HorseOmahaPricedMode.js';
import { preflopRaiseCount, type ReraisedAction } from './HorseOmahaReraisedPot.js';

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export type OmahaPersonFoldVariant = 'plo4' | 'plo5';
export type OmahaPersonFoldStreet = 'flop' | 'turn';
export type OmahaPersonFoldPotType = 'limped' | 'srp' | 'threeBet' | 'fourBetPlus';
export type OmahaPersonFoldSizeBucket = 'le40' | 'b40to60' | 'b60to85' | 'gt85';

/** The fitted constants (archive repairs/FOLD-MODEL/work/fit.json; fit.py time-split CV, cut 2026-11-16 01:04Z:
 *  log loss 0.5785 on the later 1,026 answers against 0.5908 for OMAHA_EV_FOLD_MODEL at his durable read). */
export const OMAHA_PERSON_FOLD_FIT = Object.freeze({
  /** Pseudo mdf-units of the old model behind every cell (CV grid 1..256: 8 best, 16 within 0.0004). */
  shrinkToOldModel: 8,
  /** Elasticity of his fold to his own read relative to people (CV grid 0..3: 1.5 best). */
  personalElasticity: 1.5,
  /** Pseudo-opportunities of the person population behind his read (the same 16 as
   *  OMAHA_EV_FOLD_PRIOR_STRENGTH; a literal so this module reads nothing at load time). */
  personalPriorStrength: 16,
  /** The person population of the durable fold-to-bet read (opportunity-weighted, 31 people, 2026-11-18). */
  personPopulation: Object.freeze({ plo4: 0.42352357853844863, plo5: 0.4296587656440379 }),
});

/** [folds, mdfUnits, answers] per cell `variant|street|potType|sizeBucket`, heads-up person answers. A cell
 *  that is absent has no answers: the old model prices it. */
export const OMAHA_PERSON_FOLD_CELLS: Readonly<Record<string, readonly [number, number, number]>> =
  Object.freeze({
    'plo4|flop|fourBetPlus|b40to60': [1, 4.2405, 15],
    'plo4|flop|fourBetPlus|b60to85': [1, 0.9404, 2],
    'plo4|flop|fourBetPlus|le40': [2, 2.4935, 10],
    'plo4|flop|limped|b40to60': [28, 28.873, 98],
    'plo4|flop|limped|b60to85': [45, 55.536, 124],
    'plo4|flop|limped|gt85': [13, 12.2209, 26],
    'plo4|flop|limped|le40': [13, 12.9582, 48],
    'plo4|flop|srp|b40to60': [70, 63.3055, 199],
    'plo4|flop|srp|b60to85': [85, 80.6581, 179],
    'plo4|flop|srp|gt85': [20, 16.0876, 34],
    'plo4|flop|srp|le40': [60, 62.389, 309],
    'plo4|flop|threeBet|b40to60': [11, 8.7378, 30],
    'plo4|flop|threeBet|b60to85': [5, 7.4092, 17],
    'plo4|flop|threeBet|gt85': [0, 0.5095, 1],
    'plo4|flop|threeBet|le40': [5, 8.6999, 40],
    'plo4|turn|fourBetPlus|b40to60': [2, 1.9072, 7],
    'plo4|turn|fourBetPlus|b60to85': [1, 0.4615, 1],
    'plo4|turn|fourBetPlus|le40': [0, 0.3922, 1],
    'plo4|turn|limped|b40to60': [8, 10.4071, 38],
    'plo4|turn|limped|b60to85': [30, 26.7467, 66],
    'plo4|turn|limped|gt85': [8, 10.7691, 24],
    'plo4|turn|limped|le40': [6, 7.9032, 35],
    'plo4|turn|srp|b40to60': [37, 39.887, 141],
    'plo4|turn|srp|b60to85': [68, 67.6876, 165],
    'plo4|turn|srp|gt85': [31, 34.735, 81],
    'plo4|turn|srp|le40': [47, 31.8842, 148],
    'plo4|turn|threeBet|b40to60': [14, 8.704, 31],
    'plo4|turn|threeBet|b60to85': [6, 4.6122, 11],
    'plo4|turn|threeBet|gt85': [5, 4.0637, 11],
    'plo4|turn|threeBet|le40': [2, 3.9561, 18],
    'plo5|flop|fourBetPlus|b40to60': [19, 14.4651, 52],
    'plo5|flop|fourBetPlus|b60to85': [15, 9.2373, 23],
    'plo5|flop|fourBetPlus|gt85': [5, 5.2416, 13],
    'plo5|flop|fourBetPlus|le40': [16, 14.2702, 68],
    'plo5|flop|limped|b40to60': [3, 1.4202, 5],
    'plo5|flop|limped|b60to85': [7, 6.4992, 15],
    'plo5|flop|limped|gt85': [1, 0.9501, 2],
    'plo5|flop|limped|le40': [3, 5.5601, 23],
    'plo5|flop|srp|b40to60': [17, 13.8628, 45],
    'plo5|flop|srp|b60to85': [27, 28.8743, 70],
    'plo5|flop|srp|gt85': [3, 2.8276, 7],
    'plo5|flop|srp|le40': [26, 23.1588, 113],
    'plo5|flop|threeBet|b40to60': [29, 26.1922, 94],
    'plo5|flop|threeBet|b60to85': [49, 44.522, 111],
    'plo5|flop|threeBet|gt85': [13, 11.5702, 27],
    'plo5|flop|threeBet|le40': [25, 39.2364, 195],
    'plo5|turn|fourBetPlus|b40to60': [14, 9.0565, 32],
    'plo5|turn|fourBetPlus|b60to85': [4, 3.7981, 10],
    'plo5|turn|fourBetPlus|gt85': [10, 6.0635, 14],
    'plo5|turn|fourBetPlus|le40': [1, 3.1172, 17],
    'plo5|turn|limped|b40to60': [2, 1.7356, 5],
    'plo5|turn|limped|b60to85': [4, 5.6799, 13],
    'plo5|turn|limped|gt85': [3, 2.9452, 6],
    'plo5|turn|limped|le40': [3, 1.895, 9],
    'plo5|turn|srp|b40to60': [17, 16.1937, 54],
    'plo5|turn|srp|b60to85': [21, 34.1166, 84],
    'plo5|turn|srp|gt85': [31, 29.1794, 64],
    'plo5|turn|srp|le40': [17, 13.3757, 60],
    'plo5|turn|threeBet|b40to60': [28, 21.7251, 77],
    'plo5|turn|threeBet|b60to85': [31, 25.7878, 68],
    'plo5|turn|threeBet|gt85': [27, 24.9007, 57],
    'plo5|turn|threeBet|le40': [16, 15.9527, 74],
  });

export function omahaPersonFoldPotTypeOf(preflopRaises: number): OmahaPersonFoldPotType {
  return preflopRaises <= 0
    ? 'limped'
    : preflopRaises === 1
      ? 'srp'
      : preflopRaises === 2
        ? 'threeBet'
        : 'fourBetPlus';
}

/** The measured cell a bet `wager` into the pot `potFacing` belongs to (fraction of the pot he sees before it). */
export function omahaPersonFoldSizeBucketOf(
  potFacing: number,
  wager: number
): OmahaPersonFoldSizeBucket {
  const f = wager / potFacing;
  return f <= 0.4 ? 'le40' : f <= 0.6 ? 'b40to60' : f <= 0.85 ? 'b60to85' : 'gt85';
}

export interface OmahaPersonFoldSpot {
  variant: OmahaPersonFoldVariant;
  street: OmahaPersonFoldStreet;
  potType: OmahaPersonFoldPotType;
  /** his durable fold-to-bet counters, or null (no record: the population) */
  counters: { hit: number; opp: number } | null;
}

function countsOf(spot: OmahaPersonFoldSpot): { hit: number; opp: number } {
  const c = spot.counters;
  const opp = c && fin(c.opp) ? Math.max(0, c.opp) : 0;
  const hit = c && fin(c.hit) ? clamp(c.hit, 0, opp) : 0;
  return { hit, opp };
}

/** OMAHA_EV_FOLD_MODEL's multiplier for him (HorseMind.omahaEvFoldMulOf without the winner respect), clamped
 *  as mdfFold clamps it. */
export function omahaOldFoldMul(spot: OmahaPersonFoldSpot): number {
  const cell = OMAHA_EV_FOLD_MODEL[spot.variant];
  const { hit, opp } = countsOf(spot);
  const m = OMAHA_EV_FOLD_PRIOR_STRENGTH;
  const d = (hit + m * cell.population) / (opp + m);
  return clamp((cell.foldOverMdf * d) / cell.population, 0.4, 1.8);
}

/** His fold read relative to people, raised to the fitted elasticity. */
export function omahaPersonFoldFactor(spot: OmahaPersonFoldSpot): number {
  const F = OMAHA_PERSON_FOLD_FIT;
  const pop = F.personPopulation[spot.variant];
  const { hit, opp } = countsOf(spot);
  const d = (hit + F.personalPriorStrength * pop) / (opp + F.personalPriorStrength);
  return Math.pow(clamp(d, 0.01, 0.99) / pop, F.personalElasticity);
}

/** His fold share to a bet `wager` into the pot `potFacing` he sees (the closed form above). */
export function omahaPersonFoldShare(
  spot: OmahaPersonFoldSpot,
  potFacing: number,
  wager: number
): number | null {
  if (!fin(potFacing) || !fin(wager) || !(potFacing > 0) || !(wager > 0)) return null;
  const F = OMAHA_PERSON_FOLD_FIT;
  const mdf = wager / (potFacing + wager);
  const pf = omahaPersonFoldFactor(spot);
  const r0 = omahaOldFoldMul(spot) / pf;
  const key = `${spot.variant}|${spot.street}|${spot.potType}|${omahaPersonFoldSizeBucketOf(potFacing, wager)}`;
  const [folds, mdfUnits] = OMAHA_PERSON_FOLD_CELLS[key] ?? [0, 0, 0];
  const K = F.shrinkToOldModel;
  const R = (folds + K * r0) / (mdfUnits + K);
  return clamp(mdf * pf * R, 0.02, 0.92);
}

export type OmahaFoldModelFittedOnPeopleVerdict =
  | { kind: 'off' }
  | { kind: 'unpriced'; reason: string }
  | {
      kind: 'priced';
      spot: OmahaPersonFoldSpot;
      /** the opponent's index in the order the EV models are built (the EV engine's `i`) */
      opponentIndex: number;
      foldShareOf: (opponent: number, potFacing: number, wager: number) => number | null;
    };

/**
 * The person fold share for a v38 flop / turn bet facing no wager, or why not. `opponents` is the list the
 * caller builds its EV models from (in that order); `toCall` the amount to call; `countersOf` his durable
 * fold-to-bet counters (HorseMind.foldToBetCountersOf).
 */
export function omahaFoldModelFittedOnPeopleOf(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  opts: HorseDecideOpts,
  opponents: readonly { user_id: string; seat: number; is_all_in?: boolean; stack: number }[],
  toCall: number,
  countersOf: (userId: string) => { hit: number; opp: number } | null
): OmahaFoldModelFittedOnPeopleVerdict {
  if (opts.omahaFoldModelFittedOnPeople !== true) return { kind: 'off' };
  try {
    const stage = String(gs.stage ?? '');
    if (stage !== 'flop' && stage !== 'turn') return { kind: 'off' };
    if ((gs.communityCards ?? []).length !== (stage === 'flop' ? 3 : 4)) return { kind: 'off' };
    if (!omahaPricedInScope(player, gs, opts)) return { kind: 'off' };
    const variant = String(gs.gameVariant ?? '').toLowerCase();
    if (variant !== 'plo4' && variant !== 'plo5') return { kind: 'off' };
    if (fin(toCall) && toCall > 0) return { kind: 'off' };
    // The live opponents exactly as HorseLogic.decide builds `opponents`.
    const live = (gs.players ?? []).filter(
      (p) => p.seat !== player.seat && !p.is_folded && (!p.is_sitting_out || p.is_all_in)
    );
    if (live.length !== 1) return { kind: 'off' };
    const opp = live[0];
    const idx = opponents.findIndex((o) => o.seat === opp.seat);
    if (idx < 0) return { kind: 'unpriced', reason: 'no_model_row' };
    if (opp.is_all_in || !fin(opp.stack) || !(opp.stack > 0))
      return { kind: 'unpriced', reason: 'opponent_cannot_respond' };
    if (omahaOpponentKindOf(gs, opp.user_id) !== 'person')
      return { kind: 'unpriced', reason: 'not_measured_for_kind' };
    let counters: { hit: number; opp: number } | null = null;
    try {
      counters = countersOf(opp.user_id);
    } catch {
      counters = null;
    }
    const spot: OmahaPersonFoldSpot = {
      variant,
      street: stage,
      potType: omahaPersonFoldPotTypeOf(
        preflopRaiseCount((gs.actionHistory ?? []) as unknown as readonly ReraisedAction[])
      ),
      counters,
    };
    return {
      kind: 'priced',
      spot,
      opponentIndex: idx,
      foldShareOf: (i, potFacing, wager) =>
        i === idx ? omahaPersonFoldShare(spot, potFacing, wager) : null,
    };
  } catch {
    return { kind: 'unpriced', reason: 'error' };
  }
}
