import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ALL_EVENTS_DB_MAX_IN_FLIGHT,
  DB_POOL_SIZE,
  EVENT_DB_BACKOFF_MAX_MS,
  EVENT_DB_MAX_IN_FLIGHT,
  EVENT_DB_MIN_IN_FLIGHT,
  EventDatabaseBulkhead,
  classifyEventDbFailure,
  classifyEventDbOutcome,
  type EventDbPermit,
} from './eventDatabaseBulkhead.js';

const STUCK = 'stuck-event';
// Date is what the fake clock moves.
const now = () => Date.now();
const quiet = () => new EventDatabaseBulkhead({ log: () => {}, random: () => 1, now });

/** Take a slot the way the fetch wrapper does, recording when it is admitted. */
function ask(bulkhead: EventDatabaseBulkhead, key: string, signal?: AbortSignal) {
  const call: { permit: EventDbPermit | null; error: unknown; sync: boolean } = {
    permit: null,
    error: null,
    sync: false,
  };
  const admitted = bulkhead.acquire(key, signal);
  if (admitted instanceof Promise) {
    admitted.then(
      (permit) => {
        call.permit = permit;
      },
      (error) => {
        call.error = error;
      }
    );
  } else {
    call.permit = admitted;
    call.sync = true;
  }
  return call;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the limits fit the pool', () => {
  it('leaves forty slots no tournament can take, and one event under a quarter', () => {
    expect(DB_POOL_SIZE - ALL_EVENTS_DB_MAX_IN_FLIGHT).toBeGreaterThanOrEqual(40);
    expect(EVENT_DB_MAX_IN_FLIGHT * 4).toBeLessThan(DB_POOL_SIZE);
    expect(EVENT_DB_MIN_IN_FLIGHT * 10).toBeLessThanOrEqual(ALL_EVENTS_DB_MAX_IN_FLIGHT);
    expect(EVENT_DB_MIN_IN_FLIGHT).toBeGreaterThanOrEqual(1);
  });
});

