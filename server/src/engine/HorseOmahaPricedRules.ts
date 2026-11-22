/**
 * OMAHA PRICED RULES: THE COMPARISONS (2026-11-17, PLO Strategy lane).
 *
 * Owner, 2026-11-17 11:49 Chicago: "there should not be any blanket rules,
 * you need to coordinate and re write any and all "blanket rules" to be fully
 * adaptable to real time decisions, a blanket rule shouldn't be allowed to
 * effect a decision, they must all be done by math, gto, players hand or
 * preceived range of hands as well as the opponents range of hand, equity, EV
 * etc."
 *
 * The PLO4/PLO5 cash rules the audit of 2026-11-17 (archive
 * plo-handoff-review-01a1cbbd/rules-audit-01BNteGZ) marks as deciding by bet
 * size, chips, stack share, hand category, betting line or opponent label
 * each become, behind their own default-OFF option, one of three priced
 * comparisons of the candidate actions. Nothing here is a new engine: each
 * comparison is assembled from the pricing the lane already runs.
 *
 *  RAISE, CALL OR FOLD, TURN AND RIVER (omahaPricedRaise). The exact counts
 *    of HorseOmahaFacingBetEv (every opponent holding scored on the board
 *    with the Horse's own cards, the board and known dead cards removed, so
 *    the bettor's value region is conditioned on the Horse's blockers) give
 *    EV(call). EV(raise to each candidate size) is the model
 *    HorseOmahaStrongHandValue uses for nut-class hands, without the hand
 *    gate: his bluffs fold first; of his value region the strongest part
 *    continues, sized by the price the raise lays him and by his measured
 *    fold rates; the Horse wins the raise from the continuing holdings it
 *    beats and loses it to those that beat it. A raise that is called mostly
 *    by better hands therefore prices below the call (the knowledge the
 *    "raise only with the nuts" rules encoded), and a raise against a player
 *    measured to fold to raises prices above it, with any hand.
 *
 *  RAISE OR CALL, FLOP AND TURN, BY SAMPLE (omahaPricedSampledRaise). The
 *    seeded sample of HorseOmahaBigDrawAggression (opponent hands from the
 *    unseen cards, run out) gives the Horse's share against every hand,
 *    against the range that continues against a bet and against the range
 *    that continues against a raise; fold equity is the opponent's measured
 *    fold rate (the population figure without one). Out of position the
 *    Horse realizes less of its share on both lines. With
 *    omahaSampledRaiseIsPricedAtEverySize the fold, the call and a raise to
 *    each legal size are priced, the fold share read at the price each raise
 *    lays each opponent (OMAHA_PRICED_SAMPLED_REFERENCE_FOLD) and the share
 *    held when called taken against the part of the range that continues
 *    at that price (omahaPricedSampledContinuingShare).
 *
 *  BET OR CHECK, TURN AND RIVER (omahaPricedBet). HorseOmahaCardImpact prices
 *    a check and every bet size against each opponent's range as his line
 *    left it; two or more opponents are combined as HorseOmahaStrongHandValue
 *    combines them. Every size is a candidate, value bet or bluff: a bet is
 *    made when it is worth more than the check.
 *
 * THE OPPONENT READ (OmahaPricedRead) is one interface. Today it is built
 * from the pooled read (HorseOmahaReadConditional); a per-street, per-texture
 * read (OmahaPricedStreetRates: the cell of HorseOmahaStreetRead for this
 * street and board) is taken through the same call and, where a cell is
 * known, is shrunk toward the pooled figure by its own opportunity count.
 * Every rate is a posterior mean that shrinks toward the population with few
 * (decayed) opportunities: a thin or stale read moves a comparison a little,
 * a deep fresh one moves it fully, and there is no sample threshold and no
 * label anywhere in this file.
 *
 * Pure: no telemetry, no opponent memory, no draw from the brain's random
 * stream (the sampled comparison uses the big-draw module's private seeded
 * stream; the mixing draw is a hash of public state).
 */
import type { Card, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import type { OmahaReadConditional } from './HorseOmahaReadConditional.js';
import {
  OMAHA_EV_ALL_IN_SHARE,
  OMAHA_EV_BEHIND_SHARE,
  OMAHA_EV_CALLER_SHARE,
  OMAHA_EV_UNKNOWN_READ,
  omahaEvHandCounts,
  omahaEvHandCountsSixCardTurn,
  omahaFacingBetEvSpot,
  omahaFacingBetEvVerdict,
  type OmahaEvHandCounts,
  type OmahaFacingBetEvRead,
  type OmahaFacingBetEvSpot,
  type OmahaFacingBetEvVerdict,
} from './HorseOmahaFacingBetEv.js';
import {
  OMAHA_CARD_IMPACT_PRIOR,
  omahaCardImpact,
  omahaCardImpactAmounts,
  omahaCardImpactLine,
  type OmahaCardImpact,
  type OmahaCardImpactRead,
} from './HorseOmahaCardImpact.js';
import {
  OMAHA_BIG_DRAW_OOP_REALISATION,
  OMAHA_BIG_DRAW_PRIOR_FOLD_TO_BET,
  OMAHA_BIG_DRAW_RAISE_FOLD_SCALE,
  OMAHA_BIG_DRAW_SAMPLES,
  omahaBigDrawEquities,
  type OmahaBigDrawCounts,
  type OmahaBigDrawEquities,
} from './HorseOmahaBigDrawAggression.js';
import {
  OMAHA_PRICED_PERSON_BET_CHECKED_TO,
  OMAHA_PRICED_READ_PRIOR_STRENGTH,
  omahaPricedBluffFactor,
  omahaPricedKindBetRate,
  omahaPricedKindPrior,
  omahaPricedRecentred,
  type OmahaOpponentKind,
} from './HorseOmahaPricedMode.js';

export const OMAHA_PRICED_VARIANTS: ReadonlySet<string> = new Set(['plo4', 'plo5']);

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 10000) / 10000;

// ───────────────────────────── the read ─────────────────────────────

/** One success / opportunity pair of the per-street read (HorseOmahaStreetRead.StreetReadCell). */
export interface OmahaPricedCell {
  hit: number;
  opp: number;
  /**
   * The mean minimum-defence price of the raises behind a fold-to-raise cell (the mean of
   * increment / (pot + call + increment) over its opportunities). The street read's cells are exactly
   * {hit, opp}; the price comes from the opponent's separate price record (set on the cell by
   * HorseOmahaReadByStreetRule only with omahaSampledRaiseIsPricedAtEverySize on, horse decisions
   * stack 2); read only by omahaPricedSampledFoldAtPrice
   * (omahaSampledRaiseIsPricedAtEverySize). Absent: the cell is taken as measured at the frozen
   * reference price (OMAHA_PRICED_SAMPLED_REFERENCE_FOLD), which holds only for raises made through
   * OMAHA_PRICED_SAMPLED_REFERENCE_MEASURED_THROUGH.
   */
  price?: number | null;
}
/**
 * The per-street, per-texture cells for the street and board of the decision,
 * as the street read answers them; a null cell is unknown. The whole object
 * is null until that read is delivered to decisions: the pooled read then
 * answers alone.
 */
export interface OmahaPricedStreetRates {
  bet: OmahaPricedCell | null;
  foldToBet: OmahaPricedCell | null;
  foldToRaise: OmahaPricedCell | null;
}
/** Population figures the posteriors shrink toward (the Horse mean of this game and table size). */
export interface OmahaPricedPopulation {
  bet: number | null;
  foldToBet: number | null;
}
/** Pseudo-opportunities behind the figure a street cell shrinks toward (HorseOpponentExploit's prior strength).
 *  One figure with the posterior re-centring (HorseOmahaPricedMode.OMAHA_PRICED_READ_PRIOR_STRENGTH, 6). */
export const OMAHA_PRICED_SHRINK = OMAHA_PRICED_READ_PRIOR_STRENGTH;

/** (hit + prior x k) / (opp + k): continuous in the opportunity count, the prior at none. */
export function omahaPricedShrunk(
  cell: OmahaPricedCell | null | undefined,
  prior: number,
  k: number = OMAHA_PRICED_SHRINK
): number {
  if (!cell || !fin(cell.opp) || !fin(cell.hit) || !(cell.opp > 0)) return prior;
  const opp = Math.max(0, cell.opp);
  const hit = clamp(cell.hit, 0, opp);
  return (hit + prior * k) / (opp + k);
}

