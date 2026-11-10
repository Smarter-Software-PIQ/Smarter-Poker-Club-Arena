/**
 * A HORSE FALLBACK IS COUNTED BY REASON AT THE SEAT (2026-11-09).
 *
 * The companion law (horseDecision/aFallbackSaysWhichPathRejectedIt.law.test.ts)
 * proves which client and lane rejections carry which name. This file drives
 * the real scheduleHorseAction fallback site against a real HandController and
 * reads the always-on registry: the rejection the worker call produced is the
 * `reason` the counter moved under, and the seat still takes its legal action.
 * Only the decision worker's answer is supplied. Observability only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HandConfig, SeatPlayer } from '../types.js';

const worker = vi.hoisted(() => ({
  decideFast: vi.fn(),
  decideDeep: vi.fn(),
  commitDecisionEffects: vi.fn(async () => undefined),
  runWithDispatchBarrier: vi.fn(<T>(fn: () => T): T => fn()),
}));
vi.mock('./horseDecision/index.js', async () => ({
  ...(await vi.importActual<typeof import('./horseDecision/index.js')>('./horseDecision/index.js')),
  getLiveHorseDecisionWorker: () => worker,
}));
vi.mock('../services/supabase/client.js', () => ({
  supabase: {
    from: vi.fn(() => {
      throw Error('Unexpected database access');
    }),
    rpc: vi.fn(() => {
      throw Error('Unexpected database RPC');
    }),
  },
  maintenanceSupabase: {},
}));
vi.mock('../services/errorReporter.js', () => ({ reportError: vi.fn() }));

import { HandController } from './HandController.js';
import { ServerTableEngine } from './ServerTableEngine.js';
import {
  HORSE_DECISION_FALLBACK_REASONS,
  HorseDecisionAbortedError,
  HorseDecisionExpiredError,
} from './horseDecision/index.js';
import { HorseRequestCapacityError } from './horseDecision/requestRetentionBudget.js';
import { alwaysOnPrometheusLines } from '../observability/engineInstruments.js';

const TABLE = 'fa300000-0000-4000-8000-0000000000a1';

// Seats: 1=Dealer, 2=SB (8 chips), 3=BB, 4=UTG. Preflop order: 4, 1, 2, 3.
// UTG raises to 6, Dealer calls, SB shoves 8 total: a 2 increment against a
// last raise of 4, so it is a SHORT all-in that reopens betting to nobody who
// has already acted.
//   'may_reopen'    -> the BB (seat 3) is on the clock; it has not acted, so
//                      it may raise and the engine offers it all_in.
//   'may_not_reopen'-> the BB calls and UTG (seat 4) is on the clock; it has
//                      acted and faces only the short all-in: fold or call.
function harness(spot: 'may_reopen' | 'may_not_reopen') {
  const players = [200, 8, 200, 200].map((stack, i) => ({
    seat: i + 1,
    user_id: `fa400000-0000-4000-8000-0000000000a${i + 1}`,
    username: `Horse ${i + 1}`,
    stack,
    bet: 0,
    totalInvested: 0,
    cards: [],
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
  })) as SeatPlayer[];
  const hc = new HandController(
    {
      tableId: TABLE,
      handNumber: 1,
      gameVariant: 'nlh',
      smallBlind: 1,
      bigBlind: 2,
      rakeConfig: { percent: 0, cap: 0, noFlopNoDrop: true },
    } as HandConfig,
    players,
    1
  );
  hc.start();
  expect(hc.performAction(4, 'raise', 6)).toBe(true);
  expect(hc.performAction(1, 'call')).toBe(true);
  expect(hc.performAction(2, 'all_in')).toBe(true);
  if (spot === 'may_not_reopen') expect(hc.performAction(3, 'call')).toBe(true);
  const state = hc.getState();
  expect(state.currentBet).toBe(8);
  const seat = state.currentPlayerSeat!;
  expect(seat).toBe(spot === 'may_reopen' ? 3 : 4);
  const enginePlayer = state.players.find((p) => p.seat === seat)!;
  const legalActions = hc.getAuthoritativeActionState(enginePlayer.user_id)!.legalActions;
  expect(legalActions.includes('all_in')).toBe(spot === 'may_reopen');
  expect(legalActions).toContain('call');
  const player = {
    seat_number: seat,
    user_id: enginePlayer.user_id,
    username: enginePlayer.username,
    stack: enginePlayer.stack,
    is_horse: true,
    horse_profile: {},
  };
  const engine = new ServerTableEngine(TABLE) as any;
  engine.running = true;
  engine.isCurrentEngine = () => true;
  engine.handCount = 1;
  engine.tableInfo = { action_time_seconds: 15, big_blind: 2, small_blind: 1, game_variant: 'nlh' };
  engine.seatedPlayers = [player];
  engine.handController = hc;
  engine.disconnectEngine = { isSittingOut: () => false, recordPlayerActed: vi.fn() };
  engine.timeBankEngine = {
    isAutoActivateEnabled: () => true,
    isArmed: () => false,
    getPlayerBank: () => null,
  };
  engine.getEngineLeaseAuthority = () => ({ verified: true, generation: '9' });
  engine.humansSeated = () => 0;
  engine.tableFormat = () => 'cash';
  engine.markProgress = vi.fn();
  const history = hc.getState().actionHistory.length;
  const perform = vi.spyOn(hc, 'performAction');
  const live = () => (hc as unknown as { state: any }).state;
  return {
    engine,
    player,
    enginePlayer,
    hc,
    state,
    seat,
    perform,
    /** Every record the engine accepted after the horse was put on the clock. */
    accepted: () => live().actionHistory.slice(history) as any[],
    hero: () => live().players.find((p: SeatPlayer) => p.seat === seat) as SeatPlayer,
    async run() {
      engine.scheduleHorseAction(player, seat, enginePlayer, state);
      await vi.advanceTimersByTimeAsync(300);
    },
  };
}

