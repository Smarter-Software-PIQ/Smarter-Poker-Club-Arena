/**
 * OMAHA MULTIWAY AND BLUFF DISCIPLINE (2026-11-16, PLO Strategy lane; three
 * options, each default OFF and read `=== true` by HorseLogic).
 *
 * Owner principles of 2026-11-15: no blanket rule (the hand, the player, the
 * price and the pot decide); defence on bad cards; an owner-ruled check or
 * fold is final; facing a bet on the turn or the river a raise needs the nuts.
 *
 * THE LEAKS (archive plo-handoff-review-01a1cbbd):
 *  - full-sweep-20261115/SWEEP.md, family R: a river call of 10 bb or more
 *    without the nuts with three or more players live, 19 calls in 4,573
 *    PLO4/PLO5 cash hands with a person seated, hand net -1,987 bb, 74% rule
 *    mistakes; non-nut flushes the costliest class (5 calls, -949 bb).
 *  - pricingfix-20261115/I6-TRACE-final.txt: in-position river bets with one
 *    pair or a board-made two pair into an opponent the engine reads as a
 *    measured postflop value leader who called or bet an earlier street
 *    (states 65, 487 and 591 among them).
 *  - SWEEP.md families D2 and B1b: multiway bets with weak made hands.
 *
 * 1. omahaMultiwayRiverCallNeedsStrength (omahaMultiwayRiverCallVerdict).
 *    River, facing a bet, at least one other opponent live beside the bettor
 *    (one who called the bet in front, one all in from an earlier street, or
 *    one still to act behind), a hand that is not nut class: the call is the
 *    exact-hand facing-bet EV of HorseOmahaFacingBetEv against the bettor
 *    (his value region and bluff share by size and line, moved by his
 *    measured read, the population prior without one; the value region is
 *    the multiway one, omahaMultiwayValueShare: a bet into n players needs
 *    a stronger hand, Vn = 1 - (1 - V1)^(1/n)) multiplied by the
 *    chance of beating every other player's continuing range. Each such
 *    range is the strongest share of all holdings on this board: a caller of
 *    this bet OMAHA_EV_CALLER_SHARE.river, a player still to act
 *    OMAHA_EV_BEHIND_SHARE (there only with that share), an earlier all-in
 *    OMAHA_EV_ALL_IN_SHARE; a caller's and a player behind's share is moved by
 *    his measured river-call rate against OMAHA_MW_RIVER_POP_CONTINUE when he
 *    is measured, else it is the population prior. INDEPENDENCE: the ranges
 *    are taken as independent (the product of the shares, as
 *    omahaStrongHandValue's multiway pricing does); joint card removal
 *    between opponents is not modelled. The call is made when EV(call)
 *    exceeds the facing-bet margin (facingBetEvMargin, 2% of the final pot);
 *    otherwise the hand folds. A fold is never turned into a call, and a
 *    raise is not touched: the option holds no priced comparison for a raise
 *    (owner order 2026-11-17 11:49 America/Chicago, no blanket rules), so the
 *    raise rules decide it.
 *
 * 2. omahaNoRiverBluffIntoValueLeader (omahaRiverBluffIntoValueLeaderSpot).
 *    River, nothing to call, a bet with a hand below the showdown-value line
 *    (OMAHA_SHOWDOWN_VALUE_LINE: the hand wins or ties against less than this
 *    share of all opponent holdings, exact count) and no nut blocker
 *    (HorseLogic's hasVariantBlocker, the v86 nut-blocker bluff's own test:
 *    that option keeps its spots), against a live opponent who is a measured
 *    postflop value leader (omahaReadConditionalOf) and showed strength this
 *    hand (bet, raised or called on the flop or the turn): the bet becomes a
 *    check unless omahaBetVsCheckEv says the bet is worth more than the
 *    check by OMAHA_DISCIPLINE_BET_MARGIN of the pot. In and out of position,
 *    heads-up and multiway (multiway: any live opponent such a leader).
 *
 * 3. omahaMultiwayWeakHandNoBet (omahaMultiwayWeakHandSpot). Turn and river,
 *    nothing to call, two or more live opponents, a bet with one pair or less
 *    (omahaOnePairOrLess) that is not nut class and, on the turn, holds no
 *    nut-class draw (omahaNutClassOuts below ONE_PAIR_MIN_NUT_OUTS: no nut
 *    flush draw, nut straight draw or full-house draw of four outs or more)
 *    and no combo draw (omahaComboDrawForRaise): the bet becomes a check
 *    unless omahaBetVsCheckEv says the bet is worth more by the margin.
 *    The PLO6 lane's plo6NoMultiwayBetWithWeakMadeHand (branch
 *    agent/claude-plo6-01BbZPDjnig/feat/omaha-strategy-in-plo6, not on main
 *    at 963b71f394b) is the six-card form: flop and turn, a narrower weak
 *    made-hand class, no EV exception. This option is not that one and does
 *    not touch PLO6: the exact count serves four and five cards only, so a
 *    PLO6 hand keeps its decision.
 *
 * omahaBetVsCheckEv (2 and 3). Each live opponent j holds the strongest V_j
 * of all holdings (V = 1 with no strength shown; OMAHA_SHOWN_STRENGTH_RANGE
 * when he bet, raised or called an earlier postflop street, times
 * OMAHA_EV_LINE_AGGRESSOR per street he bet or raised and OMAHA_EV_LINE_CALLER
 * per street he only called). His fold rate f_j (measured: on the river
 * 1 - his river-call rate, on the turn his fold to a bet; else the prior
 * OMAHA_DISCIPLINE_PRIOR_FOLD) is read as a threshold over all holdings: he
 * continues with the strongest 1 - f_j of them, so of his own range the share
 * min(1, (1 - f_j) / V_j) continues (a strong arriving range folds less).
 * With h_j the Horse's win-plus-half-tie share against his continuing hands
 * and s_j against his whole range (exact counts, HorseOmahaFacingBetEv;
 * the turn averages every river card), ranges independent:
 *   F          = prod_j fold_j
 *   EV(bet B)  = F x pot + (prod_j (fold_j + (1 - fold_j) h_j) - F) x (pot + B)
 *                - (1 - prod_j (fold_j + (1 - fold_j) h_j)) x B
 *   EV(check)  = pot x prod_j s_j
 * The bet stands when EV(bet) > EV(check) + margin x pot.
 *
 * ALL-IN OPPONENTS (2026-11-18, review N2 of #11211). A player already all in
 * cannot fold and cannot call: the bet has no fold equity against him and
 * its chips are contested only by the players who still have chips. With A
 * the all-in players (s_a against each one's whole range, W = prod_a s_a) and
 * j over the others only:
 *   EV(bet B)  = F x W x pot + (prod_j (...) - F) x (W x pot + B)
 *                - (1 - prod_j (...)) x B
 * (everyone with chips folds: the bet comes back and the pot goes to the best
 * hand against the all-in players; a caller beaten: the side bet is won and
 * the pot only if the all-in players are beaten too; a caller ahead: both
 * are lost). With no all-in player W = 1 and the formula above is unchanged.
 * With nobody left who can answer a bet the comparison is null (the caller
 * keeps the decision: nothing is priced).
 *
 * CONSTANTS. Measured: OMAHA_DISCIPLINE_PRIOR_FOLD and
 * OMAHA_MW_RIVER_POP_CONTINUE (full sweep, see each). Stated, NOT measured:
 * OMAHA_SHOWDOWN_VALUE_LINE, OMAHA_SHOWN_STRENGTH_RANGE,
 * OMAHA_MW_RIVER_CALLER_SCALE_MIN/MAX, OMAHA_DISCIPLINE_BET_MARGIN. No
 * evaluation has been run.
 *
 * LIMITS. A model, not a solver. After a check no later betting is priced
 * (out of position he may bet; on the turn the river is not played), so the
 * check is valued at showdown. A winning bet is credited the pot and one
 * caller's bet. The threshold reading of a fold rate is a stated assumption.
 * The measured priors pool heads-up responders and every bet size.
 *
 * Pure: no random draw, no telemetry, no opponent memory (the caller supplies
 * the reads); the only state is HorseOmahaFacingBetEv's count memo.
 */
