import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../services/supabase/client.js', () => ({ supabase: {}, maintenanceSupabase: {} }));
vi.mock('../services/errorReporter.js', () => ({ reportError: vi.fn() }));
vi.mock('../http/auth.js', () => ({ authenticateRequest: vi.fn(async () => ({ userId: 'u4' })) }));
vi.mock('../http/body.js', () => ({ readBody: vi.fn(async (req: any) => req.body) }));
vi.mock('../http/rateLimit.js', () => ({ checkRateLimit: vi.fn(() => true) }));
import { handleAction } from '../handlers/action.js';
import { _resetActionIdempotencyForTests } from '../http/actionIdempotency.js';
import { mockReq, mockRes, parseJson } from '../handlers/_testHelpers.js';
import { playerActionContext } from './PlayerActionContext.js';
import { HandController } from './HandController.js';
import { ServerTableEngine } from './ServerTableEngine.js';
import { HandContinuationLane } from './HandContinuationLane.js';
import { authenticateRequest } from '../http/auth.js';
import type { AcceptedActionOrigin, HandConfig, HandEvent, SeatPlayer } from '../types.js';

function hand() {
  const h = new HandController(
    {
      tableId: 'context-test',
      handNumber: 1,
      gameVariant: 'nlh',
      smallBlind: 1,
      bigBlind: 2,
      rakeConfig: { percent: 0, cap: 0, noFlopNoDrop: true },
    } as HandConfig,
    [1, 2, 3, 4].map((seat) => ({
      seat,
      user_id: `u${seat}`,
      username: `P${seat}`,
      stack: 100,
      bet: 0,
      totalInvested: 0,
      cards: [],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
    })) as SeatPlayer[],
    1
  );
  h.start();
  return h;
}
function harness() {
  const h = hand();
  const engine = Object.create(ServerTableEngine.prototype) as any;
  // Match the fresh engine constructor: no retained original or replay lane.
  engine.pendingOriginalContinuation = null;
  engine.handContinuation = null;
  engine.handController = h;
  engine.lifecycleCanMutate = () => true;
  engine.actionLock = false;
  engine._handlePlayerActionInner = vi.fn(
    (user: string, action: string, amount?: number, origin?: AcceptedActionOrigin) => ({
      success: h.performAction(Number(user.slice(1)), action as any, amount, origin),
    })
  );
  return { h, engine };
}
describe('HTTP decision context before engine mutation', () => {
  it.each(['previous-decision', null])(
    'rejects context %s without moving chips or advancing the turn',
    (context) => {
      const { h, engine } = harness();
      const before = JSON.stringify(h.getState());
      const result = engine.handlePlayerAction('u4', 'raise', 10, context);
      expect(result.success).toBe(false);
      expect(JSON.stringify(h.getState())).toBe(before);
      expect(engine._handlePlayerActionInner).not.toHaveBeenCalled();
    }
  );
  it('accepts the displayed context and retains trusted internal actions', () => {
    const { h, engine } = harness();
    expect(
      engine.handlePlayerAction('u4', 'call', undefined, engine.getActionContext()).success
    ).toBe(true);
    expect(engine.handlePlayerAction('u1', 'call').success).toBe(true);
    expect(h.getState().actionHistory.filter((a) => a.action === 'call')).toHaveLength(2);
  });
});

