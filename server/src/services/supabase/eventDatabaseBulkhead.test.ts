import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ALL_EVENTS_DB_MAX_IN_FLIGHT,
  DB_POOL_SIZE,
  EVENT_DB_BACKOFF_MAX_MS,
  EVENT_DB_HIGH_PRIORITY_BURST_LIMIT,
  EVENT_DB_MAX_IN_FLIGHT,
  EVENT_DB_MIN_IN_FLIGHT,
  EventDatabaseBulkhead,
  classifyEventDbFailure,
  classifyEventDbOutcome,
  classifyEventDbPriority,
  type EventDbPermit,
  type EventDbPriority,
} from './eventDatabaseBulkhead.js';

const STUCK = 'stuck-event';
// Date is what the fake clock moves.
const now = () => Date.now();
const quiet = () => new EventDatabaseBulkhead({ log: () => {}, random: () => 1, now });

/** Take a slot the way the fetch wrapper does, recording when it is admitted. */
function ask(
  bulkhead: EventDatabaseBulkhead,
  key: string,
  signal?: AbortSignal,
  priority?: EventDbPriority
) {
  const call: { permit: EventDbPermit | null; error: unknown; sync: boolean } = {
    permit: null,
    error: null,
    sync: false,
  };
  const admitted = bulkhead.acquire(key, signal, priority);
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
    // Sustained slowness (slowStreak >= 2) halves 24 -> 12, then after 1 s -> 6.
    let call = ask(bulkhead, STUCK);
    bulkhead.release(call.permit!, 'slow');
    call = ask(bulkhead, STUCK);
    bulkhead.release(call.permit!, 'slow');
    expect(bulkhead.snapshot().events[0].limit).toBe(Math.floor(EVENT_DB_MAX_IN_FLIGHT / 2));
    await vi.advanceTimersByTimeAsync(1_000);
    call = ask(bulkhead, STUCK);
    bulkhead.release(call.permit!, 'slow');
    expect(bulkhead.snapshot().events[0].limit).toBe(EVENT_DB_MIN_IN_FLIGHT);
    for (let i = 0; i < 400; i++) {
      call = ask(bulkhead, STUCK);
      expect(call.sync).toBe(true);
      bulkhead.release(call.permit!, 'ok');
    }
    // Idle at the full bound again, so the event is forgotten.
    expect(bulkhead.snapshot().events).toHaveLength(0);
  });

  it('does not halve a healthy event bound on a single isolated slow outlier, but halves on sustained slow streak >= 2 (1e532243)', async () => {
    const bulkhead = quiet();
    // Single slow call at inFlight=0 (e.g. vacuum tick or single rebuy): keeps full bound 24.
    const quietSlow = ask(bulkhead, 'quiet-slow');
    bulkhead.release(quietSlow.permit!, 'slow');
    expect(bulkhead.snapshot().events.find((e) => e.key === 'quiet-slow')!.limit).toBe(
      EVENT_DB_MAX_IN_FLIGHT
    );
    // A following ok answer resets slowStreak so the idle event is forgotten.
    const quietOk = ask(bulkhead, 'quiet-slow');
    bulkhead.release(quietOk.permit!, 'ok');
    expect(bulkhead.snapshot().events).toHaveLength(0);

    // Single slow call on an active 40-table tournament (20 inFlight): keeps full bound 24.
    const active = Array.from({ length: 20 }, () => ask(bulkhead, 'active-40-tables'));
    bulkhead.release(active[0].permit!, 'slow');
    expect(bulkhead.snapshot().events.find((e) => e.key === 'active-40-tables')!.limit).toBe(
      EVENT_DB_MAX_IN_FLIGHT
    );
    // An ok answer resets the slow streak so another isolated outlier later still does not halve.
    bulkhead.release(active[1].permit!, 'ok');
    bulkhead.release(active[2].permit!, 'slow');
    expect(bulkhead.snapshot().events.find((e) => e.key === 'active-40-tables')!.limit).toBe(
      EVENT_DB_MAX_IN_FLIGHT
    );

    // Two consecutive slow answers DO halve 24 -> 12.
    bulkhead.release(active[3].permit!, 'slow');
    expect(bulkhead.snapshot().events.find((e) => e.key === 'active-40-tables')!.limit).toBe(
      Math.floor(EVENT_DB_MAX_IN_FLIGHT / 2)
    );
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

  it('gives the very first freed global slot to a starved zero-in-flight tournament ahead of saturated MTTs (incident 1e532243)', async () => {
    const bulkhead = new EventDatabaseBulkhead({
      log: () => {},
      maxPerEvent: 24,
      minPerEvent: 6,
      maxAllEvents: 48,
    });
    // Two large MTTs saturate all 48 global slots and park deep queues first.
    const big1Active = Array.from({ length: 24 }, () => ask(bulkhead, 'mtt-1'));
    const big2Active = Array.from({ length: 24 }, () => ask(bulkhead, 'mtt-2'));
    const big1Parked = Array.from({ length: 5 }, () => ask(bulkhead, 'mtt-1'));
    const big2Parked = Array.from({ length: 5 }, () => ask(bulkhead, 'mtt-2'));
    // Two small tournaments arrive later with 0 in-flight slots.
    const smallA = ask(bulkhead, 'small-a');
    const smallB = ask(bulkhead, 'small-b');
    expect(smallA.permit).toBeNull();
    expect(smallB.permit).toBeNull();

    // Release ONE slot from mtt-1: small-a (inFlight=0) MUST take it immediately,
    // not mtt-1 (inFlight=23) or mtt-2 (inFlight=24) even though they parked earlier.
    bulkhead.release(big1Active[0].permit!, 'ok');
    await vi.advanceTimersByTimeAsync(0);
    expect(smallA.permit).not.toBeNull();
    expect(smallB.permit).toBeNull();
    expect(big1Parked.some((c) => c.permit !== null)).toBe(false);
    expect(big2Parked.some((c) => c.permit !== null)).toBe(false);

    // Release ONE slot from mtt-2: small-b (inFlight=0) takes it next.
    bulkhead.release(big2Active[0].permit!, 'ok');
    await vi.advanceTimersByTimeAsync(0);
    expect(smallB.permit).not.toBeNull();
    expect(big1Parked.some((c) => c.permit !== null)).toBe(false);
    expect(big2Parked.some((c) => c.permit !== null)).toBe(false);
    expect(bulkhead.snapshot().totalInFlight).toBe(48);
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

describe('Prometheus exposition', () => {
  it('emits zero-seeded bounded series on cold start and tracks load, timeouts, refusals and open state', async () => {
    const bulkhead = new EventDatabaseBulkhead({
      log: () => {},
      maxPerEvent: 2,
      minPerEvent: 1,
      maxAllEvents: 4,
      maxParked: 1,
    });
    const cold = bulkhead.toPrometheusLines().join('\n');
    expect(cold).toContain('poker_event_db_bulkhead_open 0');
    expect(cold).toContain('poker_event_db_bulkhead_in_flight 0');
    expect(cold).toContain('poker_event_db_bulkhead_parked_current 0');
    expect(cold).toContain('poker_event_db_bulkhead_cooling_current 0');
    expect(cold).toContain('poker_event_db_bulkhead_active_events 0');
    expect(cold).toContain('poker_event_db_bulkhead_throttled_events 0');
    expect(cold).toContain('poker_event_db_bulkhead_parked_total 0');
    expect(cold).toContain('poker_event_db_bulkhead_park_timeouts_total 0');
    expect(cold).toContain('poker_event_db_bulkhead_refused_full_total 0');

    // Fill 2 slots, park 1 with abort signal, refuse 1 on full queue, trigger congestion cooling.
    const a = ask(bulkhead, STUCK);
    const b = ask(bulkhead, STUCK);
    const ac = new AbortController();
    const parked = ask(bulkhead, STUCK, ac.signal);
    expect(() => bulkhead.acquire(STUCK)).toThrow('supabase_timeout');

    ac.abort(new Error('supabase_timeout'));
    await vi.advanceTimersByTimeAsync(0);
    expect(parked.error).toBeInstanceOf(Error);

    bulkhead.release(a.permit!, 'congested');
    const hot = bulkhead.toPrometheusLines().join('\n');
    expect(hot).toContain('poker_event_db_bulkhead_open 0');
    expect(hot).toContain('poker_event_db_bulkhead_in_flight 1');
    expect(hot).toContain('poker_event_db_bulkhead_cooling_current 1');
    expect(hot).toContain('poker_event_db_bulkhead_active_events 1');
    expect(hot).toContain('poker_event_db_bulkhead_throttled_events 1');
    expect(hot).toContain('poker_event_db_bulkhead_parked_total 1');
    expect(hot).toContain('poker_event_db_bulkhead_park_timeouts_total 1');
    expect(hot).toContain('poker_event_db_bulkhead_refused_full_total 1');
    // Zero unbounded per-event labels in Prometheus exposition.
    expect(hot).not.toContain(STUCK);

    bulkhead.openForShutdown();
    bulkhead.release(b.permit!, 'ok');
    const afterOpen = bulkhead.toPrometheusLines().join('\n');
    expect(afterOpen).toContain('poker_event_db_bulkhead_open 1');
    expect(afterOpen).toContain('poker_event_db_bulkhead_in_flight 0');
  });
});

describe('priority queueing for hand-path and seat-move RPCs (1e532243)', () => {
  it('classifies hand-lifecycle, settlement, and atomic seat-move RPCs as high priority and table scans as normal', () => {
    const base = 'https://example.supabase.co';
    for (const rpc of [
      'fn_f06_allocate_hand_number',
      'fn_f06_hand_number_state',
      'fn_f06_begin_hand',
      'fn_f06_retain_hand_continuation',
      'fn_f06_claim_hand_continuation',
      'fn_f06_finish_hand',
      'insert_hole_cards',
      'save_hand_state_snapshot',
      'complete_hand_snapshot',
      'fn_ca_commit_hand_settlement',
      'fn_ca_process_hand_post_commit_obligations',
      'fn_move_tournament_player',
    ]) {
      expect(classifyEventDbPriority(`${base}/rest/v1/rpc/${rpc}`), rpc).toBe('high');
      expect(classifyEventDbPriority(new URL(`${base}/rest/v1/rpc/${rpc}?select=*`)), rpc).toBe(
        'high'
      );
      expect(classifyEventDbPriority(new Request(`${base}/rest/v1/rpc/${rpc}`)), rpc).toBe('high');
    }

    for (const url of [
      `${base}/rest/v1/tables?tournament_id=eq.123`,
      `${base}/rest/v1/table_seats?left_at=is.null`,
      `${base}/rest/v1/tournament_players?status=eq.playing`,
      `${base}/rest/v1/rpc/fn_f06_discover_breaks`,
      `${base}/rest/v1/rpc/process_tournament_rebuy`,
      `${base}/rest/v1/rpc/fn_ensure_late_registration_capacity`,
    ]) {
      expect(classifyEventDbPriority(url), url).toBe('normal');
    }
  });

  it('admits high-priority hand/move calls ahead of queued normal background scans while preserving FIFO per tier', async () => {
    const bulkhead = new EventDatabaseBulkhead({ log: () => {}, maxPerEvent: 1, minPerEvent: 1 });
    const order: string[] = [];
    const holder = ask(bulkhead, STUCK);

    const enqueue = (label: string, priority: EventDbPriority) =>
      (bulkhead.acquire(STUCK, undefined, priority) as Promise<EventDbPermit>).then((permit) => {
        order.push(label);
        return permit;
      });

    const n1 = enqueue('normal-1', 'normal');
    const n2 = enqueue('normal-2', 'normal');
    const h1 = enqueue('high-1', 'high');
    const h2 = enqueue('high-2', 'high');

    bulkhead.release(holder.permit!, 'ok');
    bulkhead.release(await h1, 'ok');
    bulkhead.release(await h2, 'ok');
    bulkhead.release(await n1, 'ok');
    bulkhead.release(await n2, 'ok');

    expect(order).toEqual(['high-1', 'high-2', 'normal-1', 'normal-2']);
  });

  it('enforces bounded anti-starvation so normal sweeps always advance after EVENT_DB_HIGH_PRIORITY_BURST_LIMIT high calls', async () => {
    const bulkhead = new EventDatabaseBulkhead({ log: () => {}, maxPerEvent: 1, minPerEvent: 1 });
    const order: string[] = [];
    const holder = ask(bulkhead, STUCK);

    const waiters: Array<Promise<EventDbPermit>> = [];
    const enqueue = (label: string, priority: EventDbPriority) => {
      const p = (bulkhead.acquire(STUCK, undefined, priority) as Promise<EventDbPermit>).then(
        (permit) => {
          order.push(label);
          return permit;
        }
      );
      waiters.push(p);
      return p;
    };

    const n1 = enqueue('normal-1', 'normal');
    const n2 = enqueue('normal-2', 'normal');
    const highs = Array.from({ length: EVENT_DB_HIGH_PRIORITY_BURST_LIMIT + 2 }, (_, i) =>
      enqueue(`high-${i + 1}`, 'high')
    );

    // Release one permit at a time in the exact order waiters are admitted.
    let nextPermit: EventDbPermit = holder.permit!;
    const releaseNext = async (p: Promise<EventDbPermit>) => {
      bulkhead.release(nextPermit, 'ok');
      nextPermit = await p;
    };
    for (let i = 0; i < EVENT_DB_HIGH_PRIORITY_BURST_LIMIT; i++) await releaseNext(highs[i]);
    // After EVENT_DB_HIGH_PRIORITY_BURST_LIMIT consecutive high admissions, normal-1 MUST go next.
    await releaseNext(n1);
    await releaseNext(highs[EVENT_DB_HIGH_PRIORITY_BURST_LIMIT]);
    await releaseNext(highs[EVENT_DB_HIGH_PRIORITY_BURST_LIMIT + 1]);
    await releaseNext(n2);
    bulkhead.release(nextPermit, 'ok');

    expect(order).toEqual([
      'high-1',
      'high-2',
      'high-3',
      'high-4',
      'normal-1',
      'high-5',
      'high-6',
      'normal-2',
    ]);
  });

  it('aborts a parked high-priority call cleanly, counts combined queue capacity, and drains both queues on shutdown', async () => {
    const bulkhead = new EventDatabaseBulkhead({
      log: () => {},
      maxPerEvent: 1,
      minPerEvent: 1,
      maxParked: 2,
    });
    const holder = ask(bulkhead, STUCK);
    const ac = new AbortController();
    const parkedHigh = ask(bulkhead, STUCK, ac.signal, 'high');
    const parkedNormal = ask(bulkhead, STUCK, undefined, 'normal');

    // Combined high(1) + normal(1) hits maxParked(2).
    expect(() => bulkhead.acquire(STUCK, undefined, 'high')).toThrow('supabase_timeout');

    ac.abort(new Error('supabase_timeout'));
    await vi.advanceTimersByTimeAsync(0);
    expect(parkedHigh.error).toBeInstanceOf(Error);
    expect(bulkhead.snapshot().parkTimeoutsTotal).toBe(1);
    expect(bulkhead.snapshot().events[0].parked).toBe(1);

    const secondHigh = ask(bulkhead, STUCK, undefined, 'high');
    bulkhead.openForShutdown();
    await vi.advanceTimersByTimeAsync(0);
    expect(secondHigh.permit?.key).toBeNull();
    expect(parkedNormal.permit?.key).toBeNull();
    bulkhead.release(holder.permit!, 'ok');
  });
});