import type { SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import type { OmahaReadConditional } from './HorseOmahaReadConditional.js';
import { variantInfo } from './HorseEval.js';
import {
  OMAHA_EV_ALL_IN_SHARE,
  OMAHA_EV_BEHIND_SHARE,
  OMAHA_EV_CALLER_SHARE,
  OMAHA_EV_LINE_AGGRESSOR,
  OMAHA_EV_LINE_CALLER,
  omahaEvHandCounts,
  omahaFacingBetEvSpot,
  omahaFacingBetEvVerdict,
  type OmahaEvHandCounts,
  type OmahaFacingBetEvContext,
  type OmahaFacingBetEvRead,
  type OmahaFacingBetEvSpot,
} from './HorseOmahaFacingBetEv.js';
import { omahaNutClassNow } from './HorseOmahaMadeHandDefense.js';
import { OMAHA_CARD_IMPACT_SIZES } from './HorseOmahaCardImpact.js';
import { omahaFlopEvCounts, type OmahaFlopEvCounts } from './HorseOmahaFlopFacingBetEv.js';
import {
  ONE_PAIR_MIN_NUT_OUTS,
  omahaNutClassOuts,
  omahaOnePairOrLess,
} from './HorseOmahaOnePair.js';
import { omahaComboDrawForRaise } from './HorseOmahaBigDrawAggression.js';
import { omahaStrategyGameInScope } from './HorseOmahaStrategyGame.js';
import { omahaIsTournamentMode } from './HorseOmahaTournamentScope.js';

export const OMAHA_MULTIWAY_DISCIPLINE_VARIANTS: ReadonlySet<string> = new Set(['plo4', 'plo5']);

/**
 * MEASURED. Population continue rate to a river bet: full sweep 2026-11-15
 * (4,573 PLO4/PLO5 cash hands with a person seated), heads-up river bets by a
 * Horse, the opponent called or raised 138 of 353 (0.39).
 */
export const OMAHA_MW_RIVER_POP_CONTINUE = 0.39;
/** STATED, not measured: the bounds on how far a measured river-call rate moves a field share. */
export const OMAHA_MW_RIVER_CALLER_SCALE_MIN = 0.5;
export const OMAHA_MW_RIVER_CALLER_SCALE_MAX = 1.5;
/**
 * MEASURED. Fold to a bet when no read exists: full sweep 2026-11-15,
 * heads-up Horse bets with one pair or less, everyone folded on the river 68
 * of 113 (0.60) and on the turn 145 of 468 (0.31).
 */
export const OMAHA_DISCIPLINE_PRIOR_FOLD: Readonly<Record<'turn' | 'river', number>> = {
  river: 0.6,
  turn: 0.31,
};
/** STATED, not measured: below this share of all holdings beaten (win + half tie) a river hand has no showdown value. */
export const OMAHA_SHOWDOWN_VALUE_LINE = 0.5;
/** STATED, not measured: the share of all holdings a player holds after he bet, raised or called an earlier postflop street, before the line factors. */
export const OMAHA_SHOWN_STRENGTH_RANGE = 0.5;
/** STATED, not measured (the facing-bet margin's value): a bet must beat the check by this share of the pot. */
export const OMAHA_DISCIPLINE_BET_MARGIN = 0.02;

const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const round4 = (n: number) => Math.round(n * 10000) / 10000;

const STREET_BOARD: Record<string, number> = { turn: 4, river: 5 };

/** The options' game: PLO4/PLO5 cash, pot limit, high only, one board, no bomb pot, the turn or the river. */
function inGame(hero: SeatPlayer, gs: HorseGameStateV2): 'turn' | 'river' | null {
  try {
    const variant = String(gs.gameVariant ?? '').toLowerCase();
    if (!omahaStrategyGameInScope(OMAHA_MULTIWAY_DISCIPLINE_VARIANTS, gs)) return null;
    const stage = String(gs.stage ?? '');
    if (stage !== 'turn' && stage !== 'river') return null;
    const vi = variantInfo(variant);
    if (!vi.isOmaha || vi.isFixedLimit || gs.bettingStructure === 'fixed_limit') return null;
    if (gs.variantRules ? gs.variantRules.splitLow8OrBetter : vi.isHiLo) return null;
    if (
      (gs.boardCount ?? 1) > 1 ||
      (gs.communityCards2?.length ?? 0) > 0 ||
      (gs.communityCards3?.length ?? 0) > 0
    )
      return null;
    if (gs.allInOrFold === true || gs.wagersCapped === true || gs.bombPot === true) return null;
    // Cash only: these options have no tournament form.
    if (omahaIsTournamentMode(gs)) return null;
    if ((gs.communityCards ?? []).length !== STREET_BOARD[stage]) return null;
    if (!Array.isArray(hero.cards) || hero.cards.length !== vi.holeCount) return null;
    if (hero.is_folded || hero.is_all_in || hero.is_sitting_out) return null;
    if (!fin(hero.stack) || !(hero.stack > 0) || !fin(gs.pot) || !(gs.pot > 0)) return null;
    return stage;
  } catch {
    return null;
  }
}

const toCallOf = (hero: SeatPlayer, gs: HorseGameStateV2): number =>
  fin(gs.toCall)
    ? Math.max(0, gs.toCall)
    : Math.max(0, (gs.currentBet || 0) - (fin(hero.bet) ? hero.bet : 0));

const liveOpponents = (hero: SeatPlayer, gs: HorseGameStateV2): SeatPlayer[] =>
  (gs.players ?? []).filter((p) => p.seat !== hero.seat && !p.is_folded && !p.is_sitting_out);

/** Nothing to call and a check legal. */
function nothingToCall(hero: SeatPlayer, gs: HorseGameStateV2): boolean {
  if (toCallOf(hero, gs) > 0.005) return false;
  return !(Array.isArray(gs.legalActions) && !gs.legalActions.includes('check'));
}

// ───────────────────────────── the line ─────────────────────────────

export interface OmahaShownLine {
  /** earlier postflop streets this hand on which he bet or raised / only called a wager */
  aggressorStreets: number;
  callerStreets: number;
}

/** His earlier postflop streets (the flop, and the turn on the river): bet or raised, or only called. */
export function omahaShownLine(
  seat: number,
  gs: HorseGameStateV2,
  street: 'turn' | 'river'
): OmahaShownLine {
  let aggressorStreets = 0;
  let callerStreets = 0;
  for (const st of street === 'river' ? ['flop', 'turn'] : ['flop']) {
    let aggr = false;
    let called = false;
    for (const a of gs.actionHistory ?? []) {
      if (String(a.stage) !== st || a.seat !== seat) continue;
      const act = String(a.action);
      if (act === 'bet' || act === 'raise' || act === 'all_in') aggr = true;
      else if (act === 'call' && fin(a.amount) && a.amount > 0) called = true;
    }
    if (aggr) aggressorStreets++;
    else if (called) callerStreets++;
  }
  return { aggressorStreets, callerStreets };
}

/** He bet, raised or called on an earlier postflop street of this hand. */
export function omahaShowedStrength(line: OmahaShownLine): boolean {
  return line.aggressorStreets + line.callerStreets > 0;
}

/** The share of all holdings he holds: 1 with no strength shown, else the shown range moved by his line. */
export function omahaShownRangeShare(line: OmahaShownLine): number {
  if (!omahaShowedStrength(line)) return 1;
  return (
    OMAHA_SHOWN_STRENGTH_RANGE *
    OMAHA_EV_LINE_AGGRESSOR ** line.aggressorStreets *
    OMAHA_EV_LINE_CALLER ** line.callerStreets
  );
}

/** His fold rate to a bet: measured on this street when his read carries it, else the prior. */
export function omahaDisciplineFoldRate(
  street: 'turn' | 'river',
  read: OmahaReadConditional | null
): { fold: number; measured: boolean } {
  if (read && read.measured === true) {
    if (street === 'river' && read.riverCall && read.riverCall.n > 0 && fin(read.riverCall.mean))
      return { fold: clamp(1 - read.riverCall.mean, 0, 1), measured: true };
    if (street === 'turn' && read.foldToBet && read.foldToBet.n > 0 && fin(read.foldToBet.mean))
      return { fold: clamp(read.foldToBet.mean, 0, 1), measured: true };
  }
  return { fold: OMAHA_DISCIPLINE_PRIOR_FOLD[street], measured: false };
}

const holdsVs = (counts: OmahaEvHandCounts, share: number): number => {
  if (share >= 0.999) return counts.all.win + counts.all.tie * 0.5;
  const s = counts.top(clamp(share, 0.01, 0.95));
  return s.win + s.tie * 0.5;
};

/** The exact counts of the Horse's hand (null when the cards are not an Omaha turn or river hand of four or five cards). */
function countsOf(hero: SeatPlayer, gs: HorseGameStateV2): OmahaEvHandCounts | null {
  try {
    return omahaEvHandCounts(
      hero.cards ?? [],
      gs.communityCards ?? [],
      hero.knownDeadCards ?? [],
      0.3
    );
  } catch {
    return null;
  }
}

// ───────────────────────── the bet against the check ─────────────────────────

export interface OmahaBetVsCheckOpponent {
  seat: number;
  /** share of all holdings he holds (1: any) */
  range: number;
  /** his fold rate to a bet, read as a threshold over all holdings */
  fold: number;
  /** already all in: he neither folds nor calls (no fold equity; the bet's chips are not his) */
  allIn?: boolean;
}

export interface OmahaBetVsCheckEv {
  bet: boolean;
  evBet: number;
  evCheck: number;
  margin: number;
  /** chance everyone folds */
  allFold: number;
  /** per opponent: the share of his range that folds, the Horse's share vs his continuing / whole range */
  rows: { seat: number; range: number; folds: number; holdsCalled: number; holdsRange: number }[];
}

/** omahaBetVsCheckEv: the bet of `bet` chips against the check (formula in the file comment). Null when the hand cannot be counted. */
export function omahaBetVsCheckEv(
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  bet: number,
  opponents: readonly OmahaBetVsCheckOpponent[]
): OmahaBetVsCheckEv | null {
  if (!fin(bet) || !(bet > 0) || opponents.length === 0 || !fin(gs.pot) || !(gs.pot > 0))
    return null;
  const counts = countsOf(hero, gs);
  if (!counts) return null;
  if (!opponents.some((o) => o.allIn !== true)) return null;
  const pot = gs.pot;
  let allFold = 1;
  let winOrFold = 1;
  let check = 1;
  /** the Horse's share against every all-in player's whole range (W) */
  let beatsAllIn = 1;
  const rows: OmahaBetVsCheckEv['rows'] = [];
  for (const o of opponents) {
    const range = clamp(fin(o.range) ? o.range : 1, 0.02, 1);
    if (o.allIn === true) {
      const holdsRange = holdsVs(counts, range);
      beatsAllIn *= holdsRange;
      check *= holdsRange;
      rows.push({
        seat: o.seat,
        range: round4(range),
        folds: 0,
        holdsCalled: round4(holdsRange),
        holdsRange: round4(holdsRange),
      });
      continue;
    }
    const cont = clamp(1 - (fin(o.fold) ? o.fold : 0), 0, 1);
    const callShare = Math.min(range, cont);
    const folds = clamp(1 - callShare / range, 0, 1);
    const holdsCalled = callShare > 0.005 ? holdsVs(counts, callShare) : 1;
    const holdsRange = holdsVs(counts, range);
    allFold *= folds;
    winOrFold *= folds + (1 - folds) * holdsCalled;
    check *= holdsRange;
    rows.push({
      seat: o.seat,
      range: round4(range),
      folds: round4(folds),
      holdsCalled: round4(holdsCalled),
      holdsRange: round4(holdsRange),
    });
  }
  const pWin = Math.max(0, winOrFold - allFold);
  const pLose = Math.max(0, 1 - winOrFold);
  const evBet = allFold * beatsAllIn * pot + pWin * (beatsAllIn * pot + bet) - pLose * bet;
  const evCheck = pot * check;
  const margin = OMAHA_DISCIPLINE_BET_MARGIN * pot;
  return {
    bet: evBet > evCheck + margin,
    evBet: Math.round(evBet * 100) / 100,
    evCheck: Math.round(evCheck * 100) / 100,
    margin: Math.round(margin * 100) / 100,
    allFold: round4(allFold),
    rows,
  };
}

/** The opponents of the comparison: every live opponent, his shown range and his fold rate (reads by seat; absent: the prior). */
export function omahaBetVsCheckOpponents(
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  street: 'turn' | 'river',
  reads: ReadonlyMap<number, OmahaReadConditional | null>
): OmahaBetVsCheckOpponent[] {
  return liveOpponents(hero, gs).map((p) =>
    p.is_all_in === true
      ? {
          seat: p.seat,
          range: omahaShownRangeShare(omahaShownLine(p.seat, gs, street)),
          fold: 0,
          allIn: true,
        }
      : {
          seat: p.seat,
          range: omahaShownRangeShare(omahaShownLine(p.seat, gs, street)),
          fold: omahaDisciplineFoldRate(street, reads.get(p.seat) ?? null).fold,
        }
  );
}

/** The chips a bet decision adds (a bet's amount is the street total; an all-in is the stack). */
export function omahaWagerChips(
  hero: SeatPlayer,
  action: string,
  amount: number | undefined
): number | null {
  const own = fin(hero.bet) ? Math.max(0, hero.bet) : 0;
  if (action === 'all_in') return fin(hero.stack) ? hero.stack : null;
  if (action !== 'bet' && action !== 'raise') return null;
  if (!fin(amount)) return null;
  const chips = amount - own;
  return chips > 0 ? Math.min(chips, fin(hero.stack) ? hero.stack : chips) : null;
}

// ───────────────────── 2. no river bluff into a value leader ─────────────────────

export interface OmahaRiverBluffSpot {
  /** the Horse's win-plus-half-tie share against all holdings */
  showdown: number;
  /** live opponents who showed strength this hand (the read is the caller's to check) */
  shownSeats: number[];
}

/**
 * The public spot of omahaNoRiverBluffIntoValueLeader: the river, nothing to
 * call, a hand below the showdown-value line, not nut class, and at least one
 * live opponent who bet, raised or called an earlier postflop street. The nut
 * blocker and the value-leader read are the caller's. Null outside it.
 */
export function omahaRiverBluffIntoValueLeaderSpot(
  hero: SeatPlayer,
  gs: HorseGameStateV2
): OmahaRiverBluffSpot | null {
  try {
    if (inGame(hero, gs) !== 'river' || !nothingToCall(hero, gs)) return null;
    const live = liveOpponents(hero, gs);
    if (live.length === 0) return null;
    const shownSeats = live
      .filter((p) => omahaShowedStrength(omahaShownLine(p.seat, gs, 'river')))
      .map((p) => p.seat);
    if (shownSeats.length === 0) return null;
    const counts = countsOf(hero, gs);
    if (!counts) return null;
    const showdown = counts.all.win + counts.all.tie * 0.5;
    if (!(showdown < OMAHA_SHOWDOWN_VALUE_LINE)) return null;
    if (omahaNutClassNow(hero, gs)) return null;
    return { showdown: round4(showdown), shownSeats };
  } catch {
    return null;
  }
}

// ───────────────────── 3. no multiway bet with a weak hand ─────────────────────

/**
 * The public spot of omahaMultiwayWeakHandNoBet: the turn or the river,
 * nothing to call, two or more live opponents, one pair or less, not nut
 * class, and on the turn no nut-class draw (four or more nut-class outs) and
 * no combo draw. The street, or null outside it.
 */
export function omahaMultiwayWeakHandSpot(
  hero: SeatPlayer,
  gs: HorseGameStateV2
): 'turn' | 'river' | null {
  try {
    const street = inGame(hero, gs);
    if (street === null || !nothingToCall(hero, gs)) return null;
    if (liveOpponents(hero, gs).length < 2) return null;
    const hole = hero.cards;
    const board = gs.communityCards ?? [];
    if (!omahaOnePairOrLess(hole, board)) return null;
    if (omahaNutClassNow(hero, gs)) return null;
    if (street === 'turn') {
      const dead = hero.knownDeadCards ?? [];
      if (omahaNutClassOuts(hole, board, dead) >= ONE_PAIR_MIN_NUT_OUTS) return null;
      if (omahaComboDrawForRaise(hole, board, dead)) return null;
    }
    return street;
  } catch {
    return null;
  }
}

// ───────────────────── 1. the multiway river call ─────────────────────

export interface OmahaMultiwayFieldPlayer {
  seat: number;
  kind: 'caller' | 'all_in' | 'behind';
}

export interface OmahaMultiwayRiverSpot {
  spot: OmahaFacingBetEvSpot;
  field: OmahaMultiwayFieldPlayer[];
}

/**
 * The public spot of omahaMultiwayRiverCallNeedsStrength: the river, facing a
 * bet, at least one opponent beside the bettor still in the hand, not nut
 * class. Null outside it.
 */
export function omahaMultiwayRiverCallSpot(
  hero: SeatPlayer,
  gs: HorseGameStateV2
): OmahaMultiwayRiverSpot | null {
  try {
    if (inGame(hero, gs) !== 'river') return null;
    const spot = omahaFacingBetEvSpot(hero, gs);
    if (!spot || spot.street !== 'river') return null;
    if (spot.callers + spot.allIns + spot.behind < 1) return null;
    if (omahaNutClassNow(hero, gs)) return null;
    const field: OmahaMultiwayFieldPlayer[] = [];
    for (const p of gs.players ?? []) {
      if (p.seat === hero.seat || p.seat === spot.bettorSeat || p.is_folded || p.is_sitting_out)
        continue;
      const bet = fin(p.bet) ? Math.max(0, p.bet) : 0;
      if (p.is_all_in && bet <= 0.005) field.push({ seat: p.seat, kind: 'all_in' });
      else if (spot.callerSeats.includes(p.seat)) field.push({ seat: p.seat, kind: 'caller' });
      else field.push({ seat: p.seat, kind: 'behind' });
    }
    return { spot, field };
  } catch {
    return null;
  }
}

export interface OmahaMultiwayRiverCallVerdict {
  call: boolean;
  ev: number;
  margin: number;
  pWin: number;
  pTie: number;
  /** against the bettor alone (HorseOmahaFacingBetEv, heads-up) */
  headsUpPWin: number;
  /** the product of the field factors, and each player's continuing share */
  field: number;
  shares: {
    seat: number;
    kind: OmahaMultiwayFieldPlayer['kind'];
    share: number;
    measured: boolean;
  }[];
  price: number;
  /** the bettor's value region used: his heads-up share made multiway (omahaMultiwayValueShare) */
  valueShare: number;
}

/**
 * DERIVED (2026-11-16, wave two): the bettor's value region when he bets into
 * n live opponents. The heads-up value region V1 (OMAHA_EV_VALUE_SHARE by
 * size, times the line factors) holds the hands he bets for value against one
 * opponent; its weakest hand beats 1 - V1 of all holdings. Under this
 * module's own independence assumption that hand is best against n
 * opponents with probability (1 - V1)^n, so against n players he needs a
 * stronger hand for the same chance of being best: the weakest value hand
 * beats 1 - Vn of holdings with (1 - Vn)^n = 1 - V1, that is
 * Vn = 1 - (1 - V1)^(1/n). Heads-up (n = 1) it is V1; it never widens the
 * region and adds no constant. Read only by omahaMultiwayRiverCallVerdict
 * (omahaMultiwayRiverCallNeedsStrength, default OFF); the facing-bet EV
 * option keeps its heads-up region.
 */
export function omahaMultiwayValueShare(headsUpShare: number, opponents: number): number {
  const v1 = clamp(fin(headsUpShare) ? headsUpShare : 0, 0, 1);
  const n = fin(opponents) ? Math.max(1, Math.floor(opponents)) : 1;
  if (n === 1) return v1;
  return 1 - Math.pow(1 - v1, 1 / n);
}

/** A field player's continuing share: the population share, moved by his measured river-call rate. */
export function omahaMultiwayFieldShare(
  kind: OmahaMultiwayFieldPlayer['kind'],
  read: OmahaReadConditional | null
): { share: number; measured: boolean } {
  if (kind === 'all_in') return { share: OMAHA_EV_ALL_IN_SHARE, measured: false };
  const base = kind === 'caller' ? OMAHA_EV_CALLER_SHARE.river : OMAHA_EV_BEHIND_SHARE;
  if (
    read &&
    read.measured === true &&
    read.riverCall &&
    read.riverCall.n > 0 &&
    fin(read.riverCall.mean)
  ) {
    const k = clamp(
      read.riverCall.mean / OMAHA_MW_RIVER_POP_CONTINUE,
      OMAHA_MW_RIVER_CALLER_SCALE_MIN,
      OMAHA_MW_RIVER_CALLER_SCALE_MAX
    );
    return { share: clamp(base * k, 0.05, 0.9), measured: true };
  }
  return { share: base, measured: false };
}

/**
 * The multiway river call: the heads-up exact-hand verdict against the
 * bettor, times the chance of beating every other player's continuing range
 * (independent), priced on the actual pot and call. Null when the hand
 * cannot be counted.
 */
export function omahaMultiwayRiverCallVerdict(
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  mw: OmahaMultiwayRiverSpot,
  bettorRead: OmahaFacingBetEvRead | null,
  fieldReads: ReadonlyMap<number, OmahaReadConditional | null>,
  ctx: OmahaFacingBetEvContext = {}
): OmahaMultiwayRiverCallVerdict | null {
  const { spot } = mw;
  const hole = hero.cards ?? [];
  const board = gs.communityCards ?? [];
  const dead = hero.knownDeadCards ?? [];
  // The bettor bet into the Horse and every field player: his value region
  // is the multiway one (omahaMultiwayValueShare), not the heads-up share.
  const valueShare = omahaMultiwayValueShare(spot.valueShare, 1 + mw.field.length);
  const alone: OmahaFacingBetEvSpot = {
    ...spot,
    callers: 0,
    allIns: 0,
    behind: 0,
    callerSeats: [],
    valueShare,
  };
  const hu = omahaFacingBetEvVerdict(alone, hole, board, dead, bettorRead, {
    ...ctx,
    riskPremium: 0,
  });
  if (!hu) return null;
  let counts: OmahaEvHandCounts | null;
  try {
    counts = omahaEvHandCounts(hole, board, dead, valueShare);
  } catch {
    counts = null;
  }
  if (!counts) return null;
  let field = 1;
  const shares: OmahaMultiwayRiverCallVerdict['shares'] = [];
  for (const f of mw.field) {
    const { share, measured } = omahaMultiwayFieldShare(f.kind, fieldReads.get(f.seat) ?? null);
    const holds = holdsVs(counts, share);
    field *= f.kind === 'behind' ? 1 - share * (1 - holds) : holds;
    shares.push({ seat: f.seat, kind: f.kind, share: round4(share), measured });
  }
  const pWin = hu.pWin * field;
  const pTie = hu.pTie * field;
  const rake = Math.max(0, Math.min(0.2, fin(ctx.rake) ? ctx.rake : 0));
  const win = spot.winnable * (1 - rake);
  const pLose = Math.max(0, 1 - pWin - pTie);
  const ev = pWin * win + pTie * ((win - spot.paid) / 2) - pLose * spot.paid;
  return {
    call: ev > hu.margin,
    ev: Math.round(ev * 100) / 100,
    margin: Math.round(hu.margin * 100) / 100,
    pWin: round4(pWin),
    pTie: round4(pTie),
    headsUpPWin: round4(hu.pWin),
    field: round4(field),
    shares,
    price: round4(hu.price),
    valueShare: round4(valueShare),
  };
}

// ───────────── 4. the multiway check that is priced against the bet ─────────────

/**
 * omahaMultiwayCheckedToBetIsPriced (lane MULTIWAY-BET 2026-11-19, default OFF, read `=== true` by HorseLogic).
 *
 * THE LEAK (archive woowoo-48h-audit-01BNteGYgf, repairs/VALUE-REGION and repairs/MULTIWAY-BET/MEASUREMENT.md):
 * the human's largest winning bucket is single-raised multiway pots where the Horses check their made hands and
 * then fold correctly to his turn or river bet; 109 of 215 multiway turn folders had checked first (56 with two pair,
 * 14 with the best hand of the field). In the fit window (2026-11-01..15, 10,233 Horse multiway decisions with
 * nothing to call) the Horses checked two pair 86-99% of the time and someone bet behind 37-48% of their flop and
 * turn checks.
 *
 * THE DECISION. This module owns the multiway bet-against-check price (omahaBetVsCheckEv above prices a bet the
 * Horse chose; this prices a check it chose). PLO4/PLO5 cash, one board, high only, pot limit, no bomb pot, a pot not
 * re-raised before the flop, the flop, the turn or the river, nothing to call, two or more live opponents: the
 * owner's check is compared with a bet of each candidate size (OMAHA_CARD_IMPACT_SIZES of the pot, a candidate set
 * and not a threshold), and the best bet replaces the check only when it is worth more than the check by
 * OMAHA_DISCIPLINE_BET_MARGIN of the pot. No hand class, position or size decides; the inputs are:
 *  - the Horse's showdown share against the strongest share V_j of all holdings for each opponent (V_j as
 *    omahaShownRangeShare: 1 on the flop and with no strength shown; exact counts on the turn and the river, the
 *    sampled flop counts of HorseOmahaFlopFacingBetEv on the flop), ranges independent as in omahaBetVsCheckEv;
 *  - the MEASURED response of each opponent's kind (a person or a Horse), as a function of his own strength, to a first bet into a multiway pot on this
 *    street, by the bet's share of the pot (OMAHA_MW_CHECKED_TO_RESPONSE): he continues with the strongest c(s) of his
 *    range, and of what continues the measured share r raises;
 *  - the MEASURED cost of the check: each opponent still to act on this street bets with his kind's measured rate
 *    when checked to, at his kind's measured share of the pot, and the Horse then continues only when the call is
 *    worth it against that betting range (the strongest rate x V_j of his range) and the other ranges.
 *
 *   EV(check)  = P(no bet behind) x pot x prod_j s_j + sum_j P(j first to bet) x max(0, h_j (pot + 2b_j) - b_j)
 *   EV(bet B)  = F x W x pot + (prod_j t_j - F) x (W x pot + B) - (1 - prod_j t_j) x B,
 *   t_j        = (1 - c_j) + c_j (1 - r_j) x share vs his continuing range
 *                + c_j r_j x (share vs his raising range, only when it is above one half: else the Horse folds its bet)
 * with F the chance everyone with chips folds, W the share against every all-in player's range.
 *
 * LIMITS. A one-street model: equity is credited as showdown equity (no later betting is priced on the flop or the
 * turn), a winning bet is credited the pot and one caller's bet, rake is not deducted, the measured curves pool every
 * texture and every bettor, and a player who checked before the Horse is not credited a check-raise. Pure: no random
 * draw (the flop sample is seeded by the cards), no telemetry, no opponent memory.
 */

/**
 * MEASURED (repairs/MULTIWAY-BET/MEASUREMENT.md section D; fit window 2026-11-01 00:00Z..2026-11-16 00:00Z, 6,814
 * PLO4/PLO5 cash hands with a person seated, pots not re-raised before the flop, three or more players live), by street
 * and kind, as functions of the player's own strength u (the share of all holdings that beat his current hand on this
 * board, ties half; x = ln(u + 0.01)):
 *   continue facing the first bet of a street  = sigmoid(ca + cu x + cs ln(share of pot))   (n responses)
 *   raise, of the hands that continue          = sigmoid(ra + ru x)                         (nr continues)
 *   bet when checked to with nothing to call   = sigmoid(qa + qu x)                         (nq decisions)
 *   betShare: the median share of the pot of that kind's first bets on that street.
 * Conditioning on his strength matters: the unconditional fold rate is measured where bettors are strong and
 * responders weak, and applied to a bet from any hand it credited bluffs with folds they do not get (in-sample:
 * river -12.2 bb per change, MEASUREMENT.md section D).
 */
export const OMAHA_MW_CHECKED_TO_RESPONSE: Readonly<
  Record<
    string,
    {
      ca: number;
      cu: number;
      cs: number;
      ra: number;
      ru: number;
      qa: number;
      qu: number;
      betShare: number;
      n: number;
      nr: number;
      nq: number;
    }
  >
> = {
  'flop|person': {
    ca: -1.4283,
    cu: -1.4343,
    cs: -0.791,
    ra: -3.9861,
    ru: -1.0431,
    qa: -2.079,
    qu: -1.116,
    betShare: 0.7667,
    n: 866,
    nr: 482,
    nq: 1280,
  },
  'flop|horse': {
    ca: -3.1194,
    cu: -1.3479,
    cs: -1.6894,
    ra: -3.7557,
    ru: -0.9164,
    qa: -2.5132,
    qu: -0.9355,
    betShare: 0.5043,
    n: 3431,
    nr: 1083,
    nq: 4125,
  },
  'turn|person': {
    ca: -2.1993,
    cu: -1.6579,
    cs: -1.2273,
    ra: -3.6699,
    ru: -1.0029,
    qa: -1.731,
    qu: -1.1542,
    betShare: 0.766,
    n: 600,
    nr: 271,
    nq: 468,
  },
  'turn|horse': {
    ca: -3.2257,
    cu: -2.0687,
    cs: -1.5233,
    ra: -4.132,
    ru: -1.143,
    qa: -2.7813,
    qu: -1.5501,
    betShare: 0.5667,
    n: 2012,
    nr: 737,
    nq: 1628,
  },
  'river|person': {
    ca: -5.0134,
    cu: -2.5997,
    cs: -1.0041,
    ra: -3.2907,
    ru: -1.0852,
    qa: -2.403,
    qu: -1.2741,
    betShare: 0.5476,
    n: 177,
    nr: 24,
    nq: 266,
  },
  'river|horse': {
    ca: -4.4815,
    cu: -2.6649,
    cs: -1.216,
    ra: -6.9031,
    ru: -2.7363,
    qa: -5.3391,
    qu: -2.8665,
    betShare: 0.8148,
    n: 632,
    nr: 162,
    nq: 885,
  },
};

/** STATED (a quadrature, not a threshold): the edges, as shares of his range from its strongest end, over which his range is integrated. */
export const OMAHA_MW_RANGE_EDGES: readonly number[] = [
  0, 0.02, 0.05, 0.1, 0.2, 0.3, 0.45, 0.6, 0.8, 1,
];

/** The variants of the option: four- and five-card Omaha only (PLO6 is untouched). */
export const OMAHA_MW_CHECKED_TO_VARIANTS: ReadonlySet<string> = new Set(['plo4', 'plo5']);

const MW_BOARD: Record<string, number> = { flop: 3, turn: 4, river: 5 };

export interface OmahaMwCheckedToOpponent {
  seat: number;
  horse: boolean;
  allIn: boolean;
  /** still to act on this street */
  behind: boolean;
  /** share of all holdings he holds (1: any) */
  range: number;
}

export interface OmahaMwCheckedToSpot {
  street: 'flop' | 'turn' | 'river';
  opponents: OmahaMwCheckedToOpponent[];
}

/** The option's public spot (no hole card is read except for the hand's own shape). Null outside it. */
export function omahaMultiwayCheckedToBetSpot(
  hero: SeatPlayer,
  gs: HorseGameStateV2
): OmahaMwCheckedToSpot | null {
  try {
    const variant = String(gs.gameVariant ?? '').toLowerCase();
    if (!OMAHA_MW_CHECKED_TO_VARIANTS.has(variant)) return null;
    const stage = String(gs.stage ?? '');
    if (stage !== 'flop' && stage !== 'turn' && stage !== 'river') return null;
    const vi = variantInfo(variant);
    if (!vi.isOmaha || vi.isFixedLimit || gs.bettingStructure === 'fixed_limit') return null;
    if (gs.variantRules ? gs.variantRules.splitLow8OrBetter : vi.isHiLo) return null;
    if (
      (gs.boardCount ?? 1) > 1 ||
      (gs.communityCards2?.length ?? 0) > 0 ||
      (gs.communityCards3?.length ?? 0) > 0
    )
      return null;
    if (gs.allInOrFold === true || gs.wagersCapped === true || gs.bombPot === true) return null;
    if (omahaIsTournamentMode(gs)) return null;
    if ((gs.communityCards ?? []).length !== MW_BOARD[stage]) return null;
    if (!Array.isArray(hero.cards) || hero.cards.length !== vi.holeCount) return null;
    if (hero.is_folded || hero.is_all_in || hero.is_sitting_out) return null;
    if (!fin(hero.stack) || !(hero.stack > 0) || !fin(gs.pot) || !(gs.pot > 0)) return null;
    if (!nothingToCall(hero, gs)) return null;
    if (Array.isArray(gs.legalActions) && !gs.legalActions.includes('bet')) return null;
    const history = gs.actionHistory ?? [];
    let preflopRaises = 0;
    for (const a of history) {
      if (String(a.stage) !== 'preflop') continue;
      const act = String(a.action);
      if (act === 'raise' || act === 'bet' || act === 'all_in') preflopRaises++;
    }
    if (preflopRaises > 1) return null;
    const live = liveOpponents(hero, gs);
    if (live.length < 2 || !live.some((p) => p.is_all_in !== true)) return null;
    const actedThisStreet = new Set<number>();
    for (const a of history)
      if (String(a.stage) === stage && fin(a.seat)) actedThisStreet.add(a.seat);
    const seatCount = Math.max(
      10,
      ...(gs.players ?? []).map((p) => (fin(p.seat) ? p.seat + 1 : 0))
    );
    const order = (seat: number): number => (seat - hero.seat + seatCount) % seatCount;
    const opponents = live
      .map((p) => ({
        seat: p.seat,
        horse: p.is_horse === true,
        allIn: p.is_all_in === true,
        behind: p.is_all_in !== true && !actedThisStreet.has(p.seat),
        range:
          stage === 'flop'
            ? 1
            : omahaShownRangeShare(omahaShownLine(p.seat, gs, stage as 'turn' | 'river')),
      }))
      .sort((x, y) => order(x.seat) - order(y.seat));
    return { street: stage, opponents };
  } catch {
    return null;
  }
}

type MwCounts =
  | { kind: 'exact'; counts: OmahaEvHandCounts }
  | { kind: 'flop'; counts: OmahaFlopEvCounts };

function mwCountsOf(hero: SeatPlayer, gs: HorseGameStateV2, street: string): MwCounts | null {
  try {
    if (street === 'flop') {
      const c = omahaFlopEvCounts(
        hero.cards ?? [],
        gs.communityCards ?? [],
        hero.knownDeadCards ?? [],
        0.3
      );
      return c ? { kind: 'flop', counts: c } : null;
    }
    const c = countsOf(hero, gs);
    return c ? { kind: 'exact', counts: c } : null;
  } catch {
    return null;
  }
}

/** The Horse's win-plus-half-tie share against the strongest `share` of all holdings. */
function mwHolds(c: MwCounts, share: number): number {
  if (c.kind === 'exact') return holdsVs(c.counts, share);
  const s = c.counts.top(clamp(share, 0.02, 1));
  return s.win + s.tie * 0.5;
}

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));
const strengthX = (u: number): number => Math.log(clamp(u, 0, 1) + 0.01);

