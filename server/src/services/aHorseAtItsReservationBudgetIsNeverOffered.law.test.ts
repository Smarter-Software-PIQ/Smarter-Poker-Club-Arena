/**
 * A HORSE AT ITS TOURNAMENT RESERVATION BUDGET IS NEVER OFFERED A SEAT
 * (incident eaafbbfb, SpinFleetProducingNothing, 2026-11-19).
 *
 * The free-horse picker and the seat door disagreed about which horses are
 * free: the door (fn_seat_horse_in_seat_first_game) refuses a horse holding
 * four unresolved tournament promises, the picker counted only seat load, and
 * six Spins overran their ladder envelope (up to 9,407 s against 8,400 s)
 * offering the same refused horses pass after pass. These laws pin:
 *
 *   1. the real pickFreeHorses never offers a horse the shared read names;
 *   2. a refusal the read did not know yet keeps that horse out for a while;
 *   3. an unreadable read changes nothing else (the door still decides);
 *   4. the shared read computes the door's own predicate and threshold.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Row = { id: string; is_horse: boolean; horse_status: string | null };
let profiles: Row[] = [];
let budgetAnswer: { data: unknown; error: { message: string } | null } = { data: [], error: null };

vi.mock('./supabase/client.js', () => {
  const builder = (table: string) => {
    const preds: Array<(r: Row) => boolean> = [];
    let cursor: string | null = null;
    let lim = Infinity;
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = (col: keyof Row, v: unknown) => {
      preds.push((r) => r[col] === v);
      return b;
    };
    b.neq = (col: keyof Row, v: unknown) => {
      preds.push((r) => r[col] !== null && r[col] !== v);
      return b;
    };
    b.order = () => b;
    b.limit = (n: number) => {
      lim = n;
      return b;
    };
    b.gt = (_col: string, v: string) => {
      cursor = v;
      return b;
    };
    const answer = () => {
      if (table !== 'profiles') return Promise.resolve({ data: [], error: null });
      const rows = profiles
        .filter((r) => preds.every((p) => p(r)))
        .filter((r) => cursor === null || r.id > cursor)
        .sort((a, z) => (a.id < z.id ? -1 : 1))
        .slice(0, lim)
        .map((r) => ({ id: r.id }));
      return Promise.resolve({ data: rows, error: null });
    };
    b.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => answer().then(ok, bad);
    return b;
  };
  const client = {
    rpc: vi.fn(async (name: string) =>
      name === 'fn_horses_at_tournament_reservation_budget'
        ? budgetAnswer
        : { data: null, error: null }
    ),
    from: (table: string) => builder(table),
  };
  return { supabase: client, maintenanceSupabase: client };
});
vi.mock('./errorReporter.js', () => ({ reportError: vi.fn() }));

import { TournamentRecurringService } from './TournamentRecurringService.js';
import {
  HORSE_RESERVATION_REFUSAL_MEMORY_MS,
  HorseReservationBudget,
} from './horseReservationBudget.js';
import { reportError } from './errorReporter.js';

const id = (prefix: string, n: number) =>
  `${prefix}${n.toString(16).padStart(4, '0')}-0000-4000-8000-000000000000`;

describe('the free-horse picker honours the seat door reservation budget', () => {
  let svc: TournamentRecurringService;
  const free = Array.from({ length: 40 }, (_, n) => id('a000', n));
  const booked = Array.from({ length: 360 }, (_, n) => id('b000', n));

  beforeEach(() => {
    profiles = [...free, ...booked].map((i) => ({
      id: i,
      is_horse: true,
      horse_status: 'available',
    }));
    budgetAnswer = { data: booked, error: null };
    svc = new TournamentRecurringService();
    vi.spyOn(
      svc as unknown as { horseLoadMap: () => Promise<Map<string, number> | null> },
      'horseLoadMap'
    ).mockResolvedValue(new Map());
    vi.spyOn(
      svc as unknown as { cashRoomReserve: () => Promise<number> },
      'cashRoomReserve'
    ).mockResolvedValue(0);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(reportError).mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  const pick = (count: number, allLanes: boolean) =>
    (
      svc as unknown as { pickFreeHorses: (c: number, a: boolean) => Promise<string[]> }
    ).pickFreeHorses(count, allLanes);

  it('never offers a horse the door would refuse for its reservation budget', async () => {
    for (let round = 0; round < 20; round++) {
      const picked = await pick(1000, true);
      expect(picked.length).toBeGreaterThan(0);
      for (const h of picked) expect(booked).not.toContain(h);
    }
  });

  it('offers nobody rather than a refused seat when every idle horse is at the budget', async () => {
    budgetAnswer = { data: [...free, ...booked], error: null };
    expect(await pick(3, true)).toEqual([]);
  });

  it('an unreadable budget read changes nothing else and is reported once', async () => {
    budgetAnswer = { data: null, error: { message: 'boom' } };
    const picked = await pick(1000, true);
    // Exactly the pool the picker offered before the read existed.
    expect(picked.some((h) => booked.includes(h))).toBe(true);
    await pick(3, true);
    expect(
      vi
        .mocked(reportError)
        .mock.calls.filter(([, ctx]) => ctx === 'HorseReservationBudget.read_failed')
    ).toHaveLength(1);
  });
});

describe('a refusal the read did not know yet', () => {
  it('keeps the horse out for the memory window, then lets the read decide again', async () => {
    let now = 1_000_000;
    const budget = new HorseReservationBudget(
      () => now,
      async () => ({ data: [], error: null })
    );
    budget.noteRefused('h1');
    expect([...(await budget.atBudget())]).toEqual(['h1']);
    now += HORSE_RESERVATION_REFUSAL_MEMORY_MS - 1;
    expect((await budget.atBudget()).has('h1')).toBe(true);
    now += 2;
    expect((await budget.atBudget()).has('h1')).toBe(false);
  });
});

describe('the shared read computes the door predicate', () => {
  const dir = join(__dirname, '..', '..', '..', 'supabase', 'migrations');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const latest = (needle: RegExp) => {
    const hit = files.filter((f) => needle.test(readFileSync(join(dir, f), 'utf8'))).pop();
    if (!hit) throw new Error(`no migration matches ${needle}`);
    return readFileSync(join(dir, hit), 'utf8');
  };
  const squash = (s: string) => s.replace(/\s+/g, ' ');
  const door = squash(
    latest(/CREATE OR REPLACE FUNCTION public\.fn_seat_horse_in_seat_first_game\(/)
  );
  const read = squash(
    latest(/CREATE OR REPLACE FUNCTION public\.fn_horses_at_tournament_reservation_budget\(/)
  );

  it('the door still refuses on the reason the engine remembers', () => {
    expect(door).toContain("'horse_tournament_reservation_budget'");
  });

  for (const clause of [
    "promise.status IN ('registered','playing')",
    "upper(COALESCE(promised.status,'')) NOT IN ('COMPLETING','COMPLETED','CANCELLED')",
    'count(DISTINCT promise.tournament_id)',
    '>= 4',
  ]) {
    it(`both carry ${clause}`, () => {
      expect(door).toContain(clause);
      expect(read).toContain(clause);
    });
  }
});
