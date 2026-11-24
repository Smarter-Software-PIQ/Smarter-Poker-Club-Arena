/**
 * THE PLO4 / PLO5 CASH FLOP CALL PRICED AS A TWO-STREET TREE ON MEASURED RANGES (option
 * omahaFlopRealizationIsPriced, default OFF, read `=== true`; PLO-OWNER lead-6 2026-11-24, design
 * plo-overfold/PLO-OVERFOLD-ROOT-CAUSE.md section 4 F3).
 *
 * WHY. The flop verdict (omahaFlopFacingBetEv) multiplies the call's showdown share by a realization factor with
 * median 0.42: a runout model times a multiplier fitted on what Horse flop calls returned under the Horses' own
 * later-street play, which folds the turn and river far above the price. The factor is circular: over-folding later
 * streets lowers measured flop realization, which drives more flop folds (73 of 80 sampled verdict folds had a
 * showdown share above the price). This file is its replacement; omahaFlopFacingBetEv may be off or on.
 *
 * WHAT. Facing a flop bet or raise, EV(call) is the two-street tree of HorseOmahaFlopDefenceTree.omahaFlopDefenceTreeEv
 * (pure, reused as it is: every later fold in it is a priced fold, the Horse's river call wins his bet when its hand
 * holds, so a draw that makes the nuts is paid by his later bets) on this file's own runouts:
 *  - his range is his MEASURED flop strength histogram for the line (the preflop raiser's c-bet or another first
 *    wager, or a raise), size and pot type, his own shown record shrunk toward it where he has one, else the table
 *    moved by today's public read factor and, with omahaFacingBetMinimumDefencePrior on, the F6 bound;
 *  - every other player in the hand is dealt on the same runouts (callers and earlier all-ins from the measured
 *    calling range, players still to act at the measured continue rate, their calls added to the pot);
 *    omahaMultiwayCallNeedsNutShare (M2) gives the field the measured flush-draw share of callers;
 *  - his turn and river bet rates are the measured rate at which a flop bettor whose bet was called fires the turn
 *    and the river (pooled, nobody keyed), shrunk toward his own public per-street bet counters; his sizes are the
 *    measured mean sizes of those bets.
 * No realization factor, no fitted multiplier, no person / Horse split: the tree's own inputs are identity-free
 * (omahaFlopDefenceTreeInputs, which keys on the opponent kind, is not used).
 *
 * PRICE. The call is made when EV > the flop margin of today's verdict (2% of the final pot); with
 * omahaFacingBetIndifferenceCalls on, when EV >= the sample's own standard error. Only a fold or a call changes;
 * a raise is never made or removed here.
 */
