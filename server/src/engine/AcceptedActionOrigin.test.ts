import { playerActionContext } from './PlayerActionContext.js';
import { privateHorseTurnClocks, reviewHorseTurnClocks } from './HorseTurnClockReceipt.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deadlineScheduler } from './DeadlineScheduler.js';
import { HandController } from './HandController.js';
import { ServerTableEngine } from './ServerTableEngine.js';
import type { AcceptedActionOrigin, HandEvent, SeatPlayer } from '../types.js';

function harness() {
  const players: SeatPlayer[] = [1, 2, 3].map((seat) => ({
    seat,
    user_id: `u${seat}`,
    username: 'offline',
    stack: 200,
    bet: 0,
    totalInvested: 0,
    cards: [],
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
  }));
  const controller = new HandController(
    {
      tableId: 'origin-test',
      handNumber: 1,
      gameVariant: 'nlh',
      smallBlind: 1,
      bigBlind: 2,
      rakeConfig: { percent: 0, cap: 0, noFlopNoDrop: true },
    },
    players,
    1
  );
  const events: Array<Extract<HandEvent, { type: 'PLAYER_ACTION' }>> = [];
  controller.onEvent((event) => {
    if (event.type === 'PLAYER_ACTION') events.push(event);
  });
  controller.start();
  const engine = Object.create(ServerTableEngine.prototype) as ServerTableEngine & {
    handController: HandController;
    lifecycleCanMutate: () => boolean;
    actionLock: boolean;
    cancelHorseDecisionWork: () => void;
    _handlePlayerActionInner: (
      user: string,
      action: string,
      amount: number | undefined,
      origin: AcceptedActionOrigin
    ) => { success: boolean };
    forceResolveSeat: (seat: number, preferCheck: boolean) => boolean;
  };
  // Exercise the production serialization/context gate and forced-action owner
  // with a real controller, while excluding unrelated clock/lease infrastructure.
  Object.assign(engine, {
    // Fresh constructor custody, distinct from the retained-original tests.
    leaveFoldControllers: new WeakMap(),
    pendingOriginalContinuation: null,
    handContinuation: null,
    handController: controller,
    lifecycleCanMutate: () => true,
    actionLock: false,
    cancelHorseDecisionWork: vi.fn(),
    _handlePlayerActionInner: (
      user: string,
      action: string,
      amount: number | undefined,
      origin: AcceptedActionOrigin
    ) => ({
      success: controller.performAction(Number(user.slice(1)), action as 'call', amount, origin),
    }),
  });
  return { controller, events, engine };
}

