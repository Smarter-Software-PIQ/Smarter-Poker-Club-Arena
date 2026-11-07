/**
 * WHEN A HORSE SITS OUT (2026-11-07), and HIT AND RUN (owner 2026-11-06):
 * a horse steps away for a hand or two or a few minutes through the person's
 * own sit-out, rarely, only at well-populated tables, and never while it
 * still owes hands in profit - a sit-out the eviction clock ends is a
 * cash-out, so it would be a hit-and-run leave. The rotator tests drive the
 * real rotator pass over a fake PostgREST floor.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  horseSitOutPlan,
  sitOutRefusal,
  SIT_OUT_LONG_MS,
  SIT_OUT_SHORT_MS,
  type HorseSitOutInput,
} from './HorseSitOutChoice.js';
import { DisconnectEngine } from '../engine/DisconnectEngine.js';
import { supabase } from './supabase.js';
import { HorseSessionRotator, type RotatorEngine } from './HorseSessionRotator.js';
import { setMaintenanceFrozen } from '../maintenance/freezeState.js';
import { JAQK_CLUB_ID } from './StableHand.js';

const base: HorseSitOutInput = {
  horseId: 'h',
  tableId: 't',
  moment: 1,
  draw: () => 0,
  seatsAtTable: 6,
  humanPresent: false,
  handsOwed: 0,
  sittingOut: false,
  leaving: false,
  onBreakHere: false,
  breaksOnFloor: 0,
  breakTakenThisCycle: false,
  tablesOnFloor: 1,
};

describe('the pure decision', () => {
  it('a horse owing hands in profit never sits out, whatever the draw', () => {
    expect(sitOutRefusal({ ...base, handsOwed: 1 })).toBe('owes_hands');
    expect(horseSitOutPlan({ ...base, handsOwed: 10 })).toBeNull();
  });

  it('the draw is not even taken unless every other test passes', () => {
    const draw = vi.fn(() => 0);
    expect(horseSitOutPlan({ ...base, draw, handsOwed: 3 })).toBeNull();
    expect(horseSitOutPlan({ ...base, draw, seatsAtTable: 3 })).toBeNull();
    expect(draw).not.toHaveBeenCalled();
    expect(horseSitOutPlan({ ...base, draw })).not.toBeNull();
    expect(draw).toHaveBeenCalledTimes(1);
  });

  it('only at well-populated tables, one at a time, never twice, never on the way out', () => {
    expect(sitOutRefusal({ ...base, seatsAtTable: 4 })).toBe('short_table');
    expect(sitOutRefusal({ ...base, seatsAtTable: 5, humanPresent: true })).toBe('short_table');
    expect(sitOutRefusal({ ...base, sittingOut: true })).toBe('already_away');
    expect(sitOutRefusal({ ...base, onBreakHere: true })).toBe('already_away');
    expect(sitOutRefusal({ ...base, leaving: true })).toBe('leaving');
    expect(sitOutRefusal({ ...base, breaksOnFloor: 2 })).toBe('floor_busy');
    expect(sitOutRefusal({ ...base, breakTakenThisCycle: true })).toBe('floor_busy');
  });

  it('the rate is low and shared across the floor', () => {
    expect(sitOutRefusal({ ...base, draw: () => 0.34 })).toBeNull();
    expect(sitOutRefusal({ ...base, draw: () => 0.35 })).toBe('not_drawn');
    expect(sitOutRefusal({ ...base, draw: () => 0.04, tablesOnFloor: 10 })).toBe('not_drawn');
    expect(sitOutRefusal({ ...base, draw: () => 0.03, tablesOnFloor: 10 })).toBeNull();
  });

  it('a hand or two, or a few minutes; both end inside the eviction clock with a cycle of slack', () => {
    const kinds = new Map<string, number>();
    for (let i = 0; i < 400; i++) {
      const plan = horseSitOutPlan({ ...base, horseId: `h${i}` })!;
      kinds.set(plan.kind, (kinds.get(plan.kind) ?? 0) + 1);
      const [lo, hi] = plan.kind === 'hand_or_two' ? SIT_OUT_SHORT_MS : SIT_OUT_LONG_MS;
      expect(plan.durationMs).toBeGreaterThanOrEqual(lo);
      expect(plan.durationMs).toBeLessThanOrEqual(hi);
      expect(plan.durationMs + 90_000).toBeLessThan(DisconnectEngine.SITOUT_MAX_MS);
    }
    expect(kinds.get('hand_or_two')).toBeGreaterThan(160);
    expect(kinds.get('few_minutes')).toBeGreaterThan(100);
  });

  it('is deterministic per (horse, table, moment)', () => {
    expect(horseSitOutPlan({ ...base, horseId: 'x', moment: 9 })).toEqual(
      horseSitOutPlan({ ...base, horseId: 'x', moment: 9 })
    );
  });
});

/* ── THE CALL PATH: the real rotator pass over a fake floor ─────────────── */

const NOW = Date.parse('2026-11-07T15:00:00Z');
const TABLE_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const TABLE_B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const HORSES = Array.from(
  { length: 12 },
  (_, i) => `h0000000-0000-4000-8000-${String(i).padStart(12, '0')}`
);

