/**
 * Test support shared by the Horse matrix laws (2026-11-14).
 *
 * The production decision path, one cell at a time: a real HandController
 * deals a heads-up hand and is walked passively to the flop, and the request
 * goes through HorseDecisionWorkerRuntime DECIDE_FAST (the only production
 * caller of HorseLogic.decide) with the production telemetry wiring
 * (noteFeature = noteFire). The counters the decision fired come back with it.
 *
 * Moved verbatim out of HorseStyleVariantModeMatrix.law.test.ts so
 * HorseUpgradeManifestRuntimeParity.law.test.ts measures runtime
 * applicability with the same harness instead of a copy of it. No assertion
 * of that law changed in the move.
 */
import { expect } from 'vitest';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { HandController } from './HandController.js';
import type { Deck } from './PokerEngine.js';
import { seedFastRandom } from './HorseEval.js';
import type { HorseHybridMode, resolveHorseHybridProfile } from './HorseHybridProfile.js';
import { HorseMind } from './HorseMind.js';
import { buildTournamentMState } from './HorseTournamentPreflop.js';
import { captureHorseHandJournalContext } from './HorseDecisionHandBinding.js';
import { applyTableCommitmentCap } from './ServerTableEngineTurns.js';
import {
  buildHorseDecisionKey,
  type HorseDecisionWorkerResponse,
} from './horseDecision/protocol.js';
import {
  defaultHorseDecisionWorkerDependencies as defaults,
  HorseDecisionWorkerRuntime,
} from './horseDecision/workerRuntime.js';
import {
  controllerDecisionState,
  controllerSpotRandom,
  type ControllerSpot,
} from './remainingVariants/RemainingVariantControllerSpots.test-support.js';
import type { HandConfig, HorseDecision, HorseStyle, SeatPlayer } from '../types.js';

export const VARIANTS = [
  'nlh',
  'plo4',
  'plo5',
  'plo6',
  'plo8',
  'flo8',
  'flh',
  'short_deck',
  'pineapple',
] as const;
export type Variant = (typeof VARIANTS)[number];
export const MODES = ['cash', 'tournament'] as const satisfies readonly HorseHybridMode[];

let worker: HorseDecisionWorkerRuntime;
const messages: HorseDecisionWorkerResponse[] = [];
let requestId = 1;

/** Call from beforeAll: the one worker every cell of the file decides through. */
export async function startMatrixWorker(): Promise<void> {
  enableBrainTelemetry();
  worker = new HorseDecisionWorkerRuntime((m) => messages.push(m), {
    ...defaults,
    startServices: async () => defaults.workerReadiness(),
    stopServices: async () => {},
    journalEnabled: () => false,
    journalAcceptedHand: () => {},
    journalLifecycle: () => {},
    noteDecision: () => {},
    // noteFeature is left at its production binding (noteFire), so the
    // worker's own evidence lands in the same counters the brain's does.
  });
  await worker.start();
}

/** Call from afterAll. */
export async function stopMatrixWorker(): Promise<void> {
  await worker.drain();
  HorseMind.reset();
  drainFires();
}

export interface FlopSpot {
  spot: ControllerSpot;
  controller: HandController;
  config: HandConfig;
}

