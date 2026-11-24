/**
 * HOLD'EM TURN AND RIVER RAISE NEEDS VALUE (option holdemTurnRiverRaiseNeedsValue, default OFF, read `=== true`).
 *
 * Owner 2026-11-15 12:52 / 12:53 (the ruling the PLO twin omahaTurnRiverRaiseNeedsNuts enforces): on the turn and
 * the river, facing a bet, a hand that is not a value hand folds or at best calls; it never raises. Owner
 * 2026-11-24 (Hold'em late-street audit, plo-lead6): the Hold'em Horses still raise the turn and river with
 * random bluff and semi-bluff draws (`ft_semibluff_raise_*`, the scare-card blocker raise, the river blocker
 * raise, `holdem_priced_bluff_raise_kept`), so the ruling is ported to No-Limit Hold'em.
 *
 * SCOPE: No-Limit Hold'em (gameVariant 'nlh'), cash tables, Lightning pools and tournaments, heads-up and multiway,
 * one board, not a bomb pot, not an all-in-or-fold table, on the turn and the river, facing a wager, with chips
 * behind the call. Never Omaha, Short Deck, Pineapple, fixed limit or hi-lo.
 *
 * WHAT IT DOES: it reads the final answer of the decision (the outermost owner of the wager_rules node, after every
 * rule that can raise). When that answer raises (a raise, or an all-in above the call), the raise stands only for a
 * VALUE HAND, defined here:
 *
 *   For every live opponent o, his line range R_o is built exactly as holdemValueAndCallsArePriced builds the
 *   bettor's range (his preflop band from HorseMind.bandFor, narrowed street by street by his public line, with his
 *   measured fold-to-bet f_o and bet-when-checked-to b_o as statRead posteriors on the population envelope), and the
 *   Horse's equity against each combination is filled (exact on the river, seeded runouts on the turn; no
 *   fastRandom draw). Against the raise to T he folds f = min(F_o(price of T), weak share of R_o), F_o being the
 *   price-scaled fold of holdemPricedFold, and continues with the strongest (1 - f) of R_o (an all-in opponent
 *   continues with all of it).
 *   The hand is a VALUE HAND iff its equity against the continuing part of every live opponent's range is above
 *   HOLDEM_LATE_RAISE_VALUE_EQUITY (0.5): the raise wins more than half the time when it is called.
 *
 * A raise by any other hand is never made. It becomes the PRICED CALL OR FOLD: the call stands when
 *   EV(call) = r * E * (pot + c) - c >= 0,
 * with c the chips the call puts in, r the realization (1 on the river or in position, 0.88 out of position on the
 * turn, the holdemValueAndCallsArePriced constant), and E the Horse's equity against the bettor's whole line range
 * (multiway: the product of its equities against every live opponent's range, the independence approximation);
 * a tie calls. Otherwise the hand folds. When no range can be built (no envelope, an empty range) or the rule
 * throws, the raise becomes the call (never kept as a raise, never folded on a failure to price).
 *
 * It only ever withholds a raise: a call, a fold or a check it is handed is returned untouched, and it never
 * creates a wager. It reads only the Horse's own cards, the board and the public line (no unshown hole card, no
 * person-vs-Horse fact, no named player). Receipts: holdem_turn_river_raise_value_kept,
 * holdem_turn_river_raise_not_value_called, holdem_turn_river_raise_not_value_folded,
 * holdem_turn_river_raise_not_value_unpriced_called, holdem_turn_river_raise_rule_failed.
 */
import type { ActionRecord, Card, HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { computeActionLinePosterior } from './HorseActionLinePosterior.js';
import { HorseMind, readScopeOf } from './HorseMind.js';
import { exploitEnvelopeFor, statRead } from './HorseOpponentExploit.js';
import { horsePolicyDealtPlayers } from './multiway/DealtSeatCensus.js';
import { noteDecisionRuleReceipt, noteFire, telemetryOn } from './BrainTelemetry.js';
import {
  HOLDEM_PRICED_REALIZATION_OOP,
  holdemEquityOfShare,
  holdemFillEquities,
  holdemLineLikelihood,
  holdemLineRange,
  holdemPricedFold,
  holdemPricedSeed,
  type HoldemLineStreet,
  type HoldemPricedRange,
} from './HorseHoldemValueAndCallsArePriced.js';

export const HOLDEM_TURN_RIVER_RAISE_NEEDS_VALUE = 'holdemTurnRiverRaiseNeedsValue';
/** A value raise: ahead of the part of every live opponent's range that continues against it. */
export const HOLDEM_LATE_RAISE_VALUE_EQUITY = 0.5;
const EPS = 0.005;

export interface HoldemLateRaiseScope {
  street: 'turn' | 'river';
  /** chips the call puts in (capped by the stack) */
  call: number;
  toCall: number;
  heroIn: number;
  currentBet: number;
  stack: number;
  /** the call takes the whole stack: there is no raise to make */
  allIn: boolean;
  /** live opponents (not folded; all-in ones included) */
  live: SeatPlayer[];
  /** the last opponent who wagered on this street, when known */
  bettor: SeatPlayer | null;
}

const num = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? x : 0);

