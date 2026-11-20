/**
 * THE FLOP BET'S FOLD SHARE FROM HIS MEASURED FOLDS (WooWoo audit lane FOLD-SHARE, finding FOURBET F1;
 * option omahaFlopBetUsesMeasuredFoldShare, default OFF).
 *
 * The v38 EV engine prices a Horse's flop bet with mdfFold: s/(P+s) x foldMul, foldMul =
 * OMAHA_EV_FOLD_MODEL.foldOverMdf (1.289 PLO4, 1.458 PLO5) x his shrunk fold-to-bet read over the
 * population (HorseMind.omahaEvFoldMulOf), then the V53 pressure, V86 fold-to-cbet and style multipliers.
 * foldOverMdf was fitted on every seat pooled. Persons fold to Horse flop bets at about MDF: heads-up
 * 617/1,987 = 0.311 (2026-11-04..18) where the base model credits 0.379 (0.439 at the population read)
 * before the multipliers, and the F1 replay printed 0.58-0.76 on the 75-85% bets in 4-bet pots against a
 * measured 0.38 (archive repairs/FOLD-SHARE/MEASUREMENT.md).
 *
 * With the option on, PLO4/PLO5 cash in the priced scope (omahaPricedInScope), on the flop, heads-up
 * against a PERSON, facing no bet, his fold share to a bet s into the pot P he sees is
 *
 *   logit f = b0 + bMdf.logit(s/(P+s)) + pot type + SPR band + variant + Horse out of position
 *             + bPersonal.(logit(d) - logit(dPop))
 *
 * d = (his folds + M.dPop) / (his faced first postflop bets + M): his durable fold-to-bet read
 * (HorseMind.foldToBetCountersOf, the row omahaEvFoldMulOf reads), shrunk toward the PERSON population
 * dPop with M pseudo-opportunities. A stranger is the population cell exactly; a long record speaks for
 * itself through the fitted slope. Every constant is the maximum-likelihood fit of
 * OMAHA_FLOP_BET_PERSON_FOLD_FIT (1,433 heads-up person answers to a Horse's first flop bet before
 * 2026-11-16 16:29Z; FOLD-SHARE/work/fit.json sha256 7b5c182c4a53f0cc). No threshold on size, class,
 * SPR or position: the bands are fitted log-odds terms and the size enters continuously.
 *
 * This replaces the whole fold multiplier for that opponent (the V53, V86 and style multipliers price
 * the same thing and are what over-credits it); the hand's card-removal delta still applies on top.
 * Against a Horse or an opponent of unknown kind, multiway, facing a bet, or out of scope: unchanged.
 * His per-pot-type / per-SPR fold is not stored per player (the per-street read is empty in production),
 * so his own evidence enters as one fitted log-odds shift on the population cell.
 */
import type { SeatPlayer } from '../types.js';
import type { HorseDecideOpts, HorseGameStateV2 } from './HorseLogic.js';
import { omahaPricedInScope } from './HorseOmahaPricedWiring.js';
import { omahaOpponentKindOf } from './HorseOmahaPricedMode.js';
import { preflopRaiseCount, type ReraisedAction } from './HorseOmahaReraisedPot.js';

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const logit = (p: number) => Math.log(p / (1 - p));

export type OmahaFlopPotType = 'limped' | 'srp' | 'threeBet' | 'fourBetPlus';
export type OmahaFlopSprBand = 'lt2' | 'b2to4' | 'b4to8' | 'ge8';

/** The fitted person model (FOLD-SHARE MEASUREMENT.md, work/fit.json). Reference cell: SRP, SPR >= 8, PLO4, Horse in position. */
export const OMAHA_FLOP_BET_PERSON_FOLD_FIT = Object.freeze({
  intercept: 0.3678773869711997,
  logitMdf: 1.1423990311770045,
  pot: Object.freeze({
    limped: -0.09888657666543414,
    srp: 0,
    threeBet: -0.3747973155651965,
    fourBetPlus: -0.468827373481654,
  } satisfies Record<OmahaFlopPotType, number>),
  spr: Object.freeze({
    lt2: 0.690129123749743,
    b2to4: 0.3952579753357058,
    b4to8: 0.02493383307898501,
    ge8: 0,
  } satisfies Record<OmahaFlopSprBand, number>),
  plo5: -0.07224492143493162,
  horseOutOfPosition: -0.4297253985727744,
  personal: 1.6514694571422261,
  /** Pseudo-opportunities of the person population behind his read: time-split CV is flat over 4..64;
   *  the between-person dispersion (method of moments, 26 persons) gives 13.9. */
  priorStrength: 16,
  /** The person population of the durable fold-to-bet read (opportunity-weighted, 31 persons). */
  personPopulation: Object.freeze({ plo4: 0.42352357853844863, plo5: 0.4296587656440379 }),
});

export function omahaFlopPotTypeOf(preflopRaises: number): OmahaFlopPotType {
  return preflopRaises <= 0
    ? 'limped'
    : preflopRaises === 1
      ? 'srp'
      : preflopRaises === 2
        ? 'threeBet'
        : 'fourBetPlus';
}
export function omahaFlopSprBandOf(spr: number): OmahaFlopSprBand {
  return spr < 2 ? 'lt2' : spr < 4 ? 'b2to4' : spr < 8 ? 'b4to8' : 'ge8';
}

