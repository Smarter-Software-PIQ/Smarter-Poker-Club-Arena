/**
 * A FAST ANSWER WHOSE SECOND LOOK REPLACED IT CANNOT ALSO ACT
 *
 * V44 second look: a horse facing a bet in a pot worth reading gets a FAST
 * answer, and a few hundred milliseconds into its think time the same spot is
 * replayed deeper (decideDeep). A deeper call/fold/all-in that differs replaces
 * the fast answer. Within ONE turn exactly one of the two may reach the table.
 *
 * Driven through the real ServerTableEngine.scheduleHorseAction and a real
 * HandController; only the worker bridge is scripted. Three orderings:
 *  1. The deep answer flips the fast call to a fold before the think time ends:
 *     the fold acts once and the fast witness is retired as
 *     second_look_replaced.
 *  2. The deep answer carries a stale generation/fence: it is retired as
 *     response_fence and the fast call acts once.
 *  3. The deep answer lands after the turn already committed the fast call: it
 *     is retired, not executed, and nothing acts a second time.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const workerBridge = vi.hoisted(() => ({
  decideFast: vi.fn(),
  decideDeep: vi.fn(),
  commitDecisionEffects: vi.fn(async () => undefined),
  runWithDispatchBarrier: vi.fn(<T>(fn: () => T): T => fn()),
}));

vi.mock('./horseDecision/index.js', async () => ({
  ...(await vi.importActual<typeof import('./horseDecision/index.js')>('./horseDecision/index.js')),
  getLiveHorseDecisionWorker: () => workerBridge,
}));

vi.mock('../services/supabase/client.js', () => ({
  supabase: {
    from: vi.fn(() => {
      throw new Error('Unexpected database query in unit test');
    }),
    rpc: vi.fn(() => {
      throw new Error('Unexpected database RPC in unit test');
    }),
  },
  maintenanceSupabase: {},
}));

vi.mock('../services/errorReporter.js', () => ({ reportError: vi.fn() }));

import type { ActionType, Card, CardRank, CardSuit, HandConfig, SeatPlayer } from '../types.js';
import type {
  DeepHorseDecisionResult,
  FastHorseDecisionResult,
  LiveHorseDecisionSnapshot,
} from './horseDecision/protocol.js';
import { HandController } from './HandController.js';
import { ServerTableEngine } from './ServerTableEngine.js';
import {
  createHorseExecutionWitness,
  type HorseExecutionWitness,
} from './HorseExecutionWitness.js';
import { horsePlanBatchBindingFromRequest } from './HorsePlanHandIdentity.js';

const SUITS: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (text: string): Card[] =>
  text.split(' ').map((s) => ({ rank: s[0] as CardRank, suit: SUITS[s[1]] }));

const TABLE_ID = 'fa100000-0000-4000-8000-000000000a44';
const FAST_THINK_MS = 3_000;

type Scenario = {
  deepAction: ActionType;
  /** Fake-clock delay, from the deep request, before the deep answer lands. */
  deepDelayMs: number;
  staleDeep?: boolean;
};