/** The rule's spot, from the public request and the Horse's own seat only. Null outside it. */
export function holdemLateRaiseScope(
  player: SeatPlayer,
  gs: HorseGameStateV2
): HoldemLateRaiseScope | null {
  if (String(gs.gameVariant ?? '').toLowerCase() !== 'nlh') return null;
  if (gs.bettingStructure !== undefined && gs.bettingStructure !== 'no_limit') return null;
  const street = gs.stage;
  if (street !== 'turn' && street !== 'river') return null;
  const board = gs.communityCards ?? [];
  if (board.length !== (street === 'turn' ? 4 : 5)) return null;
  if (gs.bombPot === true || gs.allInOrFold === true) return null;
  const g = gs as { communityCards2?: readonly unknown[]; communityCards3?: readonly unknown[] };
  if ((g.communityCards2?.length ?? 0) > 0 || (g.communityCards3?.length ?? 0) > 0) return null;
  if ((gs.boardCount ?? 1) !== 1) return null;
  if (gs.variantRules?.splitLow8OrBetter === true) return null;
  if (!Array.isArray(player.cards) || player.cards.length !== 2) return null;
  const heroIn = Math.max(0, num(player.bet));
  const currentBet = Math.max(num(gs.currentBet), heroIn);
  const toCall = Number.isFinite(gs.toCall)
    ? Math.max(0, gs.toCall as number)
    : Math.max(0, currentBet - heroIn);
  if (!(toCall > EPS)) return null;
  const stack = Math.max(0, num(player.stack));
  const live = (gs.players ?? []).filter(
    (p) => p.seat !== player.seat && !p.is_folded && (!p.is_sitting_out || p.is_all_in)
  );
  if (live.length === 0) return null;
  let bettor: SeatPlayer | null = null;
  for (const a of gs.actionHistory ?? []) {
    if (a.stage !== street || (a.action !== 'bet' && a.action !== 'raise' && a.action !== 'all_in'))
      continue;
    const who = live.find(
      (p) =>
        (a.userId !== undefined && p.user_id === a.userId) ||
        (a.userId === undefined && p.seat === a.seat)
    );
    if (who) bettor = who;
  }
  return {
    street,
    call: Math.min(toCall, stack),
    toCall,
    heroIn,
    currentBet,
    stack,
    allIn: stack <= toCall + EPS,
    live,
    bettor,
  };
}

/** The street total a decision wagers to, or null when it does not raise (a call for the whole stack is a call). */
export function holdemLateRaiseTo(
  d: Pick<HorseDecision, 'action' | 'amount'>,
  scope: HoldemLateRaiseScope
): number | null {
  if (scope.allIn) return null;
  if (d.action === 'raise' && Number.isFinite(d.amount)) return d.amount as number;
  if (d.action === 'all_in') return scope.heroIn + scope.stack;
  return null;
}

function dealtTableSize(gs: HorseGameStateV2, heroSeat: number): number {
  return gs.dealtSeatIds === undefined
    ? gs.players.length
    : horsePolicyDealtPlayers(gs.players, heroSeat, gs.dealtSeatIds).length;
}

export interface HoldemOpponentRange {
  opp: SeatPlayer;
  range: HoldemPricedRange;
  foldAtReference: number;
  /** his bet share when checked to (the same statRead posterior the line narrowing uses) */
  betWhenCheckedTo: number;
}

/**
 * One live opponent's line range, built exactly as holdemValueAndCallsArePriced builds the bettor's range
 * (HorseLogic.holdemPricedReference): his band, his measured fold to a bet and bet when checked to (statRead
 * posteriors on the Hold'em population envelope for the table size), street by street. Equities filled. Null when
 * there is no envelope or the range is empty.
 */
