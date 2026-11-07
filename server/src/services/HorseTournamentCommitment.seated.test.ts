import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ rows: [] as unknown[], frozen: false }));
vi.mock('./supabase.js', () => ({
  supabase: {
    from: vi.fn(() => {
      let seatFirst = false;
      const q: any = {};
      for (const method of ['select', 'in', 'order', 'limit', 'lte', 'gt']) q[method] = () => q;
      q.is = () => {
        seatFirst = true;
        return q;
      };
      q.then = (yes: any, no: any) =>
        Promise.resolve({ data: seatFirst ? [] : state.rows, error: null }).then(yes, no);
      return q;
    }),
  },
}));
vi.mock('../maintenance/freezeState.js', () => ({ isMaintenanceFrozen: () => state.frozen }));
import { HorseSessionRotator } from './HorseSessionRotator.js';
const HORSE = 'horse';
const TOURNEY = 'event';
const TOURNEY_TABLE = 'event-table';
function scenario(cashCount: number, minutes = 10, owed = 0) {
  const now = Date.now();
  const leaveTable = vi.fn(async () => ({ success: true }));
  const hitRunHandsOwed = vi.fn(() => owed);
  const getEngine = vi.fn(() => ({ leaveTable, hitRunHandsOwed }) as any);
  const rotator = new HorseSessionRotator(getEngine);
  Object.assign(rotator, { isRunning: true, lifecycleGeneration: 1 });
  const cash = Array.from({ length: cashCount }, (_, i) => ({
    user_id: HORSE,
    table_id: `cash-${i}`,
    joined_at: new Date(now - (90 - i) * 60_000).toISOString(),
    tables: { status: 'running', tournament_id: null },
  }));
  const all = [
    ...cash,
    {
      user_id: HORSE,
      table_id: TOURNEY_TABLE,
      tables: { status: 'waiting', tournament_id: TOURNEY },
    },
  ];
  state.rows = [
    {
      id: 'registration',
      user_id: HORSE,
      tournament_id: TOURNEY,
      tournaments: {
        start_time: new Date(now + minutes * 60_000).toISOString(),
        status: 'REGISTERING',
      },
    },
  ];
  const run = () =>
    (rotator as any).leaveCashForTournaments(
      all,
      new Map(cash.map((s) => [s.table_id, [s]])),
      new Set([HORSE]),
      new Set(),
      1
    );
  return { run, leaveTable, getEngine, rotator };
}
beforeEach(() => {
  state.rows = [];
  state.frozen = false;
});
describe('a bought tournament chair retains its pre-start cash-session timing', () => {
  it('four cash seats plus an already seated imminent event leave one cash session', async () => {
    const s = scenario(4);
    expect(await s.run()).toBe(1);
    expect(s.leaveTable).toHaveBeenCalledTimes(1);
    expect(s.leaveTable).toHaveBeenCalledWith(HORSE);
    expect(s.getEngine).toHaveBeenCalledTimes(1);
    expect(s.getEngine).toHaveBeenCalledWith('cash-0');
  });
  it('does not count the bought event twice when three cash seats still fit', async () => {
    const s = scenario(3);
    expect(await s.run()).toBe(0);
    expect(s.leaveTable).not.toHaveBeenCalled();
  });
  it('does not change cash sessions for an event more than an hour away', async () => {
    const s = scenario(4, 61);
    expect(await s.run()).toBe(0);
    expect(s.leaveTable).not.toHaveBeenCalled();
  });
  it('preserves the maintenance freeze before asking the ordinary leave door', async () => {
    const s = scenario(4);
    state.frozen = true;
    expect(await s.run()).toBe(0);
    expect(s.leaveTable).not.toHaveBeenCalled();
  });
});

describe('HIT AND RUN: a horse is a player (CLAUDE.md 10.5)', () => {
  it('a horse owing hands leaves for its tournament the way a person would: it confirms the count', async () => {
    const s = scenario(4, 10, 6);
    expect(await s.run()).toBe(1);
    expect(s.leaveTable).toHaveBeenCalledTimes(1);
    expect(s.leaveTable).toHaveBeenCalledWith(HORSE, { confirmHandCount: true });
    expect(s.getEngine).toHaveBeenCalledTimes(1);
  });

  it('an ordinary rotation never asks a seat that owes hands, and a refusal holds about a hand per owed hand', () => {
    const s = scenario(1, 10, 3);
    const r = s.rotator as any;
    expect(r.isLeaveHeld('cash-0', HORSE)).toBe(true);
    expect(r.isLeaveHeld('cash-0', HORSE, Date.now(), false)).toBe(false);
    const quiet = scenario(1, 10, 0).rotator as any;
    expect(quiet.isLeaveHeld('cash-0', HORSE)).toBe(false);
    const before = Date.now();
    quiet.noteLeaveResult('cash-0', HORSE, {
      success: false,
      code: 'LEAVE_LOCKED',
      hands_remaining: 4,
    });
    const until = quiet.leaveHeld.get((HorseSessionRotator as any).breakKey('cash-0', HORSE));
    expect(until).toBeGreaterThanOrEqual(
      before + 4 * HorseSessionRotator.HIT_RUN_RETRY_MS_PER_HAND
    );
    expect(until).toBeLessThanOrEqual(
      Date.now() + 4 * HorseSessionRotator.HIT_RUN_RETRY_MS_PER_HAND + 1_000
    );
  });

  it('an engine without the count changes nothing', () => {
    const r = new HorseSessionRotator(
      () => ({ leaveTable: async () => ({ success: true }) }) as any
    ) as any;
    expect(r.isLeaveHeld('t', 'u')).toBe(false);
    const throwing = new HorseSessionRotator(
      () =>
        ({
          leaveTable: async () => ({ success: true }),
          hitRunHandsOwed: () => {
            throw new Error('x');
          },
        }) as any
    ) as any;
    expect(throwing.isLeaveHeld('t', 'u')).toBe(false);
  });
});
