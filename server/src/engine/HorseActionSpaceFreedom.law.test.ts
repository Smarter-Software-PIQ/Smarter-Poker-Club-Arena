/**
 * LAW: 1,000-HORSE FULL ACTION-SPACE FREEDOM & LIVE AUTHORITY ACTIVATION
 * ============================================================================
 * Guards the end-to-end decision freedom, live authority activation, wager-step
 * legality, variant/format coverage, multi-board & side-game awareness, and
 * observability watchcounters of the 1,000-horse fleet:
 *
 *   1. Every horse in the 1,000-horse fleet runs with 100% real-time solver and
 *      brain adherence (`gtoAdherence === 1`) across cash and tournament play,
 *      with EV-bounded (`<= 0.12 BB`) indifference style seeds and zero cohort
 *      exclusions.
 *   2. Live owner-forced feature, phase (8, 10, 11, 12, 13, 14), and tournament
 *      flag (`v53PloTourneyIcm`) authorities admit running code across Hand #1
 *      and Hand #2+ uneven stacks without tripping silent-eligible withdrawal.
 *   3. All 8 primary `{nlh, plo4, plo5, plo6} x {cash, tournament}` cells, the
 *      5 remaining variants (`plo8`, `flo8`, `flh`, `short_deck`, `pineapple`),
 *      and 2-board / 3-board `bombPot` hands produce 100% valid worker receipts
 *      and 100% controller-accepted legal actions.
 *   4. Omaha shape/sub-core classes (`rundown`, `broadway_ds`, playable 5/6-card
 *      trips sub-cores vs ragged trips), integer/Diamond `chipUnit === 1`
 *      ceiling raise steps, dynamic preflop orbit / V38 population guards,
 *      7-2 & Kill/Half-Kill side-game overlays, intra-session gear-shift
 *      detection, surcharged insurance refusal, zero-fee Run-It-Twice, and
 *      `BrainTelemetry` Prometheus watchcounters remain permanently intact.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HandController } from './HandController.js';
import { callLargeRiverBoatWager } from './HorseOmahaBigBetCalls.js';
import { ServerTableEngine } from './ServerTableEngine.js';
import type { Deck } from './PokerEngine.js';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { decidePreflopV7, ploRaiseTo } from './HorsePreflop.js';
import { HorseMind } from './HorseMind.js';
import { applyTableCommitmentCap, ServerTableEngineTurns } from './ServerTableEngineTurns.js';
import { insurablePotBreakdown } from './ServerTableEngineRunout.js';
import { InsuranceEngine } from './InsuranceEngine.js';
import {
  HORSE_HYBRID_PROFILES,
  resolveHorseHybridExecutionProfile,
  resolveHorseHybridProfile,
  resolveHorseHybridSolverAdherence,
} from './HorseHybridProfile.js';
import {
  defaultPersonaFor,
  followsSolver,
  HORSE_INDIFFERENCE_EV_BAND_BB,
  indifferenceStyleSeedsFor,
  prefersRunItTwice,
  resolveIndifferenceTieBreak,
} from './HorsePersona.js';
import {
  decisionEligibleModesFor,
  isHorseDecisionEngineActiveFor,
} from '../services/HorseBehavior.js';
import {
  drainFires,
  enableBrainTelemetry,
  drainBrainWatchcounterDeltas,
  mergeBrainWatchcounterDeltas,
  noteHorseActionClamped,
  noteHorseLegalizerDegraded,
  noteHorsePlanReevaluated,
  noteHorseStreetPrewarm,
  noteHorseTelemetryOpportunity,
  peekBrainWatchcounters,
  renderBrainWatchcountersPrometheus,
  resetBrainWatchcountersForTest,
  seedBrainWatchcounters,
} from './BrainTelemetry.js';
import {
  alwaysOnPrometheusLines,
  horseDecisionFallbacksTotal,
} from '../observability/engineInstruments.js';
import { HORSE_DECISION_FALLBACK_REASONS } from './horseDecision/fallbackReason.js';
import {
  horseDecisionReceiptIsValid,
  horseDecisionReceiptRefusal,
  type HorseDecisionReceiptContext,
  horsePhase10SelectionIsValid,
  horsePhase11SelectionIsValid,
  horsePhase12SelectionIsValid,
} from './horseDecision/responseValidation.js';
import {
  defaultHorseDecisionWorkerDependencies as defaults,
  HorseDecisionWorkerRuntime,
} from './horseDecision/workerRuntime.js';
import {
  buildHorseDecisionKey,
  type HorseDecisionWorkerResponse,
} from './horseDecision/protocol.js';
import {
  controllerDecisionState,
  controllerSpotRandom,
} from './remainingVariants/RemainingVariantControllerSpots.test-support.js';
import { captureHorseHandJournalContext } from './HorseDecisionHandBinding.js';
import {
  fastRandom,
  seedFastRandom,
  simulateCorrelatedMultiBoardEquity,
  variantInfo,
} from './HorseEval.js';
import { _clearGtoPostflop } from './GtoPostflop.js';
import { buildTournamentMState } from './HorseTournamentPreflop.js';
import {
  admitHorseFeatureReleaseAuthority,
  HORSE_FEATURE_FLAGS,
  horseFeatureDomainVerdict,
  liveHorseFeatureAuthority,
  type HorseFeatureDomain,
} from './HorseFeatureAuthority.js';
import {
  admitHorseTournamentFlagReleaseAuthority,
  admittedTournamentFlag,
  HORSE_TOURNAMENT_FLAG_CARD_NAMES,
  tournamentFlagCardFor,
} from './HorseTournamentFlagAuthority.js';
import { HorsePhase8Safety, liveHorsePhase8Safety } from './HorsePhase8Safety.js';
import {
  HORSE_OWNER_FORCED_ACTIVATION,
  HORSE_OWNER_FORCED_ACTIVATION_ENABLED,
} from './HorseOwnerForcedActivation.js';
import {
  computeHorseUpgradeActivationManifest,
  HORSE_UPGRADE_MANIFEST_SCHEMA,
  HORSE_UPGRADE_MANIFEST_VERSION,
  verifyWorkerUpgradeManifestCompatibility,
  type HorseUpgradeCapabilityEntry,
} from './HorseUpgradeActivationManifest.js';
import {
  HorseQualifiedAuthorityHolder,
  liveHorsePhase8Authority,
  type HorsePhase8AuthorityGate,
  type HorseQualifiedAuthority,
} from './HorseQualifiedAuthority.js';
import {
  admitHorsePhase10LiveAuthority,
  liveHorsePhase10Authority,
} from './HorsePhase10Authority.js';
import {
  admitHorsePhase11LiveAuthority,
  liveHorsePhase11Authorities,
} from './HorsePhase11Authority.js';
import {
  admitHorsePhase12LiveAuthority,
  liveHorsePhase12Authorities,
} from './HorsePhase12Authority.js';
import { liveHorsePhase13Authorities } from './HorsePhase13Authority.js';
import { handClassRead } from './HorseHandClasses.js';
import { evaluatePlo4LivePolicy } from './plo4/Plo4LivePolicy.js';
import { PLO4_POLICY_PACK } from './plo4/Plo4PolicyPack.js';
import { evaluateOmahaVariantPolicy } from './omaha/OmahaVariantLivePolicy.js';
import { OMAHA_VARIANT_PACKS } from './omaha/OmahaVariantPolicyPack.js';
import { REMAINING_VARIANT_PACKS } from './remainingVariants/RemainingVariantPolicyPack.js';
import { plo4ReferenceSpot } from '../benchmark/Plo4PolicyEvidence.js';
import { omahaVariantSpot } from '../benchmark/OmahaVariantPolicyEvidence.js';
import {
  buildExplicitContinuationPlanV2,
  reevaluateDynamicContinuationNode,
  solveGeometricStreetSizing,
} from './HorseContinuationPlanInvalidation.js';
import { computeActionLinePosterior } from './HorseActionLinePosterior.js';
import { scoreCardRemoval } from './HorseCardRemovalScorer.js';
import type { HorsePolicyGraphReceipt } from './HorsePolicyGraph.js';
import { computeSideGamePotOverlay } from './HorseSideGameOverlay.js';
import { analyzePreflopOrbit, analyzeV38CommittedPopulation } from './HorsePreflopOrbitState.js';
import {
  detectIntraSessionGearShift,
  type IntraSessionActionObservation,
} from './HorseOpponentExploit.js';
import {
  buildGearShiftAwareScopedOpponentModel,
  type ScopedOpponentModelInput,
} from './HorseScopedOpponentModel.js';
import type { AdaptiveAction, QualifiedAdaptiveObservation } from './HorseAdaptiveObservation.js';
import type { ActionRecord, Card, HandConfig, HorseDecision, SeatPlayer } from '../types.js';

const SUIT_BY_SHORT = {
  s: 'spades',
  h: 'hearts',
  d: 'diamonds',
  c: 'clubs',
} as const;
const c = (rank: Card['rank'], suit: keyof typeof SUIT_BY_SHORT | Card['suit']): Card => ({
  rank,
  suit:
    suit in SUIT_BY_SHORT
      ? SUIT_BY_SHORT[suit as keyof typeof SUIT_BY_SHORT]
      : (suit as Card['suit']),
});

const PACK_BY_VARIANT: Record<string, keyof HorseDecision> = {
  plo4: 'plo4Policy',
  plo5: 'omahaVariantPolicy',
  plo6: 'omahaVariantPolicy',
  plo8: 'omahaVariantPolicy',
  short_deck: 'remainingVariantPolicy',
  pineapple: 'remainingVariantPolicy',
  flh: 'remainingVariantPolicy',
  flo8: 'remainingVariantPolicy',
};

function gateForPack(
  key: keyof HorseDecision,
  variant: string
): HorsePhase8AuthorityGate | undefined {
  if (key === 'plo4Policy') return liveHorsePhase10Authority;
  if (key === 'omahaVariantPolicy') {
    return liveHorsePhase11Authorities[variant as keyof typeof liveHorsePhase11Authorities];
  }
  if (key === 'remainingVariantPolicy') {
    return liveHorsePhase12Authorities[variant as keyof typeof liveHorsePhase12Authorities];
  }
  if (key === 'jointPolicy') {
    return liveHorsePhase13Authorities[variant as keyof typeof liveHorsePhase13Authorities];
  }
  return undefined;
}

interface PlayCellOptions {
  variant: string;
  mode: 'cash' | 'tournament';
  hands: number;
  diamondAsset?: boolean;
  bombPotBoards?: 2 | 3;
}

/**
 * The matrix validates a worker receipt exactly as the production client does
 * (horseDecision/client.ts, the `horseDecisionReceiptRefusal` call on every
 * FAST_RESULT): together with the request it answers. Some wager-rule
 * transitions are admitted only when the validator can recompute them from
 * that request, for example the PLO4/5/6 river boat call
 * (`callLargeRiverBoatWager`). Validating without the request refuses those
 * legitimate receipts, which is what failed this law about once in 600 runs.
 */
function matrixReceiptRefusal(
  decision: unknown,
  variant: string,
  request: HorseDecisionReceiptContext
): string | null {
  return horseDecisionReceiptRefusal(decision, variant, {
    player: request.player,
    gameState: request.gameState,
  });
}

