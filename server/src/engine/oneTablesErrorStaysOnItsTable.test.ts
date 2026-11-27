/**
 * ONE TABLE'S ERROR STAYS ON ITS TABLE (2026-11-27).
 *
 * Before: index.ts sent every uncaughtException and unhandledRejection to
 * fatal(), so one throw in one table's timer, or one rejected promise in one
 * table's hand pipeline, drained the whole engine and voided every hand on
 * every table. After: per-table entry points run through TableFaultBoundary,
 * which fences only the table whose work failed (killForRestart, then the
 * owner rebuilds that one table), and the process handlers keep fatal() for
 * every error no table wrapper attributed.
 *
 * These are behaviour tests on real ServerTableEngine instances, with a tiny
 * owner standing in for GameServer's onRestartRequired wiring. Each would fail
 * before the change: the throwing timer escaped vi.advanceTimersByTime (the
 * same throw is an uncaughtException in production), the rejected detached
 * promise reached the process as an unhandledRejection, and the scheduler only
 * logged a throwing deadline while its table kept a half-run turn clock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeadlineScheduler } from './DeadlineScheduler.js';
import {
  _resetTableFaultSinksForTests,
  installProcessFaultHandlers,
  routeProcessFault,
  tableFaultAttribution,
  type TableFaultSink,
} from './TableFaultBoundary.js';

const { ServerTableEngine } = await import('./ServerTableEngine.js');
const { ServerTableEngineBase } = await import('./ServerTableEngineBase.js');

const TABLE_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const TABLE_B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const TABLE_C = 'cccccccc-0000-4000-8000-00000000000c';

type Engine = InstanceType<typeof ServerTableEngine>;

/** Stand-in for GameServer: counts the rebuilds each table asks for. */
function ownerFor(engines: Engine[]) {
  const rebuilds = new Map<string, string[]>();
  for (const engine of engines) {
    const id = (engine as any).tableId as string;
    rebuilds.set(id, []);
    engine.onRestartRequired((reason) => rebuilds.get(id)!.push(reason));
  }
  return rebuilds;
}

/** A running engine that owns its table's process-global resources. */
function liveEngine(tableId: string): Engine {
  const engine = new ServerTableEngine(tableId, null);
  (engine as any).running = true;
  expect((engine as any).claimProcessOwnership()).toBe(true);
  return engine;
}

const flushMicrotasks = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

let liveSnapshot: Map<string, unknown>;
const errorSpy = () => vi.spyOn(console, 'error').mockImplementation(() => {});

beforeEach(() => {
  liveSnapshot = new Map((ServerTableEngineBase as any).liveEngines);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  const live = (ServerTableEngineBase as any).liveEngines as Map<string, unknown>;
  live.clear();
  for (const [k, v] of liveSnapshot) live.set(k, v);
  _resetTableFaultSinksForTests();
});

describe("a throw in one table's timer", () => {
  it('restarts only that table; every other table keeps running', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    errorSpy();
    const a = liveEngine(TABLE_A);
    const b = liveEngine(TABLE_B);
    const c = liveEngine(TABLE_C);
    const rebuilds = ownerFor([a, b, c]);
    const boom = new Error('stray throw in table A');

    let bTicks = 0;
    let cTicks = 0;
    (a as any).tableTimeout(
      'probe',
      () => {
        throw boom;
      },
      10
    );
    (b as any).tableInterval('probe', () => bTicks++, 5);
    (c as any).tableTimeout('probe', () => cTicks++, 20);

    // Before the boundary this throw escaped the timer (an uncaughtException
    // and fatal() in production; a throw out of advanceTimersByTime here).
    expect(() => vi.advanceTimersByTime(25)).not.toThrow();

    expect(a.isRunning()).toBe(false);
    expect(b.isRunning()).toBe(true);
    expect(c.isRunning()).toBe(true);
    expect(bTicks).toBeGreaterThanOrEqual(5);
    expect(cTicks).toBe(1);
    expect(tableFaultAttribution(boom)?.sink.tableId).toBe(TABLE_A);
    return flushMicrotasks().then(() => {
      expect(rebuilds.get(TABLE_A)).toEqual(['contained_fault:probe']);
      expect(rebuilds.get(TABLE_B)).toEqual([]);
      expect(rebuilds.get(TABLE_C)).toEqual([]);
    });
  });
});

