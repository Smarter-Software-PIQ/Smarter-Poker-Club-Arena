/**
 * The mystery bounty pool before the chests are drawn is the ACTUAL pool so
 * far, never a projected ladder (Dan 2026-11-07: "NEVER EVER USE 'PROJECTED
 * PAYOUTS' ANYWHERE AND EVER. YOU ONLY USE ACTUAL REAL TIME TOTALS!").
 */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  row: vi.fn(),
  report: vi.fn(),
  listeners: new Map<string, () => void>(),
}));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: m.report }));
vi.mock('../../src/services/tournamentStandingsUpdates', () => ({
  subscribeTournamentStandings: (id: string, fn: () => void) => {
    m.listeners.set(id, fn);
    return () => m.listeners.delete(id);
  },
}));
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table !== 'tournaments') throw new Error(table);
      let id = '';
      const b: any = {
        select: () => b,
        eq: (_k: string, v: string) => {
          id = v;
          return b;
        },
        abortSignal: () => b,
        maybeSingle: () => m.row(id),
      };
      return b;
    },
  },
}));
import {
  mysteryPoolSoFarCents,
  useMysteryBountyPoolSoFar,
} from '../../src/hooks/useMysteryBountyPoolSoFar';

const row = (pool: number, paid = 0) => ({
  bounty_pool: pool,
  bounty_pool_paid: paid,
  mystery_bounty_pool_percent: 50,
  mystery_bounty_regular_pool_percent: 50,
});

beforeEach(() => {
  vi.resetAllMocks();
  m.listeners.clear();
  m.row.mockResolvedValue({ data: row(2080), error: null });
});
afterEach(cleanup);

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe('the mystery bounty pool so far', () => {
  it('is the mystery share of the actual bounty pool, less flat knockouts already paid', () => {
    expect(mysteryPoolSoFarCents(row(2080), 1)).toBe(104000);
    expect(mysteryPoolSoFarCents(row(2080, 2000), 1)).toBe(8000);
    expect(mysteryPoolSoFarCents(row(0), 1)).toBe(0);
    expect(mysteryPoolSoFarCents(row(2080), 0)).toBe(0);
  });

  it('reads live and follows the event feed, returning a number and nothing else', async () => {
    const hook = renderHook(() => useMysteryBountyPoolSoFar('event', true, 1));
    await flush();
    expect(hook.result.current).toBe(104000);
    m.row.mockResolvedValue({ data: row(3000), error: null });
    await act(async () => {
      m.listeners.get('event')?.();
    });
    expect(hook.result.current).toBe(150000);
  });

  it('reads nothing while disabled and never shows a prior event pool', async () => {
    const hook = renderHook(({ id, on }) => useMysteryBountyPoolSoFar(id, on, 1), {
      initialProps: { id: 'first', on: true },
    });
    await flush();
    expect(hook.result.current).toBe(104000);
    m.row.mockReturnValue(new Promise(() => {}));
    hook.rerender({ id: 'second', on: true });
    expect(hook.result.current).toBeNull();
    hook.rerender({ id: 'second', on: false });
    expect(hook.result.current).toBeNull();
  });
});
