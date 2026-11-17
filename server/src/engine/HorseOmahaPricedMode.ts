/**
 * OMAHA PRICED RULES: THE MODE OF ONE DECISION AND THE CONTINUOUS RANGE INPUTS
 * (2026-11-17, PLO Strategy lane).
 *
 * Owner, 2026-11-17 11:49 Chicago: "there should not be any blanket rules ...
 * a blanket rule shouldn't be allowed to effect a decision, they must all be
 * done by math, gto, players hand or preceived range of hands as well as the
 * opponents range of hand, equity, EV etc." Earlier the same day: the size of
 * the bet must not make or break a decision.
 *
 * This file holds the two things the facing-bet range model
 * (HorseOmahaFacingBetEv) reads from that work, and nothing that imports it,
 * so there is no import cycle:
 *
 *  1. THE MODE. HorseLogic.decide sets it from the decision's options for
 *     the length of one decision (withOmahaPricedMode), the way it sets the
 *     Omaha game scope. Off (every field false) outside a decision and for
 *     every decision whose options are unset: the range model then reads its
 *     stepped tables and its label cap exactly as before.
 *
 *  2. THE CONTINUOUS FORMS. A bet's share of the pot enters the opponent's
 *     range as a continuous input, never as a trigger:
 *      - omahaPricedBySize interpolates a four-row size table between the
 *        centres of its rows, so 39 and 40 percent of the pot read the same
 *        range to within the slope;
 *      - omahaPricedRamp turns a size line (">= 40 percent of the pot") into
 *        a weight that rises from 0 to 1 across the line;
 *      - omahaPricedFacingRange applies the line knowledge the size-triggered
 *        overrides of #11135 and #11183 encoded (a paired-river lead into the
 *        turn aggressor, a river bet into two or more players on a paired
 *        board, a multi-street barrel after an earlier raise, a wager capped
 *        by the stack behind) as weighted moves of the value and bluff
 *        shares;
 *      - omahaPricedBluffFactor is the bettor's bluff share as a continuous
 *        function of how often he bets beside the population (no label).
 *
 * Pure: no telemetry, no opponent memory, no random draw.
 */

export interface OmahaPricedMode {
  /** omahaFacingBetRangeIsContinuous: the size tables are interpolated and the size-triggered overrides and
   *  realization caps are weighted, not stepped. */
  readonly rangeContinuous: boolean;
  /** omahaBluffShareFromBetRate: the bettor's bluff share follows his measured bet rate; the value-leader
   *  label cap (0.65) does not act. */
  readonly bluffShareFromBetRate: boolean;
}
export const OMAHA_PRICED_MODE_OFF: OmahaPricedMode = Object.freeze({
  rangeContinuous: false,
  bluffShareFromBetRate: false,
});
let current: OmahaPricedMode = OMAHA_PRICED_MODE_OFF;

/**
 * The mode of a decision from its two options (each read `=== true` by the
 * caller). Only a PLO4/PLO5 cash decision has one: any other game and a
 * tournament hand read the off mode whatever the options say.
 */
export function omahaPricedModeOf(
  wanted: OmahaPricedMode,
  gs: {
    gameVariant?: unknown;
    gameMode?: unknown;
    tournament?: unknown;
    bigBlind?: unknown;
  } | null
): OmahaPricedMode {
  if (!wanted.rangeContinuous && !wanted.bluffShareFromBetRate) return OMAHA_PRICED_MODE_OFF;
  const variant = String(gs?.gameVariant ?? '').toLowerCase();
  if (variant !== 'plo4' && variant !== 'plo5') return OMAHA_PRICED_MODE_OFF;
  const tournament = gs?.gameMode
    ? gs.gameMode === 'tournament'
    : gs?.tournament != null || Number(gs?.bigBlind ?? 0) >= 10;
  if (tournament) return OMAHA_PRICED_MODE_OFF;
  return Object.freeze({
    rangeContinuous: wanted.rangeContinuous === true,
    bluffShareFromBetRate: wanted.bluffShareFromBetRate === true,
  });
}
export function withOmahaPricedMode<T>(mode: OmahaPricedMode, fn: () => T): T {
  const previous = current;
  current = mode;
  try {
    return fn();
  } finally {
    current = previous;
  }
}
export function omahaPricedModeNow(): OmahaPricedMode {
  return current;
}

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
const lerp = (a: number, b: number, w: number): number => a + (b - a) * w;

/** 0 at or below `lo`, 1 at or above `hi`, linear between: a size line as a weight. */
export function omahaPricedRamp(x: number, lo: number, hi: number): number {
  if (!Number.isFinite(x)) return 0;
  if (!(hi > lo)) return x >= hi ? 1 : 0;
  return clamp((x - lo) / (hi - lo), 0, 1);
}

