import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
vi.mock('./supabase/client.js', () => ({ supabase: { rpc: vi.fn() } }));
import {
  createLightningLaneSession,
  isLightningLaneFunction,
  LIGHTNING_LANE_ACQUIRE_MS,
  LIGHTNING_LANE_POOL_MAX,
  LIGHTNING_LANE_SQL,
  LIGHTNING_LANE_STATEMENT_TIMEOUT_MS,
  verifiedLaneConnectionString,
  type LightningLaneClient,
} from './lightningLaneSession.js';
import { lightningLaneFirstRpc } from '../lightning/LightningSupervisor.js';

const url =
  'postgresql://engine_lightning_lane.project:private-secret@db.example.test:5432/postgres?sslmode=require';
const settleArgs = {
  p_hand_id: '027ab7d1-b13c-4a9d-a7c3-4616f3d39e29',
  p_request_id: 'b13cc1cf-8efc-4147-a262-cb2c640bf701',
};

type Work = (
  text: string,
  values?: unknown[]
) => Promise<{
  rows: Array<Record<string, unknown>>;
  command?: string | null;
}>;

function sqlError(message: string, code: string) {
  return Object.assign(new Error(message), { code });
}

function fixture(work?: Work, opts: { verifyOk?: boolean; readUrl?: unknown } = {}) {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const clients: Array<LightningLaneClient & { release: ReturnType<typeof vi.fn> }> = [];
  let current: Work | undefined = work;
  const connect = vi.fn(async () => {
    const client = {
      query: vi.fn(async (text: string, values?: unknown[]) => {
        queries.push({ text, values });
        if (text.startsWith('SELECT current_user'))
          return { rows: [{ ok: opts.verifyOk ?? true }] };
        if (current) return current(text, values);
        if (text === 'COMMIT') return { rows: [], command: 'COMMIT' };
        if (text.startsWith('BEGIN')) return { rows: [], command: 'SET' };
        return { rows: [{ result: { ok: true, hand_history_id: settleArgs.p_hand_id } }] };
      }),
      release: vi.fn(),
    };
    clients.push(client);
    return client;
  });
  const pool = { connect, end: vi.fn(async () => {}), on: vi.fn() };
  const logs: string[] = [];
  const session = createLightningLaneSession({
    readUrl: vi.fn(async () => (opts.readUrl === undefined ? url : opts.readUrl)),
    openPool: vi.fn(() => pool),
    actorHeaders: () => ({ 'x-smarter-data-actor': 'service', 'x-smarter-data-protocol': '1' }),
    log: (line) => logs.push(line),
    timeoutMs: 1_000,
  });
  return {
    session,
    queries,
    clients,
    connect,
    pool,
    logs,
    setWork: (w: Work | undefined) => {
      current = w;
    },
  };
}

