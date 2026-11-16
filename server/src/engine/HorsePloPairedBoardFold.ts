/**
 * PLO4 / PLO5 / PLO6 PAIRED-BOARD FOLD (Dan 2026-10-25, BINDING).
 *
 * Dan, verbatim, on a PLO5 1/2 Madness hand where a horse held Q-Q-T-7-6 on
 * 6h 7c Jd, the Jack paired the board on the turn, a human shoved and the
 * horse called off 190 chips with two pair:
 *   "HE CALLED THE ALL IN ON THE TURN WHEN THE JACK PAIRED THE BOARD..."
 *   "ITS A FOLD 100% OF THE TIME"
 * earlier the same day, for PLO6:
 *   "IN PLO6 IF ITS NOT THE NUTS, ITS PROBABLY NOT GOOD"
 * and that evening, widening it:
 *   "ADD PLO4 AND PLO5 AND THE FLOP TO THE PAIRED BOARD FOLD RULE"
 *
 * Why the brain called: every equity cap for this class (V40 'board2p', a
 * pocket pair over the board's pair) prices it at about 30-34% on the turn,
 * and the shove only asked for 25%. A cap is a number the next tweak moves.
 * This is a rule: on a paired flop, turn or river in PLO4/PLO5/PLO6, a horse
 * that does not hold a full house or better never puts a committing amount of
 * chips into a bet. It folds.
 *
 * "Committing" is any of: the bettor is all in, the call is at least a
 * quarter of the horse's stack, or the call would leave the horse all in.
 * A token call getting better than 5.7:1 (required equity under 15%) is left
 * to the brain, so a horse with three chips behind never folds a flush to a
 * shove for two of them. Hi-lo and multi-board pots are out of scope: half a
 * pot or one board of three is a different question.
 */
import type { Card, SeatPlayer } from '../types.js';
import { omahaDrawQuality, scoreOmahaHiPartial } from './HorseEval.js';

export const PLO_PAIRED_BOARD_VARIANTS: ReadonlySet<string> = new Set(['plo4', 'plo5', 'plo6']);
const FULL_HOUSE = 7;
const COMMIT_STACK_SHARE = 0.25;
const TOKEN_CALL_REQUIRED_EQUITY = 0.15;

export interface PairedBoardFoldInput {
  gameVariant: string | undefined;
  hiLo: boolean;
  multiBoard: boolean;
  board: Card[];
  hero: Pick<SeatPlayer, 'cards' | 'stack' | 'bet' | 'user_id'>;
  players: Array<Pick<SeatPlayer, 'user_id' | 'is_folded' | 'is_all_in' | 'stack' | 'bet'>>;
  currentBet: number;
  toCall?: number;
  pot: number;
  v86MultiStreetUnblocked?: boolean;
}

export function boardIsPaired(board: Card[]): boolean {
  return new Set(board.map((c) => c.rank)).size < board.length;
}

/** True when the horse must fold rather than call or raise this bet. */
export function ploPairedBoardMustFold(i: PairedBoardFoldInput): boolean {
  const variant = String(i.gameVariant ?? '').toLowerCase();
  if (!PLO_PAIRED_BOARD_VARIANTS.has(variant)) return false;
  if (i.hiLo || i.multiBoard) return false;
  if (!Array.isArray(i.board) || i.board.length < 3) return false; // flop, turn and river
  if (!boardIsPaired(i.board)) return false;
  const hole = i.hero.cards;
  if (!Array.isArray(hole) || hole.length < 4) return false;

  const stack = Number.isFinite(i.hero.stack) ? Math.max(0, i.hero.stack) : 0;
  const toCall = Number.isFinite(i.toCall)
    ? Math.max(0, i.toCall as number)
    : Math.max(0, (i.currentBet || 0) - (i.hero.bet || 0));
  if (toCall <= 0.005 || stack <= 0) return false;

  let category: number;
  try {
    category = Math.floor(scoreOmahaHiPartial(hole, i.board) / 0x100000);
  } catch {
    return false;
  }
  if (!(category > 0) || category >= FULL_HOUSE) return false;

  const pot = Number.isFinite(i.pot) ? Math.max(0, i.pot) : 0;
  const requiredEquity = toCall / (pot + toCall || 1);
  if (requiredEquity < TOKEN_CALL_REQUIRED_EQUITY) return false;

  const bettorAllIn = i.players.some(
    (p) =>
      p.user_id !== i.hero.user_id &&
      !p.is_folded &&
      p.is_all_in &&
      (p.bet || 0) > (i.hero.bet || 0)
  );
  const unblocked86 = i.v86MultiStreetUnblocked !== false;
  // Short-stack all-in exception: a tiny fractional jam (`< 12%` of hero's stack
  // needing `< 20%` equity) is a pure pot-odds call, not a stack commitment.
  if (unblocked86 && bettorAllIn && toCall < stack * 0.12 && requiredEquity < 0.2) return false;
  // Non-all-in flop/turn trips + live Nut Flush Draw redraw (`category === 4`):
  // hero has both full-house/quads redraws AND nut-flush redraws when not facing a shove.
  if (unblocked86 && !bettorAllIn && i.board.length < 5 && category === 4 && toCall < stack * 0.4) {
    try {
      if (omahaDrawQuality(hole, i.board, false).nutFlushDraw) return false;
    } catch {
      // fall through to standard commitment check
    }
  }
  return bettorAllIn || toCall >= stack * COMMIT_STACK_SHARE || toCall >= stack - 0.005;
}

