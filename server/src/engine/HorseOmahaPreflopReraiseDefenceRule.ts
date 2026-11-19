/**
 * omahaPreflopReraiseDefencePriced (PLO Strategy lane 2026-11-17; default
 * OFF, read `=== true`): the rule that applies the priced preflop decision of
 * HorseOmahaPreflopReraiseDefence.ts.
 *
 * WHERE IT RUNS. HorseLogic.omahaOopReraisedPotStrongRange hands it the
 * decision first when the option is on: the outermost seat of the preflop
 * re-raise rules on both decision paths, before the re-raise range rules and
 * the out-of-position strong-range rule. Where it answers, those rules do not
 * run for that decision; where it does not (another street, another game, a
 * tournament, a single raise, a hand that cannot be sampled, any failure) it returns null and the
 * rules decide exactly as with the option off.
 *
 * ONE OWNER PER CELL. A call that the re-raised-pot call cell judges
 * (HorseOmahaOopReraisedPot.omahaOopReraisedCallCell: the live implementation
 * of the out-of-position and 4-bet call, kept or folded, and of the call a
 * re-raise range rule hands it) belongs to that cell: HorseLogic does not hand
 * this rule the decision there, and the answer is the one with this option
 * off. This rule answers where that cell does not judge (the reference fold,
 * the in-position call of a 3-bet, the cell switched off or out of scope).
 *
 * WHAT IT CHANGES. Facing a 3-bet or more preflop in PLO4/PLO5 cash the
 * answer it is given (a fold, a call, a re-raise or an all-in) becomes the
 * verdict: fold, call, or the re-raise that was proposed. It never invents a
 * re-raise: a re-raise is a candidate only when the earlier rules proposed
 * one, at their size.
 *
 * THE READ comes through one function, omahaPreflopReraiserReadOf: the pooled
 * read of today (HorseMind.omahaReadConditionalOf for the re-raise rate,
 * HorseMind.opponentRead for the fold rate), each a posterior mean that is
 * the population mean with no evidence. With the mind off, or no row for the
 * player, the population means decide. A per-street read can replace the body
 * of that one function without touching the decision.
 *
 * Receipts: omaha_preflop_reraise_defence_fold / _call / _raise (the verdict,
 * every time it answers) and omaha_preflop_reraise_defence_changed when the
 * verdict differs from the answer it was given.
 */
