/**
 * A BOUNDARY THE AUTHORITY DOES NOT NEED IS NOT HELD (2026-11-07).
 *
 * Sunday Deep Stack Satellite 30 (cc250e58): 47 players, late registration
 * open, every table parked behind the qualifier boundary from 02:34:56Z to
 * 04:05:39Z. fn_get_satellite_qualifier_state answered entry_open on every
 * sweep - no ticket can be decided while the prize pool is not finalized -
 * and the sweep still walked every table through the two-phase park, where
 * one table held a retained original that the boundary itself forbade
 * starting. Ninety minutes, until the hourly break freed it. Satellite 25
 * (2026-11-05), the break-source freeze (2026-10-12) and the settlement-
 * exclusion freeze (2026-09-28) were the same shape with a different step
 * answering 'pending' forever.
 *
 * The laws pinned here:
 *
 *  1. An entry-open answer, or a continuing/unresolved answer with the live
 *     field more than SATELLITE_BUBBLE_MARGIN above the tickets, lifts the
 *     boundary on the FIRST read, before any table is asked to park, whatever
 *     the dealers are doing (held original, stopped dealer, missing dealer).
 *  2. A field at or inside the margin keeps the two-phase park, the dealer
 *     proofs and the settlement exactly as before; an unresolved answer there
 *     keeps the boundary held.
 *  3. A release is never refused for a dealer the boundary no longer owns:
 *     the fence is lifted from every running dealer this manager owns, and
 *     the boundary is cleared. Only a moved generation refuses.
 *  4. A boundary held past SATELLITE_BOUNDARY_PAGE_AFTER_MS without a
 *     decision pages one critical alert per event naming the pending reason,
 *     refreshed on a changed reason or after SATELLITE_BOUNDARY_PAGE_EVERY_MS,
 *     never during a maintenance freeze, and never for a boundary that has
 *     been released.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => ({ read: vi.fn(), settle: vi.fn(), report: vi.fn() }));
const alerts = vi.hoisted(() => ({
  raise: vi.fn(async (..._args: unknown[]) => ({ persisted: true, alertId: 'a1' })),
}));
const freeze = vi.hoisted(() => ({ frozen: false }));
vi.mock('./satelliteQualifierRpc.js', () => ({
  readSatelliteQualifierState: rpc.read,
  requestSatelliteQualifierReceipt: rpc.settle,
}));
vi.mock('../services/errorReporter.js', () => ({
  reportError: rpc.report,
  reportWarning: vi.fn(),
  describeError: (value: unknown) => String(value),
}));
vi.mock('../services/financialAlerts.js', () => ({ raiseFinancialAlert: alerts.raise }));
vi.mock('../maintenance/freezeState.js', () => ({
  isMaintenanceFrozen: () => freeze.frozen,
  onMaintenanceThaw: () => () => {},
}));

import { TournamentManager } from './TournamentManager.js';
import { TournamentManagerBase } from './TournamentManagerBase.js';
import { supabase } from '../services/supabase.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const EVENT = id(1);
const HELD = id(3);
const PARKED = id(4);
const STOPPED = id(5);
const NO_DEALER = id(6);
const field = (n: number) => Array.from({ length: n }, (_, i) => id(100 + i));
const answer = (state: 'continuing' | 'unresolved', live: number, tickets: number) => ({
  state,
  fullTicketCount: tickets,
  qualifierIds: field(live),
});

function table(opts: { parks: boolean; heldOriginal: boolean; running?: boolean }) {
  const state = { held: opts.heldOriginal };
  return {
    state,
    isRunning: () => opts.running ?? true,
    parkForTerminalCloseout: vi.fn(async () => opts.parks),
    isPreparedOriginalHeldAtTerminalCloseout: vi.fn(() => state.held),
    getF06RetainedPermit: () => ({ binding: { permit_id: id(5), hand_number: '1' } }),
    releaseTerminalCloseoutPause: vi.fn(),
  };
}

function satellite(rows: string[] = [HELD, PARKED]) {
  const m: any = new TournamentManager(EVENT, {} as any, id(9), performance.now() + 60000);
  m.running = true;
  m.eliminationSweepDeadlineAt = 0;
  m.requestUrgentEliminationSweepAfter = vi.fn();
  m.isCohortSatellite = () => true;
  m.isRunning = () => true;
  m.eliminationMutationAllowed = () => true;
  m.advanceHandForHandBarrier = vi.fn();
  m.declareConsolidationOutstanding = vi.fn();
  m.checkDynamicTableExpansion = vi.fn(async () => undefined);
  m.gameServer.getTableEngine = (tableId: string) => m.tableEngines.get(tableId);
  const query: any = {
    select: () => query,
    eq: () => query,
    in: () => query,
    order: () => query,
    limit: () => query,
    gt: () => query,
    then: (resolve: any, reject: any) =>
      Promise.resolve({ data: rows.map((row) => ({ id: row })), error: null }).then(
        resolve,
        reject
      ),
  };
  vi.spyOn(supabase, 'from').mockReturnValue(query);
  return m;
}

/** Satellite 30's shape: a held original, a parked table, and the boundary held. */
function satelliteThirty(extra: { stoppedDealer?: boolean; missingDealer?: boolean } = {}) {
  const rows = [HELD, PARKED];
  if (extra.stoppedDealer) rows.push(STOPPED);
  if (extra.missingDealer) rows.push(NO_DEALER);
  const m = satellite(rows);
  const held = table({ parks: false, heldOriginal: true });
  const parked = table({ parks: true, heldOriginal: false });
  m.tableEngines.set(HELD, held);
  m.tableEngines.set(PARKED, parked);
  const stopped = table({ parks: false, heldOriginal: false, running: false });
  if (extra.stoppedDealer) m.tableEngines.set(STOPPED, stopped);
  m.satelliteQualifierBoundaryPending = true;
  m.satelliteQualifierBoundaryGeneration = 4;
  m.satelliteQualifierBoundaryHeldSinceMs = Date.now();
  for (const [tableId, engine] of m.tableEngines) m.satelliteQualifierEngines.set(tableId, engine);
  return { m, held, parked, stopped };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  rpc.read.mockReset();
  rpc.settle.mockReset();
  rpc.report.mockReset();
  alerts.raise.mockClear();
  freeze.frozen = false;
});

