/**
 * A TOURNAMENT MANAGER NEVER HANGS COMING OUT OF A BREAK (2026-11-06).
 *
 * Dan: "MAKE ADJUSTMENTS WITH THE BREAKS SO TOURNAMENTS NEVER FREEZE OR FAIL
 * BECAUSE OF A TIMING OF A BREAK BEING OFF ... FIX THIS NOW AT ITS ROOT CAUSE."
 *
 * Thursday Night PKO c0b77808 took its :55 break into the 04:00 maintenance
 * break. Its level clock stayed paused through both and resumed at 04:05:00,
 * after the thaw, as it must. Its manager then consumed no wake until
 * 04:29:53, while a committed late-registration table waited for a dealer and
 * nothing reported anything. Every sweep yields, silently, to an in-flight
 * hand-boundary balance, and that balance had no clock of its own: the
 * stalled-sweep watchdog only measured sweeps.
 *
 * The law:
 *  1. the level clock does not run while the tournament's own break or the
 *     maintenance freeze is on, however long the overlap lasts;
 *  2. a boundary balance that does not settle holds the manager visibly: it
 *     reports itself, the stalled-sweep watchdog measures it, and the fenced
 *     successor hand-off accepts it;
 *  3. a sweep that yielded to it is owed and requested the moment it settles,
 *     and the measurement clears with it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const reported = vi.hoisted(() => [] as Array<{ code: string; meta: unknown }>);
vi.mock('../services/errorReporter.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/errorReporter.js')>()),
  reportError: (_error: unknown, code: string, meta?: unknown) => {
    reported.push({ code, meta });
  },
}));

import { TournamentManager } from './TournamentManager.js';
import { TournamentManagerBase } from './TournamentManagerBase.js';
import { GameServer } from '../GameServer.js';
import { setMaintenanceFrozen } from '../maintenance/freezeState.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const EVENT = id(1);
const GENERATION = id(9);
const SOURCE = id(2000);

function manager() {
  const m: any = new TournamentManager(EVENT, {} as any, GENERATION, performance.now() + 3_600_000);
  m.running = true;
  m.lifecycleEpoch.begin();
  m.eliminationSweepDeadlineAt = 0;
  m.eliminationMutationAllowed = () => true;
  m.requestUrgentEliminationSweepAfter = vi.fn();
  m.requestEliminationSweep = vi.fn();
  m.tournamentBreakDiscoveryComplete = true;
  m.isOnBreak = () => false;
  m.gameServer = { ownsTournamentTableEngine: () => true };
  m.broadcast = vi.fn(async () => true);
  const engine = {
    releaseTournamentMovePause: vi.fn(),
    awaitsTournamentMoveClaim: vi.fn(() => true),
    isBetweenHands: () => true,
    hasSettlementInFlight: () => false,
    resumeDealing: vi.fn(),
  };
  m.tableEngines = new Map([[SOURCE, engine]]);
  m.gapBalanceFencedSources.add(SOURCE);
  return { m, engine };
}

/** A board read that does not answer until the test lets it. */
function hangingBoardRead(m: any) {
  let answer!: (ids: string[] | null) => void;
  m.liveTournamentTableIdsWithPlayers = vi.fn(
    () => new Promise<string[] | null>((resolve) => (answer = resolve))
  );
  return (ids: string[] | null) => answer(ids);
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(() => {
  reported.length = 0;
  vi.useFakeTimers();
});
afterEach(() => {
  setMaintenanceFrozen(false);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('a tournament manager never hangs coming out of a break', () => {
  it('1. the level clock stays paused through the break and the whole maintenance overlap', async () => {
    const { m, engine } = manager();
    m.onBreak = true;
    m.savedBlindTimerRemaining = 240_000;
    m.clearPersistedBreak = vi.fn(async () => {});
    m.startBlindTimer = vi.fn();
    setMaintenanceFrozen(true);

    const resumed = m.resumeFromBreak();
    // The tournament's own break has ended; the maintenance freeze runs on
    // well past the thaw-wait ceiling (04:00:00 -> 04:05:00 on 2026-11-06).
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(m.onBreak).toBe(true);
    expect(m.clearPersistedBreak).not.toHaveBeenCalled();
    expect(m.startBlindTimer).not.toHaveBeenCalled();
    expect(engine.resumeDealing).not.toHaveBeenCalled();
    expect(reported.map((r) => r.code)).toContain(
      'TournamentManagerBase.resumeFromBreak_thaw_wait_ceiling'
    );

    // The thaw commits: the clock re-arms from what the break saved.
    setMaintenanceFrozen(false);
    await vi.advanceTimersByTimeAsync(TournamentManagerBase.MAINTENANCE_THAW_POLL_MS);
    await resumed;
    expect(m.onBreak).toBe(false);
    expect(m.clearPersistedBreak).toHaveBeenCalledTimes(1);
    expect(m.startBlindTimer).toHaveBeenCalledTimes(1);
    expect(engine.resumeDealing).toHaveBeenCalled();
  });

  it('2. a boundary balance that does not settle is reported, measured and handed on', async () => {
    const { m } = manager();
    hangingBoardRead(m);
    m.requestSuccessorDrain = vi.fn(() => true);

    expect(m.claimGapBalanceAtBoundary(SOURCE)).toBe(true);
    await flush();
    expect(m.boundaryBalanceInFlight).toBe(true);

    // A sweep admitted meanwhile yields and is owed.
    await m.runEliminationSweep(new AbortController().signal).catch(() => {});
    expect(m.isProcessingEliminations).toBe(false);
    expect(m.boundaryBalanceOwesSweep).toBe(true);

    await vi.advanceTimersByTimeAsync(TournamentManagerBase.BOUNDARY_BALANCE_REPORT_MS);
    const overran = reported.filter((r) => r.code === 'Tournament.boundary_balance_overran');
    expect(overran).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(GameServer.STALLED_ELIMINATION_SWEEP_MS);
    const stalled = m.getStalledEliminationSweep(Date.now());
    expect(stalled).toMatchObject({ step: 'boundary_balance' });
    expect(stalled.msInFlight).toBeGreaterThanOrEqual(GameServer.STALLED_ELIMINATION_SWEEP_MS);
    expect(m.requestSuccessorForStalledEliminationSweep()).toBe(true);
    expect(m.requestSuccessorDrain).toHaveBeenCalledTimes(1);
    // Reported once, not once per watchdog pass.
    expect(reported.filter((r) => r.code === 'Tournament.boundary_balance_overran')).toHaveLength(
      1
    );
  });

  it('3. the yielded sweep is requested the moment the balance settles, and the clock clears', async () => {
    const { m, engine } = manager();
    const answer = hangingBoardRead(m);

    m.claimGapBalanceAtBoundary(SOURCE);
    await flush();
    m.boundaryBalanceOwesSweep = true;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(m.getStalledEliminationSweep(Date.now())).toMatchObject({
      step: 'boundary_balance',
      msInFlight: 10_000,
    });

    // One live table: nothing to balance, the source goes back to its dealer.
    answer([SOURCE]);
    await flush();
    await flush();
    expect(m.boundaryBalanceInFlight).toBe(false);
    expect(m.boundaryBalanceStartedAt).toBe(0);
    expect(m.requestEliminationSweep).toHaveBeenCalledWith('boundary_balance_settled');
    expect(engine.releaseTournamentMovePause).toHaveBeenCalled();
    expect(m.getStalledEliminationSweep(Date.now())).toBeNull();
    expect(m.requestSuccessorForStalledEliminationSweep()).toBe(false);

    // A balance that settles in time is never reported.
    await vi.advanceTimersByTimeAsync(TournamentManagerBase.BOUNDARY_BALANCE_REPORT_MS);
    expect(reported.filter((r) => r.code === 'Tournament.boundary_balance_overran')).toHaveLength(
      0
    );
  });
});