type Rows = Record<string, any>[];
function fakeDb(tables: Record<string, Rows>) {
  const build = (name: string) => {
    let rows = [...(tables[name] ?? [])];
    let from = 0;
    let to = Infinity;
    let lim = Infinity;
    const b: any = {};
    b.select = () => b;
    b.eq = (c: string, v: unknown) => ((rows = rows.filter((r) => r[c] === v)), b);
    b.in = (c: string, v: unknown[]) => ((rows = rows.filter((r) => v.includes(r[c]))), b);
    b.is = (c: string, v: unknown) => ((rows = rows.filter((r) => (r[c] ?? null) === v)), b);
    b.gt = (c: string, v: any) => ((rows = rows.filter((r) => String(r[c]) > String(v))), b);
    b.lte = () => b;
    b.not = () => b;
    b.order = () => b;
    b.limit = (n: number) => ((lim = n), b);
    b.range = (a: number, z: number) => ((from = a), (to = z), b);
    b.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) =>
      Promise.resolve({
        data: rows.slice(from, Math.min(rows.length, to + 1)).slice(0, lim),
        error: null,
      }).then(ok, bad);
    return b;
  };
  vi.spyOn(supabase, 'from').mockImplementation(((name: string) => build(name)) as never);
  vi.spyOn(supabase, 'rpc').mockImplementation((() =>
    Promise.resolve({ data: null, error: { message: 'no rpc in fixture' } })) as never);
}

const tableRow = (id: string) => ({
  id,
  big_blind: 0.02,
  small_blind: 0.01,
  tournament_id: null,
  status: 'running',
  settings: {},
  cluster_id: null,
  role: null,
  main_index: null,
  lifecycle: 'live',
  created_at: new Date(NOW - 3600_000).toISOString(),
  max_players: 6,
  min_buy_in: 1,
  max_buy_in: 4,
});

function floor() {
  const tables = [tableRow(TABLE_A), tableRow(TABLE_B)];
  const seats: Rows = [];
  tables.forEach((t, ti) => {
    for (let s = 0; s < 6; s++) {
      seats.push({
        id: `s-${ti}-${s}`,
        table_id: t.id,
        user_id: HORSES[ti * 6 + s],
        seat_number: s + 1,
        stack: 4, // up on the 1..4 buy-in: in profit
        joined_at: new Date(NOW - (60 + s) * 60_000).toISOString(),
        club_id: JAQK_CLUB_ID,
        leave_pending: false,
        is_sitting_out: false,
        left_at: null,
        auto_rebuy: false,
        tables: t,
      });
    }
  });
  return {
    table_seats: seats,
    profiles: HORSES.map((id) => ({ id, is_horse: true })),
    club_members: [],
    chip_ledger: [],
    table_waitlist: [],
    cash_game_waitlist: [],
    cash_games: [],
    cash_seat_moves: [],
    hand_history: [],
    tournament_players: [],
    tables: tables.map((t) => ({ ...t, is_deleted: false })),
  };
}

function fakeEngines(handsOwed: number) {
  const leaveTable = vi.fn(() => ({ success: true }));
  const sitOut = vi.fn(() => ({ success: true }));
  const engine: RotatorEngine = {
    leaveTable,
    sitOut,
    hitRunHandsOwed: () => handsOwed,
    isClientSitOut: () => false,
  };
  return { engine, leaveTable, sitOut };
}

async function rotateOnce(rot: any) {
  rot.isRunning = true;
  rot.lifecycleGeneration = 1;
  await rot.rotate(1);
}

describe('THE CALL PATH: the rotator pass steps a horse away, and never one owing hands', () => {
  beforeEach(() => {
    setMaintenanceFrozen(false);
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    for (const m of ['log', 'warn', 'error'] as const)
      vi.spyOn(console, m).mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('a horse owing nothing: a draw under the rate steps one away, through the engine sit-out', async () => {
    // Above every session hazard, below the shared sit-out rate (0.35 / 2 tables).
    vi.spyOn(Math, 'random').mockReturnValue(0.1);
    fakeDb(floor());
    const { engine, sitOut } = fakeEngines(0);
    const rot = new HorseSessionRotator(() => engine) as any;
    await rotateOnce(rot);
    const awayCalls = sitOut.mock.calls.filter((c: unknown[]) => c[1] === true);
    expect(awayCalls).toHaveLength(1);
    expect(rot.breaks.size).toBe(1);
    const [brk] = [...rot.breaks.values()];
    expect(brk.sitBackAt - NOW).toBeGreaterThanOrEqual(SIT_OUT_SHORT_MS[0]);
    expect(brk.sitBackAt - NOW).toBeLessThanOrEqual(SIT_OUT_LONG_MS[1]);
  });

  it('a horse in profit owing hands neither sits out nor leaves, even on draws that would send it', async () => {
    for (const draw of [0, 0.1]) {
      vi.spyOn(Math, 'random').mockReturnValue(draw);
      fakeDb(floor());
      const { engine, sitOut, leaveTable } = fakeEngines(5);
      const rot = new HorseSessionRotator(() => engine) as any;
      await rotateOnce(rot);
      expect(sitOut.mock.calls.filter((c: unknown[]) => c[1] === true)).toHaveLength(0);
      expect(leaveTable).not.toHaveBeenCalled();
      expect(rot.breaks.size).toBe(0);
      vi.restoreAllMocks();
      for (const m of ['log', 'warn', 'error'] as const)
        vi.spyOn(console, m).mockImplementation(() => {});
    }
  });
});