/**
 * The centres of the four size rows (under 40, 40 to 70, 70 to 110, over 110
 * percent of the pot) as shares of the pot. The measured rows of
 * OMAHA_EV_PRIOR_BLUFF are means over those bands, so each row's value is
 * placed at its band's centre and read linearly between centres.
 */
export const OMAHA_PRICED_SIZE_CENTRES: readonly [number, number, number, number] = [
  0.25, 0.55, 0.9, 1.5,
];

/** A four-row size table read at `potFrac`: flat outside the outer centres, linear between. */
export function omahaPricedBySize(
  rows: readonly [number, number, number, number],
  potFrac: number
): number {
  const c = OMAHA_PRICED_SIZE_CENTRES;
  if (!Number.isFinite(potFrac) || potFrac <= c[0]) return rows[0];
  for (let i = 1; i < 4; i++)
    if (potFrac <= c[i])
      return lerp(rows[i - 1], rows[i], (potFrac - c[i - 1]) / (c[i] - c[i - 1]));
  return rows[3];
}

export interface OmahaPricedSizeTable {
  readonly under40: number;
  readonly mid: number;
  readonly big: number;
  readonly over: number;
  readonly raise: number;
}
const rowsOf = (t: OmahaPricedSizeTable): [number, number, number, number] => [
  t.under40,
  t.mid,
  t.big,
  t.over,
];

export interface OmahaPricedFacingRangeInput {
  street: 'turn' | 'river';
  isRaise: boolean;
  /** the wager the bettor chose as a share of the pot before it (not cut to what the Horse can call) */
  chosenFrac: number;
  /** the part of it the Horse can call, as a share of the pot */
  potFrac: number;
  aggressorStreets: number;
  callerStreets: number;
  earlierRaised: boolean;
  boardPaired: boolean;
  /** the Horse bet or raised the turn (river spots) */
  heroBetTurn: boolean;
  /** other players in the hand who called this wager or are still to act */
  others: number;
  /** the Horse's chips left after the call, as a share of the pot after the call */
  behindShare: number;
  value: OmahaPricedSizeTable;
  bluff: OmahaPricedSizeTable;
  lineAggressor: number;
  lineCaller: number;
}

/**
 * The bettor's value share and bluff prior for this wager, line and board,
 * with no size step. Every term is an input to his range:
 *  - the size he chose (interpolated);
 *  - his line (each earlier street he bet narrows the value region, as the
 *    stepped model does);
 *  - a wager that leaves the Horse nothing behind from a player who bet an
 *    earlier street on an unpaired board says less about the size he would
 *    have chosen (the stack capped it): it is read as at least a 90 percent
 *    pot barrel, weighted by how little is left behind (hands 59770288,
 *    59740955, 59768596);
 *  - a river lead into the turn aggressor on a paired board by a player who
 *    only called before is polarised like a raise, more so the larger the
 *    lead (hand 59730132);
 *  - a river bet into two or more players on a paired board is at least as
 *    strong as a 70 to 110 percent pot bet heads-up (hand 59775543);
 *  - a player who raised an earlier street and has bet every street since
 *    holds a raise-narrowed range (hand 59755179).
 */
export function omahaPricedFacingRange(i: OmahaPricedFacingRangeInput): {
  valueShare: number;
  priorBluff: number;
} {
  const line = i.lineAggressor ** i.aggressorStreets * i.lineCaller ** i.callerStreets;
  if (i.isRaise) return { valueShare: i.value.raise * line, priorBluff: i.bluff.raise };
  let size = Math.max(0, Number.isFinite(i.chosenFrac) ? i.chosenFrac : i.potFrac);
  if (!i.boardPaired && i.aggressorStreets >= 1) {
    const capped = 1 - omahaPricedRamp(i.behindShare, 0, 0.5);
    size += capped * Math.max(0, 0.9 - size);
  }
  let valueShare = omahaPricedBySize(rowsOf(i.value), size) * line;
  let priorBluff = omahaPricedBySize(rowsOf(i.bluff), size);
  if (i.street === 'river' && i.boardPaired) {
    if (i.aggressorStreets === 0 && i.callerStreets >= 1 && i.heroBetTurn) {
      const w = omahaPricedRamp(size, 0.2, 0.6);
      valueShare = lerp(valueShare, i.value.raise * i.lineAggressor ** i.callerStreets, w);
      priorBluff = lerp(priorBluff, i.bluff.raise, w);
    }
    if (i.others >= 1) {
      const w = omahaPricedRamp(size, 0.1, 0.4);
      valueShare = lerp(valueShare, Math.min(valueShare, i.value.big * line), w);
    }
  }
  if (i.street === 'river' && i.earlierRaised && i.aggressorStreets >= 2) {
    const w = omahaPricedRamp(size, 0.45, 0.95);
    valueShare *= 1 - 0.3 * w;
    priorBluff = lerp(priorBluff, Math.min(priorBluff, i.bluff.raise), w);
  }
  return { valueShare, priorBluff };
}

