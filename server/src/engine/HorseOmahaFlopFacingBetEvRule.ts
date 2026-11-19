/**
 * omahaFlopFacingBetEv (PLO Strategy lane 2026-11-17; default OFF, read
 * `=== true`): the rule that applies the flop facing-bet verdict of
 * HorseOmahaFlopFacingBetEv.ts.
 *
 * WHERE IT RUNS. HorseLogic.omahaFacingBetEvRule hands it every flop
 * decision when the option is on: the place of the turn and river rule,
 * outermost of the call-discipline rules on both decision paths. It reads
 * the answer of everything before it only to know whether today's brain
 * folded, called or raised.
 *
 * PRECEDENCE on the flop, in the spot the verdict covers (PLO4/PLO5 cash, one
 * board, high only, facing a bet or a raise):
 *  - a fold or a call (the whole-stack call included) is replaced by the
 *    verdict. So the paired-board fold (HorsePloPairedBoardFold: a call of a
 *    quarter of the stack below a full house), its price exception, the
 *    reference brain's own fold or call (which reads the 20 big blind
 *    big-bet mark) and the flop call-discipline folds before it are inputs
 *    here, no longer the deciders;
 *  - a raise is left alone: the raise rules own it. A raise the paired-board
 *    fold already folded arrives as a fold and gets the verdict;
 *  - it stands aside for the bare-overpair continuation
 *    (omahaBareOverpairOopFlopCheck on, HorseOmahaOopChecks): that owner-ruled
 *    spot has its own priced verdict;
 *  - outside the spot, when the hand cannot be sampled, or on any failure
 *    (receipt omaha_strategy_rule_failed) the decision it was given stands:
 *    the rules above decide exactly as with the option off.
 * Later rules still see its answer: the draw and strong-hand raise rules may
 * raise a call, as on the later streets.
 *
 * The player read is public and is the turn and river read
 * (HorseMind.omahaFacingBetEvReadOf): with the mind off, or no row for the
 * bettor, the population prior decides.
 *
 * omahaFlopVerdictReadsTheBettor (2026-11-19, default OFF): the verdict also
 * reads THIS bettor's durable street record (HorseMind.omahaStreetReadOf):
 * how often he bets this flop texture on this line and how often he bets the
 * turn and the river, each beside players of his kind and each moved from
 * the kind's figure in proportion to his sample (HorseOmahaFlopBettorRead).
 * With no record for him, the mind off or a kind the decision does not know,
 * the verdict is exactly the one above.
 *
 * Receipts: omaha_flop_facing_bet_ev_call / _fold (the verdict, every time it
 * answers) and omaha_flop_facing_bet_ev_changed when it differs from the
 * answer it was given; the rule it replaced is the legacy receipt fired in
 * the same decision (plo_paired_board_fold, ...). With
 * omahaFlopVerdictReadsTheBettor on, omaha_flop_verdict_read_the_bettor when
 * the verdict that answered used a record of the bettor.
 */