describe("a rejection in one table's detached work", () => {
  it('never becomes a process unhandledRejection and restarts only that table', async () => {
    errorSpy();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const a = liveEngine(TABLE_A);
      const b = liveEngine(TABLE_B);
      const rebuilds = ownerFor([a, b]);
      const failure = new Error('hand pipeline rejected on table A');

      (a as any).detachTableWork('pacedAllInRunout', Promise.reject(failure));
      (b as any).detachTableWork('broadcastCurrentState', Promise.resolve());
      await flushMicrotasks();
      // Give Node a turn to process its rejection queue.
      await new Promise((r) => setImmediate(r));

      expect(unhandled).toEqual([]);
      expect(a.isRunning()).toBe(false);
      expect(b.isRunning()).toBe(true);
      expect(rebuilds.get(TABLE_A)).toEqual(['contained_fault:pacedAllInRunout']);
      expect(rebuilds.get(TABLE_B)).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('a later fault on an already fenced table is recorded, not a second restart', async () => {
    errorSpy();
    const a = liveEngine(TABLE_A);
    const rebuilds = ownerFor([a]);
    (a as any).detachTableWork('first', Promise.reject(new Error('first')));
    await flushMicrotasks();
    (a as any).detachTableWork('second', Promise.reject(new Error('second')));
    await flushMicrotasks();
    expect(rebuilds.get(TABLE_A)).toEqual(['contained_fault:first']);
  });
});

describe('a throwing deadline on the shared scheduler', () => {
  it("is handed to its own table's engine; the scheduler keeps serving the others", async () => {
    errorSpy();
    let now = 1_000;
    const scheduler = new DeadlineScheduler({ now: () => now });
    const a = liveEngine(TABLE_A);
    const b = liveEngine(TABLE_B);
    const rebuilds = ownerFor([a, b]);
    const fired: string[] = [];

    scheduler.schedule({
      tableId: TABLE_A,
      eventId: 'turn',
      deadlineMs: 1_010,
      callback: () => {
        throw new Error('turn clock threw on table A');
      },
    });
    scheduler.schedule({
      tableId: TABLE_B,
      eventId: 'turn',
      deadlineMs: 1_010,
      callback: () => fired.push('b-turn'),
    });
    now = 1_020;
    expect(scheduler.tickNow()).toBe(2);
    await flushMicrotasks();

    expect(fired).toEqual(['b-turn']);
    expect(a.isRunning()).toBe(false);
    expect(b.isRunning()).toBe(true);
    expect(rebuilds.get(TABLE_A)).toEqual(['contained_fault:deadline:turn']);
    expect(rebuilds.get(TABLE_B)).toEqual([]);

    scheduler.schedule({
      tableId: TABLE_B,
      eventId: 'heartbeat',
      deadlineMs: 1_030,
      callback: () => fired.push('b-heartbeat'),
    });
    now = 1_040;
    scheduler.tickNow();
    expect(fired).toEqual(['b-turn', 'b-heartbeat']);
  });

  it('a tableId with no engine keeps the old report-only behaviour', () => {
    const report = errorSpy();
    let now = 0;
    const scheduler = new DeadlineScheduler({ now: () => now });
    scheduler.schedule({
      tableId: 'no-engine-here',
      eventId: 'x',
      deadlineMs: 1,
      callback: () => {
        throw new Error('nobody owns this');
      },
    });
    now = 2;
    expect(() => scheduler.tickNow()).not.toThrow();
    expect(report.mock.calls.some((c) => c[0] === '[DeadlineScheduler.callback_threw]')).toBe(true);
  });
});

describe('the process handlers', () => {
  function fakeProcess() {
    const listeners = new Map<string, (error: unknown) => void>();
    return {
      on(event: string, listener: (error: unknown) => void) {
        listeners.set(event, listener);
      },
      emit(event: string, error: unknown) {
        listeners.get(event)!(error);
      },
    };
  }

  it('an unattributed uncaught exception or rejection still calls fatal', () => {
    const fatal = vi.fn();
    const proc = fakeProcess();
    installProcessFaultHandlers(proc, fatal);

    const thrown = new Error('nobody knows where this came from');
    proc.emit('uncaughtException', thrown);
    proc.emit('unhandledRejection', 'a bare string reason');

    expect(fatal).toHaveBeenCalledTimes(2);
    expect(fatal).toHaveBeenNthCalledWith(1, thrown, 'GameServer.Uncaught_exception');
    expect(fatal).toHaveBeenNthCalledWith(
      2,
      'a bare string reason',
      'GameServer.Unhandled_rejection'
    );
  });

  it("a table's already attributed error that escapes again stays with that table", async () => {
    errorSpy();
    const fatal = vi.fn();
    const a = liveEngine(TABLE_A);
    const b = liveEngine(TABLE_B);
    const rebuilds = ownerFor([a, b]);
    const failure = new Error('table A');
    (a as any).detachTableWork('probe', Promise.reject(failure));
    await flushMicrotasks();

    // A derived chain someone left unobserved rejects with the same object.
    expect(routeProcessFault(failure, 'unhandledRejection', fatal)).toBe('contained');
    expect(fatal).not.toHaveBeenCalled();
    expect(b.isRunning()).toBe(true);
    expect(rebuilds.get(TABLE_A)).toEqual(['contained_fault:probe']);
  });

  it('containment that throws is not containment: it escapes, and stays fatal', async () => {
    const fatal = vi.fn();
    const brokenSink: TableFaultSink = {
      tableId: 'broken',
      containTableFault: () => {
        throw new Error('sink is broken');
      },
    };
    const { tableCallback } = await import('./TableFaultBoundary.js');
    const failure = new Error('table work failed');
    const callback = tableCallback(brokenSink, 'probe', () => {
      throw failure;
    });
    // The wrapper does not swallow a failed containment: the sink's error
    // leaves the timer callback, so in production it is an uncaughtException
    // that nothing attributed.
    let escaped: unknown;
    try {
      callback();
    } catch (error) {
      escaped = error;
    }
    expect((escaped as Error)?.message).toBe('sink is broken');
    expect(routeProcessFault(escaped, 'uncaughtException', fatal)).toBe('fatal');
    // The branded original, routed again, cannot be contained either.
    expect(routeProcessFault(failure, 'unhandledRejection', fatal)).toBe('fatal');
    expect(fatal).toHaveBeenCalledTimes(2);
  });
});