describe('law 1: the authority, not the park, lifts a boundary it does not need', () => {
  it('Satellite 30: entry open over a held original lifts on the first read, before any park', async () => {
    const { m, held, parked } = satelliteThirty();
    rpc.read.mockResolvedValue({ state: 'entry_open' });
    expect(await m.checkSatelliteQualifierCompletion()).toBe('continue');
    expect(rpc.read).toHaveBeenCalledTimes(1);
    expect(m.satelliteQualifierBoundaryPending).toBe(false);
    expect(m.satelliteQualifierBoundaryHeldSinceMs).toBe(0);
    expect(held.parkForTerminalCloseout).not.toHaveBeenCalled();
    expect(parked.parkForTerminalCloseout).not.toHaveBeenCalled();
    expect(held.releaseTerminalCloseoutPause).toHaveBeenCalledTimes(1);
    expect(parked.releaseTerminalCloseoutPause).toHaveBeenCalledTimes(1);
    expect(m.advanceHandForHandBarrier).toHaveBeenCalledTimes(1);
    expect(rpc.settle).not.toHaveBeenCalled();
    expect(m.tournamentFinished).toBe(false);
  });

  it('entry open with a stopped dealer that nobody replaced still lifts every other dealer', async () => {
    const { m, held, parked, stopped } = satelliteThirty({ stoppedDealer: true });
    rpc.read.mockResolvedValue({ state: 'entry_open' });
    expect(await m.checkSatelliteQualifierCompletion()).toBe('continue');
    expect(m.satelliteQualifierBoundaryPending).toBe(false);
    expect(held.releaseTerminalCloseoutPause).toHaveBeenCalledTimes(1);
    expect(parked.releaseTerminalCloseoutPause).toHaveBeenCalledTimes(1);
    // A stopped dealer has nothing to lift and is left to its recovery owner.
    expect(stopped.releaseTerminalCloseoutPause).not.toHaveBeenCalled();
  });

  it('a continuing field far from its tickets lifts on the first read, with a table that has no dealer at all', async () => {
    const { m, held, parked } = satelliteThirty({ missingDealer: true });
    rpc.read.mockResolvedValue(answer('continuing', 47, 5));
    expect(await m.checkSatelliteQualifierCompletion()).toBe('continue');
    expect(rpc.read).toHaveBeenCalledTimes(1);
    expect(m.satelliteQualifierBoundaryPending).toBe(false);
    expect(held.releaseTerminalCloseoutPause).toHaveBeenCalledTimes(1);
    expect(parked.releaseTerminalCloseoutPause).toHaveBeenCalledTimes(1);
    // The later expansion stage admits the dealer-less table; the boundary
    // no longer makes every sibling wait for it.
    expect(m.checkDynamicTableExpansion).not.toHaveBeenCalled();
  });

  it('an unresolved answer far from the tickets lifts the boundary and never re-holds it', async () => {
    const { m, held, parked } = satelliteThirty();
    rpc.read.mockResolvedValue(answer('unresolved', 40, 5));
    expect(await m.checkSatelliteQualifierCompletion()).toBe('continue');
    expect(m.satelliteQualifierBoundaryPending).toBe(false);
    expect(held.releaseTerminalCloseoutPause).toHaveBeenCalledTimes(1);
    expect(parked.releaseTerminalCloseoutPause).toHaveBeenCalledTimes(1);
    // And an unheld boundary is not armed by that answer either.
    expect(await m.checkSatelliteQualifierCompletion()).toBe('continue');
    expect(m.satelliteQualifierBoundaryPending).toBe(false);
  });

  it('the margin is exactly one player: a field one above its tickets is not far', () => {
    const m = satellite();
    const margin = TournamentManagerBase.SATELLITE_BUBBLE_MARGIN;
    expect(margin).toBe(1);
    expect(m.satelliteBoundaryIsUnneeded({ state: 'entry_open' })).toBe(true);
    expect(m.satelliteBoundaryIsUnneeded(answer('continuing', 8 + margin + 1, 8))).toBe(true);
    expect(m.satelliteBoundaryIsUnneeded(answer('continuing', 8 + margin, 8))).toBe(false);
    expect(m.satelliteBoundaryIsUnneeded(answer('unresolved', 8 + margin + 1, 8))).toBe(true);
    expect(m.satelliteBoundaryIsUnneeded(answer('unresolved', 8 + margin, 8))).toBe(false);
    expect(m.satelliteBoundaryIsUnneeded(answer('unresolved', 0, 8))).toBe(false);
    expect(
      m.satelliteBoundaryIsUnneeded({
        state: 'qualifying',
        fullTicketCount: 8,
        qualifierIds: field(8),
      })
    ).toBe(false);
  });

  it('a boundary held again during the read is kept for its own generation', async () => {
    const { m, held } = satelliteThirty();
    rpc.read.mockImplementationOnce(async () => {
      m.satelliteQualifierBoundaryGeneration += 1;
      return { state: 'entry_open' };
    });
    expect(await m.checkSatelliteQualifierCompletion()).toBe('pending');
    expect(m.satelliteQualifierBoundaryPending).toBe(true);
    expect(held.releaseTerminalCloseoutPause).not.toHaveBeenCalled();
  });
});

