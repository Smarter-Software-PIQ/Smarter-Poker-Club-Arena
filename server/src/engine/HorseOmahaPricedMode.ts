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
 * The bluff prior of a HORSE bettor, measured the same way on the same
 * window: every heads-up turn and river bet a Horse made into a Horse at the
 * tables of that window (PLO4/PLO5 cash with a person seated, 2026-11-13
 * 19:40Z to 2026-11-17 19:40Z, 934 bets, every player's cards from the hand
 * facts), the share q that makes the predicted win share equal the measured
 * one, shrunk toward the stepped prior with its 8 pseudo-bets:
 *   river under 40: 0.151 +/- 0.093 (n 50) -> 0.148; 40-70: 0.226 +/- 0.056
 *   (n 93) -> 0.219; 70-110: 0.126 +/- 0.029 (n 226) -> 0.128; raise: 0.154
 *   +/- 0.061 (n 34) -> 0.14.
 *   turn under 40: 0.122 +/- 0.056 (n 93) -> 0.139; 40-70: 0.140 +/- 0.043
 *   (n 143) -> 0.153; 70-110: 0.165 +/- 0.044 (n 221) -> 0.167; raise:
 *   0.254 +/- 0.051 (n 74) -> 0.244.
 * A Horse's turn bets hold about half the bluffs a person's do (0.14 to 0.17
 * against 0.30 to 0.43), and its large river bets less than half (0.128
 * against 0.294). Applying the person table to a Horse bettor was the loss of
 * all nine priced families on at Horse-only tables (archive
 * plo-handoff-review-01a1cbbd/priced-01BNteGZ/ALLON-DIAGNOSIS-20261118.md).
 * Evidence: archive plo-handoff-review-01a1cbbd/priced2-013U37/calib
 * (fit.py, fit-horse.json; the person rows of the same run reproduce
 * OMAHA_PRICED_MEASURED_BLUFF exactly). Standard errors by bootstrap.
 */
export const OMAHA_PRICED_MEASURED_BLUFF_HORSE: Readonly<
  Record<'turn' | 'river', OmahaPricedSizeTable>
> = Object.freeze({
  river: Object.freeze({ under40: 0.148, mid: 0.219, big: 0.128, over: 0.128, raise: 0.14 }),
  turn: Object.freeze({ under40: 0.139, mid: 0.153, big: 0.167, over: 0.167, raise: 0.244 }),
});

/**
 * A person's bet rate when checked to, by street: MEASURED, PLO4/PLO5 cash,
 * every hand with a person seated from 2026-11-13 19:40Z to 2026-11-17 19:40Z
 * (5,379 hands, 13 persons; archive plo-handoff-review-01a1cbbd/priced-01BNteGZ/
 * calibration): flop 843 of 2,913, turn 627 of 1,827, river 388 of 1,217
 * (PLO4 and PLO5 agree within 0.05 on every street). It replaces the
 * card-impact model's stated 0.45 where a priced comparison has no read of
 * the opponent, and it is the reference rate of the measured bluff prior
 * (OMAHA_PRICED_MEASURED_BLUFF, see omahaPricedBluffReferenceRatio). The
 * card-impact bluff share 0.3 stays for a person: the same calibration
 * measures the share of a person's 40-110 percent pot bets outside the value
 * region at 0.24 to 0.29 on the river and 0.30 to 0.43 on the turn.
 */
export const OMAHA_PRICED_PERSON_BET_CHECKED_TO: Readonly<Record<string, number>> = Object.freeze({
  flop: 0.289,
  turn: 0.343,
  river: 0.319,
});

/** The opponent kinds a prior is measured on. */
export type OmahaOpponentKind = 'person' | 'horse';

/**
 * Who plays a seat, from what the engine gives the decision: gs.humanUserIds
 * (ServerTableEngineTurns: the seats a person plays) when it is supplied,
 * else the seat's own is_horse flag. Null when neither says (offline
 * fixtures): the caller then keeps the prior in force before kinds existed.
 */