/** A read's copy of a fold-to-raise cell: {hit, opp}, and the price it was measured at where the cell carries one. */
function omahaPricedFoldToRaiseCellOf(c: OmahaPricedCell): OmahaPricedCell {
  return fin(c.price) && c.price > 0
    ? { hit: c.hit, opp: c.opp, price: c.price }
    : { hit: c.hit, opp: c.opp };
}

export interface OmahaPricedRead {
  /** where the figures came from: the street cells, the pooled read, or nothing (the comparisons' priors) */
  source: 'street' | 'pooled' | 'prior';
  /** posterior mean of his fold to a bet; null with no evidence at all */
  foldToBet: number | null;
  /** his bet rate when checked to (posterior mean), and beside the population mean; null with no evidence */
  betCheckedTo: number | null;
  betRatio: number | null;
  /** posterior mean of his river call rate; null with no evidence */
  riverCall: number | null;
  /** the street read's fold-to-raise cell; shrunk at use toward the comparison's own figure at that price */
  foldToRaise: OmahaPricedCell | null;
  /** decayed opportunities behind the fold-to-bet figure (0: none) */
  opportunities: number;
  /** who he is (HorseOmahaPricedMode.omahaOpponentKindOf); null: unknown, the merged figures. With a kind the
   *  fold-to-bet and bet figures are his posterior re-centred on HIS KIND's prior (omahaPricedKindPrior): never
   *  null, exactly the kind's prior with no opportunity, and betRatio is his rate over his kind's reference
   *  rate. riverCall is NOT re-centred: it is his posterior mean as read (null with no opportunity). */
  kind?: OmahaOpponentKind | null;
  /** betCheckedTo is the pooled all-street figure ('pooled') or this street's ('street') */
  betScope?: 'pooled' | 'street';
}
export const OMAHA_PRICED_NO_READ: OmahaPricedRead = Object.freeze({
  source: 'prior',
  foldToBet: null,
  betCheckedTo: null,
  betRatio: null,
  riverCall: null,
  foldToRaise: null,
  opportunities: 0,
});

/**
 * THE ONE INTERFACE between the opponent memory and every priced comparison.
 * `pooled` is today's read (its statistics are posterior means that already
 * shrink toward the population; its labels are not read). `street` is the
 * per-street / per-texture read's cells for this decision, or null: a known
 * cell replaces the pooled figure after shrinking toward it by its own
 * opportunity count.
 */
export function omahaPricedRead(
  pooled: OmahaReadConditional | null,
  population: OmahaPricedPopulation | null,
  street: OmahaPricedStreetRates | null = null,
  kind: OmahaOpponentKind | null = null,
  streetName?: 'flop' | 'turn' | 'river'
): OmahaPricedRead {
  if (kind !== 'person' && kind !== 'horse')
    return omahaPricedReadUnknownKind(pooled, population, street);
  const K = omahaPricedKindPrior(kind);
  const statOf = (s: { mean: number; n: number } | undefined) =>
    s && fin(s.mean) && fin(s.n) && s.n > 0 ? { mean: clamp(s.mean, 0, 1), n: s.n } : null;
  const popBet = population && fin(population.bet) && population.bet > 0 ? population.bet : null;
  const popFold =
    population && fin(population.foldToBet) ? clamp(population.foldToBet, 0, 1) : null;
  const known = (c: OmahaPricedCell | null | undefined): c is OmahaPricedCell =>
    !!c && fin(c.opp) && fin(c.hit) && c.opp > 0;
  const betStat = pooled ? statOf(pooled.betCheckedTo) : null;
  const foldStat = pooled ? statOf(pooled.foldToBet) : null;
  const riverStat = pooled ? statOf(pooled.riverCall) : null;
  let source: OmahaPricedRead['source'] = betStat || foldStat || riverStat ? 'pooled' : 'prior';
  // fold to a bet: his posterior re-centred on his kind's prior (a Horse's: the envelope mean his
  // posterior already shrinks toward), then a street cell shrunk toward it in his kind's proportion
  const foldRef = kind === 'horse' && popFold !== null ? popFold : K.foldToBet.pooled;
  let foldToBet = omahaPricedRecentred(foldStat, popFold, foldRef);
  let opportunities = foldStat ? foldStat.n : 0;
  if (street && known(street.foldToBet)) {
    const scale = streetName ? K.foldToBet[streetName] / K.foldToBet.pooled : 1;
    foldToBet = omahaPricedShrunk(street.foldToBet, clamp(foldToBet * scale, 0, 1));
    opportunities = street.foldToBet.opp;
    source = 'street';
  }
  const cell = street && known(street.bet) ? street.bet : null;
  if (cell) source = 'street';
  const bet = omahaPricedKindBetRate(betStat, popBet, kind, cell ? streetName : undefined, cell)!;
  let foldToRaise: OmahaPricedCell | null = null;
  if (street && known(street.foldToRaise)) {
    foldToRaise = omahaPricedFoldToRaiseCellOf(street.foldToRaise);
    source = 'street';
  }
  return {
    source,
    foldToBet,
    betCheckedTo: bet.rate,
    betRatio: bet.reference > 0 ? bet.rate / bet.reference : null,
    riverCall: riverStat ? riverStat.mean : null,
    foldToRaise,
    opportunities,
    kind,
    betScope: cell && streetName ? 'street' : 'pooled',
  };
}

/** The merged (#11212) read, for an opponent whose kind the decision does not know. */
function omahaPricedReadUnknownKind(
  pooled: OmahaReadConditional | null,
  population: OmahaPricedPopulation | null,
  street: OmahaPricedStreetRates | null
): OmahaPricedRead {
  const stat = (s: { mean: number; n: number } | undefined): number | null =>
    s && fin(s.mean) && fin(s.n) && s.n > 0 ? clamp(s.mean, 0, 1) : null;
  let foldToBet = pooled ? stat(pooled.foldToBet) : null;
  let betCheckedTo = pooled ? stat(pooled.betCheckedTo) : null;
  const riverCall = pooled ? stat(pooled.riverCall) : null;
  let opportunities = pooled && fin(pooled.foldToBet?.n) ? Math.max(0, pooled.foldToBet.n) : 0;
  let source: OmahaPricedRead['source'] =
    foldToBet !== null || betCheckedTo !== null || riverCall !== null ? 'pooled' : 'prior';
  const popBet = population && fin(population.bet) && population.bet > 0 ? population.bet : null;
  const popFold =
    population && fin(population.foldToBet) ? clamp(population.foldToBet, 0, 1) : null;
  let foldToRaise: OmahaPricedCell | null = null;
  if (street) {
    const known = (c: OmahaPricedCell | null): c is OmahaPricedCell =>
      c !== null && fin(c.opp) && fin(c.hit) && c.opp > 0;
    if (known(street.foldToBet)) {
      foldToBet = omahaPricedShrunk(
        street.foldToBet,
        foldToBet ?? popFold ?? OMAHA_BIG_DRAW_PRIOR_FOLD_TO_BET
      );
      opportunities = street.foldToBet.opp;
      source = 'street';
    }
    if (known(street.bet)) {
      betCheckedTo = omahaPricedShrunk(
        street.bet,
        betCheckedTo ?? popBet ?? OMAHA_CARD_IMPACT_PRIOR.betCheckedTo
      );
      source = 'street';
    }
    if (known(street.foldToRaise)) {
      foldToRaise = omahaPricedFoldToRaiseCellOf(street.foldToRaise);
      source = 'street';
    }
  }
  return {
    source,
    foldToBet,
    betCheckedTo,
    betRatio: betCheckedTo !== null && popBet !== null ? betCheckedTo / popBet : null,
    riverCall,
    foldToRaise,
    opportunities,
  };
}

/** The facing-bet read with the bet-rate ratio of the priced read (no `measured` threshold on it). */
export function omahaPricedFacingBetRead(
  base: OmahaFacingBetEvRead | null,
  read: OmahaPricedRead
): OmahaFacingBetEvRead {
  return {
    ...(base ?? OMAHA_EV_UNKNOWN_READ),
    betCheckedToRatio: read.betRatio,
    betCheckedTo: read.betCheckedTo,
    kind: read.kind ?? null,
  };
}