export function holdemOpponentLineRange(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  opp: SeatPlayer,
  mind: boolean,
  liveCount: number,
  fillEquities = true,
  /** holdemLateStreetIsPriced / holdemFlopIsPriced only: the share of his range he bets with his first wager of a
   * street (the fitted bet share for his line and position, his record moving it); null keeps the reads below. */
  betShareOf?: (stage: 'flop' | 'turn' | 'river', index: number) => number | null
): HoldemOpponentRange | null {
  const board = (gs.communityCards ?? []) as Card[];
  const street = gs.stage as 'flop' | 'turn' | 'river';
  const scope = readScopeOf('nlh', dealtTableSize(gs, player.seat));
  const envelope = exploitEnvelopeFor(scope, 'nlh');
  if (!envelope) return null;
  const counters = mind ? HorseMind.getExploitCounters(opp.user_id, scope) : undefined;
  const foldAtReference = statRead(
    counters?.foldToBet ?? 0,
    counters?.foldToBetOpp ?? 0,
    envelope.foldToBet
  ).mean;
  const betWhenCheckedTo = statRead(
    counters?.betCheckedTo ?? 0,
    counters?.betCheckedToOpp ?? 0,
    envelope.betCheckedTo
  ).mean;
  const history = (gs.actionHistory ?? []) as ActionRecord[];
  const preflop = history.filter((x) => x.stage === 'preflop');
  let band: [number, number] | null = null;
  if (mind) {
    try {
      band = HorseMind.bandFor(
        opp.user_id,
        preflop,
        gs.bigBlind,
        true,
        null,
        undefined,
        HorseMind.initialPublicMoney(gs.players, gs.actionHistory, gs.pot) ?? undefined
      );
    } catch {
      band = null;
    }
  }
  const multiwayCount = Math.max(2, liveCount + 1);
  const posteriorOf = (h: ActionRecord[], stage: 'flop' | 'turn' | 'river' = street) =>
    computeActionLinePosterior({
      villainUserId: opp.user_id,
      villainSeat: opp.seat,
      heroSeat: player.seat,
      stage,
      board,
      pot: gs.pot,
      bigBlind: gs.bigBlind,
      actionHistory: h as never,
      multiwayCount,
    });
  const streets = ['flop', 'turn', 'river'] as const;
  const isOpp = (x: ActionRecord) =>
    x.userId === opp.user_id || (x.userId === undefined && x.seat === opp.seat);
  let totalHistoryAdded = 0;
  {
    let stScan = 'preflop';
    let commScan = new Map<string, number>();
    for (const x of history) {
      const st = x.stage ?? 'preflop';
      if (st !== stScan) {
        stScan = st;
        commScan = new Map();
      }
      const key = x.userId ?? `s${x.seat}`;
      const prev = commScan.get(key) ?? 0;
      const amt = Math.max(0, Number(x.amount ?? 0));
      const total =
        x.action === 'raise' || x.action === 'all_in' ? Math.max(prev, amt) : prev + amt;
      totalHistoryAdded += Math.max(0, total - prev);
      commScan.set(key, total);
    }
  }
  const line: HoldemLineStreet[] = [];
  const appliedCheckStreets = new Set<string>();
  const pushCheckStreetIfOnlyChecks = (stName: string) => {
    const k = streets.indexOf(stName as never);
    if (k < 0 || k + 3 > board.length || appliedCheckStreets.has(stName)) return;
    appliedCheckStreets.add(stName);
    const mine = history.filter((y) => y.stage === stName && isOpp(y));
    if (mine.length === 0 || mine.some((y) => y.action !== 'check')) return;
    const upTo = (end: number) =>
      history.filter((y) => y.stage === 'preflop' || streets.indexOf(y.stage as never) < end);
    line.push({
      board: board.slice(0, k + 3),
      likelihood: holdemLineLikelihood(
        posteriorOf(upTo(k + 1), stName as 'flop' | 'turn' | 'river'),
        posteriorOf(upTo(k), stName as 'flop' | 'turn' | 'river')
      ),
    });
  };
  let runningPot = Math.max(0, Number(gs.pot ?? 0) - totalHistoryAdded);
  let streetOf = 'preflop';
  let committed = new Map<string, number>();
  let facingTo = 0;
  let oppNarrowedPostflop = false;
  for (const x of history) {
    const st = x.stage ?? 'preflop';
    if (st !== streetOf) {
      pushCheckStreetIfOnlyChecks(streetOf);
      streetOf = st;
      committed = new Map();
      facingTo = 0;
    }
    const key = x.userId ?? `s${x.seat}`;
    const prev = committed.get(key) ?? 0;
    const amt = Math.max(0, Number(x.amount ?? 0));
    const wager = x.action === 'raise' || x.action === 'all_in' || x.action === 'bet';
    const total = x.action === 'raise' || x.action === 'all_in' ? Math.max(prev, amt) : prev + amt;
    const added = Math.max(0, total - prev);
    const k = streets.indexOf(st as never);
    if (k >= 0 && k + 3 <= board.length && isOpp(x)) {
      const sb = board.slice(0, k + 3);
      if (x.action === 'call' || (x.action === 'all_in' && total <= facingTo + 1e-9)) {
        const sub = holdemLineRange(player.cards, board, band, line);
        const f = Math.min(holdemPricedFold(foldAtReference, added, runningPot), sub.weakShare);
        line.push({ board: sb, keep: { top: 1 - f, bottom: 0 } });
        oppNarrowedPostflop = true;
      } else if (wager && total > facingTo + 1e-9) {
        const upTo = history.slice(0, history.indexOf(x) + 1);
        const callToFace = Math.max(0, total - facingTo);
        const beta =
          st === 'river'
            ? callToFace / Math.max(1e-9, runningPot + added + callToFace)
            : posteriorOf(upTo, st as 'flop' | 'turn' | 'river').bluffShareEstimate;
        const fitted =
          betShareOf && facingTo <= 0
            ? betShareOf(st as 'flop' | 'turn' | 'river', history.indexOf(x))
            : null;
        const betShare =
          fitted !== null && fitted !== undefined
            ? fitted
            : oppNarrowedPostflop
              ? Math.max(betWhenCheckedTo, 1 - foldAtReference)
              : betWhenCheckedTo;
        const half = facingTo > 0 ? 0.5 : 1;
        line.push({
          board: sb,
          keep: { top: betShare * (1 - beta) * half, bottom: betShare * beta * half },
        });
        oppNarrowedPostflop = true;
      }
    }
    if (total > facingTo) facingTo = total;
    committed.set(key, total);
    runningPot += added;
  }
  pushCheckStreetIfOnlyChecks(streetOf);
  const range = holdemLineRange(player.cards, board, band, line);
  if (range.total <= 0) return null;
  if (fillEquities)
    holdemFillEquities(range, player.cards, board, holdemPricedSeed(player.cards, board, gs.pot));
  return { opp, range, foldAtReference, betWhenCheckedTo };
}

