/**
 * REGRESSION BARRIER (2026-11-21, H10 / run 44887083680):
 *
 * A rollback rehearsal swapped Backup from f94c25f0 to bb21dc82 across
 * 09:00:00Z (03:00:00 America/Chicago) while frozen (138 seats at 08:59:12Z,
 * still 138 at 09:00:01Z, dropped to 132 at 09:00:04Z). Identical prior
 * failure occurred on 2026-11-16 at 09:00:06Z (125 -> 115 seats).
 *
 * Root cause: in GameServer.discoverTournaments(), the registering loop
 * broke on isMaintenanceFrozen(), then fell through to fn_spin_expire_unfilled
 * and fn_daily_window_close_seat_first_lobbies (both with initial timer 0 on
 * boot) and repairOrphanedTournamentSeats(), all missing isMaintenanceFrozen().
 *
 * This test drives the real discovery pass at 2026-11-21T09:00:04Z
 * (03:00:04 America/Chicago) and proves:
 *  1. While frozen, none of the three seat-mutating sweeps run and their
 *     cooldowns are not consumed.
 *  2. On the very first pass after thaw, they execute immediately.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameServer } from '../GameServer.js';
import { supabase } from '../services/supabase.js';
import { reportError } from '../services/errorReporter.js';

const freezeControl = vi.hoisted(() => ({ frozen: false }));
vi.mock('./freezeState.js', async (original) => ({
  ...(await original<object>()),
  isMaintenanceFrozen: () => freezeControl.frozen,
}));
vi.mock('../services/errorReporter.js', () => ({ reportError: vi.fn() }));

// 2026-11-21T09:00:04Z = 03:00:04 America/Chicago (exact instant of run 44887083680)
const THREE_AM_CHICAGO_UTC = Date.UTC(2026, 10, 21, 9, 0, 4);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(THREE_AM_CHICAGO_UTC);
  vi.mocked(reportError).mockClear();
  freezeControl.frozen = false;
});

afterEach(() => {
  freezeControl.frozen = false;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function emptyTableQuery() {
  const query: any = {
    select: () => query,
    eq: () => query,
    in: () => query,
    is: () => query,
    not: () => query,
    lt: () => query,
    gt: () => query,
    gte: () => query,
    order: () => query,
    limit: () => Promise.resolve({ data: [], error: null }),
  };
  return query;
}

describe('frozen discovery sweeps stand down during a maintenance break (H10)', () => {
  it('holds fn_daily_window_close_seat_first_lobbies and fn_spin_expire_unfilled while frozen at 03:00 Chicago, then runs both on the first pass after thaw', async () => {
    const rpcCalls: string[] = [];
    vi.spyOn(supabase, 'rpc').mockImplementation((name: string) => {
      rpcCalls.push(name);
      return Promise.resolve({
        data:
          name === 'fn_daily_window_close_seat_first_lobbies'
            ? { ok: true, closed: 0, failed: 0 }
            : name === 'fn_spin_expire_unfilled'
              ? { ok: true, expired: 0, failed: 0, chips_refunded: 0, timeout_minutes: 160 }
              : { ok: true, flagged: 0 },
        error: null,
      }) as never;
    });
    vi.spyOn(supabase, 'from').mockImplementation(() => emptyTableQuery());

    const absorbOrphanedSeats = vi.fn(async () => 0);
    const server = Object.create(GameServer.prototype) as any;
    let pass = 0;
    Object.assign(server, {
      running: true,
      lifecycleGeneration: 1,
      tournamentEngines: new Map([['t-live', { isRunning: () => true, absorbOrphanedSeats }]]),
      tableEngines: new Map(),
      tournamentOwnedTables: new Set(),
      tournamentTopUpsInFlight: new Map(),
      emptyEventCancelsInFlight: new Map(),
      tournamentManagerAdmissionOperations: new Map(),
      tournamentManagerAdmissionRetryTimers: new Map(),
      discoveryJobs: new Set(),
      lastMttRampAt: new Map(),
      pastStartTopUpClock: new Map(),
      registeringButFinalizedReported: new Set(),
      finalizedFinishAttempt: new Map(),
      seatFirstFullSince: new Map(),
      completingFirstSeenAt: new Map(),
      // Fresh-boot values (0) for the three seat-mutating sweeps under test:
      lastSpinExpireAt: 0,
      lastLobbyCloseAt: 0,
      lastOrphanSeatSweepAt: 0,
      // Keep unrelated periodic sweeps quiet during this pass:
      lastSeatFirstFinishSweepAt: THREE_AM_CHICAGO_UTC,
      lastClosedTableReopenSweepAt: THREE_AM_CHICAGO_UTC,
      lastDarkTournamentSweepAt: THREE_AM_CHICAGO_UTC,
      lastConservationAt: THREE_AM_CHICAGO_UTC,
      lastNoHandResultCheckAt: THREE_AM_CHICAGO_UTC,
      readSeatFirstPaidSeats: vi.fn(async () => new Map()),
      readEntrantRosterCounts: vi.fn(async () => new Map()),
      readDurableEmptyTopUps: vi.fn(async () => new Map()),
      pruneTournamentOwnedTables: vi.fn(),
      escalateStuckTournamentTables: vi.fn(),
      sleep: vi.fn(async () => {
        pass++;
        if (pass === 1) {
          // Verify pass 1 (frozen) mutated nothing and preserved timers
          expect(rpcCalls).not.toContain('fn_daily_window_close_seat_first_lobbies');
          expect(rpcCalls).not.toContain('fn_spin_expire_unfilled');
          expect(server.lastLobbyCloseAt).toBe(0);
          expect(server.lastSpinExpireAt).toBe(0);
          expect(absorbOrphanedSeats).not.toHaveBeenCalled();

          // Thaw: advance 4 minutes to 09:04:15Z (still 03:04 Chicago)
          freezeControl.frozen = false;
          vi.setSystemTime(Date.UTC(2026, 10, 21, 9, 4, 15));
          return;
        }
        server.running = false;
      }),
    });

    // Pass 1 runs frozen at 03:00:04 America/Chicago; pass 2 runs thawed at 03:04:15 America/Chicago.
    freezeControl.frozen = true;
    await server.discoverTournaments();
    await Promise.all([...server.discoveryJobs]);

    expect(pass).toBe(2);
    expect(rpcCalls).toContain('fn_daily_window_close_seat_first_lobbies');
    expect(rpcCalls).toContain('fn_spin_expire_unfilled');
    expect(server.lastLobbyCloseAt).toBe(Date.UTC(2026, 10, 21, 9, 4, 15));
    expect(server.lastSpinExpireAt).toBe(Date.UTC(2026, 10, 21, 9, 4, 15));
    expect(absorbOrphanedSeats).toHaveBeenCalledTimes(1);
  });

  it('repairOrphanedTournamentSeats skips all tournament engines while frozen and runs when thawed', async () => {
    const absorbOrphanedSeats = vi.fn(async () => 0);
    const server = Object.create(GameServer.prototype) as any;
    Object.assign(server, {
      tournamentEngines: new Map([['t-1', { isRunning: () => true, absorbOrphanedSeats }]]),
    });

    freezeControl.frozen = true;
    await server.repairOrphanedTournamentSeats();
    expect(absorbOrphanedSeats).not.toHaveBeenCalled();

    freezeControl.frozen = false;
    await server.repairOrphanedTournamentSeats();
    expect(absorbOrphanedSeats).toHaveBeenCalledTimes(1);
  });
});