/** A heads-up hand the controller dealt and both seats took passively to the flop. */
export function dealToFlop(variant: Variant, mode: HorseHybridMode, cell: number): FlopSpot {
  const smallBlind = mode === 'tournament' ? 10 : 1;
  const bigBlind = mode === 'tournament' ? 20 : 2;
  const tableId = `77000000-0000-4000-8000-${String(cell + 1).padStart(12, '0')}`;
  const config = {
    tableId,
    handNumber: 12,
    gameVariant: variant,
    smallBlind,
    bigBlind,
    isTournament: mode === 'tournament',
    chipUnit: mode === 'tournament' ? 1 : 0.01,
    rakeConfig: { percent: mode === 'cash' ? 5 : 0, cap: bigBlind * 3, noFlopNoDrop: true },
  } as HandConfig;
  const players: SeatPlayer[] = [137.5, 84].map(
    (depth, idx) =>
      ({
        seat: idx + 1,
        user_id: `78000000-0000-4000-8000-${String(cell * 10 + idx + 1).padStart(12, '0')}`,
        username: `MatrixHorse_${cell}_${idx}`,
        stack: depth * bigBlind,
        bet: 0,
        totalInvested: 0,
        cards: [],
        is_folded: false,
        is_all_in: false,
        is_sitting_out: false,
        is_horse: true,
      }) as SeatPlayer
  );
  const controller = new HandController(config, players, 1);

  // The same seeded physical deck the action-space law deals from.
  const deck = controller.getState().deck as unknown as Deck;
  const cards = deck.getRemainingCards().sort((a, b) => {
    const left = `${a.suit}:${a.rank}`;
    const right = `${b.suit}:${b.rank}`;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const rng = controllerSpotRandom((9100 + variant.charCodeAt(0) * 131) ^ 0x5eedface);
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  deck.deal = (n = 1) => {
    if (cards.length < n) throw new Error('matrix fixture exhausted the physical deck');
    return cards.splice(0, n);
  };
  deck.dealOne = () => deck.deal(1)[0];
  deck.remaining = () => cards.length;
  deck.getRemainingCards = () => cards.slice();

  controller.start();
  for (let step = 0; step < 12; step++) {
    const live = controller.getState();
    if (live.stage === 'pineapple_discard') {
      for (const p of live.players.filter((x) => !x.is_folded && x.cards.length === 3))
        expect(controller.performDiscard(p.seat, 0), `${variant} ${mode} discard`).toBe(true);
      controller.flushPineappleSettle();
      continue;
    }
    if (live.stage !== 'preflop') break;
    const pre = controllerDecisionState(controller, variant as never, mode, config);
    if (!pre) break;
    const passive = pre.state.legalActions?.includes('check') ? 'check' : 'call';
    expect(controller.performAction(pre.hero.seat, passive), `${variant} ${mode} preflop`).toBe(
      true
    );
  }

  const spot = controllerDecisionState(controller, variant as never, mode, config);
  if (!spot) throw new Error(`${variant} ${mode}: the controller offered no flop decision`);
  expect(spot.state.stage, `${variant} ${mode}`).toBe('flop');
  expect(spot.state.communityCards.length, `${variant} ${mode}`).toBe(3);

  const blinds = controller.getBlindSnapshot?.() ?? {
    smallBlind,
    bigBlind,
    ante: 0,
    bigBlindAnte: false,
  };
  spot.state.smallBlind = blinds.smallBlind;
  spot.state.bigBlind = blinds.bigBlind;
  spot.state.ante = blinds.ante;
  spot.state.bigBlindAnte = blinds.bigBlindAnte;
  spot.state.allInOrFold = false;
  spot.state.bbjConfig = spot.state.bbjConfig ?? null;

  if (mode === 'tournament') {
    // A coherent heads-up finish: two players left, both paid, two payouts,
    // and a field that is exactly this table. The tournament utility refuses
    // a context whose payouts or field do not reconcile (invalid_input,
    // field_reconciliation), and a refused context proves nothing about it.
    const live = controller.getState();
    const stackByUser = Object.fromEntries(
      live.players.map((p) => [p.user_id, p.stack + p.totalInvested])
    );
    const stacks = Object.values(stackByUser);
    spot.state.tournament = {
      schemaVersion: 1,
      contextStatus: 'complete',
      contextIssues: [],
      sourceAgeMs: 0,
      tournamentId: `matrix-tourney-${tableId}`,
      tournamentType: 'MTT',
      tournamentStatus: 'RUNNING',
      gameVariant: variant,
      entrants: 18,
      playersLeft: live.players.length,
      spotsPaid: live.players.length,
      avgStackChips: stacks.reduce((a, b) => a + b, 0) / stacks.length,
      medianStackChips: [...stacks].sort((a, b) => a - b)[Math.floor(stacks.length / 2)],
      seatsPerTable: 6,
      playersAtTable: live.players.length,
      currentLevel: 4,
      nearBubble: false,
      inMoney: true,
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
      payoutPct: [65, 35],
      stacks,
      stackByUser,
      currentSmallBlind: smallBlind,
      currentBigBlind: bigBlind,
      currentAnte: 0,
      anteType: 'none',
      nextSmallBlind: bigBlind,
      nextBigBlind: bigBlind * 2,
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
        smallBlind,
        bigBlind,
        ante: 0,
        anteType: 'none',
        playersAtTable: live.players.length,
        nextSmallBlind: bigBlind,
        nextBigBlind: bigBlind * 2,
        nextAnte: 0,
        minutesToNextLevel: 5,
        opponentStacks: live.players
          .filter((p) => p.user_id !== spot.hero.user_id)
          .map((p) => ({ userId: p.user_id, stackChips: p.stack })),
      }),
    } as never;
  }

  spot.state.commitmentCapRemaining = applyTableCommitmentCap(
    controller.getAuthoritativeActionState(spot.hero.user_id)!,
    spot.hero,
    mode === 'tournament',
    0,
    bigBlind
  ).commitmentCapRemaining;

  return { spot, controller, config };
}

export interface CellResult {
  decision: HorseDecision;
  counted: Record<string, number>;
  flop: FlopSpot;
  style: HorseStyle;
  mods: HorseProfile['mods'];
}
export type HorseProfile = ReturnType<typeof resolveHorseHybridProfile>;

/**
 * One DECIDE_FAST through the real worker runtime, with its counters. The
 * profile is resolved for the seat the controller put on the clock, as the
 * live table resolves it for the player whose turn it is.
 */
export async function decideThroughWorker(
  variant: Variant,
  mode: HorseHybridMode,
  cell: number,
  profileFor: (horseId: string) => HorseProfile
): Promise<CellResult> {
  HorseMind.reset();
  seedFastRandom(20261113 + cell);
  const flop = dealToFlop(variant, mode, cell);
  const { spot, config } = flop;
  const { style, mods } = profileFor(spot.hero.user_id);
  const request = {
    type: 'DECIDE_FAST' as const,
    requestId: requestId++,
    generation: 1,
    fence: `${config.tableId}:${config.handNumber}:${spot.hero.seat}:${cell}:1`,
    decisionKey: '',
    decisionTimeMs: Date.UTC(2026, 10, 13, 18, 0, 0) + cell * 1000,
    player: spot.hero,
    gameState: spot.state,
    style,
    mods,
    handJournalContext: captureHorseHandJournalContext(spot.state.actionHistory!),
  };
  request.decisionKey = buildHorseDecisionKey(request);

  drainFires();
  const before = messages.length;
  worker.receive(request);
  await worker.drain();
  const counted = Object.fromEntries(drainFires().map((r) => [r.feature, r.fires]));
  const answers = messages.slice(before);
  const label = `${style} ${variant} ${mode}`;
  // A refusal at the worker's validation boundary is an ERROR message; it
  // must fail here with its own text, never read as "no decision".
  expect(
    answers.filter((m) => m.type === 'ERROR'),
    label
  ).toEqual([]);
  const result = answers.find((m) => m.type === 'FAST_RESULT') as
    | (HorseDecisionWorkerResponse & { decision: HorseDecision })
    | undefined;
  if (!result) throw new Error(`${label}: the worker returned no FAST_RESULT`);
  return { decision: result.decision, counted, flop, style, mods };
}
