/**
 * The wiring of the Hold'em tournament raise-defence price (HorseHoldemTournamentRaiseDefence.ts) into a preflop
 * decision. HorseLogic calls holdemRaiseDefenceReference once, at the end of the reference (after the all-in call
 * price), and asks holdemRaiseDefenceReversal before the Phase 7 arbiter or Phase 8 may change the answer. With the
 * three options off (absent or false) the first returns the decision it was given, writes nothing and fires
 * nothing, and the second answers false.
 *
 * Scope (every condition must hold, else the decision is returned unchanged): a two-card no-limit hold'em
 * tournament hand, one board, no straddle, no bomb pot, not All-In-Or-Fold (the host's scope test); preflop; one
 * opponent's raise faced, that raiser not all in, the call not all in for the Horse; nobody else has called or
 * limped (a heads-up pot: everyone else folded or is still to act); call and all in both legal or one of them.
 *   heads-up big blind (holdemTournamentHeadsUpBigBlindDefenceIsPriced): two dealt, the Horse the big blind facing
 *     the small blind's first raise, effective <= 25 big blinds;
 *   blind defence (holdemTournamentBlindDefenceIsPriced): three or more dealt, the Horse a blind facing the
 *     first raise, effective <= 25 big blinds;
 *   committed raise (holdemTournamentCommittedRaiseIsPriced): the Horse raised earlier this hand and faces a
 *     re-raise, effective <= 40 big blinds; or any faced raise that commits the Horse (COMMIT_* in the price), any
 *     depth, where the two options above do not own the spot.
 * Inside the scope the answer is the priced fold, call or shove, whatever the reference chose (a non-all-in
 * re-raise included), and no later layer may change it.
 *
 * v2 (2026-11-24): the three nodes the solved tables cover are answered by the equilibrium-anchored price
 * (HorseHoldemTournamentRaiseDefenceAnchored.ts): a blind facing one open (heads-up big blind or blind defence), the
 * opener facing one non-all-in 3-bet, the 3-bettor facing the opener's non-all-in 4-bet; there the answer may also be
 * the non-all-in 3-bet or 4-bet the solution mixes in. Every other spot in scope (a committing raise in another
 * shape, a re-raise after more raises) keeps the v1 price.
 */
import type { Card, HorseDecision, SeatPlayer } from '../types.js';
import type { HorseDecideOpts, HorseGameStateV2 } from './HorseLogic.js';
import type { Phase6ReferenceObservation } from './HorsePhase6Attribution.js';
import { noteFire } from './BrainTelemetry.js';
import { exploitEnvelopeFor, type OpponentExploitRead } from './HorseOpponentExploit.js';
import { holdemRangeWidth, preflopRoles } from './HorseHoldemTournamentAllInCall.js';
import {
  priceAnchoredDefence,
  type AnchoredNode,
  type AnchoredVerdict,
  type MeasuredRate,
} from './HorseHoldemTournamentRaiseDefenceAnchored.js';
import { solvedJamRange, solvedKind } from './HorseHoldemTournamentRaiseDefenceSolved.js';
import {
  HOLDEM_TOURNAMENT_RAISE_DEFENCE_PRIORS,
  type PriorCell,
} from './HorseHoldemTournamentRaiseDefencePriors.data.js';
import {
  RAISE_DEFENCE_BLIND_MAX_BB,
  RAISE_DEFENCE_RERAISE_MAX_BB,
  isCommitted,
  priceRaiseDefence,
  raiserModel,
  type RaiseDefenceVerdict,
  type RaiserRole,
} from './HorseHoldemTournamentRaiseDefence.js';

export type RaiseDefenceKind = 'hu_bb' | 'blind_defence' | 'reraise' | 'committed';