export { OMAHA_PRICED_PERSON_BET_CHECKED_TO };

/** The card-impact response model's read, from the priced read: continuous, no label. */
export function omahaPricedCardImpactRead(
  read: OmahaPricedRead,
  street?: string
): OmahaCardImpactRead {
  const P = OMAHA_CARD_IMPACT_PRIOR;
  if (read.kind === 'person' || read.kind === 'horse') {
    // His kind's prior, continuous at zero opportunities (REVIEW-9f803db63df-013U37.md N3): the fold rate,
    // bet rate and bluff share all start at his kind's measured figure and move with his posterior; the
    // bet rate is carried to this street in his kind's proportion when it is the pooled figure.
    const K = omahaPricedKindPrior(read.kind);
    const st = street === 'flop' || street === 'turn' || street === 'river' ? street : null;
    const scale =
      st !== null && read.betScope !== 'street' ? K.betCheckedTo[st] / K.betCheckedTo.pooled : 1;
    return {
      measured: read.foldToBet !== null,
      continueRate: read.foldToBet === null ? null : 1 - read.foldToBet,
      riverCallRate: read.riverCall,
      betCheckedTo:
        read.betCheckedTo !== null
          ? clamp(read.betCheckedTo * scale, 0, 1)
          : st !== null
            ? K.betCheckedTo[st]
            : P.betCheckedTo,
      bluffShare: clamp(
        (st !== null ? K.cardImpactBluff[st] : K.cardImpactBluff.turn) *
          omahaPricedBluffFactor(read.betRatio, read.kind),
        0.05,
        0.6
      ),
    };
  }
  return {
    measured: read.foldToBet !== null,
    continueRate: read.foldToBet === null ? null : 1 - read.foldToBet,
    riverCallRate: read.riverCall,
    betCheckedTo:
      read.betCheckedTo ??
      (street !== undefined ? OMAHA_PRICED_PERSON_BET_CHECKED_TO[street] : undefined) ??
      P.betCheckedTo,
    bluffShare: clamp(P.bluffShare * omahaPricedBluffFactor(read.betRatio), 0.05, 0.6),
  };
}

// ─────────────────── raise, call or fold: turn and river ───────────────────

/** A raise must be worth this share of the pot more than the best other action (HorseOmahaStrongHandValue's margin). */
export const OMAHA_PRICED_RAISE_MARGIN = 0.04;
/**
 * The share of a bettor's range that raises again when his turn or river bet
 * is raised. MEASURED, PLO4/PLO5 cash, heads-up, 2026-11-10 to 2026-11-15
 * (archive plo-handoff-review-01a1cbbd/full-sweep-20261115, the response to
 * a Horse's raise): raised again 14 of 54 turn and river raises (turn 9 of
 * 39, river 5 of 15). It replaces the card-impact model's stated 0.10, which
 * has no measurement behind it. The same file gives the fold to a raise: turn
 * 9 of 39 (0.23), river 5 of 15 (0.33), together 14 of 54 (0.26), against the
 * minimum-defence figure at the prices those raises laid of 0.25: the
 * population fold-to-raise prior used here (1 - price) agrees with it. The
 * responders are persons and Horses together (the file does not say which).
 */
export const OMAHA_PRICED_RERAISE_SHARE = 0.26;
/**
 * The population's fold to a turn or river raise, at the prices those raises laid. MEASURED,
 * PLO4/PLO5 cash, heads-up, 2026-11-10 to 2026-11-15 (the same file as OMAHA_PRICED_RERAISE_SHARE):
 * folded 14 of 54 turn and river raises (turn 9 of 39, river 5 of 15). The street read's
 * fold-to-raise cell is shrunk toward it and read as a ratio to it.
 */
export const OMAHA_PRICED_FOLD_TO_RAISE_POPULATION = 14 / 54;

/**
 * How many times as often as the population he folds to a raise: the street read's fold-to-raise
 * cell shrunk toward the population figure by its own opportunity count, over that figure. 1 with
 * no cell. The cell counts raises of every size; the price of the raise being priced carries the size.
 */
export function omahaPricedFoldToRaiseRatio(cell: OmahaPricedCell | null | undefined): number {
  const P = OMAHA_PRICED_FOLD_TO_RAISE_POPULATION;
  return omahaPricedShrunk(cell, P) / P;
}
/** Raise sizes priced: the minimum, the middle and the maximum legal raise, and the proposed one. */
export const OMAHA_PRICED_RAISE_STEPS: readonly number[] = [0, 0.5, 1];

export interface OmahaPricedRaiseRow {
  /** the street total the raise is made to */
  to: number;
  allIn: boolean;
  ev: number;
  /** the share of his betting range that continues, and of all holdings the region that does */
  continues: number;
  region: number;
  /** against the continuing holdings: the Horse wins / loses (exact count) */
  win: number;
  lose: number;
  /** the continuing holdings it beats outnumber those that beat it; false: the raise earns by folds (a bluff) */
  value: boolean;
}

export interface OmahaPricedRaiseVerdict {
  action: 'fold' | 'call' | 'raise' | 'all_in';
  /** the raise-to amount when the action is a raise */
  amount: number;
  evCall: number;
  /** the facing-bet verdict's own answer (EV of the call over its margin) */
  callStands: boolean;
  margin: number;
  /** the raise of highest expected value, value or bluff */
  best: OmahaPricedRaiseRow | null;
  rows: OmahaPricedRaiseRow[];
  bluffShare: number;
  valueShare: number;
  /** the share of all holdings that beat the hand (exact) */
  beaten: number;
  spot: OmahaFacingBetEvSpot;
  call: OmahaFacingBetEvVerdict;
}

export interface OmahaPricedRaiseContext {
  /** the bettor's facing-bet read (his bluff share) */
  bettorRead?: OmahaFacingBetEvRead | null;
  /** the bettor's priced read (his fold rates) */
  read?: OmahaPricedRead | null;
  rake?: number;
  /** the engine's realization factor for turn chips that see a river decision */
  realization?: number;
  /** a raise-to amount another owner proposed: priced beside the steps */
  proposedTo?: number;
  /** omahaRaiseEvCountsLossesOnce (off-only): the re-raisers' losses counted once; absent/false: #11212 */
  lossesOnce?: boolean;
  /**
   * plo6FacingBetIsPriced's own caller (HorsePlo6FacingBetIsPriced.ts): the PLO6 cash turn or river spot
   * (omahaFacingBetEvSpot scope plo6Priced), the six-card exact count on the turn as on the river, and
   * no random-hand fold guard (plo6RiverNuts / plo6RiverUnpaired false). Absent: exactly as before.
   */
  plo6Priced?: boolean;
}

/**
 * Fold, call and a raise to each candidate size priced on the Horse's exact
 * hand against the bettor's range for this bet, line and board. Null when the
 * spot is not a PLO4/PLO5 cash turn or river facing-bet spot or the hand
 * cannot be counted. With no legal raise the rows are empty and the answer is
 * the call or the fold.
 */
