/**
 * Union Mystery Bounty (PLO5) 7576aeb1, table 41d47e9d, 2026-11-05.
 *
 * Hand #55561914 was prepared and retained (never started) at 22:52:04 as the
 * add-on drain armed its hold; the loop parked on the pause gate. The gap
 * balancer then fenced the table with an UNCLAIMED tournament-move owner,
 * which can only claim between hands - a boundary this table reaches only by
 * playing the retained original. Every later release (:55 break armed, add-on
 * end skipped inside the break, maintenance freeze 23:00-23:05, break end
 * 23:05:00) deferred to that fence, so the gate stayed shut until the 600s
 * pause safety timeout at 23:12:05.
 *
 * Only construction is replaced; every pause decision is real engine code.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

let ServerTableEngineBase: (typeof import('./ServerTableEngineBase.js'))['ServerTableEngineBase'];

const MAX_HEALTHY_PAUSE_MS = 10 * 60 * 1000;

beforeAll(async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-placeholder-key';
  ({ ServerTableEngineBase } = await import('./ServerTableEngineBase.js'));
}, 240000);

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function flush() {
  for (let i = 0; i < 15; i++) await Promise.resolve();
}

function dealer(retainedOriginal: boolean) {
  const prepared = {};
  return Object.assign(Object.create(ServerTableEngineBase.prototype), {
    tableId: '41d47e9d-0000-4000-8000-000000000001',
    running: true,
    // A retained prepared original is not between hands.
    handController: retainedOriginal ? prepared : null,
    retainedPreparedOriginalController: retainedOriginal ? prepared : null,
    pendingOriginalContinuation: null,
    tableFSM: {
      state: 'running',
      transition(next: string) {
        this.state = next;
        return true;
      },
    },
    handForHandPaused: false,
    maintenancePaused: false,
    finalTableDealPaused: false,
    terminalCloseoutPaused: false,
    terminalBoundaryPersistenceFailed: false,
    postHandTasksPromise: null,
    holdBeforeNextHand: false,
    pauseRequiresExplicitResume: false,
    adminPauseLock: false,
    operatorFloorPaused: false,
    maintenanceLock: false,
    dealingHaltLock: false,
    f06MovementAdmission: null,
    tournamentMovePauseOwners: new Set(),
    claimedTournamentMovePauseOwners: new Set(),
    breakHeldTournamentMovePauseOwners: new Set(),
    tournamentMoveOperations: new Set(),
    tournamentMoveOperationByOwner: new Map(),
    tournamentMovePauseExpiryTimers: new Map(),
    boundaryPauseWaiters: new Set(),
    terminalBoundaryPendingGenerations: new Set(),
    handForHandResolve: null,
    pausedSinceMs: 0,
    pauseMaxWaitMs: null,
    pauseGateTimer: null,
    maintenanceCheckpointGeneration: 0,
    parkedBankSaveComplete: true,
    notifyBoundaryPauseWaiters: vi.fn(),
    markProgress: vi.fn(),
    persistPresenceForRestart: vi.fn(async () => undefined),
    lifecycleCanMutate: () => true,
  });
}

/** The incident, edge by edge, up to the moment the last pause lets go. */
async function incident(engine: any, onRelease: () => void, gateReleased: () => boolean) {
  // 22:52:04 triggerAddOnPeriod: every dealer is held for the add-on drain.
  engine.pauseAfterHand(MAX_HEALTHY_PAUSE_MS, { beforeNextHand: true, untilResumed: true });
  // 22:52:05 the loop parks on the gate ("Parked between hands").
  const gate: Promise<void> = engine.awaitPauseGate().then(onRelease);
  await flush();
  // 22:53 onward: the gap balancer fences the source; its probe cannot claim.
  expect(await engine.parkForTournamentMove('gap-balance-owner', 0)).toBe(false);
  // 22:55:00 SYNCHRONIZED BREAK: pauseForBreak re-arms the same hold.
  engine.pauseAfterHand(MAX_HEALTHY_PAUSE_MS, { beforeNextHand: true, untilResumed: true });
  // 22:58 the maintenance announcement; 23:00 the freeze.
  engine.pauseForMaintenance(MAX_HEALTHY_PAUSE_MS);
  // 23:05:00.12 MaintenanceBreak thaw clears only its own flag.
  engine.resumeFromMaintenance();
  await flush();
  expect(gateReleased()).toBe(false); // the tournament break still holds it
  // 23:05:00.30 the tournament's BREAK ENDED: resumeFromBreak releases.
  engine.resumeDealing();
  await flush();
  return { gate };
}

describe('a retained original under an unclaimed move is released by the last pause', () => {
  it('opens the gate when the tournament break ends, without the safety timeout', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const engine = dealer(true);
    let released = false;
    const { gate } = await incident(
      engine,
      () => {
        released = true;
      },
      () => released
    );
    // Before the fix this stayed false until the 600s safety timeout.
    expect(released).toBe(true);
    await gate;
    expect(engine.handForHandPaused).toBe(false);
    expect(engine.pauseRequiresExplicitResume).toBe(false);
    // The move still owns its claim; it takes the boundary the hand produces.
    expect(engine.tournamentMovePauseOwners.has('gap-balance-owner')).toBe(true);
  });

  it('still defers to a move owner on a table that is between hands', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const engine = dealer(false);
    let released = false;
    engine.pauseAfterHand(MAX_HEALTHY_PAUSE_MS, { beforeNextHand: true, untilResumed: true });
    const gate = engine.awaitPauseGate().then(() => {
      released = true;
    });
    await flush();
    // Unclaimed, but this table is between hands, so the move can still claim.
    engine.tournamentMovePauseOwners.add('gap-balance-owner');
    engine.resumeDealing();
    await flush();
    // Between hands the move CAN claim, so it keeps the table.
    expect(released).toBe(false);
    engine.releaseTournamentMovePause('gap-balance-owner');
    await gate;
    expect(released).toBe(true);
  });

  it('still defers to a CLAIMED move owner on a retained original', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const engine = dealer(true);
    let released = false;
    engine.pauseAfterHand(MAX_HEALTHY_PAUSE_MS, { beforeNextHand: true, untilResumed: true });
    const gate = engine.awaitPauseGate().then(() => {
      released = true;
    });
    await flush();
    engine.tournamentMovePauseOwners.add('claimed-owner');
    engine.claimedTournamentMovePauseOwners.add('claimed-owner');
    engine.resumeDealing();
    engine.resumeFromMaintenance();
    await flush();
    expect(released).toBe(false);
    engine.claimedTournamentMovePauseOwners.delete('claimed-owner');
    engine.releaseTournamentMovePause('claimed-owner');
    await gate;
    expect(released).toBe(true);
  });
});