/** What HorseLogic supplies (its own helpers; nothing here re-implements them). */
export interface RaiseDefenceHost {
  /** Two-card no-limit hold'em tournament, one board, no straddle, no bomb pot (HorseLogic holdemAllInCallScope). */
  inScope: boolean;
  /** Players dealt in (HorseLogic dealtHorseTableSize). */
  dealt: number;
  /** A seat's preflop players behind, blinds included (HorseLogic preflopPlayersBehind). */
  playersBehind: (seat: number) => number | null;
  /** The pay-jump bubble factor at this risk (HorseLogic payJumpBubbleFactor), null where none is live. */
  bubbleFactor: (riskCapChips: number) => number | null;
  /** The opponent's read (HorseMind.opponentRead), null without one; not called with opts.mind === false. */
  read: (userId: string) => OpponentExploitRead | null;
  phase6Ref: Phase6ReferenceObservation | null;
  /** The active preflop reference owner a priced answer is attributed to (intent_engine under V7, else legacy_preflop). */
  ownerRoute: 'intent_engine' | 'legacy_preflop';
  /** The dead ante of this hand in big blinds (AnteMath.anteOrbitCostBB); read only when a v2 node is priced. */
  deadAnteBB?: () => number;
}

export interface RaiseDefencePending {
  readonly kind: RaiseDefenceKind;
  /** The v1 price (spots the solved tables do not cover); null when the anchored price answered. */
  readonly verdict: RaiseDefenceVerdict | null;
  /** The v2 equilibrium-anchored answer (with its mix, draw and model), null when v1 answered. */
  readonly anchored: AnchoredVerdict | null;
  readonly anchoredNode: AnchoredNode | null;
  /** The answer's shape (fold, call, all_in, raise) and, for a raise, its street total. */
  readonly shape: 'fold' | 'call' | 'all_in' | 'raise';
  readonly raiseTo: number | null;
  /** The street total that puts in every chip that can be matched (min of the Horse's and the deepest live opponent's). */
  readonly allInTo: number;
}
let pending: RaiseDefencePending | null = null;
/** Cleared when a decision starts (HorseLogic). */
export function clearHoldemRaiseDefencePending(): void {
  pending = null;
}
/** The priced verdict of the last decision, for receipts and tests; read only. */
export function holdemRaiseDefenceOfLastDecision(): RaiseDefencePending | null {
  return pending;
}

/**
 * The decision's class: fold, call, all_in (an all-in, or a raise to every chip that can be matched: the Horse's
 * chips or the most any live opponent has, whichever is less), raise.
 */
const shapeOf = (d: HorseDecision, allInTo: number): string =>
  d.action === 'check'
    ? 'call'
    : (d.action === 'raise' || d.action === 'bet') &&
        Number.isFinite(d.amount) &&
        (d.amount as number) >= allInTo - 1e-9
      ? 'all_in'
      : d.action === 'bet'
        ? 'raise'
        : String(d.action);
const pricedShape = (a: RaiseDefenceVerdict['action']): 'fold' | 'call' | 'all_in' =>
  a === 'shove' ? 'all_in' : a;

/** True when `after` changes the priced answer `before` (the Phase 7 arbiter, Phase 8): the change is refused. */
export function holdemRaiseDefenceReversal(before: HorseDecision, after: HorseDecision): boolean {
  if (!pending) return false;
  const want = pending.shape;
  if (shapeOf(before, pending.allInTo) !== want) return false;
  return (
    shapeOf(after, pending.allInTo) !== want ||
    ((want === 'call' || want === 'raise') && after.amount !== before.amount)
  );
}

/**
 * True when `d` is this decision's priced answer: the blanket rules that run after the reference on every
 * preflop answer (the hold'em premium rules with the dominated 3-bet fold and the commit-under-pot call, the
 * tournament shove discipline) stand aside, so the priced fold, call or shove is the final answer. False with the
 * options off (nothing is pending).
 */
export function holdemRaiseDefenceOwns(d: HorseDecision, tele = false): boolean {
  if (!pending) return false;
  const owns =
    shapeOf(d, pending.allInTo) === pending.shape &&
    (pending.shape !== 'raise' || d.amount === pending.raiseTo);
  if (owns && tele) noteFire('holdem_tournament_raise_defence_blanket_stood_aside_seen');
  return owns;
}

const RAISE_ACTIONS = new Set(['raise', 'bet', 'all_in']);