describe('law 2: a field at its tickets keeps every proof', () => {
  it('a continuing field inside the margin still parks every table and reads twice', async () => {
    const { m, held, parked } = satelliteThirty();
    held.state.held = false;
    held.parkForTerminalCloseout = vi.fn(async () => true);
    rpc.read.mockResolvedValue(answer('continuing', 9, 8));
    expect(await m.checkSatelliteQualifierCompletion()).toBe('continue');
    expect(rpc.read).toHaveBeenCalledTimes(2);
    expect(held.parkForTerminalCloseout).toHaveBeenCalledWith(0);
    expect(parked.parkForTerminalCloseout).toHaveBeenCalledWith(0);
    expect(m.satelliteQualifierBoundaryPending).toBe(false);
  });

  it('an unresolved answer at the tickets keeps the boundary held', async () => {
    const { m, held, parked } = satelliteThirty();
    rpc.read.mockResolvedValue(answer('unresolved', 9, 8));
    expect(await m.checkSatelliteQualifierCompletion()).toBe('pending');
    expect(m.satelliteQualifierBoundaryPending).toBe(true);
    expect(held.releaseTerminalCloseoutPause).not.toHaveBeenCalled();
    expect(parked.releaseTerminalCloseoutPause).not.toHaveBeenCalled();
  });

  it('a hand still in flight at the tickets keeps the boundary and names itself', async () => {
    const { m } = satelliteThirty();
    m.tableEngines.get(HELD).state.held = false;
    rpc.read.mockResolvedValue(answer('continuing', 9, 8));
    expect(await m.checkSatelliteQualifierCompletion()).toBe('pending');
    expect(m.satelliteQualifierBoundaryPending).toBe(true);
    expect(m.satelliteQualifierBoundaryLastPendingReason).toBe(
      `table_${HELD.slice(0, 8)}_hand_in_flight`
    );
  });

  it('a qualifying field still settles through the payer, boundary held throughout', async () => {
    const { m, held, parked } = satelliteThirty();
    const qualifying = { state: 'qualifying', fullTicketCount: 8, qualifierIds: field(8) };
    rpc.read.mockResolvedValue(qualifying);
    const receipt = { tournamentId: EVENT, qualifierIds: qualifying.qualifierIds };
    rpc.settle.mockResolvedValue(receipt);
    m.cleanupCommittedSatelliteQualifiers = vi.fn(async () => true);
    expect(await m.checkSatelliteQualifierCompletion()).toBe('complete');
    expect(rpc.settle).toHaveBeenCalledWith(EVENT, qualifying.qualifierIds);
    expect(held.releaseTerminalCloseoutPause).not.toHaveBeenCalled();
    expect(parked.releaseTerminalCloseoutPause).not.toHaveBeenCalled();
  });
});