/** His kind's measured response row on this street. */
export function omahaMwCheckedToResponse(street: string, horse: boolean) {
  return OMAHA_MW_CHECKED_TO_RESPONSE[`${street}|${horse ? 'horse' : 'person'}`] ?? null;
}

/** The chance a hand of strength u continues facing a bet of `share` of the pot (measured curve). */
export function omahaMwContinueShare(
  street: string,
  horse: boolean,
  share: number,
  u: number
): number {
  const r = omahaMwCheckedToResponse(street, horse);
  if (!r || !(share > 0)) return 1;
  return clamp(sigmoid(r.ca + r.cu * strengthX(u) + r.cs * Math.log(Math.max(0.05, share))), 0, 1);
}

/** His range of strongest share `range`, cut into OMAHA_MW_RANGE_EDGES: weight, mid strength, and the Horse's share against the slice. */
function mwRangeSlices(c: MwCounts, range: number): { w: number; u: number; h: number }[] {
  const V = clamp(range, 0.02, 1);
  const H = (x: number): number => (x <= 0 ? 0 : mwHolds(c, x));
  const out: { w: number; u: number; h: number }[] = [];
  for (let i = 1; i < OMAHA_MW_RANGE_EDGES.length; i++) {
    const lo = OMAHA_MW_RANGE_EDGES[i - 1] * V;
    const hi = OMAHA_MW_RANGE_EDGES[i] * V;
    const h = clamp((hi * H(hi) - lo * H(lo)) / (hi - lo), 0, 1);
    out.push({ w: OMAHA_MW_RANGE_EDGES[i] - OMAHA_MW_RANGE_EDGES[i - 1], u: (lo + hi) / 2, h });
  }
  return out;
}