/**
 * THE PAIRED-BOARD FOLD RESPECTS THE PRICE (lane owner 2026-11-15, hand
 * 59521326; option omahaPairedBoardFoldRespectsPrice, default OFF).
 *
 * In that hand a Horse that had put 700 of 1,224 in with the nut straight
 * faced an all-in on a paired river for its last 524 into 1,939, a price of
 * 0.213. Its own range model read 0.50 to 0.58 and the reference decision
 * was a call; the fold above overrode it.
 *
 * With the option on, in PLO4/PLO5 cash only, the fold above stands aside,
 * and the reference decision stands (it may still be a fold), when BOTH hold:
 *  (a) the call price, the call over the pot after the call (the part of an
 *      all-in the Horse cannot match is not counted), is at most 0.25; and
 *  (b) the Horse holds a straight or a flush (two pair, trips and one pair do
 *      not qualify), OR the call is for the rest of the effective stack
 *      (it leaves the Horse all in, or the bettor is all in) of which the
 *      Horse has already put in at least 60% this hand.
 * Everything else folds exactly as before.
 */
export const PAIRED_FOLD_RESPECTED_MAX_PRICE = 0.25;
export const PAIRED_FOLD_RESPECTED_INVESTED_SHARE = 0.6;
export const PAIRED_FOLD_RESPECTED_VARIANTS: ReadonlySet<string> = new Set(['plo4', 'plo5']);
const STRAIGHT = 5;

export interface PairedBoardFoldPriceInput {
  gameVariant: string | undefined;
  board: Card[];
  hero: Pick<SeatPlayer, 'cards' | 'stack' | 'bet' | 'user_id' | 'totalInvested'>;
  players: Array<Pick<SeatPlayer, 'user_id' | 'is_folded' | 'is_all_in' | 'bet'>>;
  currentBet: number;
  toCall?: number;
  pot: number;
}

/** The call price the exception reads: the call over the pot after it, uncalled excess removed. */
export function ploPairedBoardCallPrice(i: PairedBoardFoldPriceInput): number | null {
  const stack = Number.isFinite(i.hero.stack) ? Math.max(0, i.hero.stack) : 0;
  const toCall = Number.isFinite(i.toCall)
    ? Math.max(0, i.toCall as number)
    : Math.max(0, (i.currentBet || 0) - (i.hero.bet || 0));
  const call = Math.min(toCall, stack);
  if (!(call > 0.005)) return null;
  const pot = Number.isFinite(i.pot) ? Math.max(0, i.pot) : 0;
  const livePot = Math.max(0, pot - (toCall - call));
  return call / (livePot + call);
}

