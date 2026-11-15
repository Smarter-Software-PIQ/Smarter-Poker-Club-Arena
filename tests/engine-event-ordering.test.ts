/**
 * SHOWDOWN POLISH 2026-08-25 — EVENT/SNAPSHOT ordering is deterministic.
 *
 * The engine deliberately emits the `showdown` event BEFORE the revealing
 * snapshot so the client latches the reveal-order stagger before any card
 * turns face up. But event dispatch is deferred one macrotask (the Task-56
 * one-render-per-event fix), while state frames used to apply synchronously —
 * so whenever both frames landed in one tick the snapshot overtook the event
 * and the sequenced reveal silently degraded to a simultaneous flip.
 *
 * The fix (review revision 2026-08-25): ONE unified inbound FIFO. Every frame
 * that arrives while anything is queued joins the queue; a state frame with an
 * empty queue keeps the zero-latency synchronous fast path. The drain applies
 * contiguous state frames synchronously and dispatches at most one EVENT per
 * macrotask (the Task-56 one-render-per-event guarantee), and the hub's
 * per-table event `seq` is consumed for same-connection de-duplication. These
 * tests pin all of it: arrival order = observation order in BOTH directions,
 * one dispatch per event, dedupe, and a reconnect clearing the queue.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  url: string;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onclose: ((e: { code?: number; reason?: string }) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.onclose?.({});
  }
  _open() {
    this.readyState = 1;
    this.onopen?.();
  }
  _frame(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
}

const TABLE = 'bbbbbbbb-2222-4222-8222-333333333333';
const flush = () => new Promise((r) => setTimeout(r, 0));

let EngineStateClient: typeof import('../src/services/EngineStateClient').EngineStateClient;

beforeEach(async () => {
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
  // Force the direct-socket path so _frame drives handleMessage without the
  // mux facade in between (the ordering logic is identical on both).
  window.localStorage.setItem('ca_ws_mux', '0');
  vi.resetModules();
  const mod = await import('../src/services/EngineStateClient');
  EngineStateClient = mod.EngineStateClient;
});

afterEach(() => {
  window.localStorage.removeItem('ca_ws_mux');
  vi.unstubAllGlobals();
});

const live = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1];

async function connectedClient() {
  const observed: string[] = [];
  const c = new EngineStateClient({
    baseUrl: 'https://engine.example',
    tableId: TABLE,
    getToken: async () => 'tok',
    onSnapshot: (s: Record<string, unknown>) => {
      observed.push(`snapshot:${(s as { hand_number?: number }).hand_number ?? '?'}`);
    },
    onEvent: (p: Record<string, unknown>) => {
      observed.push(`event:${String(p.type)}`);
    },
    onStatus: () => undefined,
    onError: () => undefined,
  } as never);
  c.connect();
  await flush();
  live()._open();
  await flush();
  return { c, observed };
}

describe('EngineStateClient — server emit order is client observation order', () => {
  it('an event emitted before a snapshot is observed before it, same-tick arrival included', async () => {
    const { c, observed } = await connectedClient();
    // Same JS tick: the exact race the showdown reveal lost.
    live()._frame({ type: 'EVENT', tableId: TABLE, seq: 1, payload: { type: 'showdown' } });
    live()._frame({ type: 'SNAPSHOT', tableId: TABLE, seq: 10, state: { hand_number: 7 } });
    await flush();
    await flush();
    expect(observed).toEqual(['event:showdown', 'snapshot:7']);
    c.disconnect();
  });

  it('multiple pending events all precede the snapshot, in order, one dispatch each', async () => {
    const { c, observed } = await connectedClient();
    live()._frame({ type: 'EVENT', tableId: TABLE, seq: 1, payload: { type: 'pot_win' } });
    live()._frame({ type: 'EVENT', tableId: TABLE, seq: 2, payload: { type: 'hand_complete' } });
    live()._frame({ type: 'SNAPSHOT', tableId: TABLE, seq: 11, state: { hand_number: 8 } });
    await flush();
    await flush();
    await flush();
    expect(observed).toEqual(['event:pot_win', 'event:hand_complete', 'snapshot:8']);
    c.disconnect();
  });

  it('a snapshot with nothing pending still applies immediately', async () => {
    const { c, observed } = await connectedClient();
    live()._frame({ type: 'SNAPSHOT', tableId: TABLE, seq: 12, state: { hand_number: 9 } });
    // No flush needed — synchronous apply is the fast path.
    expect(observed).toEqual(['snapshot:9']);
    c.disconnect();
  });

  it('a snapshot arriving BEFORE an event is observed before it (fast path does not reorder)', async () => {
    const { c, observed } = await connectedClient();
    live()._frame({ type: 'SNAPSHOT', tableId: TABLE, seq: 13, state: { hand_number: 10 } });
    live()._frame({ type: 'EVENT', tableId: TABLE, seq: 1, payload: { type: 'showdown' } });
    await flush();
    await flush();
    expect(observed).toEqual(['snapshot:10', 'event:showdown']);
    c.disconnect();
  });

  it('interleaved E1/S1/E2 arrival order is preserved exactly', async () => {
    const { c, observed } = await connectedClient();
    live()._frame({ type: 'EVENT', tableId: TABLE, seq: 1, payload: { type: 'showdown' } });
    live()._frame({ type: 'SNAPSHOT', tableId: TABLE, seq: 14, state: { hand_number: 11 } });
    live()._frame({ type: 'EVENT', tableId: TABLE, seq: 2, payload: { type: 'pot_win' } });
    await flush();
    await flush();
    await flush();
    expect(observed).toEqual(['event:showdown', 'snapshot:11', 'event:pot_win']);
    c.disconnect();
  });

  it('a duplicated event seq is dispatched once (hub seq de-duplication)', async () => {
    const { c, observed } = await connectedClient();
    live()._frame({ type: 'EVENT', tableId: TABLE, seq: 5, payload: { type: 'showdown' } });
    live()._frame({ type: 'EVENT', tableId: TABLE, seq: 5, payload: { type: 'showdown' } });
    live()._frame({ type: 'EVENT', tableId: TABLE, seq: 6, payload: { type: 'pot_win' } });
    await flush();
    await flush();
    await flush();
    expect(observed).toEqual(['event:showdown', 'event:pot_win']);
    c.disconnect();
  });

  it('legacy events without seq are never de-duplicated', async () => {
    const { c, observed } = await connectedClient();
    live()._frame({ type: 'EVENT', tableId: TABLE, payload: { type: 'player_action' } });
    live()._frame({ type: 'EVENT', tableId: TABLE, payload: { type: 'player_action' } });
    await flush();
    await flush();
    expect(observed).toEqual(['event:player_action', 'event:player_action']);
    c.disconnect();
  });

  it('disconnect clears the queue — a queued event never fires after teardown', async () => {
    const { c, observed } = await connectedClient();
    live()._frame({ type: 'EVENT', tableId: TABLE, seq: 1, payload: { type: 'showdown' } });
    live()._frame({ type: 'EVENT', tableId: TABLE, seq: 2, payload: { type: 'pot_win' } });
    await flush(); // first event dispatches…
    c.disconnect(); // …then the client tears down with one still queued
    await flush();
    await flush();
    expect(observed).toEqual(['event:showdown']);
  });
});

/**
 * THE QUEUE NEVER SHOWS THE PAST (2026-11-14).
 *
 * Whytegold502's tablet rendered an event slower than the engine emitted
 * them. The FIFO above had an order and no clock, so it grew until his table
 * was 20 to 30 seconds behind: 24 of 25 turns were folded or checked for
 * him at the 17 second clock while he pressed Fold on a hand that was already
 * over. These pin the two bounds, both measured from when a frame arrived.
 */
