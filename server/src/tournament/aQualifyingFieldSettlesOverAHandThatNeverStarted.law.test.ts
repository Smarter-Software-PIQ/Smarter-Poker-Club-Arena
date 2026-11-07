/**
 * A QUALIFYING FIELD SETTLES OVER A HAND THAT NEVER STARTED (2026-11-06).
 *
 * #9560 let a continuing field release a retained, never-started original
 * held at the satellite qualifier boundary, but a QUALIFYING field still
 * answered 'pending' over it on every sweep. The table holds that original
 * for exactly as long as the boundary does (the boundary forbids starting
 * it), and a rebuild replays the same original into the same wait, so a
 * satellite whose winners were already decided froze for good.
 *
 * Pinned here: with every held original still proven unstarted after the
 * second read, a qualifying field settles its qualifiers; the boundary is
 * never released (the held hand never starts), and the committed cleanup is
 * what stops its dealer.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => ({ read: vi.fn(), settle: vi.fn(), report: vi.fn() }));
vi.mock('./satelliteQualifierRpc.js', () => ({
  readSatelliteQualifierState: rpc.read,
  requestSatelliteQualifierReceipt: rpc.settle,
}));
vi.mock('../services/errorReporter.js', () => ({
  reportError: rpc.report,
  describeError: (value: unknown) => String(value),
}));

import { TournamentManager } from './TournamentManager.js';
import { supabase } from '../services/supabase.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const EVENT = id(1);
const HELD = id(3);
const PARKED = id(4);
const QUALIFYING = {
  state: 'qualifying',
  fullTicketCount: 8,
  qualifierIds: Array.from({ length: 8 }, (_, i) => id(100 + i)),
};

function table(opts: { parks: boolean; heldOriginal: boolean }) {
  const state = { held: opts.heldOriginal };
  return {
    state,
    isRunning: () => true,
    parkForTerminalCloseout: vi.fn(async () => opts.parks),
    isPreparedOriginalHeldAtTerminalCloseout: vi.fn(() => state.held),
    getF06RetainedPermit: () => ({ binding: { permit_id: id(5), hand_number: '1' } }),
    releaseTerminalCloseoutPause: vi.fn(),
  };
}

function heldBoundary(held: ReturnType<typeof table>) {
  const m: any = new TournamentManager(EVENT, {} as any, id(9), performance.now() + 60000);
  m.running = true;
  m.eliminationSweepDeadlineAt = 0;
  m.requestUrgentEliminationSweepAfter = vi.fn();
  m.isCohortSatellite = () => true;
  m.isRunning = () => true;
  m.eliminationMutationAllowed = () => true;
  m.advanceHandForHandBarrier = vi.fn();
  const parked = table({ parks: true, heldOriginal: false });
  m.tableEngines.set(HELD, held);
  m.tableEngines.set(PARKED, parked);
  m.gameServer.getTableEngine = (tableId: string) => m.tableEngines.get(tableId);
  m.satelliteQualifierBoundaryPending = true;
  m.satelliteQualifierBoundaryGeneration = 4;
  for (const [tableId, engine] of m.tableEngines) m.satelliteQualifierEngines.set(tableId, engine);
  const query: any = {
    select: () => query,
    eq: () => query,
    in: () => query,
    order: () => query,
    limit: () => query,
    gt: () => query,
    then: (resolve: any, reject: any) =>
      Promise.resolve({ data: [{ id: HELD }, { id: PARKED }], error: null }).then(resolve, reject),
  };
  vi.spyOn(supabase, 'from').mockReturnValue(query);
  rpc.read.mockResolvedValue(QUALIFYING);
  return { m, parked };
}

afterEach(() => {
  vi.restoreAllMocks();
  rpc.read.mockReset();
  rpc.settle.mockReset();
  rpc.report.mockReset();
});

describe('a qualifying field over a retained original that never started', () => {
  it('settles its qualifiers, and the held hand is never released to start', async () => {
    const held = table({ parks: false, heldOriginal: true });
    const { m, parked } = heldBoundary(held);
    const receipt = { tournamentId: EVENT, qualifierIds: QUALIFYING.qualifierIds };
    rpc.settle.mockResolvedValue(receipt);
    m.cleanupCommittedSatelliteQualifiers = vi.fn(async () => true);
    expect(await m.checkSatelliteQualifierCompletion()).toBe('complete');
    expect(rpc.settle).toHaveBeenCalledWith(EVENT, QUALIFYING.qualifierIds);
    expect(m.cleanupCommittedSatelliteQualifiers).toHaveBeenCalledWith(receipt);
    // The boundary keeps holding the original through settlement and cleanup.
    expect(held.releaseTerminalCloseoutPause).not.toHaveBeenCalled();
    expect(parked.releaseTerminalCloseoutPause).not.toHaveBeenCalled();
    // The held original was proven unstarted on the second read too.
    expect(held.isPreparedOriginalHeldAtTerminalCloseout.mock.calls.length).toBeGreaterThan(1);
  });

  it('a held original that started (or lost its gate) by the second read keeps the boundary', async () => {
    const held = table({ parks: false, heldOriginal: true });
    const { m } = heldBoundary(held);
    rpc.read.mockImplementationOnce(async () => QUALIFYING);
    rpc.read.mockImplementationOnce(async () => {
      held.state.held = false;
      return QUALIFYING;
    });
    expect(await m.checkSatelliteQualifierCompletion()).toBe('pending');
    expect(rpc.settle).not.toHaveBeenCalled();
    expect(m.tournamentFinished).toBe(false);
    expect(m.satelliteQualifierBoundaryPending).toBe(true);
  });

  it('a table that is neither parked nor a held unstarted original never settles', async () => {
    const held = table({ parks: false, heldOriginal: false });
    const { m } = heldBoundary(held);
    expect(await m.checkSatelliteQualifierCompletion()).toBe('pending');
    expect(rpc.settle).not.toHaveBeenCalled();
    expect(m.satelliteQualifierBoundaryPending).toBe(true);
  });
});

describe('an entry-open field over a retained original that never started', () => {
  /*
   * 2026-11-07: an entry-open answer lifts the boundary on the FIRST read,
   * before any table is asked to park (satelliteBoundaryIsUnneeded). The
   * held original is released with every other dealer; there is no second
   * read for a field the authority says cannot be decided yet.
   */
  it('releases the original boundary on the first authoritative read without settlement', async () => {
    const held = table({ parks: false, heldOriginal: true });
    const { m, parked } = heldBoundary(held);
    rpc.read.mockResolvedValue({ state: 'entry_open' });
    expect(await m.checkSatelliteQualifierCompletion()).toBe('continue');
    expect(rpc.read).toHaveBeenCalledTimes(1);
    expect(m.satelliteQualifierBoundaryPending).toBe(false);
    expect(held.releaseTerminalCloseoutPause).toHaveBeenCalledTimes(1);
    expect(parked.releaseTerminalCloseoutPause).toHaveBeenCalledTimes(1);
    expect(m.advanceHandForHandBarrier).toHaveBeenCalledTimes(1);
    expect(rpc.settle).not.toHaveBeenCalled();
    expect(m.tournamentFinished).toBe(false);
    // No table was asked to park for a boundary the authority does not need.
    expect(held.parkForTerminalCloseout).not.toHaveBeenCalled();
    expect(parked.parkForTerminalCloseout).not.toHaveBeenCalled();
  });

  it('a boundary held again during the read is kept for its own generation', async () => {
    const held = table({ parks: false, heldOriginal: true });
    const { m, parked } = heldBoundary(held);
    rpc.read.mockImplementationOnce(async () => {
      m.satelliteQualifierBoundaryGeneration += 1;
      return { state: 'entry_open' };
    });
    expect(await m.checkSatelliteQualifierCompletion()).toBe('pending');
    expect(m.satelliteQualifierBoundaryPending).toBe(true);
    expect(held.releaseTerminalCloseoutPause).not.toHaveBeenCalled();
    expect(parked.releaseTerminalCloseoutPause).not.toHaveBeenCalled();
    expect(rpc.settle).not.toHaveBeenCalled();
  });

  it('an unresolved answer at the tickets keeps the boundary', async () => {
    const held = table({ parks: false, heldOriginal: true });
    const { m, parked } = heldBoundary(held);
    rpc.read.mockResolvedValue({
      state: 'unresolved',
      fullTicketCount: 8,
      qualifierIds: Array.from({ length: 9 }, (_, i) => id(100 + i)),
    });
    expect(await m.checkSatelliteQualifierCompletion()).toBe('pending');
    expect(m.satelliteQualifierBoundaryPending).toBe(true);
    expect(held.releaseTerminalCloseoutPause).not.toHaveBeenCalled();
    expect(parked.releaseTerminalCloseoutPause).not.toHaveBeenCalled();
    expect(rpc.settle).not.toHaveBeenCalled();
  });
});
