/**
 * omahaMadeHandCallFloor (default OFF; EMERG lane RIVER-FLOOR, 2026-11-20).
 *
 * Owner 12:44 PM Chicago: "ITS NOT LUCK! HES WINNING CONSISTENTLY AGAINST
 * HORSES ON MULTIPLE CHANNELS!! FIND THE LEAKS AND FIX IT!"; 9:52 AM: the same
 * play and decisions for all players, human or Horse. The largest measured
 * leak (LIVEGRADE, Nov 17-20): heads-up turn and river folds of strong made
 * hands facing a bet of about half pot to pot; on the real cards those folds
 * gave up chips for every bettor, not one.
 *
 * The rule, an answer of the wager_rules node after every owner rule: in
 * PLO4/PLO5 cash (table and Lightning, one board, high only, no bomb pot),
 * heads-up, facing the street's FIRST bet (hero has nothing in on the street;
 * not a raise) of more than half the pot and at most about the pot, a final
 * FOLD becomes the legal call (the whole-stack all-in when the call is the
 * stack) when hero's made-hand cell (street, class, board paired or not) is
 * in OMAHA_MADE_HAND_CALL_FLOOR_CELLS. The set is MEASURED: the cells where
 * heads-up folds in this spot gave up chips on the real cards in the fit
 * window (Oct 12 - Nov 16, mean above one standard error), validated on
 * Nov 17-20 (criteria CRITERIA-RIVER-FLOOR-1, the lane log carries the
 * receipts).
 *
 * Public information only: hero's cards, the board, the pot and the price.
 * No opponent label, account, history or person/Horse flag is read.
 */
