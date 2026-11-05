/**
 * Lost database replies are counted where DatabaseRepliesLost and
 * DatabaseWriteRetriesExhausted (infra/monitoring/alert-rules.yml) can see
 * them. See dbReplyMetrics.ts for the 2026-11-05 incidents this answers.
 */
import { createServer } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './client.js';

const nativeFetch = globalThis.fetch;
const captured = vi.hoisted(() => {
  // handContinuation.js imports client.js below, so the deadline must be set
  // before any import runs.
  process.env.SUPABASE_TIMEOUT_MS = '100';
  return { fetches: [] as Array<typeof fetch> };
});
vi.mock('@supabase/supabase-js', () => ({
  createClient: (_url: string, _key: string, options: { global: { fetch: typeof fetch } }) => {
    captured.fetches.push(options.global.fetch);
    return { rpc: vi.fn() };
  },
}));
vi.mock('../errorReporter.js', () => ({ reportError: vi.fn() }));

import {
  classifyLostReply,
  dbReplyPrometheusLines,
  dbReplyTotals,
  recordDbRpcRetry,
  resetDbReplyTotalsForTests,
} from './dbReplyMetrics.js';
import { retainHandContinuation } from './handContinuation.js';

const RPC = 'fn_f06_retain_hand_continuation';

beforeEach(async () => {
  resetDbReplyTotalsForTests();
  vi.useFakeTimers();
  expect(captured.fetches.length).toBeGreaterThan(0);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const boundedFetch = () => captured.fetches[0];

describe('the exposition', () => {
  it('publishes every series at zero on a cold engine, so a rule has something to read', () => {
    const text = dbReplyPrometheusLines().join('\n');
    for (const kind of ['deadline', 'network', 'gateway'])
      expect(text).toContain(`poker_db_lost_replies_total{kind="${kind}"} 0`);
    for (const outcome of ['retry', 'recovered', 'exhausted'])
      expect(text).toContain(`poker_db_rpc_retries_total{rpc="${RPC}",outcome="${outcome}"} 0`);
    expect(text.match(/^# TYPE /gm)).toHaveLength(2);
  });

  it('never emits a label value outside the closed lists', () => {
    recordDbRpcRetry('fn_something_else' as typeof RPC, 'retry');
    expect(dbReplyPrometheusLines().join('\n')).not.toContain('fn_something_else');
  });
});

describe('classifying a thrown attempt', () => {
  it.each([
    [new Error('supabase_timeout'), 'deadline'],
    [
      Object.assign(new Error('The operation was aborted due to timeout'), {
        name: 'TimeoutError',
      }),
      'deadline',
    ],
    [new TypeError('fetch failed', { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } }), 'network'],
    [new TypeError('terminated'), 'network'],
    [Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }), 'network'],
  ] as const)('%s is a lost reply of kind %s', (error, kind) => {
    expect(classifyLostReply(error)).toBe(kind);
  });

  it.each([
    [Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })],
    [new Error('private_record_acl_request_boundary')],
    [new TypeError('Cannot read properties of undefined')],
    [null],
  ])('%s is not counted', (error) => {
    expect(classifyLostReply(error)).toBeNull();
  });
});

describe('the shared Supabase fetch wrapper counts every attempt with no answer', () => {
  it('counts our own deadline once and still rejects with it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {}))
    );
    const pending = boundedFetch()('https://example.test/rest/v1/rpc/x', { method: 'POST' }).catch(
      (e: Error) => e.message
    );
    await vi.advanceTimersByTimeAsync(101);
    expect(await pending).toBe('supabase_timeout');
    expect(dbReplyTotals().lost).toEqual({ deadline: 1, network: 0, gateway: 0 });
  });

  it('counts a caller AbortSignal.timeout (the 8 s hand-continuation abort) as a deadline', async () => {
    const reason = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    const caller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {}))
    );
    const pending = boundedFetch()('https://example.test/rest/v1/rpc/x', {
      method: 'POST',
      signal: caller.signal,
    }).catch((e: Error) => e);
    caller.abort(reason);
    expect(await pending).toBe(reason);
    expect(dbReplyTotals().lost.deadline).toBe(1);
  });

  it('counts a failed socket as network and does not count a deliberate cancellation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } }))
    );
    await expect(boundedFetch()('https://example.test/rest/v1/rpc/x')).rejects.toThrow(
      'fetch failed'
    );
    const caller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {}))
    );
    const cancelled = boundedFetch()('https://example.test/rest/v1/rpc/x', {
      signal: caller.signal,
    }).catch(() => 'cancelled');
    caller.abort();
    expect(await cancelled).toBe('cancelled');
    expect(dbReplyTotals().lost).toEqual({ deadline: 0, network: 1, gateway: 0 });
  });

  it('counts each gateway answer, including the PGRST002 attempts it retries itself', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('{"code":"PGRST002"}', { status: 503 }))
        .mockResolvedValueOnce(new Response('bad gateway', { status: 502 }))
    );
    const pending = boundedFetch()('https://example.test/rest/v1/rpc/x', { method: 'POST' });
    await vi.advanceTimersByTimeAsync(600);
    expect((await pending).status).toBe(502);
    expect(dbReplyTotals().lost).toEqual({ deadline: 0, network: 0, gateway: 2 });
  });

  it('counts nothing for a database answer, even a refusal', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('{"ok":true}'))
        .mockResolvedValueOnce(new Response('{"code":"P0001"}', { status: 400 }))
    );
    await boundedFetch()('https://example.test/rest/v1/rpc/x');
    await boundedFetch()('https://example.test/rest/v1/rpc/x');
    expect(dbReplyTotals().lost).toEqual({ deadline: 0, network: 0, gateway: 0 });
  });
});

