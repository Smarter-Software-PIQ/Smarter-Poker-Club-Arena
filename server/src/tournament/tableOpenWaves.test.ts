import { describe, expect, it } from 'vitest';
import {
  FIRST_DEAL_MAX_SPREAD_MS,
  FIRST_DEAL_WAVE_GAP_MS,
  FIRST_DEAL_WAVE_SIZE,
  FirstDealWaves,
  TABLE_OPEN_IN_FLIGHT_MAX,
  TABLE_OPEN_WAVE_GAP_MS,
  TABLE_OPEN_WAVE_SIZE,
  TableOpenGate,
  orderTablesForWaves,
  type TableOpenSlot,
} from './tableOpenWaves.js';

/** A hand-driven clock: timers fire only when the test advances time. */
function clock() {
  let t = 1_000_000;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => t,
    setTimer: (fn: () => void, ms: number) => {
      const id = ++seq;
      timers.set(id, { at: t + ms, fn });
      return id;
    },
    clearTimer: (id: unknown) => void timers.delete(id as number),
    async advance(ms: number) {
      const until = t + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, v]) => v.at <= until)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        t = due[1].at;
        due[1].fn();
        await Promise.resolve();
      }
      t = until;
      await Promise.resolve();
    },
  };
}

const ids = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => `${prefix}-${String(i).padStart(3, '0')}`);

function gateWith(c: ReturnType<typeof clock>, extra: Record<string, number> = {}) {
  return new TableOpenGate({
    now: c.now,
    setTimer: c.setTimer,
    clearTimer: c.clearTimer,
    log: () => {},
    ...extra,
  });
}

async function request(gate: TableOpenGate, label: string, granted: string[]) {
  const slot = await gate.acquire();
  granted.push(label);
  return slot;
}

describe('the opening budget (one gate for every tournament table start)', () => {
  it('reuses the maintenance resume envelope: 25 tables per 1500 ms', () => {
    expect(TABLE_OPEN_WAVE_SIZE).toBe(25);
    expect(TABLE_OPEN_WAVE_GAP_MS).toBe(1500);
    expect(TABLE_OPEN_IN_FLIGHT_MAX).toBe(2 * TABLE_OPEN_WAVE_SIZE);
  });

  it('admits a big field in waves, first come first served', async () => {
    const c = clock();
    const gate = gateWith(c, { inFlightMax: 1000 });
    const granted: string[] = [];
    const slots: Promise<TableOpenSlot>[] = [];
    for (const id of ids('a', 60)) slots.push(request(gate, id, granted));
    await Promise.resolve();
    await Promise.resolve();
    expect(granted).toHaveLength(25);
    expect(granted).toEqual(ids('a', 60).slice(0, 25));
    await c.advance(1499);
    expect(granted).toHaveLength(25);
    await c.advance(1);
    expect(granted).toHaveLength(50);
    await c.advance(1500);
    expect(granted).toEqual(ids('a', 60));
  });

  it('two big events launching in the same instant share ONE budget', async () => {
    const c = clock();
    const gate = gateWith(c, { inFlightMax: 1000 });
    const granted: string[] = [];
    // Both 60-table fields ask at once, interleaved the way two managers'
    // start loops interleave on one event loop.
    const a = ids('a', 60);
    const b = ids('b', 60);
    for (let i = 0; i < 60; i++) {
      void request(gate, a[i], granted);
      void request(gate, b[i], granted);
    }
    await c.advance(0);
    // Never more than one wave's worth in any 1500 ms window, across BOTH events.
    expect(granted).toHaveLength(25);
    let waves = 1;
    while (granted.length < 120) {
      const before = granted.length;
      await c.advance(1500);
      expect(granted.length - before).toBeLessThanOrEqual(25);
      waves++;
    }
    expect(waves).toBe(5);
    // Both events progress together; neither waits for the other to finish.
    const firstWave = granted.slice(0, 25);
    expect(firstWave.some((x) => x.startsWith('a'))).toBe(true);
    expect(firstWave.some((x) => x.startsWith('b'))).toBe(true);
    // The whole 120-table field is open inside 6 s.
    expect((waves - 1) * 1500).toBeLessThanOrEqual(6000);
  });

  it('bounds the starts still inside their reads, and a ready table lets the next in', async () => {
    const c = clock();
    const gate = gateWith(c);
    const granted: string[] = [];
    const slots: TableOpenSlot[] = [];
    for (const id of ids('a', 80)) void request(gate, id, granted).then((s) => slots.push(s));
    await c.advance(0);
    await c.advance(1500);
    await c.advance(1500);
    await c.advance(1500);
    // A slow database: nothing has become ready, so the in-flight cap holds.
    expect(granted).toHaveLength(TABLE_OPEN_IN_FLIGHT_MAX);
    slots[0].release();
    slots[0].release(); // idempotent
    await c.advance(0);
    expect(granted).toHaveLength(TABLE_OPEN_IN_FLIGHT_MAX + 1);
    expect(gate.stats().inFlight).toBe(TABLE_OPEN_IN_FLIGHT_MAX);
  });

  it('a wedged start gives its slot back at the horizon, so the gate never stops opening', async () => {
    const c = clock();
    const gate = gateWith(c, { inFlightMax: 2, waveSize: 2, horizonMs: 30_000 });
    const granted: string[] = [];
    for (const id of ids('a', 3)) void request(gate, id, granted);
    await c.advance(1500);
    expect(granted).toHaveLength(2);
    await c.advance(30_000);
    expect(granted).toHaveLength(3);
  });

  it('a start whose manager went away is dropped without spending the wave', async () => {
    const c = clock();
    const gate = gateWith(c, { waveSize: 1 });
    const granted: string[] = [];
    const first = await gate.acquire();
    let gone = false;
    const dropped = gate.acquire(() => !gone);
    void request(gate, 'next', granted);
    gone = true;
    await c.advance(1500);
    const empty = await dropped;
    empty.release();
    expect(granted).toEqual(['next']);
    expect(gate.stats().grantedTotal).toBe(2);
    first.release();
  });

  it('a small field opens at once, exactly as before', async () => {
    const c = clock();
    const gate = gateWith(c);
    const granted: string[] = [];
    for (const id of ids('s', 9)) void request(gate, id, granted);
    await c.advance(0);
    expect(granted).toHaveLength(9);
    expect(gate.stats().queued).toBe(0);
  });
});