const counts = (): Record<string, number> =>
  Object.fromEntries(
    HORSE_DECISION_FALLBACK_REASONS.map((reason) => {
      const line = alwaysOnPrometheusLines().find((l) =>
        l.startsWith(`poker_horse_decision_fallbacks_total{reason="${reason}"}`)
      );
      return [reason, line ? Number(line.split(' ').pop()) : NaN];
    })
  );

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the fallback site counts the rejection under its reason', () => {
  it.each([
    [
      'enqueue_failed',
      'the worker call throws before it returns a promise',
      () =>
        worker.decideFast.mockImplementationOnce(() => {
          throw new Error('live horse decision worker has not been started');
        }),
    ],
    [
      'expired',
      'the job outlived its deadline',
      () => worker.decideFast.mockRejectedValueOnce(new HorseDecisionExpiredError()),
    ],
    [
      'capacity_refused',
      'the request allowance was refused',
      () => worker.decideFast.mockRejectedValueOnce(new HorseRequestCapacityError()),
    ],
    [
      'unknown',
      'the rejection carries no name',
      () => worker.decideFast.mockRejectedValueOnce(new Error('horse decision expired')),
    ],
  ] as const)('%s: %s', async (reason, _why, arrange) => {
    const h = harness('may_not_reopen');
    arrange();
    const before = counts();
    await h.run();

    const after = counts();
    for (const each of HORSE_DECISION_FALLBACK_REASONS)
      expect(after[each] - before[each], each).toBe(each === reason ? 1 : 0);
    // Counting changes nothing at the table: facing a bet, the seat folds.
    expect(h.accepted()).toHaveLength(1);
    expect(h.accepted()[0]).toMatchObject({ seat: h.seat, action: 'fold' });
    expect(h.hero()).toMatchObject({ is_folded: true });
  });

  it('an aborted decision is not a fallback and is not counted', async () => {
    const h = harness('may_not_reopen');
    worker.decideFast.mockRejectedValueOnce(new HorseDecisionAbortedError());
    const before = counts();
    await h.run();
    expect(counts()).toEqual(before);
  });

  it('a counter that throws never reaches the felt', async () => {
    const metrics = await import('../observability/engineInstruments.js');
    vi.spyOn(metrics.horseDecisionFallbacksTotal, 'inc').mockImplementation(() => {
      throw new Error('registry unavailable');
    });
    const h = harness('may_not_reopen');
    worker.decideFast.mockRejectedValueOnce(new HorseDecisionExpiredError());
    await h.run();
    expect(h.accepted()).toHaveLength(1);
    expect(h.accepted()[0]).toMatchObject({ seat: h.seat, action: 'fold' });
  });
});