export function omahaPricedRaise(
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  ctx: OmahaPricedRaiseContext = {}
): OmahaPricedRaiseVerdict | null {
  try {
    const plo6Priced = ctx.plo6Priced === true;
    const spot = plo6Priced
      ? omahaFacingBetEvSpot(hero, gs, { plo6Priced: true })
      : omahaFacingBetEvSpot(hero, gs);
    if (!spot) return null;
    const hole: Card[] = hero.cards ?? [];
    const board: Card[] = gs.communityCards ?? [];
    const dead: Card[] = hero.knownDeadCards ?? [];
    const call = omahaFacingBetEvVerdict(spot, hole, board, dead, ctx.bettorRead ?? null, {
      rake: ctx.rake,
      realization: ctx.realization,
      ...(plo6Priced ? { sixCardTurn: true, plo6RiverNuts: false, plo6RiverUnpaired: false } : {}),
    });
    let counts: OmahaEvHandCounts | null = null;
    try {
      counts = plo6Priced
        ? omahaEvHandCountsSixCardTurn(hole, board, dead, spot.valueShare)
        : omahaEvHandCounts(hole, board, dead, spot.valueShare);
    } catch {
      counts = null;
    }
    if (!call || !counts) return null;
    const rake = clamp(fin(ctx.rake) ? ctx.rake : 0, 0, 0.2);
    const win = spot.winnable * (1 - rake);
    const margin = OMAHA_PRICED_RAISE_MARGIN * gs.pot;
    const base = {
      evCall: round2(call.ev),
      callStands: call.call,
      margin: round2(margin),
      bluffShare: round4(call.bluffShare),
      valueShare: round4(counts.valueShare),
      beaten: round4(Math.max(0, 1 - counts.all.win - counts.all.tie)),
      spot,
      call,
    };
    const passive = (rows: OmahaPricedRaiseRow[], best: OmahaPricedRaiseRow | null) => ({
      ...base,
      action: (call.call ? 'call' : 'fold') as 'call' | 'fold',
      amount: 0,
      best,
      rows,
    });
    const bettor = (gs.players ?? []).find((p) => p.seat === spot.bettorSeat);
    if (spot.allIn || !bettor || bettor.is_all_in || !fin(bettor.stack) || !(bettor.stack > 0.005))
      return passive([], null);
    const menu = Array.isArray(gs.legalActions) ? gs.legalActions : null;
    const canRaise = menu === null || menu.includes('raise');
    const canShove = menu === null || menu.includes('all_in');
    if (!canRaise && !canShove) return passive([], null);
    const heroBet = fin(hero.bet) ? Math.max(0, hero.bet) : 0;
    const cur = gs.currentBet;
    const toCall = spot.paid;
    const heroAll = heroBet + hero.stack;
    if (!(heroAll > cur + 0.005)) return passive([], null);
    const potTo = heroBet + toCall + gs.pot + toCall;
    const maxTo = Math.min(fin(gs.maxRaiseTo) ? gs.maxRaiseTo : potTo, heroAll, cur + bettor.stack);
    const minTo = fin(gs.minRaiseTo) ? gs.minRaiseTo : cur * 2;
    const whole = (gs.bigBlind ?? 1) >= 1;
    const sizes: number[] = [];
    const add = (raw: number): void => {
      const to = round2(clamp(whole ? Math.round(raw) : round2(raw), minTo, maxTo));
      const shove = to >= heroAll - 0.005;
      if (shove ? !canShove : !canRaise) return;
      if (!sizes.includes(to)) sizes.push(to);
    };
    if (maxTo + 0.005 < minTo) {
      if (canShove && heroAll <= maxTo + 0.005) sizes.push(round2(heroAll));
    } else {
      for (const f of OMAHA_PRICED_RAISE_STEPS) add(minTo + f * (maxTo - minTo));
      if (fin(ctx.proposedTo) && ctx.proposedTo > cur + 0.005) add(ctx.proposedTo);
    }
    if (sizes.length === 0) return passive([], null);

    const read = ctx.read ?? OMAHA_PRICED_NO_READ;
    const q = call.bluffShare;
    const river = spot.street === 'river';
    // The strongest share of holdings of at least `region`: a region smaller than the top
    // strength class takes that class (the count answers no smaller one).
    const topOf = (region: number) => {
      let r = counts!.top(region);
      for (const f of [1.5, 2, 3, 5, 8]) {
        if (r.share > 0) break;
        r = counts!.top(Math.min(0.95, region * f));
      }
      return r;
    };
    // The field: every other player in the hand must fold or be beaten too.
    const holds = (share: number): number => {
      const s = counts!.top(share);
      return s.win + s.tie * 0.5;
    };
    const allInField = spot.allIns > 0 ? holds(OMAHA_EV_ALL_IN_SHARE) ** spot.allIns : 1;
    const rows: OmahaPricedRaiseRow[] = [];
    for (const to of sizes) {
      const put = to - heroBet;
      const his = Math.min(to - cur, bettor.stack);
      if (!(his > 0.005) || !(put > toCall + 0.005)) continue;
      const allIn = to >= heroAll - 0.005;
      // The share of his betting range that folds to the raise. The population figure is the
      // minimum-defence one at the price the raise lays him (1 - price). Only a measured fold
      // to a RAISE moves it: the street read's fold-to-raise cell, shrunk toward the
      // minimum-defence figure by its own opportunity count. That cell counts raises of every
      // size, so it is not the fold to THIS raise: read alone, a minimum raise bought the fold
      // of a pot raise for a fraction of the chips, and two Horses facing each other's minimum
      // raises re-raised by the minimum until the stacks were in (plo-truncation-013U37). So the
      // read is also taken AT THIS PRICE (the minimum-defence figure times how much more or less
      // often than the population he folds to a raise), and the fold priced is the smaller of the
      // two: a read never makes a raise worth more than either reading of it. With no cell both
      // are the minimum-defence figure. A fold to a bet when checked to is not read as a fold to
      // a raise (a player who bets holds a range he chose to bet).
      const price = (win + toCall) / (win + toCall + his);
      const modelFold = clamp(1 - price, 0.03, 0.95);
      const folds = Math.min(
        omahaPricedShrunk(read.foldToRaise, modelFold),
        modelFold * omahaPricedFoldToRaiseRatio(read.foldToRaise)
      );
      const keep = clamp(1 - folds, 0.03, 0.97);
      // RIVER: his bluffs fold first, so the continuing part comes out of his value region.
      // TURN: the part of his bets that is not value holds draws, and a draw does not fold
      // to a raise at a good price. When more of his range continues than his value region
      // holds, the rest comes from those other holdings, and the Horse's share against them
      // is the counted one (every river card dealt out).
      let continues = Math.min(1 - q, keep);
      let region = clamp((counts.valueShare * continues) / Math.max(1e-9, 1 - q), 0.001, 0.95);
      let top: { win: number; tie: number } = topOf(region);
      if (!river && keep > 1 - q) {
        continues = keep;
        region = counts.valueShare;
        const a = (1 - q) / keep;
        top = {
          win: a * counts.value.win + (1 - a) * counts.other.win,
          tie: a * counts.value.tie + (1 - a) * counts.other.tie,
        };
      }
      // Chips that see a later decision realize less than their share.
      const real =
        river || allIn ? 1 : clamp(fin(ctx.realization) ? ctx.realization : 0.85, 0.5, 1);
      // A raise that is not all in can be raised again: the strongest part of his range does
      // (OMAHA_PRICED_RERAISE_SHARE), and the Horse gives up its raise to it unless its hand
      // holds against that part.
      // That part is counted ONCE (REVIEW-9f803db63df-013U37.md N1): it is the top `again` of the
      // continuing part, in the same units (holdings = value share x betting-range share / (1 - q)).
      // Against it the Horse folds and gives up its raise where it is beaten and keeps its called
      // result where it holds; the rest of the continuing part is priced on the continuing holdings
      // WITHOUT that top. (Before, `called` was averaged over the whole continuing part, the top
      // included, and the top's losses were then charged again.)
      const again = allIn ? 0 : Math.min(OMAHA_PRICED_RERAISE_SHARE, continues);
      let alone: number;
      if (ctx.lossesOnce === true) {
        const at =
          again > 1e-6
            ? topOf(clamp((counts.valueShare * again) / Math.max(1e-9, 1 - q), 0.001, 0.95))
            : null;
        alone = omahaPricedRaiseAloneEv({
          win,
          his,
          put,
          rake,
          real,
          continues,
          continuing: top,
          again,
          reraisers: at,
        });
      } else {
        // #11212 verbatim (omahaRaiseEvCountsLossesOnce off): the called result averaged over the whole
        // continuing part, the re-raisers' losses then charged again.
        const w = top.win * real;
        const t = top.tie * real;
        const lose = Math.max(0, 1 - w - t);
        const called = w * (win + his * (1 - rake)) + t * ((win + his - put) / 2) - lose * put;
        const againTop = again > 0 ? topOf(clamp(counts.valueShare * again, 0.001, 0.95)) : null;
        const lost = againTop ? again * Math.max(0, 1 - againTop.win - againTop.tie) : 0;
        alone = (1 - continues) * win + (continues - lost) * called - lost * put;
      }
      // The field at this price. A player who already called the wager holds the calling
      // range the facing-bet verdict gives him and continues with the minimum-defence share
      // of it at the price the raise lays; a player still to act continues with the verdict's
      // share for him. Each who continues must be beaten.
      let field = allInField;
      if (spot.callers > 0) {
        const region = clamp(OMAHA_EV_CALLER_SHARE[spot.street] * price, 0.001, 0.95);
        field *= (1 - price * (1 - holds(region))) ** spot.callers;
      }
      if (spot.behind > 0)
        field *= (1 - OMAHA_EV_BEHIND_SHARE * (1 - holds(OMAHA_EV_BEHIND_SHARE))) ** spot.behind;
      rows.push({
        to,
        allIn,
        ev: round2(field * alone - (1 - field) * put),
        continues: round4(continues),
        region: round4(region),
        win: round4(top.win),
        lose: round4(Math.max(0, 1 - top.win - top.tie)),
        value: top.win > Math.max(0, 1 - top.win - top.tie),
      });
    }
    let best: OmahaPricedRaiseRow | null = null;
    for (const r of rows) if (best === null || r.ev > best.ev) best = r;
    if (best !== null && best.ev > Math.max(call.call ? call.ev : 0, 0) + margin)
      return {
        ...base,
        action: best.allIn ? 'all_in' : 'raise',
        amount: best.to,
        best,
        rows,
      };
    return passive(rows, best);
  } catch {
    return null;
  }
}

