/**
 * V81 OMAHA BIG-BET CALL DISCIPLINE (2026-11-02, Phase 4 of the horse
 * improvement program). PLO4 / PLO5 only.
 *
 * Evidence: the DECISION EV of the horses' own turn/river CALLS of a bet they
 * did not start (net + chips already invested at the node, in bb: the call's
 * value against folding, chops at their fractional return, later streets
 * included), hand_history + ca_hand_facts on the old engine eed06fe5, every
 * hand kept, 95% CIs clustered by hand. The hand is classified AT THE
 * DECISION with the engine's own evaluator (omahaNutStatus), not from the
 * final board. Excluded from measurement and from the rule: heads-up tables,
 * bounty / PKO / mystery-bounty events, 20bb effective or less. Two
 * independent days, 47,806 calls in all (day A 2026-10-31 16:00 to 11-01 16:00
 * UTC, day B 11-01 16:00 to 11-02 16:00 UTC). The wager is measured exactly as
 * the engine computes it (v81StreetWager): the chips the last bettor added,
 * over the pot just before that bet. Facing >= 0.9 pot, mean EV [95% CI], n:
 *
 *   RIVER                                day A                      day B
 *   straight, flush possible          -43.0 [-53.2, -32.8] n 43   -43.6 [-50.7, -36.5] n 62
 *   straight, not the nut             -48.9 [-61.5, -36.3] n 138  -36.8 [-43.8, -29.9] n 113
 *   straight, paired board            -33.0 [-42.9, -23.1] n 41   -21.0 [-29.1, -13.0] n 25
 *   flush, 3rd nut or worse           -54.1 [-79.8, -28.4] n 49   -77.5 [-111.5, -43.5] n 52
 *   nut / 2nd-nut flush, paired board -37.6 [-48.6, -26.6] n 54   -24.7 [-39.1, -10.2] n 41
 *   2nd-nut flush (PLO5 only)         -39.0 [-69.5, -8.4] n 58    -58.5 [-89.0, -28.0] n 40
 *   two pair                          -44.2 [-50.6, -37.8] n 106  -40.6 [-47.6, -33.6] n 78
 *   TURN
 *   flush, 3rd nut or worse (cash)    -21.5 [-34.8, -8.2] n 152   -17.7 [-31.1, -4.3] n 124
 *   straight, paired board            -32.0 [-57.0, -6.9] n 14    -16.7 [-30.0, -3.5] n 16
 *
 * Admission rule: the cell is below zero on both days AND no variant (PLO4,
 * PLO5) or format (cash, tournament) slice of it with n >= 10 has a positive
 * mean on either day. That rule is why the unpaired second-nut flush is PLO5
 * only (PLO4 day B +6.2, n 26) and the turn dominated flush is cash only
 * (tournament day B +14.9, n 16). NOT admitted: turn straights on a flush
 * board (day A straddles), turn non-nut straights and two pair, turn paired-
 * board flushes, the 0.5-0.9 pot band, sets and trips, full houses (the
 * evaluator cannot tell a nut boat from an underboat here), nut straights and
 * unpaired nut flushes (both win), one pair (wins). Per-slice outputs:
 * docs/horse-measure/2026-11-02/v81-omaha-call-cells.txt.
 *
 * Complements the live paired-board fold (HorsePloPairedBoardFold: no
 * committing call without a full house on a paired board): V81's paired-board
 * cells add the NON-committing pot-sized calls that rule leaves open. A bettor
 * MEASURED as a postflop over-bluffer (isPostflopManiac; never the PLO
 * preflop presumption) keeps today's call-down (HorseManiacPressure).
 *
 * Limits: only the horses' own calls are observed (no counterfactual fold
 * policy), ICM is not modelled, the price ignores players still to act, and
 * the engine is narrower than the measurement: a horse with chips already in
 * this street (the sample kept calls after an earlier call) is out of scope.
 * The sample's bettor lookup took the last bet / raise / all-in whose amount
 * equalled the current bet, so an all-in CALL that exactly matched the bet
 * could stand in for the bettor; the engine only counts a raising action.
 */