describe('accepted action origin is an executor fact, not a roster inference', () => {
  it.each([0, 2])(
    'records forced contributions and the already-returned amount without another chip movement (ante=%s)',
    async (ante) => {
      const players: SeatPlayer[] = [1, 2].map((seat) => ({
        seat,
        user_id: `u${seat}`,
        username: 'offline',
        stack: 1000,
        bet: 0,
        totalInvested: 0,
        cards: [],
        is_folded: false,
        is_all_in: false,
        is_sitting_out: false,
      }));
      const controller = new HandController(
        {
          tableId: 'origin-money-events',
          handNumber: 1,
          gameVariant: 'nlh',
          smallBlind: 5,
          bigBlind: 10,
          ante,
          rakeConfig: { percent: 5, cap: 100, noFlopNoDrop: true },
        },
        players,
        1
      );
      class HistoryEngine extends ServerTableEngine {
        constructor() {
          super('origin-money-events');
          this.handController = controller;
        }
        record(event: HandEvent) {
          return this.handleHandEvent(event, []);
        }
        get history() {
          return this.currentHandActions;
        }
      }
      const engine = new HistoryEngine();
      const pending: Promise<void>[] = [];
      const events: HandEvent[] = [];
      controller.onEvent((event) => {
        events.push(event);
        if (event.type === 'FORCED_BETS_POSTED' || event.type === 'UNCALLED_BET_RETURNED')
          pending.push(engine.record(event));
      });
      controller.start();
      const postedPot = controller.getState().pot;
      await Promise.all(pending);
      const postings = events.flatMap((event) =>
        event.type === 'FORCED_BETS_POSTED' ? event.postings : []
      );
      expect(engine.history).toEqual(
        postings.map(({ kind, ...posting }) => ({
          ...posting,
          action: kind,
          stage: 'preflop',
          timestamp: expect.any(Number),
          origin: 'forced',
        }))
      );
      expect(postedPot).toBe(15 + ante * 2);
      expect(controller.getState().pot).toBe(postedPot);
      const prefix = structuredClone(engine.history);
      expect(controller.performAction(1, 'call', 0, 'player')).toBe(true);
      expect(controller.performAction(2, 'check', 0, 'player')).toBe(true);
      expect(controller.performAction(2, 'check', 0, 'player')).toBe(true);
      expect(controller.performAction(1, 'bet', 100, 'player')).toBe(true);
      expect(controller.performAction(2, 'fold', 0, 'player')).toBe(true);
      const settled = structuredClone(controller.getState());
      await Promise.all(pending);
      expect(engine.history.slice(0, prefix.length)).toEqual(prefix);
      expect(engine.history.slice(prefix.length)).toEqual([
        {
          seat: 1,
          userId: 'u1',
          action: 'return',
          amount: 100,
          timestamp: expect.any(Number),
          stage: 'flop',
          historyEvent: 'uncalled_bet_returned',
        },
      ]);
      expect(engine.history.at(-1)).not.toHaveProperty('origin');
      expect(events.filter((event) => event.type === 'UNCALLED_BET_RETURNED')).toHaveLength(1);
      expect(controller.getState()).toEqual(settled);
      const completion = events.find((event) => event.type === 'HAND_COMPLETE');
      const rake = ante === 0 ? 1 : 1.2;
      expect(completion).toMatchObject({ rake });
      expect(settled.players.map((player) => player.stack)).toEqual(
        ante === 0 ? [1009, 990] : [1010.8, 988]
      );
      expect(settled.players.reduce((sum, player) => sum + player.stack, 0) + rake).toBe(2000);
    }
  );

  it.each(['player', 'pre_action', 'horse_policy', 'horse_fallback', 'forced', 'unknown'] as const)(
    'preserves %s only on accepted internal/durable facts',
    (origin) => {
      const h = harness();
      expect(h.controller.performAction(2, 'call', undefined, origin)).toBe(false);
      expect(h.events).toHaveLength(0);
      expect(h.controller.performAction(1, 'call', undefined, origin)).toBe(true);
      expect(h.events[0].origin).toBe(origin);
      expect(h.controller.getState().actionHistory[0]).not.toHaveProperty('origin');
      if (origin === 'forced')
        expect(h.controller.getState({ includeActionOrigins: true }).actionHistory[0].origin).toBe(
          'forced'
        );
    }
  );

  it('defaults old or malformed callers to unknown without changing valid poker', () => {
    for (const origin of [undefined, 'client_claimed_player', null]) {
      const h = harness();
      expect(h.controller.performAction(1, 'call', undefined, origin as AcceptedActionOrigin)).toBe(
        true
      );
      expect(h.events[0].origin).toBe('unknown');
    }
  });

  it('only labels a validated displayed context as a direct player action', () => {
    const h = harness();
    expect(h.engine.handlePlayerAction('u1', 'call', undefined, 'stale').success).toBe(false);
    expect(h.events).toHaveLength(0);
    expect(
      h.engine.handlePlayerAction('u1', 'call', undefined, h.engine.getActionContext()).success
    ).toBe(true);
    expect(h.events[0].origin).toBe('player');
  });

  it('keeps an unlabelled trusted internal caller unknown', () => {
    const h = harness();
    expect(h.engine.handlePlayerAction('u1', 'call').success).toBe(true);
    expect(h.events[0].origin).toBe('unknown');
  });

  it('carries the immediate pre-action source through the same serialization gate', () => {
    const h = harness();
    expect(
      h.engine.handlePlayerAction('u1', 'call', undefined, undefined, 'pre_action').success
    ).toBe(true);
    expect(h.events[0].origin).toBe('pre_action');
  });

  it('records a timeout on the accepted controller action, including elapsed enforcement grace', () => {
    const { engine, controller, events } = harness();
    const start = Date.now() - 2200;
    Object.assign(engine, {
      horseActionableClock: {
        context: playerActionContext(controller),
        seat: 1,
        startedAtMs: start,
        armed: true,
      },
      playerTurnStartTime: start,
      playerTurnDuration: 2,
    });
    expect(engine.forceResolveSeat(1, true, 'timer_expired')).toBe(true);
    const r = events[0].record!;
    const report = reviewHorseTurnClocks(privateHorseTurnClocks([r]), [{ ...r, origin: 'forced' }]);
    expect(report).toEqual([
      {
        seat: 1,
        action: 'fold',
        path: 'timeout',
        reason: 'timer_expired',
        actionIndex: 0,
        startedAtMs: start,
        deadlineMs: start + 2000,
        acceptedAtMs: r.timestamp,
        elapsedMs: r.timestamp - start,
        remainingMs: start + 2000 - r.timestamp,
      },
    ]);
    expect(report[0].remainingMs).toBeLessThan(0);
  });

  it('distinguishes a forced recovery from a voluntary fold by the same seat', () => {
    const forced = harness(),
      voluntary = harness();
    expect(forced.engine.forceResolveSeat(1, true)).toBe(true);
    expect(voluntary.controller.performAction(1, 'fold', undefined, 'player')).toBe(true);
    expect(forced.events[0]).toMatchObject({ action: 'fold', origin: 'forced' });
    expect(voluntary.events[0]).toMatchObject({ action: 'fold', origin: 'player' });
    expect(forced.controller.getState().players.map((p) => p.stack)).toEqual(
      voluntary.controller.getState().players.map((p) => p.stack)
    );
  });
});