/**
 * The value of a raise heads-up, before the field: he folds (1 - continues) of
 * his betting range and the Horse wins the pot; of what continues, the top
 * `again` raises again. That top is counted ONCE (REVIEW-9f803db63df-013U37.md
 * N1): where it beats the Horse, the Horse folds to the re-raise and gives up
 * its raise; where the Horse holds, it gets its called result against it. The
 * rest of the continuing part is priced on the continuing holdings WITHOUT
 * that top, its win and tie shares recovered from those of the whole
 * continuing part and of the top by mass. Shares are realized at `real`.
 * Exported for its test.
 */
export function omahaPricedRaiseAloneEv(i: {
  win: number;
  his: number;
  put: number;
  rake: number;
  real: number;
  continues: number;
  continuing: { win: number; tie: number };
  again: number;
  reraisers: { win: number; tie: number } | null;
}): number {
  const calledAt = (sw: number, st: number): number => {
    const w = sw * i.real;
    const t = st * i.real;
    return (
      w * (i.win + i.his * (1 - i.rake)) +
      t * ((i.win + i.his - i.put) / 2) -
      Math.max(0, 1 - w - t) * i.put
    );
  };
  const c = clamp(i.continues, 0, 1);
  const again = i.reraisers ? clamp(i.again, 0, c) : 0;
  if (!(again > 1e-6) || !i.reraisers)
    return (1 - c) * i.win + c * calledAt(i.continuing.win, i.continuing.tie);
  const at = i.reraisers;
  const rest = c - again;
  const restWin = rest > 1e-9 ? clamp((c * i.continuing.win - again * at.win) / rest, 0, 1) : 0;
  const restTie =
    rest > 1e-9 ? clamp((c * i.continuing.tie - again * at.tie) / rest, 0, 1 - restWin) : 0;
  const beaten = clamp(1 - at.win - at.tie, 0, 1);
  const holds = 1 - beaten;
  const againEv =
    (holds > 1e-9 ? holds * calledAt(at.win / holds, at.tie / holds) : 0) - beaten * i.put;
  return (1 - c) * i.win + rest * calledAt(restWin, restTie) + again * againEv;
}

// ─────────────────── raise or call by sample: flop and turn ───────────────────

/** A sampled raise must be worth this share of the pot more than the call (the big-draw margin). */
export const OMAHA_PRICED_SAMPLED_MARGIN = 0.02;

export interface OmahaPricedSampledInput {
  street: 'flop' | 'turn';
  hole: readonly Card[];
  board: readonly Card[];
  dead?: readonly Card[];
  /** chips on the table, the wager faced included */
  pot: number;
  toCall: number;
  stack: number;
  heroBet: number;
  currentBet: number;
  /** the raise-to amount priced (a proposed raise, or the pot raise) */
  to: number;
  inPosition: boolean;
  opponents: ReadonlyArray<{ stack: number; bet: number; read: OmahaPricedRead | null }>;
  samples?: number;
  /**
   * omahaSampledRaiseIsPricedAtEverySize: the legal raise-to range. With it the fold, the call and
   * a raise to each candidate size (the minimum, the middle, the maximum, and `to`) are priced, each
   * raise's fold share at the price that raise lays. Absent: `to` alone, its fold share size-blind
   * (#11212).
   */
  sizes?: OmahaPricedSampledSizes | null;
}

export interface OmahaPricedSampledSizes {
  minTo: number;
  maxTo: number;
  /** whole-chip table (big blind of 1 or more): candidate sizes are whole chips */
  whole?: boolean;
  /** the menu offers a raise / an all-in (absent: offered) */
  canRaise?: boolean;
  canShove?: boolean;
}

export interface OmahaPricedSampledRow {
  /** the street total the raise is made to, as matched (no more than the Horse or the deepest opponent holds) */
  to: number;
  /** the raise puts the matched stack in */
  jam: boolean;
  /** the share of the time every opponent folds to THIS raise */
  foldEquity: number;
  /** the Horse's share against the part of the range that continues against THIS raise */
  equity: number;
  ev: number;
}

export interface OmahaPricedSampledVerdict {
  raise: boolean;
  foldEquity: number;
  equities: OmahaBigDrawEquities;
  evRaise: number;
  evCall: number;
  margin: number;
  /** the standard error of the sampled share behind the two values, as chips of the pot */
  standardError: number;
  /** only with `sizes`: the action of highest value (a raise must beat the call by the margin; the fold is worth 0) */
  action?: 'fold' | 'call' | 'raise';
  /** only with `sizes`: the raise of highest value and every raise priced, smallest first */
  best?: OmahaPricedSampledRow | null;
  rows?: OmahaPricedSampledRow[];
}

/**
 * The minimum-defence fold (the raise increment over the pot it is laid into: increment / (pot +
 * call + increment)) at the prices the measured flop and turn raises laid. MEASURED, PLO4/PLO5
 * cash, heads-up, 2026-11-10 to 2026-11-15 (archive plo-handoff-review-01a1cbbd/full-sweep-20261115,
 * private/decisions_full.csv, a Horse's raise and the response to it; computation in
 * sampledraise-01TLQer7J/fold-by-price.txt): flop 65 raises, mean 0.369, folded to 11 (0.17); turn
 * 39 raises, mean 0.353, folded to 9 (0.23). The fold rose with the price laid: below 0.30, 1 of 21;
 * 0.30 to 0.40, 5 of 32; 0.40 and above, 14 of 51 (flop and turn together). So the population fold
 * to a raise the sampled comparison reads (the fold to a bet times OMAHA_BIG_DRAW_RAISE_FOLD_SCALE,
 * 0.18, and the street read's fold-to-raise cell) is a fold AT THESE PRICES: a raise that lays a
 * different price is folded to in proportion (the minimum-defence shape, the same one
 * omahaPricedRaise prices on the turn and river).
 */
export const OMAHA_PRICED_SAMPLED_REFERENCE_FOLD: Readonly<Record<'flop' | 'turn', number>> =
  Object.freeze({ flop: 0.369, turn: 0.353 });

/**
 * The last day of the raises behind OMAHA_PRICED_SAMPLED_REFERENCE_FOLD. A fold-to-raise cell that
 * carries no price of its own is taken as measured at the reference price, which is true only of
 * raises made at the sizes Horses raised through this day. Once omahaSampledRaiseIsPricedAtEverySize
 * is on anywhere, Horses raise to other sizes and a cell without a price would have its size
 * counted twice: A PRICE-INDEXED CELL (OmahaPricedCell.price, from a counter the street read does
 * not keep today) IS REQUIRED BEFORE SWITCH-ON. See docs/horse-option-authority.d.
 */
export const OMAHA_PRICED_SAMPLED_REFERENCE_MEASURED_THROUGH = '2026-11-15';

