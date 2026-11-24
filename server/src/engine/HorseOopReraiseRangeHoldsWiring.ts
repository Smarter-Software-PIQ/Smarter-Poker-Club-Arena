/**
 * WIRING of the out-of-position 3-bet range rule (HorseOopReraiseRangeHolds.ts; options
 * omahaOopReraiseRangeHoldsVsReraise and holdemOopReraiseRangeHoldsVsReraise, each default OFF, read `=== true`).
 *
 * HorseLogic has two thin hooks:
 *  - the top of HorseLogic.decide routes an in-scope decision (option on for the game, the public spot holds) through
 *    oopReraiseRangeHoldsDecide;
 *  - one wager_rules stage (and its outside-the-graph twin), oopReraiseRangeHoldsStage, the slot after
 *    holdem_premium_aggression.
 *
 * oopReraiseRangeHoldsDecide:
 *  1. asks the decision as it is (pass 1). The stage, in its COLLECT mode, takes the rule's inputs where the decision
 *     is an out-of-position 3-bet in scope (the opener's measured fold to a 3-bet, his open band, whether the existing
 *     calling rule admits the call, the deduction), inside the decision's own read scope. Any other decision is
 *     returned exactly as asked (no other draw, no other read).
 *  2. asks the Horse's OWN answer to the 4-bet on the public 4-bet frame (oopReraiseFourBetFrame): a side ask with both
 *     options off, no learning (observeMind false), its intent writes discarded, its style records and counters kept
 *     out, and the strategy, size and timing streams put back where pass 1 left them.
 *  3. prices the 3-bet (oopReraiseVerdict). Kept: pass 1's decision, with the receipt. Rejected: the decision is asked
 *     again from the same stream position (pass 3) with the stage in its APPLY mode, which turns that raise into the
 *     call or the fold inside wager_rules, so the policy graph records the change as its own stage; pass 3 counts no
 *     counter (pass 1 counted the decision once) and the receipts of the rule are counted here.
 * With both options off nothing here runs: HorseLogic never enters the route and the stage returns its input.
 */
import type { Card, HorseDecision, SeatPlayer } from '../types.js';
import { noteFire, telemetryOn, withBrainTelemetrySuspended } from './BrainTelemetry.js';
import { restoreFastRandom, saveFastRandom } from './HorseEval.js';
import { HorseMind } from './HorseMind.js';
import { omahaDowngradedThreeBetCalls } from './HorseOmahaOopReraisedPot.js';
import { withStyleRecordsKept } from './HorseStyleShadow.js';
import { restoreHorseBetSizeRandom, saveHorseBetSizeRandom } from './horsePublicBetSize.js';
import { restoreHorseTimingRandom, saveHorseTimingRandom } from './horsePublicActionTime.js';
import {
  HOLDEM_OOP_RERAISE_RANGE_HOLDS,
  OMAHA_OOP_RERAISE_RANGE_HOLDS,
  RERAISE_FOLD_SHARE_CAP_DEFAULT,
  oopReraiseAnswerOf,
  oopReraiseFourBetFrame,
  oopReraiseFourBetTo,
  oopReraiseGameOf,
  oopReraiseRaiseTo,
  oopReraiseSpotOf,
  oopReraiseVerdict,
  openerAnswersThreeBetRead,
  type OopReraiseAnswer,
  type OopReraiseExclusions,
  type OopReraiseFrameState,
  type OopReraiseGame,
  type OopReraiseReceipt,
  type OopReraiseSpot,
  type OopReraiseState,
  type OpenerAnswersRead,
} from './HorseOopReraiseRangeHolds.js';

/** The options this wiring reads (each `=== true`), and the cap. */
export interface OopReraiseOpts {
  omahaOopReraiseRangeHoldsVsReraise?: boolean;
  holdemOopReraiseRangeHoldsVsReraise?: boolean;
  /** horse.reraiseFoldShareCap (runtime setting); absent: RERAISE_FOLD_SHARE_CAP_DEFAULT */
  reraiseFoldShareCap?: number;
  mind?: boolean;
  telemetry?: boolean;
  observeMind?: boolean;
  decisionTimeMs?: number;
}