/** Postflop order: the first dealt seat after the dealer acts first; true when `hero` acts after `other`. */
function actsAfterPostflop(gs: HorseGameStateV2, hero: number, other: number): boolean {
  const seats = (gs.dealtSeatIds ?? gs.players.map((p) => p.seat)).slice().sort((a, b) => a - b);
  const d = gs.dealerSeat;
  if (d === undefined || !seats.includes(d)) return false;
  const rank = (s: number) => {
    const i = seats.indexOf(s);
    const di = seats.indexOf(d);
    return (i - di - 1 + seats.length) % seats.length;
  };
  return rank(hero) > rank(other);
}

/** The read scale of one statistic: his posterior mean over the population's, only where the read is engaged. */
function readScale(
  read: OpponentExploitRead | null,
  variant: string | undefined,
  stat: 'rfi' | 'threeBet' | 'foldTo3Bet'
): number | null {
  if (!read) return null;
  const s = read.stats[stat];
  if (!s || s.engaged === null) return null;
  const env = exploitEnvelopeFor(read.scope, variant)?.[stat];
  if (!env || !(env.mean > 0)) return null;
  return s.mean / env.mean;
}

export function holdemRaiseDefenceReference(
  decision: HorseDecision,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  opts: HorseDecideOpts,
  tele: boolean,
  host: RaiseDefenceHost
): HorseDecision {
  const onHu = opts.holdemTournamentHeadsUpBigBlindDefenceIsPriced === true;
  const onBlind = opts.holdemTournamentBlindDefenceIsPriced === true;
  const onCommitted = opts.holdemTournamentCommittedRaiseIsPriced === true;
  if (!onHu && !onBlind && !onCommitted) return decision;
  if (gs.stage !== 'preflop' || !host.inScope || gs.allInOrFold === true) return decision;
  const bb = gs.bigBlind;
  if (!(bb > 0) || player.cards.length !== 2) return decision;
  const toCall = Math.max(0, gs.currentBet - player.bet);
  if (!(toCall > 0) || toCall >= player.stack) return decision;
  const history = (gs.actionHistory ?? [])
    .filter((a) => a.stage === 'preflop')
    .map((a) => ({ seat: a.seat, action: String(a.action), amount: Number(a.amount) || 0 }));
  // The raises, in order.
  let level = bb;
  const raises: Array<{ seat: number; amount: number }> = [];
  for (const a of history)
    if (RAISE_ACTIONS.has(a.action) && a.amount > level + 1e-9) {
      level = a.amount;
      raises.push({ seat: a.seat, amount: a.amount });
    }
  if (raises.length === 0) return decision;
  const raiserSeat = raises[raises.length - 1].seat;
  if (raiserSeat === player.seat) return decision;
  const raiser = gs.players.find((p) => p.seat === raiserSeat);
  if (!raiser || raiser.is_folded || raiser.is_all_in === true) return decision;
  if (!(raiser.bet >= gs.currentBet - 1e-9)) return decision;
  const allInSeats = new Set(gs.players.filter((p) => p.is_all_in === true).map((p) => p.seat));
  const roles = preflopRoles(history, allInSeats, bb);
  const others = gs.players.filter(
    (p) =>
      p.seat !== player.seat && p.seat !== raiserSeat && !p.is_folded && p.is_sitting_out !== true
  );
  // A heads-up pot: nobody else has called, limped or raised and is still in.
  if (others.some((p) => p.is_all_in === true || roles.has(p.seat))) return decision;
  const behind = others.filter((p) => p.bet < gs.currentBet - 1e-9);
  const heroRaised = raises.some((r) => r.seat === player.seat);
  const heroActed = roles.has(player.seat);
  const legal = Array.isArray(gs.legalActions) ? gs.legalActions : null;
  const canCall = !legal || legal.includes('call');
  const canShove = !legal || legal.includes('all_in');
  if (!canCall && !canShove) return decision;
  const heroTotal = player.stack + player.bet;
  const raiserTotal = raiser.stack + raiser.bet;
  const effBB = Math.min(heroTotal, raiserTotal) / bb;
  const committed = isCommitted({
    behindAfterCall: player.stack - toCall,
    potAfterCall: (gs.pot ?? 0) + toCall,
    raiseTo: raiser.bet,
    chipsAtStreetStart: heroTotal,
  });
  const blinds = gs.blindSeats as { smallBlind?: number; bigBlind?: number } | undefined;
  const heroBlind = player.seat === blinds?.smallBlind || player.seat === blinds?.bigBlind;
  let kind: RaiseDefenceKind | null = null;
  if (raises.length === 1 && !heroActed && host.dealt === 2 && player.seat === blinds?.bigBlind) {
    if (onHu && effBB <= RAISE_DEFENCE_BLIND_MAX_BB) kind = 'hu_bb';
  } else if (raises.length === 1 && !heroActed && host.dealt >= 3 && heroBlind) {
    if (onBlind && effBB <= RAISE_DEFENCE_BLIND_MAX_BB) kind = 'blind_defence';
  } else if (heroRaised && raises.length >= 2) {
    if (onCommitted && effBB <= RAISE_DEFENCE_RERAISE_MAX_BB) kind = 'reraise';
  }
  if (kind === null && committed && onCommitted) kind = 'committed';
  if (kind === null) return decision;
  const deepestLive = Math.max(raiserTotal, ...others.map((p) => p.stack + p.bet));
  const allInTo = Math.min(heroTotal, deepestLive);
  const thinkTime = decision.thinkTime;
  // v2: the nodes the solved tables cover.
  // A raise that commits the Horse is answered by the v1 price, which prices that call as the all-in it is.
  const anchoredNode: AnchoredNode | null = committed
    ? null
    : kind === 'hu_bb' || kind === 'blind_defence'
      ? 'd_vs_open'
      : kind === 'reraise' && raises.length === 2 && raises[0].seat === player.seat
        ? 'o_vs_3bet'
        : kind === 'reraise' && raises.length === 3 && raises[1].seat === player.seat
          ? 'd_vs_4bet'
          : null;
  if (anchoredNode !== null) {
    const res = anchoredAnswer(anchoredNode, {
      decision,
      player,
      gs,
      opts,
      host,
      raises,
      raiser,
      behindCount: behind.length,
      effBB,
      canCall,
      canShove,
      allInTo,
    });
    if (res) {
      const { verdict, shape, raiseTo } = res;
      pending = {
        kind,
        verdict: null,
        anchored: verdict,
        anchoredNode,
        shape,
        raiseTo,
        allInTo,
      };
      attributeToOwner(host);
      const changed =
        shapeOf(decision, allInTo) !== shape ||
        ((shape === 'call' || shape === 'raise') &&
          decision.amount !== (shape === 'call' ? toCall : raiseTo));
      if (tele) {
        if (kind === 'hu_bb') noteFire('holdem_tournament_raise_defence_hu_bb_priced_seen');
        else if (kind === 'blind_defence')
          noteFire('holdem_tournament_raise_defence_blind_defence_priced_seen');
        else noteFire('holdem_tournament_raise_defence_committed_raise_priced_seen');
        if (shape === 'fold') noteFire('holdem_tournament_raise_defence_fold_seen');
        else if (shape === 'call') noteFire('holdem_tournament_raise_defence_call_seen');
        else if (shape === 'raise') noteFire('holdem_tournament_raise_defence_reraise_seen');
        else noteFire('holdem_tournament_raise_defence_shove_seen');
        if (verdict.committed && shape === 'call')
          noteFire('holdem_tournament_raise_defence_committed_seen');
        if (verdict.played.filter((x) => x > 0).length > 1)
          noteFire('holdem_tournament_raise_defence_mixed_seen');
        if (verdict.played.some((x, i) => Math.abs(x - verdict.mix[i]) > 1e-9))
          noteFire('holdem_tournament_raise_defence_moved_seen');
        if (changed) noteFire('holdem_tournament_raise_defence_changed_seen');
      }
      if (!changed) return decision;
      if (shape === 'fold') return { action: 'fold', thinkTime };
      if (shape === 'call') return { action: 'call', amount: toCall, thinkTime };
      if (shape === 'raise') return { action: 'raise', amount: raiseTo as number, thinkTime };
      return { action: 'all_in', thinkTime };
    }
    if (tele) noteFire('holdem_tournament_raise_defence_unpriced_seen');
    return decision;
  }
  // The raiser's role and range.
  const raiseIndex = raises.length;
  const role: RaiserRole = raiseIndex === 1 ? 'open' : raiseIndex === 2 ? 'three_bet' : 'four_bet';
  const maxOther = Math.max(
    ...gs.players.filter((p) => p.seat !== raiserSeat).map((p) => p.stack + p.bet)
  );
  const raiserDepthBB = Math.min(raiserTotal, maxOther) / bb;
  const openerSeat = raises[0].seat;
  const raiserBehind = host.playersBehind(role === 'three_bet' ? raiserSeat : openerSeat) ?? 1;
  let read: OpponentExploitRead | null = null;
  if (opts.mind !== false) {
    try {
      read = host.read(raiser.user_id);
    } catch {
      read = null;
    }
  }
  let model = raiserModel({
    role,
    depthBB: raiserDepthBB,
    dealt: host.dealt,
    raiserBehind,
    widthScale: readScale(read, gs.gameVariant, role === 'three_bet' ? 'threeBet' : 'rfi'),
    foldScale: role === 'four_bet' ? null : readScale(read, gs.gameVariant, 'foldTo3Bet'),
  });
  // A raise that commits the Horse is the jam it amounts to: its range is the range of that jam in the solved tables
  // (the range the all-in call price reads for the jam with these options on), so the Horse answers the committing
  // raise as it answers the jam.
  if (committed && raises.length >= 2 && raises.length <= 4) {
    const jammerIsDefender = raises.length !== 3;
    const defenderSeat = jammerIsDefender ? raiserSeat : raises[1].seat;
    const solved = solvedJamRange({
      dealt: host.dealt,
      raiseIndex: raises.length,
      openerBehind: host.playersBehind(openerSeat) ?? 1,
      defender: defenderSeat === blinds?.bigBlind ? 'bb' : 'sb',
      depthBB: effBB,
      openBB: raises[0].amount / bb,
      anteBB: host.deadAnteBB ? host.deadAnteBB() : 0,
    });
    if (solved && holdemRangeWidth(solved) > 1e-6)
      model = { ...model, range: solved, width: holdemRangeWidth(solved) };
  }
  const verdict = priceRaiseDefence({
    hero: player.cards as Card[],
    bb,
    pot: gs.pot ?? 0,
    heroStack: player.stack,
    heroBet: player.bet,
    raiserStack: raiser.stack,
    raiserBet: raiser.bet,
    heroInPosition: actsAfterPostflop(gs, player.seat, raiserSeat),
    raiser: model,
    behind: behind.map((p) => ({ total: p.stack + p.bet, bet: p.bet })),
    bubbleFactor: host.bubbleFactor(Math.min(heroTotal, raiserTotal)) ?? 1,
    canCall,
    canShove,
  });
  if (!verdict) {
    if (tele) noteFire('holdem_tournament_raise_defence_unpriced_seen');
    return decision;
  }
  pending = {
    kind,
    verdict,
    anchored: null,
    anchoredNode: null,
    shape: pricedShape(verdict.action),
    raiseTo: null,
    allInTo,
  };
  attributeToOwner(host);
  const want = pricedShape(verdict.action);
  const changed = shapeOf(decision, allInTo) !== want;
  if (tele) {
    // Literal keys: the ledger contract finds each receipt by its noteFire call.
    if (kind === 'hu_bb') noteFire('holdem_tournament_raise_defence_hu_bb_priced_seen');
    else if (kind === 'blind_defence')
      noteFire('holdem_tournament_raise_defence_blind_defence_priced_seen');
    else noteFire('holdem_tournament_raise_defence_committed_raise_priced_seen');
    if (verdict.action === 'fold') noteFire('holdem_tournament_raise_defence_fold_seen');
    else if (verdict.action === 'call') noteFire('holdem_tournament_raise_defence_call_seen');
    else noteFire('holdem_tournament_raise_defence_shove_seen');
    if (verdict.committed) noteFire('holdem_tournament_raise_defence_committed_seen');
    if (changed) noteFire('holdem_tournament_raise_defence_changed_seen');
  }
  if (verdict.action === 'fold') return changed ? { action: 'fold', thinkTime } : decision;
  if (verdict.action === 'call')
    return changed || decision.amount !== toCall
      ? { action: 'call', amount: toCall, thinkTime }
      : decision;
  return changed ? { action: 'all_in', thinkTime } : decision;
}