/** The candidate bets: OMAHA_CARD_IMPACT_SIZES of the pot, legal, short of all in. */
export function omahaMwCheckedToAmounts(hero: SeatPlayer, gs: HorseGameStateV2): number[] {
  const pot = gs.pot;
  const min =
    fin(gs.minRaiseTo) && (gs.minRaiseTo as number) > 0
      ? (gs.minRaiseTo as number)
      : (gs.bigBlind ?? 1);
  const max = Math.min(
    fin(gs.maxRaiseTo) && (gs.maxRaiseTo as number) > 0 ? (gs.maxRaiseTo as number) : pot,
    hero.stack
  );
  const whole = (gs.bigBlind ?? 1) >= 1;
  const out: number[] = [];
  for (const f of OMAHA_CARD_IMPACT_SIZES) {
    let a = f * pot;
    a = whole ? Math.round(a) : Math.round(a * 100) / 100;
    a = Math.round(clamp(a, Math.min(min, max), max) * 100) / 100;
    if (!(a > 0) || a >= hero.stack - 0.005) continue;
    if (!out.includes(a)) out.push(a);
  }
  return out;
}

export interface OmahaMwCheckedToVerdict {
  /** the bet to make, or null: the check stands */
  amount: number | null;
  evCheck: number;
  /** EV of each candidate bet */
  bets: { amount: number; ev: number; allFold: number }[];
  margin: number;
  /** chance nobody behind bets after the check */
  noBetBehind: number;
}