export function omahaOpponentKindOf(
  gs: {
    humanUserIds?: readonly string[] | null;
    players?: ReadonlyArray<{ user_id?: string | null; is_horse?: boolean | null }> | null;
  } | null,
  userId: string | null | undefined
): OmahaOpponentKind | null {
  if (!gs || !userId) return null;
  if (Array.isArray(gs.humanUserIds)) return gs.humanUserIds.includes(userId) ? 'person' : 'horse';
  const seat = (gs.players ?? []).find((p) => p?.user_id === userId);
  if (seat && typeof seat.is_horse === 'boolean') return seat.is_horse ? 'horse' : 'person';
  return null;
}

type Street3 = Readonly<Record<'flop' | 'turn' | 'river', number>>;
/**
 * Everything a priced comparison assumes about an opponent before it has
 * seen him, by his kind. ONE owner: every priced comparison takes its prior
 * from here (never a person figure for a Horse, never a Horse figure for a
 * person).
 *  - bluff: the facing-bet bluff prior (measured per kind, see above).
 *  - betCheckedTo / foldToBet: his kind's rate by street, and `pooled`, the
 *    same over all postflop streets (the pooled read counts all streets in
 *    one counter). MEASURED on the same 5,379 hands (archive
 *    priced-01BNteGZ/calibration/rates.json): persons bet 843/2,913,
 *    627/1,827, 388/1,217 when checked to and fold 546/1,662, 518/1,233,
 *    426/582 to a bet (flop, turn, river); Horses at those tables bet
 *    2,102/6,595, 1,572/3,903, 907/2,500 and fold 2,130/3,449, 1,385/2,341,
 *    757/1,042. For a Horse the read's own prior (the Horse envelope mean
 *    of this game and table size, HorseOpponentExploit) is used in
 *    preference wherever it is known, so a Horse with no opportunity reads
 *    exactly that prior.
 *  - cardImpactBluff: the share of his 40-110 percent pot bets outside the
 *    value region, the card-impact response model's bluff share. Person: the
 *    stated 0.3 the person calibration supports. Horse: the mean of the two
 *    measured 40-110 rows above (turn 0.16, river 0.17); a Horse's flop has
 *    no measurement and reads the turn figure.
 *  - bluffElasticity: how far the bluff share moves with his bet rate beside
 *    his kind's, as an exponent. MEASURED across bettors (archive
 *    priced2-013U37/calib/elasticity.json; heads-up turn/river bets split
 *    into thirds by the bettor's own turn/river bet rate, regression of log
 *    q on log rate, bootstrap over bettors): Horse -0.2 +/- 1.03 (113
 *    bettors, 704 bets), person +0.72 +/- 0.95 (10 bettors, 989 bets). The
 *    stated 1.5 had no measurement behind it. Each is shrunk toward "no
 *    relation" (0) with a unit prior: e / (1 + se^2): Horse -0.10, person
 *    0.38.
 */
export interface OmahaPricedKindPrior {
  readonly kind: OmahaOpponentKind | null;
  readonly bluff: Readonly<Record<'turn' | 'river', OmahaPricedSizeTable>>;
  readonly betCheckedTo: Street3 & { readonly pooled: number };
  readonly foldToBet: Street3 & { readonly pooled: number };
  readonly cardImpactBluff: Street3;
  readonly bluffElasticity: number;
}
const PERSON_PRIOR: OmahaPricedKindPrior = Object.freeze({
  kind: 'person' as const,
  bluff: OMAHA_PRICED_MEASURED_BLUFF,
  betCheckedTo: Object.freeze({ flop: 0.289, turn: 0.343, river: 0.319, pooled: 0.312 }),
  foldToBet: Object.freeze({ flop: 0.329, turn: 0.42, river: 0.732, pooled: 0.429 }),
  cardImpactBluff: Object.freeze({ flop: 0.3, turn: 0.3, river: 0.3 }),
  bluffElasticity: 0.38,
});
const HORSE_PRIOR: OmahaPricedKindPrior = Object.freeze({
  kind: 'horse' as const,
  bluff: OMAHA_PRICED_MEASURED_BLUFF_HORSE,
  betCheckedTo: Object.freeze({ flop: 0.319, turn: 0.403, river: 0.363, pooled: 0.352 }),
  foldToBet: Object.freeze({ flop: 0.618, turn: 0.592, river: 0.726, pooled: 0.625 }),
  cardImpactBluff: Object.freeze({ flop: 0.16, turn: 0.16, river: 0.17 }),
  bluffElasticity: -0.1,
});
/**
 * The prior in force before opponent kinds existed (#11212), for a seat whose
 * kind the decision does not know: the person-measured bluff table, the
 * person rates, the stated card-impact bluff share and the stated exponent
 * 1.5. Production and the league always know the kind.
 */
