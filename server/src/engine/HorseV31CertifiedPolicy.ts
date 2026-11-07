/**
 * V31 CERTIFIED DIRECT POLICY: the whole certified-playbook consult of a
 * postflop decision, moved verbatim out of HorseLogic.decidePostflop
 * (2026-11-06, Phase 3 of the R8 plan) so the playbook's execution has its
 * own file and its own fingerprint (scripts/ci/v31-execution-fingerprint.mjs).
 *
 * The move is pure: the same statements in the same order, with three
 * mechanical substitutions - `this.legalize(intended31, player, gs, vi)` is
 * the caller's `legalize(intended31)`, `isTournamentMode(gs)` is the caller's
 * `isTournament`, and the decidePostflop locals arrive as named inputs. A
 * behaviour digest over every certification table with R7's sealed cells was
 * identical before and after the move.
 *
 * Returns the certified decision (already legalized) when a sealed cell
 * answers, or null when the playbook does not decide this spot: the caller
 * then continues exactly as if this block were not there.
 */

import type { HandStage, HorseDecision, SeatPlayer } from '../types.js';
import type { HorseDecideOpts, HorseGameStateV2, HorseTrustedTournament } from './HorseLogic.js';
import type { VariantInfo } from './HorseEval.js';
import { noteFire } from './BrainTelemetry.js';
import { HorseMind } from './HorseMind.js';
import { fastRandom } from './HorseEval.js';
import { handClass as gtoHandClass } from './GtoCharts.js';
import { beyondGtoDepthCeiling, rollMix } from './GtoPostflop.js';
import {
  gtoStreetAdviceV31,
  gtoV31StoreIsEmpty,
  type GtoV31GameFamily,
  type GtoV31Objective,
} from './GtoPostflopV31.js';
import {
  classifyGtoDecisionContext,
  gtoV31FlopRootStack,
  gtoV31HasHeadsUpPostflopLine,
  gtoV31Position,
  gtoV31PotType,
  gtoV31UtilityContext,
} from './GtoDecisionContext.js';
import { aggressiveBettorPressure, riverFoldLowerBound } from './HorseOpponentExploit.js';
import type { OpponentExploitRead } from './HorseOpponentExploit.js';
import { cellDepthIsPrimary, gtoV31ExecutionMatches, noteGtoMiss } from './HorseGtoExecution.js';

export interface V31CertifiedInput {
  street: HandStage;
  player: SeatPlayer;
  opponents: SeatPlayer[];
  gs: HorseGameStateV2;
  vi: VariantInfo;
  opts: HorseDecideOpts;
  tele15: boolean;
  useMind: boolean;
  isRiver: boolean;
  isTournament: boolean;
  trustedTournament: HorseTrustedTournament;
  pot: number;
  toCall: number;
  currentBet: number;
  /** HorseLogic.legalize bound to this player, state and variant. */
  legalize: (decision: HorseDecision) => HorseDecision;
  /**
   * The V53 hand-off's opponent read. Absent (always, live) it is
   * HorseMind.opponentRead; the replay digest passes the read that was
   * recorded with the state, because horse memory is the surrounding brain,
   * not the playbook's execution.
   */
  readOpponent?: (userId: string) => OpponentExploitRead | null;
}

/**
 * One recorded certified decision, JSON-safe, for the replay digest
 * (server/src/benchmark/GtoV31ReplayDigest.ts). Everything decideV31Certified
 * reads is here: its inputs, the exact RNG position before the consult, the
 * opponent read the V53 hand-off saw, and the decision it returned.
 */
export interface V31ReplayState {
  schemaVersion: 1;
  street: HandStage;
  player: SeatPlayer;
  opponents: SeatPlayer[];
  gs: HorseGameStateV2;
  vi: VariantInfo;
  opts: Pick<
    HorseDecideOpts,
    'v53Pressure' | 'v31GtoSuitAware' | 'gtoV31DatasetChecksum' | 'v33DepthCeiling'
  >;
  useMind: boolean;
  isRiver: boolean;
  isTournament: boolean;
  trustedTournament: HorseTrustedTournament;
  pot: number;
  toCall: number;
  currentBet: number;
  rng: number;
  opponentRead: OpponentExploitRead | null;
  decision: HorseDecision;
}

/** The fields of HorseDecideOpts the consult reads, and only those. */
export const V31_REPLAY_OPTS = Object.freeze([
  'v53Pressure',
  'v31GtoSuitAware',
  'gtoV31DatasetChecksum',
  'v33DepthCeiling',
] as const);