describe("Lightning's own database lane", () => {
  it('carries exactly the four per-hand functions', () => {
    for (const fn of [
      'fn_lightning_match_and_form',
      'fn_lightning_instance_begin_dealing',
      'fn_lightning_bind_hand_number',
      'fn_lightning_settle_hand',
    ])
      expect(isLightningLaneFunction(fn)).toBe(true);
    for (const fn of ['fn_lightning_fast_fold', 'fn_lightning_match', 'insert_hole_cards'])
      expect(isLightningLaneFunction(fn)).toBe(false);
  });

  it('accepts only the engine_lightning_lane login and drops query options', () => {
    expect(verifiedLaneConnectionString(url)).toBe(
      'postgresql://engine_lightning_lane.project:private-secret@db.example.test:5432/postgres'
    );
    expect(
      verifiedLaneConnectionString(url.replace('engine_lightning_lane', 'postgres'))
    ).toBeNull();
    expect(verifiedLaneConnectionString(url.replace(':5432', ':6543'))).toBeNull();
    expect(verifiedLaneConnectionString(null)).toBeNull();
  });

  it('before it is ready every call falls back (null), so behaviour is unchanged', async () => {
    const f = fixture();
    expect(await f.session.call('fn_lightning_settle_hand', settleArgs)).toBeNull();
    expect(f.connect).not.toHaveBeenCalled();
  });

  it('stays off when the credential is absent or the login is not verified', async () => {
    const absent = fixture(undefined, { readUrl: null });
    expect(await absent.session.start()).toBe(false);
    expect(await absent.session.call('fn_lightning_settle_hand', settleArgs)).toBeNull();
    const wrongRole = fixture(undefined, { verifyOk: false });
    expect(await wrongRole.session.start()).toBe(false);
    expect(await wrongRole.session.call('fn_lightning_settle_hand', settleArgs)).toBeNull();
  });

  it('commits one pipelined transaction and returns the function answer', async () => {
    const f = fixture();
    expect(await f.session.start()).toBe(true);
    expect(f.connect).toHaveBeenCalledTimes(LIGHTNING_LANE_POOL_MAX);
    const out = await f.session.call('fn_lightning_settle_hand', settleArgs);
    expect(out).toEqual({
      data: { ok: true, hand_history_id: settleArgs.p_hand_id },
      error: null,
    });
    const sent = f.queries.filter((q) => !q.text.startsWith('SELECT current_user'));
    expect(sent.map((q) => q.text.split(';')[0])).toEqual(['BEGIN', LIGHTNING_LANE_SQL, 'COMMIT']);
    const statement = sent[1];
    expect(statement.values?.[0]).toBe('settle_hand');
    expect(JSON.parse(String(statement.values?.[1]))).toEqual(settleArgs);
    expect(JSON.parse(String(statement.values?.[2]))).toEqual({
      'x-smarter-data-actor': 'service',
      'x-smarter-data-protocol': '1',
    });
    expect(f.session.toPrometheus()).toContain('poker_lightning_lane_committed_total 1');
  });

  it('sends the entry big blind header only when the matcher asks for it', async () => {
    const f = fixture();
    await f.session.start();
    await f.session.call(
      'fn_lightning_match_and_form',
      { p_cluster_id: 'c' },
      { entryBigBlind: true }
    );
    const statement = f.queries.find((q) => q.text === LIGHTNING_LANE_SQL);
    expect(statement?.values?.[0]).toBe('match_and_form');
    expect(JSON.parse(String(statement?.values?.[2]))['x-smarter-lightning-entry-bb']).toBe('1');
  });

  it('a database refusal that rolled back is reported as sent-and-rolled-back, never re-sent', async () => {
    const f = fixture(async (text) => {
      if (text === LIGHTNING_LANE_SQL)
        throw sqlError('canceling statement due to lock timeout', '55P03');
      if (text === 'COMMIT') return { rows: [], command: 'ROLLBACK' };
      return { rows: [], command: 'SET' };
    });
    await f.session.start();
    const out = await f.session.call('fn_lightning_settle_hand', settleArgs);
    expect(out).toEqual({
      data: null,
      error: {
        message: 'lightning_lane_rolled_back',
        code: 'LIGHTNING_LANE_ROLLED_BACK',
        sqlState: '55P03',
      },
    });
    expect(f.session.toPrometheus()).toContain('poker_lightning_lane_rolled_back_total 1');
    // An ordinary refusal does not turn the lane off.
    f.setWork(undefined);
    expect((await f.session.call('fn_lightning_settle_hand', settleArgs))?.error).toBeNull();
  });

  it('a refusal raised by the wrapper is reported, never re-sent, and turns the lane off for good', async () => {
    const f = fixture(async (text) => {
      if (text === LIGHTNING_LANE_SQL) throw sqlError('LIGHTNING_LANE_SESSION_FORBIDDEN', '42501');
      if (text === 'COMMIT') return { rows: [], command: 'ROLLBACK' };
      return { rows: [], command: 'SET' };
    });
    await f.session.start();
    const first = await f.session.call('fn_lightning_settle_hand', settleArgs);
    expect(first?.error?.code).toBe('LIGHTNING_LANE_ROLLED_BACK');
    const before = f.queries.length;
    f.setWork(undefined);
    // Later calls are refused BEFORE sending, so only they may use PostgREST.
    expect(await f.session.call('fn_lightning_settle_hand', settleArgs)).toBeNull();
    expect(f.queries.length).toBe(before);
    expect(f.session.toPrometheus()).toContain('poker_lightning_lane_disabled 1');
    expect(f.pool.end).toHaveBeenCalled();
  });

  it('a lost socket after dispatch is reported as an unknown outcome, never a fallback', async () => {
    const f = fixture(async (text) => {
      if (text === LIGHTNING_LANE_SQL) throw new Error('Connection terminated unexpectedly');
      if (text === 'COMMIT') throw new Error('Connection terminated unexpectedly');
      return { rows: [], command: 'SET' };
    });
    await f.session.start();
    const out = await f.session.call('fn_lightning_settle_hand', settleArgs);
    expect(out).toEqual({
      data: null,
      error: { message: 'lightning_lane_outcome_unknown', code: 'LIGHTNING_LANE_UNKNOWN' },
    });
    expect(f.clients.some((c) => c.release.mock.calls.some((a) => a[0] === true))).toBe(true);
  });

  it('a COMMIT that does not answer COMMIT is an unknown outcome', async () => {
    const f = fixture(async (text) => {
      if (text === 'COMMIT') return { rows: [], command: 'ROLLBACK' };
      if (text === LIGHTNING_LANE_SQL) return { rows: [{ result: { ok: true } }] };
      return { rows: [], command: 'SET' };
    });
    await f.session.start();
    const out = await f.session.call('fn_lightning_settle_hand', settleArgs);
    expect(out?.error?.code).toBe('LIGHTNING_LANE_UNKNOWN');
  });

  it('a function outside the lane is never dispatched on it', async () => {
    const f = fixture();
    await f.session.start();
    const before = f.queries.length;
    expect(await f.session.call('fn_lightning_fast_fold', {})).toBeNull();
    expect(f.queries.length).toBe(before);
  });
});

