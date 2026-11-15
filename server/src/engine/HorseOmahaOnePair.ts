/**
 * OMAHA ONE-PAIR DISCIPLINE (Dan 2026-11-14, PLO5 cash hands 59407629,
 * 59430325, 59431232, 59417700 and 59426444). Option omahaOnePairDiscipline,
 * default on by owner order 2026-11-15 00:56: explicit false switches it off.
 *
 * The complaints: the Horse bets the river with one pair (a value bet only
 * better hands call); it check-calls a pot-sized river bet after the flush
 * and the straight both completed with a hand that beats no value hand
 * ("STOP CALLING RIVER BETS WHEN WE CAN'T BEAT ANYTHING"); it stacks off with
 * one pair (an overpair with no draw) on a connected flop.
 *
 * Scope: PLO4 and PLO5 high, one board, not Hi-Lo, not fixed limit, not an
 * all-in-or-fold table, not a bomb pot (omahaMadeHandDefenseStreet with the
 * PLO4/PLO5 set, plus the bomb-pot test). The rules only ever reduce the
 * chips hero puts in: bet -> check, raise -> call, call -> fold.
 *
 * ONE PAIR OR LESS (omahaOnePairOrLess): the made category from
 * omahaNutStatus is high card or one pair, or two pair that omahaMadeClass
 * names `board2p` (the board's pair plus one pair of hero's own).
 *
 * Rule 1 (river, no value bet): one pair or less never bets or raises on the
 * river unless the engine's reference brain chose the wager as a river bluff
 * (the caller passes `declaredBluff`). A bet becomes a check; a raise facing
 * a wager becomes a call (Rule 2 then judges that call).
 *
 * Rule 2 (river, beaten bluff catcher): facing a wager of 0.66 pot or more
 * (the last bettor's added chips over the pot before them, v81StreetWager),
 * at a call price of V81_MIN_CALL_PRICE or more, a hand of two pair or less
 * on a board where a straight or a flush is possible folds, unless the
 * bettor is MEASURED as a postflop over-bluffer (isPostflopManiac on a read
 * that is not presumed; the caller passes `bettorOverBluffs`).
 *
 * Rule 3 (flop and turn, no one-pair stack-off): one pair or less with fewer
 * than ONE_PAIR_MIN_NUT_OUTS next-card outs to a nut-class hand, facing a
 * wager: a raise becomes a call while the call costs no more than half the
 * effective stack, and becomes a fold when it costs more; a call that costs
 * more than half the effective stack folds. A call priced below
 * ONE_PAIR_STACK_OFF_MIN_PRICE (a wager far over the remaining stacks, the
 * pot already laying a big price) is left alone.
 *
 * Public information only (hero's cards, board, public actions), apart from
 * the measured over-bluffer read Rule 2 accepts as an exception.
 */