/** True when the paired-board fold stands aside for the price (the caller checks the fold itself, cash and the option). */
export function ploPairedBoardFoldRespectsPrice(i: PairedBoardFoldPriceInput): boolean {
  try {
    if (!PAIRED_FOLD_RESPECTED_VARIANTS.has(String(i.gameVariant ?? '').toLowerCase()))
      return false;
    const price = ploPairedBoardCallPrice(i);
    if (price === null || price > PAIRED_FOLD_RESPECTED_MAX_PRICE + 1e-9) return false;
    const hole = i.hero.cards;
    if (!Array.isArray(hole) || hole.length < 4) return false;
    const category = Math.floor(scoreOmahaHiPartial(hole, i.board) / 0x100000);
    if (category >= STRAIGHT) return true;
    const stack = Number.isFinite(i.hero.stack) ? Math.max(0, i.hero.stack) : 0;
    const toCall = Number.isFinite(i.toCall)
      ? Math.max(0, i.toCall as number)
      : Math.max(0, (i.currentBet || 0) - (i.hero.bet || 0));
    const call = Math.min(toCall, stack);
    const bettorAllIn = i.players.some(
      (p) =>
        p.user_id !== i.hero.user_id &&
        !p.is_folded &&
        p.is_all_in &&
        (p.bet || 0) > (i.hero.bet || 0)
    );
    if (!(call >= stack - 0.005 || bettorAllIn)) return false;
    const invested = Number.isFinite(i.hero.totalInvested)
      ? Math.max(0, i.hero.totalInvested as number)
      : 0;
    return invested / (invested + call) >= PAIRED_FOLD_RESPECTED_INVESTED_SHARE - 1e-9;
  } catch {
    return false;
  }
}

/**
 * PLO4 / PLO5 / PLO6 PAIRED-BOARD RIVER CHECK (Dan 2026-11-06, BINDING).
 *
 * Dan, on a PLO5 1/2 Madness hand (55704472) where a horse held
 * Ad Ac Kd 9d 3h on 4d 5c Jc 5d, bet the paired turn, was called by the only
 * human, then bet 125 into 244 on the 2s river with a five-high straight and
 * was called by fives full:
 *   "HE BET BIG ON THE PAIRED BOARD, HUMAN CALLED, THEN FIRED THE RIVER
 *    UNIMPROVED."
 * The river bet was the reference brain's ordinary value bet (a straight is
 * category 5, and nothing demoted it on a paired board), so a hand that is
 * still not a full house kept betting into the one player who had already
 * called a bet on that paired board. That caller folds the hands a straight
 * or flush beats and calls with the boats that beat it.
 *
 * The rule: in PLO4/PLO5/PLO6 (high only, one board), on the river of a board
 * that was already paired on the turn, a horse without a full house or better
 * whose own turn bet or raise was called does not bet or raise the river. It
 * checks. A full house or better is never touched, nor is any call or fold
 * facing a bet (the paired-board fold above owns those), nor a river the
 * horse did not barrel into a caller.
 */
export interface PairedBoardRiverCheckInput {
  gameVariant: string | undefined;
  hiLo: boolean;
  multiBoard: boolean;
  board: Card[];
  hero: Pick<SeatPlayer, 'cards' | 'user_id'>;
  toCall?: number;
  actionHistory?: Array<{ userId: string; action: string; stage: string }>;
}

/** True when the horse must check this river instead of betting or raising. */
export function ploPairedBoardRiverMustCheck(i: PairedBoardRiverCheckInput): boolean {
  const variant = String(i.gameVariant ?? '').toLowerCase();
  if (!PLO_PAIRED_BOARD_VARIANTS.has(variant)) return false;
  if (i.hiLo || i.multiBoard) return false;
  if (!Array.isArray(i.board) || i.board.length !== 5) return false;
  if (!boardIsPaired(i.board.slice(0, 4))) return false;
  if (Number.isFinite(i.toCall) && (i.toCall as number) > 0.005) return false;
  const hole = i.hero.cards;
  if (!Array.isArray(hole) || hole.length < 4) return false;
  let category: number;
  try {
    category = Math.floor(scoreOmahaHiPartial(hole, i.board) / 0x100000);
  } catch {
    return false;
  }
  if (!(category > 0) || category >= FULL_HOUSE) return false;
  // The turn: the last bet or raise was the horse's own, and someone called it.
  let lastAggressor: string | null = null;
  let calledAfter = false;
  for (const a of i.actionHistory ?? []) {
    if (a.stage !== 'turn') continue;
    if (a.action === 'bet' || a.action === 'raise' || a.action === 'all_in') {
      lastAggressor = a.userId;
      calledAfter = false;
    } else if (a.action === 'call' && a.userId !== lastAggressor) {
      calledAfter = true;
    }
  }
  return lastAggressor === i.hero.user_id && calledAfter;
}