import type { Card, HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { hasRiverNuts } from './HorseRiverNuts.js';
import { omahaBoatPosition, omahaNutStatus, scoreOmahaHi } from './HorseEval.js';

export const V81_VARIANTS: ReadonlySet<string> = new Set(['plo4', 'plo5']);
export const V81_MIN_POT_FRAC = 0.9;
export const V81_MIN_EFFECTIVE_BB = 20;
/** V81 folds only a call priced at this share of the final pot or more
 * (2026-11-12, HVH2D-PLO-005). The cells were measured on calls of a wager of
 * 0.9 pot or more by a stack that could pay it, a price of about a third. A
 * stack far shorter than the wager pays much less: hand 58724590, PLO5 river,
 * a ten-high straight with 46bb behind a 335bb pot-sized bet was folded at a
 * price of 0.065 with one two-card holding ahead of it. The evidence says
 * nothing about a call that cheap, so the reference call stands there. The
 * price and the floor are the ones V84 documents for the same reason. */
export const V81_MIN_CALL_PRICE = 0.13;

const RV: Record<string, number> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

/** Three distinct board ranks inside some 5-rank window (wheel included). */
export function omahaStraightPossible(board: Card[]): boolean {
  const r = new Set(board.map((c) => RV[c.rank]));
  if (r.has(14)) r.add(1);
  for (let lo = 1; lo <= 10; lo++) {
    let n = 0;
    for (let k = 0; k < 5; k++) if (r.has(lo + k)) n++;
    if (n >= 3) return true;
  }
  return false;
}

/** The made-hand class at the decision, as measured (omaha-call-cells.ts). */
export function omahaCallClass(hole: Card[], board: Card[]): string {
  const st = omahaNutStatus(hole, board);
  const paired = new Set(board.map((c) => c.rank)).size < board.length;
  const c = st.category;
  if (c >= 7) return 'full_house_plus';
  if (c === 6) {
    const f =
      st.higherFlushRanks === 0 ? 'nut' : st.higherFlushRanks === 1 ? 'second' : 'dominated';
    return `flush_${f}${paired ? '_paired' : ''}`;
  }
  if (c === 5) {
    if (st.flushPossible) return `straight_flushboard${paired ? '_paired' : ''}`;
    if (paired) return 'straight_paired';
    return st.straightIsNut ? 'straight_nut' : 'straight_nonnut';
  }
  if (c === 4)
    return `trips_set_${st.flushPossible || omahaStraightPossible(board) ? 'drawy' : 'dry'}`;
  if (c === 3) return 'two_pair';
  if (c === 2) return 'one_pair';
  return 'no_pair';
}

const RIVER_CELLS = new Set([
  'straight_flushboard',
  'straight_flushboard_paired',
  'straight_nonnut',
  'straight_paired',
  'flush_dominated',
  'flush_dominated_paired',
  'flush_nut_paired',
  'flush_second_paired',
  'two_pair',
]);
const TURN_CELLS = new Set(['straight_paired', 'straight_flushboard_paired']);
const TURN_CASH_CELLS = new Set(['flush_dominated', 'flush_dominated_paired']);

/** One public action as the engine records it (call amounts are incremental;
 *  bet / raise / all-in amounts are the street total raised to). */
export interface V81Action {
  stage: string;
  seat: number;
  action: string;
  amount: number;
}

/**
 * The wager the horse faces on `street`, measured exactly as the evidence was:
 * the last bet, raise or raising all-in on the street, the chips that bettor
 * ADDED with it, and the pot just before it. Returns null when the street's
 * history does not reconcile with the chips on the table (any doubt: no fold).
 */
export function v81StreetWager(
  history: readonly V81Action[] | undefined,
  street: string,
  streetBets: ReadonlyMap<number, number>,
  pot: number
): { bettorSeat: number; wager: number; potBefore: number } | null {
  if (!Array.isArray(history) || !(pot > 0)) return null;
  const total = new Map<number, number>();
  const adds: number[] = [];
  let maxTotal = 0;
  let last: { seat: number; wager: number; index: number } | null = null;
  for (const a of history) {
    if (String(a.stage) !== street) continue;
    const prev = total.get(a.seat) ?? 0;
    const amt = Number.isFinite(a.amount) ? Math.max(0, a.amount) : 0;
    let add = 0;
    if (a.action === 'call') add = amt;
    else if (a.action === 'bet' || a.action === 'raise' || a.action === 'all_in')
      add = Math.max(0, amt - prev);
    else continue;
    const now = prev + add;
    if (
      (a.action === 'bet' || a.action === 'raise' || a.action === 'all_in') &&
      now > maxTotal + 0.005
    ) {
      last = { seat: a.seat, wager: add, index: adds.length };
      maxTotal = now;
    }
    total.set(a.seat, now);
    adds.push(add);
  }
  if (!last || !(last.wager > 0)) return null;
  // The replayed street totals must match the bets on the table.
  for (const [seat, t] of total) if (Math.abs((streetBets.get(seat) ?? 0) - t) > 0.011) return null;
  const streetChips = adds.reduce((x, y) => x + y, 0);
  const potStart = pot - streetChips;
  const potBefore = potStart + adds.slice(0, last.index).reduce((x, y) => x + y, 0);
  if (!(potStart >= 0) || !(potBefore > 0)) return null;
  return { bettorSeat: last.seat, wager: last.wager, potBefore };
}

export interface V81Input {
  variant: string;
  street: string;
  hole: Card[];
  board: Card[];
  /** The wager faced as a share of the pot before it. */
  potFrac: number;
  effectiveBB: number;
  tournament: boolean;
  headsUpTable: boolean;
  bountyEvent: boolean;
  hiLo: boolean;
  multiBoard: boolean;
  bombPot: boolean;
  /** The horse already has chips in on this street. */
  heroHasStreetChips: boolean;
  /** The bettor is MEASURED as a postflop over-bluffer (isPostflopManiac). */
  bettorOverBluffs: boolean;
  /** What the horse can actually pay, as a share of the pot after paying it:
   *  min(toCall, stack) / (pot + min(toCall, stack)). */
  callPrice: number;
}

/** The measured cell this call falls in, or null when V81 does not apply. */
export function v81Cell(i: V81Input): string | null {
  const variant = String(i.variant).toLowerCase();
  if (!V81_VARIANTS.has(variant)) return null;
  if (i.hiLo || i.multiBoard || i.bombPot || i.headsUpTable || i.bountyEvent) return null;
  if (i.heroHasStreetChips || i.bettorOverBluffs) return null;
  if (!(i.potFrac >= V81_MIN_POT_FRAC) || !(i.effectiveBB > V81_MIN_EFFECTIVE_BB)) return null;
  if (!(i.callPrice >= V81_MIN_CALL_PRICE)) return null;
  if (!Array.isArray(i.hole) || i.hole.length !== (variant === 'plo4' ? 4 : 5)) return null;
  if (i.street === 'river' && i.board.length === 5) {
    const cls = omahaCallClass(i.hole, i.board);
    if (RIVER_CELLS.has(cls)) return cls;
    if (cls === 'flush_second' && variant === 'plo5') return cls;
    return null;
  }
  if (i.street === 'turn' && i.board.length === 4) {
    const cls = omahaCallClass(i.hole, i.board);
    if (TURN_CELLS.has(cls)) return cls;
    if (TURN_CASH_CELLS.has(cls) && !i.tournament) return cls;
    return null;
  }
  return null;
}

/**
 * V84 OMAHA RIVER RE-RAISE CALL DISCIPLINE (2026-11-07). PLO4 / PLO5 / PLO6.
 *
 * The call side V81 leaves out: the horse BET or RAISED the river itself and
 * now faces a raise of 0.9 pot or more (heroHasStreetChips). Hand 3359656,
 * PLO6 tournament: Kd-high flush (no Ad) on 9d 7d 2d 4s 6s bet 2,858 into
 * 4,090, was raised to 12,664 and called 9,806, losing 587bb.
 *
 * Evidence, same methodology as V81: the DECISION EV of the horses' own river
 * calls after their own river bet or raise (net + chips already invested at
 * the node, in bb), hand_history + ca_hand_facts (every PLO hand is in both;
 * horse_hand_reviews holds 1.6% of them and was not used), every hand kept,
 * 95% CIs clustered by hand, the hand classified AT THE DECISION with
 * omahaCallClass, the wager measured as v81StreetWager does. Excluded as in
 * V81: heads-up tables, bounty events, 20bb effective or less. Day A
 * 2026-11-05 16:00 to 11-06 16:00 UTC, day B 11-06 16:00 to 11-07 16:00 UTC.
 * Facing >= 0.9 pot, mean EV [95% CI], n:
 *
 *   flush_second (unpaired)   day A -100.8 [-159.5, -42.0] n 12   day B -93.0 [-130.3, -55.6] n 15
 *
 * All 27 calls lost. Slices (A / B): PLO4 -76.8 n 5 / -99.0 n 12, PLO5 -113.0
 * n 2 / -72.9 n 2, PLO6 -119.8 n 5 / -60.5 n 1, cash -79.1 n 9 / -93.0 n 15,
 * tournament -165.8 n 3 / none: no slice positive on either day.
 *
 * Admission rule (V81's, with one floor added): below zero on both days, no
 * variant or format slice with n >= 10 positive on either day, AND at least
 * 10 hands in the cell on each day (a two-hand CI is not evidence). NOT
 * admitted: flush_second_paired (-43.0 n 2 / -54.2 n 4, below the floor),
 * two pair (straddles day A, n 3), straight_flushboard (straddles day A, n 2),
 * straight_nonnut (straddles day B), straight_paired (straddles day A),
 * flush_nut_paired (n 1 day A), nut straights and full houses (win).
 * Per-slice outputs: docs/horse-measure/2026-11-07/v84-river-reraise-cells.txt.
 *
 * Denominator (re-measured 2026-11-07 before activation, same two days, no
 * filter at all: omaha-river-reraise-opportunities.sql and
 * omaha-river-reraise-denominator.ts): the horses met this spot with an
 * unpaired second-nut flush 49 times and CALLED all 49 (no fold, no re-raise);
 * 22 fell to the V81 exclusions (14 raises under 0.9 pot, 4 heads-up tables,
 * 2 bounty events, 2 at 20bb or less), leaving exactly the 27 calls above,
 * matched hand for hand. None was a chop (a split pot's partial return is
 * inside `net`, so a chop would have counted at its fractional value), none
 * ran it twice, none was on an all-in-or-fold table. Every showdown was a
 * nut flush or a straight flush.
 *
 * Price: the 27 calls needed 0.028 to 0.333 equity (call over the pot after
 * calling; median 0.333). Zero wins in 27 bounds the true win rate at 0.105
 * (one-sided 95%), so the evidence cannot say a call priced BELOW that loses.
 * Four calls were (a horse all in for 2 to 61 chips into a large pot, prices
 * 0.028, 0.048, 0.066, 0.096). V84 therefore folds only at a price of
 * V84_MIN_CALL_PRICE or more: the 23 calls priced 0.134 and up all lost
 * (day A n 11, day B n 12; 0/23 bounds the win rate at 0.122, under every
 * price in that set), and a cheaper call keeps today's answer.
 *
 * Limits: only the horses' own calls are observed, ICM is not modelled, and
 * a bettor MEASURED as a postflop over-bluffer keeps today's call, as in V81.
 * All-in-or-fold tables were never observed in this spot and are excluded.
 */
export const V84_VARIANTS: ReadonlySet<string> = new Set(['plo4', 'plo5', 'plo6']);
const V84_RIVER_CELLS = new Set(['flush_second']);
/** The cheapest call V84 folds: call / (pot + call), the equity it needs. */
export const V84_MIN_CALL_PRICE = 0.13;

export interface V84Input extends Omit<V81Input, 'heroHasStreetChips'> {
  /** The horse itself bet or raised this street before the raise it faces. */
  heroWageredStreet: boolean;
  /** The chips the call puts in (capped at the stack) over the pot after it. */
  callPrice: number;
  /** An all-in-or-fold table: never observed in this spot. */
  allInOrFold: boolean;
}

/** True when `seat` bet, raised or went all in on `street` (public history). */
export function v84HeroWageredStreet(
  history: readonly V81Action[] | undefined,
  street: string,
  seat: number
): boolean {
  if (!Array.isArray(history)) return false;
  return history.some(
    (a) =>
      String(a.stage) === street &&
      a.seat === seat &&
      (a.action === 'bet' || a.action === 'raise' || a.action === 'all_in')
  );
}

/** The measured V84 cell this call falls in, or null when V84 does not apply. */
export function v84Cell(i: V84Input): string | null {
  const variant = String(i.variant).toLowerCase();
  if (!V84_VARIANTS.has(variant)) return null;
  if (i.hiLo || i.multiBoard || i.bombPot || i.headsUpTable || i.bountyEvent) return null;
  if (!i.heroWageredStreet || i.bettorOverBluffs || i.allInOrFold) return null;
  if (!(i.potFrac >= V81_MIN_POT_FRAC) || !(i.effectiveBB > V81_MIN_EFFECTIVE_BB)) return null;
  if (!(i.callPrice >= V84_MIN_CALL_PRICE)) return null;
  if (!Array.isArray(i.hole) || i.hole.length !== Number(variant.slice(3))) return null;
  if (i.street !== 'river' || !Array.isArray(i.board) || i.board.length !== 5) return null;
  const cls = omahaCallClass(i.hole, i.board);
  return V84_RIVER_CELLS.has(cls) ? cls : null;
}

/** A checked cash PLO6 river can return heads-up after seats behind fold.
 * Recover only an affordable closing fold; never flatten a chosen value raise. */
function checkedPlo6ClosingFold(
  decision: HorseDecision,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  bettorSeat: number
): boolean {
  if (
    decision.action !== 'fold' ||
    gs.gameVariant !== 'plo6' ||
    gs.gameMode !== 'cash' ||
    gs.wagersCapped !== false ||
    gs.boardCount !== 1 ||
    gs.currentPlayerSeat !== player.seat ||
    player.stack <= gs.toCall! ||
    !gs.legalActions?.includes('call')
  )
    return false;
  const remaining = gs.players.filter((p) => p.seat !== player.seat && !p.is_folded);
  if (
    remaining.length !== 1 ||
    remaining[0].seat !== bettorSeat ||
    remaining[0].is_sitting_out ||
    remaining[0].bet !== gs.currentBet ||
    gs.players.some((p) => p.seat !== bettorSeat && p.bet !== 0)
  )
    return false;
  const river = gs.actionHistory?.filter((a) => a.stage === 'river') ?? [];
  const opening = river.findIndex((a) => a.action === 'bet' && a.seat === bettorSeat);
  const before = river.slice(0, opening);
  return (
    opening >= 1 &&
    before.every((a) => a.action === 'check' && a.amount === 0) &&
    before.some((a) => a.seat === player.seat) &&
    river
      .slice(opening + 1)
      .every(
        (a) =>
          a.action === 'fold' &&
          a.amount === 0 &&
          gs.players.some((p) => p.seat === a.seat && p.is_folded)
      )
  );
}

/** Closing PLO4 cash response after the Horse bet for value and was check-raised.
 * Size the raise increment against the pot after the opponent matches our bet. */
function facesLargeClosingCheckRaise(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  faced: NonNullable<ReturnType<typeof v81StreetWager>>
): boolean {
  if (
    gs.gameVariant !== 'plo4' ||
    gs.gameMode !== 'cash' ||
    gs.wagersCapped !== false ||
    gs.currentPlayerSeat !== player.seat ||
    !(player.bet > 0)
  )
    return false;
  const live = gs.players.filter((p) => !p.is_folded && !p.is_sitting_out);
  const opponent = live.find((p) => p.seat !== player.seat);
  if (
    live.length !== 2 ||
    !opponent ||
    opponent.seat !== faced.bettorSeat ||
    opponent.bet !== gs.currentBet ||
    !(opponent.stack > 0)
  )
    return false;
  const river = gs.actionHistory?.filter((a) => a.stage === 'river') ?? [];
  if (river.length !== 3) return false;
  const [check, bet, raise] = river;
  return (
    check!.action === 'check' &&
    check!.seat === opponent.seat &&
    check!.amount === 0 &&
    bet!.action === 'bet' &&
    bet!.seat === player.seat &&
    bet!.amount === player.bet &&
    raise!.action === 'raise' &&
    raise!.seat === opponent.seat &&
    raise!.amount === gs.currentBet &&
    gs.toCall! + 0.000001 >= 0.75 * (faced.potBefore + player.bet)
  );
}

/** A high-only Omaha middle/top boat flats a pot-sized opening river bet.
 * Physical nuts retain their existing wager rule. Reconstruct the price from
 * the opening wager before any callers added chips to the current pot. */
export function callLargeRiverBoatWager(
  decision: HorseDecision,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  v86MultiStreetUnblocked = true
): HorseDecision {
  if (
    gs.stage !== 'river' ||
    gs.stateSchemaVersion !== 1 ||
    !['plo4', 'plo5', 'plo6'].includes(gs.gameVariant ?? '') ||
    gs.variantRules?.splitLow8OrBetter ||
    gs.bettingStructure !== 'pot_limit' ||
    (gs.boardCount ?? 1) !== 1 ||
    gs.communityCards2?.length ||
    gs.communityCards3?.length ||
    gs.bombPot ||
    gs.allInOrFold ||
    !Number.isFinite(gs.toCall) ||
    !(gs.toCall! > 0) ||
    !Number.isFinite(player.stack) ||
    !(player.stack > 0) ||
    !Number.isFinite(player.bet) ||
    player.bet < 0 ||
    player.is_folded ||
    player.is_all_in ||
    player.is_sitting_out ||
    (decision.action !== 'fold' &&
      decision.action !== 'raise' &&
      (decision.action !== 'all_in' || player.stack <= gs.toCall! + 0.005))
  )
    return decision;
  const paid = Math.min(player.stack, gs.currentBet - player.bet);
  if (Math.abs(Math.min(player.stack, gs.toCall!) - paid) > 0.005) return decision;
  const allInCall = player.stack <= gs.toCall! + 0.005 && gs.legalActions?.includes('all_in');
  if (!allInCall && !gs.legalActions?.includes('call')) return decision;
  const opener = gs.actionHistory?.find(
    (a) => a.stage === 'river' && ['bet', 'raise', 'all_in'].includes(a.action)
  );
  const bets = new Map(gs.players.map((p) => [p.seat, p.bet]));
  const faced = v81StreetWager(gs.actionHistory, 'river', bets, gs.pot);
  if (!faced) return decision;
  if (player.bet > 0) {
    if (!facesLargeClosingCheckRaise(player, gs, faced)) return decision;
  } else if (
    opener?.action !== 'bet' ||
    opener.seat === player.seat ||
    opener.amount !== gs.currentBet ||
    faced.bettorSeat !== opener.seat ||
    faced.wager !== opener.amount ||
    (faced.wager + 0.000001 < faced.potBefore &&
      (2 * faced.wager + 0.000001 < faced.potBefore ||
        !checkedPlo6ClosingFold(decision, player, gs, opener.seat)))
  )
    return decision;
  const board = gs.communityCards ?? [];
  if (
    board.length !== 5 ||
    player.cards?.length !== Number(gs.gameVariant?.at(-1)) ||
    new Set(board.map((c) => c.rank)).size === 5 ||
    board.some((card) => board.filter((other) => other.rank === card.rank).length >= 3) ||
    new Set([...player.cards, ...board].map((c) => `${c.rank}:${c.suit}`)).size !==
      player.cards.length + 5
  )
    return decision;
  // With six holes a player can also make a straight flush alongside a boat.
  if (Math.floor(scoreOmahaHi(player.cards, board) / 0x100000) !== 7) return decision;
  const position = omahaBoatPosition(player.cards, board);
  if (
    !position ||
    position.lowerBoats === 0 ||
    (v86MultiStreetUnblocked &&
      decision.action !== 'fold' &&
      position.boats === 0 &&
      position.quads <= 1) ||
    (position.boats === 0 && position.quads === 0 && hasRiverNuts(player, gs))
  )
    return decision;
  return allInCall
    ? { ...decision, action: 'all_in', amount: undefined }
    : { ...decision, action: 'call', amount: paid };
}

const V86_MEDIUM_MULTIWAY_RIVER_CELLS = new Set([
  'two_pair',
  'flush_dominated',
  'flush_dominated_paired',
  'straight_flushboard_paired',
]);

/**
 * V86 OMAHA UNDERBOAT & PLO6 / MEDIUM-BIG DOMINATED RIVER CALL DISCIPLINE.
 * Preserves V81, V84, and callLargeRiverBoatWager contracts unchanged while
 * closing three remaining single-board PLO4/PLO5/PLO6 river leaks:
 *   1. Underboats (`lowerBoats === 0 && boats >= 2`, i.e., bottom full house
 *      beaten by two or more distinct higher full-house combinations) calling
 *      large river bets (>= 0.75 pot) or river raises (>= 0.65 pot).
 *   2. PLO6 non-nut straights, two pair, and dominated/second-nut flushes
 *      calling >= 0.90 pot wagers (extending V81's PLO4/PLO5 boundary to PLO6).
 *   3. Multiway (3+ live players) 0.65-0.89 pot river bets called with bare two
 *      pair or 3rd-nut-or-worse flushes at 35bb+ effective stacks.
 * Never folds against a verified postflop over-bluffer (`bettorOverBluffs`).
 */
export function v86OmahaUnderboatOrDominatedFold(
  decision: HorseDecision,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  v86Enabled: boolean,
  bettorOverBluffs: boolean
): { decision: HorseDecision; reason: string | null } {
  const toCall = Number.isFinite(gs.toCall)
    ? (gs.toCall as number)
    : Math.max(0, (gs.currentBet || 0) - (player.bet || 0));
  const stack = Number.isFinite(player.stack) ? player.stack : 0;
  const isCall =
    decision.action === 'call' || (decision.action === 'all_in' && stack <= toCall + 0.005);
  const isRaise =
    decision.action === 'raise' || (decision.action === 'all_in' && stack > toCall + 0.005);
  if (
    !v86Enabled ||
    bettorOverBluffs ||
    (!isCall && !isRaise) ||
    gs.stage !== 'river' ||
    !['plo4', 'plo5', 'plo6'].includes(gs.gameVariant ?? '') ||
    Boolean(gs.variantRules?.splitLow8OrBetter) ||
    (gs.bettingStructure !== undefined && gs.bettingStructure !== 'pot_limit') ||
    (gs.boardCount ?? 1) !== 1 ||
    Boolean(gs.communityCards2?.length) ||
    Boolean(gs.communityCards3?.length) ||
    Boolean(gs.bombPot) ||
    Boolean(gs.allInOrFold) ||
    !(toCall > 0) ||
    !(stack > 0.005) ||
    Boolean(gs.legalActions && !gs.legalActions.includes('fold'))
  ) {
    return { decision, reason: null };
  }
  const board = gs.communityCards ?? [];
  const expectedCards = Number(gs.gameVariant?.slice(3));
  if (board.length !== 5 || !Array.isArray(player.cards) || player.cards.length !== expectedCards) {
    return { decision, reason: null };
  }
  const bets = new Map(gs.players.map((p) => [p.seat, p.bet]));
  const faced = v81StreetWager(gs.actionHistory, 'river', bets, gs.pot);
  if (!faced || !(faced.potBefore > 0)) return { decision, reason: null };
  const potFrac = faced.wager / faced.potBefore;
  const bb = Math.max(0.01, gs.bigBlind || 1);
  const bettor = gs.players.find((p) => p.seat === faced.bettorSeat);
  const heroTotal = stack + (player.bet || 0);
  const bettorTotal = bettor ? (bettor.stack || 0) + (bettor.bet || 0) : heroTotal;
  const effectiveBB = Math.min(heroTotal, bettorTotal) / bb;
  const paid = Math.min(toCall, stack);
  const callPrice = paid / (gs.pot + paid);
  if (!(effectiveBB > 25) || !(callPrice >= 0.16)) return { decision, reason: null };

  const makeFold = (reason: string): { decision: HorseDecision; reason: string } => {
    const folded: HorseDecision = { ...decision, action: 'fold' };
    delete folded.amount;
    return { decision: folded, reason };
  };

  // 1. Underboat discipline: bottom full house with >= 2 higher boat combos live
  //    facing >= 0.65 pot river bets (including 75% pot) or >= 0.58 pot river raises.
  if (Math.floor(scoreOmahaHi(player.cards, board) / 0x100000) === 7) {
    const pos = omahaBoatPosition(player.cards, board);
    const heroWagered = v84HeroWageredStreet(gs.actionHistory, 'river', player.seat);
    if (
      pos &&
      pos.lowerBoats === 0 &&
      pos.boats >= 2 &&
      (!isRaise || !heroWagered) &&
      ((heroWagered && potFrac >= 0.58) || potFrac >= 0.65)
    ) {
      return makeFold('v86_plo_underboat_fold');
    }
    return { decision, reason: null };
  }

  if (!isCall) return { decision, reason: null };

  const seatedActive = gs.players.filter((p) => !p.is_sitting_out);
  const liveInHand = gs.players.filter((p) => !p.is_folded && !p.is_sitting_out);
  if (seatedActive.length < 3 || (player.bet ?? 0) > 0) return { decision, reason: null };

  const cls = omahaCallClass(player.cards, board);
  // 2. PLO6 >= 0.90 pot dominated river call parity with V81 PLO5.
  if (
    gs.gameVariant === 'plo6' &&
    potFrac >= V81_MIN_POT_FRAC &&
    (RIVER_CELLS.has(cls) || cls === 'flush_second')
  ) {
    return makeFold('v86_plo6_big_bet_fold');
  }
  // 3. Multiway (3+ live contenders) 0.58-0.89 pot dominated river bluff-catchers in cash,
  //    plus heads-up 0.78-0.89 pot bare two-pair / paired-board dominated flush calls.
  if (
    gs.gameMode === 'cash' &&
    effectiveBB >= 35 &&
    potFrac < V81_MIN_POT_FRAC &&
    ((liveInHand.length >= 3 && potFrac >= 0.58 && V86_MEDIUM_MULTIWAY_RIVER_CELLS.has(cls)) ||
      (liveInHand.length === 2 &&
        effectiveBB >= 40 &&
        potFrac >= 0.78 &&
        (cls === 'two_pair' || cls === 'flush_dominated_paired')))
  ) {
    return makeFold('v86_plo_multiway_dominated_fold');
  }

  return { decision, reason: null };
}