async function playOneTurn(scenario: Scenario) {
  const seats = [1, 2, 3, 4, 5, 6].map((seat) => ({
    seat,
    user_id: `fa200000-0000-4000-8000-0000000000b${seat}`,
    username: `Horse ${seat}`,
    stack: 200,
    bet: 0,
    totalInvested: 0,
    cards: [],
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
  })) as SeatPlayer[];
  const hc = new HandController(
    {
      tableId: TABLE_ID,
      handNumber: 1,
      gameVariant: 'nlh',
      smallBlind: 1,
      bigBlind: 2,
      rakeConfig: { percent: 0, cap: 0, noFlopNoDrop: true },
    } as HandConfig,
    seats,
    1
  );
  hc.start();
  expect(hc.performAction(4, 'raise', 30)).toBe(true);
  expect(hc.performAction(5, 'call')).toBe(true);
  // Cards on the hand itself (getState() is a copy). 9-8 offsuit is no
  // premium, so no commit-time wager rule rewrites either answer.
  (hc as any).state.players.find((p: SeatPlayer) => p.seat === 6)!.cards = cards('9c 8d');
  const st = hc.getState();
  expect(st.currentPlayerSeat).toBe(6);
  // Facing 30 into 63: a close spot in a pot of 20bb or more.
  expect(st.pot).toBeGreaterThanOrEqual(40);
  const hero = st.players.find((p) => p.seat === 6)!;
  const heroRow = {
    seat_number: 6,
    user_id: hero.user_id,
    username: hero.username,
    stack: hero.stack,
    is_horse: true,
    horse_profile: {},
  };

  const engine = new ServerTableEngine(TABLE_ID) as any;
  engine.running = true;
  engine.isCurrentEngine = () => true;
  engine.handCount = 1;
  engine.tableInfo = { action_time_seconds: 15, big_blind: 2, small_blind: 1, game_variant: 'nlh' };
  engine.seatedPlayers = [heroRow];
  engine.handController = hc;
  engine.disconnectEngine = { isSittingOut: () => false, recordPlayerActed: vi.fn() };
  engine.timeBankEngine = {
    isAutoActivateEnabled: () => false,
    isArmed: () => false,
    getPlayerBank: () => null,
  };
  engine.getEngineLeaseAuthority = () => ({ verified: true, generation: '11' });
  engine.humansSeated = () => 0;
  engine.tableFormat = () => 'cash';
  engine.markProgress = vi.fn();
  // The turn clock started now, so the second look has the whole clock.
  engine.playerTurnStartTime = Date.now();
  engine.playerTurnDuration = 15;

  let fastWitness: HorseExecutionWitness | undefined;
  let deepWitness: HorseExecutionWitness | undefined;
  workerBridge.decideFast.mockImplementation(
    async (snap: LiveHorseDecisionSnapshot): Promise<FastHorseDecisionResult> => {
      fastWitness = createHorseExecutionWitness(
        snap,
        { action: 'call', thinkTime: FAST_THINK_MS },
        { requestId: 41, lane: 'fast', computeMs: 2, governorScale: 1 }
      );
      return {
        type: 'FAST_RESULT',
        planIssueDisposition: 'no_effects',
        planBinding: horsePlanBatchBindingFromRequest({ ...snap, requestId: 41 }),
        requestId: 41,
        generation: snap.generation,
        fence: snap.fence,
        decision: { action: 'call', thinkTime: FAST_THINK_MS, executionWitness: fastWitness },
        rngBefore: 1,
        rngAfter: 2,
        computeMs: 2,
        governorScale: 1,
        effects: [],
      };
    }
  );
  workerBridge.decideDeep.mockImplementation(
    (snap: LiveHorseDecisionSnapshot): Promise<DeepHorseDecisionResult> => {
      deepWitness = createHorseExecutionWitness(
        snap,
        { action: scenario.deepAction, thinkTime: FAST_THINK_MS },
        { requestId: 42, lane: 'deep', computeMs: 12, governorScale: 1 }
      );
      const result = {
        type: 'DEEP_RESULT',
        requestId: 42,
        generation: scenario.staleDeep ? snap.generation + 1 : snap.generation,
        fence: scenario.staleDeep ? `${snap.fence}:stale` : snap.fence,
        decision: {
          action: scenario.deepAction,
          thinkTime: FAST_THINK_MS,
          executionWitness: deepWitness,
        },
        computeMs: 12,
        governorScale: 1,
      } as unknown as DeepHorseDecisionResult;
      return new Promise((resolve) => setTimeout(() => resolve(result), scenario.deepDelayMs));
    }
  );
  const performAction = vi.spyOn(hc, 'performAction');

  engine.scheduleHorseAction(heroRow, 6, hero, st);
  await vi.advanceTimersByTimeAsync(30_000);

  const heroActs = performAction.mock.calls.filter(([seat]) => seat === 6);
  const tableActions = hc
    .getState()
    .actionHistory.filter((a) => a.seat === 6)
    .map((a) => a.action);
  return { fastWitness, deepWitness, heroActs, tableActions, hc };
}

describe('a late FAST answer after its second look is retired', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a second look that flips the call acts once, and the fast answer is retired as second_look_replaced', async () => {
    const r = await playOneTurn({ deepAction: 'fold', deepDelayMs: 200 });
    expect(workerBridge.decideFast).toHaveBeenCalledTimes(1);
    expect(workerBridge.decideDeep).toHaveBeenCalledTimes(1);
    expect(r.fastWitness?.executionStatus).toBe('not_executed');
    expect(r.fastWitness?.retirementReason).toBe('second_look_replaced');
    expect(r.fastWitness?.acceptedActions ?? []).toHaveLength(0);
    expect(r.deepWitness?.acceptedActions).toHaveLength(1);
    expect(r.deepWitness?.acceptedActions[0].record.action).toBe('fold');
    expect(r.heroActs).toHaveLength(1);
    expect(r.tableActions).toEqual(['fold']);
    expect(r.hc.getState().currentPlayerSeat).not.toBe(6);
  });

  it('a second-look answer for a stale generation and fence is retired, and the fast call acts once', async () => {
    const r = await playOneTurn({ deepAction: 'fold', deepDelayMs: 200, staleDeep: true });
    expect(workerBridge.decideDeep).toHaveBeenCalledTimes(1);
    expect(r.deepWitness?.executionStatus).toBe('not_executed');
    expect(r.deepWitness?.retirementReason).toBe('response_fence');
    expect(r.deepWitness?.acceptedActions ?? []).toHaveLength(0);
    expect(r.fastWitness?.acceptedActions).toHaveLength(1);
    expect(r.fastWitness?.acceptedActions[0].record.action).toBe('call');
    expect(r.heroActs).toHaveLength(1);
    expect(r.tableActions).toEqual(['call']);
  });

  it('a second-look answer that lands after the turn committed is retired, not executed', async () => {
    // Later than the whole 15 s turn clock: the hold expires and the fast call
    // commits first.
    const r = await playOneTurn({ deepAction: 'fold', deepDelayMs: 20_000 });
    expect(workerBridge.decideDeep).toHaveBeenCalledTimes(1);
    expect(r.fastWitness?.acceptedActions).toHaveLength(1);
    expect(r.fastWitness?.acceptedActions[0].record.action).toBe('call');
    expect(r.deepWitness?.executionStatus).toBe('not_executed');
    expect(r.deepWitness?.retirementReason).toBe('response_fence');
    expect(r.deepWitness?.acceptedActions ?? []).toHaveLength(0);
    expect(r.heroActs).toHaveLength(1);
    expect(r.tableActions).toEqual(['call']);
  });
});
