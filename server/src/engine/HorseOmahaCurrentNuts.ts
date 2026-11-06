/**
 * OMAHA CURRENT NUTS FACING A FLOP OR TURN BET (Dan 2026-11-06).
 *
 * Dan, watching production hand 55690261 (PLO5 1/2, six handed): "I JUST
 * WATCHED THE HORSE 'NOODLE' FLAT CALL A LARGE BET ON THE TURN OF 50 CHIPS,
 * WITH THE NUTS, AND A KING HIGH FLUSH REDRAW, WITH ANOTHER PLAYER LEFT TO
 * ACT STILL, INSTEAD OF RE RERAISING WITH FREE ROLL EQUITY?! WHY? HOW IS THAT
 * PROFITABLE?"
 *
 * The horse held 8c5c Kh3h 2d on As 7h 6h 4s: the 8-high straight, which is
 * the best hand any two cards can make on that board, plus a king-high heart
 * redraw. The reference brain's value raise is an equity bar (0.68 plus 0.05
 * per extra opponent). Sampled against two PLO5 ranges the current nuts read
 * 0.59 to 0.66, below the 0.73 multiway bar, so the hand fell through to the
 * V38 EV call on every seed and every profile. In Omaha the nuts are rarely
 * 70% multiway even when nobody can beat them yet; an equity bar written for
 * Hold'em made hands is the wrong question for them. The existing nut
 * invariant (riverNutsRaise) only ran on the river.
 *
 * The rule, after every strategy owner (same place as riverNutsRaise): an
 * Omaha high, single board hand on the flop or turn, facing a bet that
 * reopens the action, whose chosen action is a CALL, raises the pot (the
 * controller maximum in pot limit; all in when the pot raise is the whole
 * stack, or in no limit when it leaves less than half the new pot behind)
 * when hero holds the exact current nuts AND either
 *   - a redraw: at least FREEROLL_MIN_OUTS unseen next cards improve hero to
 *     a higher hand category (the freeroll: hero cannot lose to the hand it
 *     ties and can still improve past it), or
 *   - a hand no other two cards can tie (a vulnerable nut hand, for example
 *     top set on a wet board: protection and value both say raise).
 * Retained exceptions: a chop-locked nut hand (another two cards make the
 * identical hand) with no redraw keeps the call, since it can only split with
 * the hands that call a raise; and a bet whose V23 raise-response plan is
 * callOnce keeps that plan when it is raised (V28: the plan is honoured).
 *
 * Public information only: hero's cards, the board and hero's known dead
 * cards. The nuts are exact (every unseen pair enumerated, an Omaha hand
 * always uses exactly two hole cards), never sampled and never anyone's
 * private cards. No opponent label is read: horse and human opponents are
 * treated identically.
 */
import type { Card, HorseDecision, SeatPlayer } from '../types.js';
import type { HorseDecideOpts, HorseGameStateV2 } from './HorseLogic.js';
import { RANKS, SUITS } from './PokerEngine.js';
import { scoreOmahaHiPartial, variantInfo } from './HorseEval.js';
import { horsePolicyRegistration } from './HorsePolicyRegistry.js';
import { riverNutWagerTarget } from './HorseRiverNuts.js';
import { HorseMind } from './HorseMind.js';
import { horsePlanHandKey } from './HorseDecisionEffects.js';

/** Unseen next cards that must lift hero a whole hand category to count as a redraw. */
export const FREEROLL_MIN_OUTS = 4;

const key = (c: Card) => `${c.rank}:${c.suit}`;
const valid = (c: Card) => !!c && RANKS.includes(c.rank) && SUITS.includes(c.suit);
const category = (score: number) => Math.floor(score / 0x100000);
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface OmahaCurrentNuts {
  /** No unseen two cards beat hero's hand on the current board. */
  nuts: boolean;
  /** Some unseen two cards make exactly hero's hand. */
  tieable: boolean;
  /** Unseen next cards that improve hero to a higher hand category. */
  redrawOuts: number;
}

/** Exact current-nut status of an Omaha high hand on a flop or turn board. */
export function omahaCurrentNuts(
  hole: Card[],
  board: Card[],
  dead: Card[] = []
): OmahaCurrentNuts | null {
  if (!Array.isArray(hole) || hole.length < 4 || !Array.isArray(board)) return null;
  if (board.length !== 3 && board.length !== 4) return null;
  const known = [...hole, ...board, ...dead];
  if (known.some((c) => !valid(c))) return null;
  if (new Set([...hole, ...board].map(key)).size !== hole.length + board.length) return null;
  const removed = new Set(known.map(key));
  const unseen: Card[] = [];
  for (const suit of SUITS)
    for (const rank of RANKS) {
      const card = { rank, suit } as Card;
      if (!removed.has(key(card))) unseen.push(card);
    }
  const hero = scoreOmahaHiPartial(hole, board);
  if (hero <= 0) return null;
  let tieable = false;
  for (let i = 0; i < unseen.length; i++)
    for (let j = i + 1; j < unseen.length; j++) {
      const s = scoreOmahaHiPartial([unseen[i], unseen[j]], board);
      if (s > hero) return { nuts: false, tieable: false, redrawOuts: 0 };
      if (s === hero) tieable = true;
    }
  const heroCat = category(hero);
  let redrawOuts = 0;
  for (const c of unseen)
    if (category(scoreOmahaHiPartial(hole, [...board, c])) > heroCat) redrawOuts++;
  return { nuts: true, tieable, redrawOuts };
}