describe('the matcher selects the lane first and PostgREST otherwise', () => {
  it('uses the lane answer when the lane carried the call', async () => {
    const lane = vi.fn(async () => ({ data: { formed: 1 }, error: null }));
    const fallback = vi.fn(async () => ({ data: 'postgrest', error: null }));
    const rpc = lightningLaneFirstRpc(lane as never, fallback);
    expect(await rpc('fn_lightning_match_and_form', { p_cluster_id: 'c' })).toEqual({
      data: { formed: 1 },
      error: null,
    });
    expect(lane).toHaveBeenCalledWith(
      'fn_lightning_match_and_form',
      { p_cluster_id: 'c' },
      {
        entryBigBlind: true,
      }
    );
    expect(fallback).not.toHaveBeenCalled();
  });

  it('never tries PostgREST once the lane sent the call, whatever it answered', async () => {
    for (const answer of [
      {
        data: null,
        error: { message: 'lightning_lane_outcome_unknown', code: 'LIGHTNING_LANE_UNKNOWN' },
      },
      {
        data: null,
        error: {
          message: 'lightning_lane_rolled_back',
          code: 'LIGHTNING_LANE_ROLLED_BACK',
          sqlState: '55P03',
        },
      },
    ]) {
      const lane = vi.fn(async () => answer);
      const fallback = vi.fn(async () => ({ data: 'postgrest', error: null }));
      const rpc = lightningLaneFirstRpc(lane as never, fallback);
      expect(await rpc('fn_lightning_match_and_form', {})).toEqual(answer);
      expect(fallback).not.toHaveBeenCalled();
    }
  });

  it('falls back to PostgREST when the lane carried nothing', async () => {
    const lane = vi.fn(async () => null);
    const fallback = vi.fn(async () => ({ data: 'postgrest', error: null }));
    const rpc = lightningLaneFirstRpc(lane as never, fallback);
    expect(await rpc('fn_lightning_match_and_form', {})).toEqual({
      data: 'postgrest',
      error: null,
    });
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('never routes other matcher functions through the lane', async () => {
    const lane = vi.fn(async () => ({ data: 'lane', error: null }));
    const fallback = vi.fn(async () => ({ data: 'postgrest', error: null }));
    const rpc = lightningLaneFirstRpc(lane as never, fallback);
    expect(await rpc('fn_lightning_match', {})).toEqual({ data: 'postgrest', error: null });
    expect(await rpc('fn_lightning_config', {})).toEqual({ data: 'postgrest', error: null });
    expect(lane).not.toHaveBeenCalled();
  });
});

describe('every failure point of a lane call', () => {
  const unknown = {
    data: null,
    error: { message: 'lightning_lane_outcome_unknown', code: 'LIGHTNING_LANE_UNKNOWN' },
  };

  it('BEGIN sets a statement budget no longer than the shared path (8 s)', async () => {
    const f = fixture();
    await f.session.start();
    await f.session.call('fn_lightning_settle_hand', settleArgs);
    const begin = f.queries.find((q) => q.text.startsWith('BEGIN'));
    expect(begin?.text).toContain("SET LOCAL statement_timeout = '1000ms'");
    expect(LIGHTNING_LANE_STATEMENT_TIMEOUT_MS).toBe(8_000);
    const long = createLightningLaneSession({
      readUrl: async () => url,
      openPool: () => f.pool,
      actorHeaders: () => ({}),
      log: () => {},
      timeoutMs: 15_000,
    });
    await long.start();
    await long.call('fn_lightning_settle_hand', settleArgs);
    const begins = f.queries.filter((q) => q.text.startsWith('BEGIN'));
    expect(begins.at(-1)?.text).toContain("SET LOCAL statement_timeout = '8000ms'");
    expect(begins.at(-1)?.text).not.toContain('15000ms');
  });

  it('before send: a failed socket acquisition is NOT SENT (fallback allowed)', async () => {
    const f = fixture();
    await f.session.start();
    f.connect.mockImplementationOnce(async () => {
      throw new Error('too many connections for role "engine_lightning_lane"');
    });
    const before = f.queries.length;
    expect(await f.session.call('fn_lightning_settle_hand', settleArgs)).toBeNull();
    expect(f.queries.length).toBe(before);
  });

  it('before send: an acquisition slower than 100 ms is NOT SENT, and the late socket is released unused', async () => {
    vi.useFakeTimers();
    try {
      const f = fixture();
      await f.session.start();
      let late!: (c: LightningLaneClient) => void;
      const lateClient = { query: vi.fn(), release: vi.fn() };
      f.connect.mockImplementationOnce(
        () => new Promise<LightningLaneClient>((resolve) => (late = resolve)) as never
      );
      const pending = f.session.call('fn_lightning_settle_hand', settleArgs);
      await vi.advanceTimersByTimeAsync(LIGHTNING_LANE_ACQUIRE_MS + 1);
      expect(await pending).toBeNull();
      late(lateClient);
      await vi.advanceTimersByTimeAsync(0);
      expect(lateClient.query).not.toHaveBeenCalled();
      expect(lateClient.release).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('pool saturated: the seventh concurrent call is NOT SENT (no queueing)', async () => {
    const gate: Array<() => void> = [];
    const f = fixture(async (text) => {
      if (text === LIGHTNING_LANE_SQL) {
        await new Promise<void>((r) => gate.push(r));
        return { rows: [{ result: { ok: true } }] };
      }
      if (text === 'COMMIT') return { rows: [], command: 'COMMIT' };
      return { rows: [], command: 'SET' };
    });
    await f.session.start();
    const inFlight = Array.from({ length: LIGHTNING_LANE_POOL_MAX }, () =>
      f.session.call('fn_lightning_settle_hand', settleArgs)
    );
    await new Promise((r) => setTimeout(r, 5));
    const sent = f.queries.filter((q) => q.text === LIGHTNING_LANE_SQL).length;
    expect(await f.session.call('fn_lightning_settle_hand', settleArgs)).toBeNull();
    expect(f.queries.filter((q) => q.text === LIGHTNING_LANE_SQL).length).toBe(sent);
    gate.forEach((r) => r());
    for (const out of await Promise.all(inFlight)) expect(out?.error).toBeNull();
  });

  it('BEGIN written, then the socket is lost: UNKNOWN, never NOT SENT', async () => {
    const f = fixture(async () => {
      throw new Error('Connection terminated unexpectedly');
    });
    await f.session.start();
    expect(await f.session.call('fn_lightning_settle_hand', settleArgs)).toEqual(unknown);
  });

  it('after send, before the answer: UNKNOWN', async () => {
    const f = fixture(async (text) => {
      if (text.startsWith('BEGIN')) return { rows: [], command: 'SET' };
      throw new Error('read ECONNRESET');
    });
    await f.session.start();
    expect(await f.session.call('fn_lightning_match_and_form', { p_cluster_id: 'c' })).toEqual(
      unknown
    );
  });

  it('answer received, COMMIT sent, acknowledgement lost: UNKNOWN', async () => {
    const f = fixture(async (text) => {
      if (text === 'COMMIT') throw new Error('Connection terminated unexpectedly');
      if (text === LIGHTNING_LANE_SQL) return { rows: [{ result: { ok: true } }] };
      return { rows: [], command: 'SET' };
    });
    await f.session.start();
    expect(await f.session.call('fn_lightning_settle_hand', settleArgs)).toEqual(unknown);
  });

  it('a database error whose ROLLBACK is not confirmed is UNKNOWN, not rolled back', async () => {
    const f = fixture(async (text) => {
      if (text === LIGHTNING_LANE_SQL) throw sqlError('deadlock detected', '40P01');
      if (text === 'COMMIT') throw new Error('Connection terminated unexpectedly');
      return { rows: [], command: 'SET' };
    });
    await f.session.start();
    expect(await f.session.call('fn_lightning_settle_hand', settleArgs)).toEqual(unknown);
  });

  it('the request boundary passing mid-call: UNKNOWN, and the socket is destroyed', async () => {
    vi.useFakeTimers();
    try {
      const f = fixture(async (text) => {
        if (text === LIGHTNING_LANE_SQL) return new Promise(() => undefined);
        return { rows: [], command: 'SET' };
      });
      await f.session.start();
      const pending = f.session.call('fn_lightning_settle_hand', settleArgs);
      await vi.advanceTimersByTimeAsync(1_001);
      expect(await pending).toEqual(unknown);
      expect(f.clients.some((c) => c.release.mock.calls.some((a) => a[0] === true))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

/* A SOCKET IN USE CAN BE LOST TOO (2026-11-11). pg-pool removes its idle
   'error' listener while a socket is checked out, and pg emits a lost
   backend on the client itself; an EventEmitter 'error' with no listener
   throws, which is what drained and restarted production at 09:55:38Z.
   A real EventEmitter stands in for the pg client so the throw is real. */
describe('The Lightning lane survives losing a socket that is in use', () => {
  it('gives every socket the pool connects its own error listener', async () => {
    const f = fixture();
    expect(await f.session.start()).toBe(true);
    const onConnect = f.pool.on.mock.calls.find(([event]) => event === 'connect')?.[1] as
      | ((socket: EventEmitter) => void)
      | undefined;
    expect(onConnect).toBeTypeOf('function');
    const socket = new EventEmitter();
    onConnect!(socket);
    expect(socket.listenerCount('error')).toBe(1);
    expect(() =>
      socket.emit('error', new Error('Connection terminated unexpectedly'))
    ).not.toThrow();
    expect(f.logs.join('\n')).toContain('a socket in use was lost');
    await f.session.stop();
  });

  it('registers the listener before the first socket is connected', async () => {
    const f = fixture();
    const order: string[] = [];
    f.pool.on.mockImplementation((event: string) => {
      order.push(`on:${event}`);
      return f.pool;
    });
    const connect = f.pool.connect.getMockImplementation()!;
    f.pool.connect.mockImplementation(async () => {
      order.push('connect');
      return connect();
    });
    expect(await f.session.start()).toBe(true);
    expect(order.indexOf('on:connect')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('on:connect')).toBeLessThan(order.indexOf('connect'));
    await f.session.stop();
  });
});