/**
 * The priced answer is the reference's own: a named route's attribution (a chart or a variant price) no longer
 * describes it, so the active preflop reference owner takes it (the receipt check admits that owner's answers).
 */
function attributeToOwner(host: RaiseDefenceHost): void {
  const ref = host.phase6Ref;
  if (
    ref &&
    (ref.route === 'chart_open_jam' ||
      ref.route === 'chart_bb_defend' ||
      ref.route === 'variant_price')
  ) {
    ref.route = host.ownerRoute;
    ref.lookup = null;
  }
}

/** Price bucket centres of the priors (the caller's required equity: <30%, 30-35, 35-40, 40-45, 45%+). */
const PRICE_CENTRES: readonly number[] = [0.25, 0.325, 0.375, 0.425, 0.5];

/** A prior row read at x (linear between centres, flat outside), with the opportunities of the nearer cell. */
function measuredAt(
  cells: readonly PriorCell[],
  centres: readonly number[],
  x: number
): MeasuredRate {
  const v = Number.isFinite(x) ? x : centres[0];
  if (v <= centres[0]) return { p: cells[0].p, n: cells[0].n };
  for (let i = 1; i < centres.length; i++)
    if (v <= centres[i]) {
      const t = (v - centres[i - 1]) / (centres[i] - centres[i - 1]);
      return {
        p: cells[i - 1].p + t * (cells[i].p - cells[i - 1].p),
        n: t < 0.5 ? cells[i - 1].n : cells[i].n,
      };
    }
  const last = cells[cells.length - 1];
  return { p: last.p, n: last.n };
}