describe('the hand-continuation write tells recovered from exhausted', () => {
  const ids = {
    tournament_id: 'aaaaaaaa-0000-4000-8000-000000000001',
    table_id: 'cccccccc-0000-4000-8000-000000000001',
    lease_generation: 'bbbbbbbb-0000-4000-8000-000000000001',
    permit_id: 'dddddddd-0000-4000-8000-000000000001',
    custody_id: 'eeeeeeee-0000-4000-8000-000000000001',
    hand_number: '42',
    lifecycle: '1',
  };
  const writer = 'bbbbbbbb-0000-4000-8000-000000000002';
  const batch = { version: 1 as const, sequence: 1, controller: 'C', events: [], engine: {} };
  const noWait = async () => {};
  const lost = { data: null, error: { code: '', message: 'fetch failed' } };
  const receipt = (args: Record<string, unknown>) => ({
    data: {
      ok: true,
      table_id: ids.table_id,
      hand_number: ids.hand_number,
      sequence: '1',
      sha256: args.p_sha256,
      writer_generation: writer,
    },
    error: null,
  });
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it('a write that gets its receipt after two lost replies is retry x2, recovered x1', async () => {
    let n = 0;
    const transport = vi.fn(async (_: string, args: Record<string, unknown>) =>
      ++n < 3 ? lost : receipt(args)
    );
    await retainHandContinuation(ids, writer, [], batch, () => true, transport, noWait);
    expect(dbReplyTotals().retries[RPC]).toEqual({ retry: 2, recovered: 1, exhausted: 0 });
  });

  it('a write that loses all four replies is retry x3, exhausted x1', async () => {
    const transport = vi.fn(async () => lost);
    await expect(
      retainHandContinuation(ids, writer, [], batch, () => true, transport, noWait)
    ).rejects.toThrow('[transport_error sqlstate=unknown]');
    expect(transport).toHaveBeenCalledTimes(4);
    expect(dbReplyTotals().retries[RPC]).toEqual({ retry: 3, recovered: 0, exhausted: 1 });
  });

  it('a first-attempt success and a deterministic refusal count nothing', async () => {
    await retainHandContinuation(
      ids,
      writer,
      [],
      batch,
      () => true,
      async (_, a) => receipt(a),
      noWait
    );
    await expect(
      retainHandContinuation(
        ids,
        writer,
        [],
        batch,
        () => true,
        async () => ({ data: null, error: { code: '42501' } }),
        noWait
      )
    ).rejects.toThrow('sqlstate=42501');
    expect(dbReplyTotals().retries[RPC]).toEqual({ retry: 0, recovered: 0, exhausted: 0 });
  });
});

describe('a real supabase-js .rpc() through the engine wrapper is counted end to end', () => {
  it('a gateway answer, a dropped socket and a stalled reply each count once, and a database refusal counts nothing', async () => {
    vi.useRealTimers();
    vi.stubGlobal('fetch', nativeFetch);
    const server = createServer((request, response) => {
      const name = (request.url ?? '').split('/').pop();
      if (name === 'gateway') {
        response.writeHead(504, { 'content-type': 'text/plain' });
        response.end('gateway timeout');
      } else if (name === 'reset') {
        request.socket.destroy();
      } else if (name === 'stall') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.write('['); // never finishes: the 100 ms client deadline fires
      } else {
        response.writeHead(400, { 'content-type': 'application/json' });
        response.end('{"code":"P0001","message":"refused"}');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address() as { port: number };
      const actual =
        await vi.importActual<typeof import('@supabase/supabase-js')>('@supabase/supabase-js');
      const client = actual.createClient(`http://127.0.0.1:${port}`, 'test-key', {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { fetch: boundedFetch() },
      });
      for (const name of ['gateway', 'reset', 'stall', 'refused']) {
        const { error } = await client.rpc(name, {});
        expect(error).not.toBeNull();
      }
      expect(dbReplyTotals().lost).toEqual({ deadline: 1, network: 1, gateway: 1 });
      expect(dbReplyPrometheusLines()).toContain('poker_db_lost_replies_total{kind="gateway"} 1');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
