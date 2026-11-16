/**
 * HEADS-UP POSTFLOP BALANCE (HV31 FLOP-5 item D1, 2026-11-15). Option
 * holdemHeadsUpPostflopBalance, default OFF: only an explicit true switches it
 * on, and with it off this module draws no random number and changes nothing.
 *
 * What it corrects (solver measurements of the hold'em horse, development
 * grade, exposed boards; evidence under the HV31 solver lane's FLOP-3 B9 and
 * B6 packets and FLOP-4 C1 result):
 *  - Flop c-bet mix (W7 game, 24 boards): heads-up in position after the
 *    big blind checks, the horse bets about 80% of its range and picks the
 *    size by hand strength (its weakest fifth bets one third of the pot 73%
 *    of the time, its strongest fifth bets large), while the solver checks
 *    about 47% and bets one large size with a polar range. The opponent's
 *    in-tree best-response gain (X) is about 50% of the root pot, and the
 *    flop mix drives it (B9: with the horse's flop locked and every later
 *    street re-solved, X stays 32%).
 *  - Fold to a flop check-raise: 86.7% in matched real hands against a model
 *    62.8%; in W7 the horse folds the middle fifth of its range 41-90% of the
 *    time where the solver continues 68-95%.
 *  - Turn and river after a check to it (C1, real bet sizes): the horse bets
 *    its middle-strength hands about twice as often as the solver (turn
 *    46-66% vs 26-37%; river 45-54% vs 22%), bluffs its weakest river hands
 *    less (31% vs 47%), and the opponent's X is 55.7% (turn) and 50.1%
 *    (river) of the entry pot.
 *
 * Scope (every part): no-limit hold'em cash, one board, no bomb pot, a
 * single-raised pot (one preflop raise), exactly two players left, neither
 * all in, effective stack of at least 20 big blinds, hero in position.
 *  - FLOP C-BET: hero made the preflop raise, the flop is checked to hero.
 *    A check or bet becomes: bet 0.75 of the pot with the tier's frequency,
 *    otherwise check. One size, so the size no longer shows the strength.
 *  - CHECK-RAISE DEFENCE: hero made the preflop raise, checked to, bet the
 *    flop and was raised. A fold becomes a call with a middle pair or better
 *    or a flush draw or open-ended straight draw; with less than top pair
 *    the call must cost at most half of hero's stack. Any other action stays.
 *  - TURN CHECKED TO: a check or bet becomes: bet 0.70 of the pot with the
 *    tier's frequency, otherwise check.
 * An all-in, a raise or a call chosen by the brain is never touched here.
 *
 * The river is NOT covered (revised 2026-11-16). A river part (bet the full
 * pot when checked to, by tier) was built and removed after its solver score
 * on the HV31 turn and river bank B1X-TR1: the river mean X fell, but 11 of
 * 41 river games got worse by more than 5 points of the pot (worst +17.5),
 * which fails the bank's own regression rule. A river rule is left for a
 * later redesign scored on fresh river games. With the option on, a river
 * decision is returned unchanged and draws no random number.
 *
 * Tiers come from hero's two cards and the public board only (no opponent
 * card, no identity): nutted (two pair with both hole cards, a set, trips,
 * a straight, flush or better that uses a hole card), top (overpair or top
 * pair), mid (middle pair, or a pocket pair above the board's second card),
 * weak (any other pair that uses a hole card), draw (flop or turn: a flush
 * draw or open-ended straight draw using a hole card), air. The bet
 * frequencies per tier follow the solver's own frequencies by hand-value
 * fifth in the measured games (the HV31 D1 report records the tables); they
 * are a calibration by inspection, not a fit, and the B1 regression tool
 * measures the result before anything is proposed for live play.
 */
