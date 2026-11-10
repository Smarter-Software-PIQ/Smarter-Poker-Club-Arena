import { describe, expect, it, vi } from 'vitest';
vi.mock('./supabase/client.js', () => ({ supabase: { rpc: vi.fn() } }));
import {
  createLightningLaneSession,
  isLightningLaneFunction,
  LIGHTNING_LANE_POOL_MAX,
  LIGHTNING_LANE_SQL,
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

type Work = (text: string, values?: unknown[]) => Promise<{
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
        if (text.startsWith('SELECT current_user')) return { rows: [{ ok: opts.verifyOk ?? true }] };
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
    expect(verifiedLaneConnectionString(url.replace('engine_lightning_lane', 'postgres'))).toBeNull();
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
    await f.session.call('fn_lightning_match_and_form', { p_cluster_id: 'c' }, { entryBigBlind: true });
    const statement = f.queries.find((q) => q.text === LIGHTNING_LANE_SQL);
    expect(statement?.values?.[0]).toBe('match_and_form');
    expect(JSON.parse(String(statement?.values?.[2]))['x-smarter-lightning-entry-bb']).toBe('1');
  });

  it('a database refusal that rolled back falls back to PostgREST (nothing happened)', async () => {
    const f = fixture(async (text) => {
      if (text === LIGHTNING_LANE_SQL) throw sqlError('settle refused', 'P0001');
      if (text === 'COMMIT') return { rows: [], command: 'ROLLBACK' };
      return { rows: [], command: 'SET' };
    });
    await f.session.start();
    expect(await f.session.call('fn_lightning_settle_hand', settleArgs)).toBeNull();
    expect(f.session.toPrometheus()).toContain('poker_lightning_lane_rolled_back_total 1');
    // An ordinary refusal does not turn the lane off.
    f.setWork(undefined);
    expect(await f.session.call('fn_lightning_settle_hand', settleArgs)).not.toBeNull();
  });

  it('a refusal raised by the wrapper or the catalog turns the lane off for good', async () => {
    const f = fixture(async (text) => {
      if (text === LIGHTNING_LANE_SQL) throw sqlError('LIGHTNING_LANE_SESSION_FORBIDDEN', '42501');
      if (text === 'COMMIT') return { rows: [], command: 'ROLLBACK' };
      return { rows: [], command: 'SET' };
    });
    await f.session.start();
    expect(await f.session.call('fn_lightning_settle_hand', settleArgs)).toBeNull();
    const before = f.queries.length;
    f.setWork(undefined);
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
    expect(lane).toHaveBeenCalledWith('fn_lightning_match_and_form', { p_cluster_id: 'c' }, {
      entryBigBlind: true,
    });
    expect(fallback).not.toHaveBeenCalled();
  });

  it('falls back to PostgREST when the lane carried nothing', async () => {
    const lane = vi.fn(async () => null);
    const fallback = vi.fn(async () => ({ data: 'postgrest', error: null }));
    const rpc = lightningLaneFirstRpc(lane as never, fallback);
    expect(await rpc('fn_lightning_match_and_form', {})).toEqual({ data: 'postgrest', error: null });
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
