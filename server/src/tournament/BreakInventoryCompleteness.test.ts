import { afterEach, describe, expect, it, vi } from 'vitest';
import { TournamentManager } from './TournamentManager.js';
import { supabase } from '../services/supabase.js';
const id = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
afterEach(() => {
  vi.restoreAllMocks();
});
function fixture(mode = 'normal') {
  const tables = Array.from({ length: 1001 }, (_, i) => ({ id: id(i + 1) }));
  const sources = Array.from({ length: 334 }, (_, i) => id(i + 2000));
  const seats = sources.flatMap((table_id, i) =>
    Array.from({ length: 3 }, (_, j) => ({ id: id(10000 + i * 3 + j), table_id }))
  );
  let current = true;
  const requests: any[] = [];
  vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
    const request: any = { table, limit: 1000, cursor: null, ids: null, head: false };
    requests.push(request);
    const q: any = {};
    for (const name of ['eq', 'is', 'or', 'neq']) q[name] = () => q;
    q.select = (_fields: string, opts?: any) => {
      request.head = opts?.head === true;
      return q;
    };
    q.in = (field: string, ids: string[]) => {
      if (field === 'table_id') request.ids = ids;
      return q;
    };
    q.order = () => q;
    q.limit = (limit: number) => {
      request.limit = limit;
      return q;
    };
    q.gt = (_key: string, cursor: string) => {
      request.cursor = cursor;
      return q;
    };
    q.then = (ok: any, fail: any) =>
      Promise.resolve()
        .then(() => {
          if (mode === 'withdraw') current = false;
          if (mode === 'later-error' && (request.cursor || requests.length > 1))
            return { data: null, count: null, error: { message: 'unavailable' } };
          let rows =
            table === 'tables' ? tables : seats.filter((r) => request.ids?.includes(r.table_id));
          if (request.cursor) rows = rows.filter((r) => r.id > request.cursor);
          const count =
            mode === 'missing-count'
              ? null
              : mode === 'false-count'
                ? false
                : mode === 'negative-count'
                  ? -1
                  : mode === 'fractional-count'
                    ? 1.5
                    : mode === 'string-count'
                      ? '3'
                      : rows.length;
          return { data: request.head ? null : rows.slice(0, request.limit), count, error: null };
        })
        .then(ok, fail);
    return q;
  }) as any);
  const manager: any = Object.create(TournamentManager.prototype);
  manager.tournamentId = id(9999);
  manager.eliminationMutationAllowed = () => current;
  manager.captureLifecycleToken = () => ({});
  manager.lifecycleIsCurrent = () => current;
  manager.loadBalancerTables = vi.fn(async (ids: string[]) => ids.map((tableId) => ({ tableId })));
  manager.durableTournamentBreaks = new Map(
    sources.map((source_table_id, i) => [
      id(i),
      { state: 'park_requested', members: [], source_table_id },
    ])
  );
  return {
    manager,
    requests,
    withdraw: () => {
      current = false;
    },
  };
}
describe('break planning requires the complete field', () => {
  it('does not return a destination board after its lifecycle is withdrawn', async () => {
    const { manager, withdraw } = fixture();
    manager.loadBalancerTables.mockImplementation(async () => {
      withdraw();
      return [{ tableId: id(2) }];
    });
    expect(await manager.eligibleBreakDestinations(id(1), 'break')).toBeNull();
  });
  it('returns a proven zero without querying when no parks await placement', async () => {
    const { manager, requests } = fixture();
    manager.durableTournamentBreaks.clear();
    expect(await manager.unbegunBreakDemand()).toBe(0);
    expect(requests).toHaveLength(0);
  });
  it('counts each source only once if two retained records name it', async () => {
    const { manager } = fixture();
    manager.durableTournamentBreaks.set(
      id(99999),
      [...manager.durableTournamentBreaks.values()][0]
    );
    expect(await manager.unbegunBreakDemand()).toBe(1002);
  });

  it('passes every eligible destination beyond the REST ceiling', async () => {
    const { manager } = fixture();
    const result = await manager.eligibleBreakDestinations(id(1), 'break');
    expect(result).toHaveLength(1000);
    expect(result.at(-1).tableId).toBe(id(1001));
  });
  it('does not load a balancer snapshot after a later destination read failure', async () => {
    const { manager } = fixture('later-error');
    expect(await manager.eligibleBreakDestinations(id(1), 'break')).toBeNull();
    expect(manager.loadBalancerTables).not.toHaveBeenCalled();
  });
  it('counts all1002 parked players through bounded filters', async () => {
    const { manager, requests } = fixture();
    expect(await manager.unbegunBreakDemand()).toBe(1002);
    expect(requests.every((r) => r.ids.length <= 200)).toBe(true);
  });
  it.each([
    'later-error',
    'missing-count',
    'false-count',
    'negative-count',
    'fractional-count',
    'string-count',
    'withdraw',
  ])('preserves unknown parked demand on %s', async (mode) => {
    const { manager } = fixture(mode);
    expect(await manager.unbegunBreakDemand()).toBeNull();
  });
});