/** What HorseLogic hands the wiring about a decision (its own helpers, so the scope is read one way). */
export interface OopReraiseContext {
  exclusions: OopReraiseExclusions;
  /** the share of a pot of `pot` chips (contested past the flop) the deduction takes (0 in tournaments) */
  rakeOfPot: (pot: number) => number;
}

type Gs = OopReraiseState & OopReraiseFrameState & { stage?: unknown; gameVariant?: unknown };

/** Whether the option of this game is on. */
function optionOn(game: OopReraiseGame, opts: OopReraiseOpts): boolean {
  return game === 'nlh'
    ? opts.holdemOopReraiseRangeHoldsVsReraise === true
    : opts.omahaOopReraiseRangeHoldsVsReraise === true;
}

/** Either option on (the cheap first test at the top of HorseLogic.decide). */
export function oopReraiseRangeHoldsOn(opts: OopReraiseOpts): boolean {
  return (
    opts.omahaOopReraiseRangeHoldsVsReraise === true ||
    opts.holdemOopReraiseRangeHoldsVsReraise === true
  );
}

/** The inputs the stage collects in pass 1. */
interface Collected {
  spot: OopReraiseSpot;
  raiseTo: number;
  hole: readonly Card[];
  dead: readonly Card[];
  answers: OpenerAnswersRead;
  openBand: readonly [number, number] | null;
  callAdmitted: boolean;
  rakeOfPot: (pot: number) => number;
}

/** The route in progress (null: none; the stage returns its input). Synchronous, one decision at a time. */
let route: {
  mode: 'collect' | 'apply';
  key: string;
  collected: Collected | null;
  verdict: 'called' | 'folded' | null;
} | null = null;

/** True while a routed decision is being asked (its passes and its side ask never route again). */
export function oopReraiseRangeHoldsRouting(): boolean {
  return route !== null;
}

/** The public identity of the decision point (seat, street, pot, price, length of the public history). */
function pointKey(player: SeatPlayer, gs: Gs): string {
  return `${player.seat}|${String(gs.stage ?? '')}|${Math.round((gs.pot || 0) * 100)}|${Math.round(
    (gs.currentBet || 0) * 100
  )}|${(gs.actionHistory ?? []).length}`;
}

type ReceiptKind = 'kept' | 'blocker' | 'called' | 'folded' | 'unpriced';
/** The receipt of a verdict, by game family (literal keys, so the ledger law reads each). */
function noteVerdict(game: OopReraiseGame, kind: ReceiptKind): void {
  if (game === 'nlh') {
    if (kind === 'kept') noteFire('holdem_oop_reraise_range_holds_kept');
    else if (kind === 'blocker') noteFire('holdem_oop_reraise_range_holds_blocker_kept');
    else if (kind === 'called') noteFire('holdem_oop_reraise_range_holds_called');
    else if (kind === 'folded') noteFire('holdem_oop_reraise_range_holds_folded');
    else noteFire('holdem_oop_reraise_range_holds_unpriced');
    return;
  }
  if (kind === 'kept') noteFire('omaha_oop_reraise_range_holds_kept');
  else if (kind === 'blocker') noteFire('omaha_oop_reraise_range_holds_blocker_kept');
  else if (kind === 'called') noteFire('omaha_oop_reraise_range_holds_called');
  else if (kind === 'folded') noteFire('omaha_oop_reraise_range_holds_folded');
  else noteFire('omaha_oop_reraise_range_holds_unpriced');
}