import type { Card, HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { RANKS, SUITS, RANK_VALUES } from './PokerEngine.js';
import { scoreOmahaHi, scoreOmahaHiPartial } from './HorseEval.js';
import { omahaNoCategoricalRulesInScope } from './HorseOmahaNoCategoricalRules.js';
import { v81StreetWager } from './HorseOmahaBigBetCalls.js';

export type OmahaMadeHandClass =
  | 'nuts'
  | 'straight flush'
  | 'quads'
  | 'full house'
  | 'flush'
  | 'straight'
  | 'set'
  | 'trips'
  | 'top two pair'
  | 'non-top two pair'
  | 'two pair (board paired)'
  | 'overpair'
  | 'top pair'
  | 'low/mid pair'
  | 'underpair'
  | 'high';

/** A cell: street, class, board paired ('bp') or not ('np'). */
export type OmahaMadeHandCell = `${'turn' | 'river'}|${OmahaMadeHandClass}|${'bp' | 'np'}`;

/** MEASURED cells (fit window Oct 12 - Nov 16 2026; criteria CRITERIA-RIVER-FLOOR-1). */
export const OMAHA_MADE_HAND_CALL_FLOOR_CELLS: ReadonlySet<string> = new Set<OmahaMadeHandCell>([
  // river flush, board unpaired: fit n 5, +59.8 +- 52.5 bb per fold facing persons
  'river|flush|np',
  // turn straight, board unpaired: fit n 5, +43.8 +- 35.1 bb per fold facing persons
  'turn|straight|np',
]);

/** Bet size window (wager over the pot before it). */
export const OMAHA_MADE_HAND_CALL_FLOOR_MIN_FRAC = 0.5;
export const OMAHA_MADE_HAND_CALL_FLOOR_MAX_FRAC = 1.05;

const key = (c: Card) => `${c.rank}:${c.suit}`;
const rv = (c: Card) => RANK_VALUES[c.rank];

/**
 * Hero's made-hand class on a four- or five-card board (two hole cards and
 * three board cards). 'nuts': no unseen two-card holding scores higher.
 */
export function omahaMadeHandClass(
  hole: readonly Card[],
  board: readonly Card[]
): OmahaMadeHandClass | null {
  if (!Array.isArray(hole) || hole.length < 4 || !Array.isArray(board)) return null;
  if (board.length !== 4 && board.length !== 5) return null;
  const score = (h: Card[]) =>
    board.length === 5 ? scoreOmahaHi(h, board as Card[]) : scoreOmahaHiPartial(h, board as Card[]);
  const mine = score(hole as Card[]);
  if (!(mine > 0)) return null;
  const used = new Set([...hole, ...board].map(key));
  if (used.size !== hole.length + board.length) return null;
  const unseen: Card[] = [];
  for (const suit of SUITS)
    for (const rank of RANKS) if (!used.has(`${rank}:${suit}`)) unseen.push({ rank, suit } as Card);
  let beaten = false;
  for (let i = 0; i < unseen.length && !beaten; i++)
    for (let j = i + 1; j < unseen.length; j++)
      if (score([unseen[i], unseen[j]]) > mine) {
        beaten = true;
        break;
      }
  if (!beaten) return 'nuts';
  const cat = Math.floor(mine / 0x100000);
  const boardRanks = board.map(rv).sort((a, b) => b - a);
  const distinct = [...new Set(boardRanks)].sort((a, b) => b - a);
  const holeRanks = hole.map(rv);
  const count = (xs: number[], r: number) => xs.filter((x) => x === r).length;
  if (cat >= 9) return 'straight flush';
  if (cat === 8) return 'quads';
  if (cat === 7) return 'full house';
  if (cat === 6) return 'flush';
  if (cat === 5) return 'straight';
  if (cat === 4) {
    const r = (mine >> 8) & 0xf;
    return count(holeRanks, r) >= 2 ? 'set' : 'trips';
  }
  if (cat === 3) {
    const hi = (mine >> 8) & 0xf;
    const lo = (mine >> 4) & 0xf;
    if (
      distinct.length < boardRanks.length &&
      (count(boardRanks, hi) >= 2 || count(boardRanks, lo) >= 2)
    )
      return 'two pair (board paired)';
    if (distinct.length >= 2 && hi === distinct[0] && lo === distinct[1]) return 'top two pair';
    return 'non-top two pair';
  }
  if (cat === 2) {
    const pr = (mine >> 12) & 0xf;
    if (pr > boardRanks[0] && count(holeRanks, pr) >= 2) return 'overpair';
    if (pr === boardRanks[0]) return 'top pair';
    if (boardRanks.includes(pr)) return 'low/mid pair';
    return 'underpair';
  }
  return 'high';
}

export interface OmahaMadeHandCallSpot {
  /** Chips the call puts in (the whole stack when the stack is short of the wager). */
  paid: number;
  /** The call is for the whole stack: its legal form is the all-in. */
  allIn: boolean;
  cell: OmahaMadeHandCell;
  frac: number;
}

/**
 * The spot where the floor holds. Null everywhere else. Pure: a function of
 * the request only (hero's cards, the board, the pot, the bets, the street's
 * public actions).
 */
export function omahaMadeHandCallSpot(
  player: SeatPlayer,
  gs: HorseGameStateV2
): OmahaMadeHandCallSpot | null {
  try {
    if (!omahaNoCategoricalRulesInScope(player, gs)) return null;
    const street = gs.stage;
    if (street !== 'turn' && street !== 'river') return null;
    if (gs.wagersCapped === true) return null;
    const board = gs.communityCards ?? [];
    if (board.length !== (street === 'river' ? 5 : 4)) return null;
    if (player.is_folded || player.is_all_in || player.is_sitting_out) return null;
    // hero has nothing in on this street: the wager is a bet, not a raise of hero's bet
    if (!Number.isFinite(player.bet) || Math.abs(player.bet) > 0.005) return null;
    const toCall = Number.isFinite(gs.toCall)
      ? (gs.toCall as number)
      : Math.max(0, gs.currentBet - player.bet);
    if (!Number.isFinite(toCall) || !(toCall > 0.005)) return null;
    if (Math.abs(gs.currentBet - toCall) > 0.011) return null;
    if (!Number.isFinite(gs.pot) || !(gs.pot > 0)) return null;
    if (!Number.isFinite(player.stack) || !(player.stack > 0)) return null;
    const others = (gs.players ?? []).filter(
      (p) => p.seat !== player.seat && !p.is_folded && !p.is_sitting_out
    );
    if (others.length !== 1) return null;
    const wagers = (gs.actionHistory ?? []).filter(
      (a) => a.stage === street && ['bet', 'raise', 'all_in'].includes(a.action)
    );
    const opener = wagers[0];
    if (!opener || opener.seat === player.seat || opener.seat !== others[0].seat) return null;
    if (opener.action === 'raise') return null;
    if (wagers.some((a) => a !== opener && a.amount > opener.amount + 0.011)) return null;
    const bets = new Map(gs.players.map((p) => [p.seat, p.bet]));
    const faced = v81StreetWager(gs.actionHistory, street, bets, gs.pot);
    if (!faced || faced.bettorSeat !== opener.seat || Math.abs(faced.wager - gs.currentBet) > 0.011)
      return null;
    const frac = faced.wager / faced.potBefore;
    if (!(frac > OMAHA_MADE_HAND_CALL_FLOOR_MIN_FRAC) || frac > OMAHA_MADE_HAND_CALL_FLOOR_MAX_FRAC)
      return null;
    const legal = Array.isArray(gs.legalActions) ? gs.legalActions : null;
    const allIn = player.stack <= toCall + 0.005;
    if (legal && !legal.includes(allIn ? 'all_in' : 'call') && !legal.includes('call')) return null;
    const cls = omahaMadeHandClass(player.cards ?? [], board);
    if (!cls) return null;
    const paired = new Set(board.map(rv)).size < board.length;
    const cell = `${street}|${cls}|${paired ? 'bp' : 'np'}` as OmahaMadeHandCell;
    if (!OMAHA_MADE_HAND_CALL_FLOOR_CELLS.has(cell)) return null;
    const paid = Math.min(toCall, player.stack);
    return { paid: Math.round(paid * 100) / 100, allIn, cell, frac };
  } catch {
    return null;
  }
}

/**
 * The rule: a final fold in the spot becomes the legal call. `legalize` turns
 * the call into the legal call (or the whole-stack all-in). Every other
 * decision is returned unchanged (the same object).
 */
export function omahaMadeHandCallFloorRule(
  decision: HorseDecision,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  on: boolean,
  legalize: (d: HorseDecision) => HorseDecision
): HorseDecision {
  if (!on || decision.action !== 'fold') return decision;
  const spot = omahaMadeHandCallSpot(player, gs);
  if (!spot) return decision;
  try {
    const legal = legalize({ ...decision, action: 'call', amount: spot.paid });
    if (legal.action !== 'call' && legal.action !== 'all_in') return decision;
    return { ...decision, action: legal.action, amount: legal.amount };
  } catch {
    return decision;
  }
}

/** The validator's re-run: fold -> call is admitted only where the floor holds, for the exact chips owed. */
export function omahaMadeHandCallFloorAdmitsCall(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  amount: number | null | undefined
): boolean {
  const spot = omahaMadeHandCallSpot(player, gs);
  if (!spot) return false;
  return Number.isFinite(amount) && Math.abs((amount as number) - spot.paid) <= 0.005;
}