/** Whether the Horse acts after every live opponent on this street (the dealer button order). */
export function holdemHeroLastToAct(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  live: SeatPlayer[]
): boolean {
  const order = (seat: number) => {
    const d = (seat - Number(gs.dealerSeat ?? 0) + 100) % 100;
    return d === 0 ? 100 : d;
  };
  return live.every((o) => order(player.seat) > order(o.seat));
}

export type HoldemLateRaiseVerdict =
  | { kind: 'value'; equityWhenCalled: number }
  | { kind: 'call' | 'fold'; equityWhenCalled: number; callEv: number; equity: number }
  | { kind: 'unpriced' };

/**
 * The verdict on a turn or river raise to `to`: value (it stands), or the priced call or fold. Pure on its inputs
 * and the Horse memory's reads; draws no random number.
 */
export function holdemLateRaiseVerdict(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  scope: HoldemLateRaiseScope,
  to: number,
  mind: boolean
): HoldemLateRaiseVerdict {
  const ranges: HoldemOpponentRange[] = [];
  for (const o of scope.live) {
    const r = holdemOpponentLineRange(player, gs, o, mind, scope.live.length);
    if (!r) return { kind: 'unpriced' };
    ranges.push(r);
  }
  const pot = Math.max(0, num(gs.pot));
  const add = Math.max(0, Math.min(to - scope.heroIn, scope.stack));
  let minCont = 1;
  for (const r of ranges) {
    const oIn = Math.max(0, num(r.opp.bet));
    const oStack = Math.max(0, num(r.opp.stack));
    const canFold = !r.opp.is_all_in && oStack > 0;
    const his = Math.max(0, Math.min(to - oIn, oStack));
    const matched = Math.max(0, Math.min(add, oIn + his - scope.heroIn));
    const f = canFold
      ? Math.min(holdemPricedFold(r.foldAtReference, matched, pot), r.range.weakShare)
      : 0;
    const cont = holdemEquityOfShare(r.range, 1 - f, 'top').equity;
    if (cont < minCont) minCont = cont;
  }
  if (minCont > HOLDEM_LATE_RAISE_VALUE_EQUITY) return { kind: 'value', equityWhenCalled: minCont };
  let equity = 1;
  for (const r of ranges) equity *= holdemEquityOfShare(r.range, 1).equity;
  const rz =
    scope.street === 'river' || holdemHeroLastToAct(player, gs, scope.live)
      ? 1
      : HOLDEM_PRICED_REALIZATION_OOP;
  const callEv = rz * equity * (pot + scope.call) - scope.call;
  // a tie calls (the river bluff-catch at exact indifference is 0 up to rounding)
  return { kind: callEv >= -1e-6 ? 'call' : 'fold', equityWhenCalled: minCont, callEv, equity };
}

