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
}

/** The measured cell this call falls in, or null when V81 does not apply. */
export function v81Cell(i: V81Input): string | null {
  const variant = String(i.variant).toLowerCase();
  if (!V81_VARIANTS.has(variant)) return null;
  if (i.hiLo || i.multiBoard || i.bombPot || i.headsUpTable || i.bountyEvent) return null;
  if (i.heroHasStreetChips || i.bettorOverBluffs) return null;
  if (!(i.potFrac >= V81_MIN_POT_FRAC) || !(i.effectiveBB > V81_MIN_EFFECTIVE_BB)) return null;
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

/** A high-only Omaha middle/top boat flats a pot-sized opening river bet.
 * Physical nuts retain their existing wager rule. Reconstruct the price from
 * the opening wager before any callers added chips to the current pot. */
export function callLargeRiverBoatWager(
  decision: HorseDecision,
  player: SeatPlayer,
  gs: HorseGameStateV2
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
    player.bet !== 0 ||
    player.is_folded ||
    player.is_all_in ||
    player.is_sitting_out ||
    (decision.action !== 'fold' &&
      decision.action !== 'raise' &&
      (decision.action !== 'all_in' || player.stack <= gs.toCall! + 0.005))
  )
    return decision;
  const paid = Math.min(player.stack, gs.currentBet);
  if (Math.abs(Math.min(player.stack, gs.toCall!) - paid) > 0.005) return decision;
  const allInCall = player.stack <= gs.currentBet + 0.005 && gs.legalActions?.includes('all_in');
  if (!allInCall && !gs.legalActions?.includes('call')) return decision;
  const opener = gs.actionHistory?.find(
    (a) => a.stage === 'river' && ['bet', 'raise', 'all_in'].includes(a.action)
  );
  if (opener?.action !== 'bet' || opener.seat === player.seat || opener.amount !== gs.currentBet)
    return decision;
  const bets = new Map(gs.players.map((p) => [p.seat, p.bet]));
  const faced = v81StreetWager(gs.actionHistory, 'river', bets, gs.pot);
  if (
    !faced ||
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
    (position.boats === 0 && position.quads === 0 && hasRiverNuts(player, gs))
  )
    return decision;
  return allInCall
    ? { ...decision, action: 'all_in', amount: undefined }
    : { ...decision, action: 'call', amount: paid };
}