/**
 * One opponent's fold to a raise he must put `call` more in to continue against, the pot holding
 * `laid` before that (the wager faced and the Horse's call of it included). `prior` (his fold to a
 * bet scaled to a raise) is the fold at the reference price: it is carried to THIS price by the
 * minimum-defence fold this raise lays over the reference one. The street read's cell is carried
 * from the price IT was measured at (`cell.price`; with none, the reference price, see
 * OMAHA_PRICED_SAMPLED_REFERENCE_MEASURED_THROUGH), so a cell measured over large raises is not
 * scaled up again at a large raise. As in omahaPricedRaise (plo-truncation-013U37) the fold priced
 * is the smaller of the two readings of a cell: the cell as measured, shrunk toward the prior at
 * this price, and the cell carried to this price. A read never makes a raise worth more than either
 * reading; with no cell both are the prior at this price. Exported for its test.
 */
export function omahaPricedSampledFoldAtPrice(i: {
  street: 'flop' | 'turn';
  prior: number;
  cell: OmahaPricedCell | null | undefined;
  laid: number;
  call: number;
}): number {
  const model = clamp(i.call / Math.max(1e-9, i.laid + i.call), 0.03, 0.95);
  const factor = model / OMAHA_PRICED_SAMPLED_REFERENCE_FOLD[i.street];
  const priorAt = clamp(i.prior * factor, 0, 0.95);
  const asMeasured = clamp(omahaPricedShrunk(i.cell, priorAt), 0, 0.95);
  const c = i.cell;
  if (c && fin(c.price) && c.price > 0 && fin(c.opp) && fin(c.hit) && c.opp > 0) {
    // the cell's own price: its folds carried from there to here, then shrunk toward the prior here
    const opp = Math.max(0, c.opp);
    const hit = clamp((clamp(c.hit, 0, opp) * model) / clamp(c.price, 0.03, 0.95), 0, opp);
    return Math.min(asMeasured, clamp(omahaPricedShrunk({ hit, opp }, priorAt), 0, 0.95));
  }
  const sizeBlind = clamp(omahaPricedShrunk(i.cell, i.prior), 0, 0.95);
  return Math.min(asMeasured, clamp(sizeBlind * factor, 0, 0.95));
}

/**
 * The Horse's share against the part of an opponent's range that continues when he folds `fold` of
 * it. The model is the one omahaPricedRaise counts on the turn and river: the weakest holdings fold
 * first, so the part that continues is the STRONGEST (1 - fold) share of the range he wagered with.
 * On the sample that range is the hands that continue against a bet (counts 1), its strongest class
 * the hands that continue against a raise (counts 2), each class one figure (no order inside a
 * class: the order would be read off the Horse's own cards). A share no larger than the strong
 * class takes that class (equities.raise, the one figure every size had before); a larger share
 * adds the rest of the betting range in proportion. So a larger raise, folded to more often, is
 * continued against by a stronger range. A class with fewer than 40 sampled hands is not split
 * (equities.raise). Exported for its test.
 */
export function omahaPricedSampledContinuingShare(
  equities: OmahaBigDrawEquities,
  counts: OmahaBigDrawCounts | null | undefined,
  fold: number
): number {
  const g1 = counts?.got[1] ?? 0;
  const g2 = counts?.got[2] ?? 0;
  if (!counts || !(g1 >= 40) || !(g2 >= 40) || !(g1 > g2)) return equities.raise;
  const keep = clamp(1 - (fin(fold) ? fold : 0), 0, 1);
  const strong = g2 / g1;
  if (keep <= strong) return equities.raise;
  const rest = g1 - g2;
  const other = rest >= 40 ? ((counts.won[1] ?? 0) - (counts.won[2] ?? 0)) / rest : equities.bet;
  return (strong * equities.raise + (keep - strong) * other) / keep;
}

/**
 * omahaSampledRaiseIsPricedAtEverySize: the raise-to amounts priced, smallest first. The minimum,
 * the middle and the maximum legal raise (OMAHA_PRICED_RAISE_STEPS), none more than the Horse or the
 * deepest opponent holds, and the proposed size where it is a legal one. They depend on the public
 * state only, so the receipt validator re-derives them (omahaPricedSampledAdmitsResize).
 */
export function omahaPricedSampledCandidates(
  i: {
    stack: number;
    heroBet: number;
    currentBet: number;
    opponents: ReadonlyArray<{ stack: number; bet: number }>;
    to?: number | null;
  },
  sizes: OmahaPricedSampledSizes
): number[] {
  const heroBet = fin(i.heroBet) ? Math.max(0, i.heroBet) : 0;
  const cur = fin(i.currentBet) ? Math.max(0, i.currentBet) : 0;
  const total = heroBet + (fin(i.stack) ? Math.max(0, i.stack) : 0);
  if (i.opponents.length === 0) return [];
  const cover = Math.max(...i.opponents.map((o) => Math.max(0, o.stack) + Math.max(0, o.bet)));
  const cap = Math.min(total, cover);
  const canRaise = sizes.canRaise !== false;
  const canShove = sizes.canShove !== false;
  const lo = fin(sizes.minTo) ? sizes.minTo : cur * 2;
  const hi = Math.min(fin(sizes.maxTo) ? sizes.maxTo : cap, cap);
  const tos: number[] = [];
  const add = (raw: number): void => {
    const to = round2(Math.min(raw, cap));
    if (!(to > cur + 0.005)) return;
    // putting the Horse's whole stack in is the all-in action; anything less is a raise
    if (to >= total - 0.005 ? !canShove : !canRaise) return;
    if (!tos.includes(to)) tos.push(to);
  };
  if (hi + 0.005 < lo) {
    // less than a full raise is left: only the Horse's own stack can go in
    if (total <= cap + 0.005) add(total);
  } else {
    for (const f of OMAHA_PRICED_RAISE_STEPS) {
      const raw = lo + f * (hi - lo);
      add(clamp(sizes.whole === true ? Math.round(raw) : round2(raw), lo, hi));
    }
  }
  const to = i.to;
  if (fin(to) && (to >= lo - 0.005 || to >= total - 0.005)) add(to);
  return tos.sort((a, b) => a - b);
}

/**
 * EV(raise to `to`) beside EV(call) with the Horse's exact hand, any hand,
 * against one or two opponents on the flop or the turn. Null when a number
 * cannot be computed.
 */
export function omahaPricedSampledRaise(
  i: OmahaPricedSampledInput
): OmahaPricedSampledVerdict | null {
  try {
    const pot = fin(i.pot) ? Math.max(0, i.pot) : 0;
    const toCall = fin(i.toCall) ? Math.max(0, i.toCall) : 0;
    const stack = fin(i.stack) ? Math.max(0, i.stack) : 0;
    const heroBet = fin(i.heroBet) ? Math.max(0, i.heroBet) : 0;
    const cur = fin(i.currentBet) ? Math.max(0, i.currentBet) : 0;
    if (!(pot > 0) || !(toCall > 0.005) || !(stack > toCall + 0.005)) return null;
    if (i.opponents.length === 0 || i.opponents.length > 2) return null;
    const total = heroBet + stack;
    const cover = Math.max(...i.opponents.map((o) => Math.max(0, o.stack) + Math.max(0, o.bet)));
    const matched = Math.min(Math.min(i.to, total), cover);
    // With `sizes` the legal sizes are priced whatever the proposed one is (it is priced only
    // where it is legal); without, the one size given must be a raise.
    if (!i.sizes && !(matched > cur + 0.005)) return null;
    const cost = matched - heroBet;
    const x = matched - cur;
    const samples = i.samples ?? OMAHA_BIG_DRAW_SAMPLES;
    const counts: OmahaBigDrawCounts | undefined = i.sizes ? { got: [], won: [] } : undefined;
    const equities = omahaBigDrawEquities(i.hole, i.board, i.dead ?? [], samples, counts);
    if (equities === null) return null;
    if (i.sizes) return omahaPricedSampledAtEverySize(i, i.sizes, equities, samples, counts);
    let foldEquity = 1;
    for (const o of i.opponents) {
      const read = o.read ?? OMAHA_PRICED_NO_READ;
      const toBet = clamp(read.foldToBet ?? OMAHA_BIG_DRAW_PRIOR_FOLD_TO_BET, 0, 0.95);
      // A raise is folded to less often than a bet by the stated scale; the
      // street read's fold-to-raise cell, where known, is shrunk toward that.
      const toRaise = clamp(
        omahaPricedShrunk(read.foldToRaise, toBet * OMAHA_BIG_DRAW_RAISE_FOLD_SCALE),
        0,
        0.95
      );
      foldEquity *= toRaise;
    }
    const jam = matched >= Math.min(total, cover) - 0.005;
    const real = i.inPosition ? 1 : OMAHA_BIG_DRAW_OOP_REALISATION;
    const evRaise =
      foldEquity * pot +
      (1 - foldEquity) * ((jam ? 1 : real) * equities.raise * (pot + cost + x) - cost);
    const evCall = real * equities.bet * (pot + toCall) - toCall;
    const margin = OMAHA_PRICED_SAMPLED_MARGIN * pot;
    // A share estimated from n independent hands has standard error at most 0.5 / sqrt(n).
    const standardError = (0.5 / Math.sqrt(Math.max(1, samples))) * (pot + cost + x);
    return {
      raise: evRaise > evCall + margin && evRaise > 0,
      foldEquity: round4(foldEquity),
      equities,
      evRaise: round2(evRaise),
      evCall: round2(evCall),
      margin: round2(margin),
      standardError: round2(standardError),
    };
  } catch {
    return null;
  }
}

