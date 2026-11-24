import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  wakeCluster: vi.fn(),
  atomicCashout: vi.fn(async () => ({ ok: true })),
}));

vi.mock('../cluster/ClusterController.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../cluster/ClusterController.js')>();
  return {
    ...actual,
    wakeCluster: mocks.wakeCluster,
  };
});

vi.mock('../services/supabase.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/supabase.js')>();
  return {
    ...actual,
    atomicCashout: mocks.atomicCashout,
  };
});

vi.mock('../services/errorReporter.js', () => ({ reportError: vi.fn() }));

import { ServerTableEngine } from './ServerTableEngine.js';

function makeEngine(tableInfo: Record<string, unknown> = { cluster_id: 'game-1' }) {
  const engine = Object.create(ServerTableEngine.prototype) as any;
  engine.tableId = 'table-main-2';
  engine.tableInfo = tableInfo;
  engine.terminal = false;
  engine.isTournamentTable = vi.fn(() => false);
  engine.lifecycleCanMutate = vi.fn(() => true);
  engine.acquireSeatBoundary = vi.fn(async () => () => {});
  engine.isBlindedOff = vi.fn(() => false);
  engine.handController = { getState: () => null };
  engine.seatedPlayers = [
    { user_id: 'u1', occupancy_id: 'occ-1', seat_number: 2, stack: 100 },
    { user_id: 'u2', occupancy_id: 'occ-2', seat_number: 5, stack: 200 },
  ];
  engine.disconnectEngine = {
    tickSitOutsAndCollectEvictions: vi.fn((_tid: string, ids: string[]) =>
      ids.includes('u1') ? ['u1'] : []
    ),
    collectAwayBlindEvictions: vi.fn(() => []),
    collectAbandonedSeatEvictions: vi.fn(() => []),
    unregisterPlayer: vi.fn(),
  };
  engine.nitGameTracker = null;
  engine.chipContinuity = {
    row: vi.fn(() => ({})),
    leaveLock: vi.fn(() => ({ locked: false, handsRemaining: 0 })),
    forget: vi.fn(),
  };
  engine.hub = { emitEvent: vi.fn() };
  engine.forgetTimeBank = vi.fn();
  engine.straddleEngine = { removePlayer: vi.fn() };
  engine.preActionEngine = { removePlayer: vi.fn() };
  engine.leaveHeldByClock = new Map();
  return engine;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Immediate cluster wake on seat moves and seat-vacating exits', () => {
  it('wakeClusterGame passes { now: true } for seat_left and seat_move, and { now: false } for hand_complete', () => {
    const engine = makeEngine({ cluster_id: 'game-ladder' });
    engine.wakeClusterGame('seat_left');
    engine.wakeClusterGame('seat_move');
    engine.wakeClusterGame('hand_complete');
    engine.wakeClusterGame('seat_change');

    expect(mocks.wakeCluster).toHaveBeenNthCalledWith(1, 'game-ladder', { now: true });
    expect(mocks.wakeCluster).toHaveBeenNthCalledWith(2, 'game-ladder', { now: true });
    expect(mocks.wakeCluster).toHaveBeenNthCalledWith(3, 'game-ladder', { now: false });
    expect(mocks.wakeCluster).toHaveBeenNthCalledWith(4, 'game-ladder', { now: false });
  });

  it('wakeClusterGame is a no-op for tournaments and non-cluster tables', () => {
    const noCluster = makeEngine({ cluster_id: null });
    noCluster.wakeClusterGame('seat_move');
    const tourney = makeEngine({ cluster_id: 'game-ladder' });
    tourney.isTournamentTable = vi.fn(() => true);
    tourney.wakeClusterGame('seat_left');

    expect(mocks.wakeCluster).not.toHaveBeenCalled();
  });

  it('evictExpiredSitOuts wakes the cluster immediately with seat_left when a cash seat is evicted', async () => {
    const engine = makeEngine({ cluster_id: 'game-ladder' });
    await engine.evictExpiredSitOuts({ countOrbit: false });

    expect(mocks.atomicCashout).toHaveBeenCalledTimes(1);
    expect(mocks.wakeCluster).toHaveBeenCalledTimes(1);
    expect(mocks.wakeCluster).toHaveBeenCalledWith('game-ladder', { now: true });
    expect(engine.seatedPlayers.map((p: any) => p.user_id)).toEqual(['u2']);
  });

  it('evictExpiredSitOuts does not wake the cluster when no player is evicted', async () => {
    const engine = makeEngine({ cluster_id: 'game-ladder' });
    engine.disconnectEngine.tickSitOutsAndCollectEvictions = vi.fn(() => []);
    await engine.evictExpiredSitOuts({ countOrbit: false });

    expect(mocks.atomicCashout).not.toHaveBeenCalled();
    expect(mocks.wakeCluster).not.toHaveBeenCalled();
  });

  it('settlement wakes the cluster immediately on leave_pending cash-outs and non-deferred bankTheWinExit', () => {
    const settlement = readFileSync(join(__dirname, 'ServerTableEngineSettlement.ts'), 'utf8');
    expect(settlement).toMatch(
      /this\.tearDownDepartedSeats\(cashedOutIds\);\s*if \(cashedOutIds\.length > 0\) this\.wakeClusterGame\('seat_left'\);/
    );
    expect(settlement).toMatch(
      /const outcome = await this\.bankTheWinExit\(horse\);\s*if \(outcome === 'stop'\) return;\s*if \(outcome === 'left'\) this\.wakeClusterGame\('seat_left'\);/
    );
  });
});