function jsonCopy<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/**
 * Capture a certified decision for replay. Called only by an offline
 * evaluator (opts.onV31ReplayState is never set live), after the consult
 * returned `decision`, with the RNG position saved just before it. The copy
 * is a JSON round trip, the same bytes the corpus stores, so a replay of the
 * capture is a replay of what was stored.
 */
export function captureV31ReplayState(
  input: V31CertifiedInput,
  rng: number,
  decision: HorseDecision
): V31ReplayState {
  const opts: V31ReplayState['opts'] = {};
  for (const key of V31_REPLAY_OPTS) {
    if (input.opts[key] !== undefined) Object.assign(opts, { [key]: input.opts[key] });
  }
  let opponentRead: OpponentExploitRead | null = null;
  if ((input.opts.v53Pressure ?? true) !== false && input.useMind && input.opponents.length === 1) {
    try {
      opponentRead = input.readOpponent
        ? input.readOpponent(input.opponents[0].user_id)
        : HorseMind.opponentRead(input.opponents[0].user_id);
    } catch {
      opponentRead = null;
    }
  }
  return jsonCopy({
    schemaVersion: 1,
    street: input.street,
    player: input.player,
    opponents: input.opponents,
    gs: input.gs,
    vi: input.vi,
    opts,
    useMind: input.useMind,
    isRiver: input.isRiver,
    isTournament: input.isTournament,
    trustedTournament: input.trustedTournament,
    pot: input.pot,
    toCall: input.toCall,
    currentBet: input.currentBet,
    rng: rng >>> 0,
    opponentRead,
    decision,
  });
}