import type { Card, HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { RANKS, SUITS } from './PokerEngine.js';
import { omahaBoatsAbove, omahaMadeClass, omahaNutStatus } from './HorseEval.js';
import { V81_MIN_CALL_PRICE, v81StreetWager } from './HorseOmahaBigBetCalls.js';
import {
  OMAHA_NUT_VALUE_SIZE_VARIANTS,
  omahaBoardThreat,
  omahaMadeHandDefenseStreet,
} from './HorseOmahaMadeHandDefense.js';

/** Rule 2: the smallest river wager, as a share of the pot before it. */
export const ONE_PAIR_RIVER_FOLD_MIN_POT_FRAC = 0.66;
/** Rule 3: one pair with at least this many nut-class outs keeps its line. */
export const ONE_PAIR_MIN_NUT_OUTS = 4;
/** Rule 3: a call costing more than this share of the effective stack is a stack-off. */
export const ONE_PAIR_STACK_OFF_SHARE = 0.5;
/** Rule 3: a stack-sized call priced below this is left alone. */
export const ONE_PAIR_STACK_OFF_MIN_PRICE = 0.25;

export type OmahaOnePairChange =
  | 'river_value_bet_checked'
  | 'river_value_raise_flatted'
  | 'river_beaten_call_folded'
  | 'one_pair_raise_flatted'
  | 'one_pair_raise_folded'
  | 'one_pair_stack_off_folded';

export interface OmahaOnePairResult {
  decision: HorseDecision;
  changed: OmahaOnePairChange | null;
}

export interface OmahaOnePairContext {
  /** The reference brain chose this river wager as a bluff. */
  declaredBluff: boolean;
  /** The last bettor this street is MEASURED as a postflop over-bluffer. */
  bettorOverBluffs: (seat: number) => boolean;
}

const toCallOf = (hero: SeatPlayer, gs: HorseGameStateV2): number =>
  Number.isFinite(gs.toCall)
    ? Math.max(0, gs.toCall as number)
    : Math.max(0, (gs.currentBet || 0) - (Number.isFinite(hero.bet) ? hero.bet : 0));

/** High card, one pair, or the board's pair plus one pair of hero's own. */
export function omahaOnePairOrLess(hole: Card[], board: Card[]): boolean {
  const cat = omahaNutStatus(hole, board).category;
  if (cat <= 2) return true;
  if (cat !== 3) return false;
  return omahaMadeClass(hole, board, cat).cls === 'board2p';
}

/** Two pair or less (any two pair counts). */
function twoPairOrLess(hole: Card[], board: Card[]): boolean {
  return omahaNutStatus(hole, board).category <= 3;
}

/**
 * The unseen next cards that give hero a nut-class hand: a full house or
 * better no bigger full house beats, the nut flush on an unpaired board, the
 * nut straight on an unpaired board with no possible flush.
 */
export function omahaNutClassOuts(hole: Card[], board: Card[], dead: Card[] = []): number {
  if (!Array.isArray(board) || (board.length !== 3 && board.length !== 4)) return 0;
  const key = (c: Card) => `${c.rank}:${c.suit}`;
  const removed = new Set([...hole, ...board, ...dead].map(key));
  let outs = 0;
  for (const suit of SUITS)
    for (const rank of RANKS) {
      const card = { rank, suit } as Card;
      if (removed.has(key(card))) continue;
      const next = [...board, card];
      const st = omahaNutStatus(hole, next);
      const paired = new Set(next.map((c) => c.rank)).size < next.length;
      if (
        (st.category >= 7 && omahaBoatsAbove(hole, next).boats === 0) ||
        (st.category === 6 && st.higherFlushRanks === 0 && !paired) ||
        (st.category === 5 && st.straightIsNut && !st.flushPossible && !paired)
      )
        outs++;
    }
  return outs;
}

const asCall = (decision: HorseDecision, toCall: number): HorseDecision => ({
  ...decision,
  action: 'call',
  amount: Math.round(toCall * 100) / 100,
});
const asFold = (decision: HorseDecision): HorseDecision => {
  const d: HorseDecision = { ...decision, action: 'fold' };
  delete d.amount;
  return d;
};
const asCheck = (decision: HorseDecision): HorseDecision => {
  const d: HorseDecision = { ...decision, action: 'check' };
  delete d.amount;
  return d;
};

/** The three rules, in order. Never adds chips. */
export function omahaOnePairDiscipline(
  decision: HorseDecision,
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  enabled: boolean,
  ctx: OmahaOnePairContext
): OmahaOnePairResult {
  const same: OmahaOnePairResult = { decision, changed: null };
  if (!enabled) return same;
  if (decision.action === 'check' || decision.action === 'fold') return same;
  try {
    if (gs.bombPot === true) return same;
    const street = omahaMadeHandDefenseStreet(hero, gs, OMAHA_NUT_VALUE_SIZE_VARIANTS);
    if (street === null) return same;
    const hole: Card[] = hero.cards;
    const board: Card[] = gs.communityCards ?? [];
    const legal = Array.isArray(gs.legalActions) ? gs.legalActions : null;
    const can = (a: string) => !legal || legal.includes(a as never);
    const stack = Number.isFinite(hero.stack) ? Math.max(0, hero.stack) : 0;
    const heroBet = Number.isFinite(hero.bet) ? Math.max(0, hero.bet) : 0;
    const toCall = toCallOf(hero, gs);
    const facing = toCall > 0.005;
    const isCall =
      decision.action === 'call' ||
      (decision.action === 'all_in' && facing && stack <= toCall + 0.005);
    const isRaise =
      facing &&
      (decision.action === 'raise' || (decision.action === 'all_in' && stack > toCall + 0.005));
    const isBet = !facing && (decision.action === 'bet' || decision.action === 'all_in');
    const pot = Number.isFinite(gs.pot) ? Math.max(0, gs.pot) : 0;
    const pay = Math.min(toCall, stack);
    const callPrice = pay > 0 ? pay / (pot + pay) : 0;

    if (street === 'river') {
      let current = decision;
      let changed: OmahaOnePairChange | null = null;
      // Rule 1.
      if ((isBet || isRaise) && !ctx.declaredBluff && omahaOnePairOrLess(hole, board)) {
        if (isBet && can('check')) {
          current = asCheck(decision);
          changed = 'river_value_bet_checked';
        } else if (isRaise && can('call')) {
          current = asCall(decision, toCall);
          changed = 'river_value_raise_flatted';
        }
      }
      // Rule 2.
      const calling = changed === 'river_value_raise_flatted' || (changed === null && isCall);
      if (calling && can('fold')) {
        const threat = omahaBoardThreat(board);
        if ((threat.straight || threat.flush) && twoPairOrLess(hole, board)) {
          const streetBets = new Map<number, number>();
          for (const p of gs.players ?? [])
            if (Number.isFinite(p.bet) && (p.bet ?? 0) > 0) streetBets.set(p.seat, p.bet ?? 0);
          const faced = v81StreetWager(gs.actionHistory, 'river', streetBets, pot);
          if (
            faced !== null &&
            faced.bettorSeat !== hero.seat &&
            faced.wager / faced.potBefore >= ONE_PAIR_RIVER_FOLD_MIN_POT_FRAC - 1e-9 &&
            callPrice >= V81_MIN_CALL_PRICE &&
            !ctx.bettorOverBluffs(faced.bettorSeat)
          )
            return { decision: asFold(current), changed: 'river_beaten_call_folded' };
        }
      }
      return { decision: current, changed };
    }

    // Rule 3, flop and turn, facing a wager.
    if (!facing || (!isCall && !isRaise)) return same;
    if (!omahaOnePairOrLess(hole, board)) return same;
    const heroTotal = stack + heroBet;
    const oppTotals = (gs.players ?? [])
      .filter((p) => p.seat !== hero.seat && !p.is_folded && !p.is_sitting_out)
      .map(
        (p) =>
          (Number.isFinite(p.stack) ? p.stack : 0) + (Number.isFinite(p.bet) ? (p.bet ?? 0) : 0)
      );
    if (oppTotals.length === 0) return same;
    const effective = Math.min(heroTotal, Math.max(...oppTotals));
    if (!(effective > 0)) return same;
    const stackSized = pay > ONE_PAIR_STACK_OFF_SHARE * effective + 0.005;
    if (stackSized && callPrice < ONE_PAIR_STACK_OFF_MIN_PRICE) return same;
    if (isCall && !stackSized) return same;
    if (omahaNutClassOuts(hole, board, hero.knownDeadCards ?? []) >= ONE_PAIR_MIN_NUT_OUTS)
      return same;
    if (stackSized) {
      if (!can('fold')) return same;
      // A measured postflop over-bluffer (the maniac who pots every street)
      // is called down by equity, as the maniac laws require
      // (HorseManiacPressure.law.test.ts); presumption never counts.
      const streetBets = new Map<number, number>();
      for (const p of gs.players ?? [])
        if (Number.isFinite(p.bet) && (p.bet ?? 0) > 0) streetBets.set(p.seat, p.bet ?? 0);
      const faced = v81StreetWager(gs.actionHistory, street, streetBets, pot);
      if (
        faced !== null &&
        faced.bettorSeat !== hero.seat &&
        ctx.bettorOverBluffs(faced.bettorSeat)
      )
        return same;
      return {
        decision: asFold(decision),
        changed: isRaise ? 'one_pair_raise_folded' : 'one_pair_stack_off_folded',
      };
    }
    if (!can('call')) return same;
    return { decision: asCall(decision, toCall), changed: 'one_pair_raise_flatted' };
  } catch {
    return same;
  }
}