function revisit(h: HandController) {
  expect(h.performAction(1, 'raise', 6)).toBe(true);
  expect(h.performAction(2, 'call')).toBe(true);
  expect(h.performAction(3, 'call')).toBe(true);
  expect(h.getState().currentPlayerSeat).toBe(4);
}
describe('real hand decision identity', () => {
  it('changes when the same seat faces another decision in the same hand', () => {
    const { h, engine } = harness();
    const old = engine.getActionContext();
    expect(engine.handlePlayerAction('u4', 'call', undefined, old).success).toBe(true);
    revisit(h);
    const before = JSON.stringify(h.getState());
    expect(engine.handlePlayerAction('u4', 'call', undefined, old).code).toBe('STALE_ACTION');
    expect(JSON.stringify(h.getState())).toBe(before);
    expect(
      engine.handlePlayerAction('u4', 'call', undefined, engine.getActionContext()).success
    ).toBe(true);
  });
  it('rejects a rebuilt incarnation of the same numbered hand', () => {
    const { engine } = harness();
    const old = engine.getActionContext();
    engine.handController = hand();
    expect(engine.getActionContext()).not.toBe(old);
    expect(engine.handlePlayerAction('u4', 'raise', 10, old).code).toBe('STALE_ACTION');
    expect(engine._handlePlayerActionInner).not.toHaveBeenCalled();
  });
  it('is stable during clock updates and contains no card or deck values', () => {
    const { h, engine } = harness();
    const token = engine.getActionContext();
    engine.playerTurnStartTime = Date.now();
    engine.playerTurnDuration = 100;
    expect(engine.getActionContext()).toBe(token);
    expect(playerActionContext(h)).toBe(token);
    expect(token).toMatch(/^[0-9a-f-]{36}:preflop:0:4:2$/);
  });
});
async function post(engine: any, body: Record<string, unknown>) {
  const req = Object.assign(mockReq(), { body: JSON.stringify(body) });
  const { res, captured } = mockRes();
  await handleAction(req, res, { gameServer: { getTableEngine: () => engine } });
  return { status: captured.statusCode, body: parseJson(captured) as any };
}
describe('HTTP retries preserve the decision boundary', () => {
  beforeEach(() => _resetActionIdempotencyForTests());
  it('ignores caller-supplied provenance and does not create another origin on retry', async () => {
    const { h, engine } = harness();
    engine.recordActionPerformance = vi.fn();
    const events: Array<Extract<HandEvent, { type: 'PLAYER_ACTION' }>> = [];
    h.onEvent((event) => {
      if (event.type === 'PLAYER_ACTION') events.push(event);
    });
    const body = {
      tableId: 'context-test',
      action: 'call',
      actionContext: engine.getActionContext(),
      idempotencyKey: 'origin-key-0001',
      origin: 'horse_policy',
      trustedOrigin: 'pre_action',
    };
    expect((await post(engine, body)).body.success).toBe(true);
    expect((await post(engine, body)).body.replayed).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0].origin).toBe('player');
  });
  it('replays once, then rejects the obsolete decision even after cache eviction', async () => {
    const { h, engine } = harness();
    engine.recordActionPerformance = vi.fn();
    const body = {
      tableId: 'context-test',
      action: 'call',
      actionContext: engine.getActionContext(),
      idempotencyKey: 'context-key-0001',
    };
    expect((await post(engine, body)).body.success).toBe(true);
    revisit(h);
    const before = JSON.stringify(h.getState());
    expect((await post(engine, body)).body.replayed).toBe(true);
    expect(JSON.stringify(h.getState())).toBe(before);
    _resetActionIdempotencyForTests();
    expect((await post(engine, body)).body.code).toBe('STALE_ACTION');
    expect(JSON.stringify(h.getState())).toBe(before);
  });
  it('binds a duplicate key to its original context', async () => {
    const { h, engine } = harness();
    engine.recordActionPerformance = vi.fn();
    const body = {
      tableId: 'context-test',
      action: 'call',
      actionContext: engine.getActionContext(),
      idempotencyKey: 'context-key-0002',
    };
    expect((await post(engine, body)).body.success).toBe(true);
    revisit(h);
    expect((await post(engine, { ...body, actionContext: engine.getActionContext() })).status).toBe(
      409
    );
    expect(engine._handlePlayerActionInner).toHaveBeenCalledTimes(1);
  });
  it('a legacy browser gets a reload instruction without applying its action', async () => {
    const { engine } = harness();
    engine.recordActionPerformance = vi.fn();
    const result = await post(engine, { tableId: 'context-test', action: 'raise', amount: 10 });
    expect(result.status).toBe(200); // The legacy client reads only successful HTTP envelopes.
    expect(result.body.success).toBe(false);
    expect(result.body.code).toBe('ACTION_CONTEXT_REQUIRED');
    expect(result.body.error).toContain('Reload');
    expect(engine._handlePlayerActionInner).not.toHaveBeenCalled();
  });
});