describe('law 3: a release is never refused for a dealer the boundary no longer owns', () => {
  it('a recorded dealer that stopped and was never replaced does not keep the field parked', () => {
    const { m, held, parked, stopped } = satelliteThirty({ stoppedDealer: true });
    expect(m.releaseSatelliteQualifierBoundary(4)).toBe(true);
    expect(m.satelliteQualifierBoundaryPending).toBe(false);
    expect(held.releaseTerminalCloseoutPause).toHaveBeenCalledTimes(1);
    expect(parked.releaseTerminalCloseoutPause).toHaveBeenCalledTimes(1);
    expect(stopped.releaseTerminalCloseoutPause).not.toHaveBeenCalled();
    expect(m.satelliteQualifierEngines.size).toBe(0);
    expect(m.advanceHandForHandBarrier).toHaveBeenCalledTimes(1);
  });

  it('a recorded dealer that was replaced lifts its replacement and leaves the stale one alone', () => {
    const { m, held, parked } = satelliteThirty();
    const replacement = table({ parks: true, heldOriginal: false });
    m.tableEngines.set(HELD, replacement);
    expect(m.releaseSatelliteQualifierBoundary(4)).toBe(true);
    expect(m.satelliteQualifierBoundaryPending).toBe(false);
    expect(replacement.releaseTerminalCloseoutPause).toHaveBeenCalledTimes(1);
    expect(parked.releaseTerminalCloseoutPause).toHaveBeenCalledTimes(1);
    expect(held.releaseTerminalCloseoutPause).not.toHaveBeenCalled();
  });

  it('a dealer this manager owns but never recorded is lifted too, once', () => {
    const { m, parked } = satelliteThirty();
    const late = table({ parks: true, heldOriginal: false });
    m.tableEngines.set(id(7), late);
    expect(m.releaseSatelliteQualifierBoundary(4)).toBe(true);
    expect(late.releaseTerminalCloseoutPause).toHaveBeenCalledTimes(1);
    expect(parked.releaseTerminalCloseoutPause).toHaveBeenCalledTimes(1);
  });

  it('only a moved generation or a stopped manager refuses', () => {
    const { m, held } = satelliteThirty();
    expect(m.releaseSatelliteQualifierBoundary(3)).toBe(false);
    expect(m.satelliteQualifierBoundaryPending).toBe(true);
    expect(held.releaseTerminalCloseoutPause).not.toHaveBeenCalled();
    m.isRunning = () => false;
    expect(m.releaseSatelliteQualifierBoundary(4)).toBe(false);
    expect(m.satelliteQualifierBoundaryPending).toBe(true);
  });

  it('a dealer whose release throws does not stop the others from being lifted', () => {
    const { m, held, parked } = satelliteThirty();
    held.releaseTerminalCloseoutPause = vi.fn(() => {
      throw new Error('fence already torn down');
    });
    expect(m.releaseSatelliteQualifierBoundary(4)).toBe(true);
    expect(parked.releaseTerminalCloseoutPause).toHaveBeenCalledTimes(1);
    expect(m.satelliteQualifierBoundaryPending).toBe(false);
    expect(rpc.report).toHaveBeenCalledWith(
      expect.any(Error),
      'Tournament.satellite_qualifier_boundary_release_failed',
      expect.objectContaining({ tableId: HELD })
    );
  });
});