/** His own record of one statistic: posterior mean over the population's, and its decayed opportunities. */
function ownRecord(
  read: OpponentExploitRead | null,
  variant: string | undefined,
  stat: 'rfi' | 'threeBet' | 'foldTo3Bet'
): { ratio: number | null; n: number } {
  if (!read) return { ratio: null, n: 0 };
  const s = read.stats[stat];
  const env = exploitEnvelopeFor(read.scope, variant)?.[stat];
  if (!s || !env || !(env.mean > 0) || !(s.n > 0) || !Number.isFinite(s.mean))
    return { ratio: null, n: 0 };
  return { ratio: s.mean / env.mean, n: s.n };
}

function anchoredAnswer(
  node: AnchoredNode,
  a: {
    decision: HorseDecision;
    player: SeatPlayer;
    gs: HorseGameStateV2;
    opts: HorseDecideOpts;
    host: RaiseDefenceHost;
    raises: ReadonlyArray<{ seat: number; amount: number }>;
    raiser: SeatPlayer;
    behindCount: number;
    effBB: number;
    canCall: boolean;
    canShove: boolean;
    allInTo: number;
  }
): {
  verdict: AnchoredVerdict;
  shape: 'fold' | 'call' | 'all_in' | 'raise';
  raiseTo: number | null;
} | null {
  const { player, gs, host, raises, raiser } = a;
  const bb = gs.bigBlind;
  const blinds = gs.blindSeats as { smallBlind?: number; bigBlind?: number } | undefined;
  const openerSeat = raises[0].seat;
  const defenderSeat = node === 'o_vs_3bet' ? raiser.seat : player.seat;
  const side: 'sb' | 'bb' = defenderSeat === blinds?.bigBlind ? 'bb' : 'sb';
  const openerBehind = host.playersBehind(openerSeat) ?? 1;
  const kindKey = solvedKind(host.dealt, openerBehind, side);
  const anteBB = host.deadAnteBB ? host.deadAnteBB() : 0;
  const query = { kind: kindKey, depthBB: a.effBB, openBB: raises[0].amount / bb, anteBB };
  let read: OpponentExploitRead | null = null;
  if (a.opts.mind !== false) {
    try {
      read = host.read(raiser.user_id);
    } catch {
      read = null;
    }
  }
  const P = HOLDEM_TOURNAMENT_RAISE_DEFENCE_PRIORS;
  const heroTotal = player.stack + player.bet;
  const raiserTotal = raiser.stack + raiser.bet;
  const matched = Math.min(heroTotal, raiserTotal);
  const Ah = Math.max(0, matched - player.bet);
  const Ar = Math.max(0, matched - raiser.bet);
  const pot = gs.pot ?? 0;
  const price = Ar > 0 ? Ar / (pot + Ah + Ar) : 0.5;
  let popFold: MeasuredRate | null = null;
  // The population's raise width is not used (see HorseHoldemTournamentRaiseDefenceAnchored: the solved range is
  // often a sliver of least-losing hands a width cannot reshape); his own record's width is.
  const popWidth: MeasuredRate | null = null;
  let own = {
    foldRatio: null as number | null,
    foldN: 0,
    widthRatio: null as number | null,
    widthN: 0,
  };
  if (node === 'd_vs_open') {
    popFold = measuredAt(P.openFoldToJam[host.dealt <= 2 ? 'hu' : 'ring'], PRICE_CENTRES, price);
    const f = ownRecord(read, gs.gameVariant, 'foldTo3Bet');
    const w = ownRecord(read, gs.gameVariant, 'rfi');
    own = { foldRatio: f.ratio, foldN: f.n, widthRatio: w.ratio, widthN: w.n };
  } else if (node === 'o_vs_3bet') {
    popFold = measuredAt(P.threeBetFoldToJam, PRICE_CENTRES, price);
    const w = ownRecord(read, gs.gameVariant, 'threeBet');
    own = { foldRatio: null, foldN: 0, widthRatio: w.ratio, widthN: w.n };
  }
  const legal = Array.isArray(gs.legalActions) ? gs.legalActions : null;
  // The non-all-in re-raise the solution mixes in, at the solved multiple of the raise faced.
  const G = { threeBetX: 3, fourBetX: 2.2 };
  const faced = raises[raises.length - 1].amount;
  let raiseTo: number | null =
    node === 'd_vs_open' ? G.threeBetX * faced : node === 'o_vs_3bet' ? G.fourBetX * faced : null;
  if (raiseTo !== null) {
    const minTo = Number(gs.minRaiseTo ?? 0);
    raiseTo = Math.max(raiseTo, Number.isFinite(minTo) ? minTo : 0);
    raiseTo = Math.round(raiseTo);
    if (!(raiseTo < a.allInTo - 1e-9)) raiseTo = null;
  }
  const verdict = priceAnchoredDefence({
    node,
    query,
    hero: player.cards as Card[],
    bb,
    pot,
    heroStack: player.stack,
    heroBet: player.bet,
    oppStack: raiser.stack,
    oppBet: raiser.bet,
    behind: a.behindCount,
    bubbleFactor: host.bubbleFactor(matched) ?? 1,
    legal: {
      call: a.canCall,
      jam: a.canShove,
      raise: raiseTo !== null && (!legal || legal.includes('raise')),
    },
    population: { fold: popFold, width: popWidth },
    own,
    seedParts: [
      player.cards.map((c) => `${c.rank}${c.suit}`).join(''),
      player.seat,
      pot,
      gs.currentBet,
      player.stack,
      raiser.stack,
      raiser.bet,
    ],
  });
  if (!verdict) return null;
  const shape: 'fold' | 'call' | 'all_in' | 'raise' =
    verdict.action === 'fold'
      ? 'fold'
      : verdict.action === 'call'
        ? 'call'
        : verdict.action === 'jam'
          ? 'all_in'
          : 'raise';
  return { verdict, shape, raiseTo: shape === 'raise' ? raiseTo : null };
}