/**
 * The bluff prior of the continuous facing-bet range: MEASURED against what
 * the Horse actually won. Every turn and river bet a person made into a Horse,
 * heads-up, PLO4/PLO5 cash, 2026-11-13 19:40Z to 2026-11-17 19:40Z (995 bets;
 * every player's cards from the hand facts, so no showdown selection): the
 * comparison's win share against the bettor's REAL cards was too low at the
 * sizes people bet most (river 40-110 percent of the pot: predicted 0.20 to
 * 0.22, won 0.29, n 294; turn 70-110 percent: predicted 0.27, won 0.34 +/-
 * 0.015, n 337). Each row is the share q that makes the predicted win share
 * equal the measured one (q x the win share against the rest of his range +
 * (1 - q) x the win share against the value region), shrunk toward the
 * stepped prior with its 8 pseudo-bets (OMAHA_EV_SIZE_READ_PRIOR):
 *   river under 40: 0.092 +/- 0.069 (n 62) -> 0.096; 40-70: 0.251 +/- 0.051
 *   (n 120) -> 0.245; 70-110: 0.299 +/- 0.040 (n 174) -> 0.294; raise: 0.071
 *   +/- 0.056 (n 30) -> 0.073.
 *   turn under 40: 0.369 +/- 0.087 (n 62) -> 0.366; 40-70: 0.434 +/- 0.058
 *   (n 132) -> 0.432; 70-110: 0.299 +/- 0.034 (n 337) -> 0.297; raise:
 *   0.315 +/- 0.059 (n 78) -> 0.30.
 * Over 110 percent has no heads-up bet that was not a raise: it reads the
 * 70-110 row (flat beyond the last centre, as the stepped table does).
 * Standard errors by bootstrap; the two halves of the window agree within
 * two of them on every row with 100 or more bets. Read at the size centres
 * of OMAHA_PRICED_SIZE_CENTRES (the measured mean sizes are 0.24, 0.52,
 * 0.89 of the pot). Evidence: archive plo-handoff-review-01a1cbbd/
 * priced-01BNteGZ/calibration.
 */
export const OMAHA_PRICED_MEASURED_BLUFF: Readonly<Record<'turn' | 'river', OmahaPricedSizeTable>> =
  Object.freeze({
    river: Object.freeze({ under40: 0.096, mid: 0.245, big: 0.294, over: 0.294, raise: 0.073 }),
    turn: Object.freeze({ under40: 0.366, mid: 0.432, big: 0.297, over: 0.297, raise: 0.3 }),
  });

/**
 * A realization cap that a size line used to switch on (">= 40 percent of the
 * pot: at most 0.42"), as a continuous function of the size: no cap at or
 * below `lo`, the full cap at or above `hi`.
 */
export function omahaPricedRealizationCap(
  potFrac: number,
  lo: number,
  hi: number,
  cap: number
): number {
  return lerp(1, cap, omahaPricedRamp(potFrac, lo, hi));
}

/**
 * The multiplier on the population bluff prior from how often this bettor
 * bets beside the population (`ratio`: his posterior-mean bet rate over the
 * population mean; null: no evidence, 1). A player who bets less often than
 * the population with the same value hands has fewer bluffs in his bets; one
 * who bets more often has more. The exponent states how fast: at 1.5 a
 * player betting 0.8 times as often carries 0.72 of the prior, one betting
 * 0.6 times as often 0.46, one betting 1.3 times as often 1.48. The posterior
 * mean already shrinks toward the population with few opportunities
 * (HorseOpponentExploit.statRead), so a thin read moves this a little and a
 * deep read moves it fully; there is no step at a sample threshold and no
 * label.
 */
export const OMAHA_PRICED_BLUFF_RATE_EXPONENT = 1.5;
export const OMAHA_PRICED_BLUFF_FACTOR_MIN = 0.4;
export const OMAHA_PRICED_BLUFF_FACTOR_MAX = 1.6;
export function omahaPricedBluffFactor(ratio: number | null | undefined): number {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio) || !(ratio > 0)) return 1;
  return clamp(
    ratio ** OMAHA_PRICED_BLUFF_RATE_EXPONENT,
    OMAHA_PRICED_BLUFF_FACTOR_MIN,
    OMAHA_PRICED_BLUFF_FACTOR_MAX
  );
}
