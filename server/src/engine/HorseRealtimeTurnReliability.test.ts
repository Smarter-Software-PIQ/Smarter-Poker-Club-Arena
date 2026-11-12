import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  drainBrainWatchcounterDeltas,
  drainFires,
  enableBrainTelemetry,
  mergeBrainWatchcounterDeltas,
  noteHorseActionClamped,
  noteHorseLegalizerDegraded,
  noteHorsePlanReevaluated,
  noteHorseStreetPrewarm,
  peekBrainWatchcounters,
  renderBrainWatchcountersPrometheus,
  resetBrainWatchcountersForTest,
} from './BrainTelemetry.js';
import { HandController } from './HandController.js';
import { ServerTableEngine } from './ServerTableEngine.js';
import { horseDecisionDeadlineMs } from './horseDecision/decisionDeadline.js';
import {
  horsePhase10SelectionIsValid,
  horsePhase11SelectionIsValid,
  horsePhase12SelectionIsValid,
} from './horseDecision/responseValidation.js';
import { LiveHorseDecisionWorkerClient } from './horseDecision/client.js';
import {
  HorseDecisionWorkerRuntime,
  defaultHorseDecisionWorkerDependencies,
} from './horseDecision/workerRuntime.js';
import {
  buildHorseDecisionKey,
  type HorseDecisionWorkerReady,
  type LiveHorseDecisionSnapshot,
} from './horseDecision/protocol.js';
import { HorseQualifiedAuthorityHolder } from './HorseQualifiedAuthority.js';
import { admitHorsePhase10LiveAuthority } from './HorsePhase10Authority.js';
import { qualifiedPhase11TestAdmission } from './HorsePhase11Authority.test-support.js';
import { qualifiedPhase12TestAdmission } from './HorsePhase12Authority.test-support.js';
import { OMAHA_VARIANT_PACKS } from './omaha/OmahaVariantPolicyPack.js';
import { REMAINING_VARIANT_PACKS } from './remainingVariants/RemainingVariantPolicyPack.js';
import { PLO4_POLICY_PACK } from './plo4/Plo4PolicyPack.js';
import type { HorsePolicyGraphReceipt } from './HorsePolicyGraph.js';
import type { Card, HandConfig, SeatPlayer } from '../types.js';

const TABLE_ID = '11111111-2222-4333-8444-555555555555';
const HORSE_A = 'aaaa1111-2222-4333-8444-555555555555';
const HUMAN_B = 'bbbb1111-2222-4333-8444-555555555555';

const card = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });

beforeEach(() => {
  resetBrainWatchcountersForTest();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('W1.1 HandController whole-chip & pot-limit action legality across NLH/PLO4/PLO5/PLO6', () => {
  const mkSeats = (stack: number): SeatPlayer[] =>
    [
      {
        seat: 1,
        user_id: HORSE_A,
        username: 'HorseA',
        stack,
        bet: 0,
        totalInvested: 0,
        cards: [],
        is_folded: false,
        is_all_in: false,
        is_sitting_out: false,
      },
      {
        seat: 2,
        user_id: HUMAN_B,
        username: 'HumanB',
        stack,
        bet: 0,
        totalInvested: 0,
        cards: [],
        is_folded: false,
        is_all_in: false,
        is_sitting_out: false,
      },
    ] as SeatPlayer[];

  it.each(['nlh', 'plo4', 'plo5', 'plo6'] as const)(
    'snaps tournament getAuthoritativeActionState bounds to whole safe integers in %s',
    (variant) => {
      const hc = new HandController(
        {
          tableId: TABLE_ID,
          handNumber: 1,
          gameVariant: variant,
          smallBlind: 75,
          bigBlind: 150,
          ante: 19,
          isTournament: true,
          rakeConfig: { percent: 0, cap: 0, noFlopNoDrop: true },
        } as HandConfig,
        mkSeats(4500),
        1
      );
      hc.start();
      const state = hc.getState();
      const actor = state.players.find((p) => p.seat === state.currentPlayerSeat)!;
      // Inject a fractional bet/minRaise drift to prove authoritative snapping
      (hc as any).state.currentBet = 187.5;
      (hc as any).state.minRaise = 112.5;
      const auth = hc.getAuthoritativeActionState(actor.user_id)!;
      expect(auth).not.toBeNull();
      expect(Number.isSafeInteger(auth.toCall)).toBe(true);
      if (auth.minRaiseTo !== null) {
        expect(Number.isSafeInteger(auth.minRaiseTo)).toBe(true);
      }
      if (auth.maxRaiseTo !== null) {
        expect(Number.isSafeInteger(auth.maxRaiseTo)).toBe(true);
      }
    }
  );

  it.each(['plo4', 'plo5', 'plo6'] as const)(
    'clamps deep pot-limit shoves to whole-chip maxRaise in tournament %s and degrades non-reopening shoves to call',
    (variant) => {
      const hc = new HandController(
        {
          tableId: TABLE_ID,
          handNumber: 2,
          gameVariant: variant,
          smallBlind: 50,
          bigBlind: 100,
          isTournament: true,
          rakeConfig: { percent: 0, cap: 0, noFlopNoDrop: true },
        } as HandConfig,
        mkSeats(10_000),
        1
      );
      hc.start();
      const st = hc.getState();
      const firstSeat = st.currentPlayerSeat!;
      // Deep 100bb pot-limit all_in clamps to a whole-chip pot-sized raise and is accepted!
      expect(hc.performAction(firstSeat, 'all_in')).toBe(true);
      const afterRaise = hc.getState();
      const raiser = afterRaise.players.find((p) => p.seat === firstSeat)!;
      expect(Number.isSafeInteger(raiser.bet)).toBe(true);
      expect(raiser.bet).toBeLessThan(10_000);
    }
  );
});

describe('W1.1 ServerTableEngineTurns pre-commit legalizer & side-game snapshot forwarding', () => {
  it.each([
    { variant: 'plo4', isTournament: false },
    { variant: 'plo5', isTournament: false },
    { variant: 'plo6', isTournament: true },
    { variant: 'nlh', isTournament: true },
  ] as const)(
    'clamps oversized whole-stack raises into [minRaiseTo, maxRaiseTo] without promoting to an illegal shove (%j)',
    async ({ variant, isTournament }) => {
      vi.useFakeTimers();
      const engine = new ServerTableEngine(TABLE_ID) as any;
      engine.running = true;
      engine.isCurrentEngine = () => true;
      engine.lifecycleCanMutate = () => true;
      engine.getEngineLeaseAuthority = () => ({ verified: true, generation: 9 });
      engine.handCount = 4;
      engine.tableInfo = {
        game_variant: variant,
        small_blind: 50,
        big_blind: 100,
        action_time_seconds: 15,
        tournament_id: isTournament ? 'tourney-1' : null,
        seven_deuce_enabled: !isTournament,
        seven_deuce_amount: 3,
      };
      const horsePlayer = {
        seat_number: 1,
        user_id: HORSE_A,
        username: 'HorseA',
        stack: 10_000,
        is_horse: true,
      };
      const humanPlayer = {
        seat_number: 2,
        user_id: HUMAN_B,
        username: 'HumanB',
        stack: 10_000,
        is_horse: false,
      };
      engine.seatedPlayers = [horsePlayer, humanPlayer];

      const holeCount = variant === 'nlh' ? 2 : variant === 'plo4' ? 4 : variant === 'plo5' ? 5 : 6;
      const holeCards = [
        card('A', 'spades'),
        card('A', 'hearts'),
        card('K', 'spades'),
        card('Q', 'hearts'),
        card('J', 'spades'),
        card('T', 'hearts'),
      ].slice(0, holeCount);

      const hc = new HandController(
        {
          tableId: TABLE_ID,
          handNumber: 4,
          gameVariant: variant,
          smallBlind: 50,
          bigBlind: 100,
          isTournament,
          rakeConfig: { percent: 0, cap: 0, noFlopNoDrop: true },
        } as HandConfig,
        [
          {
            seat: 1,
            user_id: HORSE_A,
            username: 'HorseA',
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
            user_id: HUMAN_B,
            username: 'HumanB',
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
      const rawHcState = (hc as any).state;
      rawHcState.stage = 'flop';
      rawHcState.pot = 400;
      rawHcState.currentBet = 100;
      rawHcState.minRaise = 100;
      rawHcState.currentPlayerSeat = 1;
      rawHcState.communityCards = [card('K', 'diamonds'), card('7', 'clubs'), card('2', 'spades')];
      rawHcState.players[0].cards = holeCards;
      rawHcState.players[0].stack = 9_800;
      rawHcState.players[0].bet = 0;
      rawHcState.players[0].totalInvested = 200;
      rawHcState.players[1].stack = 9_700;
      rawHcState.players[1].bet = 100;
      rawHcState.players[1].totalInvested = 300;
      if (!isTournament) {
        rawHcState.killPot = { killerSeat: 2, multiplier: 2, minPotThreshold: 1000 };
        rawHcState.straddleSeat = 2;
      }
      const liveState = hc.getState();

      vi.spyOn(hc, 'getAuthoritativeActionState').mockReturnValue({
        schemaVersion: 1,
        heroSeat: 1,
        currentPlayerSeat: 1,
        canAct: true,
        // Pot-limit / capped spot: 'raise' up to 600 is legal, 'all_in' is NOT offered!
        legalActions: ['fold', 'call', 'raise'],
        toCall: 100,
        minRaiseTo: 200,
        maxRaiseTo: 600,
        structure: variant === 'nlh' ? 'no_limit' : 'pot_limit',
        fixedBetSize: null,
        wagersCapped: false,
      });
      const acceptedCalls: Array<{ seat: number; action: string; amount: number | undefined }> = [];
      vi.spyOn(hc, 'performAction').mockImplementation(
        (
          seat: number,
          action: string,
          amount?: number,
          _origin?: string,
          onAccepted?: (rec: any) => void
        ) => {
          if (isTournament && amount !== undefined && !Number.isSafeInteger(amount)) {
            return false;
          }
          if (action === 'all_in') return false;
          if (action === 'raise' && (amount === undefined || amount < 200 || amount > 600)) {
            return false;
          }
          acceptedCalls.push({ seat, action, amount });
          onAccepted?.({
            seat,
            user_id: HORSE_A,
            action,
            amount: amount ?? 100,
            stage: 'flop',
            timestamp: Date.now(),
          });
          return true;
        }
      );
      engine.handController = hc;
      engine.disconnectEngine = { isSittingOut: () => false, recordPlayerActed: vi.fn() };
      engine.timeBankEngine = {
        isAutoActivateEnabled: () => true,
        isArmed: () => false,
        getPlayerBank: () => null,
        playerActed: vi.fn(),
      };
      engine.humansSeated = () => 1;
      engine.tableFormat = () => (isTournament ? 'mtt' : 'cash');
      engine.markProgress = vi.fn();

      let capturedSnapshot: any = null;
      const fakeWorker = {
        decideFast: vi.fn(async (snap: any) => {
          capturedSnapshot = snap;
          return {
            type: 'FAST_RESULT',
            requestId: 1,
            generation: snap.generation,
            fence: snap.fence,
            // Brain proposes whole-stack + fractional 9800.5 -> must clamp cleanly to 600!
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
          };
        }),
        commitDecisionEffects: vi.fn(async () => ({ type: 'ACK' })),
        runWithDispatchBarrier: <T>(fn: () => T): T => fn(),
      };
      const laneMod = await import('./horseDecision/index.js');
      vi.spyOn(laneMod, 'getLiveHorseDecisionWorker').mockReturnValue(fakeWorker as any);

      engine.scheduleHorseAction(horsePlayer, 1, liveState.players[0], liveState);
      await vi.advanceTimersByTimeAsync(1_500);

      expect(acceptedCalls).toEqual([{ seat: 1, action: 'raise', amount: 600 }]);
      const counters = peekBrainWatchcounters();
      expect(counters.poker_horse_action_clamped_total.total).toBeGreaterThanOrEqual(1);
      expect(counters.poker_horse_legalizer_degraded_total.total).toBeGreaterThanOrEqual(1);

      if (!isTournament) {
        expect(capturedSnapshot?.gameState?.sevenDeuceEnabled).toBe(true);
        expect(capturedSnapshot?.gameState?.sevenDeuceBountyBB).toBe(3);
        expect(capturedSnapshot?.gameState?.killPot).toMatchObject({ multiplier: 2 });
        expect(capturedSnapshot?.gameState?.straddleSeat).toBe(2);
      }
    }
  );

  it('populates gameState.killPot and gameState.straddleSeat from real HandController getKillHandState() + getLastStraddleSeat()', async () => {
    vi.useFakeTimers();
    try {
      const engine = new ServerTableEngine(TABLE_ID) as any;
      engine.running = true;
      engine.isCurrentEngine = () => true;
      engine.lifecycleCanMutate = () => true;
      engine.getEngineLeaseAuthority = () => ({ verified: true, generation: 11 });
      engine.handCount = 19;
      engine.currentHandNumber = 19;
      engine.disconnectEngine = { isSittingOut: () => false, recordPlayerActed: vi.fn() };
      engine.timeBankEngine = {
        isAutoActivateEnabled: () => true,
        isArmed: () => false,
        getPlayerBank: () => null,
        playerActed: vi.fn(),
      };
      engine.humansSeated = () => 2;
      engine.tableInfo = {
        small_blind: 1,
        big_blind: 2,
        game_variant: 'flh',
        action_time_seconds: 15,
        straddle_enabled: true,
        seven_deuce_enabled: true,
        seven_deuce_amount: 4,
      };
      const killState = {
        ruleVersion: 'kill-v1' as const,
        mode: 'full' as const,
        multiplier: { num: 2 as const, den: 1 as const },
        baseBigBlind: 2,
        smallBet: 4,
        bigBet: 8,
        killBlind: 4,
        killerUserId: HUMAN_B,
        killerSeat: 2,
        killerBlindSlot: 'none' as const,
        triggerHandId: null,
        triggerHandNumber: 18,
        chained: false,
        thresholdBb: 10,
      };
      const hc = new HandController(
        {
          tableId: TABLE_ID,
          handNumber: 19,
          gameVariant: 'flh',
          smallBlind: 1,
          bigBlind: 2,
          ante: 0,
          isTournament: false,
          rakeConfig: { percent: 0, cap: 0, noFlopNoDrop: true },
          killPot: killState,
          straddles: [{ seat: 3, amount: 8 }],
        } as HandConfig,
        [
          {
            seat: 1,
            user_id: HORSE_A,
            username: 'Horse1',
            stack: 400,
            bet: 0,
            totalInvested: 0,
            cards: [],
            is_folded: false,
            is_all_in: false,
            is_sitting_out: false,
          },
          {
            seat: 2,
            user_id: HUMAN_B,
            username: 'Villain2',
            stack: 400,
            bet: 0,
            totalInvested: 0,
            cards: [],
            is_folded: false,
            is_all_in: false,
            is_sitting_out: false,
          },
          {
            seat: 3,
            user_id: '33333333-3333-4333-8333-333333333333',
            username: 'Villain3',
            stack: 400,
            bet: 0,
            totalInvested: 0,
            cards: [],
            is_folded: false,
            is_all_in: false,
            is_sitting_out: false,
          },
        ] as SeatPlayer[],
        3
      );
      hc.start();
      const realState = hc.getState();
      // Prove real HandController.getState() does NOT carry killPot/straddleSeat directly:
      expect((realState as unknown as Record<string, unknown>).killPot).toBeUndefined();
      expect((realState as unknown as Record<string, unknown>).straddleSeat).toBeUndefined();
      expect(hc.getKillHandState()).toEqual(killState);
      expect(hc.getLastStraddleSeat()).toBe(3);

      const horseSeat = realState.currentPlayerSeat;
      const horseSeatPlayer = realState.players.find((p) => p.seat === horseSeat)!;
      const seatedHorse = {
        seat_number: horseSeat,
        user_id: horseSeatPlayer.user_id,
        username: horseSeatPlayer.username,
        stack: horseSeatPlayer.stack,
        is_sitting_out: false,
        is_horse: true,
      };
      engine.seatedPlayers = realState.players.map((p) => ({
        seat_number: p.seat,
        user_id: p.user_id,
        username: p.username,
        stack: p.stack,
        is_sitting_out: false,
        is_horse: p.seat === horseSeat,
      }));
      engine.handController = hc;
      engine.tableFormat = () => 'cash';
      engine.markProgress = vi.fn();

      let capturedSnapshot: any = null;
      const fakeWorker = {
        decideFast: vi.fn(async (snap: any) => {
          capturedSnapshot = snap;
          return {
            type: 'FAST_RESULT',
            requestId: 1,
            generation: snap.generation,
            fence: snap.fence,
            decision: { action: 'call', amount: 8, thinkTime: 100 },
            effects: [],
            planBinding: null,
            planIssueDisposition: 'no_effects',
            rngBefore: 1,
            rngAfter: 2,
            computeMs: 1,
            governorScale: 1,
          };
        }),
        commitDecisionEffects: vi.fn(async () => ({ type: 'ACK' })),
        runWithDispatchBarrier: <T>(fn: () => T): T => fn(),
      };
      const laneMod = await import('./horseDecision/index.js');
      vi.spyOn(laneMod, 'getLiveHorseDecisionWorker').mockReturnValue(fakeWorker as any);

      engine.scheduleHorseAction(seatedHorse, horseSeat, horseSeatPlayer, realState);
      await vi.advanceTimersByTimeAsync(1_500);

      expect(capturedSnapshot?.gameState?.killPot).toEqual(killState);
      expect(capturedSnapshot?.gameState?.straddleSeat).toBe(3);
      expect(capturedSnapshot?.gameState?.sevenDeuceEnabled).toBe(true);
      expect(capturedSnapshot?.gameState?.sevenDeuceBountyBB).toBe(4);
    } finally {
      vi.restoreAllMocks();
      vi.useRealTimers();
    }
  });
});

describe('W1.2 responseValidation supersession across Phase 10/11/12 variants', () => {
  function makeSupersededGraph(
    supersedingNode: 'corrective_policy' | 'wager_rules'
  ): HorsePolicyGraphReceipt {
    return {
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
    } as unknown as HorsePolicyGraphReceipt;
  }

  it('accepts corrective_policy and wager_rules supersession on Phase 10 (plo4), Phase 11 (plo5/plo6/plo8), and Phase 12 (short_deck/pineapple)', () => {
    const p10Holder = new HorseQualifiedAuthorityHolder(
      '10101010-1111-4111-8111-111111111111',
      PLO4_POLICY_PACK.version
    );
    p10Holder.apply(admitHorsePhase10LiveAuthority());
    const p10Auth = p10Holder.receipt();
    expect(p10Auth.state).toBe('usable');

    const p11Holder = new HorseQualifiedAuthorityHolder(
      '11111111-2222-4222-8222-222222222222',
      OMAHA_VARIANT_PACKS.plo5.version
    );
    p11Holder.apply(qualifiedPhase11TestAdmission('plo5'));
    const p11Plo5Auth = p11Holder.receipt();
    expect(p11Plo5Auth.state).toBe('usable');

    const p12Holder = new HorseQualifiedAuthorityHolder(
      '12121212-3333-4333-8333-333333333333',
      REMAINING_VARIANT_PACKS.short_deck.version
    );
    p12Holder.apply(qualifiedPhase12TestAdmission('short_deck'));
    const p12SdAuth = p12Holder.receipt();
    expect(p12SdAuth.state).toBe('usable');

    for (const node of ['corrective_policy', 'wager_rules'] as const) {
      const graph = makeSupersededGraph(node);
      // `selected` at responseValidation.ts:1161 carries beforeNuts (the variant's proposal)
      const selectedDecision = { action: 'raise', amount: 120 };

      const p10Receipt = {
        mode: 'candidate',
        packVersion: PLO4_POLICY_PACK.version,
        authority: p10Auth,
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
      expect(horsePhase10SelectionIsValid(p10Receipt, selectedDecision, graph)).toBe(true);
      expect(horsePhase10SelectionIsValid(p10Receipt, selectedDecision, undefined)).toBe(false);

      const p11Receipt = {
        variant: 'plo5',
        version: OMAHA_VARIANT_PACKS.plo5.version,
        inputs: null,
        mode: 'candidate',
        authority: p11Plo5Auth,
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
      expect(horsePhase11SelectionIsValid(p11Receipt, selectedDecision, graph)).toBe(true);
      expect(horsePhase11SelectionIsValid(p11Receipt, selectedDecision, undefined)).toBe(false);

      const p12Receipt = {
        variant: 'short_deck',
        version: REMAINING_VARIANT_PACKS.short_deck.version,
        inputs: null,
        mode: 'candidate',
        authority: p12SdAuth,
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
      expect(horsePhase12SelectionIsValid(p12Receipt, selectedDecision, graph)).toBe(true);
      expect(horsePhase12SelectionIsValid(p12Receipt, selectedDecision, undefined)).toBe(false);
    }
  });
});

describe('W1.3 + W1.4 + W2 #8A/#9 Turn timer preservation, auto-sit-back, pre-action purge, short clock & Insurance/RIT pacing', () => {
  it('preserves in-flight horse tank work when clearPrimaryClockPreservingHorseDecision() runs on time_bank transition', () => {
    const engine = new ServerTableEngine(TABLE_ID) as any;
    const abortController = new AbortController();
    const timer = setTimeout(() => {}, 30_000);
    timer.unref?.();
    engine.horseDecisionAbortController = abortController;
    engine.horseActionTimer = timer;
    engine.preciseTimer = { clearTable: vi.fn() };

    engine.clearPrimaryClockPreservingHorseDecision();
    expect(engine.preciseTimer.clearTable).toHaveBeenCalledWith(TABLE_ID);
    expect(abortController.signal.aborted).toBe(false);
    expect(engine.horseActionTimer).toBe(timer);

    engine.clearTurnTimer();
    expect(abortController.signal.aborted).toBe(true);
    expect(engine.horseActionTimer).toBeNull();
    clearTimeout(timer);
  });

  it('auto-sits-back forced-sat-out non-client horses and purges stale pre-actions on handleTurnChange', async () => {
    const engine = new ServerTableEngine(TABLE_ID) as any;
    engine.running = true;
    engine.isCurrentEngine = () => true;
    engine.lifecycleCanMutate = () => true;
    engine.tableInfo = { action_time_seconds: 15 };
    const horse = {
      seat_number: 1,
      user_id: HORSE_A,
      username: 'HorseA',
      stack: 1_000,
      is_horse: true,
    };
    const state = {
      currentPlayerSeat: 1,
      currentBet: 20,
      minRaise: 20,
      pot: 50,
      communityCards: [],
      stage: 'preflop',
      players: [
        {
          seat: 1,
          user_id: HORSE_A,
          bet: 0,
          stack: 1_000,
          is_folded: false,
          is_all_in: false,
          is_sitting_out: true,
        },
      ],
    };
    engine.seatedPlayers = [horse];
    engine.handController = { getState: () => state, performAction: vi.fn(() => true) };
    const clearPreAction = vi.fn();
    const sitBack = vi.fn();
    engine.preActionEngine = {
      clearPreAction,
      getPreAction: () => ({ action: 'auto_check_fold' }),
      executePreAction: () => ({ executed: false }),
    };
    engine.disconnectEngine = {
      isSittingOut: () => true,
      isClientSitOut: () => false,
      sitBack,
      onPlayerTurn: () => true,
      armedAutoActionDeadlineMs: () => 0,
      isInReconnectGrace: () => false,
    };
    engine.startTurnTimer = vi.fn();
    engine.scheduleHorseAction = vi.fn();
    enableBrainTelemetry();
    drainFires();

    await engine.handleTurnChange(
      { type: 'TURN_CHANGE', seat: 1, availableActions: ['fold', 'call'] },
      [horse]
    );

    expect(clearPreAction).toHaveBeenCalledWith(TABLE_ID, HORSE_A);
    // Upgrade 09 evidence: the purge of a pre-action that existed is counted once.
    expect(drainFires().filter((f) => f.feature === 'upgrade09_preaction_purged_table')).toEqual([
      { feature: 'upgrade09_preaction_purged_table', fires: 1 },
    ]);
    expect(sitBack).toHaveBeenCalledWith(TABLE_ID, HORSE_A);
    expect(state.players[0].is_sitting_out).toBe(false);
    expect(engine.scheduleHorseAction).toHaveBeenCalledTimes(1);
  });

  it('caps horseDecisionDeadlineMs below 2000ms when maxRemainingClockMs reflects a short clock', () => {
    expect(horseDecisionDeadlineMs({ actionTimeSeconds: 15, elapsedMs: 0 })).toBe(13_500);
    expect(
      horseDecisionDeadlineMs({
        actionTimeSeconds: 15,
        elapsedMs: 0,
        maxRemainingClockMs: 1_100,
      })
    ).toBe(850);
  });

  it('declines horse all-in insurance promptly within 650-1150ms instead of stalling 5-12s', async () => {
    vi.useFakeTimers();
    const engine = new ServerTableEngine(TABLE_ID) as any;
    engine.running = true;
    engine.lifecycleCanMutate = () => true;
    engine.handCount = 7;
    engine.seatedPlayers = [{ seat_number: 1, user_id: HORSE_A, is_horse: true }];
    engine.isOwnClientControlling = () => false;
    engine.insuranceEngine = {
      getOffers: () => [{ playerId: HORSE_A, status: 'offered' }],
    };
    engine.respondToInsurance = vi.fn();

    engine.scheduleHorseInsuranceResponse(HORSE_A);
    await vi.advanceTimersByTimeAsync(1_200);
    expect(engine.respondToInsurance).toHaveBeenCalledWith(HORSE_A, 'decline', 100, true);
  });
});

describe('W1.5 + W2 #5/#13B Worker priority queue, idle PREWARM_STREET & Prometheus watchcounters', () => {
  const readyMsg = {
    type: 'READY' as const,
    solverStores: {
      charts: 1,
      postflop: 1,
      postflopV31: 1,
      postflopV31Dataset: { id: TABLE_ID, checksum: 'a'.repeat(64) },
    },
    solverPolicyArtifact: {
      totalPolicies: 1,
    } as HorseDecisionWorkerReady['solverPolicyArtifact'],
    governor: {
      enabled: false,
      scale: 1,
      p50Ms: 0,
      p99Ms: 0,
      sampledAt: 1,
      throttledForS: 0,
      stale: false,
      timerLateMs: 0,
    },
  };

  it('prioritizes DECIDE_FAST ahead of queued DECIDE_DEEP and mirrored OBSERVE_COMPLETED_HAND jobs', async () => {
    const sent: any[] = [];
    let onMsg: ((m: any) => void) | null = null;
    const fakeWorker = {
      postMessage: (m: any) => sent.push(m),
      on: (ev: string, fn: any) => {
        if (ev === 'message') onMsg = fn;
      },
      terminate: async () => 0,
    };
    const client = new LiveHorseDecisionWorkerClient({
      workerFactory: () => fakeWorker as any,
      maxInFlight: 1,
    });
    onMsg!(readyMsg);

    const baseSnap = (fence: string): LiveHorseDecisionSnapshot => {
      const value: LiveHorseDecisionSnapshot = {
        generation: 1,
        fence,
        decisionKey: '',
        decisionTimeMs: 1_800_000,
        player: {
          seat: 1,
          user_id: HORSE_A,
          username: 'HorseA',
          stack: 200,
          bet: 0,
          totalInvested: 0,
          cards: [card('A', 'spades'), card('K', 'spades')],
          is_folded: false,
          is_all_in: false,
          is_sitting_out: false,
        },
        gameState: {
          stateSchemaVersion: 1,
          heroSeat: 1,
          currentPlayerSeat: 1,
          legalActions: ['fold', 'call', 'raise', 'all_in'],
          toCall: 2,
          minRaiseTo: 4,
          maxRaiseTo: 200,
          bettingStructure: 'no_limit',
          fixedBetSize: null,
          wagersCapped: false,
          commitmentCapRemaining: null,
          players: [
            {
              seat: 1,
              user_id: HORSE_A,
              username: 'HorseA',
              stack: 200,
              bet: 0,
              totalInvested: 0,
              cards: [],
              is_folded: false,
              is_all_in: false,
              is_sitting_out: false,
            },
            {
              seat: 2,
              user_id: HUMAN_B,
              username: 'HumanB',
              stack: 198,
              bet: 2,
              totalInvested: 2,
              cards: [],
              is_folded: false,
              is_all_in: false,
              is_sitting_out: false,
            },
          ],
          communityCards: [],
          communityCards2: [],
          communityCards3: [],
          pot: 2,
          contestablePot: 2,
          currentBet: 2,
          minRaise: 2,
          stage: 'preflop',
          gameVariant: 'nlh',
          bigBlind: 2,
          actionHistory: [],
          pots: [{ amount: 2, eligiblePlayers: [HUMAN_B] }],
          rakeConfig: { percent: 5, cap: 5, noFlopNoDrop: true },
          variantRules: {
            holeCardsDealt: 2,
            holeCardsUse: 'any',
            boardCardsUse: 'any',
            deckSize: 52,
            splitLow8OrBetter: false,
          },
        },
      };
      value.decisionKey = buildHorseDecisionKey(value);
      return value;
    };

    // 1. Occupy the single in-flight slot
    void client.decideFast(baseSnap('t1:1:1:1:1')).catch(() => undefined);
    // 2. Queue background mirror + DECIDE_DEEP
    client.mirrorCompletedHand({
      generation: 1,
      fence: 't2:1:1:observe',
      handKey: 't2:1',
      bigBlind: 2,
      actions: [],
    });
    void client
      .decideDeep({ ...baseSnap('t3:1:1:1:1'), rngBefore: 1, deepEquity: 6 })
      .catch(() => undefined);
    // 3. Enqueue real-time DECIDE_FAST: must jump ahead of queued mirror & DECIDE_DEEP!
    void client.decideFast(baseSnap('t4:1:1:1:1')).catch(() => undefined);

    const queuedTypes = (
      (client as any).queue as Array<{ request: { type: string; fence: string } }>
    ).map((j) => `${j.request.type}:${j.request.fence}`);
    expect(queuedTypes[0]).toBe('DECIDE_FAST:t4:1:1:1:1');
    // Busy shard refuses PREWARM_STREET immediately
    expect(
      client.prewarmStreet({
        fence: 't4',
        street: 'flop',
        board: [card('A', 'clubs'), card('8', 'diamonds'), card('3', 'hearts')],
        variant: 'plo5',
        mode: 'cash',
      })
    ).toBe(false);
    // Cleanly fail/terminate fake worker so no timers dangle
    (client as any).fail(new Error('test_cleanup'));
    await client.stop();
  });

  it('executes idle PREWARM_STREET in HorseDecisionWorkerRuntime and relays BrainTelemetry watchcounters to Prometheus', async () => {
    const emitted: any[] = [];
    const runtime = new HorseDecisionWorkerRuntime(
      (msg) => emitted.push(msg),
      {
        ...defaultHorseDecisionWorkerDependencies,
        startServices: async () => ({
          solverStores: readyMsg.solverStores,
          solverPolicyArtifact: readyMsg.solverPolicyArtifact,
          governor: readyMsg.governor,
        }),
        stopServices: async () => undefined,
      },
      async () => undefined
    );
    await runtime.start();
    runtime.receive({
      type: 'PREWARM_STREET',
      fence: TABLE_ID,
      street: 'flop',
      board: [card('Q', 'spades'), card('J', 'spades'), card('4', 'diamonds')],
      variant: 'plo6',
      mode: 'cash',
      effectiveStackBB: 100,
    } as any);
    await runtime.drain();

    const deltaMsg = emitted.find((m) => m.type === 'WATCHCOUNTER_DELTA');
    expect(deltaMsg).toBeDefined();
    resetBrainWatchcountersForTest();
    mergeBrainWatchcounterDeltas(deltaMsg.watchcounterDeltas);
    noteHorseActionClamped('plo4', 'tournament', 'above_max_raise');
    noteHorsePlanReevaluated('nlh', 'cash', 'sizing_diverged');
    noteHorseLegalizerDegraded('plo5', 'cash', 'pot_or_cap_max_raise');
    expect(drainBrainWatchcounterDeltas().length).toBeGreaterThanOrEqual(3);

    const prom = renderBrainWatchcountersPrometheus().join('\n');
    expect(prom).toContain(
      'poker_horse_street_prewarm_total{variant="plo6",mode="cash",reason="flop"} 1'
    );
    expect(prom).toContain(
      'poker_horse_action_clamped_total{variant="plo4",mode="tournament",reason="above_max_raise"} 1'
    );
    expect(prom).toContain(
      'poker_horse_plan_reevaluated_total{variant="nlh",mode="cash",reason="sizing_diverged"} 1'
    );
    expect(prom).toContain(
      'poker_horse_legalizer_degraded_total{variant="plo5",mode="cash",reason="pot_or_cap_max_raise"} 1'
    );
  });
});