describe('a healthy event is never delayed', () => {
  it('admits every call under the bound synchronously, with no timer', () => {
    const bulkhead = quiet();
    for (let i = 0; i < EVENT_DB_MAX_IN_FLIGHT; i++) {
      expect(ask(bulkhead, 'healthy').sync).toBe(true);
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it('forgets an event once it is idle at its full bound', () => {
    const bulkhead = quiet();
    const call = ask(bulkhead, 'healthy');
    bulkhead.release(call.permit!, 'ok');
    expect(bulkhead.snapshot().events).toHaveLength(0);
  });
});

describe('a stuck event', () => {
  it('never holds more than its bound, however many calls it makes', async () => {
    const bulkhead = quiet();
    const calls = Array.from({ length: 200 }, () => ask(bulkhead, STUCK));
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.filter((c) => c.permit).length).toBe(EVENT_DB_MAX_IN_FLIGHT);
    const state = bulkhead.snapshot();
    expect(state.totalInFlight).toBe(EVENT_DB_MAX_IN_FLIGHT);
    expect(state.events[0].parked).toBe(200 - EVENT_DB_MAX_IN_FLIGHT);
  });

  it('leaves every other event flowing without a wait', async () => {
    const bulkhead = quiet();
    for (let i = 0; i < 200; i++) ask(bulkhead, STUCK);
    for (let event = 0; event < 5; event++) {
      for (let i = 0; i < 5; i++) expect(ask(bulkhead, `other-${event}`).sync).toBe(true);
    }
  });

  it('settles at the floor once its answers come back slow or cancelled', async () => {
    const bulkhead = quiet();
    const calls = Array.from({ length: 200 }, () => ask(bulkhead, STUCK));
    // Each second, every admitted call times out and the parked ones take over.
    for (let second = 0; second < 8; second++) {
      await vi.advanceTimersByTimeAsync(1_000);
      for (const call of calls) if (call.permit) bulkhead.release(call.permit, 'congested');
    }
    await vi.advanceTimersByTimeAsync(EVENT_DB_BACKOFF_MAX_MS);
    const event = bulkhead.snapshot().events[0];
    expect(event.limit).toBe(EVENT_DB_MIN_IN_FLIGHT);
    expect(event.inFlight + event.cooling).toBeLessThanOrEqual(EVENT_DB_MIN_IN_FLIGHT);
    expect(bulkhead.snapshot().totalInFlight).toBeLessThanOrEqual(EVENT_DB_MIN_IN_FLIGHT);
  });

  it('holds a refused slot closed for a bounded pause before the next call', async () => {
    const bulkhead = new EventDatabaseBulkhead({
      log: () => {},
      now,
      random: () => 1,
      maxPerEvent: 1,
      minPerEvent: 1,
    });
    const first = ask(bulkhead, STUCK);
    const second = ask(bulkhead, STUCK);
    bulkhead.release(first.permit!, 'congested');
    await vi.advanceTimersByTimeAsync(99);
    expect(second.permit).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(second.permit).not.toBeNull();
    // Many refusals in a row never pause longer than the stated maximum.
    let current = second;
    for (let i = 0; i < 12; i++) {
      const next = ask(bulkhead, STUCK);
      bulkhead.release(current.permit!, 'congested');
      await vi.advanceTimersByTimeAsync(EVENT_DB_BACKOFF_MAX_MS);
      expect(next.permit).not.toBeNull();
      current = next;
    }
  });

  it('gets its full bound back from good answers', async () => {
    const bulkhead = quiet();
    // Three consecutive slow answers at low concurrency drop 24 -> 12 -> 6
    // (the first isolated slow starts slowStreak=1 without halving; the 2nd
    // and 3rd consecutive slow answers halve 24 -> 12 -> 6).
    for (let i = 0; i < 3; i++) {
      const slowCall = ask(bulkhead, STUCK);
      bulkhead.release(slowCall.permit!, 'slow');
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(bulkhead.snapshot().events[0].limit).toBe(EVENT_DB_MIN_IN_FLIGHT);
    for (let i = 0; i < 400; i++) {
      const call = ask(bulkhead, STUCK);
      expect(call.sync).toBe(true);
      bulkhead.release(call.permit!, 'ok');
    }
    // Idle at the full bound again, so the event is forgotten.
    expect(bulkhead.snapshot().events).toHaveLength(0);
  });

  it('does not halve the bound on a single isolated slow answer at low concurrency, but halves on streak >= 2 or active load', async () => {
    const bulkhead = quiet();
    const lone = ask(bulkhead, 'quiet-slow');
    bulkhead.release(lone.permit!, 'slow');
    expect(bulkhead.snapshot().events[0]?.limit).toBe(EVENT_DB_MAX_IN_FLIGHT);
    // An ok answer resets slowStreak so the idle event is forgotten immediately.
    const ok = ask(bulkhead, 'quiet-slow');
    bulkhead.release(ok.permit!, 'ok');
    expect(bulkhead.snapshot().events).toHaveLength(0);

    // Two consecutive slow answers within 10s DO halve 24 -> 12.
    const s1 = ask(bulkhead, 'slow-streak');
    bulkhead.release(s1.permit!, 'slow');
    await vi.advanceTimersByTimeAsync(1_000);
    const s2 = ask(bulkhead, 'slow-streak');
    bulkhead.release(s2.permit!, 'slow');
    expect(bulkhead.snapshot().events[0].limit).toBe(Math.floor(EVENT_DB_MAX_IN_FLIGHT / 2));

    // Active concurrency (>= minPerEvent still in flight) halves on the first slow answer.
    const active = Array.from({ length: EVENT_DB_MIN_IN_FLIGHT + 1 }, () =>
      ask(bulkhead, 'busy-slow')
    );
    bulkhead.release(active[0].permit!, 'slow');
    const busy = bulkhead.snapshot().events.find((e) => e.key === 'busy-slow')!;
    expect(busy.limit).toBe(Math.floor(EVENT_DB_MAX_IN_FLIGHT / 2));
  });

  it('does not halve the bound on a single isolated congested refusal at low concurrency, but halves on streak >= 2 or active load', async () => {
    const bulkhead = quiet();
    // Isolated 40001 at inFlight=0: cools one slot, keeps full bound 24.
    const lone = ask(bulkhead, 'quiet-event');
    bulkhead.release(lone.permit!, 'congested');
    expect(bulkhead.snapshot().events[0].limit).toBe(EVENT_DB_MAX_IN_FLIGHT);
    expect(bulkhead.snapshot().events[0].cooling).toBe(1);
    await vi.advanceTimersByTimeAsync(EVENT_DB_BACKOFF_MAX_MS);
    expect(bulkhead.snapshot().events).toHaveLength(0);

    // Two consecutive congested refusals at low concurrency DO halve 24 -> 12.
    const c1 = ask(bulkhead, 'streak-event');
    bulkhead.release(c1.permit!, 'congested');
    expect(bulkhead.snapshot().events[0].limit).toBe(EVENT_DB_MAX_IN_FLIGHT);
    const c2 = ask(bulkhead, 'streak-event');
    bulkhead.release(c2.permit!, 'congested');
    expect(bulkhead.snapshot().events[0].limit).toBe(Math.floor(EVENT_DB_MAX_IN_FLIGHT / 2));

    // Active concurrency (>= minPerEvent still in flight) halves on the first congested answer.
    const active = Array.from({ length: EVENT_DB_MIN_IN_FLIGHT + 1 }, () =>
      ask(bulkhead, 'busy-event')
    );
    bulkhead.release(active[0].permit!, 'congested');
    const busy = bulkhead.snapshot().events.find((e) => e.key === 'busy-event')!;
    expect(busy.limit).toBe(Math.floor(EVENT_DB_MAX_IN_FLIGHT / 2));
  });
});

describe('parked calls', () => {
  it('logs the true parked queue depth (parked=1, never parked=0) when parking the first call', () => {
    const lines: string[] = [];
    const bulkhead = new EventDatabaseBulkhead({
      log: (line) => lines.push(line),
      now,
      maxPerEvent: 1,
      minPerEvent: 1,
    });
    const first = ask(bulkhead, STUCK);
    void bulkhead.acquire(STUCK);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('is parking calls');
    expect(lines[0]).toContain('parked=1');
    expect(lines[0]).not.toContain('parked=0');
    bulkhead.release(first.permit!, 'ok');
  });
  it('leave in the order they arrived', async () => {
    const bulkhead = new EventDatabaseBulkhead({ log: () => {}, maxPerEvent: 1, minPerEvent: 1 });
    const order: number[] = [];
    const first = ask(bulkhead, STUCK);
    const parked = [1, 2, 3].map((n) => {
      const admitted = bulkhead.acquire(STUCK) as Promise<EventDbPermit>;
      return admitted.then((permit) => {
        order.push(n);
        return permit;
      });
    });
    bulkhead.release(first.permit!, 'ok');
    for (const next of parked) bulkhead.release(await next, 'ok');
    expect(order).toEqual([1, 2, 3]);
  });

  it('end with the caller own abort reason and free nothing they never held', async () => {
    const bulkhead = new EventDatabaseBulkhead({ log: () => {}, maxPerEvent: 1, minPerEvent: 1 });
    const held = ask(bulkhead, STUCK);
    const deadline = new AbortController();
    const parked = ask(bulkhead, STUCK, deadline.signal);
    deadline.abort(new Error('supabase_timeout'));
    await vi.advanceTimersByTimeAsync(0);
    expect((parked.error as Error).message).toBe('supabase_timeout');
    expect(bulkhead.snapshot().totalInFlight).toBe(1);
    expect(bulkhead.snapshot().events[0].parked).toBe(0);
    bulkhead.release(held.permit!, 'ok');
    expect(bulkhead.snapshot().totalInFlight).toBe(0);
  });

  it('share the all events total one slot each in turn', async () => {
    const bulkhead = new EventDatabaseBulkhead({
      log: () => {},
      maxPerEvent: 4,
      minPerEvent: 1,
      maxAllEvents: 4,
    });
    const big = Array.from({ length: 4 }, () => ask(bulkhead, 'big'));
    const bigParked = Array.from({ length: 6 }, () => ask(bulkhead, 'big'));
    const small = [ask(bulkhead, 'small-a'), ask(bulkhead, 'small-b')];
    // Three slots free: the big event was first in line, the small ones are not starved.
    for (let i = 0; i < 3; i++) bulkhead.release(big[i].permit!, 'ok');
    await vi.advanceTimersByTimeAsync(0);
    expect(small.every((c) => c.permit)).toBe(true);
    expect(bigParked.filter((c) => c.permit).length).toBe(1);
    expect(bulkhead.snapshot().totalInFlight).toBe(4);
  });
});

describe('shutdown', () => {
  it('releases every parked call, clears its timers and stops counting', async () => {
    const bulkhead = quiet();
    const calls = Array.from({ length: 60 }, () => ask(bulkhead, STUCK));
    bulkhead.release(calls[0].permit!, 'congested');
    bulkhead.openForShutdown();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.every((c) => c.permit)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(ask(bulkhead, STUCK).sync).toBe(true);
    for (const call of calls) bulkhead.release(call.permit!, 'ok');
    expect(bulkhead.snapshot().totalInFlight).toBe(0);
  });
});

describe('what an answer says about the lane', () => {
  it('reads lock, statement and serialization refusals as congestion', () => {
    for (const code of ['57014', '55P03', '40001', '40P01', 'PGRST003'])
      expect(classifyEventDbOutcome(500, code, 10)).toBe('congested');
    expect(classifyEventDbOutcome(504, undefined, 10)).toBe('congested');
    expect(classifyEventDbOutcome(200, undefined, 10)).toBe('ok');
    expect(classifyEventDbOutcome(200, undefined, 2_500)).toBe('slow');
    expect(classifyEventDbOutcome(400, 'P0001', 10)).toBe('ok');
    expect(classifyEventDbOutcome(500, 'XX000', 10)).toBe('neutral');
    expect(classifyEventDbFailure(new Error('supabase_timeout'), 10)).toBe('congested');
    expect(classifyEventDbFailure(new TypeError('fetch failed'), 10)).toBe('neutral');
    // A caller's own short AbortSignal.timeout (e.g. 1500 ms on an observe-only
    // memory read) is below EVENT_DB_SLOW_CALL_MS and must not halve the
    // tournament's bulkhead; once it actually waited >= EVENT_DB_SLOW_CALL_MS
    // it still counts as congestion.
    const shortCallerTimeout = Object.assign(
      new Error('The operation was aborted due to timeout'),
      {
        name: 'TimeoutError',
      }
    );
    expect(classifyEventDbFailure(shortCallerTimeout, 1_500)).toBe('neutral');
    expect(classifyEventDbFailure(shortCallerTimeout, 2_000)).toBe('congested');
  });
});