import type { Card, HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { noteFire } from './BrainTelemetry.js';
import { HorseMind } from './HorseMind.js';
import { omahaEvBluffShare } from './HorseOmahaFacingBetEv.js';
import {
  omahaFlopFacingBetEvSpot,
  type OmahaFlopFacingBetEvSpot,
} from './HorseOmahaFlopFacingBetEv.js';
import {
  omahaFlopDefenceTreeEv,
  type OmahaFlopDefenceTreeResult,
} from './HorseOmahaFlopDefenceTree.js';
import { omahaBareOverpairFlopFacingBetSpot } from './HorseOmahaOopChecks.js';
import { omahaPricedShrunk } from './HorseOmahaPricedRules.js';
import { omahaStrategyConstant } from './HorseOmahaStrategyGame.js';
import { omahaBetReadOwnCellOf } from './HorseOmahaBetRead.js';
import {
  OMAHA_MEASURED_BINS,
  omahaMeasuredBettorRange,
  omahaMeasuredCallerHist,
  omahaMeasuredContinueRate,
  omahaMeasuredFire,
  omahaMeasuredFlushDrawShare,
  omahaMeasuredLineOf,
  omahaMeasuredLineWeak,
  omahaMeasuredWeakShare,
  omahaMeasuredBettorHist,
  type OmahaMeasuredLine,
  type OmahaMeasuredRecord,
} from './HorseOmahaMeasuredBettorRange.js';
import { omahaPricedJointRows } from './HorseOmahaPricedJointSample.js';
import type { StreetReadCounters } from './HorseOmahaStreetRead.js';

/** Measurement only (the tree's reported raise value, never a decision): a stated fold to a flop raise. */
export const OMAHA_FLOP_CALL_TREE_FOLD_TO_RAISE = 0.5;

export interface OmahaFlopCallTreeInput {
  variant: string;
  spot: OmahaFlopFacingBetEvSpot;
  hole: Card[];
  board: Card[];
  dead: Card[];
  line: OmahaMeasuredLine;
  record: OmahaMeasuredRecord | null;
  readFactor: number;
  rake: number;
  /** chips that can still be wagered after the call: the smaller of the two stacks behind */
  left: number;
  /** his public per-street bet counters (HorseMind.omahaStreetReadOf), or null */
  counters: StreetReadCounters | null;
}

export interface OmahaFlopCallTreeVerdict {
  call: boolean;
  ev: number;
  margin: number;
  weak: number;
  source: 'record' | 'prior';
  bounded: boolean;
  tree: OmahaFlopDefenceTreeResult;
  samples: number;
  nutShareLoss: number | null;
}

const odds = (p: number): number => {
  const x = Math.max(0.01, Math.min(0.99, p));
  return x / (1 - x);
};

/**
 * His later streets' composition from the measured tables: the turn barrel's weak share (every size, weighted by
 * how often it is bet) over this flop cell's table weak share, and the river bet's after a turn barrel over the turn
 * barrel's, as odds ratios. His record or the F6 bound moves the flop share; these ratios carry it forward.
 */
function laterOdds(
  variant: string,
  line: OmahaMeasuredLine,
  potFrac: number,
  into: 'hu' | 'mw'
): { turnBluffOdds?: number; riverStepOdds?: number } {
  const flop = omahaMeasuredBettorHist(variant, 'flop', line, potFrac, into);
  const wT = omahaMeasuredLineWeak(variant, 'turn', 'agg', into);
  const wR = omahaMeasuredLineWeak(variant, 'river', 'agg', into);
  if (!flop || wT === null || wR === null) return {};
  return {
    turnBluffOdds: odds(wT) / odds(omahaMeasuredWeakShare(flop)),
    riverStepOdds: odds(wR) / odds(wT),
  };
}

export function omahaFlopCallTreeVerdict(
  input: OmahaFlopCallTreeInput,
  o: { minDefence: boolean; indifference: boolean; nutShare: boolean }
): OmahaFlopCallTreeVerdict | null {
  const { spot, hole, board, dead } = input;
  if ((hole.length !== 4 && hole.length !== 5) || board.length !== 3) return null;
  const multi = spot.callers + spot.allIns + spot.behind > 0;
  const into = multi ? 'mw' : 'hu';
  const range = omahaMeasuredBettorRange(input.variant, 'flop', input.line, spot.potFrac, into, {
    record: input.record,
    readFactor: input.readFactor,
    minDefence: o.minDefence,
  });
  if (!range) return null;
  const callerHist = multi
    ? omahaMeasuredCallerHist(input.variant, 'flop', spot.potFrac, 'mw')
    : null;
  const cont = multi ? omahaMeasuredContinueRate(input.variant, 'flop', spot.potFrac, 'mw') : 0;
  if (multi && (!callerHist || cont === null)) return null;
  const fd =
    multi && o.nutShare
      ? Array.from({ length: OMAHA_MEASURED_BINS }, (_, b) =>
          omahaMeasuredFlushDrawShare(input.variant, 'flop', b)
        )
      : null;
  const joint = omahaPricedJointRows(hole, board, dead, range.hist, {
    always: Array.from({ length: spot.callers + spot.allIns }, () => callerHist as number[]),
    behind: spot.behind,
    continueRate: cont ?? 0,
    behindHist: callerHist,
    flushDrawByBin: fd,
  });
  if (!joint) return null;
  const turnFire = omahaMeasuredFire(input.variant, 'turn');
  const riverFire = omahaMeasuredFire(input.variant, 'river');
  if (!turnFire || !riverFire) return null;
  const clamp01 = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x);
  const inputs = {
    turnBet: clamp01(omahaPricedShrunk(input.counters?.bet?.turn ?? null, turnFire.rate)),
    riverBet: clamp01(omahaPricedShrunk(input.counters?.bet?.river ?? null, riverFire.rate)),
    turnSize: turnFire.size,
    riverSize: riverFire.size,
    foldToRaise: OMAHA_FLOP_CALL_TREE_FOLD_TO_RAISE,
    ...laterOdds(input.variant, input.line, spot.potFrac, into),
  };
  const rake = Math.max(0, Math.min(0.2, Number.isFinite(input.rake) ? input.rake : 0));
  const winnable = spot.winnable + joint.behindIn * Math.max(0, spot.behindCall);
  const tree = omahaFlopDefenceTreeEv(
    joint.rows,
    joint.turnOf,
    {
      paid: spot.paid,
      winnable,
      left: spot.allIn || spot.final ? 0 : Math.max(0, input.left),
      rake,
      bluffShare: range.weak,
    },
    inputs
  );
  if (!tree) return null;
  const baseMargin =
    omahaStrategyConstant('facingBetEvMargin', { gameVariant: `plo${hole.length}` }) *
    (winnable + spot.paid);
  const se = ((winnable + spot.paid) * joint.sd) / Math.sqrt(Math.max(1, joint.samples));
  const margin = o.indifference
    ? se
    : spot.potFrac < 0.1
      ? Math.min(baseMargin, 0.5 * spot.paid)
      : baseMargin;
  return {
    call: o.indifference ? tree.ev >= margin : tree.ev > margin,
    ev: tree.ev,
    margin,
    weak: range.weak,
    source: range.source,
    bounded: range.bounded,
    tree,
    samples: joint.samples,
    nutShareLoss: multi && o.nutShare ? joint.nutShareLoss : null,
  };
}