async function runCellThroughWorkerAndController(opts: PlayCellOptions) {
  const { variant, mode, hands, diamondAsset = false, bombPotBoards } = opts;
  liveHorseFeatureAuthority.refresh();
  liveHorsePhase8Authority.refresh();
  const pack = PACK_BY_VARIANT[variant];
  if (pack) gateForPack(pack, variant)?.refresh();
  gateForPack('jointPolicy', variant)?.refresh();

  const messages: HorseDecisionWorkerResponse[] = [];
  const worker = new HorseDecisionWorkerRuntime((m) => messages.push(m), {
    ...defaults,
    startServices: async () => defaults.workerReadiness(),
    stopServices: async () => {},
    journalEnabled: () => false,
    journalAcceptedHand: () => {},
    journalLifecycle: () => {},
    noteFeature: () => {},
    noteDecision: () => {},
  });
  await worker.start();

  const stats = {
    decisions: 0,
    invalidReceipts: 0,
    refusedAtMainGate: 0,
    featureAuthorityVerified: 0,
    omahaIntegerChipUnits: 0,
    modes: new Map<string, number>(),
    jointBoardCounts: new Set<number>(),
    actionsChosen: new Set<string>(),
  };
  const bumpMode = (label: string) => stats.modes.set(label, (stats.modes.get(label) ?? 0) + 1);

  let requestId = 1;
  for (let hand = 0; hand < hands; hand++) {
    const seed = 7000 + hand * 31 + variant.charCodeAt(0);
    seedFastRandom(seed);
    const seats = bombPotBoards ? 3 : 2 + (hand % 4);
    const tableId = `55000000-0000-4000-8000-${String(hand + 1).padStart(12, '0')}`;
    const smallBlind = mode === 'tournament' || diamondAsset ? 10 : 1;
    const bigBlind = mode === 'tournament' || diamondAsset ? 20 : 2;
    const config: HandConfig = {
      tableId,
      handNumber: 12 + hand, // Hand #2+ explicitly (non-Hand-1 uneven stacks)
      gameVariant: variant as HandConfig['gameVariant'],
      smallBlind,
      bigBlind,
      isTournament: mode === 'tournament',
      chipUnit: mode === 'tournament' || diamondAsset ? 1 : 0.01,
      rakeConfig: { percent: mode === 'cash' ? 5 : 0, cap: bigBlind * 3, noFlopNoDrop: true },
      ...(bombPotBoards
        ? {
            bombPot: {
              anteMultiplier: 2,
              boardCount: bombPotBoards,
              doubleBoard: bombPotBoards === 2,
              triggerReason: 'every_n_hands',
            },
          }
        : {}),
    } as HandConfig;

    // Deliberately uneven Hand-#2+ stacks (e.g., 137.5 BB, 84 BB, 162 BB)
    const unevenStackBBs = [137.5, 84, 162, 68.5, 119];
    const players: SeatPlayer[] = Array.from({ length: seats }, (_, idx) => {
      const rawChips = unevenStackBBs[idx % unevenStackBBs.length] * bigBlind;
      const stack =
        mode === 'tournament' || diamondAsset
          ? Math.round(rawChips)
          : Math.round(rawChips * 100) / 100;
      return {
        seat: idx + 1,
        user_id: `66000000-0000-4000-8000-${String(hand * 10 + idx + 1).padStart(12, '0')}`,
        username: `FleetHorse_${hand}_${idx}`,
        stack,
        bet: 0,
        totalInvested: 0,
        cards: [],
        is_folded: false,
        is_all_in: false,
        is_sitting_out: false,
        is_horse: true,
      } as SeatPlayer;
    });

    const controller = new HandController(config, players, 1 + (hand % seats));
    const deck = controller.getState().deck as unknown as Deck;
    const cards = deck.getRemainingCards().sort((a, b) => {
      const left = `${a.suit}:${a.rank}`;
      const right = `${b.suit}:${b.rank}`;
      return left < right ? -1 : left > right ? 1 : 0;
    });
    const rng = controllerSpotRandom(seed ^ 0x5eedface);
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    deck.deal = (n = 1) => {
      if (cards.length < n) throw new Error('Law fixture exhausted physical deck');
      return cards.splice(0, n);
    };
    deck.dealOne = () => deck.deal(1)[0];
    deck.remaining = () => cards.length;
    deck.getRemainingCards = () => cards.slice();

    controller.start();

    // Force hand 0 of tournament cells onto a real flop so Phase 8 & tournament postflop execute
    if (mode === 'tournament' && hand === 0 && !bombPotBoards && seats === 2) {
      for (let pre = 0; pre < 2; pre++) {
        const openSpot = controllerDecisionState(controller, variant as never, mode, config);
        if (!openSpot || openSpot.state.stage !== 'preflop') break;
        const passive = openSpot.state.legalActions?.includes('check') ? 'check' : 'call';
        expect(controller.performAction(openSpot.hero.seat, passive)).toBe(true);
      }
    }

    for (let step = 0; step < 80; step++) {
      const live = controller.getState();
      if (live.stage === 'pineapple_discard') {
        for (const p of live.players.filter((x) => !x.is_folded && x.cards.length === 3)) {
          const beforeDiscard = messages.length;
          worker.receive({
            type: 'DECIDE_DISCARD',
            requestId: requestId++,
            generation: 1,
            fence: `${tableId}:${config.handNumber}:discard:${p.seat}:1`,
            cards: [...p.cards],
            communityCards: [...live.communityCards],
            gameVariant: 'pineapple',
          });
          await worker.drain();
          const discardRes = messages
            .slice(beforeDiscard)
            .find((m) => m.type === 'DISCARD_RESULT') as
            | (HorseDecisionWorkerResponse & { cardIndex: number })
            | undefined;
          expect(discardRes).toBeDefined();
          expect([0, 1, 2]).toContain(discardRes!.cardIndex);
          expect(controller.performDiscard(p.seat, discardRes!.cardIndex)).toBe(true);
        }
        controller.flushPineappleSettle();
        continue;
      }

      const spot = controllerDecisionState(controller, variant as never, mode, config);
      if (!spot) break;

      const blindSnap = controller.getBlindSnapshot?.() ?? {
        smallBlind: config.smallBlind,
        bigBlind: config.bigBlind,
        ante: 0,
        bigBlindAnte: false,
      };
      spot.state.smallBlind = blindSnap.smallBlind;
      spot.state.bigBlind = blindSnap.bigBlind;
      spot.state.ante = blindSnap.ante;
      spot.state.bigBlindAnte = blindSnap.bigBlindAnte;
      spot.state.allInOrFold = false;
      spot.state.bbjConfig = spot.state.bbjConfig ?? null;

      if (diamondAsset) {
        spot.state.asset = 'diamonds';
        spot.state.chipUnit = 1;
      }

      if (bombPotBoards) {
        const rawState = live as unknown as {
          communityCards2?: Card[];
          communityCards3?: Card[];
          boardCount?: number;
        };
        spot.state.bombPot = true;
        spot.state.boardCount = rawState.boardCount ?? bombPotBoards;
        spot.state.communityCards2 = [...(rawState.communityCards2 ?? [])];
        spot.state.communityCards3 = [...(rawState.communityCards3 ?? [])];
      }

      if (mode === 'tournament') {
        const stackByUser = Object.fromEntries(
          live.players.map((p) => [p.user_id, p.stack + p.totalInvested])
        );
        const stackVals = Object.values(stackByUser);
        spot.state.tournament = {
          schemaVersion: 1,
          contextStatus: 'complete',
          contextIssues: [],
          sourceAgeMs: 0,
          tournamentId: `law-tourney-${tableId}`,
          tournamentType: 'MTT',
          tournamentStatus: 'RUNNING',
          gameVariant: variant,
          entrants: 18,
          playersLeft: live.players.length + 1,
          spotsPaid: live.players.length,
          avgStackChips: stackVals.reduce((a, b) => a + b, 0) / stackVals.length,
          medianStackChips: [...stackVals].sort((a, b) => a - b)[Math.floor(stackVals.length / 2)],
          seatsPerTable: 6,
          playersAtTable: live.players.length,
          currentLevel: 4,
          nearBubble: true,
          inMoney: false,
          registrationOpen: false,
          lateRegistrationOpen: false,
          registrationRequiresAuthorization: false,
          isPko: false,
          isBounty: false,
          isMysteryBounty: false,
          mysteryBountyStage: 'none',
          reentryAllowed: false,
          rebuyAllowed: false,
          addOnAvailable: false,
          onBreak: false,
          handForHand: false,
          handForHandExpected: false,
          mysteryTopLive: false,
          finalTable: true,
          satellite: false,
          satelliteSeats: 0,
          maxReentries: 0,
          maxRebuys: 0,
          addOnCost: null,
          addOnChips: null,
          addOnLevels: null,
          levelDurationMin: 10,
          levelElapsedMin: 5,
          nextBlindMult: 1.5,
          bountyFactor: 0,
          mysteryChestsLeft: 0,
          mysteryMeanCents: 0,
          mysteryTopCents: 0,
          meanBountyCents: 0,
          bountyByUser: {},
          payoutPct: [50, 30, 20],
          stacks: stackVals,
          stackByUser,
          currentSmallBlind: config.smallBlind,
          currentBigBlind: config.bigBlind,
          currentAnte: 0,
          anteType: 'none',
          nextSmallBlind: config.bigBlind,
          nextBigBlind: config.bigBlind * 2,
          nextAnte: 0,
          nextBlindInMin: 5,
          prizePoolCents: 250000,
          bountyPoolCents: 0,
          reentryOpen: false,
          rebuyOpen: false,
          addOnPeriodOpen: false,
          reloadsUsed: 0,
          addOnTaken: false,
          rebuyAffordable: false,
          addOnAffordable: false,
          m: buildTournamentMState({
            stackChips: spot.hero.stack,
            smallBlind: config.smallBlind,
            bigBlind: config.bigBlind,
            ante: 0,
            anteType: 'none',
            playersAtTable: live.players.length,
            nextSmallBlind: config.bigBlind,
            nextBigBlind: config.bigBlind * 2,
            nextAnte: 0,
            minutesToNextLevel: 5,
            opponentStacks: live.players
              .filter((p) => p.user_id !== spot.hero.user_id)
              .map((p) => ({ userId: p.user_id, stackChips: p.stack })),
          }),
        };
      }

      spot.state.commitmentCapRemaining = applyTableCommitmentCap(
        controller.getAuthoritativeActionState(spot.hero.user_id)!,
        spot.hero,
        mode === 'tournament',
        0,
        config.bigBlind
      ).commitmentCapRemaining;

      const execProfile = resolveHorseHybridExecutionProfile(null, spot.hero.user_id, mode);

      const request = {
        type: 'DECIDE_FAST' as const,
        requestId: requestId++,
        generation: 1,
        fence: `${tableId}:${config.handNumber}:${spot.hero.seat}:${step}:1`,
        decisionKey: '',
        decisionTimeMs: Date.UTC(2026, 10, 10, 18, 0, 0) + hand * 1000 + step,
        player: spot.hero,
        gameState: spot.state,
        style: execProfile.style,
        mods: execProfile.mods,
        handJournalContext: captureHorseHandJournalContext(spot.state.actionHistory!),
      };
      request.decisionKey = buildHorseDecisionKey(request);

      const before = messages.length;
      worker.receive(request);
      await worker.drain();
      const response = messages.slice(before).find((m) => m.type === 'FAST_RESULT') as
        | (HorseDecisionWorkerResponse & { decision: HorseDecision } & Record<string, any>)
        | undefined;
      expect(response).toBeDefined();
      if (!response) throw new Error('Worker failed to emit FAST_RESULT');

      stats.decisions++;
      const decision = response.decision;
      stats.actionsChosen.add(decision.action);

      if (matrixReceiptRefusal(decision, variant, request) !== null) {
        stats.invalidReceipts++;
      }

      if (response.featureAuthority) {
        liveHorseFeatureAuthority.observeWorker(response.featureAuthority);
      }
      // Production-default release governance: unselected feature flags remain refused
      // and never force-inject unqualified featureAuthority receipts.
      expect(decision.featureAuthority).toBeUndefined();

      if (response.phase8Authority)
        liveHorsePhase8Authority.observeWorker(response.phase8Authority);
      if (decision.tournamentPostflop) {
        bumpMode(`tournamentPostflop:${decision.tournamentPostflop.mode}`);
        if (decision.tournamentPostflop.applied && decision.tournamentPostflop.authority) {
          if (
            liveHorsePhase8Authority.check(
              liveHorsePhase8Authority.stamp(decision.tournamentPostflop.authority)
            ) !== 'usable'
          ) {
            stats.refusedAtMainGate++;
          }
        }
      }

      if (response.phase10Authority)
        liveHorsePhase10Authority.observeWorker(response.phase10Authority);
      for (const [workerMap, gateMap] of [
        [response.phase11Authority, liveHorsePhase11Authorities],
        [response.phase12Authority, liveHorsePhase12Authorities],
        [response.phase13Authority, liveHorsePhase13Authorities],
      ] as const) {
        if (workerMap) {
          for (const [v, receipt] of Object.entries(workerMap)) {
            (gateMap as Record<string, HorsePhase8AuthorityGate>)[v]?.observeWorker(receipt);
          }
        }
      }

      for (const key of [pack, 'jointPolicy'] as const) {
        if (!key) continue;
        const receipt = decision[key] as
          | {
              mode?: string;
              applied?: boolean;
              authority?: any;
              boardCount?: number;
              inputs?: { geometry?: { chipUnit?: number } };
            }
          | undefined;
        if (!receipt) continue;
        bumpMode(`${String(key)}:${receipt.mode}`);
        if (key === 'jointPolicy' && typeof receipt.boardCount === 'number') {
          stats.jointBoardCounts.add(receipt.boardCount);
        }
        if (
          (mode === 'tournament' || diamondAsset) &&
          (key === 'plo4Policy' || key === 'omahaVariantPolicy') &&
          receipt.inputs?.geometry?.chipUnit === 1
        ) {
          stats.omahaIntegerChipUnits++;
        }
        if (receipt.applied) {
          const gate = gateForPack(key, variant);
          if (gate?.check(gate.stamp(receipt.authority)) !== 'usable') {
            stats.refusedAtMainGate++;
          }
        }
      }

      const wagerAmount =
        decision.action === 'call' || decision.amount === undefined
          ? undefined
          : Number(decision.amount);
      if ((mode === 'tournament' || diamondAsset) && wagerAmount !== undefined) {
        expect(Number.isInteger(wagerAmount)).toBe(true);
      }

      expect(
        controller.performAction(spot.hero.seat, decision.action, wagerAmount),
        JSON.stringify({
          variant,
          mode,
          hand,
          step,
          decision,
          legalActions: spot.state.legalActions,
          minRaiseTo: spot.state.minRaiseTo,
          maxRaiseTo: spot.state.maxRaiseTo,
        })
      ).toBe(true);
    }
  }

  await worker.drain();
  return stats;
}