describe('the first deal goes in waves', () => {
  const START = Date.UTC(2026, 10, 6, 14, 30);

  it('wave 0 deals at the advertised start and nothing deals before it', () => {
    const w = new FirstDealWaves();
    const at = w.assign(START, ids('a', 60), START - 60_000);
    const times = [...at.values()];
    expect(Math.min(...times)).toBe(START);
    expect(times.filter((t) => t === START)).toHaveLength(FIRST_DEAL_WAVE_SIZE);
    expect(Math.max(...times)).toBe(START + 2 * FIRST_DEAL_WAVE_GAP_MS);
  });

  it('two launches booked for the same instant continue one wave count', () => {
    const w = new FirstDealWaves();
    const a = w.assign(START, ids('a', 58), START - 60_000);
    const b = w.assign(START, ids('b', 60), START - 59_000);
    const all = [...a.values(), ...b.values()];
    const perWave = new Map<number, number>();
    for (const t of all) perWave.set(t, (perWave.get(t) ?? 0) + 1);
    for (const n of perWave.values()) expect(n).toBeLessThanOrEqual(FIRST_DEAL_WAVE_SIZE);
    expect(perWave.get(START)).toBe(FIRST_DEAL_WAVE_SIZE);
    // 118 tables: five waves, the last 6 s after the start.
    expect(Math.max(...all) - START).toBe(4 * FIRST_DEAL_WAVE_GAP_MS);
  });

  it('a table keeps its wave when it is asked again (resume in the pre-seat minute)', () => {
    const w = new FirstDealWaves();
    const first = w.assign(START, ids('a', 60), START - 60_000);
    const late = orderTablesForWaves(ids('a', 60)).at(-1)!;
    expect(w.assign(START, [late], START - 30_000).get(late)).toBe(first.get(late));
    // ...and asking again did not push a newcomer further back.
    const newcomer = w.assign(START, ['z-new'], START - 20_000).get('z-new')!;
    expect(newcomer).toBe(START + 2 * FIRST_DEAL_WAVE_GAP_MS);
  });

  it('a different start instant starts its own wave 0', () => {
    const w = new FirstDealWaves();
    w.assign(START, ids('a', 100), START - 60_000);
    const other = w.assign(START + 30 * 60_000, ['x'], START);
    expect(other.get('x')).toBe(START + 30 * 60_000);
  });

  it('never spreads the field past the cap, however many events share the minute', () => {
    const w = new FirstDealWaves();
    const at = w.assign(START, ids('huge', 2000), START - 60_000);
    expect(Math.max(...at.values()) - START).toBe(FIRST_DEAL_MAX_SPREAD_MS);
    expect(FIRST_DEAL_MAX_SPREAD_MS).toBeLessThanOrEqual(30_000);
  });

  it('orders by the table id alone (section 10.5: nothing about who is seated)', () => {
    const one = orderTablesForWaves(['c', 'a', 'b', 'a']);
    const two = orderTablesForWaves(['b', 'a', 'c']);
    expect(one).toEqual(two);
    expect(one).toHaveLength(3);
  });
});

describe('a manager that stands down is never held behind the line', () => {
  it('drops every unwanted waiter on the next pass, even while the in-flight cap blocks', async () => {
    const c = clock();
    const gate = gateWith(c, { waveSize: 2, inFlightMax: 2 });
    await gate.acquire();
    await gate.acquire();
    let gone = false;
    const keep = gate.acquire();
    const leaving = gate.acquire(() => !gone);
    let settled = false;
    void leaving.then(() => (settled = true));
    gone = true;
    await c.advance(1500);
    expect(settled).toBe(true);
    expect(gate.stats().queued).toBe(1);
    void keep;
  });
});