/**
 * omahaSampledRaiseIsPricedAtEverySize. The fold (0), the call and a raise to each candidate size
 * (omahaPricedSampledCandidates) priced on the same sample. Each raise's fold share is every
 * opponent's fold at the price THAT raise lays HIM: what he must put in to continue (the raise-to
 * less his own wager, his stack permitting) over the pot it is laid into
 * (omahaPricedSampledFoldAtPrice). The share the Horse holds when called is its share against the
 * part of the range that continues against that raise (omahaPricedSampledContinuingShare), so a
 * small raise does not buy the fold of a large one, a large one is not called by the range that
 * calls a small one, and the size enters only through the price. The raise of highest value is the
 * raise; it is made when it is worth more than the call by the margin and more than the fold.
 */
function omahaPricedSampledAtEverySize(
  i: OmahaPricedSampledInput,
  sizes: OmahaPricedSampledSizes,
  equities: OmahaBigDrawEquities,
  samples: number,
  counts: OmahaBigDrawCounts | undefined
): OmahaPricedSampledVerdict | null {
  const pot = Math.max(0, i.pot);
  const toCall = Math.max(0, i.toCall);
  const heroBet = fin(i.heroBet) ? Math.max(0, i.heroBet) : 0;
  const cur = fin(i.currentBet) ? Math.max(0, i.currentBet) : 0;
  const total = heroBet + Math.max(0, i.stack);
  const cover = Math.max(...i.opponents.map((o) => Math.max(0, o.stack) + Math.max(0, o.bet)));
  const cap = Math.min(total, cover);
  const tos = omahaPricedSampledCandidates(i, sizes);
  if (tos.length === 0) return null;
  const real = i.inPosition ? 1 : OMAHA_BIG_DRAW_OOP_REALISATION;
  const rows: Array<OmahaPricedSampledRow & { ev0: number; fold0: number; at: number }> = [];
  for (const to of tos) {
    const cost = to - heroBet;
    const x = to - cur;
    let foldEquity = 1;
    let keeps = 0;
    let shares = 0;
    for (const o of i.opponents) {
      const read = o.read ?? OMAHA_PRICED_NO_READ;
      const toBet = clamp(read.foldToBet ?? OMAHA_BIG_DRAW_PRIOR_FOLD_TO_BET, 0, 0.95);
      const oBet = Math.max(0, o.bet);
      const fold = omahaPricedSampledFoldAtPrice({
        street: i.street,
        prior: toBet * OMAHA_BIG_DRAW_RAISE_FOLD_SCALE,
        cell: read.foldToRaise,
        laid: pot + toCall,
        // HIS call: the raise-to less what he has in on this street (his own stack permitting).
        // The bettor's is the raise increment; a player still to answer the wager pays that too.
        call: Math.max(0, Math.min(to, oBet + Math.max(0, o.stack)) - oBet),
      });
      foldEquity *= fold;
      keeps += 1 - fold;
      shares += (1 - fold) * omahaPricedSampledContinuingShare(equities, counts, fold);
    }
    // called by one of two: the share against each one's continuing range, by how often he continues
    const equity = keeps > 1e-9 ? shares / keeps : equities.raise;
    const jam = to >= cap - 0.005;
    const ev =
      foldEquity * pot + (1 - foldEquity) * ((jam ? 1 : real) * equity * (pot + cost + x) - cost);
    rows.push({
      to,
      jam,
      foldEquity: round4(foldEquity),
      equity: round4(equity),
      ev: round2(ev),
      ev0: ev,
      fold0: foldEquity,
      at: pot + cost + x,
    });
  }
  let top = rows[0];
  for (const r of rows) if (r.ev0 > top.ev0) top = r;
  const evCall = real * equities.bet * (pot + toCall) - toCall;
  const margin = OMAHA_PRICED_SAMPLED_MARGIN * pot;
  const raise = top.ev0 > evCall + margin && top.ev0 > 0;
  const plain = (r: (typeof rows)[number]): OmahaPricedSampledRow => ({
    to: r.to,
    jam: r.jam,
    foldEquity: r.foldEquity,
    equity: r.equity,
    ev: r.ev,
  });
  return {
    raise,
    foldEquity: round4(top.fold0),
    equities,
    evRaise: round2(top.ev0),
    evCall: round2(evCall),
    margin: round2(margin),
    standardError: round2((0.5 / Math.sqrt(Math.max(1, samples))) * top.at),
    action: raise ? 'raise' : evCall > 0 ? 'call' : 'fold',
    best: plain(top),
    rows: rows.map(plain),
  };
}

// ───────────────────── bet or check: turn and river ─────────────────────

export interface OmahaPricedBetRow {
  action: 'bet' | 'all_in';
  amount: number;
  ev: number;
  /** summed over the opponents: the share of each range that continues with a worse / a better hand */
  worse: number;
  better: number;
  value: boolean;
}

export interface OmahaPricedBetVerdict {
  action: 'check' | 'bet' | 'all_in';
  amount: number;
  evCheck: number;
  /** the bet of highest expected value, value bet or bluff */
  best: OmahaPricedBetRow | null;
  /** the row of the proposed amount, when one was given and priced */
  proposed: OmahaPricedBetRow | null;
  rows: OmahaPricedBetRow[];
  opponents: number;
  heroCloses: boolean;
}

/**
 * A check and every bet size priced with the Horse's exact hand against every
 * live opponent's range on a PLO4/PLO5 turn or river with nothing to call.
 * `proposedAmount` (a bet another owner chose) is priced beside the engine's
 * sizes. The answer is the proposed bet when it is worth at least the check,
 * else the best size when it is worth more than the check by the margin, else
 * the check. Null when the spot is outside the card-impact model or a number
 * cannot be computed (an opponent all in from an earlier street, the flop).
 */
