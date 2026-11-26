/**
 * AN ACCEPTED HORSE DECISION COUNTS ITS OPTION RECEIPTS INTO THE HAND (2026-11-25).
 *
 * Per-hand option receipts (HorseHandOptionReceipts). These cases drive the REAL production wrapper
 * (ServerTableEngine.scheduleHorseAction) on a real HandController; only the decision worker's reply is supplied.
 *  - A reply that carries option receipts, whose action the table accepts, is counted into this hand's count
 *    (one per receipt text per decision).
 *  - A reply with no receipts leaves the hand's count empty, and so does the liveness action of a failed worker.
 *  - A reply is not trusted: a receipt that is not an exact option and two action words (cards put there on
 *    purpose) is not counted.
 * (That the deal clears the count and the settlement hands a copy to the hand save is pinned in
 * HorseHandOptionReceipts.law.test.ts; the save itself in services/supabase/handHistory.test.ts.)
 * Nothing here touches a database: the turn path has no write to make.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { HandConfig, SeatPlayer } from '../types.js';

const db = vi.hoisted(() => ({ tables: [] as string[] }));
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
    from: vi.fn((table: string) => {
      db.tables.push(table);
      return {
        insert: () => ({ abortSignal: async () => ({ error: null }) }),
      };
    }),
    rpc: vi.fn(() => {
      throw Error('Unexpected database RPC');
    }),
  },
  maintenanceSupabase: {},
}));
vi.mock('../services/errorReporter.js', async () => ({
  ...(await vi.importActual<typeof import('../services/errorReporter.js')>(
    '../services/errorReporter.js'
  )),
  reportError: vi.fn(),
  reportWarning: vi.fn(),
}));

import { HandController } from './HandController.js';
import { ServerTableEngine } from './ServerTableEngine.js';
import { HorseDecisionExpiredError } from './horseDecision/index.js';
import { _resetHorseErrorLogForTests } from '../services/HorseErrorLog.js';
import { disarmBrainTelemetryForTest } from './BrainTelemetry.js';

const TABLE = 'fa300000-0000-4000-8000-0000000000f1';

function harness() {
  const players = [200, 200, 200, 200].map((stack, i) => ({
    seat: i + 1,
    user_id: `fa400000-0000-4000-8000-0000000000f${i + 1}`,
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
      handNumber: 7,
      gameVariant: 'nlh',
      smallBlind: 1,
      bigBlind: 2,
      rakeConfig: { percent: 0, cap: 0, noFlopNoDrop: true },
    } as HandConfig,
    players,
    1
  );
  hc.start();
  const live = (hc as unknown as { state: any }).state;
  const engine = new ServerTableEngine(TABLE) as any;
  engine.running = true;
  engine.isCurrentEngine = () => true;
  engine.handCount = 7;
  engine.tableInfo = {
    action_time_seconds: 15,
    big_blind: 2,
    small_blind: 1,
    game_variant: 'nlh',
  };
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
  const history = live.actionHistory.length;
  return {
    engine,
    accepted: () => live.actionHistory.slice(history) as { action: string; seat: number }[],
    /** The seat to act asks the worker; the worker's reply (or failure) is whatever the mock holds. */
    async act() {
      const state = hc.getState();
      const seat = state.currentPlayerSeat!;
      live.players.find((p: SeatPlayer) => p.seat === seat).cards = [
        { rank: '7', suit: 'hearts' },
        { rank: '2', suit: 'diamonds' },
      ];
      const enginePlayer = state.players.find((p) => p.seat === seat)!;
      const player = {
        seat_number: seat,
        user_id: enginePlayer.user_id,
        username: enginePlayer.username,
        stack: enginePlayer.stack,
        is_horse: true,
        horse_profile: {},
      };
      engine.seatedPlayers = [player];
      engine.scheduleHorseAction(player, seat, enginePlayer, hc.getState());
      await vi.advanceTimersByTimeAsync(20_000);
      for (let i = 0; i < 4; i++) await Promise.resolve();
      return seat;
    },
  };
}