import type { Card, HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { fastRandom } from './HorseEval.js';

export type HuBalanceSpot = 'flop_cbet' | 'flop_vs_check_raise' | 'turn_checked_to';
export type HuBalanceTier = 'nutted' | 'top' | 'mid' | 'weak' | 'draw' | 'air';
export type HuBalanceChange = 'flop_cbet' | 'check_raise_defend' | 'later_street' | null;
type CheckedToSpot = 'flop_cbet' | 'turn_checked_to';

/** Bet frequency per tier when the street is checked to hero. */
export const HU_BALANCE_BET_FREQUENCY: Readonly<
  Record<CheckedToSpot, Readonly<Record<HuBalanceTier, number>>>
> = {
  flop_cbet: { nutted: 0.9, top: 0.7, mid: 0.4, weak: 0.4, draw: 0.55, air: 0.4 },
  turn_checked_to: { nutted: 0.75, top: 0.4, mid: 0.25, weak: 0.25, draw: 0.45, air: 0.25 },
};
/** The one bet size per street, as a fraction of the pot before the bet. */
export const HU_BALANCE_BET_SIZE: Readonly<Record<CheckedToSpot, number>> = {
  flop_cbet: 0.75,
  turn_checked_to: 0.7,
};
/** Minimum effective stack, in big blinds, for any part of the rule. */
export const HU_BALANCE_MIN_DEPTH_BB = 20;

const RANK_VALUE: Record<string, number> = {
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
const SUIT_NAMES = ['clubs', 'diamonds', 'hearts', 'spades'] as const;

function isPreflopRaise(a: { action: string; isFullRaise?: boolean }): boolean {
  return (
    a.action === 'raise' ||
    a.action === 'bet' ||
    (a.action === 'all_in' && a.isFullRaise !== undefined)
  );
}

function heroToCall(player: SeatPlayer, gs: HorseGameStateV2): number {
  return Number.isFinite(gs.toCall)
    ? Math.max(0, gs.toCall as number)
    : Math.max(0, (gs.currentBet || 0) - (player.bet || 0));
}

/** The spot this rule covers, from public state only, or null (always null on the river). */
export function huBalanceSpot(player: SeatPlayer, gs: HorseGameStateV2): HuBalanceSpot | null {
  try {
    if (String(gs.gameVariant ?? '').toLowerCase() !== 'nlh') return null;
    if (gs.bettingStructure !== undefined && gs.bettingStructure !== 'no_limit') return null;
    if (gs.bombPot) return null;
    if (gs.gameMode !== 'cash') return null;
    if ((gs.communityCards2?.length ?? 0) > 0 || (gs.communityCards3?.length ?? 0) > 0) return null;
    const stage = gs.stage;
    const board = gs.communityCards ?? [];
    // The river is not covered (its part was removed after the solver score).
    const need = stage === 'flop' ? 3 : stage === 'turn' ? 4 : -1;
    if (need < 0 || board.length !== need) return null;
    if ((player.cards?.length ?? 0) !== 2 || player.is_folded || player.is_all_in) return null;
    if (!(player.stack > 0)) return null;
    const live = gs.players.filter(
      (p) => p.seat !== player.seat && !p.is_folded && (!p.is_sitting_out || p.is_all_in)
    );
    if (live.length !== 1) return null;
    const opp = live[0];
    if (opp.is_all_in || !(opp.stack > 0)) return null;
    const bb = gs.bigBlind;
    if (!(bb > 0)) return null;
    const eff = Math.min(player.stack + (player.bet || 0), opp.stack + (opp.bet || 0));
    if (eff / bb < HU_BALANCE_MIN_DEPTH_BB) return null;
    const hist = gs.actionHistory ?? [];
    const pre = hist.filter((a) => a.stage === 'preflop' && isPreflopRaise(a));
    if (pre.length !== 1) return null;
    const heroRaisedPreflop = pre[0].seat === player.seat;
    const street = hist.filter((a) => a.stage === stage);
    const toCall = heroToCall(player, gs);
    const oppChecked =
      street.length === 1 && street[0].seat === opp.seat && street[0].action === 'check';
    if (oppChecked && toCall <= 0.005) {
      if (stage === 'flop') return heroRaisedPreflop ? 'flop_cbet' : null;
      return 'turn_checked_to';
    }
    if (
      stage === 'flop' &&
      heroRaisedPreflop &&
      toCall > 0.005 &&
      street.length === 3 &&
      street[0].seat === opp.seat &&
      street[0].action === 'check' &&
      street[1].seat === player.seat &&
      street[1].action === 'bet' &&
      street[2].seat === opp.seat &&
      street[2].action === 'raise'
    )
      return 'flop_vs_check_raise';
    return null;
  } catch {
    return null;
  }
}

function rankSet(values: number[]): Set<number> {
  const s = new Set(values);
  if (s.has(14)) s.add(1);
  return s;
}

function hasRun(s: Set<number>, length: number, lo: number): boolean {
  for (let k = 0; k < length; k++) if (!s.has(lo + k)) return false;
  return true;
}

function hasStraight(s: Set<number>): boolean {
  for (let lo = 1; lo <= 10; lo++) if (hasRun(s, 5, lo)) return true;
  return false;
}

/** Hero's tier from its two cards and the public board. */
export function huBalanceTier(hole: readonly Card[], board: readonly Card[]): HuBalanceTier {
  const hv = hole.map((c) => RANK_VALUE[c.rank]);
  const bv = board.map((c) => RANK_VALUE[c.rank]);
  const all = [...hole, ...board];
  for (const suit of SUIT_NAMES) {
    const n = all.filter((c) => c.suit === suit).length;
    if (n >= 5 && hole.some((c) => c.suit === suit)) return 'nutted';
  }
  if (hasStraight(rankSet([...hv, ...bv])) && !hasStraight(rankSet(bv))) return 'nutted';
  const boardCount = new Map<number, number>();
  for (const v of bv) boardCount.set(v, (boardCount.get(v) ?? 0) + 1);
  const pocket = hv[0] === hv[1];
  if (pocket && (boardCount.get(hv[0]) ?? 0) >= 1) return 'nutted';
  if (hv.some((v) => (boardCount.get(v) ?? 0) >= 2)) return 'nutted';
  if (!pocket && (boardCount.get(hv[0]) ?? 0) === 1 && (boardCount.get(hv[1]) ?? 0) === 1)
    return 'nutted';
  const distinct = [...new Set(bv)].sort((a, b) => b - a);
  const top = distinct[0];
  const second = distinct.length > 1 ? distinct[1] : -1;
  if (pocket) {
    if (hv[0] > top) return 'top';
    return hv[0] > second ? 'mid' : 'weak';
  }
  const paired = hv.filter((v) => (boardCount.get(v) ?? 0) === 1);
  if (paired.length > 0) {
    const r = Math.max(...paired);
    if (r === top) return 'top';
    return r === second ? 'mid' : 'weak';
  }
  if (board.length < 5) {
    for (const suit of SUIT_NAMES) {
      const n = all.filter((c) => c.suit === suit).length;
      if (n === 4 && hole.some((c) => c.suit === suit)) return 'draw';
    }
    const s = rankSet([...hv, ...bv]);
    const sb = rankSet(bv);
    // Open-ended: four in a row with a free rank on both ends (2-5 .. T-K).
    for (let lo = 2; lo <= 10; lo++) if (hasRun(s, 4, lo) && !hasRun(sb, 4, lo)) return 'draw';
  }
  return 'air';
}

/**
 * The rule. `legalize` is the brain's own legalizer (HorseLogic.legalize); a
 * candidate it changes is returned in its legal form. With `on` false, or
 * outside its spots (every river decision among them), the decision is
 * returned as is and no random number is drawn.
 */
export function holdemHeadsUpPostflopBalance(
  decision: HorseDecision,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  on: boolean,
  legalize: (d: HorseDecision) => HorseDecision,
  rand: () => number = fastRandom
): { decision: HorseDecision; changed: HuBalanceChange } {
  if (!on) return { decision, changed: null };
  const spot = huBalanceSpot(player, gs);
  if (spot === null) return { decision, changed: null };
  const tier = huBalanceTier(player.cards, gs.communityCards ?? []);
  if (spot === 'flop_vs_check_raise') {
    if (decision.action !== 'fold') return { decision, changed: null };
    if (tier === 'weak' || tier === 'air') return { decision, changed: null };
    if (tier !== 'nutted' && tier !== 'top' && heroToCall(player, gs) > 0.5 * player.stack)
      return { decision, changed: null };
    const call = legalize({ action: 'call', thinkTime: decision.thinkTime });
    if (call.action !== 'call' && call.action !== 'all_in') return { decision, changed: null };
    return {
      decision: { ...decision, action: call.action, amount: call.amount },
      changed: 'check_raise_defend',
    };
  }
  if (decision.action !== 'check' && decision.action !== 'bet') return { decision, changed: null };
  const minTo = Number.isFinite(gs.minRaiseTo) ? (gs.minRaiseTo as number) : NaN;
  const maxTo = Number.isFinite(gs.maxRaiseTo) ? (gs.maxRaiseTo as number) : NaN;
  if (!(minTo > 0) || !(maxTo >= minTo) || !(gs.pot > 0)) return { decision, changed: null };
  const bet = rand() < HU_BALANCE_BET_FREQUENCY[spot][tier];
  let next: HorseDecision;
  if (!bet) next = { action: 'check', thinkTime: decision.thinkTime };
  else {
    const unit = gs.chipUnit === 1 ? 1 : 0.01;
    const target = Math.round((gs.pot * HU_BALANCE_BET_SIZE[spot]) / unit) * unit;
    const amount = Math.min(maxTo, Math.max(minTo, target));
    next = legalize(
      amount >= maxTo - 1e-9
        ? { action: 'all_in', amount: maxTo, thinkTime: decision.thinkTime }
        : { action: 'bet', amount, thinkTime: decision.thinkTime }
    );
  }
  if (next.action === decision.action && (next.amount ?? null) === (decision.amount ?? null))
    return { decision, changed: null };
  return {
    decision: { ...decision, action: next.action, amount: next.amount },
    changed: spot === 'flop_cbet' ? 'flop_cbet' : 'later_street',
  };
}
