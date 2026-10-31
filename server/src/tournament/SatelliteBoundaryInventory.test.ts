import { afterEach, describe, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => ({ read: vi.fn(), settle: vi.fn() }));
vi.mock('./satelliteQualifierRpc.js', () => ({
  readSatelliteQualifierState: rpc.read,
  requestSatelliteQualifierReceipt: rpc.settle,
}));
vi.mock('../maintenance/freezeState.js', () => ({ isMaintenanceFrozen: () => false }));
vi.mock('../services/errorReporter.js', () => ({ reportError: vi.fn(), describeError: String }));
import { TournamentManager } from './TournamentManager.js';
import { supabase } from '../services/supabase.js';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function fixture(failLater = false, withdraw = false) {
  const m: any = new TournamentManager(id(9999), {} as any, id(9998), performance.now() + 60000);
  m.running = true;
  m.isRunning = () => true;
  m.isCohortSatellite = () => true;
  m.eliminationMutationAllowed = () => true;
  m.satelliteQualifierBoundaryPending = true;
  m.satelliteQualifierBoundaryGeneration = 4;
  m.cleanupCommittedSatelliteQualifiers = vi.fn(async () => true);
  m.requestUrgentEliminationSweepAfter = vi.fn();
  const rows = Array.from({ length: 1001 }, (_, n) => ({ id: id(n + 1) })); // window-ok: simulate the real 1000-row REST ceiling.
  const dealers = rows.map(() => ({
    isRunning: () => true,
    parkForTerminalCloseout: vi.fn(async () => true),
  }));
  rows.forEach((r, i) => m.tableEngines.set(r.id, dealers[i]));
  m.gameServer.getTableEngine = (key: string) => m.tableEngines.get(key);
  rpc.read.mockResolvedValue({
    state: 'qualifying',
    fullTicketCount: 2,
    qualifierIds: [id(2001), id(2002)],
  });
  rpc.settle.mockResolvedValue({});
  const pages: string[] = [];
  vi.spyOn(supabase, 'from').mockImplementation(() => {
    let cursor = '',
      limit = 1000;
    const q: any = {
      select: () => q,
      eq: () => q,
      in: () => q,
      order: () => q,
      gt: (_key: string, value: string) => {
        cursor = value;
        return q;
      },
      limit: (n: number) => {
        limit = n;
        return q;
      },
      then: (resolve: any, reject: any) => {
        pages.push(cursor);
        if (withdraw && cursor) m.satelliteQualifierBoundaryGeneration++;
        return Promise.resolve(
          failLater && cursor
            ? { data: null, error: { message: 'later page unavailable' } }
            : { data: rows.filter((r) => r.id > cursor).slice(0, limit), error: null }
        ).then(resolve, reject);
      },
    };
    return q;
  });
  return { m, dealers, pages };
}
afterEach(() => {
  vi.restoreAllMocks();
  rpc.read.mockReset();
  rpc.settle.mockReset();
});
describe('satellite qualification owns the complete physical field', () => {
  it('parks table 1001 before attempting settlement', async () => {
    const f = fixture();
    expect(await f.m.checkSatelliteQualifierCompletion()).toBe('complete');
    expect(f.dealers[1000].parkForTerminalCloseout).toHaveBeenCalledOnce();
    expect(rpc.settle).toHaveBeenCalledOnce();
  });
  it('does not certify the first page when a later page is unavailable', async () => {
    const f = fixture(true);
    expect(await f.m.checkSatelliteQualifierCompletion()).toBe('pending');
    expect(rpc.settle).not.toHaveBeenCalled();
    expect(f.dealers.every((d) => d.parkForTerminalCloseout.mock.calls.length === 0)).toBe(true);
  });
  it('retains the boundary when its generation changes during paging', async () => {
    const f = fixture(false, true);
    expect(await f.m.checkSatelliteQualifierCompletion()).toBe('pending');
    expect(rpc.settle).not.toHaveBeenCalled();
    expect(f.dealers.every((d) => d.parkForTerminalCloseout.mock.calls.length === 0)).toBe(true);
  });
});