/** Final strategy invariant: the current nuts facing a flop or turn bet do not flat. */
export function omahaCurrentNutsRaise(
  decision: HorseDecision,
  hero: SeatPlayer,
  state: HorseGameStateV2,
  opts: Pick<HorseDecideOpts, 'omahaCurrentNutsRaise' | 'mindPlanContext'> = {}
): HorseDecision {
  // Off only for the complaint law's non-vacuity control.
  if (opts.omahaCurrentNutsRaise === false) return decision;
  if (decision.action !== 'call') return decision;
  if (state.stage !== 'flop' && state.stage !== 'turn') return decision;
  if (!horsePolicyRegistration(state.gameVariant)) return decision;
  const vi = variantInfo(state.gameVariant ?? 'nlh');
  if (!vi.isOmaha || vi.isHiLo || vi.isFixedLimit) return decision;
  if (
    state.wagersCapped === true ||
    state.stateSchemaVersion !== 1 ||
    !Array.isArray(state.legalActions) ||
    !Number.isFinite(state.toCall) ||
    state.toCall! <= 0 ||
    !Number.isFinite(state.currentBet) ||
    !Number.isFinite(hero.stack) ||
    !Number.isFinite(hero.bet) ||
    hero.stack <= state.toCall! ||
    hero.is_folded ||
    hero.is_all_in
  )
    return decision;
  if (
    (state.boardCount ?? 1) > 1 ||
    (state.communityCards2?.length ?? 0) > 0 ||
    (state.communityCards3?.length ?? 0) > 0
  )
    return decision;
  const opponents = state.players.filter(
    (p) => p.seat !== hero.seat && !p.is_folded && !p.is_sitting_out
  );
  if (!opponents.some((p) => !p.is_all_in && p.stack > 0)) return decision;
  // V23/V28: a bet that already declared "if raised, call once and never
  // escalate" is answered by that plan, not re-decided here.
  if (
    Array.isArray(state.actionHistory) &&
    HorseMind.getRaisePlan(
      horsePlanHandKey(state.actionHistory, opts.mindPlanContext),
      hero.user_id,
      state.stage
    ) === 'callOnce'
  )
    return decision;

  const min = state.minRaiseTo;
  const max = state.maxRaiseTo;
  const total = hero.bet + hero.stack;
  let raise: HorseDecision | null = null;
  if (
    state.legalActions.includes('raise') &&
    Number.isFinite(min) &&
    Number.isFinite(max) &&
    min! > state.currentBet &&
    max! >= min!
  ) {
    // The pot raise is more than hero has: the whole stack is the raise.
    const target = max! > total + 0.005 ? null : riverNutWagerTarget('raise', hero, state);
    if (target === null && max! > total + 0.005 && state.legalActions.includes('all_in')) {
      raise = { action: 'all_in', thinkTime: decision.thinkTime };
    } else if (target !== null) {
      const potAfter = state.pot + state.toCall! + (target - state.currentBet);
      const committed =
        total <= target + 0.005 ||
        (state.bettingStructure === 'no_limit' && total - target < potAfter * 0.5);
      raise =
        committed && state.legalActions.includes('all_in') && total <= max! + 0.005
          ? { action: 'all_in', thinkTime: decision.thinkTime }
          : { action: 'raise', amount: round2(target), thinkTime: decision.thinkTime };
    }
  } else if (
    state.legalActions.includes('all_in') &&
    total > state.currentBet &&
    (max === null || (Number.isFinite(max) && total <= max! + 0.005))
  ) {
    raise = { action: 'all_in', thinkTime: decision.thinkTime };
  }
  if (!raise) return decision;

  const status = omahaCurrentNuts(hero.cards, state.communityCards ?? [], hero.knownDeadCards);
  if (!status?.nuts) return decision;
  const redraw = status.redrawOuts >= FREEROLL_MIN_OUTS;
  // A chop-locked nut hand with no redraw only splits with the hands that call.
  if (status.tieable && !redraw) return decision;
  return { ...decision, ...raise, amount: raise.amount };
}