export interface OmahaFlopCallTreeRuleContext {
  mind: boolean;
  telemetry: boolean;
  rake: number;
  bareOverpairContinuation: boolean;
  minDefence: boolean;
  indifference: boolean;
  nutShare: boolean;
}

/**
 * The rule: on the flop, a fold or a call in the covered spot becomes the tree's verdict. Null where it does not
 * answer (not the flop, outside the spot, a raise given, the bare-overpair continuation's spot, nothing to price):
 * the caller then decides as with the option off.
 */
export function omahaFlopCallTreeRule(
  decision: HorseDecision,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  ctx: OmahaFlopCallTreeRuleContext
): HorseDecision | null {
  try {
    if (gs.stage !== 'flop') return null;
    const stack = Number.isFinite(player.stack) ? Math.max(0, player.stack) : 0;
    const heroBet = Number.isFinite(player.bet) ? Math.max(0, player.bet ?? 0) : 0;
    const toCall = Number.isFinite(gs.toCall)
      ? Math.max(0, gs.toCall as number)
      : Math.max(0, (gs.currentBet || 0) - heroBet);
    const legacyCall =
      decision.action === 'call' || (decision.action === 'all_in' && stack <= toCall + 0.005);
    if (decision.action !== 'fold' && !legacyCall) return null;
    const spot = omahaFlopFacingBetEvSpot(player, gs);
    if (!spot) return null;
    if (ctx.bareOverpairContinuation && omahaBareOverpairFlopFacingBetSpot(player, gs) !== null)
      return null;
    const bettor = (gs.players ?? []).find((p) => p.seat === spot.bettorSeat);
    const variant = String(gs.gameVariant ?? '').toLowerCase();
    let readFactor = 1;
    let record: OmahaMeasuredRecord | null = null;
    let counters: StreetReadCounters | null = null;
    if (ctx.mind && bettor) {
      try {
        const read = HorseMind.omahaFacingBetEvReadOf(
          bettor.user_id,
          'turn',
          spot.potFrac,
          spot.isRaise
        );
        if (spot.priorBluff > 0)
          readFactor = omahaEvBluffShare(spot.priorBluff, read) / spot.priorBluff;
      } catch {
        readFactor = 1;
      }
      try {
        record = spot.isRaise
          ? null
          : omahaBetReadOwnCellOf(bettor.user_id, variant, 'flop', spot.potFrac, false);
      } catch {
        record = null;
      }
      try {
        counters = HorseMind.omahaStreetReadOf(bettor.user_id)?.counters ?? null;
      } catch {
        counters = null;
      }
    }
    const his = bettor && Number.isFinite(bettor.stack) ? Math.max(0, bettor.stack) : Infinity;
    const verdict = omahaFlopCallTreeVerdict(
      {
        variant,
        spot,
        hole: player.cards ?? [],
        board: gs.communityCards ?? [],
        dead: player.knownDeadCards ?? [],
        line: omahaMeasuredLineOf(gs.actionHistory, 'flop', spot.bettorSeat, spot.isRaise),
        record,
        readFactor,
        rake: ctx.rake,
        left: Math.min(Math.max(0, stack - spot.paid), his),
        counters,
      },
      { minDefence: ctx.minDefence, indifference: ctx.indifference, nutShare: ctx.nutShare }
    );
    if (!verdict) return null;
    if (ctx.telemetry) {
      if (verdict.call) noteFire('omaha_flop_call_tree_call');
      else noteFire('omaha_flop_call_tree_fold');
      if (verdict.source === 'record') noteFire('omaha_flop_call_tree_record_read');
      if (verdict.bounded) noteFire('omaha_flop_call_tree_min_defence_bounded');
    }
    if (verdict.call === legacyCall) return decision;
    if (ctx.telemetry) noteFire('omaha_flop_call_tree_changed');
    if (verdict.call) {
      const called: HorseDecision = spot.allIn
        ? { ...decision, action: 'all_in' }
        : { ...decision, action: 'call', amount: spot.paid };
      if (spot.allIn) delete called.amount;
      delete called.continuationGuard;
      return called;
    }
    const folded: HorseDecision = { ...decision, action: 'fold' };
    delete folded.amount;
    return folded;
  } catch {
    if (ctx.telemetry) noteFire('omaha_strategy_rule_failed');
    return null;
  }
}
