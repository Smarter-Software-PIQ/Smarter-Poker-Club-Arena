/**
 * A RETAINED HAND THAT NEVER STARTED DOES NOT FREEZE THE SATELLITE (2026-11-05).
 *
 * Sunday Deep Stack Satellite 25 (fbb86b2a): table aed78e3f retained the
 * sequence-zero original of hand 55430351 (no card dealt, no chip moved) at
 * 18:29Z, the instant a bust raised the cohort satellite's qualifier
 * boundary. The boundary waited for every table to park EMPTY; the prepared
 * original waited at that same gate for the boundary to lift. 40 players and
 * five tables dealt nothing, through two successor generations that each
 * replayed the original into the same wait.
 *
 * Pinned here: a table holding exactly that shape counts as parked for the
 * boundary, so a continuing field releases it and a qualifying field settles
 * over it (2026-11-06: the hand never started, so the field it would have
 * been dealt to has already finished; the committed cleanup stops its dealer
 * with the hand still held). Anything else - a started hand, an unresolved
 * field, a held original that changed - keeps the boundary exactly as before.
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
// Nine players for eight tickets: inside the bubble margin, so the boundary
// walks every table through the two-phase park (2026-11-07: a field more
// than one player above its tickets is released on the first read instead,
// see aBoundaryTheAuthorityDoesNotNeedIsNotHeld.law.test.ts).
const CONTINUING = {
  state: 'continuing',
  fullTicketCount: 8,
  qualifierIds: Array.from({ length: 9 }, (_, i) => id(100 + i)),
};

function table(opts: { parks: boolean; heldOriginal: boolean }) {
  const state = { held: opts.heldOriginal };
  return {
    state,
    isRunning: () => true,
    parkForTerminalCloseout: vi.fn(async () => opts.parks),
    isPreparedOriginalHeldAtTerminalCloseout: vi.fn(() => state.held),
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
  rpc.read.mockResolvedValue(CONTINUING);
  return { m, parked };
}

afterEach(() => {
  vi.restoreAllMocks();
  rpc.read.mockReset();
  rpc.settle.mockReset();
  rpc.report.mockReset();
});

describe('a retained prepared original held at the qualifier boundary', () => {
  it('the 18:29 shape: a continuing field releases every table, the held one included', async () => {
    const held = table({ parks: false, heldOriginal: true });
    const { m, parked } = heldBoundary(held);
    const answer = await m.checkSatelliteQualifierCompletion();
    expect(answer).not.toBe('pending');
    expect(m.satelliteQualifierBoundaryPending).toBe(false);
    expect(held.releaseTerminalCloseoutPause).toHaveBeenCalledOnce();
    expect(parked.releaseTerminalCloseoutPause).toHaveBeenCalledOnce();
    expect(rpc.settle).not.toHaveBeenCalled();
  });

  it('a table that is neither parked nor a held prepared original keeps the boundary', async () => {
    const held = table({ parks: false, heldOriginal: false });
    const { m, parked } = heldBoundary(held);
    expect(await m.checkSatelliteQualifierCompletion()).toBe('pending');
    expect(m.satelliteQualifierBoundaryPending).toBe(true);
    expect(rpc.read).toHaveBeenCalledTimes(1);
    expect(parked.releaseTerminalCloseoutPause).not.toHaveBeenCalled();
  });

  it('a qualifying field whose held original changed before settlement never settles', async () => {
    const held = table({ parks: false, heldOriginal: true });
    const { m } = heldBoundary(held);
    const QUALIFYING = {
      state: 'qualifying',
      fullTicketCount: 8,
      qualifierIds: Array.from({ length: 8 }, (_, i) => id(100 + i)),
    };
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

  it('an unresolved field at its tickets keeps the boundary', async () => {
    const held = table({ parks: false, heldOriginal: true });
    const { m } = heldBoundary(held);
    rpc.read.mockResolvedValue({ ...CONTINUING, state: 'unresolved' });
    expect(await m.checkSatelliteQualifierCompletion()).toBe('pending');
    expect(m.satelliteQualifierBoundaryPending).toBe(true);
  });

  it('a held original that changes between the park and the second read keeps the boundary', async () => {
    const held = table({ parks: false, heldOriginal: true });
    const { m } = heldBoundary(held);
    rpc.read.mockImplementationOnce(async () => CONTINUING);
    rpc.read.mockImplementationOnce(async () => {
      held.state.held = false;
      return CONTINUING;
    });
    expect(await m.checkSatelliteQualifierCompletion()).toBe('pending');
    expect(m.satelliteQualifierBoundaryPending).toBe(true);
    expect(held.releaseTerminalCloseoutPause).not.toHaveBeenCalled();
  });
});