/** The verdict at `spot` (formula in the section comment). Null when the hand cannot be counted or nothing can be bet. */
export function omahaMultiwayCheckedToBetVerdict(
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  spot: OmahaMwCheckedToSpot
): OmahaMwCheckedToVerdict | null {
  const amounts = omahaMwCheckedToAmounts(hero, gs);
  if (amounts.length === 0) return null;
  const counts = mwCountsOf(hero, gs, spot.street);
  if (!counts) return null;
  const pot = gs.pot;
  const street = spot.street;
  const slices = spot.opponents.map((o) => mwRangeSlices(counts, o.range));
  const holdsRange = slices.map((sl) => sl.reduce((x, k) => x + k.w * k.h, 0));
  const whole = holdsRange.reduce((x, y) => x * y, 1);
  // The check: the players still to act, in turn, bet from the strong end of their range at their measured rate.
  let noBet = 1;
  let face = 0;
  spot.opponents.forEach((o, j) => {
    if (!o.behind) return;
    const r = omahaMwCheckedToResponse(street, o.horse);
    if (!r) return;
    let q = 0;
    let qh = 0;
    for (const k of slices[j]) {
      const qk = sigmoid(r.qa + r.qu * strengthX(k.u));
      q += k.w * qk;
      qh += k.w * qk * k.h;
    }
    if (!(q > 0)) return;
    const b = r.betShare * pot;
    const others = holdsRange.reduce((x, y, i) => (i === j ? x : x * y), 1);
    const h = (qh / q) * others;
    face += noBet * q * Math.max(0, h * (pot + 2 * b) - b);
    noBet *= 1 - q;
  });
  const evCheck = noBet * pot * whole + face;
  const bets: OmahaMwCheckedToVerdict['bets'] = [];
  for (const B of amounts) {
    const share = B / pot;
    let allFold = 1;
    let take = 1;
    let beatsAllIn = 1;
    spot.opponents.forEach((o, j) => {
      if (o.allIn) {
        beatsAllIn *= holdsRange[j];
        return;
      }
      const r = omahaMwCheckedToResponse(street, o.horse);
      let fold = 0;
      let t = 0;
      for (const k of slices[j]) {
        const c = omahaMwContinueShare(street, o.horse, share, k.u);
        const raise = r ? clamp(sigmoid(r.ra + r.ru * strengthX(k.u)), 0, 1) : 0;
        fold += k.w * (1 - c);
        t += k.w * (1 - c + c * (1 - raise) * k.h + c * raise * (k.h > 0.5 ? k.h : 0));
      }
      allFold *= fold;
      take *= t;
    });
    const pWin = Math.max(0, take - allFold);
    const pLose = Math.max(0, 1 - take);
    const ev = allFold * beatsAllIn * pot + pWin * (beatsAllIn * pot + B) - pLose * B;
    bets.push({ amount: B, ev: Math.round(ev * 100) / 100, allFold: round4(allFold) });
  }
  const margin = OMAHA_DISCIPLINE_BET_MARGIN * pot;
  let best: { amount: number; ev: number } | null = null;
  for (const b of bets) if (best === null || b.ev > best.ev + 1e-9) best = b;
  const amount = best !== null && best.ev > evCheck + margin ? best.amount : null;
  return {
    amount,
    evCheck: Math.round(evCheck * 100) / 100,
    bets,
    margin: Math.round(margin * 100) / 100,
    noBetBehind: round4(noBet),
  };
}