const UNKNOWN_PRIOR: OmahaPricedKindPrior = Object.freeze({
  kind: null,
  bluff: OMAHA_PRICED_MEASURED_BLUFF,
  betCheckedTo: PERSON_PRIOR.betCheckedTo,
  foldToBet: PERSON_PRIOR.foldToBet,
  cardImpactBluff: PERSON_PRIOR.cardImpactBluff,
  bluffElasticity: 1.5,
});
export function omahaPricedKindPrior(
  kind: OmahaOpponentKind | null | undefined
): OmahaPricedKindPrior {
  return kind === 'horse' ? HORSE_PRIOR : kind === 'person' ? PERSON_PRIOR : UNKNOWN_PRIOR;
}

/** HorseOpponentExploit.EXPLOIT_PRIOR_STRENGTH: the pseudo-opportunities behind a statRead posterior. */
export const OMAHA_PRICED_READ_PRIOR_STRENGTH = 6;
/**
 * A statRead posterior mean (shrunk toward `shrunkToward` with k
 * pseudo-opportunities) re-centred on `reference`: (hits + k x reference) /
 * (n + k). Exactly `reference` with no opportunity, the posterior's own
 * evidence with many: continuous at zero, no step. With no posterior the
 * reference itself.
 */
export function omahaPricedRecentred(
  stat: { mean: number; n: number } | null | undefined,
  shrunkToward: number | null | undefined,
  reference: number,
  k: number = OMAHA_PRICED_READ_PRIOR_STRENGTH
): number {
  if (!stat || !Number.isFinite(stat.mean) || !Number.isFinite(stat.n) || !(stat.n > 0))
    return reference;
  const n = stat.n;
  const toward = Number.isFinite(shrunkToward) ? (shrunkToward as number) : reference;
  return clamp(stat.mean + (k / (n + k)) * (reference - toward), 0, 1);
}

/**
 * His bet rate when checked to and the reference rate it is read against,
 * by his KIND (omahaPricedKindPrior). `stat` is his bet-when-checked-to
 * posterior from the pooled read (all postflop streets in one counter,
 * shrunk toward `envMean`, the Horse envelope mean of this game and table
 * size); `cell`, when the per-street read has one, his bets / opportunities
 * on `street`. For a Horse the reference is the envelope mean the posterior
 * already shrinks toward; for a person the person rate, the posterior
 * re-centred on it first. A street figure shrinks the cell toward the pooled
 * figure carried to that street in his kind's proportion (street rate over
 * pooled rate) and is read against his kind's rate on that street. So a
 * player with no opportunity reads exactly his kind's reference, and nobody
 * is read against another population's rate (the person-rate reference
 * applied to a Horse posterior read every Horse at a heads-up or short table
 * as betting 1.14 to 1.30 times a person: archive priced-01BNteGZ/
 * REVIEW-9f803db63df-013U37.md N2). Null when the kind is unknown and there
 * is no posterior.
 */