/** A worker reply for the request it was asked: this fence, a fold, and whatever receipts the case supplies. */
const foldReply = (optionReceipts: unknown) => (snapshot: { generation: number; fence: string }) =>
  Promise.resolve({
    type: 'FAST_RESULT',
    requestId: 41,
    planBinding: null,
    planIssueDisposition: 'no_effects',
    generation: snapshot.generation,
    fence: snapshot.fence,
    decision: { action: 'fold', thinkTime: 10 },
    rngBefore: 1,
    rngAfter: 1,
    computeMs: 0,
    governorScale: 1,
    effects: [],
    ...(optionReceipts === undefined ? {} : { optionReceipts }),
  });

const TRIM = { option: 'cashDefenceTrimColdCalls', before: 'call', after: 'fold' };
const PRICED = { option: 'holdemTournamentAllInCallIsPriced', before: 'call', after: 'fold' };

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  db.tables.length = 0;
  _resetHorseErrorLogForTests();
});
afterEach(() => {
  _resetHorseErrorLogForTests();
  disarmBrainTelemetryForTest();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('counts the receipts of each accepted decision into the hand, once per receipt text per decision', async () => {
  const h = harness();
  expect(h.engine.currentHandOptionReceipts.size).toBe(0);

  // First seat: the option changed its decision; the table accepts the fold.
  worker.decideFast.mockImplementationOnce(foldReply([TRIM, { ...TRIM }]));
  await h.act();
  expect(h.accepted().map((a) => a.action)).toEqual(['fold']);
  expect(Object.fromEntries(h.engine.currentHandOptionReceipts)).toEqual({
    'cashDefenceTrimColdCalls:call>fold': 1,
  });

  // Second seat: no receipt on the reply. The count does not move.
  worker.decideFast.mockImplementationOnce(foldReply(undefined));
  await h.act();
  expect(h.accepted().map((a) => a.action)).toEqual(['fold', 'fold']);
  expect(Object.fromEntries(h.engine.currentHandOptionReceipts)).toEqual({
    'cashDefenceTrimColdCalls:call>fold': 1,
  });

  // Third seat: two options changed it, plus things that are not receipts (cards, an amount, another option).
  worker.decideFast.mockImplementationOnce(
    foldReply([
      TRIM,
      PRICED,
      { option: 'cashDefenceTrimColdCalls', before: 'AsKd', after: 'fold' },
      { option: 'cashDefenceTrimColdCalls', before: 'call', after: 'fold 40' },
      { option: 'someOtherOption', before: 'call', after: 'fold' },
      'cashDefenceTrimColdCalls:call>fold',
      null,
    ])
  );
  await h.act();
  expect(h.accepted().map((a) => a.action)).toEqual(['fold', 'fold', 'fold']);
  const counted = Object.fromEntries(h.engine.currentHandOptionReceipts);
  expect(counted).toEqual({
    'cashDefenceTrimColdCalls:call>fold': 2,
    'holdemTournamentAllInCallIsPriced:call>fold': 1,
  });
  // Nothing was written on the turn: the count lives in memory until the hand is saved.
  expect(db.tables).not.toContain('ca_horse_hand_receipts');
});

it('a failed worker and a malformed receipts field count nothing', async () => {
  const h = harness();
  worker.decideFast.mockRejectedValueOnce(new HorseDecisionExpiredError());
  await h.act();
  expect(h.accepted()).toHaveLength(1);
  expect(h.engine.currentHandOptionReceipts.size).toBe(0);
  for (const junk of ['AsKd', 7, { option: 'cashDefenceTrimColdCalls' }, [[TRIM]]]) {
    const again = harness();
    worker.decideFast.mockImplementationOnce(foldReply(junk));
    await again.act();
    expect(again.accepted().map((a) => a.action)).toEqual(['fold']);
    expect(again.engine.currentHandOptionReceipts.size).toBe(0);
  }
  expect(db.tables).not.toContain('ca_horse_hand_receipts');
});