/** The stage (wager_rules slot after holdem_premium_aggression, and the outside-the-graph twin). */
export function oopReraiseRangeHoldsStage(
  decision: HorseDecision,
  player: SeatPlayer,
  gs: Gs,
  opts: OopReraiseOpts,
  ctx: OopReraiseContext
): HorseDecision {
  if (route === null) return decision;
  if (decision.action !== 'raise' && decision.action !== 'all_in') return decision;
  try {
    if (pointKey(player, gs) !== route.key) return decision;
    const spot = oopReraiseSpotOf(player, gs, ctx.exclusions);
    if (spot === null || !optionOn(spot.game, opts)) return decision;
    const raiseTo = oopReraiseRaiseTo(decision, spot);
    if (raiseTo === null) return decision;
    if (route.mode === 'apply') {
      if (route.verdict === 'called') {
        return {
          ...decision,
          action: 'call',
          amount: Math.round(Math.min(spot.toCall, spot.heroStack) * 100) / 100,
        };
      }
      if (route.verdict === 'folded') {
        const folded: HorseDecision = { ...decision, action: 'fold' };
        delete folded.amount;
        return folded;
      }
      return decision;
    }
    // COLLECT: the reads, inside the decision's own read scope. Public actions and the Horse's own cards only.
    let measuredFold: { mean: number; n: number } | null = null;
    let openBand: readonly [number, number] | null = null;
    if (opts.mind !== false) {
      try {
        // his own decayed counters as this decision reads them (the opponent read's own source), whether or not they
        // engage an exploit read: fold to a 3-bet over the opportunities he had
        const c = HorseMind.currentExploitCounters(spot.openerId);
        const opp = c ? Number(c.foldTo3BetOpp) : 0;
        const fold = c ? Number(c.foldTo3Bet) : 0;
        if (Number.isFinite(opp) && opp > 0 && Number.isFinite(fold))
          measuredFold = { mean: Math.min(1, Math.max(0, fold / opp)), n: opp };
      } catch {
        measuredFold = null;
      }
      try {
        const band = HorseMind.bandFor(
          spot.openerId,
          gs.actionHistory as never,
          spot.bigBlind,
          true,
          null,
          undefined,
          HorseMind.initialPublicMoney(gs.players as never, gs.actionHistory as never, gs.pot) ??
            undefined
        );
        if (band && Number.isFinite(band[0]) && Number.isFinite(band[1]) && band[1] > band[0])
          openBand = [band[0], band[1]];
      } catch {
        openBand = null;
      }
    }
    const answers = openerAnswersThreeBetRead(spot.game, spot.effBB, measuredFold);
    if (answers === null) return decision;
    const hole = player.cards ?? [];
    const dead = player.knownDeadCards ?? [];
    let callAdmitted: boolean;
    if (spot.game === 'nlh') {
      // the brain's own call bar for this spot (HorsePreflop callThresh, on the range-play read receipt)
      const rr = (
        decision as { preflopReadReceipt?: { strength?: unknown; callThreshold?: unknown } }
      ).preflopReadReceipt;
      const strength = typeof rr?.strength === 'number' ? rr.strength : NaN;
      const bar = typeof rr?.callThreshold === 'number' ? rr.callThreshold : NaN;
      callAdmitted = Number.isFinite(strength) && Number.isFinite(bar) && strength >= bar;
    } else {
      callAdmitted = omahaDowngradedThreeBetCalls({
        hole,
        dead,
        outOfPosition: true,
        toCall: spot.toCall,
        stack: spot.heroStack,
        pot: spot.pot,
        band: openBand,
      });
    }
    route.collected = {
      spot,
      raiseTo,
      hole,
      dead,
      answers,
      openBand,
      callAdmitted,
      rakeOfPot: ctx.rakeOfPot,
    };
    return decision;
  } catch {
    return decision;
  }
}

/** The three streams a decision draws from. */
function saveStreams(): [number, number, number] {
  return [saveFastRandom(), saveHorseBetSizeRandom(), saveHorseTimingRandom()];
}
function restoreStreams(s: [number, number, number]): void {
  restoreFastRandom(s[0]);
  restoreHorseBetSizeRandom(s[1]);
  restoreHorseTimingRandom(s[2]);
}

/**
 * The routed decision, or null when the decision is not in the rule's spot (HorseLogic then decides as before).
 * `ask(player, gs, opts, first)` is HorseLogic.decide with the caller's style and mods (`first`: the captures go
 * to pass 1 only).
 */