export function omahaPricedBet(
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  readOf: (seat: number) => OmahaPricedRead | null,
  proposedAmount?: number,
  margin: number = 0,
  scope?: { plo6Priced?: boolean }
): OmahaPricedBetVerdict | null {
  try {
    const stage = String(gs.stage ?? '');
    if (stage !== 'turn' && stage !== 'river') return null;
    const variant = String(gs.gameVariant ?? '').toLowerCase();
    // plo6FacingBetIsPriced's own caller (the paired-river check, HorsePlo6FacingBetIsPriced.ts) opens PLO6.
    if (!(scope?.plo6Priced === true && variant === 'plo6') && !OMAHA_PRICED_VARIANTS.has(variant))
      return null;
    if (!fin(gs.pot) || !(gs.pot > 0) || !fin(hero.stack) || !(hero.stack > 0)) return null;
    const toCall = fin(gs.toCall)
      ? Math.max(0, gs.toCall)
      : Math.max(0, (gs.currentBet || 0) - (fin(hero.bet) ? hero.bet : 0));
    if (toCall > 0.005) return null;
    const opponents = (gs.players ?? []).filter(
      (p) => p.seat !== hero.seat && !p.is_folded && !p.is_sitting_out
    );
    if (opponents.length === 0) return null;
    if (opponents.some((p) => p.is_all_in || !fin(p.stack) || !(p.stack > 0))) return null;
    const checked = new Set<number>();
    for (const a of gs.actionHistory ?? [])
      if (String(a.stage) === stage && String(a.action) === 'check' && a.seat !== hero.seat)
        checked.add(a.seat);
    const pot = gs.pot;
    const deepest = opponents.reduce((a, b) => (b.stack > a.stack ? b : a));
    const amounts = omahaCardImpactAmounts(hero, deepest, gs);
    if (fin(proposedAmount) && proposedAmount > 0) {
      const a = round2(Math.min(proposedAmount, hero.stack));
      if (!amounts.some((x) => Math.abs(x - a) < 0.006)) amounts.push(a);
    }
    if (amounts.length === 0) return null;
    const impacts: OmahaCardImpact[] = [];
    const closes: boolean[] = [];
    const betRates: number[] = [];
    for (const opp of opponents) {
      const closed = checked.has(opp.seat);
      const read = omahaPricedCardImpactRead(readOf(opp.seat) ?? OMAHA_PRICED_NO_READ, stage);
      const impact = omahaCardImpact({
        hole: hero.cards,
        board: gs.communityCards ?? [],
        dead: hero.knownDeadCards ?? [],
        pot,
        heroStack: hero.stack,
        oppStack: opp.stack,
        heroCloses: closed,
        line: omahaCardImpactLine(hero, opp, gs),
        read,
        amounts,
        seedSalt: opp.seat * 16 + hero.seat,
      });
      if (!impact) return null;
      impacts.push(impact);
      closes.push(closed);
      betRates.push(clamp(read.betCheckedTo, 0, 1));
    }
    const rows: OmahaPricedBetRow[] = [];
    let evCheck: number;
    if (impacts.length === 1) {
      evCheck = impacts[0].options[0].ev;
      for (const o of impacts[0].options) {
        if (o.action === 'check') continue;
        const cont = o.call + o.raise;
        rows.push({
          action: o.action,
          amount: o.amount,
          ev: o.ev,
          worse: round2(cont * Math.max(0, 2 * o.continueEquity + o.continueBeats - 1)),
          better: round2(cont * o.continueBeats),
          value: o.value,
        });
      }
    } else {
      // The multiway combination of HorseOmahaStrongHandValue (its comment
      // states the two joint corrections and the independence simplification).
      const s = impacts.map((i) => clamp(i.showdown, 0, 1));
      evCheck = pot * s.reduce((a, b) => a * b, 1);
      let noneBets = 1;
      let rateSum = 0;
      closes.forEach((closed, j) => {
        if (closed) return;
        noneBets *= 1 - betRates[j];
        rateSum += betRates[j];
      });
      const scale = rateSum > 0 ? Math.min(1, (1 - noneBets) / rateSum) : 0;
      impacts.forEach((impact, j) => {
        if (closes[j]) return;
        const gain = impact.options[0].ev - pot * s[j];
        let rest = 1;
        s.forEach((x, k) => {
          if (k !== j) rest *= x;
        });
        evCheck += scale * gain * rest;
      });
      evCheck = round2(evCheck);
      const n = impacts.length;
      for (const amount of amounts) {
        const a = round2(Math.min(amount, hero.stack));
        const mdf = pot / (pot + a);
        const joint = (1 - (1 - mdf) ** (1 / n)) / mdf;
        let noBetter = 1;
        let worseChips = 0;
        let worse = 0;
        let better = 0;
        let ok = true;
        impacts.forEach((impact, j) => {
          const o = impact.options.find(
            (x) => x.action !== 'check' && Math.abs(x.amount - a) < 0.006
          );
          if (!o) {
            ok = false;
            return;
          }
          const cont = o.call + o.raise;
          const b = clamp(Math.min(cont * o.continueBeats, cont * joint), 0, 0.999);
          const l = clamp(
            cont * Math.max(0, 2 * o.continueEquity + o.continueBeats - 1) - cont * (1 - joint),
            0,
            1
          );
          noBetter *= 1 - b;
          worseChips += (Math.min(a, opponents[j].stack) * l) / (1 - b);
          worse += l;
          better += b;
        });
        if (!ok) continue;
        rows.push({
          action: a >= hero.stack - 0.005 ? 'all_in' : 'bet',
          amount: a,
          ev: round2(noBetter * (pot + worseChips) - (1 - noBetter) * a),
          worse: round2(worse),
          better: round2(better),
          value: worse > better,
        });
      }
    }
    let best: OmahaPricedBetRow | null = null;
    for (const r of rows) if (best === null || r.ev > best.ev) best = r;
    const proposed =
      fin(proposedAmount) && proposedAmount > 0
        ? (rows.find(
            (r) => Math.abs(r.amount - round2(Math.min(proposedAmount, hero.stack))) < 0.006
          ) ?? null)
        : null;
    const out = {
      evCheck,
      best,
      proposed,
      rows,
      opponents: impacts.length,
      heroCloses: opponents.every((p) => checked.has(p.seat)),
    };
    if (proposed !== null && proposed.ev >= evCheck)
      return { ...out, action: proposed.action, amount: proposed.amount };
    if (best !== null && best.ev > evCheck + Math.max(0, margin) * pot)
      return { ...out, action: best.action, amount: best.amount };
    return { ...out, action: 'check', amount: 0 };
  } catch {
    return null;
  }
}

// ───────────────────────────── mixing ─────────────────────────────

/**
 * FREQUENCY MIXING (omahaPricedMix, default off). When the two best actions
 * of a priced comparison are closer than the comparison can tell apart, the
 * choice between them is mixed with probabilities that follow the gap, so a
 * priced rule is not a fixed threshold an opponent can sit on.
 *
 * `uncertainty` is the comparison's own: the standard error of the equity it
 * rests on in chips (0 for an exact count), plus the spread of the opponent
 * read, which is wide with few opportunities and narrow with many:
 * `stake` chips ride on his answer and a rate estimated from n opportunities
 * (with the prior's pseudo-opportunities) has standard error at most
 * 0.5 / sqrt(n + k). The probability of the lower-valued action is
 * 0.5 x max(0, 1 - gap / uncertainty): one half at no gap, none at a gap of
 * one uncertainty or more. No chip or size constant appears.
 */
export function omahaPricedReadSpread(read: OmahaPricedRead | null, stake: number): number {
  const n = Math.max(0, read?.opportunities ?? 0) + OMAHA_PRICED_SHRINK;
  return (0.5 / Math.sqrt(n)) * Math.max(0, stake);
}
export function omahaPricedMixProbability(gap: number, uncertainty: number): number {
  if (!fin(gap) || !fin(uncertainty) || !(uncertainty > 0) || gap < 0) return 0;
  return 0.5 * Math.max(0, 1 - gap / uncertainty);
}

/**
 * The spot of one decision as the mixing draw keys it: PUBLIC state only (the
 * street, the board, the pot, the wager faced, the seat and the count of
 * public actions so far). The Horse's hole cards are not read, so the draw
 * says nothing about its hand. The caller hashes it with the decision's
 * strategy stream position and a salt (HorseOmahaStrongHandSlowplayMix.
 * omahaSlowplayUnit: read, never advanced), so the fast, deep and retried
 * decision of one node draw the same number and a pinned seed replays.
 */
export const OMAHA_PRICED_MIX_SALT = 0x9a1ced;
export function omahaPricedPublicSpotKey(hero: SeatPlayer, gs: HorseGameStateV2): string {
  const board = (gs.communityCards ?? []).map((c) => `${c.rank}${c.suit[0]}`).join('');
  return [
    String(gs.stage ?? ''),
    board,
    String(Math.round((fin(gs.pot) ? gs.pot : 0) * 100)),
    String(Math.round((fin(gs.currentBet) ? gs.currentBet : 0) * 100)),
    String(hero.seat),
    String((gs.actionHistory ?? []).length),
  ].join('|');
}
