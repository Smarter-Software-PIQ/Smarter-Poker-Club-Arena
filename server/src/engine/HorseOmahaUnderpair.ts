/**
 * OMAHA: NO STACK-OFF WITH AN UNDERPAIR STRUCTURE (owner complaint 2026-11-15,
 * hand 59518335, PLO5 1/2 cash; two options, both default OFF, read `=== true`).
 *
 * The hand: a Horse on the button re-raised an open and two calls with a pair
 * of queens and three low cards, the big blind re-raised COLD (its first
 * voluntary money of the hand), the opener called, and the Horse called 65
 * more big blinds; on K-T-6 it called a bet and a call with the underpair and
 * a gutshot, and put the rest in on the turn.
 *
 * Two cells, public information plus hero's cards (Omaha high PLO4 and PLO5
 * cash on one board; not hi-lo, not a bomb pot, not all-in-or-fold, not a
 * tournament):
 *
 * PREFLOP (omahaColdFourBetCell, option omahaNoCallColdFourBetWithoutPremium):
 * hero's own re-raise was re-raised by a player who had put no voluntary money
 * in before (omahaColdFourBetFaced: a cold 4-bet or more, over a raise and
 * hero's re-raise). A hand without a pair of aces or a premium structure
 * (omahaReraisedPremium, the re-raised-pot discipline's own definition) folds,
 * unless the call is priced by commitment: the call is all in or leaves no
 * more behind than the call itself, AND the hand's equity against a random
 * hand holding a pair of aces pays the direct price (omahaReraisedPreflopCell,
 * unchanged). The difference from omahaReraisedPotDiscipline's preflop cell:
 * that cell answers every 4-bet, the opener's included (the light 4-bettor it
 * lost to), and keeps any call that leaves less than a pot behind when it pays
 * against aces; this one answers only a cold re-raise of hero's own re-raise
 * and keeps a call only when no real decision is left behind it.
 *
 * FLOP (omahaUnderpairFlopCell, option omahaUnderpairNoMultiwayFlopContinue):
 * on an unpaired flop hero faces a bet AND a call from two live opponents
 * (omahaFlopBetAndCallFaced) and holds exactly one pair that is below the
 * board's top card (a pocket pair under it, or a pair with a lower board
 * card), with no flush draw and fewer than eight nut-straight outs. The
 * continue folds unless the direct price of the call is under
 * UNDERPAIR_KEEP_PRICE of the resulting pot.
 *
 * Neither cell draws from the brain's random stream (the preflop equity is the
 * re-raised-pot cell's own card-seeded estimate).
 */
import type { Card } from '../types.js';
import { omahaDrawQuality, omahaMadeClass } from './HorseEval.js';
import {
  omahaReraisedPreflopCell,
  RERAISED_MIN_PREFLOP_RAISES,
  RERAISED_POT_VARIANTS,
  type OmahaReraisedInput,
} from './HorseOmahaReraisedPot.js';
import { omahaStrategyGameInScope } from './HorseOmahaStrategyGame.js';

/** The flop call is kept when it costs less than this share of the resulting pot. */
export const UNDERPAIR_KEEP_PRICE = 0.1;
/** Nut-straight outs from which a draw counts as open-ended or a wrap to the nuts. */
export const UNDERPAIR_NUT_STRAIGHT_OUTS = 8;

const RANK_VALUE: Record<string, number> = Object.fromEntries(
  ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'].map((r, i) => [r, i + 2])
);

/** One public action as the engine records it. */
export interface UnderpairAction {
  stage: string;
  seat: number;
  action: string;
  isFullRaise?: boolean;
}

const isRaise = (a: UnderpairAction): boolean =>
  a.action === 'raise' || a.action === 'bet' || (a.action === 'all_in' && a.isFullRaise === true);
const isVoluntary = (a: UnderpairAction): boolean =>
  a.action === 'call' || a.action === 'raise' || a.action === 'bet' || a.action === 'all_in';

/**
 * The seat of the COLD re-raiser hero faces, or null. Cold: three or more
 * preflop raises, the last by another player whose raise was his first
 * voluntary money of the hand (a blind or ante post is not voluntary), and
 * the raise before it was hero's own.
 */
export function omahaColdFourBetFaced(
  history: readonly UnderpairAction[] | undefined,
  heroSeat: number
): number | null {
  const voluntary = new Set<number>();
  let raises = 0;
  let last: { seat: number; cold: boolean; over: number | null } | null = null;
  for (const a of history ?? []) {
    if (a.stage !== 'preflop') continue;
    if (isRaise(a)) {
      raises++;
      last = { seat: a.seat, cold: !voluntary.has(a.seat), over: last ? last.seat : null };
    }
    if (isVoluntary(a)) voluntary.add(a.seat);
  }
  if (raises < RERAISED_MIN_PREFLOP_RAISES || last === null) return null;
  if (last.seat === heroSeat || !last.cold || last.over !== heroSeat) return null;
  return last.seat;
}