describe('Horse turn clocks retain the original turn through re-arms', () => {
  afterEach(() => vi.restoreAllMocks());

  function clockHarness() {
    const h = harness();
    const engine = new ServerTableEngine('clock-receipt-test') as any;
    let now = 1_800_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    vi.spyOn(deadlineScheduler, 'schedule').mockImplementation(() => {});
    vi.spyOn(deadlineScheduler, 'cancel').mockImplementation(() => {});
    Object.assign(engine, {
      handController: h.controller,
      lifecycleCanMutate: () => true,
      isCurrentEngine: () => true,
      running: true,
      tableInfo: { action_time_seconds: 15 },
      preciseTimer: { startTimer: vi.fn(), cancelTimer: vi.fn() },
      horseActionableClock: {
        context: playerActionContext(h.controller),
        seat: 1,
        startedAtMs: now,
        armed: false,
      },
      playerTurnStartTime: now,
      playerTurnDuration: 15,
    });
    return { ...h, engine, advance: (ms: number) => (now += ms) };
  }

  it('keeps the visible pre-action start after rejection and first timer arm', async () => {
    const h = clockHarness();
    const startedAtMs = Date.now();
    const player = { user_id: 'u1', seat_number: 1, is_horse: true };
    Object.assign(h.engine, {
      seatedPlayers: [player],
      preActionEngine: {
        getPreAction: () => ({ action: 'auto_check_fold' }),
        // Checking facing the blind is illegal, so the real controller refuses.
        executePreAction: () => ({ executed: true, action: 'check' }),
      },
      disconnectEngine: {
        onPlayerTurn: () => true,
        isInReconnectGrace: () => false,
      },
      sleepHand: async () => {
        h.advance(400);
      },
      pushPreActionToPlayer: vi.fn(),
      scheduleHorseAction: vi.fn(),
    });
    await h.engine.handleTurnChange({ type: 'TURN_CHANGE', seat: 1, availableActions: [] }, [
      player,
    ]);
    expect(h.events).toHaveLength(0);
    expect(h.engine.playerTurnStartTime).toBe(startedAtMs + 400);
    expect(h.engine.horseActionableClock.startedAtMs).toBe(startedAtMs);
    h.advance(2100);
    expect(
      h.controller.performAction(
        1,
        'call',
        undefined,
        'horse_policy',
        h.engine.horseClockObserver(1, 'strategy')
      )
    ).toBe(true);
    expect(privateHorseTurnClocks([h.events[0].record!])).toEqual([
      {
        actionIndex: 0,
        path: 'strategy',
        startedAtMs,
        deadlineMs: startedAtMs + 15_400,
        acceptedAtMs: startedAtMs + 2500,
      },
    ]);
  });

  it('converts seconds once, retains start through extensions and rejected-action retries', () => {
    const h = clockHarness();
    const startedAtMs = Date.now();
    h.engine.startTurnTimer('u1', 1, 15);
    h.advance(12_000);
    h.engine.startTurnTimer('u1', 1, 7.25, 'time_bank');
    const deadlineMs = startedAtMs + 19_250;
    const attempt = h.engine.horseClockObserver(1, 'strategy');
    expect(h.controller.performAction(1, 'check', undefined, 'horse_policy', attempt)).toBe(false);
    expect(h.events).toHaveLength(0);
    h.advance(500);
    h.engine.restoreTurnClockAfterRejectedAction('u1', 1, deadlineMs);
    h.advance(500);
    expect(
      h.controller.performAction(
        1,
        'call',
        undefined,
        'horse_policy',
        h.engine.horseClockObserver(1, 'strategy')
      )
    ).toBe(true);
    expect(privateHorseTurnClocks([h.events[0].record!])).toEqual([
      {
        actionIndex: 0,
        path: 'strategy',
        startedAtMs,
        deadlineMs,
        acceptedAtMs: startedAtMs + 13_000,
      },
    ]);
  });

  it('leaves absent and stale hand or turn clocks unknown', () => {
    const h = clockHarness();
    const clock = h.engine.horseActionableClock;
    h.engine.horseActionableClock = null;
    expect(h.engine.horseClockObserver(1, 'strategy')).toBeUndefined();
    h.engine.horseActionableClock = clock;
    expect(h.engine.horseClockObserver(2, 'strategy')).toBeUndefined();
    expect(h.controller.performAction(1, 'call', undefined, 'horse_policy')).toBe(true);
    expect(h.engine.horseClockObserver(1, 'strategy')).toBeUndefined();
    expect(privateHorseTurnClocks([h.events[0].record!])).toEqual([]);
    h.engine.handController = harness().controller;
    expect(h.engine.horseClockObserver(1, 'strategy')).toBeUndefined();
  });

  it.each([
    ['strategy', 'horse_policy', undefined],
    ['quick_check_fold', 'pre_action', undefined],
    ['pre_action', 'pre_action', undefined],
    ['timeout', 'forced', 'timebank_expired'],
    ['fallback', 'horse_fallback', 'route_gate'],
  ] as const)('retains %s only after the controller accepts its action', (path, origin, reason) => {
    const h = clockHarness();
    h.engine.startTurnTimer('u1', 1, 15);
    const observer = h.engine.horseClockObserver(1, path, reason);
    expect(h.controller.performAction(2, 'fold', undefined, origin, observer)).toBe(false);
    expect(h.events).toHaveLength(0);
    h.advance(2500);
    expect(h.controller.performAction(1, 'fold', undefined, origin, observer)).toBe(true);
    const record = h.events[0].record!;
    const result = reviewHorseTurnClocks(privateHorseTurnClocks([record]), [{ ...record, origin }]);
    expect(result[0]).toMatchObject({
      actionIndex: 0,
      seat: 1,
      action: 'fold',
      path,
      elapsedMs: 2500,
      remainingMs: 12_500,
      ...(reason ? { reason } : {}),
    });
    expect(record).toMatchObject({ userId: 'u1', stage: 'preflop' });
  });
});