import type { HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { noteFire } from './BrainTelemetry.js';
import { HorseMind } from './HorseMind.js';
import type { OmahaFacingBetEvRead } from './HorseOmahaFacingBetEv.js';
import {
  omahaFlopFacingBetEvSpot,
  omahaFlopFacingBetEvVerdict,
  type OmahaFlopFacingBetEvSpot,
  type OmahaFlopFacingBetEvVerdict,
} from './HorseOmahaFlopFacingBetEv.js';
import {
  omahaFlopBettorIsPreflopAggressor,
  omahaFlopBettorRead,
  type OmahaFlopBettorRead,
} from './HorseOmahaFlopBettorRead.js';
import { omahaBareOverpairFlopFacingBetSpot } from './HorseOmahaOopChecks.js';
import { omahaOpponentKindOf } from './HorseOmahaPricedMode.js';
import { flopTextureOf } from './HorseOmahaStreetRead.js';

/** What HorseLogic hands the rule: its own reading of the decision's options and seats. */
export interface OmahaFlopFacingBetEvRuleContext {
  /** the opponent memory may be read (opts.mind !== false) */
  mind: boolean;
  /** receipts fire (telemetryOn(opts)) */
  telemetry: boolean;
  /** the marginal rake on the pot, as a fraction */
  rake: number;
  /** the Horse acts last after the flop */
  inPosition: boolean;
  /** omahaBareOverpairOopFlopCheck is on: its continuation owns its own spot */
  bareOverpairContinuation: boolean;
  /** omahaFlopVerdictReadsTheBettor is on: the verdict reads the bettor's street record */
  readsTheBettor?: boolean;
}

export interface OmahaFlopFacingBetEvAnswer {
  spot: OmahaFlopFacingBetEvSpot;
  verdict: OmahaFlopFacingBetEvVerdict;
  /** omahaFlopVerdictReadsTheBettor only: the bettor's read the verdict used (absent when there was none) */
  bettor?: OmahaFlopBettorRead;
}

/**
 * The flop spot and its verdict against the bettor's public read, or null
 * where the rule does not answer (outside the spot, the bare-overpair
 * continuation's spot, a hand that cannot be sampled). It does not depend on
 * the decision it will judge.
 */
export function omahaFlopFacingBetEvAnswer(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  ctx: OmahaFlopFacingBetEvRuleContext
): OmahaFlopFacingBetEvAnswer | null {
  const spot = omahaFlopFacingBetEvSpot(player, gs);
  if (!spot) return null;
  if (ctx.bareOverpairContinuation && omahaBareOverpairFlopFacingBetSpot(player, gs) !== null)
    return null;
  let read: OmahaFacingBetEvRead | null = null;
  let bettorRead: OmahaFlopBettorRead | null = null;
  if (ctx.mind) {
    const bettor = (gs.players ?? []).find((p) => p.seat === spot.bettorSeat);
    try {
      // The read has no flop row of its own: the pooled postflop read of the
      // turn is the one asked (no shown-down size cell is read off the river).
      read = bettor
        ? HorseMind.omahaFacingBetEvReadOf(bettor.user_id, 'turn', spot.potFrac, spot.isRaise)
        : null;
    } catch {
      read = null;
    }
    if (ctx.readsTheBettor === true && bettor) {
      try {
        const texture = flopTextureOf(gs.communityCards);
        bettorRead = omahaFlopBettorRead(
          HorseMind.omahaStreetReadOf(bettor.user_id, texture)?.counters ?? null,
          omahaOpponentKindOf(gs, bettor.user_id),
          texture,
          spot.isRaise
            ? null
            : omahaFlopBettorIsPreflopAggressor(gs.actionHistory, spot.bettorSeat)
              ? 'cbet'
              : 'flopBet',
          spot.valueShare + spot.priorBluff
        );
      } catch {
        bettorRead = null;
      }
    }
  }
  const verdict = omahaFlopFacingBetEvVerdict(
    spot,
    player.cards ?? [],
    gs.communityCards ?? [],
    player.knownDeadCards ?? [],
    read,
    bettorRead
      ? {
          rake: ctx.rake,
          inPosition: ctx.inPosition,
          bettor: {
            rangeFactor: bettorRead.rangeFactor,
            laterBetFactor: bettorRead.laterBetFactor,
          },
        }
      : { rake: ctx.rake, inPosition: ctx.inPosition }
  );
  if (!verdict) return null;
  return bettorRead ? { spot, verdict, bettor: bettorRead } : { spot, verdict };
}

/** The rule: a flop fold or call in the covered spot becomes the verdict. */
export function omahaFlopFacingBetEvRule(
  decision: HorseDecision,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  ctx: OmahaFlopFacingBetEvRuleContext
): HorseDecision {
  try {
    if (gs.stage !== 'flop') return decision;
    const stack = Number.isFinite(player.stack) ? Math.max(0, player.stack) : 0;
    const heroBet = Number.isFinite(player.bet) ? Math.max(0, player.bet ?? 0) : 0;
    const toCall = Number.isFinite(gs.toCall)
      ? Math.max(0, gs.toCall as number)
      : Math.max(0, (gs.currentBet || 0) - heroBet);
    const legacyCall =
      decision.action === 'call' || (decision.action === 'all_in' && stack <= toCall + 0.005);
    if (decision.action !== 'fold' && !legacyCall) return decision;
    const answer = omahaFlopFacingBetEvAnswer(player, gs, ctx);
    if (!answer) return decision;
    const { spot, verdict } = answer;
    if (ctx.telemetry)
      noteFire(verdict.call ? 'omaha_flop_facing_bet_ev_call' : 'omaha_flop_facing_bet_ev_fold');
    if (ctx.telemetry && answer.bettor) noteFire('omaha_flop_verdict_read_the_bettor');
    if (verdict.call === legacyCall) return decision;
    if (ctx.telemetry) noteFire('omaha_flop_facing_bet_ev_changed');
    if (verdict.call) {
      const called: HorseDecision = spot.allIn
        ? { ...decision, action: 'all_in' }
        : { ...decision, action: 'call', amount: spot.paid };
      // the whole-stack call carries no amount key at all
      if (spot.allIn) delete called.amount;
      delete called.continuationGuard;
      return called;
    }
    const folded: HorseDecision = { ...decision, action: 'fold' };
    delete folded.amount;
    return folded;
  } catch {
    if (ctx.telemetry) noteFire('omaha_strategy_rule_failed');
    return decision;
  }
}