export function oopReraiseRangeHoldsDecide(
  player: SeatPlayer,
  gs: Gs,
  opts: OopReraiseOpts,
  ctx: OopReraiseContext,
  ask: (player: SeatPlayer, gs: Gs, opts: OopReraiseOpts, first: boolean) => HorseDecision
): HorseDecision | null {
  if (route !== null) return null;
  const game = oopReraiseGameOf(gs.gameVariant);
  if (game === null || !optionOn(game, opts)) return null;
  let spot: OopReraiseSpot | null;
  try {
    spot = oopReraiseSpotOf(player, gs, ctx.exclusions);
  } catch {
    spot = null;
  }
  if (spot === null) return null;
  const key = pointKey(player, gs);
  const streams0 = saveStreams();
  route = { mode: 'collect', key, collected: null, verdict: null };
  let first: HorseDecision;
  let collected: Collected | null;
  try {
    first = ask(player, gs, opts, true);
    collected = route.collected;
  } finally {
    route = null;
  }
  if (collected === null) return first;
  const raiseNow = oopReraiseRaiseTo(first, collected.spot);
  if (raiseNow === null || Math.abs(raiseNow - collected.raiseTo) > 0.005) return first;
  const tele = telemetryOn(opts);
  // 2. The Horse's own answer to the 4-bet, asked on the public frame.
  let answer: OopReraiseAnswer | null = null;
  const fourTo = oopReraiseFourBetTo(collected.spot, collected.raiseTo);
  const frame = oopReraiseFourBetFrame(
    player,
    gs,
    collected.spot,
    collected.raiseTo,
    fourTo,
    Number.isFinite(opts.decisionTimeMs) ? (opts.decisionTimeMs as number) : 0
  );
  if (frame) {
    const heroIn = collected.raiseTo - collected.spot.heroBet;
    const heroOnFrame: SeatPlayer = {
      ...player,
      bet: collected.raiseTo,
      stack: Math.round((collected.spot.heroStack - heroIn) * 100) / 100,
      totalInvested: (player.totalInvested ?? 0) + heroIn,
    };
    const streams1 = saveStreams();
    route = { mode: 'collect', key: '', collected: null, verdict: null }; // never matches: the side ask is not routed
    try {
      const v4 = withStyleRecordsKept(() =>
        withBrainTelemetrySuspended(() =>
          HorseMind.withDecisionEffectsDiscarded(() =>
            ask(
              heroOnFrame,
              frame,
              {
                ...opts,
                [OMAHA_OOP_RERAISE_RANGE_HOLDS]: false,
                [HOLDEM_OOP_RERAISE_RANGE_HOLDS]: false,
                observeMind: false,
                telemetry: false,
              } as OopReraiseOpts,
              false
            )
          )
        )
      );
      if ((v4 as { policyFallback?: string }).policyFallback !== 'brain_exception')
        answer = oopReraiseAnswerOf(v4, frame.toCall ?? 0, heroOnFrame.stack);
    } catch {
      answer = null;
    } finally {
      route = null;
      restoreStreams(streams1);
    }
  }
  // 3. The price.
  let receipt: OopReraiseReceipt | null = null;
  try {
    receipt = oopReraiseVerdict({
      spot: collected.spot,
      hole: collected.hole,
      dead: collected.dead,
      raiseTo: collected.raiseTo,
      answers: collected.answers,
      openBand: collected.openBand,
      fourBetAnswer: answer,
      rakeOfPot: collected.rakeOfPot,
      callAdmitted: collected.callAdmitted,
      cap:
        typeof opts.reraiseFoldShareCap === 'number' && Number.isFinite(opts.reraiseFoldShareCap)
          ? opts.reraiseFoldShareCap
          : RERAISE_FOLD_SHARE_CAP_DEFAULT,
      horseId: player.user_id,
    });
  } catch {
    receipt = null;
  }
  if (receipt === null) {
    if (tele) noteVerdict(game, 'unpriced');
    return first;
  }
  if (receipt.verdict === 'kept') {
    if (tele) noteVerdict(game, receipt.reason === 'blocker_planned_fold' ? 'blocker' : 'kept');
    return { ...first, oopReraiseRangeHolds: receipt };
  }
  // Pass 3: the same decision from the same stream position, the stage applying the verdict.
  restoreStreams(streams0);
  route = { mode: 'apply', key, collected: null, verdict: receipt.verdict };
  let third: HorseDecision;
  try {
    third = withStyleRecordsKept(() =>
      withBrainTelemetrySuspended(() => ask(player, gs, { ...opts, observeMind: false }, false))
    );
  } catch {
    route = null;
    return first;
  } finally {
    route = null;
  }
  const changed = receipt.verdict === 'called' ? third.action === 'call' : third.action === 'fold';
  if (!changed) {
    // the stage was not reached on pass 3 (a path outside both hooks): the 3-bet stands, unpriced
    if (tele) noteVerdict(game, 'unpriced');
    return first;
  }
  if (tele) noteVerdict(game, receipt.verdict === 'called' ? 'called' : 'folded');
  return { ...third, oopReraiseRangeHolds: receipt };
}