describe('EngineStateClient - the queue never shows the past', () => {
  let now = 1_000_000;
  beforeEach(() => {
    now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });
  const event = (seq: number, payload: Record<string, unknown>) =>
    live()._frame({ type: 'EVENT', tableId: TABLE, seq, payload });

  it('a device that keeps up still gets one event per macrotask', async () => {
    const { c, observed } = await connectedClient();
    event(1, { type: 'player_action' });
    event(2, { type: 'pot_update' });
    await flush();
    expect(observed).toEqual(['event:player_action']);
    await flush();
    expect(observed).toEqual(['event:player_action', 'event:pot_update']);
    c.disconnect();
  });

  it('behind by more than the catch-up bound, events follow at once, each on its own, in order', async () => {
    const { c, observed } = await connectedClient();
    event(1, { type: 'player_action' });
    event(2, { type: 'pot_update' });
    live()._frame({ type: 'SNAPSHOT', tableId: TABLE, seq: 20, state: { hand_number: 3 } });
    event(3, { type: 'turn_change' });
    now += 900;
    await flush();
    expect(observed).toEqual([
      'event:player_action',
      'event:pot_update',
      'snapshot:3',
      'event:turn_change',
    ]);
    c.disconnect();
  });

  it('a catch-up burst is bounded so input is let in', async () => {
    const { c, observed } = await connectedClient();
    for (let seq = 1; seq <= 12; seq++) event(seq, { type: 'player_action' });
    now += 900;
    await flush();
    expect(observed).toHaveLength(8);
    await flush();
    expect(observed).toHaveLength(12);
    c.disconnect();
  });

  it('past the stale bound the table is brought to the present', async () => {
    const { c, observed } = await connectedClient();
    const seen: Record<string, unknown>[] = [];
    (c as unknown as { opts: { onEvent: (p: Record<string, unknown>) => void } }).opts.onEvent = (
      p
    ) => {
      observed.push(`event:${String(p.type)}`);
      seen.push(p);
    };
    event(1, { type: 'player_action' });
    event(2, { type: 'turn_change', action_context: 'villain-turn' });
    live()._frame({ type: 'SNAPSHOT', tableId: TABLE, seq: 30, state: { hand_number: 5 } });
    event(3, { type: 'player_action' });
    event(4, { type: 'seat_moved', replay_until: now + 30_000 });
    event(5, { type: 'pot_update' });
    live()._frame({
      type: 'SNAPSHOT',
      tableId: TABLE,
      seq: 31,
      state: { hand_number: 6, action_context: 'hero-turn' },
    });
    event(6, { type: 'turn_change', action_context: 'hero-turn' });
    now += 3_500;
    await flush();
    expect(observed).toEqual([
      // The hole is announced once, before anything later is shown.
      'event:engine_event_gap',
      // Every state frame is applied, in order: the table is exactly current.
      'snapshot:5',
      // What the engine says is still owed is delivered, as a replay.
      'event:seat_moved',
      'snapshot:6',
      // The decision that is owed NOW is delivered. The one that passed is not.
      'event:turn_change',
    ]);
    expect(seen.find((p) => p.type === 'seat_moved')).toMatchObject({ replayed: true });
    expect(seen.find((p) => p.type === 'turn_change')).toMatchObject({
      action_context: 'hero-turn',
    });
    // Nothing is left to replay, and a later live event is not mistaken for a gap.
    event(7, { type: 'player_action' });
    await flush();
    await flush();
    expect(observed.slice(5)).toEqual(['event:player_action']);
    c.disconnect();
  });

  it('a newest turn_change that outran its state is held, never shown against old wagers', async () => {
    const { c, observed } = await connectedClient();
    live()._frame({
      type: 'SNAPSHOT',
      tableId: TABLE,
      seq: 40,
      state: { hand_number: 8, action_context: 'old-turn' },
    });
    event(1, { type: 'player_action' });
    event(2, { type: 'turn_change', action_context: 'hero-turn' });
    now += 3_500;
    await flush();
    expect(observed).toEqual(['snapshot:8', 'event:engine_event_gap']);
    expect(live().sent.some((frame) => frame.includes('RESYNC'))).toBe(true);
    live()._frame({
      type: 'SNAPSHOT',
      tableId: TABLE,
      seq: 41,
      state: { hand_number: 8, action_context: 'hero-turn' },
    });
    expect(observed).toEqual([
      'snapshot:8',
      'event:engine_event_gap',
      'snapshot:8',
      'event:turn_change',
    ]);
    c.disconnect();
  });

  it('a teardown in the middle of a skip stops it: nothing from the dead socket follows', async () => {
    const { c, observed } = await connectedClient();
    (c as unknown as { opts: { onEvent: (p: Record<string, unknown>) => void } }).opts.onEvent = (
      p
    ) => {
      observed.push(`event:${String(p.type)}`);
      if (p.type === 'seat_moved') c.disconnect();
    };
    event(1, { type: 'seat_moved', replay_until: now + 30_000 });
    live()._frame({ type: 'SNAPSHOT', tableId: TABLE, seq: 50, state: { hand_number: 9 } });
    event(2, { type: 'bbj_hit', replay_until: now + 30_000 });
    now += 3_500;
    await flush();
    await flush();
    expect(observed).toEqual(['event:seat_moved']);
  });

  it('a hidden tab is late by design and loses nothing while hidden', async () => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    const { c, observed } = await connectedClient();
    event(1, { type: 'player_action' });
    event(2, { type: 'pot_update' });
    now += 10_000;
    await flush();
    await flush();
    expect(observed).toEqual(['event:player_action', 'event:pot_update']);
    c.disconnect();
  });
});