import type { HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { noteFire } from './BrainTelemetry.js';
import { variantInfo } from './HorseEval.js';
import { HorseMind, readScopeOf } from './HorseMind.js';
import { exploitEnvelopeFor } from './HorseOpponentExploit.js';
import { preflopRaiseCount } from './HorseOmahaReraisedPot.js';
import { omahaIsTournamentMode } from './HorseOmahaTournamentScope.js';
import { omahaOpponentKindOf } from './HorseOmahaPricedMode.js';
import {
  OMAHA_PREFLOP_DEFENCE_VARIANTS,
  omahaPreflopDefenceRake,
  omahaPreflopDefenceVerdict,
  type OmahaPreflopDefenceSpot,
  type OmahaPreflopDefenceVerdict,
  type OmahaPreflopReraiserRead,
} from './HorseOmahaPreflopReraiseDefence.js';

/** What HorseLogic hands the rule: its own reading of the decision's options. */
export interface OmahaPreflopReraiseDefenceContext {
  /** the opponent memory may be read (opts.mind !== false) */
  mind: boolean;
  /** receipts fire (telemetryOn(opts)) */
  telemetry: boolean;
}

/** The population means used when no envelope is recorded for the game (the full-ring PLO5 envelope's own). */
export const PREFLOP_DEFENCE_FALLBACK_RERAISE_RATE = 0.046;
export const PREFLOP_DEFENCE_FALLBACK_FOLD_TO_RERAISE = 0.45;

export interface OmahaPreflopReraiseDefenceSpotFound {
  spot: OmahaPreflopDefenceSpot;
  raiserSeat: number;
  raiserUserId: string;
  /** what the Horse has in on this street */
  heroBet: number;
  /** players dealt in (the read scope's table size) */
  dealt: number;
}

const order = (seat: number, dealerSeat: number | undefined): number => {
  const d = seat - (dealerSeat ?? 0);
  return d <= 0 ? d + 1024 : d;
};

/** The spot at a preflop node where the Horse faces a 3-bet or more in PLO4/PLO5 cash, or null. */
export function omahaPreflopReraiseDefenceSpot(
  player: SeatPlayer,
  gs: HorseGameStateV2
): OmahaPreflopReraiseDefenceSpotFound | null {
  if (String(gs.stage ?? '') !== 'preflop') return null;
  const variant = String(gs.gameVariant ?? '').toLowerCase();
  if (!OMAHA_PREFLOP_DEFENCE_VARIANTS.has(variant)) return null;
  const holeCount = (player.cards ?? []).length;
  if (holeCount !== 4 && holeCount !== 5) return null;
  if (gs.variantRules ? gs.variantRules.splitLow8OrBetter : variantInfo(gs.gameVariant).isHiLo)
    return null;
  if (gs.communityCards2?.length || gs.communityCards3?.length) return null;
  if (gs.bombPot === true || gs.allInOrFold === true) return null;
  if (omahaIsTournamentMode(gs)) return null;
  if (Array.isArray(gs.legalActions) && !gs.legalActions.includes('fold')) return null;
  const history = gs.actionHistory ?? [];
  const preflopRaises = preflopRaiseCount(history);
  if (preflopRaises < 2) return null;
  const stack = Number.isFinite(player.stack) ? Math.max(0, player.stack) : 0;
  const heroBet = Number.isFinite(player.bet) ? Math.max(0, player.bet ?? 0) : 0;
  const toCall = Number.isFinite(gs.toCall)
    ? Math.max(0, gs.toCall as number)
    : Math.max(0, (gs.currentBet || 0) - heroBet);
  if (toCall <= 0.005 || stack <= 0) return null;
  const pot = Number.isFinite(gs.pot) ? Math.max(0, gs.pot) : 0;
  if (!(pot > 0)) return null;
  // The last preflop raiser other than the Horse is the re-raiser faced.
  let raiserSeat = -1;
  for (let k = history.length - 1; k >= 0; k--) {
    const a = history[k]!;
    if (a.stage !== 'preflop' || a.seat === player.seat) continue;
    if (a.action !== 'raise' && a.action !== 'all_in' && a.action !== 'bet') continue;
    raiserSeat = a.seat;
    break;
  }
  const raiser = (gs.players ?? []).find((p) => p.seat === raiserSeat);
  if (!raiser || raiser.is_folded) return null;
  const bb = gs.bigBlind || 1;
  const price = gs.currentBet || 0;
  const live = (gs.players ?? []).filter(
    (p) => p.seat !== player.seat && p.seat !== raiserSeat && !p.is_folded && !p.is_sitting_out
  );
  const inFor = (p: SeatPlayer): boolean =>
    Number.isFinite(p.bet) &&
    ((p.bet ?? 0) >= price - 0.005 || (p.is_all_in === true && (p.bet ?? 0) > bb + 0.005));
  // In for the price: he has called the re-raise (or is all in). Still to act: live, not in for
  // the price. The realization fit measured the two apart (HorseOmahaPreflopReraiseDefence.ts,
  // REALIZATION_OTHER_IN_COST / REALIZATION_BEHIND_COST): an opener a cold caller leaves behind
  // is still to act, not in the pot.
  const othersIn = live.filter((p) => inFor(p)).length;
  const playersBehind = live.filter((p) => !inFor(p) && !p.is_all_in).length;
  const mine = order(player.seat, gs.dealerSeat);
  // In position: after the re-raiser and after every other player already in for the raise.
  const inPosition =
    mine > order(raiserSeat, gs.dealerSeat) &&
    !live.some((p) => inFor(p) && !p.is_all_in && order(p.seat, gs.dealerSeat) > mine);
  const dealt =
    gs.dealtSeatIds !== undefined
      ? gs.dealtSeatIds.length
      : (gs.players ?? []).filter((p) => !p.is_sitting_out || p.is_all_in).length;
  const rakeConfig = gs.rakeConfig;
  return {
    raiserSeat,
    raiserUserId: String(raiser.user_id ?? ''),
    heroBet,
    dealt,
    spot: {
      variant,
      preflopRaises,
      call: Math.min(toCall, stack),
      pot,
      stack,
      raiserBehind: Number.isFinite(raiser.stack) ? Math.max(0, raiser.stack) : 0,
      inPosition,
      othersIn,
      playersBehind,
      bigBlind: bb,
      rake: (size: number) => omahaPreflopDefenceRake(size, bb, rakeConfig, dealt),
    },
  };
}

/**
 * THE ONE READ INTERFACE of the option: what is known of the player who
 * re-raised. Today's pooled read; the population means (the envelope of the
 * game and table size) with the mind off or no row for him.
 */
export function omahaPreflopReraiserReadOf(
  userId: string,
  variant: string,
  dealt: number,
  mind: boolean
): OmahaPreflopReraiserRead {
  let rate = PREFLOP_DEFENCE_FALLBACK_RERAISE_RATE;
  let foldToReraise = PREFLOP_DEFENCE_FALLBACK_FOLD_TO_RERAISE;
  let opportunities = 0;
  try {
    const envelope = exploitEnvelopeFor(readScopeOf(variant, dealt), variant);
    if (envelope) {
      if (Number.isFinite(envelope.threeBet?.mean)) rate = envelope.threeBet.mean;
      if (Number.isFinite(envelope.foldTo3Bet?.mean)) foldToReraise = envelope.foldTo3Bet.mean;
    }
  } catch {
    /* the fallback means stand */
  }
  if (mind && userId) {
    try {
      const cond = HorseMind.omahaReadConditionalOf(userId);
      if (cond && Number.isFinite(cond.threeBet.mean)) {
        rate = cond.threeBet.mean;
        opportunities = Number.isFinite(cond.threeBet.n) ? cond.threeBet.n : 0;
      }
      const fold = HorseMind.opponentRead(userId)?.stats.foldTo3Bet;
      if (fold && Number.isFinite(fold.mean)) foldToReraise = fold.mean;
    } catch {
      /* the population means stand */
    }
  }
  return { rate, opportunities, foldToReraise };
}

/**
 * omahaPreflopReraiseDefencePricedInPosition (THREEBET-2 lane 2026-11-19; default OFF, read `=== true`): the one spot
 * where the companion option hands the decision to this rule. True only when ALL hold:
 *   - the spot of omahaPreflopReraiseDefenceSpot (PLO4/PLO5 cash, high only, one board, preflop, no bomb pot, no
 *     All-In-Or-Fold, not a tournament, fold legal, chips to call);
 *   - exactly two preflop raises: the first is the Horse's (it opened; a raise over limpers who then folded counts as
 *     the first raise), the second is the player it faces (one 3-bet, no 4-bet, nothing else);
 *   - that player is a person (omahaOpponentKindOf: gs.humanUserIds, else his seat's is_horse; unknown = not the spot);
 *   - heads-up: every other player has folded (a player still in, all in included, ends the spot);
 *   - POSITION, ONE DEFINITION for every table kind (table cash and fast-table cash alike): the Horse acts after the
 *     3-bettor on every later street (seat order from the dealer, the small blind first, the dealer last). Heads-up
 *     this is also what omahaReraisedPositionOf.ipVsRaiser and the older reading kept for fast tables and
 *     tournaments (omahaReraisedLaneUntouched) give, because nobody else is in the pot; the spot reads none of them.
 * The price reads the 3-bettor's own measured re-raise rate (the population mean with no evidence); nothing is keyed
 * to one player's account. In the spot the option only ever turns a fold into the priced call (HorseLogic).
 * Everything else (out of position, multiway, a 4-bet, a cold 3-bet, a Horse that did not open) is false, and the
 * decision is exactly the one with the option off.
 */
export function omahaPreflopReraiseDefenceHeadsUpInPosition(
  player: SeatPlayer,
  gs: HorseGameStateV2
): boolean {
  try {
    const found = omahaPreflopReraiseDefenceSpot(player, gs);
    if (!found || found.spot.preflopRaises !== 2) return false;
    const raises = (gs.actionHistory ?? []).filter(
      (a) =>
        a.stage === 'preflop' &&
        (a.action === 'raise' ||
          a.action === 'bet' ||
          (a.action === 'all_in' && a.isFullRaise !== undefined))
    );
    if (raises.length !== 2) return false;
    if (raises[0]!.seat !== player.seat || raises[1]!.seat !== found.raiserSeat) return false;
    const othersInHand = (gs.players ?? []).filter(
      (p) =>
        p.seat !== player.seat &&
        p.seat !== found.raiserSeat &&
        !p.is_folded &&
        (!p.is_sitting_out || p.is_all_in === true)
    );
    if (othersInHand.length > 0) return false;
    // F2: the 3-bettor is a person (the engine's roster, gs.humanUserIds, else the seat's is_horse flag); unknown is
    // not the spot. The finding and its evaluation are a person's 3-bets.
    if (omahaOpponentKindOf(gs, found.raiserUserId) !== 'person') return false;
    return order(player.seat, gs.dealerSeat) > order(found.raiserSeat, gs.dealerSeat);
  } catch {
    return false;
  }
}

export interface OmahaPreflopReraiseDefenceAnswer {
  found: OmahaPreflopReraiseDefenceSpotFound;
  verdict: OmahaPreflopDefenceVerdict;
}

/** The spot and its verdict, or null where the rule does not answer. `risk` is the proposed re-raise's added chips. */
export function omahaPreflopReraiseDefenceAnswer(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  ctx: Pick<OmahaPreflopReraiseDefenceContext, 'mind'>,
  risk: number | null
): OmahaPreflopReraiseDefenceAnswer | null {
  const found = omahaPreflopReraiseDefenceSpot(player, gs);
  if (!found) return null;
  const hole = player.cards ?? [];
  const read = omahaPreflopReraiserReadOf(
    found.raiserUserId,
    found.spot.variant,
    found.dealt,
    ctx.mind
  );
  const verdict = omahaPreflopDefenceVerdict(
    found.spot,
    hole,
    player.knownDeadCards ?? [],
    read,
    risk !== null ? { risk } : null
  );
  return verdict ? { found, verdict } : null;
}

const cents = (x: number): number => Math.round(x * 100) / 100;

/**
 * The rule. Null: it does not answer and the earlier rules decide. Otherwise
 * the decision to play: the one it was given when the verdict agrees, else
 * the verdict's fold or call.
 */
export function omahaPreflopReraiseDefenceRule(
  decision: HorseDecision,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  ctx: OmahaPreflopReraiseDefenceContext
): HorseDecision | null {
  try {
    if (String(gs.stage ?? '') !== 'preflop') return null;
    const given = decision.action;
    if (given !== 'fold' && given !== 'call' && given !== 'raise' && given !== 'all_in')
      return null;
    const found = omahaPreflopReraiseDefenceSpot(player, gs);
    if (!found) return null;
    const { spot, heroBet } = found;
    const callIsAllIn = spot.stack <= spot.call + 0.005;
    // What the answer it was given is, in the verdict's terms.
    const givenRaise = given === 'raise' || (given === 'all_in' && !callIsAllIn);
    let risk: number | null = null;
    if (givenRaise) {
      const to = given === 'all_in' ? heroBet + spot.stack : Number(decision.amount);
      if (!Number.isFinite(to)) return null;
      risk = Math.min(spot.stack, Math.max(0, to - heroBet));
      if (!(risk > spot.call + 0.005)) risk = null;
    }
    const givenKind: 'fold' | 'call' | 'raise' =
      given === 'fold' ? 'fold' : risk !== null ? 'raise' : 'call';
    const answer = omahaPreflopReraiseDefenceAnswer(player, gs, ctx, risk);
    if (!answer) return null;
    const verdict = answer.verdict.action;
    if (ctx.telemetry) noteFire(`omaha_preflop_reraise_defence_${verdict}`);
    if (verdict === givenKind) return decision;
    if (ctx.telemetry) noteFire('omaha_preflop_reraise_defence_changed');
    if (verdict === 'fold') {
      const folded: HorseDecision = { ...decision, action: 'fold' };
      delete folded.amount;
      return folded;
    }
    // A call (a re-raise verdict only ever equals a proposed re-raise).
    const called: HorseDecision = callIsAllIn
      ? { ...decision, action: 'all_in' }
      : { ...decision, action: 'call', amount: cents(spot.call) };
    if (callIsAllIn) delete called.amount;
    delete called.continuationGuard;
    return called;
  } catch {
    if (ctx.telemetry) noteFire('omaha_strategy_rule_failed');
    return null;
  }
}

/**
 * Receipt validation (no options and no opponent memory in the request): a
 * fold or a re-raise that became a call preflop is admitted only in the spot
 * the rule covers and only for the exact chips the call puts in (the
 * whole-stack call is an all-in, a wager action).
 */
export function omahaPreflopReraiseDefenceAdmitsCall(
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  amount: number | null | undefined
): boolean {
  try {
    const found = omahaPreflopReraiseDefenceSpot(hero, gs);
    if (!found) return false;
    const { spot } = found;
    if (spot.stack <= spot.call + 0.005) return false;
    return typeof amount === 'number' && Math.abs(cents(spot.call) - amount) <= 0.005;
  } catch {
    return false;
  }
}