describe('law 4: a held boundary that cannot decide pages its reason', () => {
  const AFTER = TournamentManagerBase.SATELLITE_BOUNDARY_PAGE_AFTER_MS;
  const EVERY = TournamentManagerBase.SATELLITE_BOUNDARY_PAGE_EVERY_MS;

  it('holding stamps the boundary once; a re-hold of a held boundary keeps the first stamp', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const m = satellite();
    m.tableEngines.set(PARKED, table({ parks: true, heldOriginal: false }));
    m.holdSatelliteQualifierBoundary();
    expect(m.satelliteQualifierBoundaryHeldSinceMs).toBe(1_000_000);
    vi.setSystemTime(1_030_000);
    m.holdSatelliteQualifierBoundary();
    expect(m.satelliteQualifierBoundaryHeldSinceMs).toBe(1_000_000);
    expect(m.satelliteBoundaryHeldMs(1_045_000)).toBe(45_000);
    m.releaseSatelliteQualifierBoundary(m.satelliteQualifierBoundaryGeneration);
    expect(m.satelliteBoundaryHeldMs(1_045_000)).toBe(0);
  });

  it('pages once past the bound, naming the reason; not before, and not again inside the interval', async () => {
    const { m } = satelliteThirty();
    const t0 = m.satelliteQualifierBoundaryHeldSinceMs;
    m.noteSatelliteBoundaryPending('table_00000000_dealer_stopped_or_replaced', t0 + AFTER - 1);
    expect(alerts.raise).not.toHaveBeenCalled();
    m.noteSatelliteBoundaryPending('table_00000000_dealer_stopped_or_replaced', t0 + AFTER);
    expect(alerts.raise).toHaveBeenCalledTimes(1);
    const [severity, source, message, context, dedupeKey, entityId] = alerts.raise.mock.calls[0];
    expect(severity).toBe('critical');
    expect(source).toBe('Tournament.satellite_boundary_held');
    expect(message).toContain('table_00000000_dealer_stopped_or_replaced');
    expect(context).toMatchObject({
      tournament_id: EVENT,
      pending_reason: 'table_00000000_dealer_stopped_or_replaced',
      held_seconds: Math.round(AFTER / 1000),
    });
    expect(dedupeKey).toBe(`satellite-boundary-held:${EVENT}`);
    expect(entityId).toBe(EVENT);
    m.noteSatelliteBoundaryPending(
      'table_00000000_dealer_stopped_or_replaced',
      t0 + AFTER + EVERY - 1
    );
    expect(alerts.raise).toHaveBeenCalledTimes(1);
    m.noteSatelliteBoundaryPending('table_00000000_dealer_stopped_or_replaced', t0 + AFTER + EVERY);
    expect(alerts.raise).toHaveBeenCalledTimes(2);
  });

  it('a hand still in flight at the bubble is hand-for-hand, and pages only after five minutes', () => {
    const { m } = satelliteThirty();
    const t0 = m.satelliteQualifierBoundaryHeldSinceMs;
    const IN_FLIGHT = TournamentManagerBase.SATELLITE_BOUNDARY_HAND_IN_FLIGHT_PAGE_AFTER_MS;
    expect(IN_FLIGHT).toBe(5 * 60_000);
    m.noteSatelliteBoundaryPending('table_00000000_hand_in_flight', t0 + AFTER);
    m.noteSatelliteBoundaryPending('table_00000000_hand_in_flight', t0 + IN_FLIGHT - 1);
    expect(alerts.raise).not.toHaveBeenCalled();
    m.noteSatelliteBoundaryPending('table_00000000_hand_in_flight', t0 + IN_FLIGHT);
    expect(alerts.raise).toHaveBeenCalledTimes(1);
  });

  it('a changed reason refreshes the page at once', async () => {
    const { m } = satelliteThirty();
    const t0 = m.satelliteQualifierBoundaryHeldSinceMs;
    m.noteSatelliteBoundaryPending('first_reason', t0 + AFTER);
    m.noteSatelliteBoundaryPending('second_reason', t0 + AFTER + 1000);
    expect(alerts.raise).toHaveBeenCalledTimes(2);
    expect(alerts.raise.mock.calls[1][2]).toContain('second_reason');
  });

  it('a maintenance freeze is not a stall, and a released boundary pages nothing', () => {
    const { m } = satelliteThirty();
    const t0 = m.satelliteQualifierBoundaryHeldSinceMs;
    freeze.frozen = true;
    m.noteSatelliteBoundaryPending('frozen', t0 + AFTER * 10);
    expect(alerts.raise).not.toHaveBeenCalled();
    freeze.frozen = false;
    m.releaseSatelliteQualifierBoundary(4);
    m.noteSatelliteBoundaryPending('after_release', t0 + AFTER * 10);
    expect(alerts.raise).not.toHaveBeenCalled();
  });

  it('a paged boundary closes its own alert the moment it lifts', async () => {
    const { m } = satelliteThirty();
    const t0 = m.satelliteQualifierBoundaryHeldSinceMs;
    m.noteSatelliteBoundaryPending('field_unresolved_at_its_tickets', t0 + AFTER);
    expect(alerts.raise).toHaveBeenCalledTimes(1);
    const filters: Array<[string, unknown]> = [];
    const update = vi.fn();
    const query: any = {
      update: (row: unknown) => {
        update(row);
        return query;
      },
      eq: (column: string, value: unknown) => {
        filters.push([column, value]);
        return query;
      },
      then: (resolve: any) => Promise.resolve({ data: null, error: null }).then(resolve),
    };
    vi.spyOn(supabase, 'from').mockReturnValue(query);
    expect(m.releaseSatelliteQualifierBoundary(4)).toBe(true);
    await Promise.resolve();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ resolved: true }));
    expect(filters).toEqual(
      expect.arrayContaining([
        ['source', 'Tournament.satellite_boundary_held'],
        ['context->>dedupe_key', `satellite-boundary-held:${EVENT}`],
        ['resolved', false],
      ])
    );
    // An unpaged release touches no alert row.
    update.mockClear();
    const { m: quiet } = satelliteThirty();
    vi.spyOn(supabase, 'from').mockReturnValue(query);
    expect(quiet.releaseSatelliteQualifierBoundary(4)).toBe(true);
    await Promise.resolve();
    expect(update).not.toHaveBeenCalled();
  });

  it('every pending answer of the sweep carries a reason', async () => {
    const { m } = satelliteThirty();
    rpc.read.mockRejectedValueOnce(new Error('lock timeout'));
    expect(await m.checkSatelliteQualifierCompletion()).toBe('pending');
    expect(m.satelliteQualifierBoundaryLastPendingReason).toContain('qualifier_state_unreadable');
    rpc.read.mockResolvedValue(answer('unresolved', 9, 8));
    expect(await m.checkSatelliteQualifierCompletion()).toBe('pending');
    expect(m.satelliteQualifierBoundaryLastPendingReason).toBe('field_unresolved_at_its_tickets');
  });
});