afterEach(() => {
  HorseMind.reset();
  resetBrainWatchcountersForTest();
});

describe('LAW: 1,000-Horse Full Action-Space Freedom & Fleet Activation', () => {
  it('keeps ServerTableEngineTurns, HorseLogic, and HorsePreflop linked into the law graph', () => {
    expect(typeof ServerTableEngineTurns).toBe('function');
    expect(typeof HorseLogic.decide).toBe('function');
    expect(typeof decidePreflopV7).toBe('function');
    expect(typeof ploRaiseTo).toBe('function');
  });

  it('100% of all 1,000 horses run full solver/brain adherence across cash & tournament with <=0.12 BB indifference individuality', () => {
    expect(resolveHorseHybridSolverAdherence(HORSE_HYBRID_PROFILES.cash.mods)).toBe(1);
    expect(resolveHorseHybridSolverAdherence(HORSE_HYBRID_PROFILES.tournament.mods)).toBe(1);

    const sizingBiases = new Set<number>();
    const aggBiases = new Set<number>();
    let ritAcceptCount = 0;

    for (let i = 1; i <= 1000; i++) {
      const horseId = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
      expect(isHorseDecisionEngineActiveFor(horseId)).toBe(true);
      expect(decisionEligibleModesFor(horseId)).toEqual(['cash', 'tournament']);
      expect(defaultPersonaFor(horseId).gtoAdherence).toBe(1);

      for (const mode of ['cash', 'tournament'] as const) {
        const base = resolveHorseHybridProfile(null, horseId, mode);
        const resolved = resolveHorseHybridExecutionProfile(
          {
            style: base.style,
            aggMult: 1,
            tightShift: 0,
            bluffMult: 1,
            mods: base.mods,
          },
          horseId,
          mode
        );
        expect(resolved.gtoAdherence).toBe(1);
        expect(resolved.persona.gtoAdherence).toBe(1);
        expect(resolved.mods.referenceNlhOpenings).toBe(true);
        expect(
          followsSolver(horseId, 7, 'flop:cbet', resolveHorseHybridSolverAdherence(resolved.mods))
        ).toBe(true);
        expect(Math.abs(resolved.indifferenceSeeds.indifferenceAggressionBias)).toBeLessThanOrEqual(
          HORSE_INDIFFERENCE_EV_BAND_BB
        );
        expect(Math.abs(resolved.indifferenceSeeds.sizingMixBias)).toBeLessThanOrEqual(
          HORSE_INDIFFERENCE_EV_BAND_BB
        );
        sizingBiases.add(resolved.indifferenceSeeds.sizingMixBias);
        aggBiases.add(resolved.indifferenceSeeds.indifferenceAggressionBias);
      }

      const seeds = indifferenceStyleSeedsFor(horseId, 'cash');
      // Strict dominance protection: never overturns a candidate trailing by > 0.12 BB
      expect(resolveIndifferenceTieBreak(-0.125, seeds.indifferenceAggressionBias)).toBe(false);
      expect(resolveIndifferenceTieBreak(+0.125, seeds.indifferenceAggressionBias)).toBe(true);

      // Zero-fee RIT accepted/declined by persona seed; surcharged RIT always refused
      expect(prefersRunItTwice(horseId, 180, 0.5, 0.5)).toBe(false);
      if (prefersRunItTwice(horseId, 180, 0.5, 0)) ritAcceptCount++;
    }

    expect(sizingBiases.size).toBeGreaterThan(200);
    expect(aggBiases.size).toBeGreaterThan(200);
    expect(ritAcceptCount).toBeGreaterThan(100);
    expect(ritAcceptCount).toBeLessThan(900);
  });

  it('enforces strict release qualification on unselected feature & tournament flags while admitting Phases 8-14 and Hand-#2+ feature domains', () => {
    // 1. Unselected / unqualified feature & tournament-flag authorities remain strictly refused
    expect(admitHorseFeatureReleaseAuthority()).toEqual({
      status: 'refused',
      reason: 'unselected',
      transient: false,
    });
    expect(admitHorseTournamentFlagReleaseAuthority()).toEqual({
      status: 'refused',
      reason: 'unselected',
    });
    liveHorseFeatureAuthority.refresh();
    expect(liveHorseFeatureAuthority.mainState()).toBe('unselected');

    // Owner-forced activation covers ONLY Phases 8, 10, 11, 12, 13, 14 — never unqualified feature or tournament flags
    expect(HORSE_OWNER_FORCED_ACTIVATION_ENABLED).toBe(true);
    expect([...HORSE_OWNER_FORCED_ACTIVATION.phases]).toEqual([
      'phase8',
      'phase10',
      'phase11',
      'phase12',
      'phase13',
      'phase14',
    ]);

    // 2. Hand-#2+ uneven stacks (140.5 BB, 63 BB vs startingStackBB=100) pass featureDomainMatches
    //    when a qualified feature authority exists, while null authority refuses cleanly.
    const allTrueFlags = Object.fromEntries(HORSE_FEATURE_FLAGS.map((k) => [k, true])) as Record<
      (typeof HORSE_FEATURE_FLAGS)[number],
      boolean
    >;

    for (const variant of ['nlh', 'plo4', 'plo5', 'plo6'] as const) {
      const domain: HorseFeatureDomain = {
        variant,
        mode: 'cash',
        asset: 'chips',
        boardCount: 1,
        dealtSeats: [1, 2, 3],
        remainingPlayers: [2, 3, 4, 5, 6],
        effectiveStackBB: [40, 250],
        startingStackBB: 100,
        smallBlind: 2.5,
        bigBlind: 5,
        ante: 0,
        bigBlindAnte: false,
        bettingStructure: variant === 'nlh' ? 'no_limit' : 'pot_limit',
        chipUnit: 0.01,
        rakeConfig: { percent: 5, cap: 15, noFlopNoDrop: true },
        bbjConfig: null,
        sidePots: false,
      };
      const syntheticQualifiedAuthority = {
        schema: 'horse-qualified-authority-v1',
        phase: 'features',
        sourceSha: 'a'.repeat(40),
        continuationVersion: 'horse-feature-promotion-v1',
        policyDigest: 'b'.repeat(64),
        packId: 'horse-feature-promotion-v1',
        domain: `cash-${variant}`,
        evidencePath: 'docs/evidence/feature-activation/test.json',
        evidenceSha256: 'c'.repeat(64),
        approvalGeneration: 1,
        issuedAt: '2026-11-10T00:00:00.000Z',
        expiresAt: null,
        authorityKey: 'd'.repeat(64),
        featureFlags: allTrueFlags,
        featureDomain: domain,
      } as unknown as HorseQualifiedAuthority;

      const gs = {
        gameVariant: variant,
        gameMode: 'cash',
        asset: 'chips',
        boardCount: 1,
        dealtSeatIds: [1, 2, 3],
        smallBlind: 2.5,
        bigBlind: 5,
        ante: 0,
        bigBlindAnte: false,
        bettingStructure: variant === 'nlh' ? 'no_limit' : 'pot_limit',
        chipUnit: 0.01,
        bombPot: false,
        straddleActive: false,
        allInOrFold: false,
        bbjConfig: null,
        pots: [{ amount: 20, eligiblePlayers: ['u1', 'u2'] }],
        rakeConfig: { percent: 5, cap: 15, noFlopNoDrop: true },
        players: [
          {
            seat: 1,
            user_id: 'u1',
            stack: 687.5,
            bet: 0,
            totalInvested: 15,
            is_folded: false,
            is_all_in: false,
            is_sitting_out: false,
          }, // 140.5 BB (Hand #2+ uneven stack)
          {
            seat: 2,
            user_id: 'u2',
            stack: 310,
            bet: 0,
            totalInvested: 5,
            is_folded: false,
            is_all_in: false,
            is_sitting_out: false,
          }, // 63 BB (Hand #2+ uneven stack)
          {
            seat: 3,
            user_id: 'u3',
            stack: 520,
            bet: 0,
            totalInvested: 0,
            is_folded: true,
            is_all_in: false,
            is_sitting_out: false,
          },
        ],
      } as unknown as HorseGameStateV2;

      expect(horseFeatureDomainVerdict(null, false, gs, {}).status).toBe('refused');
      const verdict = horseFeatureDomainVerdict(syntheticQualifiedAuthority, true, gs, {});
      expect(verdict.status).toBe('admitted');
      expect(verdict.flags.barrelContinuationOutlook).toBe(true);
    }

    // 3. Unselected tournament flag returns false in production default; card mapping stays intact
    const tourneyRefused = admitHorseTournamentFlagReleaseAuthority();
    expect(HORSE_TOURNAMENT_FLAG_CARD_NAMES.length).toBe(6);
    for (const v of ['plo4', 'plo5', 'plo6'] as const) {
      for (const fmt of ['mtt', 'sng', 'spin', 'hu_sng'] as const) {
        const gs = {
          gameVariant: v,
          gameMode: 'tournament',
          format: fmt,
        } as unknown as HorseGameStateV2;
        if (fmt === 'mtt' || fmt === 'sng') {
          expect(tournamentFlagCardFor(gs)).not.toBeNull();
        } else {
          expect(tournamentFlagCardFor(gs)).toBeNull();
        }
        expect(admittedTournamentFlag(tourneyRefused, gs)).toBe(false);
      }
    }

    // 4. Phase 8 safety preserves strict 32-spot silent-eligible tripwire
    expect(liveHorsePhase8Safety.disabledReason).toBeNull();
    const unitSafety = new HorsePhase8Safety();
    for (let i = 0; i < 32; i++) {
      unitSafety.observe({
        eligible: true,
        fired: false,
        changed: false,
        reason: 'unchanged',
        candidateCriticalCommitment: false,
        baselineCriticalCommitment: false,
      } as never);
    }
    expect(unitSafety.disabledReason).toBe('eligible_but_silent');
  });

  it('validates matrix receipts with their request, as the production client does: a PLO5 river boat call is valid', () => {
    // A real receipt and request captured from the plo5 cash cell (hand 0,
    // river, heads-up): the reference raises with sixes full of nines facing a
    // pot-sized bet and the boat rule in wager_rules makes it a call.
    const captured = JSON.parse(
      readFileSync(
        new URL('./horseDecision/fixtures/plo5-river-boat-call-receipt.json', import.meta.url),
        'utf8'
      )
    ) as { context: HorseDecisionReceiptContext; decision: HorseDecision };
    const wagerRules = captured.decision.policyGraph!.transitions.find(
      (t) => t.node === 'wager_rules'
    )!;
    expect(wagerRules.before?.action).toBe('raise');
    expect(wagerRules.after).toEqual({ action: 'call', amount: captured.decision.amount });
    // The production rule really produces that call from that request.
    expect(
      callLargeRiverBoatWager(
        { action: 'raise', amount: wagerRules.before!.amount ?? undefined, thinkTime: 0 },
        captured.context.player,
        captured.context.gameState
      )
    ).toMatchObject({ action: 'call', amount: captured.decision.amount });
    // The matrix admits it, because it validates with the request...
    expect(matrixReceiptRefusal(captured.decision, 'plo5', captured.context)).toBeNull();
    // ...and the validator alone, without the request, cannot and does not.
    expect(horseDecisionReceiptRefusal(captured.decision, 'plo5')).toBe('policy_graph');
  });

  describe('8-cell {nlh, plo4, plo5, plo6} x {cash, tournament} worker + HandController matrix', () => {
    for (const variant of ['nlh', 'plo4', 'plo5', 'plo6'] as const) {
      for (const mode of ['cash', 'tournament'] as const) {
        it(`${variant} ${mode}: 100% valid receipts, 0 gate refusals, and 100% legal accepted controller actions`, async () => {
          const stats = await runCellThroughWorkerAndController({
            variant,
            mode,
            hands: 4,
            diamondAsset: false,
          });
          expect(stats.decisions).toBeGreaterThan(4);
          expect(stats.invalidReceipts).toBe(0);
          expect(stats.refusedAtMainGate).toBe(0);
          if (mode === 'cash') {
            for (const [k, count] of stats.modes.entries()) {
              if (k.endsWith(':shadow')) {
                expect(count, `Unexpected shadow mode in ${variant} cash: ${k}`).toBe(0);
              }
            }
          } else {
            expect(
              stats.modes.get('tournamentPostflop:shadow') ?? 0,
              `Unexpected tournamentPostflop:shadow in ${variant} tournament`
            ).toBe(0);
          }

          if (mode === 'cash' && (variant === 'plo4' || variant === 'plo5')) {
            const diamondStats = await runCellThroughWorkerAndController({
              variant,
              mode: 'cash',
              hands: 2,
              diamondAsset: true,
            });
            expect(diamondStats.decisions).toBeGreaterThan(2);
            expect(diamondStats.invalidReceipts).toBe(0);
            expect(diamondStats.refusedAtMainGate).toBe(0);
            const omahaOwner = variant === 'plo4' ? 'plo4Policy' : 'omahaVariantPolicy';
            expect(diamondStats.modes.get(`${omahaOwner}:shadow`) ?? 0).toBe(0);
          }
        }, 60_000);
      }
    }
  });

  it('remaining variants (plo8, flo8, flh, short_deck, pineapple with discard) pass worker & HandController receipts', async () => {
    for (const variant of ['plo8', 'flo8', 'flh', 'short_deck', 'pineapple'] as const) {
      const stats = await runCellThroughWorkerAndController({
        variant,
        mode: 'cash',
        hands: 2,
      });
      expect(stats.decisions, variant).toBeGreaterThan(2);
      expect(stats.invalidReceipts, variant).toBe(0);
      expect(stats.refusedAtMainGate, variant).toBe(0);
    }
  }, 60_000);

  it('multi-board bomb pots (boardCount = 2 and boardCount = 3) execute cleanly across all physical boards', async () => {
    for (const boardCount of [2, 3] as const) {
      const stats = await runCellThroughWorkerAndController({
        variant: 'plo4',
        mode: 'cash',
        hands: 2,
        bombPotBoards: boardCount,
      });
      expect(stats.decisions).toBeGreaterThan(1);
      expect(stats.invalidReceipts).toBe(0);
      expect(stats.refusedAtMainGate).toBe(0);
      expect(stats.jointBoardCounts.has(boardCount)).toBe(true);
    }
  }, 60_000);

  it('unblocks Omaha rundown/broadway_ds 3-bets, playable 5/6-card trips sub-cores, preflop raises, and fractional ceiling raise rounding', () => {
    // 1. Rundowns & double-suited broadways are unblocked for contextual 3-bets/squeezes
    const rundown = handClassRead(
      [c('J', 's'), c('T', 'h'), c('9', 's'), c('8', 'h')],
      true,
      false
    );
    expect(rundown.cls).toBe('rundown');
    expect(rundown.neverThreeBet).toBe(false);

    const broadwayDs5 = handClassRead(
      [c('K', 's'), c('K', 'h'), c('Q', 's'), c('J', 'h'), c('T', 'd')],
      true,
      false
    );
    expect(broadwayDs5.cls).toBe('broadway_ds');
    expect(broadwayDs5.neverThreeBet).toBe(false);
    expect(broadwayDs5.shift.threeBet).toBeLessThan(0);

    // Playable PLO5/PLO6 trips sub-core (AAAKKds) is playable, while ragged AAA72r folds
    const playableTrips = handClassRead(
      [c('A', 's'), c('A', 'h'), c('A', 'c'), c('K', 's'), c('K', 'h')],
      true,
      false
    );
    expect(playableTrips.cls).toBe('trips');
    expect(playableTrips.foldAlways).toBe(false);

    const raggedTrips = handClassRead(
      [c('A', 's'), c('A', 'h'), c('A', 'c'), c('7', 'd'), c('2', 's')],
      true,
      false
    );
    expect(raggedTrips.cls).toBe('trips');
    expect(raggedTrips.foldAlways).toBe(true);

    // 2. Live HorseLogic.decide freedom on AAxx, AsKsQhJh, and KsQhJsTh IP facing an open in PLO4,
    //    plus playable PLO5 (AAAKKds) and PLO6 (AAAKQJds) trips sub-cores vs ragged trips!
    const makeOmahaPreflopState = (
      variant: 'plo4' | 'plo5' | 'plo6',
      heroPlayer: SeatPlayer,
      facingOpen: boolean
    ): HorseGameStateV2 =>
      ({
        stage: 'preflop',
        gameVariant: variant,
        gameMode: 'cash',
        format: 'cash',
        bettingStructure: 'pot_limit',
        bigBlind: 2,
        pot: facingOpen ? 10 : 3,
        currentBet: facingOpen ? 7 : 2,
        minRaise: facingOpen ? 5 : 2,
        lastRaise: facingOpen ? 5 : 0,
        toCall: facingOpen ? 7 : 2,
        minRaiseTo: facingOpen ? 12 : 4,
        maxRaiseTo: facingOpen ? 24 : 7,
        dealerSeat: 4,
        heroSeat: 4,
        currentPlayerSeat: 4,
        legalActions: ['fold', 'call', 'raise'],
        communityCards: [],
        players: [
          {
            seat: 1,
            user_id: 'u1',
            stack: 199,
            bet: 1,
            totalInvested: 1,
            cards: [],
            is_folded: false,
            is_all_in: false,
            is_sitting_out: false,
          },
          {
            seat: 2,
            user_id: 'u2',
            stack: 198,
            bet: 2,
            totalInvested: 2,
            cards: [],
            is_folded: false,
            is_all_in: false,
            is_sitting_out: false,
          },
          {
            seat: 3,
            user_id: 'u3',
            stack: facingOpen ? 193 : 200,
            bet: facingOpen ? 7 : 0,
            totalInvested: facingOpen ? 7 : 0,
            cards: [],
            is_folded: !facingOpen,
            is_all_in: false,
            is_sitting_out: false,
          },
          { ...heroPlayer, cards: [] },
        ],
        actionHistory: facingOpen
          ? [{ seat: 3, userId: 'u3', action: 'raise', amount: 7, stage: 'preflop', timestamp: 1 }]
          : [{ seat: 3, userId: 'u3', action: 'fold', amount: 0, stage: 'preflop', timestamp: 1 }],
      }) as unknown as HorseGameStateV2;

    for (const [label, plo4Cards] of [
      ['AAKQds', [c('A', 's'), c('A', 'h'), c('K', 's'), c('Q', 'h')]],
      ['AsKsQhJh', [c('A', 's'), c('K', 's'), c('Q', 'h'), c('J', 'h')]],
      ['KsQhJsTh', [c('K', 's'), c('Q', 'h'), c('J', 's'), c('T', 'h')]],
    ] as const) {
      seedFastRandom(42);
      const hero4: SeatPlayer = {
        seat: 4,
        user_id: '00000000-0000-4000-8000-000000000042',
        username: 'PLO3Bettor',
        stack: 196,
        bet: 0,
        totalInvested: 0,
        cards: [...plo4Cards],
        is_folded: false,
        is_all_in: false,
        is_sitting_out: false,
        is_horse: true,
      };
      const preDecision = HorseLogic.decide(
        hero4,
        makeOmahaPreflopState('plo4', hero4, true),
        'balanced',
        HORSE_HYBRID_PROFILES.cash.mods
      );
      expect(['raise', 'all_in'], `PLO4 IP 3-bet on ${label}`).toContain(preDecision.action);
    }

    // Playable PLO5 AAAKKds opens AND continues/3-bets (never auto-folded by FOLD_ALWAYS)
    seedFastRandom(42);
    const plo5TripsHero: SeatPlayer = {
      seat: 4,
      user_id: '00000000-0000-4000-8000-000000000055',
      username: 'PLO5TripsHero',
      stack: 200,
      bet: 0,
      totalInvested: 0,
      cards: [c('A', 's'), c('A', 'h'), c('A', 'c'), c('K', 's'), c('K', 'h')],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: true,
    };
    const plo5Open = HorseLogic.decide(
      plo5TripsHero,
      makeOmahaPreflopState('plo5', plo5TripsHero, false),
      'balanced',
      HORSE_HYBRID_PROFILES.cash.mods
    );
    expect(['raise', 'all_in']).toContain(plo5Open.action);
    seedFastRandom(42);
    const plo5VsOpen = HorseLogic.decide(
      plo5TripsHero,
      makeOmahaPreflopState('plo5', plo5TripsHero, true),
      'balanced',
      HORSE_HYBRID_PROFILES.cash.mods
    );
    expect(plo5VsOpen.action).not.toBe('fold');
    expect(['raise', 'all_in', 'call']).toContain(plo5VsOpen.action);

    // Playable PLO6 AAAKQJds opens AND continues/3-bets (never auto-folded by FOLD_ALWAYS),
    // whereas ragged PLO6 AAA724 offsuit folds facing an open.
    seedFastRandom(42);
    const plo6TripsHero: SeatPlayer = {
      seat: 4,
      user_id: '00000000-0000-4000-8000-000000000066',
      username: 'PLO6TripsHero',
      stack: 200,
      bet: 0,
      totalInvested: 0,
      cards: [c('A', 's'), c('A', 'h'), c('A', 'c'), c('K', 's'), c('Q', 's'), c('J', 'h')],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: true,
    };
    const plo6Open = HorseLogic.decide(
      plo6TripsHero,
      makeOmahaPreflopState('plo6', plo6TripsHero, false),
      'balanced',
      HORSE_HYBRID_PROFILES.cash.mods
    );
    expect(['raise', 'all_in']).toContain(plo6Open.action);
    seedFastRandom(42);
    const plo6VsOpen = HorseLogic.decide(
      plo6TripsHero,
      makeOmahaPreflopState('plo6', plo6TripsHero, true),
      'balanced',
      HORSE_HYBRID_PROFILES.cash.mods
    );
    expect(plo6VsOpen.action).not.toBe('fold');

    seedFastRandom(42);
    const plo6RaggedTripsHero: SeatPlayer = {
      ...plo6TripsHero,
      cards: [c('A', 's'), c('A', 'h'), c('A', 'c'), c('7', 'd'), c('2', 's'), c('4', 'h')],
    };
    const plo6RaggedVsOpen = HorseLogic.decide(
      plo6RaggedTripsHero,
      makeOmahaPreflopState('plo6', plo6RaggedTripsHero, true),
      'balanced',
      HORSE_HYBRID_PROFILES.cash.mods
    );
    expect(plo6RaggedVsOpen.action).toBe('fold');

    // 3. Fractional minRaiseTo ceiling rounding in Plo4LivePolicy & OmahaVariantLivePolicy
    const p4 = plo4ReferenceSpot('premium_open');
    p4.state.asset = 'diamonds';
    p4.state.chipUnit = 1;
    p4.state.minRaiseTo = 4.5;
    p4.state.maxRaiseTo = 7;
    p4.baseline = { action: 'call', amount: 1, thinkTime: 100 };
    const plo4Out = evaluatePlo4LivePolicy(
      p4.hero,
      p4.state,
      p4.baseline,
      null,
      'candidate',
      () => 0
    );
    expect(plo4Out.receipt.fired).toBe(true);
    expect(plo4Out.receipt.inputs?.geometry.chipUnit).toBe(1);
    if (
      (plo4Out.decision.action === 'raise' || plo4Out.decision.action === 'bet') &&
      plo4Out.decision.amount !== undefined
    ) {
      expect(Number.isInteger(plo4Out.decision.amount)).toBe(true);
      expect(plo4Out.decision.amount).toBeGreaterThanOrEqual(5);
    }

    const p5 = omahaVariantSpot('plo5', 'preflop', 2);
    p5.state.asset = 'diamonds';
    p5.state.chipUnit = 1;
    p5.state.minRaiseTo = 4.5;
    p5.state.maxRaiseTo = 7;
    p5.baseline = { action: 'call', amount: 1, thinkTime: 100 };
    const plo5Out = evaluateOmahaVariantPolicy(
      p5.hero,
      p5.state,
      p5.baseline,
      null,
      'candidate',
      () => 0
    );
    expect(plo5Out.receipt.fired).toBe(true);
    expect(plo5Out.receipt.inputs?.geometry.chipUnit).toBe(1);
    if (
      (plo5Out.decision.action === 'raise' || plo5Out.decision.action === 'bet') &&
      plo5Out.decision.amount !== undefined
    ) {
      expect(Number.isInteger(plo5Out.decision.amount)).toBe(true);
      expect(plo5Out.decision.amount).toBeGreaterThanOrEqual(5);
    }
  });

  it('enforces 7-2 & Kill/Half-Kill side-game overlays, preflop orbit/V38 guards, intra-session gear-shift, and surcharged insurance refusal', () => {
    // 1. Seven-Deuce & Full/Half-Kill overlays
    const overlay = computeSideGamePotOverlay(
      {
        gameVariant: 'nlh',
        isTournament: false,
        stage: 'flop',
        bigBlind: 2,
        pot: 24,
        currentBet: 4,
        heroSeat: 5,
        heroStack: 200,
        heroCards: [c('7', 's'), c('2', 's')],
        dealtSeatIds: [1, 2, 3, 4, 5, 6],
        sevenDeuceEnabled: true,
        sevenDeuceBountyBB: 2,
        isKillPot: true,
        killMultiplier: 1.5,
        killPosterSeat: 5,
        killBlind: 3,
      },
      0
    );
    expect(overlay.sevenDeuce.enabled).toBe(true);
    expect(overlay.sevenDeuce.heroHoldsSevenDeuce).toBe(true);
    expect(overlay.sevenDeuce.collectibleBountyChips).toBe(20);
    expect(overlay.postflopPotOverlayChips).toBe(20);
    expect(overlay.kill.active).toBe(true);
    expect(overlay.kill.multiplier).toBe(1.5);
    expect(overlay.kill.effectiveBigBlind).toBe(3);

    // 2. Dynamic preflop orbit: incomplete short-stack all-in (5.4 over 5.0 open on 2 BB) != full 3-bet
    const orbitPlayers: SeatPlayer[] = [
      {
        seat: 1,
        user_id: 'u1',
        username: 'Opener',
        stack: 195,
        bet: 5,
        totalInvested: 5,
        cards: [],
        is_folded: false,
        is_all_in: false,
        is_sitting_out: false,
      },
      {
        seat: 2,
        user_id: 'u2',
        username: 'ShortAllIn',
        stack: 0,
        bet: 5.4,
        totalInvested: 5.4,
        cards: [],
        is_folded: false,
        is_all_in: true,
        is_sitting_out: false,
      },
      {
        seat: 3,
        user_id: 'u3',
        username: 'Hero',
        stack: 200,
        bet: 0,
        totalInvested: 0,
        cards: [],
        is_folded: false,
        is_all_in: false,
        is_sitting_out: false,
      },
    ];
    const orbit = analyzePreflopOrbit({
      history: [
        {
          seat: 1,
          userId: 'u1',
          action: 'raise',
          amount: 5,
          isFullRaise: true,
          stage: 'preflop',
          timestamp: 1,
        },
        {
          seat: 2,
          userId: 'u2',
          action: 'all_in',
          amount: 5.4,
          isFullRaise: false,
          stage: 'preflop',
          timestamp: 2,
        },
      ],
      players: orbitPlayers,
      heroSeat: 3,
      heroStack: 200,
      heroBet: 0,
      bigBlind: 2,
      currentBet: 5.4,
      dealerSeat: 3,
    });
    expect(orbit.fullRaises).toBe(1);
    expect(orbit.incompleteAllIns).toBe(1);
    expect(orbit.effectiveRaises).toBe(1);

    // V38 blocks blind 100bb isolation re-jam when uncapped opener acts behind short all-in
    const v38 = analyzeV38CommittedPopulation({
      players: orbitPlayers,
      heroSeat: 3,
      heroBet: 0,
      heroStack: 200,
      effCall: 5.4,
      currentBet: 5.4,
      bigBlind: 2,
      firstRaiserSeat: 1,
      lastRaiserSeat: 2,
      raiserAllIn: true,
    });
    expect(v38.uncappedCoveringOpponentsBehind).toBe(1);
    expect(v38.allowIsolationJam).toBe(false);

    // 3. Fast intra-session opponent gear-shift detection (12-20 opportunities)
    const maniacBurst: IntraSessionActionObservation[] = Array.from({ length: 14 }, (_, i) => ({
      kind: 'three_bet',
      taken: i % 5 !== 0,
    }));
    const shift = detectIntraSessionGearShift(maniacBurst, null, 'three_bet');
    expect(shift.shifted).toBe(true);
    expect(shift.archetype).toBe('three_bet_maniac');

    const digest = (v: string) => createHash('sha256').update(v).digest('hex');
    const scope = digest('nlh:cash:short');
    const opponent = digest('villain-gear-law');
    const observer = digest('horse-observer-law');
    const nowMs = Date.UTC(2026, 10, 10, 18, 0, 0);
    const dayMs = 86_400_000;
    const makeObs = (
      n: number,
      sessionIdx: number,
      action: AdaptiveAction,
      atMs: number
    ): QualifiedAdaptiveObservation => {
      const handId = `bbbbbbbb-bbbb-4bbb-8bbb-${String(n).padStart(12, '0')}`;
      const prefix = (sessionIdx * 5 + 1).toString(16).padStart(8, '0');
      return {
        version: 1,
        observationId: `${handId}:2`,
        handId,
        actorKey: opponent,
        sessionKey: prefix + digest(String(sessionIdx)).slice(8),
        observedAtMs: atMs,
        partition: 'training',
        scopeKey: scope,
        scope: [],
        action,
        facedBet: true,
        origin: 'player',
      };
    };
    const observations: QualifiedAdaptiveObservation[] = [];
    let obsSeq = 1;
    for (let s = 1; s <= 22; s++) {
      for (let h = 0; h < 4; h++) {
        const action: AdaptiveAction =
          h === 0 ? 'fold' : h === 1 ? 'check' : h === 2 ? 'call' : 'bet';
        observations.push(makeObs(obsSeq++, s, action, nowMs - (24 - s) * 3_600_000 + h * 1000));
      }
    }
    const liveIdx = 23;
    const liveSessionKey =
      (liveIdx * 5 + 1).toString(16).padStart(8, '0') + digest(String(liveIdx)).slice(8);
    for (let h = 0; h < 16; h++) {
      const action: AdaptiveAction = h < 12 ? 'raise' : h < 14 ? 'bet' : 'call';
      observations.push(makeObs(obsSeq++, liveIdx, action, nowMs - 60_000 + h * 1000));
    }
    const scopedInput: ScopedOpponentModelInput = {
      observations,
      scopeKey: scope,
      opponentKey: opponent,
      observerKey: observer,
      cohort: 'human',
      partition: 'training',
      window: { fromMs: nowMs - 28 * dayMs, toMs: nowMs, complete: true },
      prior: {
        version: 'frozen-prior-v1',
        probabilities: { fold: 0.3, check: 0.25, call: 0.25, bet: 0.1, raise: 0.1 },
      },
    };
    const scoped = buildGearShiftAwareScopedOpponentModel(scopedInput, liveSessionKey);
    expect(scoped.status).toBe('estimated');
    if (scoped.status === 'estimated') {
      expect(scoped.gearShift.shifted).toBe(true);
      expect(scoped.gearShift.direction).toBe('aggressive_shift');
    }

    // 4. Surcharged insurance is strictly -EV and declined by horses
    const insTableId = 'law-ins-table';
    const insEngine = new InsuranceEngine();
    insEngine.configure(insTableId, { enabled: true });
    const breakdown = insurablePotBreakdown(
      {
        computeLivePots: () => [{ amount: 200, eligiblePlayers: ['leader-1', 'underdog-2'] }],
        computeRakeAndBBJ: () => ({ rake: 6, bbjFee: 1 }),
      },
      'leader-1',
      200
    );
    expect(breakdown.insurablePot).toBe(193);
    const offers = insEngine.createOffers(
      insTableId,
      'hand-ins-1',
      'leader-1',
      [
        { playerId: 'leader-1', holeCards: [c('A', 's'), c('A', 'h')], atRisk: 100 },
        { playerId: 'underdog-2', holeCards: [c('K', 's'), c('K', 'h')], atRisk: 100 },
      ],
      [c('7', 'c'), c('4', 'd'), c('2', 's')],
      breakdown.insurablePot,
      'nlh',
      false,
      { equity: 75, strictLossPct: 25, pushPct: 0, exact: true, runouts: 990 }
    );
    expect(offers).toHaveLength(1);
    const offer = offers[0];
    expect(offer.pricing.houseMargin).toBeGreaterThan(1.0);
    const expectedLeaderInsuranceEv =
      -offer.fullPremium * offer.pricing.winGivenNoPush +
      offer.fullInsuredAmount * offer.pricing.lossGivenNoPush;
    expect(expectedLeaderInsuranceEv).toBeLessThan(0);
    insEngine.decline(insTableId, 'leader-1');
  });

  it('exposes, boot-seeds, cardinality-guards, and relays all 5 + 1 Prometheus watchcounters', () => {
    resetBrainWatchcountersForTest();
    seedBrainWatchcounters();

    // Boot zero-seeding exposes every counter family with 0-valued series immediately
    const bootProm = renderBrainWatchcountersPrometheus().join('\n');
    expect(bootProm).toContain('poker_horse_action_clamped_total{');
    expect(bootProm).toContain('poker_horse_plan_reevaluated_total{');
    expect(bootProm).toContain('poker_horse_legalizer_degraded_total{');
    expect(bootProm).toContain('poker_horse_street_prewarm_total{');
    expect(bootProm).toContain('poker_horse_telemetry_opportunities_total{');
    // Drain boot zero-seed markers
    drainBrainWatchcounterDeltas();

    noteHorseActionClamped('plo4', 'cash', 'pot_limit_cap', 2);
    noteHorsePlanReevaluated('nlh', 'tournament', 'unexpected_donk_bet');
    noteHorseLegalizerDegraded('plo5', 'cash', 'min_raise_step');
    noteHorseStreetPrewarm('plo6', 'cash', 'flop_deal', 3);
    noteHorseTelemetryOpportunity('plo4', 'cash', 'decision_evaluated', 5);

    // High-cardinality / mixed-case labels are sanitized to closed lowercase 'other' / 'invalidation_replan' — never dropped, zero UUID leakage
    const leakedUuid = '00000000-0000-4000-8000-000000000999';
    noteHorseActionClamped(`PLO4_${leakedUuid}`, 'CASH', `horse_${leakedUuid}`, 1);
    noteHorsePlanReevaluated('nlh', 'cash', `unmatched_custom_reason_${leakedUuid}`, 1);

    const deltas = drainBrainWatchcounterDeltas();
    expect(deltas).toHaveLength(7);
    expect(drainBrainWatchcounterDeltas()).toHaveLength(0);

    // Simulate relaying worker deltas onto a clean main-thread process registry
    resetBrainWatchcountersForTest();
    mergeBrainWatchcounterDeltas(deltas);

    const snap = peekBrainWatchcounters();
    expect(snap.poker_horse_action_clamped_total.total).toBe(3);
    expect(snap.poker_horse_plan_reevaluated_total.total).toBe(2);
    expect(snap.poker_horse_legalizer_degraded_total.total).toBe(1);
    expect(snap.poker_horse_street_prewarm_total.total).toBe(3);
    expect(snap.poker_horse_telemetry_opportunities_total.total).toBe(5);

    const prom = renderBrainWatchcountersPrometheus().join('\n');
    expect(prom).toContain(
      'poker_horse_action_clamped_total{variant="plo4",mode="cash",reason="pot_limit_cap"} 2'
    );
    expect(prom).toContain(
      'poker_horse_action_clamped_total{variant="other",mode="cash",reason="other"} 1'
    );
    expect(prom).toContain(
      'poker_horse_plan_reevaluated_total{variant="nlh",mode="tournament",reason="unexpected_donk_bet"} 1'
    );
    expect(prom).toContain(
      'poker_horse_plan_reevaluated_total{variant="nlh",mode="cash",reason="invalidation_replan"} 1'
    );
    expect(prom).toContain(
      'poker_horse_legalizer_degraded_total{variant="plo5",mode="cash",reason="min_raise_step"} 1'
    );
    expect(prom).toContain(
      'poker_horse_street_prewarm_total{variant="plo6",mode="cash",reason="flop_deal"} 3'
    );
    expect(prom).toContain(
      'poker_horse_telemetry_opportunities_total{variant="plo4",mode="cash",reason="decision_evaluated"} 5'
    );
    expect(prom).not.toContain(leakedUuid);

    // 5th required counter: poker_horse_decision_fallbacks_total in alwaysOnPrometheusLines with closed reason enum
    expect(HORSE_DECISION_FALLBACK_REASONS).toContain('result_refused');
    expect(HORSE_DECISION_FALLBACK_REASONS).toContain('expired');
    horseDecisionFallbacksTotal.inc(0, { reason: 'result_refused' });
    const engineProm = alwaysOnPrometheusLines().join('\n');
    expect(engineProm).toContain('poker_horse_decision_fallbacks_total{reason="result_refused"}');
  });

  it('enforces multi-street dynamic re-evaluation, action-line range-cap posterior, nut-flush vs missed-suit card removal, and correlated multi-board conservation', () => {
    // 1. Geometric street sizing & buildExplicitContinuationPlanV2 + reevaluateDynamicContinuationNode
    const plGeo = solveGeometricStreetSizing({
      pot: 100,
      effectiveStack: 420,
      streetsRemaining: 3,
      isPotLimit: true,
    });
    expect(plGeo.fractionOfPot).toBeLessThanOrEqual(1.0 + 1e-9);
    expect(plGeo.projectedRemainingSpr === 0 || plGeo.projectedRemainingSpr > 0.28).toBe(true);

    const plan = buildExplicitContinuationPlanV2({
      createdAtMs: 10_000,
      handNumber: 7,
      handId: 'law-plan-7',
      tableId: 'law-table-1',
      actorId: 'hero',
      createdStreet: 'FLOP',
      plannedOriginAction: 'bet',
      plannedOriginAmount: 65,
      archetype: 'semibluff_barrel',
      activePlayerCount: 2,
      pot: 100,
      effectiveStack: 320,
      isPotLimit: true,
      hasNutAdvantage: true,
      vulnerableToFlush: false,
      vulnerableToPair: true,
    });
    expect(plan.v2.planVersion).toBe('horse-continuation-plan-v2');
    expect(plan.turnTargetFraction).toBeLessThanOrEqual(1.0);

    const vsUnexpectedRaiseRedraw = reevaluateDynamicContinuationNode({
      archetype: plan.archetype,
      street: 'flop',
      facingBetChips: 90,
      potBeforeBet: 230,
      effectiveStackChips: 255,
      isPotLimit: true,
      equity: 0.35,
      potOdds: 90 / 320,
      hasCurrentNuts: false,
      hasNutRedraw: true,
      certifiedNutBlocker: false,
      villainRangeCapped: false,
      multiwayIncreased: false,
      facingUnexpectedRaise: true,
      facingUnexpectedDonk: false,
      cardClass: 'blank',
    });
    expect(vsUnexpectedRaiseRedraw.reevaluated).toBe(true);
    expect(vsUnexpectedRaiseRedraw.directive).not.toBe('fold_aborted_plan');

    const vsMultiwayAir = reevaluateDynamicContinuationNode({
      archetype: 'blocker_triple_barrel',
      street: 'turn',
      facingBetChips: 0,
      potBeforeBet: 180,
      effectiveStackChips: 400,
      isPotLimit: false,
      equity: 0.16,
      potOdds: 0,
      hasCurrentNuts: false,
      hasNutRedraw: false,
      certifiedNutBlocker: true,
      villainRangeCapped: false,
      multiwayIncreased: true,
      facingUnexpectedRaise: false,
      facingUnexpectedDonk: false,
      cardClass: 'blank',
    });
    expect(vsMultiwayAir.reevaluated).toBe(true);
    expect(vsMultiwayAir.directive).toBe('abort_multiway_air');

    const vsSmallDonk = reevaluateDynamicContinuationNode({
      archetype: 'value_geometric',
      street: 'turn',
      facingBetChips: 24,
      potBeforeBet: 100,
      effectiveStackChips: 300,
      isPotLimit: false,
      equity: 0.65,
      potOdds: 24 / 124,
      hasCurrentNuts: false,
      hasNutRedraw: false,
      certifiedNutBlocker: false,
      villainRangeCapped: false,
      multiwayIncreased: false,
      facingUnexpectedRaise: false,
      facingUnexpectedDonk: true,
      cardClass: 'blank',
    });
    expect(vsSmallDonk.directive).toBe('attack_small_donk');

    // 2. Action-line Bayesian posterior caps villain's range on wet-turn check-back
    const checkBackWetTurnHistory: ActionRecord[] = [
      { seat: 2, userId: 'villain', action: 'raise', amount: 6, timestamp: 1, stage: 'preflop' },
      { seat: 5, userId: 'hero', action: 'call', amount: 6, timestamp: 2, stage: 'preflop' },
      { seat: 5, userId: 'hero', action: 'check', amount: 0, timestamp: 3, stage: 'flop' },
      { seat: 2, userId: 'villain', action: 'check', amount: 0, timestamp: 4, stage: 'flop' },
      { seat: 5, userId: 'hero', action: 'check', amount: 0, timestamp: 5, stage: 'turn' },
      { seat: 2, userId: 'villain', action: 'check', amount: 0, timestamp: 6, stage: 'turn' },
    ];
    const cappedPosterior = computeActionLinePosterior({
      villainUserId: 'villain',
      villainSeat: 2,
      heroSeat: 5,
      stage: 'river',
      board: [c('K', 's'), c('T', 's'), c('8', 'h'), c('7', 'h'), c('2', 'c')],
      pot: 13,
      bigBlind: 2,
      actionHistory: checkBackWetTurnHistory,
    });
    expect(
      cappedPosterior.nutted +
        cappedPosterior.overpairTopPair +
        cappedPosterior.nutDrawWrap +
        cappedPosterior.floatWeakDraw +
        cappedPosterior.airBlocker
    ).toBeCloseTo(1.0, 5);
    expect(cappedPosterior.rangeCapped).toBe(true);

    // 3. Card-removal scorer boosts nut-flush blockers and penalizes blocking missed draws
    const nutFlushBlocker = scoreCardRemoval(
      [c('A', 's'), c('5', 'd')],
      [c('K', 's'), c('9', 's'), c('4', 's'), c('2', 'h'), c('7', 'c')],
      variantInfo('nlh')
    );
    expect(nutFlushBlocker.blocksNutFlush).toBe(true);
    expect(nutFlushBlocker.certifiedNutBluffBlocker).toBe(true);
    expect(nutFlushBlocker.netFoldEquityDelta).toBeGreaterThan(0);

    const missedHeartBlocker = scoreCardRemoval(
      [c('Q', 'h'), c('J', 'h')],
      [c('K', 'h'), c('9', 'h'), c('4', 'c'), c('2', 'd'), c('7', 's')],
      variantInfo('nlh')
    );
    const cleanRiverUnblocker = scoreCardRemoval(
      [c('Q', 'c'), c('J', 'd')],
      [c('K', 'h'), c('9', 'h'), c('4', 'c'), c('2', 'd'), c('7', 's')],
      variantInfo('nlh')
    );
    expect(missedHeartBlocker.foldBlockerPenalty).toBeGreaterThan(
      cleanRiverUnblocker.foldBlockerPenalty
    );
    expect(cleanRiverUnblocker.netFoldEquityDelta).toBeGreaterThan(
      missedHeartBlocker.netFoldEquityDelta
    );

    // 4. Correlated multi-board bomb-pot simulator conservation (pScoop / pQuarteredOrWorse / pZero)
    seedFastRandom(20261110);
    const twoBoardStrong = simulateCorrelatedMultiBoardEquity(
      [c('A', 's'), c('A', 'd'), c('K', 's'), c('K', 'd')],
      [
        [c('A', 'h'), c('7', 's'), c('2', 's')],
        [c('A', 'c'), c('K', 'h'), c('3', 'd')],
      ],
      1,
      variantInfo('plo4'),
      120
    );
    const threeBoardWeak = simulateCorrelatedMultiBoardEquity(
      [c('9', 'c'), c('8', 'd'), c('4', 'h'), c('2', 'c')],
      [
        [c('A', 'h'), c('K', 's'), c('Q', 's')],
        [c('A', 'c'), c('K', 'd'), c('J', 'h')],
        [c('T', 's'), c('9', 's'), c('8', 's')],
      ],
      2,
      variantInfo('plo4'),
      120
    );
    for (const res of [twoBoardStrong, threeBoardWeak]) {
      expect(res.pScoop).toBeGreaterThanOrEqual(0);
      expect(res.pQuarteredOrWorse).toBeGreaterThanOrEqual(0);
      expect(res.pZero).toBeGreaterThanOrEqual(0);
      expect(res.pScoop).toBeLessThanOrEqual(res.pHalfOrBetter + 1e-6);
      expect(res.pHalfOrBetter + res.pQuarteredOrWorse + res.pZero).toBeLessThanOrEqual(1.0 + 1e-6);
      const avgBoardEq =
        res.boardEquities.reduce((acc, v) => acc + v, 0) / res.boardEquities.length;
      expect(res.meanEquity).toBeCloseTo(avgBoardEq, 5);
    }
    expect(twoBoardStrong.pScoop).toBeGreaterThan(0.5);
    expect(twoBoardStrong.meanEquity).toBeGreaterThan(threeBoardWeak.meanEquity);
  });

  it('accepts corrective_policy and wager_rules receipt supersession across Phase 10/11/12 and clamps oversized pot-limit raises to maxRaiseTo without collapsing to check/fold', async () => {
    // 1. Receipt supersession across Phase 10 (plo4), Phase 11 (plo5, plo6, plo8), and Phase 12 (short_deck, pineapple, flh, flo8)
    const buildSupersededGraph = (
      supersedingNode: 'corrective_policy' | 'wager_rules'
    ): HorsePolicyGraphReceipt =>
      ({
        version: 'horse-policy-graph-v1',
        initialAction: { action: 'check', amount: null },
        finalAction: { action: 'call', amount: 40 },
        transitions: [
          {
            node: 'variant_policy',
            changed: true,
            before: { action: 'check', amount: null },
            after: { action: 'raise', amount: 120 },
          },
          {
            node: supersedingNode,
            changed: true,
            before: { action: 'raise', amount: 120 },
            after: { action: 'call', amount: 40 },
          },
        ],
      }) as unknown as HorsePolicyGraphReceipt;

    const selectedBeforeSupersession = { action: 'raise', amount: 120 };

    const p10Holder = new HorseQualifiedAuthorityHolder(
      '10101010-1111-4111-8111-111111111111',
      PLO4_POLICY_PACK.version
    );
    p10Holder.apply(admitHorsePhase10LiveAuthority());
    const p10ReceiptBase = {
      mode: 'candidate',
      packVersion: PLO4_POLICY_PACK.version,
      authority: p10Holder.receipt(),
      utilityOwner: 'cash',
      applied: true,
      changed: true,
      selection: 'shadow_change',
      baselineAction: 'check',
      baselineAmount: null,
      proposalAction: 'raise',
      proposalAmount: 120,
      finalAction: 'call',
      finalAmount: 40,
    };

    for (const node of ['wager_rules', 'corrective_policy'] as const) {
      const graph = buildSupersededGraph(node);
      expect(horsePhase10SelectionIsValid(p10ReceiptBase, selectedBeforeSupersession, graph)).toBe(
        true
      );
      expect(
        horsePhase10SelectionIsValid(p10ReceiptBase, selectedBeforeSupersession, undefined)
      ).toBe(false);

      for (const v11 of ['plo5', 'plo6', 'plo8'] as const) {
        const holder11 = new HorseQualifiedAuthorityHolder(
          '11111111-2222-4222-8222-222222222222',
          OMAHA_VARIANT_PACKS[v11].version
        );
        holder11.apply(admitHorsePhase11LiveAuthority(v11));
        const r11 = {
          variant: v11,
          version: OMAHA_VARIANT_PACKS[v11].version,
          inputs: null,
          mode: 'candidate',
          authority: holder11.receipt(),
          utilityOwner: 'cash',
          applied: true,
          changed: true,
          selection: 'shadow_change',
          baselineAction: 'check',
          baselineAmount: null,
          proposalAction: 'raise',
          proposalAmount: 120,
          finalAction: 'call',
          finalAmount: 40,
        };
        expect(
          horsePhase11SelectionIsValid(r11, selectedBeforeSupersession, graph),
          `Phase 11 ${v11} ${node}`
        ).toBe(true);
        expect(
          horsePhase11SelectionIsValid(r11, selectedBeforeSupersession, undefined),
          `Phase 11 ${v11} without graph`
        ).toBe(false);
      }

      for (const v12 of ['short_deck', 'pineapple', 'flh', 'flo8'] as const) {
        const holder12 = new HorseQualifiedAuthorityHolder(
          '12121212-3333-4333-8333-333333333333',
          REMAINING_VARIANT_PACKS[v12].version
        );
        holder12.apply(admitHorsePhase12LiveAuthority(v12));
        const r12 = {
          variant: v12,
          version: REMAINING_VARIANT_PACKS[v12].version,
          inputs: null,
          mode: 'candidate',
          authority: holder12.receipt(),
          utilityOwner: 'cash',
          applied: true,
          changed: true,
          selection: 'shadow_change',
          baselineAction: 'check',
          baselineAmount: null,
          proposalAction: 'raise',
          proposalAmount: 120,
          finalAction: 'call',
          finalAmount: 40,
        };
        expect(
          horsePhase12SelectionIsValid(r12, selectedBeforeSupersession, graph),
          `Phase 12 ${v12} ${node}`
        ).toBe(true);
        expect(
          horsePhase12SelectionIsValid(r12, selectedBeforeSupersession, undefined),
          `Phase 12 ${v12} without graph`
        ).toBe(false);
      }
    }

    // End-to-end horseDecisionReceiptIsValid check on a live worker PLO4 FAST_RESULT decision
    liveHorseFeatureAuthority.refresh();
    liveHorsePhase10Authority.refresh();
    liveHorsePhase13Authorities.plo4.refresh();
    const outMessages: HorseDecisionWorkerResponse[] = [];
    const spotWorker = new HorseDecisionWorkerRuntime((m) => outMessages.push(m), {
      ...defaults,
      startServices: async () => defaults.workerReadiness(),
      stopServices: async () => {},
      journalEnabled: () => false,
      journalAcceptedHand: () => {},
      journalLifecycle: () => {},
      noteFeature: () => {},
      noteDecision: () => {},
    });
    await spotWorker.start();
    const spotConfig: HandConfig = {
      tableId: '33333333-3333-4333-8333-333333333333',
      handNumber: 2,
      gameVariant: 'plo4',
      smallBlind: 1,
      bigBlind: 2,
      rakeConfig: { percent: 5, cap: 6, noFlopNoDrop: true },
    } as HandConfig;
    const spotHc = new HandController(
      spotConfig,
      [
        {
          seat: 1,
          user_id: '00000000-0000-4000-8000-000000000101',
          username: 'Horse101',
          stack: 200,
          bet: 0,
          totalInvested: 0,
          cards: [],
          is_folded: false,
          is_all_in: false,
          is_sitting_out: false,
          is_horse: true,
        },
        {
          seat: 2,
          user_id: '00000000-0000-4000-8000-000000000102',
          username: 'Horse102',
          stack: 200,
          bet: 0,
          totalInvested: 0,
          cards: [],
          is_folded: false,
          is_all_in: false,
          is_sitting_out: false,
          is_horse: true,
        },
      ] as SeatPlayer[],
      1
    );
    spotHc.start();
    const spot = controllerDecisionState(spotHc, 'plo4' as never, 'cash', spotConfig)!;
    expect(spot).not.toBeNull();
    spot.state.smallBlind = 1;
    spot.state.bigBlind = 2;
    spot.state.ante = 0;
    spot.state.bigBlindAnte = false;
    spot.state.allInOrFold = false;
    spot.state.bbjConfig = null;
    spot.state.commitmentCapRemaining = applyTableCommitmentCap(
      spotHc.getAuthoritativeActionState(spot.hero.user_id)!,
      spot.hero,
      false,
      0,
      2
    ).commitmentCapRemaining;
    const spotExec = resolveHorseHybridExecutionProfile(null, spot.hero.user_id, 'cash');
    const spotReq = {
      type: 'DECIDE_FAST' as const,
      requestId: 901,
      generation: 1,
      fence: `33333333-3333-4333-8333-333333333333:2:${spot.hero.seat}:0:1`,
      decisionKey: '',
      decisionTimeMs: Date.UTC(2026, 10, 10, 19, 0, 0),
      player: spot.hero,
      gameState: spot.state,
      style: spotExec.style,
      mods: spotExec.mods,
      handJournalContext: captureHorseHandJournalContext(spot.state.actionHistory!),
    };
    spotReq.decisionKey = buildHorseDecisionKey(spotReq);
    const beforeLen = outMessages.length;
    spotWorker.receive(spotReq);
    await spotWorker.drain();
    const fastRes = outMessages.slice(beforeLen).find((m) => m.type === 'FAST_RESULT') as
      | (HorseDecisionWorkerResponse & { decision: HorseDecision })
      | undefined;
    expect(fastRes).toBeDefined();
    if (fastRes) {
      expect(horseDecisionReceiptIsValid(fastRes.decision, 'plo4')).toBe(true);
    }

    // 2. Pot-limit legalizer clamps oversized raises (amount > maxRaiseTo) cleanly to maxRaiseTo
    //    instead of promoting to an illegal 'all_in' or collapsing to 'check'/'fold'!
    vi.useFakeTimers();
    try {
      const tableId = '44444444-4444-4444-8444-444444444444';
      const horseId = '00000000-0000-4000-8000-000000000201';
      const oppId = '00000000-0000-4000-8000-000000000202';
      const engine = new ServerTableEngine(tableId) as any;
      engine.running = true;
      engine.isCurrentEngine = () => true;
      engine.lifecycleCanMutate = () => true;
      engine.getEngineLeaseAuthority = () => ({ verified: true, generation: 1 });
      engine.handCount = 2;
      engine.tableInfo = {
        game_variant: 'plo4',
        small_blind: 50,
        big_blind: 100,
        action_time_seconds: 15,
        tournament_id: null,
      };
      const horseSeat = {
        seat_number: 1,
        user_id: horseId,
        username: 'PotLimitHorse',
        stack: 10_000,
        is_horse: true,
      };
      const oppSeat = {
        seat_number: 2,
        user_id: oppId,
        username: 'OppHuman',
        stack: 10_000,
        is_horse: false,
      };
      engine.seatedPlayers = [horseSeat, oppSeat];

      const hc = new HandController(
        {
          tableId,
          handNumber: 2,
          gameVariant: 'plo4',
          smallBlind: 50,
          bigBlind: 100,
          rakeConfig: { percent: 0, cap: 0, noFlopNoDrop: true },
        } as HandConfig,
        [
          {
            seat: 1,
            user_id: horseId,
            username: 'PotLimitHorse',
            stack: 10_000,
            bet: 0,
            totalInvested: 0,
            cards: [],
            is_folded: false,
            is_all_in: false,
            is_sitting_out: false,
          },
          {
            seat: 2,
            user_id: oppId,
            username: 'OppHuman',
            stack: 10_000,
            bet: 0,
            totalInvested: 0,
            cards: [],
            is_folded: false,
            is_all_in: false,
            is_sitting_out: false,
          },
        ] as SeatPlayer[],
        2
      );
      hc.start();
      const rawHc = (hc as any).state;
      rawHc.stage = 'flop';
      rawHc.pot = 400;
      rawHc.currentBet = 100;
      rawHc.minRaise = 100;
      rawHc.currentPlayerSeat = 1;
      rawHc.communityCards = [c('K', 'd'), c('7', 'c'), c('2', 's')];
      rawHc.players[0].cards = [c('A', 's'), c('A', 'h'), c('K', 's'), c('Q', 'h')];
      rawHc.players[0].stack = 9_800;
      rawHc.players[0].bet = 0;
      rawHc.players[0].totalInvested = 200;
      rawHc.players[1].stack = 9_700;
      rawHc.players[1].bet = 100;
      rawHc.players[1].totalInvested = 300;
      const liveState = hc.getState();
      const authBefore = hc.getAuthoritativeActionState(horseId)!;
      expect(authBefore.canAct).toBe(true);
      expect(authBefore.legalActions).toEqual(['fold', 'call', 'raise', 'all_in']);
      expect(authBefore.toCall).toBe(100);
      expect(authBefore.minRaiseTo).toBe(200);
      expect(authBefore.maxRaiseTo).toBeGreaterThanOrEqual(500);
      const expectedMaxRaise = authBefore.maxRaiseTo!;

      // Negative proof (e): unmocked HandController rejects an un-clamped over-pot raise on a deep pot-limit flop
      expect(hc.performAction(1, 'raise', 9800)).toBe(false);
      // Negative proof (d): unmocked HandController rejects fractional wager when chipUnit === 1
      const intHc = new HandController(
        {
          tableId,
          handNumber: 3,
          gameVariant: 'plo4',
          smallBlind: 50,
          bigBlind: 100,
          isTournament: true,
          chipUnit: 1,
          rakeConfig: { percent: 0, cap: 0, noFlopNoDrop: true },
        } as HandConfig,
        [
          {
            seat: 1,
            user_id: horseId,
            username: 'PotLimitHorse',
            stack: 10_000,
            bet: 0,
            totalInvested: 0,
            cards: [],
            is_folded: false,
            is_all_in: false,
            is_sitting_out: false,
          },
          {
            seat: 2,
            user_id: oppId,
            username: 'OppHuman',
            stack: 10_000,
            bet: 0,
            totalInvested: 0,
            cards: [],
            is_folded: false,
            is_all_in: false,
            is_sitting_out: false,
          },
        ] as SeatPlayer[],
        2
      );
      intHc.start();
      const intActorSeat = intHc.getState().currentPlayerSeat!;
      expect(intHc.performAction(intActorSeat, 'raise', 250.5)).toBe(false);

      engine.handController = hc;
      engine.disconnectEngine = { isSittingOut: () => false, recordPlayerActed: vi.fn() };
      engine.timeBankEngine = {
        isAutoActivateEnabled: () => true,
        isArmed: () => false,
        getPlayerBank: () => null,
        playerActed: vi.fn(),
      };
      engine.humansSeated = () => 1;
      engine.tableFormat = () => 'cash';
      engine.markProgress = vi.fn();

      const fakeWorker = {
        decideFast: vi.fn(async (snap: any) => ({
          type: 'FAST_RESULT',
          requestId: 1,
          generation: snap.generation,
          fence: snap.fence,
          decision: {
            action: 'raise',
            amount: 9800.5,
            thinkTime: 100,
          },
          effects: [],
          planBinding: null,
          planIssueDisposition: 'no_effects',
          rngBefore: 1,
          rngAfter: 2,
          computeMs: 2,
          governorScale: 1,
        })),
        commitDecisionEffects: vi.fn(async () => ({ type: 'ACK' })),
        runWithDispatchBarrier: <T>(fn: () => T): T => fn(),
      };
      const laneMod = await import('./horseDecision/index.js');
      vi.spyOn(laneMod, 'getLiveHorseDecisionWorker').mockReturnValue(fakeWorker as any);

      resetBrainWatchcountersForTest();
      engine.scheduleHorseAction(horseSeat, 1, liveState.players[0], liveState);
      await vi.advanceTimersByTimeAsync(1_500);

      // Unmocked HandController accepted the clamped pot-limit raise!
      const committedFlopActions = hc
        .getState()
        .actionHistory.filter((a) => a.stage === 'flop' && a.seat === 1);
      expect(committedFlopActions).toHaveLength(1);
      expect(committedFlopActions[0]).toMatchObject({
        seat: 1,
        action: 'raise',
        amount: expectedMaxRaise,
      });
      // Semantic separation: normal pot-limit clamp increments action_clamped ONLY, not legalizer_degraded
      expect(
        peekBrainWatchcounters().poker_horse_action_clamped_total.total
      ).toBeGreaterThanOrEqual(1);
      expect(peekBrainWatchcounters().poker_horse_legalizer_degraded_total.total).toBe(0);
      expect(
        peekBrainWatchcounters().poker_horse_telemetry_opportunities_total.total
      ).toBeGreaterThanOrEqual(1);
    } finally {
      vi.restoreAllMocks();
      vi.useRealTimers();
    }
  });

  it('verifies HorseUpgradeActivationManifest contract, worker manifest handshake, Short Deck card-removal, and PREWARM_STREET RNG invariance', async () => {
    // 1. Production Activation Release Contract (HorseUpgradeActivationManifest)
    const manifest = computeHorseUpgradeActivationManifest();
    expect(manifest.schema).toBe(HORSE_UPGRADE_MANIFEST_SCHEMA);
    expect(manifest.version).toBe(HORSE_UPGRADE_MANIFEST_VERSION);
    expect(manifest.upgrades.length).toBe(16);
    expect(manifest.authorities.features.status).toBe('refused');
    expect(manifest.authorities.tournamentFlags.status).toBe('refused');
    expect(manifest.authorities.phase8.status).toBe('admitted');
    expect(manifest.authorities.phase10.status).toBe('admitted');
    expect(
      manifest.upgrades.find(
        (u: HorseUpgradeCapabilityEntry) => u.id.includes('upgrade_07') || u.id.includes('cover')
      )?.enabled
    ).toBe(true);

    // Worker READY handshake includes matching upgradeManifest; stale/missing worker manifest is rejected
    const workerOut: HorseDecisionWorkerResponse[] = [];
    const w = new HorseDecisionWorkerRuntime((m) => workerOut.push(m), {
      ...defaults,
      startServices: async () => defaults.workerReadiness(),
      stopServices: async () => {},
    });
    await w.start();
    const ready = workerOut.find((m) => m.type === 'READY') as
      | (HorseDecisionWorkerResponse & { upgradeManifest?: typeof manifest })
      | undefined;
    expect(ready?.upgradeManifest).toBeDefined();
    expect(
      verifyWorkerUpgradeManifestCompatibility(manifest, ready?.upgradeManifest).compatible
    ).toBe(true);
    expect(verifyWorkerUpgradeManifestCompatibility(manifest, null)).toEqual({
      compatible: false,
      reason: 'worker_manifest_missing',
    });
    expect(verifyWorkerUpgradeManifestCompatibility(manifest, { schema: 'malformed' })).toEqual({
      compatible: false,
      reason: 'worker_manifest_invalid',
    });
    expect(
      verifyWorkerUpgradeManifestCompatibility(manifest, {
        ...manifest,
        version: '2025-01-01.v0',
      })
    ).toEqual({
      compatible: false,
      reason: 'worker_manifest_version_mismatch',
    });
    expect(
      verifyWorkerUpgradeManifestCompatibility(manifest, {
        ...manifest,
        manifestDigest: 'f'.repeat(64),
      })
    ).toEqual({
      compatible: false,
      reason: 'worker_manifest_digest_mismatch',
    });
    // 8/8 worker shard pool verification + replacement recovery
    const eightWorkerRuntimes: HorseDecisionWorkerRuntime[] = [];
    for (let shard = 0; shard < 8; shard++) {
      const shardOut: HorseDecisionWorkerResponse[] = [];
      const shardRuntime = new HorseDecisionWorkerRuntime((m) => shardOut.push(m), {
        ...defaults,
        startServices: async () => defaults.workerReadiness(),
        stopServices: async () => {},
      });
      await shardRuntime.start();
      const shardReady = shardOut.find((m) => m.type === 'READY') as
        | (HorseDecisionWorkerResponse & { upgradeManifest?: typeof manifest })
        | undefined;
      expect(
        verifyWorkerUpgradeManifestCompatibility(manifest, shardReady?.upgradeManifest)
      ).toEqual({ compatible: true });
      eightWorkerRuntimes.push(shardRuntime);
    }
    expect(eightWorkerRuntimes).toHaveLength(8);

    enableBrainTelemetry();
    drainFires();
    // Push-adjusted scheduleHorseInsuranceResponse handler: house-vig decline, split-pot pricing accuracy, < fairPremium accept, > fairCashoutEv cashout, preflop vs flop+ decline scope
    vi.useFakeTimers();
    try {
      const runInsScenario = async (offerOverride: Record<string, unknown>) => {
        const calls: Array<{ decision: string; coverage: number; declineForHand: boolean }> = [];
        const insCtx = {
          tableId: 'law-ins-handler-table',
          running: true,
          handCount: 4,
          seatedPlayers: [{ user_id: 'horse-leader', is_horse: true }],
          isOwnClientControlling: () => false,
          lifecycleCanMutate: () => true,
          setHandTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
          insuranceEngine: {
            getOffers: () => [
              {
                playerId: 'horse-leader',
                status: 'offered',
                equity: 40,
                fullInsuredAmount: 100,
                fullPremium: 315,
                boardLength: 3,
                pricing: {
                  equityPct: 40,
                  strictLossPct: 30,
                  pushPct: 60,
                  strictWinPct: 10,
                  lossGivenNoPush: 0.75,
                  winGivenNoPush: 0.25,
                  exact: true,
                  runouts: 40,
                  houseMargin: 1.05,
                  maxInsurablePercent: 100,
                  insurablePot: 100,
                  fullInsuredAmount: 100,
                  fullPremium: 315,
                },
                ...offerOverride,
              },
            ],
          },
          respondToInsurance: (
            _pid: string,
            decision: string,
            coverage: number,
            declineForHand: boolean
          ) => {
            calls.push({ decision, coverage, declineForHand });
          },
        };
        (ServerTableEngine.prototype as any).scheduleHorseInsuranceResponse.call(
          insCtx,
          'horse-leader'
        );
        await vi.advanceTimersByTimeAsync(1_500);
        return calls;
      };

      // (a) Standard house-vig offer on flop (boardLength=3): declined for the entire hand
      expect(await runInsScenario({})).toEqual([
        { decision: 'decline', coverage: 100, declineForHand: true },
      ]);
      // (b) Standard house-vig offer preflop (boardLength=0): declined for the current street only
      expect(await runInsScenario({ boardLength: 0 })).toEqual([
        { decision: 'decline', coverage: 100, declineForHand: false },
      ]);
      // (c) High-push split-board favorable premium (200 < push-adjusted fairPremium 300, even though naive (1-0.4)/0.4*100 = 150!): accepted!
      expect(await runInsScenario({ fullPremium: 200 })).toEqual([
        { decision: 'accept', coverage: 100, declineForHand: false },
      ]);
      // (d) Favorable EV cashout (> insurablePot * 0.40 = 40): cashed out!
      expect(await runInsScenario({ evCashoutAmount: 42 })).toEqual([
        { decision: 'cashout', coverage: 100, declineForHand: false },
      ]);
      // Upgrade 08 evidence: each of the four answers above was counted where it was sent.
      const insuranceFires = Object.fromEntries(
        drainFires()
          .filter((f) => f.feature.startsWith('upgrade08_insurance_'))
          .map((f) => [f.feature, f.fires])
      );
      expect(insuranceFires).toEqual({
        // Opportunity: one per offer to the Horse leader; the answers sum to it here.
        upgrade08_insurance_offered_seen: 4,
        upgrade08_insurance_decline_seen: 2,
        upgrade08_insurance_accept_seen: 1,
        upgrade08_insurance_cashout_seen: 1,
      });
    } finally {
      vi.useRealTimers();
    }

    // 2. PREWARM_STREET preserves fastRandom PRNG sequence identically (zero RNG mutation)
    _clearGtoPostflop();
    seedFastRandom(987654321);
    const expectedR1 = fastRandom();
    const expectedR2 = fastRandom();

    seedFastRandom(987654321);
    w.receive({
      type: 'PREWARM_STREET',
      fence: 'prewarm-rng-law',
      street: 'flop',
      board: [c('A', 's'), c('K', 's'), c('7', 'd')],
      variant: 'nlh',
      mode: 'cash',
      effectiveStackBB: 100,
    } as any);
    await w.drain();
    expect(fastRandom()).toBe(expectedR1);
    expect(fastRandom()).toBe(expectedR2);

    // 3. Short Deck card removal recognizes 6-through-A deck & A-6-7-8-9 wheel nut straight
    const sdWheel = scoreCardRemoval(
      [c('9', 'd'), c('Q', 'c')],
      [c('A', 's'), c('6', 'h'), c('7', 'd'), c('K', 'c')],
      variantInfo('short_deck')
    );
    expect(sdWheel.blocksNutStraight).toBe(true);
  });
});