export interface OmahaFlopFoldCell {
  variant: 'plo4' | 'plo5';
  potType: OmahaFlopPotType;
  sprBand: OmahaFlopSprBand;
  horseInPosition: boolean;
  /** his durable fold-to-bet counters, or null (no record: the population) */
  counters: { hit: number; opp: number } | null;
}

/** His read d, shrunk toward the person population. */
export function omahaFlopPersonRead(cell: OmahaFlopFoldCell): number {
  const F = OMAHA_FLOP_BET_PERSON_FOLD_FIT;
  const pop = F.personPopulation[cell.variant];
  const c = cell.counters;
  const opp = c && fin(c.opp) ? Math.max(0, c.opp) : 0;
  const hit = c && fin(c.hit) ? clamp(c.hit, 0, opp) : 0;
  return (hit + F.priorStrength * pop) / (opp + F.priorStrength);
}

/** His fold share to a bet `wager` into the pot `potFacing` he sees (the closed form above). */
export function omahaFlopMeasuredFoldShare(
  cell: OmahaFlopFoldCell,
  potFacing: number,
  wager: number
): number | null {
  if (!fin(potFacing) || !fin(wager) || !(potFacing > 0) || !(wager > 0)) return null;
  const F = OMAHA_FLOP_BET_PERSON_FOLD_FIT;
  const mdf = clamp(wager / (potFacing + wager), 0.02, 0.98);
  const pop = F.personPopulation[cell.variant];
  const d = clamp(omahaFlopPersonRead(cell), 0.01, 0.99);
  const z =
    F.intercept +
    F.logitMdf * logit(mdf) +
    F.pot[cell.potType] +
    F.spr[cell.sprBand] +
    (cell.variant === 'plo5' ? F.plo5 : 0) +
    (cell.horseInPosition ? 0 : F.horseOutOfPosition) +
    F.personal * (logit(d) - logit(pop));
  return 1 / (1 + Math.exp(-z));
}

export type OmahaFlopBetMeasuredFoldShareVerdict =
  | { kind: 'off' }
  | { kind: 'unpriced'; reason: string }
  | {
      kind: 'priced';
      cell: OmahaFlopFoldCell;
      /** the opponent's index in the order the v38 models are built (the EV engine's `i`) */
      opponentIndex: number;
      foldShareOf: (opponent: number, potFacing: number, wager: number) => number | null;
    };

/**
 * The fold share for the v38 flop bet, or why not. `opponents` is the list the v38 block builds its
 * models from (in that order); `pot` the pot before the bet; `effective` the effective stack;
 * `counters` his durable fold-to-bet counters (HorseMind.foldToBetCountersOf).
 */
export function omahaFlopBetMeasuredFoldShareOf(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  opts: HorseDecideOpts,
  opponents: readonly { user_id: string; seat: number; is_all_in?: boolean; stack: number }[],
  pot: number,
  toCall: number,
  effective: number,
  inPosition: boolean,
  countersOf: (userId: string) => { hit: number; opp: number } | null
): OmahaFlopBetMeasuredFoldShareVerdict {
  if (opts.omahaFlopBetUsesMeasuredFoldShare !== true) return { kind: 'off' };
  try {
    if (String(gs.stage ?? '') !== 'flop') return { kind: 'off' };
    if ((gs.communityCards ?? []).length !== 3) return { kind: 'off' };
    if (!omahaPricedInScope(player, gs, opts)) return { kind: 'off' };
    const variant = String(gs.gameVariant ?? '').toLowerCase();
    if (variant !== 'plo4' && variant !== 'plo5') return { kind: 'off' };
    if (fin(toCall) && toCall > 0) return { kind: 'off' };
    const live = (gs.players ?? []).filter(
      (p) => p.seat !== player.seat && !p.is_folded && !p.is_sitting_out
    );
    if (live.length !== 1) return { kind: 'off' };
    const opp = live[0];
    const idx = opponents.findIndex((o) => o.seat === opp.seat);
    if (idx < 0) return { kind: 'unpriced', reason: 'no_model_row' };
    if (opp.is_all_in || !fin(opp.stack) || !(opp.stack > 0))
      return { kind: 'unpriced', reason: 'opponent_cannot_respond' };
    if (!fin(pot) || !(pot > 0) || !fin(effective) || !(effective > 0))
      return { kind: 'unpriced', reason: 'no_price' };
    if (omahaOpponentKindOf(gs, opp.user_id) !== 'person')
      return { kind: 'unpriced', reason: 'not_measured_for_kind' };
    let counters: { hit: number; opp: number } | null = null;
    try {
      counters = countersOf(opp.user_id);
    } catch {
      counters = null;
    }
    const cell: OmahaFlopFoldCell = {
      variant,
      potType: omahaFlopPotTypeOf(
        preflopRaiseCount((gs.actionHistory ?? []) as unknown as readonly ReraisedAction[])
      ),
      sprBand: omahaFlopSprBandOf(effective / pot),
      horseInPosition: inPosition,
      counters,
    };
    return {
      kind: 'priced',
      cell,
      opponentIndex: idx,
      foldShareOf: (i, potFacing, wager) =>
        i === idx ? omahaFlopMeasuredFoldShare(cell, potFacing, wager) : null,
    };
  } catch {
    return { kind: 'unpriced', reason: 'error' };
  }
}
