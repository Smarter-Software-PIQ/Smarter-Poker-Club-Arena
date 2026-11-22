/**
 * A BUST FAR FROM THE TICKETS DOES NOT FREEZE THE SATELLITE (Dan 2026-11-06;
 * extended 2026-11-22 for entry_open and unresolved-far-from-tickets).
 *
 * "HANDS NEED TO START A FEW SECONDS AFTER THE LAST HAND IS OVER. FIX WHAT
 * EVER IS BLOCKING". Every zero-stack hand in a cohort satellite parked every
 * table in the event; production six-table satellites averaged 34-61 s
 * between hands on those gaps. On 2026-11-22 (15:40-15:56Z, incident 1e532243
 * / alert c3ba0bb4, p95 +503 ms after a bust, 88% post-bust), cohort satellites
 * 125c62be (Level 5/11, entry_open, 25 live) and 0e2ab711 (Level 12/11, 19 live)
 * still froze every table for 433-2,917 ms on every bust because
 * satelliteFieldWatermark only recorded 'continuing' — wiping itself on every
 * 'entry_open' answer (all of late registration) and every 'unresolved' answer
 * (every bust while post-commit or knockout recording was still in flight), even
 * though satelliteBoundaryIsUnneeded (2026-11-07) already proves neither state
 * needs the boundary.
 *
 * The law:
 *
 *   1. A bust holds the qualifier boundary unless:
 *      (a) the last authoritative 'continuing' or 'unresolved' answer (whose
 *          qualifierIds already exclude 0-chip players), less every bust
 *          reported since before the read began, is still more than
 *          SATELLITE_BUBBLE_MARGIN (1) above the full-ticket count, OR
 *      (b) the last authoritative answer was 'entry_open', the prize pool is
 *          still unfinalized on this manager, the blind level has not changed
 *          since the read, and the watermark is younger than
 *          SATELLITE_ENTRY_OPEN_WATERMARK_MAX_AGE_MS.
 *   2. Without such a watermark (none yet, 'qualifying', 'unresolved' or
 *      'continuing' at or inside the margin, prize pool finalized, blind level
 *      advanced, an unreadable read, or expired age) every bust holds exactly
 *      as before.
 *   3. The field estimate only runs low: a bust reported while the read is in
 *      flight is subtracted again, so the boundary is held sooner, never later.
 *   4. Busts on different tables accumulate, so the field holds the moment
 *      their sum could reach the tickets.
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
import { TournamentManagerBase } from './TournamentManagerBase.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const EVENT = id(1);
const TABLES = [id(3), id(4)];
const field = (n: number) => Array.from({ length: n }, (_, i) => id(100 + i));
const continuing = (live: number, tickets: number) => ({
  state: 'continuing',
  fullTicketCount: tickets,
  qualifierIds: field(live),
});

type Wake = (tableId: string, finalStacks: Array<{ user_id: string; stack: number }>) => void;

function satellite() {
  const m: any = new TournamentManager(EVENT, {} as any, id(9), performance.now() + 60000);
  m.running = true;
  m.eliminationSweepDeadlineAt = 0;
  m.requestUrgentEliminationSweepAfter = vi.fn();
  m.requestEliminationSweep = vi.fn();
  m.isCohortSatellite = () => true;
  m.isRunning = () => true;
  m.eliminationMutationAllowed = () => true;
  m.declareConsolidationOutstanding = vi.fn();
  m.mysteryActivationMayOpenOnBust = () => false;
  m.declareFieldDecidedIfOneStackRemains = vi.fn();
  m.askForConsolidationIfSpread = vi.fn();
  m.bustAwaitsItsStage = vi.fn();
  m.horseRebuyOfferMayHaveOpened = vi.fn();
  m.requestSeatHeads = vi.fn();
  const wakes = new Map<string, Wake>();
  const parks = new Map<string, (id: string) => void>();
  const engines = new Map<string, any>();
  for (const tableId of TABLES) {
    const engine: any = {
      isRunning: () => true,
      parkForTerminalCloseout: vi.fn(async () => true),
      releaseTerminalCloseoutPause: vi.fn(),
      onHandComplete: (cb: Wake) => wakes.set(tableId, cb),
      onPauseReady: (cb: (id: string) => void) => parks.set(tableId, cb),
      onRestartRequired: vi.fn(),
    };
    engines.set(tableId, engine);
    m.tableEngines.set(tableId, engine);
  }
  m.tableIdForManagedEngine = (engine: unknown) =>
    [...engines].find(([, e]) => e === engine)?.[0] ?? null;
  m.gameServer.getTableEngine = (tableId: string) => engines.get(tableId);
  for (const engine of engines.values()) m.wireEliminationWake(engine);
  const bust = (tableId: string, zeros = 1) =>
    wakes.get(tableId)!(
      tableId,
      Array.from({ length: zeros }, (_, i) => ({ user_id: id(500 + i), stack: 0 }))
    );
  return { m, engines, bust, parks };
}

afterEach(() => {
  vi.restoreAllMocks();
  rpc.read.mockReset();
  rpc.settle.mockReset();
  rpc.report.mockReset();
});

describe('a bust far from the tickets does not freeze the satellite', () => {
  it.each(['manager replacement', 'server replacement', 'retired manager'] as const)(
    'ignores delayed hand and park edges after %s',
    (handoff) => {
      const { m, engines, bust, parks } = satellite();
      const id = TABLES[0];
      const current = new Map(engines);
      m.gameServer.getTableEngine = (tableId: string) => current.get(tableId);
      m.releaseManagedTablePauseIfUnowned = vi.fn();
      m.claimGapBalanceAtBoundary = vi.fn();
      const outgoing = engines.get(id);
      outgoing.awaitsTournamentMoveClaim = () => true;
      if (handoff === 'manager replacement') m.tableEngines.set(id, {});
      if (handoff === 'server replacement') current.set(id, {});
      if (handoff === 'retired manager') m.isRunning = () => false;
      const previousCompletion = m.lastObservedHandCompletedAtMs;
      bust(id);
      parks.get(id)!(id);
      expect(m.lastObservedHandCompletedAtMs).toBe(previousCompletion);
      expect(m.requestSeatHeads).not.toHaveBeenCalled();
      expect(m.requestEliminationSweep).not.toHaveBeenCalled();
      expect(m.releaseManagedTablePauseIfUnowned).not.toHaveBeenCalled();
      expect(m.claimGapBalanceAtBoundary).not.toHaveBeenCalled();
      expect(m.satelliteQualifierBoundaryPending).toBe(false);
    }
  );

  it('holds every bust before any authoritative answer exists', () => {
    const { m, engines, bust } = satellite();
    bust(TABLES[0]);
    expect(m.satelliteQualifierBoundaryPending).toBe(true);
    for (const engine of engines.values())
      expect(engine.parkForTerminalCloseout).toHaveBeenCalled();
  });

  it('keeps dealing while the field stays more than one above its tickets', async () => {
    const { m, engines, bust } = satellite();
    rpc.read.mockResolvedValue(continuing(20, 5));
    expect(await m.checkSatelliteQualifierCompletion()).toBe('continue');
    // 20 live, 5 tickets: thirteen busts leave 7 (> 5 + 1), all keep dealing.
    for (let i = 0; i < 13; i++) bust(TABLES[i % 2]);
    expect(m.satelliteQualifierBoundaryPending).toBe(false);
    for (const engine of engines.values())
      expect(engine.parkForTerminalCloseout).not.toHaveBeenCalled();
    // The fourteenth leaves 6, one above the tickets: the field holds.
    bust(TABLES[0]);
    expect(m.satelliteQualifierBoundaryPending).toBe(true);
    for (const engine of engines.values())
      expect(engine.parkForTerminalCloseout).toHaveBeenCalled();
  });

  it('adds up busts across tables and multi-bust hands', async () => {
    const { m, bust } = satellite();
    rpc.read.mockResolvedValue(continuing(10, 5));
    await m.checkSatelliteQualifierCompletion();
    bust(TABLES[0], 2); // estimate 8
    expect(m.satelliteQualifierBoundaryPending).toBe(false);
    bust(TABLES[1], 2); // estimate 6: within one of the tickets
    expect(m.satelliteQualifierBoundaryPending).toBe(true);
  });

  it('a bust reported while the read is in flight is still subtracted', async () => {
    const { m, bust } = satellite();
    rpc.read.mockImplementationOnce(async () => {
      bust(TABLES[0], 3); // held: no watermark yet
      return continuing(10, 5); // the answer may already exclude those three
    });
    await m.checkSatelliteQualifierCompletion();
    m.satelliteQualifierBoundaryPending = false;
    // 10 - 3 = 7 > 6 would skip; one more bust makes 6 and must hold.
    bust(TABLES[1]);
    expect(m.satelliteQualifierBoundaryPending).toBe(true);
  });

  it('entry_open vouches for busts until prize pool finalizes, level advances, or entry-open age expires', async () => {
    const { m, engines, bust } = satellite();
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    m.currentLevel = 5;
    m.prizePoolFinalized = false;
    rpc.read.mockResolvedValue({ state: 'entry_open' });
    expect(await m.checkSatelliteQualifierCompletion()).toBe('continue');
    // Busts during the same late-reg level keep every table dealing.
    bust(TABLES[0]);
    bust(TABLES[1], 2);
    expect(m.satelliteQualifierBoundaryPending).toBe(false);
    for (const engine of engines.values())
      expect(engine.parkForTerminalCloseout).not.toHaveBeenCalled();
    // Advancing the blind level withdraws the entry_open watermark immediately.
    m.currentLevel = 6;
    bust(TABLES[0]);
    expect(m.satelliteQualifierBoundaryPending).toBe(true);

    // Re-arm entry_open at level 6, then finalize prize pool: next bust holds.
    m.satelliteQualifierBoundaryPending = false;
    expect(await m.checkSatelliteQualifierCompletion()).toBe('continue');
    m.prizePoolFinalized = true;
    bust(TABLES[1]);
    expect(m.satelliteQualifierBoundaryPending).toBe(true);

    // Re-arm entry_open unfinalized, then expire SATELLITE_ENTRY_OPEN_WATERMARK_MAX_AGE_MS.
    m.satelliteQualifierBoundaryPending = false;
    m.prizePoolFinalized = false;
    expect(await m.checkSatelliteQualifierCompletion()).toBe('continue');
    now += TournamentManagerBase.SATELLITE_ENTRY_OPEN_WATERMARK_MAX_AGE_MS - 1;
    bust(TABLES[0]);
    expect(m.satelliteQualifierBoundaryPending).toBe(false);
    now += 1;
    bust(TABLES[1]);
    expect(m.satelliteQualifierBoundaryPending).toBe(true);
  });

  it('unresolved far from the tickets keeps the field watermark and still holds at the margin', async () => {
    const { m, engines, bust } = satellite();
    rpc.read.mockResolvedValue({
      state: 'unresolved',
      fullTicketCount: 5,
      qualifierIds: field(10),
    });
    expect(await m.checkSatelliteQualifierCompletion()).toBe('continue');
    // 10 live (0-chip players already excluded by fn_get_satellite_qualifier_state), 5 tickets:
    // three busts leave 7 (> 5 + 1), all keep dealing.
    bust(TABLES[0], 2);
    bust(TABLES[1], 1);
    expect(m.satelliteQualifierBoundaryPending).toBe(false);
    for (const engine of engines.values())
      expect(engine.parkForTerminalCloseout).not.toHaveBeenCalled();
    // The fourth bust reaches 6 (= 5 + 1): the field holds immediately.
    bust(TABLES[0]);
    expect(m.satelliteQualifierBoundaryPending).toBe(true);
  });

  it('unresolved or qualifying at or inside the margin withdraws the watermark', async () => {
    for (const answer of [
      { state: 'unresolved', fullTicketCount: 5, qualifierIds: field(6) },
      { state: 'unresolved', fullTicketCount: 5, qualifierIds: field(5) },
      { state: 'qualifying', fullTicketCount: 5, qualifierIds: field(5) },
    ]) {
      const { m, bust } = satellite();
      rpc.read.mockReset();
      rpc.read.mockResolvedValueOnce(continuing(20, 5));
      await m.checkSatelliteQualifierCompletion();
      rpc.read.mockResolvedValueOnce(answer);
      m.satelliteContinuation = null;
      await m.checkSatelliteQualifierCompletion();
      m.satelliteQualifierBoundaryPending = false;
      bust(TABLES[0]);
      expect(m.satelliteQualifierBoundaryPending).toBe(true);
    }
  });

  it('an unreadable answer withdraws the watermark', async () => {
    const { m, bust } = satellite();
    rpc.read.mockResolvedValueOnce(continuing(20, 5));
    await m.checkSatelliteQualifierCompletion();
    rpc.read.mockRejectedValueOnce(new Error('lock timeout'));
    m.satelliteContinuation = null;
    expect(await m.checkSatelliteQualifierCompletion()).toBe('pending');
    bust(TABLES[0]);
    expect(m.satelliteQualifierBoundaryPending).toBe(true);
  });

  it('five minutes is the longest a watermark vouches for the field', async () => {
    const { m, bust } = satellite();
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    rpc.read.mockResolvedValue(continuing(20, 5));
    await m.checkSatelliteQualifierCompletion();
    now += TournamentManagerBase.SATELLITE_FIELD_WATERMARK_MAX_AGE_MS - 1;
    bust(TABLES[0]);
    expect(m.satelliteQualifierBoundaryPending).toBe(false);
    now += 1;
    bust(TABLES[1]);
    expect(m.satelliteQualifierBoundaryPending).toBe(true);
  });

  it('a reused continuation also needs the field still clear of its tickets', async () => {
    const { m, bust } = satellite();
    rpc.read.mockResolvedValue(continuing(9, 5));
    await m.checkSatelliteQualifierCompletion();
    expect(rpc.read).toHaveBeenCalledTimes(1);
    bust(TABLES[0]); // estimate 8, skipped
    expect(m.satelliteQualifierBoundaryPending).toBe(false);
    await m.checkSatelliteQualifierCompletion();
    expect(rpc.read).toHaveBeenCalledTimes(1); // still clear: reused
    bust(TABLES[0]); // estimate 7, skipped
    expect(m.satelliteQualifierBoundaryPending).toBe(false);
    rpc.read.mockResolvedValue(continuing(7, 5));
    m.satelliteBustsReported += 1; // a bust reported elsewhere: estimate 6
    await m.checkSatelliteQualifierCompletion();
    expect(rpc.read).toHaveBeenCalledTimes(2); // no longer clear: asked again
  });
});