/**
 * The rule. Off (anything but `=== true`): the decision itself, untouched, nothing read. On: a turn or river raise
 * facing a wager in the scope stands only for a value hand; any other raise becomes the priced call or fold.
 * `legalize` is the engine's legalizer for the call it builds.
 */
export function holdemTurnRiverRaiseNeedsValueRule(
  decision: HorseDecision,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  opts: { holdemTurnRiverRaiseNeedsValue?: boolean; telemetry?: boolean; mind?: boolean },
  legalize: (d: HorseDecision) => HorseDecision
): HorseDecision {
  if (opts.holdemTurnRiverRaiseNeedsValue !== true) return decision;
  const tele = telemetryOn(opts);
  let scope: HoldemLateRaiseScope | null = null;
  try {
    scope = holdemLateRaiseScope(player, gs);
    if (!scope) return decision;
    const to = holdemLateRaiseTo(decision, scope);
    if (to === null) return decision;
    const verdict = holdemLateRaiseVerdict(player, gs, scope, to, opts.mind !== false);
    if (verdict.kind === 'value') {
      if (tele) noteFire('holdem_turn_river_raise_value_kept');
      return decision;
    }
    const thinkTime = decision.thinkTime ?? 0;
    let out: HorseDecision;
    let receipt: string;
    // Every other field of the decision is kept (as the Omaha raise rules do); only the action and its chips change.
    if (verdict.kind === 'fold') {
      out = { ...decision, action: 'fold', thinkTime };
      delete out.amount;
      receipt = 'holdem_turn_river_raise_not_value_folded';
    } else {
      const call = legalize({ action: 'call', amount: scope.call, thinkTime });
      out = { ...decision, action: call.action, thinkTime };
      if (call.amount === undefined) delete out.amount;
      else out.amount = call.amount;
      receipt =
        verdict.kind === 'call'
          ? 'holdem_turn_river_raise_not_value_called'
          : 'holdem_turn_river_raise_not_value_unpriced_called';
    }
    if (tele) {
      noteFire(receipt);
      noteDecisionRuleReceipt(receipt, decision, out);
    }
    return out;
  } catch {
    if (tele) noteFire('holdem_turn_river_raise_rule_failed');
    if (!scope) return decision;
    try {
      const call = legalize({
        action: 'call',
        amount: scope.call,
        thinkTime: decision.thinkTime ?? 0,
      });
      const out: HorseDecision = { ...decision, action: call.action };
      if (call.amount === undefined) delete out.amount;
      else out.amount = call.amount;
      return out;
    } catch {
      return decision;
    }
  }
}

/**
 * Receipt validator admission (horseDecision/responseValidation.ts): a raise the rule withheld on a Hold'em turn
 * or river, re-derived from the public request: the spot holds, and the after action is the call of exactly the
 * chips owed (an all-in only when that is the whole stack) or the fold.
 */
export function holdemTurnRiverRaiseNeedsValueAdmits(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  previous: { action: string; amount: number | null },
  after: { action: string; amount: number | null }
): boolean {
  try {
    const scope = holdemLateRaiseScope(player, gs);
    if (!scope || scope.allIn) return false;
    const raised =
      previous.action === 'raise' ||
      (previous.action === 'all_in' && scope.stack > scope.toCall + EPS);
    if (!raised) return false;
    if (after.action === 'fold') return true;
    if (after.action === 'call')
      return typeof after.amount === 'number' && Math.abs(after.amount - scope.call) < 1e-6;
    return false;
  } catch {
    return false;
  }
}