export function omahaPricedKindBetRate(
  stat: { mean: number; n: number } | null | undefined,
  envMean: number | null | undefined,
  kind: OmahaOpponentKind | null | undefined,
  street?: 'flop' | 'turn' | 'river',
  cell?: { hit: number; opp: number } | null
): { rate: number; reference: number } | null {
  const hasStat = !!stat && Number.isFinite(stat.mean) && Number.isFinite(stat.n) && stat.n > 0;
  const hasCell = !!cell && Number.isFinite(cell.opp) && Number.isFinite(cell.hit) && cell.opp > 0;
  if (kind !== 'person' && kind !== 'horse' && !hasStat && !hasCell) return null;
  const P = omahaPricedKindPrior(kind);
  const env = Number.isFinite(envMean) && (envMean as number) > 0 ? (envMean as number) : null;
  const pooledRef = kind === 'horse' && env !== null ? env : P.betCheckedTo.pooled;
  const pooled = omahaPricedRecentred(hasStat ? stat : null, env, pooledRef);
  if (street === undefined || !hasCell) return { rate: pooled, reference: pooledRef };
  const scale = P.betCheckedTo[street] / P.betCheckedTo.pooled;
  const streetRef = pooledRef * scale;
  const prior = clamp(pooled * scale, 0, 1);
  const opp = Math.max(0, cell!.opp);
  const hit = clamp(cell!.hit, 0, opp);
  const k = OMAHA_PRICED_READ_PRIOR_STRENGTH;
  return { rate: (hit + prior * k) / (opp + k), reference: streetRef };
}

/**
 * THE ONE OWNER of "his bet rate beside the rate his bluff prior belongs to"
 * (omahaPricedKindBetRate's rate over its reference). Every priced
 * comparison reads it through the priced read (HorseOmahaPricedRules
 * .omahaPricedRead, field betRatio); none computes its own.
 */
export function omahaPricedBluffReferenceRatio(
  stat: { mean: number; n: number } | null | undefined,
  envMean: number | null | undefined,
  kind: OmahaOpponentKind | null | undefined,
  street?: 'flop' | 'turn' | 'river',
  cell?: { hit: number; opp: number } | null
): number | null {
  const r = omahaPricedKindBetRate(stat, envMean, kind, street, cell);
  return r !== null && r.reference > 0 ? r.rate / r.reference : null;
}

/**
 * The merged (#11212) reference of a decision whose opponent kind is unknown:
 * with the measured prior in force his absolute rate over a person's rate on
 * the street, else the Horse-mean ratio the read supplies.
 */
export function omahaPricedLegacyBluffReferenceRatio(
  betCheckedTo: number | null | undefined,
  betCheckedToRatio: number | null | undefined,
  street: 'turn' | 'river' | undefined
): number | null {
  if (omahaPricedModeNow().rangeContinuous && street !== undefined) {
    const ref = OMAHA_PRICED_PERSON_BET_CHECKED_TO[street];
    return Number.isFinite(betCheckedTo) && ref > 0 ? (betCheckedTo as number) / ref : null;
  }
  return Number.isFinite(betCheckedToRatio) ? (betCheckedToRatio as number) : null;
}

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
 * The multiplier on the bluff prior from how often this bettor bets beside
 * his kind (`ratio`, from omahaPricedBluffReferenceRatio; null: no evidence,
 * 1): ratio ^ (his kind's measured elasticity), clamped to 0.4..1.6. The
 * posterior already shrinks toward his kind's rate with few opportunities, so
 * a thin read moves this a little and a deep one fully; there is no step at a
 * sample threshold and no label. An unknown kind keeps the stated 1.5.
 */
export const OMAHA_PRICED_BLUFF_RATE_EXPONENT = 1.5;
export const OMAHA_PRICED_BLUFF_FACTOR_MIN = 0.4;
export const OMAHA_PRICED_BLUFF_FACTOR_MAX = 1.6;
export function omahaPricedBluffFactor(
  ratio: number | null | undefined,
  kind?: OmahaOpponentKind | null
): number {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio) || !(ratio > 0)) return 1;
  return clamp(
    ratio ** omahaPricedKindPrior(kind).bluffElasticity,
    OMAHA_PRICED_BLUFF_FACTOR_MIN,
    OMAHA_PRICED_BLUFF_FACTOR_MAX
  );
}
