/**
 * LAW: A FIXED-LIMIT SEAT WHOSE DECISION FAILED CALLS A GOOD PRICE (2026-11-15).
 *
 * When a horse's decision cannot be computed - the decision worker refused or
 * died (ServerTableEngineTurns worker fallback) or the brain threw
 * (HorseLogic `brain_exception`) - the seat takes a liveness action. It used
 * to fold whenever chips were owed, at any price. On fixed limit that throws
 * away a pot of many bets for one small bet.
 *
 * The rule now (BettingStructure.failureFallbackAction): free means check;
 * owing chips on FIXED LIMIT means call when the price toCall / (pot + toCall)
 * is at or below FIXED_LIMIT_FAILURE_FALLBACK_CALL_PRICE (0.2, the pot laying
 * 4 to 1) and the seat's menu offers `call`, else fold. No-limit and
 * pot-limit fold when chips are owed, exactly as before.
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
import { HorseLogic } from './HorseLogic.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { HORSE_DATA_LEDGER } from './HorseDataLedger.js';
import { HorseDecisionExpiredError } from './horseDecision/index.js';
import {
  failureFallbackAction,
  FIXED_LIMIT_FAILURE_FALLBACK_CALL_PRICE,
} from './BettingStructure.js';
import type { Card } from '../types.js';

const TABLE = 'fa300000-0000-4000-8000-0000000000f1';
const suits: Record<string, Card['suit']> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (s: string): Card[] =>
  s.split(' ').map((c) => ({ rank: c[0] as Card['rank'], suit: suits[c[1]] }));

// Seats: 1 = button, 2 = SB, 3 = BB, 4 = UTG; 200 chips each, blinds 1/2.
//   'preflop_price' -> UTG (seat 4) first in, facing the blind: 2 into 3, 0.4.
//   'flop_price'    -> 4 raise, 3 calls (pot 16); flop SB bets one small bet;
//                      the BB (seat 3) faces 2 into 18, 0.1.
//   'flop_free'     -> same preflop; the SB (seat 2) opens the flop: free.
function harness(
  gameVariant: string,
  spot: 'preflop_price' | 'flop_price' | 'flop_free' | 'river_free' | 'river_price',
  dealOrPremium?: { hole?: string; board?: string } | boolean
) {
  const deal =
    dealOrPremium === true
      ? { hole: 'As Ac', board: '2h 7s 9d' }
      : typeof dealOrPremium === 'object'
        ? dealOrPremium
        : undefined;
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
      handNumber: 1,
      gameVariant,
      smallBlind: 1,
      bigBlind: 2,
      rakeConfig: { percent: 0, cap: 0, noFlopNoDrop: true },
    } as HandConfig,
    players,
    1
  );
  hc.start();
  if (spot !== 'preflop_price') {
    expect(hc.performAction(4, 'raise', 4)).toBe(true);
    expect(hc.performAction(1, 'call')).toBe(true);
    expect(hc.performAction(2, 'call')).toBe(true);
    expect(hc.performAction(3, 'call')).toBe(true);
    expect(hc.getState().stage).toBe('flop');
    if (spot === 'flop_price') expect(hc.performAction(2, 'bet', 2)).toBe(true);
    if (spot === 'river_free' || spot === 'river_price') {
      for (const seat of [2, 3, 4, 1]) expect(hc.performAction(seat, 'check')).toBe(true);
      expect(hc.getState().stage).toBe('turn');
      for (const seat of [2, 3, 4, 1]) expect(hc.performAction(seat, 'check')).toBe(true);
      expect(hc.getState().stage).toBe('river');
      if (spot === 'river_price') expect(hc.performAction(2, 'bet', 4)).toBe(true);
    }
  }
  const live = () => (hc as unknown as { state: any }).state;
  if (deal?.board) live().communityCards = cards(deal.board);
  if (deal?.hole) {
    const actor = live().players.find((p: SeatPlayer) => p.seat === live().currentPlayerSeat)!;
    actor.cards = cards(deal.hole);
  }
  const state = hc.getState();
  const seat = state.currentPlayerSeat!;
  const enginePlayer = state.players.find((p) => p.seat === seat)!;
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
  engine.tableInfo = {
    action_time_seconds: 15,
    big_blind: 2,
    small_blind: 1,
    game_variant: gameVariant,
  };
  engine.seatedPlayers = [player];
  engine.handController = hc;
  engine.disconnectEngine = { isSittingOut: () => false, recordPlayerActed: vi.fn() };
  engine.timeBankEngine = {
    isAutoActivateEnabled: () => true,
    isArmed: () => false,
    getPlayerBank: () => null,
    dispose: vi.fn(),
  };
  engine.getEngineLeaseAuthority = () => ({ verified: true, generation: '9' });
  engine.humansSeated = () => 0;
  engine.tableFormat = () => 'cash';
  engine.markProgress = vi.fn();
  const history = hc.getState().actionHistory.length;
  return {
    seat,
    state,
    accepted: () => live().actionHistory.slice(history) as any[],
    dispose() {
      engine.cancelHorseDecisionWork?.();
      engine.preciseTimer?.dispose?.();
    },
    async run() {
      try {
        engine.scheduleHorseAction(player, seat, enginePlayer, state);
        await vi.advanceTimersByTimeAsync(300);
      } finally {
        engine.cancelHorseDecisionWork?.();
        engine.preciseTimer?.dispose?.();
      }
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  enableBrainTelemetry();
  drainFires();
  worker.decideFast.mockRejectedValue(new HorseDecisionExpiredError());
  worker.decideDeep.mockRejectedValue(new HorseDecisionExpiredError());
});
afterEach(() => {
  drainFires();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the failure fallback action', () => {
  const menu = ['fold', 'call', 'raise', 'all_in'] as const;
  it('states its bar', () => {
    expect(FIXED_LIMIT_FAILURE_FALLBACK_CALL_PRICE).toBe(0.2);
  });
  it.each([
    ['fixed_limit', 0, 3, menu, 'check'],
    ['fixed_limit', 2, 8, menu, 'call'], // exactly 0.2
    ['fixed_limit', 2, 7.9, menu, 'fold'], // just over 0.2
    ['fixed_limit', 2, 18, menu, 'call'],
    ['fixed_limit', 2, 3, menu, 'fold'],
    ['fixed_limit', 2, 18, ['fold'], 'fold'], // call not on the menu
    ['fixed_limit', 2, 18, undefined, 'fold'], // menu unknown
    ['fixed_limit', 2, Number.NaN, menu, 'fold'],
    ['no_limit', 2, 1000, menu, 'fold'],
    ['no_limit', 0, 3, menu, 'check'],
    ['pot_limit', 2, 1000, menu, 'fold'],
    // N4 (2026-11-15): owing a remainder under half a cent is owing, on every
    // structure. No-limit and pot-limit fold exactly as the old worker rule
    // (toCall > 0 ? fold : check) did; fixed limit prices it (a tiny price
    // calls when the menu offers call).
    ['no_limit', 0.004, 3, menu, 'fold'],
    ['pot_limit', 0.004, 3, menu, 'fold'],
    ['fixed_limit', 0.004, 3, menu, 'call'],
    ['no_limit', -1, 3, menu, 'check'],
    ['no_limit', Number.NaN, 3, menu, 'check'],
  ] as const)('%s, %s to call into %s (%j) -> %s', (structure, toCall, pot, legal, want) => {
    expect(
      failureFallbackAction({
        structure,
        toCall,
        pot,
        legalActions: legal as readonly any[] | undefined,
      })
    ).toBe(want);
  });
});

it('no-limit and pot-limit are the old worker rule for every amount owed (toCall > 0 ? fold : check)', () => {
  for (const structure of ['no_limit', 'pot_limit'] as const) {
    for (const toCall of [
      0,
      1e-9,
      0.001,
      0.004,
      0.005,
      0.006,
      0.01,
      0.5,
      1,
      2,
      100,
      -0.5,
      Number.NaN,
    ]) {
      for (const pot of [0, 1, 3, 1000]) {
        const old = toCall > 0 ? 'fold' : 'check';
        expect(
          failureFallbackAction({
            structure,
            toCall,
            pot,
            legalActions: ['fold', 'call', 'raise', 'all_in'],
          })
        ).toBe(old);
      }
    }
  }
});

describe('a failed decision worker', () => {
  it('keeps its free check when the random deal would qualify for a premium value bet', async () => {
    const h = harness('nlh', 'flop_free', true);
    worker.decideFast.mockRejectedValueOnce(new HorseDecisionExpiredError());
    await h.run();
    expect(worker.decideFast).toHaveBeenCalledOnce();
    expect(h.accepted()).toHaveLength(1);
    expect(h.accepted()[0]).toMatchObject({ seat: h.seat, action: 'check' });
  });
  it.each([
    ['flh', 'flop_price', 'call'],
    ['flo8', 'flop_price', 'call'],
    ['flh', 'preflop_price', 'fold'],
    ['flh', 'flop_free', 'check'],
    ['nlh', 'flop_price', 'fold'],
    ['nlh', 'flop_free', 'check'],
  ] as const)('%s %s: the seat takes %s', async (variant, spot, want) => {
    const h = harness(variant, spot);
    drainFires();
    await h.run();
    expect(h.accepted()).toHaveLength(1);
    expect(h.accepted()[0]).toMatchObject({ seat: h.seat, action: want });
    if (want === 'call') {
      expect(h.accepted()[0].amount).toBe(2);
      expect(drainFires()).toContainEqual({
        feature: 'fixed_limit_failure_fallback_call',
        fires: 1,
      });
    } else {
      expect(drainFires().some((r) => r.feature === 'fixed_limit_failure_fallback_call')).toBe(
        false
      );
    }
  });

  it('a liveness fallback never reads private cards at commit to bet a premium or nut hand', async () => {
    // Regression for the nlh flop_free flake (2026-11-16): when the random deal
    // handed seat 2 QQ+/AK top pair or overpair on an NLH flop, commit-door
    // holdemPremiumAggression turned the worker-fallback `check` into a half-pot
    // `bet` (~2.5% of random deals). Neither worker_fallback nor a returned
    // brain_exception may be promoted into a wager by commit-time card rules.
    const workerFailed = harness('nlh', 'flop_free', { hole: 'As Ah', board: '9c 5d 2h' });
    drainFires();
    await workerFailed.run();
    expect(workerFailed.accepted()).toHaveLength(1);
    expect(workerFailed.accepted()[0]).toMatchObject({ seat: workerFailed.seat, action: 'check' });
    expect(drainFires().some((r) => r.feature.startsWith('holdem_premium_'))).toBe(false);

    const brainThrew = harness('nlh', 'flop_free', { hole: 'Ks Kh', board: '8c 4d 2s' });
    worker.decideFast.mockImplementationOnce(async (snapshot: any) => ({
      type: 'FAST_RESULT',
      requestId: 1,
      planBinding: null,
      planIssueDisposition: 'no_effects',
      generation: snapshot.generation,
      fence: snapshot.fence,
      decision: { action: 'check', thinkTime: 10, policyFallback: 'brain_exception' },
      rngBefore: 0,
      rngAfter: 0,
      computeMs: 0,
      governorScale: 1,
      effects: [],
    }));
    drainFires();
    await brainThrew.run();
    expect(brainThrew.accepted()).toHaveLength(1);
    expect(brainThrew.accepted()[0]).toMatchObject({ seat: brainThrew.seat, action: 'check' });
    expect(drainFires().some((r) => r.feature.startsWith('holdem_premium_'))).toBe(false);

    // River nuts (royal flush) on FLH: a worker-fallback check and a worker-fallback
    // call stand as liveness actions rather than raising through riverNutsRaise.
    const flhRiverFree = harness('flh', 'river_free', {
      hole: 'As Ks',
      board: 'Qs Js Ts 2c 3d',
    });
    drainFires();
    await flhRiverFree.run();
    expect(flhRiverFree.accepted()).toHaveLength(1);
    expect(flhRiverFree.accepted()[0]).toMatchObject({ seat: flhRiverFree.seat, action: 'check' });

    const flhRiverPrice = harness('flh', 'river_price', {
      hole: 'As Ks',
      board: 'Qs Js Ts 2c 3d',
    });
    drainFires();
    await flhRiverPrice.run();
    expect(flhRiverPrice.accepted()).toHaveLength(1);
    expect(flhRiverPrice.accepted()[0]).toMatchObject({
      seat: flhRiverPrice.seat,
      action: 'call',
      amount: 4,
    });
    expect(drainFires()).toContainEqual({
      feature: 'fixed_limit_failure_fallback_call',
      fires: 1,
    });
  });
});

describe('a brain exception', () => {
  function throwingDecide(gameState: Record<string, unknown>, stack = 100, telemetry = false) {
    const spy = vi.spyOn(HorseLogic as any, 'decideInternal').mockImplementationOnce(() => {
      throw Error('private-debug-input');
    });
    try {
      return HorseLogic.decide(
        { user_id: 'hero', bet: 0, stack } as any,
        { players: [], ...gameState } as any,
        'balanced',
        {},
        { mind: false, telemetry }
      );
    } finally {
      spy.mockRestore();
    }
  }
  const legalActions = ['fold', 'call', 'raise', 'all_in'];

  it('on fixed limit calls a price of 4 to 1 or better and stamps fixed_limit_failure_fallback_call', () => {
    drainFires();
    expect(
      throwingDecide({ gameVariant: 'flh', currentBet: 2, pot: 18, legalActions }, 100, true)
    ).toEqual({
      action: 'call',
      amount: 2,
      thinkTime: 1500,
      policyFallback: 'brain_exception',
    });
    const fires = drainFires();
    expect(fires).toContainEqual({ feature: 'phase15_brain_exception', fires: 1 });
    expect(fires).toContainEqual({ feature: 'fixed_limit_failure_fallback_call', fires: 1 });

    // With telemetry off (offline callers), the receipt is silent.
    expect(
      throwingDecide({ gameVariant: 'flh', currentBet: 2, pot: 18, legalActions }, 100, false)
    ).toEqual({
      action: 'call',
      amount: 2,
      thinkTime: 1500,
      policyFallback: 'brain_exception',
    });
    expect(drainFires()).toHaveLength(0);

    // A short stack calls for what it has.
    expect(
      throwingDecide({ gameVariant: 'flo8', currentBet: 4, pot: 40, legalActions }, 3, true)
    ).toEqual({ action: 'call', amount: 3, thinkTime: 1500, policyFallback: 'brain_exception' });
    expect(drainFires()).toContainEqual({
      feature: 'fixed_limit_failure_fallback_call',
      fires: 1,
    });
  });

  it.each([
    ['a worse price', { gameVariant: 'flh', currentBet: 2, pot: 3, legalActions }],
    ['no call on the menu', { gameVariant: 'flh', currentBet: 2, pot: 18, legalActions: ['fold'] }],
    ['no menu', { gameVariant: 'flh', currentBet: 2, pot: 18 }],
    ['no-limit', { gameVariant: 'nlh', currentBet: 2, pot: 18, legalActions }],
    ['pot-limit', { gameVariant: 'plo4', currentBet: 2, pot: 18, legalActions }],
  ])('folds on %s without firing fixed_limit_failure_fallback_call', (_why, gs) => {
    drainFires();
    expect(throwingDecide(gs, 100, true)).toEqual({
      action: 'fold',
      thinkTime: 1500,
      policyFallback: 'brain_exception',
    });
    const fires = drainFires();
    expect(fires).toContainEqual({ feature: 'phase15_brain_exception', fires: 1 });
    expect(fires.some((r) => r.feature === 'fixed_limit_failure_fallback_call')).toBe(false);
  });

  it('checks when free without firing fixed_limit_failure_fallback_call', () => {
    drainFires();
    expect(
      throwingDecide({ gameVariant: 'flh', currentBet: 0, pot: 18, legalActions }, 100, true)
    ).toEqual({
      action: 'check',
      thinkTime: 1500,
      policyFallback: 'brain_exception',
    });
    expect(drainFires().some((r) => r.feature === 'fixed_limit_failure_fallback_call')).toBe(false);
  });

  it('declares fixed_limit_failure_fallback_call as a no-floor receipt in HorseDataLedger', () => {
    const entry = HORSE_DATA_LEDGER.find(
      (e) => e.kind === 'receipt' && e.key === 'fixed_limit_failure_fallback_call'
    );
    expect(entry).toBeDefined();
    expect(entry?.minRatio).toBeUndefined();
    expect(entry?.consumer).toContain('ServerTableEngineTurns.scheduleHorseAction');
    expect(entry?.consumer).toContain('HorseLogic.decide');
  });
});