describe('an existing decision survives its clock-only retention', () => {
  beforeEach(() => _resetActionIdempotencyForTests());
  afterEach(() => {
    vi.mocked(authenticateRequest).mockResolvedValue({ userId: 'u4' } as never);
  });
  async function retaining(action = 'call') {
    const { h, engine } = harness();
    if (action === 'check') {
      while (h.getState().stage === 'preflop') {
        const state = h.getState();
        const actor = state.players.find((p) => p.seat === state.currentPlayerSeat)!;
        expect(h.performAction(actor.seat, actor.bet < state.currentBet ? 'call' : 'check')).toBe(
          true
        );
      }
    }
    const user = h
      .getState()
      .players.find((p) => p.seat === h.getState().currentPlayerSeat)!.user_id;
    vi.mocked(authenticateRequest).mockResolvedValue({ userId: user } as never);
    const beforeHistory = h.getState().actionHistory.length;
    let release!: () => void;
    let reject!: (error: unknown) => void;
    const prior = new Promise<void>((resolve, refuse) => {
      release = resolve;
      reject = refuse;
    });
    const stored: string[] = [];
    const dispatched: HandEvent[] = [];
    let writes = 0;
    const lane = new HandContinuationLane(
      0,
      () => JSON.stringify(h.getState().actionHistory),
      () => ({}),
      async (batch) => {
        if (writes++ === 1) await prior;
        stored.push(batch.controller);
      },
      async (event) => {
        if (event.type !== 'CONTINUATION_TIME_BANK') dispatched.push(event);
      },
      () => true,
      (error) => {
        throw error;
      }
    );
    engine.handContinuation = lane;
    engine.recordActionPerformance = vi.fn();
    h.onEvent((event) => lane.enqueue(event));
    // Time-bank/presence metadata can need retention without changing this
    // already-published actor, wager, incarnation or decision count.
    lane.checkpoint();
    await lane.join();
    const context = engine.publishedActionContext(true);
    lane.checkpoint();
    return { h, engine, lane, context, release, reject, stored, beforeHistory, dispatched, user };
  }
  it('keeps the already retained decision available during a clock-only checkpoint', async () => {
    const f = await retaining();
    try {
      expect(f.engine.getActionContext()).toBe(f.context);
    } finally {
      f.release();
      await f.lane.join();
    }
  });
  it.each(['fold', 'check', 'call', 'raise', 'all_in'])(
    'accepts the original %s once and withholds its acknowledgement until retention',
    async (action) => {
      const f = await retaining(action);
      let completed = false;
      const body = {
        tableId: 'context-test',
        action,
        actionContext: f.context,
        ...(action === 'raise' ? { amount: 10 } : {}),
        idempotencyKey: `retention-${action}-0001`,
      };
      const first = post(f.engine, body).then((result) => {
        completed = true;
        return result;
      });
      try {
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(completed).toBe(false);
        expect(f.engine._handlePlayerActionInner).toHaveBeenCalledOnce();
        const duplicate = post(f.engine, body);
        f.release();
        expect((await first).body.success).toBe(true);
        expect((await duplicate).body).toMatchObject({ success: true, replayed: true });
        await f.lane.join();
        expect(f.engine._handlePlayerActionInner).toHaveBeenCalledOnce();
        const accepted = JSON.parse(f.stored.at(-1)!).slice(f.beforeHistory);
        expect(accepted).toHaveLength(1);
        expect(accepted[0].action).toBe(action);
        expect(accepted[0].userId).toBe(f.user);
        expect(f.dispatched.filter((event) => event.type === 'PLAYER_ACTION')).toEqual([
          expect.objectContaining({
            type: 'PLAYER_ACTION',
            action,
            origin: 'player',
            record: accepted[0],
          }),
        ]);
      } finally {
        f.release();
        await first;
        await f.lane.join();
      }
    }
  );
  it('withholds a new betting decision while its controller mutation is unretained', async () => {
    const f = await retaining();
    try {
      expect(f.h.performAction(4, 'call')).toBe(true);
      expect(playerActionContext(f.h)).not.toBe(f.context);
      expect(f.engine.getActionContext()).toBeNull();
    } finally {
      f.release();
      await f.lane.join();
    }
  });
  it.each(['decision', 'controller', 'lease', 'original-recovery'])(
    'refuses an obsolete capability after its %s changes',
    async (change) => {
      const f = await retaining();
      if (change === 'decision') expect(f.h.performAction(4, 'call')).toBe(true);
      if (change === 'controller') f.engine.handController = hand();
      if (change === 'lease') f.engine.lifecycleCanMutate = () => false;
      if (change === 'original-recovery') f.engine.pendingOriginalContinuation = {};
      const result = await post(f.engine, {
        tableId: 'context-test',
        action: 'fold',
        actionContext: f.context,
        idempotencyKey: `fenced-${change}-0001`,
      });
      expect(result.body.success).toBe(false);
      expect(result.body.code).toBe(
        change === 'lease' ? 'TABLE_LEASE_EXPIRED' : 'ACTION_STATE_PENDING'
      );
      expect(f.engine._handlePlayerActionInner).not.toHaveBeenCalled();
      f.release();
      await f.lane.join();
    }
  );
  it('a failed checkpoint cannot grant an old capability input again', async () => {
    const f = await retaining();
    await new Promise<void>((resolve) => setImmediate(resolve));
    f.reject(new Error('Original persistence acknowledgement unknown'));
    await expect(f.lane.join()).rejects.toThrow('acknowledgement unknown');
    expect(f.engine.getActionContext()).toBeNull();
    const result = await post(f.engine, {
      tableId: 'context-test',
      action: 'fold',
      actionContext: f.context,
      idempotencyKey: 'retain-already-failed-0001',
    });
    expect(result.body).toMatchObject({ success: false, code: 'ACTION_STATE_PENDING' });
    expect(f.engine._handlePlayerActionInner).not.toHaveBeenCalled();
  });
  it('does not carry the capability into an unretained replacement lane', async () => {
    const f = await retaining();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const replacement = new HandContinuationLane(
      0,
      () => JSON.stringify(f.h.getState().actionHistory),
      () => ({}),
      async () => pending,
      async () => {},
      () => true,
      () => {}
    );
    f.engine.handContinuation = replacement;
    replacement.checkpoint();
    try {
      expect(f.engine.getActionContext()).toBeNull();
      const result = await post(f.engine, {
        tableId: 'context-test',
        action: 'fold',
        actionContext: f.context,
        idempotencyKey: 'retain-replacement-0001',
      });
      expect(result.body).toMatchObject({ success: false, code: 'ACTION_STATE_PENDING' });
      expect(f.engine._handlePlayerActionInner).not.toHaveBeenCalled();
    } finally {
      release();
      f.release();
      await replacement.join();
      await f.lane.join();
      replacement.close();
      f.lane.close();
    }
  });
  it('a failed original write never acknowledges success or applies a duplicate mutation', async () => {
    const f = await retaining();
    const body = {
      tableId: 'context-test',
      action: 'fold',
      actionContext: f.context,
      idempotencyKey: 'retain-failure-0001',
    };
    const request = post(f.engine, body);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(f.engine._handlePlayerActionInner).toHaveBeenCalledOnce();
    f.reject(new Error('Original persistence acknowledgement unknown'));
    expect((await request).body).toMatchObject({ success: false, code: 'ACTION_OUTCOME_PENDING' });
    expect((await post(f.engine, body)).body).toMatchObject({
      success: false,
      code: 'ACTION_OUTCOME_PENDING',
      replayed: true,
    });
    expect(f.engine.getActionContext()).toBeNull();
    expect(f.engine._handlePlayerActionInner).toHaveBeenCalledOnce();
    await expect(f.lane.join()).rejects.toThrow('acknowledgement unknown');
  });
  it('closing the accepted original releases its HTTP wait as unknown, never success', async () => {
    const f = await retaining();
    const request = post(f.engine, {
      tableId: 'context-test',
      action: 'fold',
      actionContext: f.context,
      idempotencyKey: 'retain-close-0001',
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(f.engine._handlePlayerActionInner).toHaveBeenCalledOnce();
    f.lane.close();
    expect((await request).body).toMatchObject({ success: false, code: 'ACTION_OUTCOME_PENDING' });
    expect((f.lane as any).retentionWaiters).toHaveLength(0);
    expect(f.engine.getActionContext()).toBeNull();
    expect(f.engine._handlePlayerActionInner).toHaveBeenCalledOnce();
    f.release();
    await expect(f.lane.join()).rejects.toThrow('Fenced');
  });
});

it('a timely fold cancels the real expiry clock before its pending bytes are acknowledged', async () => {
  vi.useFakeTimers({
    toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
  });
  _resetActionIdempotencyForTests();
  const engine = new ServerTableEngine('input-retention-expiry') as any;
  const h = hand();
  expect(engine.claimProcessOwnership()).toBe(true);
  engine.running = true;
  engine.handController = h;
  engine.handCount = 1;
  engine.tableInfo = { game_variant: 'nlh', big_blind: 2, small_blind: 1, max_players: 4 };
  engine.seatedPlayers = h.getState().players.map((player) => ({
    user_id: player.user_id,
    seat_number: player.seat,
    stack: player.stack,
    is_horse: false,
  }));
  engine.hub = { publish: vi.fn(), emitEvent: vi.fn() };
  engine.requestSnapshot = vi.fn();
  let release!: () => void;
  const previous = new Promise<void>((resolve) => {
    release = resolve;
  });
  let writes = 0;
  const stored: string[] = [];
  const lane = new HandContinuationLane(
    0,
    () => JSON.stringify(h.getState().actionHistory),
    () => ({}),
    async (batch) => {
      if (writes++ === 1) await previous;
      stored.push(batch.controller);
    },
    async () => {},
    () => engine.handController === h,
    () => {}
  );
  engine.handContinuation = lane;
  h.onEvent((event) => lane.enqueue(event));
  lane.checkpoint();
  await lane.join();
  const context = engine.publishedActionContext(true);
  lane.checkpoint();
  const forced = vi.fn(() => h.performAction(4, 'fold', undefined, 'forced'));
  engine.preciseTimer.startTimer(engine.tableId, 'u4', 1_000, forced);
  engine.playerTurnStartTime = Date.now();
  engine.playerTurnDuration = 1;
  engine.turnFSM.reset('timer_running');
  let complete = false;
  const pending = post(engine, {
    tableId: engine.tableId,
    action: 'fold',
    actionContext: context,
    idempotencyKey: 'real-expiry-retention-0001',
  }).then((reply) => {
    complete = true;
    return reply;
  });
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(h.getState().players.find((player) => player.seat === 4)!.is_folded).toBe(true);
    expect(engine.preciseTimer.getDeadline(engine.tableId, 'u4')).toBe(0);
    expect(complete).toBe(false);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(forced).not.toHaveBeenCalled();
    expect(complete).toBe(false);
    release();
    expect((await pending).body.success).toBe(true);
    await lane.join();
    expect(
      JSON.parse(stored.at(-1)!).filter(
        (record: any) => record.userId === 'u4' && record.action === 'fold'
      )
    ).toHaveLength(1);
  } finally {
    release();
    await pending;
    await lane.join();
    lane.close();
    engine.clearLooseHandTimers();
    engine.clearTurnTimer();
    engine.preciseTimer.dispose();
    engine.actionValidator.dispose();
    engine.timeBankEngine.disposeAll();
    engine.engineTelemetry.dispose();
    (engine.constructor as any).releaseCurrentEngine(engine.tableId, engine);
    vi.useRealTimers();
  }
});

describe('decision context delivery', () => {
  const engines: ServerTableEngine[] = [];
  afterEach(async () => {
    for (const engine of engines.splice(0)) {
      const fixture = engine as any;
      const original = fixture.handController;
      const permit = fixture.f06CurrentPermit;
      expect(original.getLifecyclePhase()).toEqual({ handStarted: true, handCompleted: false });
      await expect(engine.stop()).rejects.toMatchObject({
        message: expect.stringContaining('retains unproven original hand custody'),
        errors: [expect.objectContaining({ message: 'Stopped Original Hand Custody Is Unproven' })],
      });
      expect(fixture.handController).toBe(original);
      expect(fixture.f06CurrentPermit).toBe(permit);
      expect(engine.hasReleasedProcessOwnership()).toBe(false);
      // Physical stop joined; explicitly destroy only this isolated fixture.
      // This registry cleanup is not a runtime retirement certificate.
      fixture.clearLooseHandTimers();
      fixture.clearTurnTimer();
      fixture.preciseTimer.dispose();
      fixture.actionValidator.dispose();
      fixture.timeBankEngine.disposeAll();
      (fixture.constructor as any).releaseCurrentEngine(fixture.tableId, fixture);
    }
  });
  function delivery() {
    const engine = new ServerTableEngine('context-delivery') as any;
    expect(engine.claimProcessOwnership()).toBe(true);
    engine.running = true;
    engine.handStartSettleMs = engine.streetSettleMs = engine.actionSettleMs = 0;
    engines.push(engine);
    const h = hand();
    engine.handController = h;
    engine.tableInfo = { game_variant: 'nlh', big_blind: 2, small_blind: 1, max_players: 4 };
    engine.handCount = 1;
    engine.hub = { publish: vi.fn(), emitEvent: vi.fn() };
    return { engine, h };
  }
  it('publishes the same context on HTTP resync and live state', async () => {
    const { engine } = delivery();
    const token = engine.getActionContext();
    expect(engine.getTableState('u4').action_context).toBe(token);
    await engine.broadcastCurrentState();
    expect(engine.hub.publish.mock.calls.at(-1)[1].action_context).toBe(token);
  });
  it.each([false, true])(
    'never labels an obsolete discrete turn with a new decision: advance=%s',
    async (advance) => {
      const { engine, h } = delivery();
      engine.handleTurnChange = vi.fn(async () => {});
      engine.markProgress = vi.fn();
      const token = engine.getActionContext();
      engine.broadcastCurrentState = vi.fn(async () => {
        if (advance) {
          h.performAction(4, 'call');
          revisit(h);
        }
      });
      await engine.handleHandEvent({ type: 'TURN_CHANGE', seat: 4, availableActions: [] }, [
        { seat_number: 4, user_id: 'u4' },
      ]);
      const turns = engine.hub.emitEvent.mock.calls.filter(
        (c: any[]) => c[1].type === 'turn_change'
      );
      if (advance) expect(turns).toHaveLength(0);
      else {
        expect(turns).toHaveLength(1);
        expect(turns[0][1].action_context).toBe(token);
      }
    }
  );
});

it('does not publish an actionable context during runout or showdown', () => {
  const h = hand();
  const s = (h as any).state;
  const originalSeat = s.currentPlayerSeat;
  s.currentPlayerSeat = -1;
  expect(playerActionContext(h)).toBeNull();
  s.currentPlayerSeat = originalSeat;
  s.stage = 'showdown';
  expect(playerActionContext(h)).toBeNull();
});