export type OmahaUnderpairVerdict = { fold: boolean; equity: number | null; price: number };

/**
 * Null when the cell does not apply (out of scope, aces or a premium
 * structure, or no equity estimate): the decision stands. The caller has
 * already established the cold re-raise (omahaColdFourBetFaced).
 */
export function omahaColdFourBetCell(i: OmahaReraisedInput): OmahaUnderpairVerdict | null {
  const v = omahaReraisedPreflopCell(i);
  if (v === null) return null;
  if (v.fold) return { fold: true, equity: v.equity, price: v.price };
  const call = Math.min(i.toCall, i.stack);
  const behind = i.stack - call;
  // Priced by commitment: all in, or no more left behind than the call itself.
  if (behind <= 0.005 || behind <= call) return { fold: false, equity: v.equity, price: v.price };
  return { fold: true, equity: v.equity, price: v.price };
}

/**
 * True when, on the flop, an opponent's bet or raise is the last aggression
 * and a different opponent has called it since, both still live.
 */
export function omahaFlopBetAndCallFaced(
  history: readonly UnderpairAction[] | undefined,
  heroSeat: number,
  liveSeats: ReadonlySet<number>
): boolean {
  let bettor: number | null = null;
  const callers = new Set<number>();
  for (const a of history ?? []) {
    if (a.stage !== 'flop') continue;
    if (isRaise(a)) {
      bettor = a.seat;
      callers.clear();
    } else if ((a.action === 'call' || a.action === 'all_in') && bettor !== null) {
      callers.add(a.seat);
    }
  }
  if (bettor === null || bettor === heroSeat || !liveSeats.has(bettor)) return false;
  for (const seat of callers)
    if (seat !== heroSeat && seat !== bettor && liveSeats.has(seat)) return true;
  return false;
}

/**
 * Exactly one pair, below the top card of an unpaired flop, with no flush
 * draw and no open-ended or wrap draw to the nut straight.
 */
export function omahaUnderpairNoDraw(hole: readonly Card[], board: readonly Card[]): boolean {
  if (board.length !== 3) return false;
  const boardRanks = board.map((c) => RANK_VALUE[c.rank] ?? 0);
  if (new Set(boardRanks).size !== 3) return false;
  if (omahaMadeClass([...hole], [...board]).cls !== 'pair') return false;
  const top = Math.max(...boardRanks);
  const holeRanks = hole.map((c) => RANK_VALUE[c.rank] ?? 0);
  // Top pair, or a pocket pair above the top card, is not an underpair.
  if (holeRanks.includes(top)) return false;
  if (holeRanks.some((r) => r > top && holeRanks.filter((x) => x === r).length >= 2)) return false;
  const dq = omahaDrawQuality([...hole], [...board]);
  if (dq.nutFlushDraw || dq.dominatedFlushDraw) return false;
  return dq.nutStraightOuts < UNDERPAIR_NUT_STRAIGHT_OUTS;
}

export interface OmahaUnderpairFlopInput {
  variant: string;
  street: string;
  hole: readonly Card[];
  board: readonly Card[];
  /** the decision being judged */
  action: string;
  toCall: number;
  stack: number;
  /** the pot including every wager on the table (gs.pot) */
  pot: number;
  /** omahaFlopBetAndCallFaced of the hand's history */
  betAndCall: boolean;
  hiLo: boolean;
  multiBoard: boolean;
  bombPot: boolean;
  tournament: boolean;
  allInOrFold: boolean;
}

/** Null when the cell does not apply; otherwise fold, or kept on the small price. */
export function omahaUnderpairFlopCell(i: OmahaUnderpairFlopInput): OmahaUnderpairVerdict | null {
  if (
    i.street !== 'flop' ||
    !omahaStrategyGameInScope(RERAISED_POT_VARIANTS, { gameVariant: i.variant })
  )
    return null;
  if (i.hiLo || i.multiBoard || i.bombPot || i.tournament || i.allInOrFold) return null;
  if (i.hole.length !== (i.variant === 'plo4' ? 4 : 5)) return null;
  if (i.action !== 'call' && i.action !== 'raise' && i.action !== 'all_in') return null;
  if (!(i.toCall > 0.005) || !(i.stack > 0) || !Number.isFinite(i.pot) || !(i.pot > 0)) return null;
  if (!i.betAndCall || !omahaUnderpairNoDraw(i.hole, i.board)) return null;
  const call = Math.min(i.toCall, i.stack);
  const price = call / (i.pot + call);
  return { fold: price >= UNDERPAIR_KEEP_PRICE, equity: null, price };
}