export function decideV31Certified(input: V31CertifiedInput): HorseDecision | null {
  const {
    street,
    player,
    opponents,
    gs,
    vi,
    opts,
    tele15,
    useMind,
    isRiver,
    isTournament,
    trustedTournament,
    pot,
    toCall,
    currentBet,
    legalize,
    readOpponent,
  } = input;
  // V31 CERTIFIED DIRECT POLICY. Node role, response semantics, both seats,
  // objective, stack depth, board texture and holding are all part of the
  // lookup key. An open policy can never answer a response decision, and a
  // chip-EV tournament policy can never masquerade as ICM. The compact
  // loader has already rejected any row without a complete active seal.
  //
  // 2026-10-16: an EMPTY store is checked once, before any of the consult's
  // work. Every lookup against it returns `empty_store` and falls through to
  // the heuristics (283k such misses a day while the PioSOLVER hosts are
  // off and V31 is parked), so skipping it decides identically. One counter
  // keeps the empty store visible instead of three miss counters.
  const v53SolverHandOff = (): boolean => {
    if ((opts.v53Pressure ?? true) === false || !useMind || opponents.length !== 1) return false;
    try {
      const read = readOpponent
        ? readOpponent(opponents[0].user_id)
        : HorseMind.opponentRead(opponents[0].user_id);
      if (!read) return false;
      const target =
        aggressiveBettorPressure(read) !== null || (isRiver && riverFoldLowerBound(read) !== null);
      if (target && tele15) noteFire('v53_pressure_solver_handoff');
      return target;
    } catch {
      return false;
    }
  };
  const v31Eligible =
    (opts.v31GtoSuitAware ?? true) !== false &&
    (street === 'flop' || street === 'turn' || street === 'river') &&
    player.cards.length === 2 &&
    vi.holeCount === 2 &&
    !vi.isFixedLimit &&
    !vi.isOmaha &&
    !vi.isShortDeck &&
    opponents.length === 1 &&
    // The certified V31 context has no straddle axis. A straddle-enabled
    // hand can have a different root pot, preflop ranges, action order, and
    // SPR, so a standard-pot cell is not evidence for it. V18/heuristics
    // retain ownership until a separately keyed straddle corpus exists.
    gs.straddleActive !== true &&
    gs.bombPot !== true &&
    !(gs.communityCards2 && gs.communityCards2.length > 0) &&
    // V53 (2026-10-24): a heads-up opponent the pressure layer targets - a
    // credibly aggressive bettor, or a credible river over-folder on the
    // river - is played by the exploit layer, not by a solver cell built
    // for a balanced opponent. Null read, no change (neutrality).
    !v53SolverHandOff();
  const v31StoreEmpty = v31Eligible && gtoV31StoreIsEmpty(opts.gtoV31DatasetChecksum);
  if (v31StoreEmpty && tele15) noteFire('v31_certified_skip_empty_store');
  if (v31Eligible && !v31StoreEmpty) {
    const opponent31 = opponents[0];
    const heroSeat31 = gtoV31Position({
      seat: player.seat,
      dealerSeat: gs.dealerSeat,
      players: gs.players,
      dealtSeatIds: gs.dealtSeatIds,
    });
    const opponentSeat31 = gtoV31Position({
      seat: opponent31.seat,
      dealerSeat: gs.dealerSeat,
      players: gs.players,
      dealtSeatIds: gs.dealtSeatIds,
    });
    const context31 = classifyGtoDecisionContext({
      street,
      hero: player,
      opponents,
      actionHistory: gs.actionHistory,
      currentBet: gs.currentBet,
      pot: gs.pot,
    });
    let family31: GtoV31GameFamily | null = null;
    let objective31: GtoV31Objective | null = null;
    if (!isTournament) {
      family31 = 'cash';
      objective31 = 'cash_ev';
    } else if (gs.format === 'spin') {
      family31 = 'spin';
      objective31 = (trustedTournament?.spotsPaid ?? 1) <= 1 ? 'chip_ev' : 'icm';
    } else if (
      Array.isArray(trustedTournament?.stacks) &&
      trustedTournament.stacks.length >= 2 &&
      Array.isArray(trustedTournament?.payoutPct) &&
      trustedTournament.payoutPct.length >= 1 &&
      !((trustedTournament?.playersLeft ?? 0) <= 2 && (trustedTournament?.spotsPaid ?? 1) <= 1)
    ) {
      family31 = 'tourney_icm';
      objective31 = 'icm';
    } else {
      family31 = 'tourney_ev';
      objective31 = 'chip_ev';
    }
    const utility31 =
      family31 && objective31
        ? gtoV31UtilityContext({
            family: family31,
            objective: objective31,
            tournament: trustedTournament,
          })
        : null;
    const potType31 = gtoV31PotType(gs.actionHistory);
    const hand31 = gtoHandClass(player.cards[0], player.cards[1]);

    const opponentRootStack31 = gtoV31FlopRootStack({
      street,
      player: opponent31,
      actionHistory: gs.actionHistory,
    });
    const heroRootStack31 = gtoV31FlopRootStack({
      street,
      player,
      actionHistory: gs.actionHistory,
    });
    const effective31 =
      opponentRootStack31 !== null && heroRootStack31 !== null
        ? Math.min(heroRootStack31, opponentRootStack31)
        : null;
    const stackBB31 = effective31 !== null && gs.bigBlind > 0 ? effective31 / gs.bigBlind : null;
    // V33 is default OFF since 2026-09-28 (league: 23 runs, -2.97 +/- 1.09
    // bb/100 with it on). Beyond the ceiling the bucketed answer is served,
    // and every such spot is still counted so the staleness stays visible.
    const beyond31 = stackBB31 !== null && beyondGtoDepthCeiling(stackBB31);
    const tooDeep31 = beyond31 && opts.v33DepthCeiling === true;
    if (tooDeep31 && tele15) noteFire('gto_skip_too_deep');
    else if (beyond31 && tele15) noteFire('gto_served_beyond_depth_ceiling');

    const direct31 =
      context31 &&
      family31 &&
      objective31 &&
      utility31 &&
      heroSeat31 &&
      opponentSeat31 &&
      stackBB31 !== null &&
      heroSeat31.tableSize === opponentSeat31.tableSize &&
      gtoV31HasHeadsUpPostflopLine(gs.actionHistory, player.seat, opponent31.seat) &&
      !tooDeep31
        ? gtoStreetAdviceV31({
            street,
            family: family31,
            objective: objective31,
            utilityContext: utility31,
            tableSize: heroSeat31.tableSize,
            potType: potType31,
            heroPosition: heroSeat31.position,
            opponentPosition: opponentSeat31.position,
            stackBB: stackBB31,
            board: gs.communityCards,
            hand: hand31,
            holeCards: player.cards,
            nodeRole: context31.nodeRole,
            facingKind: context31.facingKind,
            facingSizeBucket: context31.facingSizeBucket,
            datasetChecksum: opts.gtoV31DatasetChecksum,
          })
        : null;
    if (direct31?.hit && stackBB31 !== null) {
      if (tele15 && !cellDepthIsPrimary(direct31.cell, stackBB31, direct31.depthBucket)) {
        noteFire('gto_depth_fallback');
      }
      const actionId31 = rollMix(direct31.mix, fastRandom);
      const action31 = actionId31 ? direct31.actions[actionId31] : null;
      if (action31 && actionId31) {
        let intended31: HorseDecision | null = null;
        if (action31.family === 'check') {
          intended31 = { action: 'check', thinkTime: 0 };
        }
        if (action31.family === 'fold') {
          intended31 = { action: 'fold', thinkTime: 0 };
        }
        if (action31.family === 'call') {
          intended31 = { action: 'call', amount: toCall, thinkTime: 0 };
        }
        if (action31.family === 'all_in') {
          intended31 = { action: 'all_in', thinkTime: 0 };
        }
        if (
          action31.family === 'bet' &&
          action31.size_unit === 'pot_fraction' &&
          action31.size_value
        ) {
          intended31 = { action: 'bet', amount: pot * action31.size_value, thinkTime: 0 };
        }
        if (
          action31.family === 'raise' &&
          action31.size_unit === 'pot_after_call_fraction' &&
          action31.size_value
        ) {
          intended31 = {
            action: 'raise',
            amount: currentBet + (pot + toCall) * action31.size_value,
            thinkTime: 0,
          };
        }
        if (intended31) {
          const final31 = legalize(intended31);
          const sampledAmount31 = intended31.amount ?? null;
          const finalAmount31 = final31.amount ?? null;
          const executedAsIntended31 = gtoV31ExecutionMatches({
            sampledFamily: action31.family,
            sampledAmount: sampledAmount31,
            finalAction: final31.action,
            finalAmount: finalAmount31,
            bigBlind: gs.bigBlind,
          });
          if (
            opts.onGtoV31Decision &&
            hand31 &&
            context31 &&
            family31 &&
            objective31 &&
            utility31 &&
            heroSeat31 &&
            opponentSeat31
          ) {
            opts.onGtoV31Decision({
              datasetId: direct31.sourceSeal.dataset_id,
              datasetChecksum: direct31.sourceSeal.dataset_checksum,
              decisionState: {
                schemaVersion: 1,
                street,
                gameVariant: 'nlh',
                gameFamily: family31,
                objective: objective31,
                utilityContext: utility31,
                format: gs.format ?? (isTournament ? 'mtt' : 'cash'),
                tableSize: heroSeat31.tableSize,
                potType: potType31,
                heroPosition: heroSeat31.position,
                opponentPosition: opponentSeat31.position,
                stackBb: stackBB31,
                depthBucket: direct31.depthBucket,
                textureClass: direct31.textureClass,
                nodeRole: direct31.nodeRole,
                facingKind: context31.facingKind,
                facingSizeBucket: context31.facingSizeBucket,
                hand: hand31,
                handKey: direct31.handKey,
                cell: direct31.cell,
                board: structuredClone(gs.communityCards),
                holeCards: structuredClone(player.cards),
                pot,
                currentBet,
                toCall,
                bigBlind: gs.bigBlind,
              },
              nodeRole: direct31.nodeRole,
              cell: direct31.cell,
              handKey: direct31.handKey,
              actionId: actionId31,
              sampledActionFamily: action31.family,
              sampledAmount: sampledAmount31,
              finalAction: final31.action,
              finalAmount: finalAmount31,
              executedAsIntended: executedAsIntended31,
              referenceDistribution: structuredClone(direct31.mix),
              policyEvBb: direct31.policyEvBb,
              actionEvsBb: structuredClone(direct31.actionEvsBb),
              sourceSeal: structuredClone(direct31.sourceSeal),
            });
          }
          if (tele15) {
            noteFire(
              executedAsIntended31
                ? `v31_certified_${direct31.nodeRole}`
                : 'v31_certified_execution_mismatch'
            );
          }
          return final31;
        }
      }
      if (tele15) noteFire('v31_certified_unusable_action');
    } else if (direct31 && !direct31.hit && stackBB31 !== null && tele15) {
      noteFire(`v31_certified_miss_${direct31.miss}`);
      noteGtoMiss('v31', street, stackBB31);
    } else if (tele15 && isTournament && (!objective31 || !utility31)) {
      noteFire('v31_certified_skip_unknown_tournament_utility');
    } else if (tele15 && (!heroSeat31 || !opponentSeat31)) {
      noteFire('v31_certified_skip_unknown_position');
    } else if (tele15 && stackBB31 === null) {
      noteFire('v31_certified_skip_unknown_root_stack');
    } else if (
      tele15 &&
      !gtoV31HasHeadsUpPostflopLine(gs.actionHistory, player.seat, opponent31.seat)
    ) {
      noteFire('v31_certified_skip_multiway_history');
    }
  }

  return null;
}
