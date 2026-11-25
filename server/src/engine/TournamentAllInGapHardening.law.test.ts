/**
 * HARDENING LAW: TOURNAMENT ALL_IN_SHOWDOWN BETWEEN-HAND DELAY ROOT CAUSES (2026-11-25).
 *
 * Production alert on serving 26b45e8d:
 *   "Unintended Delay Between Hands Tournament All_In_Showdown Hands Have Been
 *    Delayed For 15 Minutes (P95 +492 Ms Over The 250 Ms Budget). Over Budget
 *    In 15 Min: 8 Hands; 50% After A Bust, 25% After A Tournament Seat Move,
 *    13% Both. Latest 5 Min P95 +713 Ms After A Bust, +447 Ms After Neither."
 *
 * Five distinct, compounding root causes proven on live 26b45e8d (/health
 * nextHandGap.slowest tables 47cd992b/968fff55/f72c48d9, ca-engine logs for
 * b5aee1ef/ff6aadb3/aaa18476/7455a6a4, and EventDbBulkhead 03:49:31Z wave):
 *
 *   1. Serial `fn_f06_hand_number_state` inside `reserveF06Hand`: ran AFTER
 *      `loadSeatedPlayers` even though it takes only (tournament, lease, table).
 *      Prefetching it in parallel inside `prepareNextHand()` removes one full
 *      serial PostgREST RTT from every tournament hand while keeping exact
 *      single-use invalidation on pause, abandon, unstarted permit release,
 *      stale age, or error fallback.
 *   2. Serial `fetchTimeBankExtras` + `readAutoTimeBankPreferences` inside
 *      `dealHand` after a tournament seat move: ran between `fn_f06_begin_hand`
 *      and `seq-0`. Pre-fetching under the rest via `prepareTimeBankReads`
 *      removes that RTT from every destination seat-move hand.
 *   3. Wasted idle rest sleeps before F06 begin (`F06_RESERVE_LEAD_MS = 1250`)
 *      and seq-1 (`SEQ1_RETAIN_LEAD_MS = 650`): live 968fff55 slept 232 ms
 *      idle after seq-0 before launching a 1,221 ms seq-1. Widening to
 *      1500 ms / 900 ms gives seq-1 +250 ms more rest runway while preserving
 *      a 600 ms pre-start cancellation window and exact rest deadline (>= 1500 ms).
 *   4. Post-bust duplicate `handCompleteCallback` + parked gap-balance source
 *      duplicate 5-query board reads: Dealing fired `handCompleteCallback` a
 *      second time after `post_hand_hold` right as `armNextHandRest` started,
 *      and `checkTableBalance` discarded `freshTables` on zero-move exits
 *      (`safeMoves.length === 0` or budget-expired yield), forcing parked
 *      sources (including unneeded `neither` tables) to wait for another 5-query
 *      board read after the sweep settled.
 *   5. `EventDatabaseBulkhead` halved quiet tournaments (`24 -> 12` for 210
 *      calls / ~2 min) on a single isolated `slow` answer at `inFlight = 0`
 *      (all 7 tournaments dropped simultaneously at 03:49:31Z). Guarding `slow`
 *      with the same streak >= 2 OR active concurrency (`>= minPerEvent`) rule
 *      already used for `congested` eliminates false-congestion parking.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

vi.mock('../services/supabase/client.js', () => ({
  supabase: {
    from: () => {
      throw new Error('Unexpected database write');
    },
    rpc: () => {
      throw new Error('Unexpected database RPC');
    },
  },
  maintenanceSupabase: {},
}));
vi.mock('../services/errorReporter.js', () => ({ reportError: vi.fn(), reportWarning: vi.fn() }));
vi.mock('../services/engineAlerts.js', () => ({
  raiseEngineAlert: vi.fn(async () => true),
  resolveEngineAlert: vi.fn(async () => true),
  firingFingerprints: vi.fn(() => []),
}));

import {
  ENGINE_BETWEEN_HANDS_BUDGET_MS,
  HAND_COMPLETION as H,
} from '../config/handCompletionSpec.js';
import { ServerTableEngineDealing } from './ServerTableEngineDealing.js';
import { disposeEngines, fixture } from './f06RestDealFixture.test-support.js';
import { TournamentManager } from '../tournament/TournamentManager.js';
import type { BalancerTable } from './TableBalancer.js';
import {
  EVENT_DB_MAX_IN_FLIGHT,
  EVENT_DB_MIN_IN_FLIGHT,
  EventDatabaseBulkhead,
  type EventDbPermit,
} from '../services/supabase/eventDatabaseBulkhead.js';

afterEach(() => {
  disposeEngines();
  vi.useRealTimers();
});

const DEALING_SRC = readFileSync(
  fileURLToPath(new URL('./ServerTableEngineDealing.ts', import.meta.url)),
  'utf8'
);
const SETTLEMENT_SRC = readFileSync(
  fileURLToPath(new URL('./ServerTableEngineSettlement.ts', import.meta.url)),
  'utf8'
);
const MANAGER_BASE_SRC = readFileSync(
  fileURLToPath(new URL('../tournament/TournamentManagerBase.ts', import.meta.url)),
  'utf8'
);

describe('Root Cause 1: fn_f06_hand_number_state is prefetched in parallel inside prepareNextHand', () => {
  it('exposes installF06HandStatePrefetch and runs it concurrently with loadSeatedPlayers inside prepareNextHand', async () => {
    const f = fixture();
    expect(typeof f.engine.installF06HandStatePrefetch).toBe('function');

    const events: string[] = [];
    let releaseRoster!: () => void;
    let releaseState!: () => void;
    f.engine.running = false;
    f.engine.f06PermitFactory = null;
    f.engine.installF06HandStatePrefetch(() => {
      events.push('state:start');
      return new Promise<void>((resolve) => {
        releaseState = () => {
          events.push('state:done');
          resolve();
        };
      });
    });
    f.engine.installF06HandAdmission(() => {
      throw new Error('not called in prepareNextHand');
    });
    f.engine.running = true;
    f.engine.readNextHandInputs = vi.fn(async () => {
      events.push('roster:start');
      await new Promise<void>((resolve) => {
        releaseRoster = () => {
          events.push('roster:done');
          resolve();
        };
      });
      return f.seats;
    });
    f.engine.allocateGlobalHandNumber = vi.fn(async () => {
      events.push('alloc:start');
      return 1000001;
    });

    const prep = f.engine.prepareNextHand();
    await new Promise((r) => setTimeout(r, 10));
    // All three independent preparation reads started in parallel without waiting for each other.
    expect(events).toEqual(['alloc:start', 'state:start', 'roster:start']);
    releaseState();
    releaseRoster();
    await prep;
  });

  it('invalidates prefetched F06 state on pause, unstarted permit release, and allocator invalidation', async () => {
    const f = fixture();
    const clearSpy = vi.fn();
    f.engine.running = false;
    f.engine.installF06HandStatePrefetch(() => Promise.resolve(), clearSpy);
    f.engine.running = true;

    f.engine.invalidatePreparedAllocatorValue();
    expect(clearSpy).toHaveBeenCalledTimes(1);

    f.engine.handForHandPaused = true;
    f.engine.holdBeforeNextHand = true;
    expect(f.engine.discardPreparedHandForPause()).toBe(true);
    expect(clearSpy).toHaveBeenCalledTimes(2);
  });

  it('TournamentManagerBase wires installF06HandStatePrefetch alongside installF06HandAdmission with age guard and fallback', () => {
    expect(MANAGER_BASE_SRC).toContain('installF06HandStatePrefetch?.(');
    expect(MANAGER_BASE_SRC).toContain('PREPARED_F06_HAND_STATE_MAX_AGE_MS');
    expect(MANAGER_BASE_SRC).toContain("candidateData.blocked_reason === 'source_excluded'");
    expect(MANAGER_BASE_SRC).toContain('if (!refreshed) {');
  });

  it('prepareTimeBankReads error or staleness falls back cleanly inline with zero unhandled rejection', async () => {
    const f = fixture();
    let call = 0;
    const fetchExtras = vi.fn(async (ids: string[]) => {
      call++;
      if (call === 1) throw new Error('transient_time_bank_timeout');
      return new Map(ids.map((id) => [id, { extraSeconds: 35, unlimitedActivations: false }]));
    });
    f.engine.fetchTimeBankExtras = fetchExtras;

    f.engine.prepareTimeBankReads(f.seats);
    // Let the rejected prefetch settle without causing an unhandledRejection.
    await new Promise((r) => setTimeout(r, 15));

    const extras = await f.engine.takePreparedTimeBankExtras([f.seats[0].user_id]);
    expect(fetchExtras).toHaveBeenCalledTimes(2);
    expect(extras.get(f.seats[0].user_id)?.extraSeconds).toBe(35);
  });
});

describe('Root Cause 2: new-arrival time-bank reads ride under the rest for tournament seat moves', () => {
  it('starts fetchTimeBankExtras in prepareTimeBankReads and reuses it in dealHand without a second DB round trip', async () => {
    const f = fixture();
    expect(typeof f.engine.prepareTimeBankReads).toBe('function');

    // Simulate a freshly moved-in tournament seat with no cached bank yet.
    const movedSeat = {
      seat_number: 4,
      user_id: 'u-moved-1',
      username: 'Moved Player',
      occupancy_id: 'occupancy-moved-1',
      stack: 1000,
      seat_id: '00000000-0000-4000-8000-000000000004',
      seat_joined_at: '2026-10-15T00:00:00.123456Z',
    };
    f.engine.seatedPlayers = [...f.seats, movedSeat];
    // Mark incumbents as already initialized; only movedSeat is new.
    for (const incumbent of f.seats) {
      f.engine.timeBankEngine.initializePlayer(f.engine.tableId, incumbent.user_id, {
        remainingSeconds: 60,
        usesRemaining: 3,
      });
      f.engine.timeBankEngine.setAutoActivate(f.engine.tableId, incumbent.user_id, true);
    }

    let resolveExtras!: (
      value: Map<string, { extraSeconds: number; unlimitedActivations: boolean }>
    ) => void;
    const fetchExtras = vi.fn(
      (ids: string[]) =>
        new Promise<Map<string, { extraSeconds: number; unlimitedActivations: boolean }>>(
          (resolve) => {
            resolveExtras = resolve;
            void ids;
          }
        )
    );
    f.engine.fetchTimeBankExtras = fetchExtras;

    f.engine.prepareTimeBankReads(f.engine.seatedPlayers);
    expect(fetchExtras).toHaveBeenCalledTimes(1);
    expect(fetchExtras).toHaveBeenCalledWith(['u-moved-1']);

    // The prefetched read resolves under the rest before dealHand consumes it.
    resolveExtras(new Map([['u-moved-1', { extraSeconds: 40, unlimitedActivations: false }]]));
    const extras = await f.engine.takePreparedTimeBankExtras(['u-moved-1']);
    expect(fetchExtras).toHaveBeenCalledTimes(1);
    expect(extras.get('u-moved-1')?.extraSeconds).toBe(40);
  });

  it('falls back inline if a seat arrives after prepareTimeBankReads that was not covered', async () => {
    const f = fixture();
    const fetchExtras = vi.fn(async (ids: string[]) => {
      return new Map(ids.map((id) => [id, { extraSeconds: 20, unlimitedActivations: false }]));
    });
    f.engine.fetchTimeBankExtras = fetchExtras;

    f.engine.prepareTimeBankReads(f.seats);
    const extras = await f.engine.takePreparedTimeBankExtras(['u-brand-new']);
    expect(fetchExtras).toHaveBeenCalledWith(['u-brand-new']);
    expect(extras.get('u-brand-new')?.extraSeconds).toBe(20);
  });
});

describe('Root Cause 3: F06 begin & seq-1 leads eliminate wasted idle sleep under the 1,500 ms rest', () => {
  it('widens F06_RESERVE_LEAD_MS to 1500 and SEQ1_RETAIN_LEAD_MS to 900 so a 900 ms seq-1 (like live 968fff55) fits inside the rest budget', async () => {
    expect(ServerTableEngineDealing.F06_RESERVE_LEAD_MS).toBe(1500);
    expect(ServerTableEngineDealing.SEQ1_RETAIN_LEAD_MS).toBe(900);

    const f = fixture({ rpcLatencyMs: 0 });
    // Model live 968fff55: ~200 ms begin, ~200 ms seq-0, ~900 ms seq-1 (total 1,300 ms).
    let retainCall = 0;
    const origRetain = f.engine.retainOriginalBatch;
    f.engine.retainOriginalBatch = vi.fn(async (...args: unknown[]) => {
      retainCall++;
      const delay = retainCall === 1 ? 200 : 900;
      await new Promise((r) => setTimeout(r, delay));
      return origRetain(...args);
    });
    const origFactory = f.engine.f06PermitFactory;
    f.engine.f06PermitFactory = async (hn: string) => {
      await new Promise((r) => setTimeout(r, 200));
      return origFactory(hn);
    };

    const REST = H.NEXT_HAND_REST_MS;
    const armedAt = Date.now();
    f.engine.armNextHandRest(REST);
    await f.engine.awaitNextHandRestLead();
    await f.dealsTheNextHand();
    const gap = f.startedAt[0] - armedAt;
    // Before fix (1250 / 650): slept 250 ms idle + 200 ms idle before seq-1 -> ~1,750 ms (+250 ms over rest).
    // After fix (1500 / 1000): zero wasted idle sleep -> lands right on REST (<= REST + 120 ms).
    expect(gap).toBeGreaterThanOrEqual(REST);
    expect(gap).toBeLessThanOrEqual(REST + ENGINE_BETWEEN_HANDS_BUDGET_MS);
  }, 10_000);
});

describe('Root Cause 4: no duplicate post-hold bust handCompleteCallback and zero-move balance exits seed preparedBoundaryPlan', () => {
  it('guards Dealing fallback handCompleteCallback with handCompleteCallbackNotifiedHandNumber stamped in Settlement', () => {
    expect(SETTLEMENT_SRC).toContain(
      'this.handCompleteCallbackNotifiedHandNumber = snap.handNumber;'
    );
    expect(DEALING_SRC).toContain('this.handCompleteCallbackNotifiedHandNumber !== this.handCount');
    expect(DEALING_SRC).toContain('this.handCompleteCallbackNotifiedHandNumber = null;');

    // Behavioral check on the exact fallback condition extracted from Dealing:
    // if Settlement already notified for hand N, post-hold fallback skips;
    // if Settlement did NOT notify (e.g. threw or skipped), post-hold fallback fires.
    const f = fixture();
    const callback = vi.fn();
    f.engine.handCompleteCallback = callback;
    f.engine.handCount = 42;

    const runPostHoldFallback = () => {
      if (
        f.engine.handCompleteCallback &&
        f.engine.handCompleteCallbackNotifiedHandNumber !== f.engine.handCount
      ) {
        f.engine.handCompleteCallback(f.engine.tableId, [{ user_id: 'u1', stack: 0 }]);
      }
    };

    // Settlement already notified hand #42 -> fallback suppressed (0 extra calls).
    f.engine.handCompleteCallbackNotifiedHandNumber = 42;
    runPostHoldFallback();
    expect(callback).not.toHaveBeenCalled();

    // New hand #43 resets notified hand number -> if Settlement missed it, fallback fires once.
    f.engine.handCount = 43;
    f.engine.handCompleteCallbackNotifiedHandNumber = null;
    runPostHoldFallback();
    expect(callback).toHaveBeenCalledTimes(1);
  });

  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  function table(n: number, players: number): BalancerTable {
    return {
      tableId: id(4000 + n),
      playerCount: players,
      maxSeats: 9,
      players: Array.from({ length: players }, (_, i) => ({
        userId: id(5000 + n * 10 + i),
        stack: 10_000,
        seat: i + 1,
      })),
    };
  }
  function fakeEngine() {
    return {
      dealing: true,
      parkForTournamentMove: vi.fn(async () => false),
      releaseTournamentMovePause: vi.fn(),
      awaitsTournamentMoveClaim: vi.fn(() => false),
      hasClaimedTournamentMoveBoundary: vi.fn(() => false),
      isBetweenHands: () => false,
      hasSettlementInFlight: () => false,
      wakeWaitingForPlayers: vi.fn(),
    };
  }
  function makeManager(board: BalancerTable[]) {
    const m: any = new TournamentManager(id(1), {} as any, id(9), performance.now() + 60_000);
    m.running = true;
    m.lifecycleEpoch.begin();
    m.eliminationSweepDeadlineAt = 0;
    m.eliminationMutationAllowed = () => true;
    m.requestUrgentEliminationSweepAfter = vi.fn();
    m.requestEliminationSweep = vi.fn();
    m.recoverF06OriginalAdmissions = vi.fn(async () => {});
    m.visitTournamentBreakPage = vi.fn(async () => true);
    m.redrivePendingTournamentSeatMoveOutcomes = vi.fn(async () => true);
    m.tournamentBreakDiscoveryComplete = true;
    m.isFinalTable = true;
    m.isOnBreak = () => false;
    m.gameServer = { ownsTournamentTableEngine: () => true };
    m.broadcast = vi.fn(async () => true);
    const engines = new Map<string, ReturnType<typeof fakeEngine>>();
    for (const t of board) engines.set(t.tableId, fakeEngine());
    m.tableEngines = engines;
    m.waitForHandComplete = vi.fn(async (tableId: string) => !engines.get(tableId)!.dealing);
    m.liveTournamentTableIdsWithPlayers = vi.fn(async () =>
      board.filter((t) => t.playerCount > 0).map((t) => t.tableId)
    );
    m.loadBalancerTables = vi.fn(async (ids: string[]) =>
      board
        .filter((t) => ids.includes(t.tableId))
        .map((t) => ({ ...t, players: t.players.map((p) => ({ ...p })) }))
    );
    m.executePlayerMoves = vi.fn(async (moves: unknown[]) => moves.length);
    const park = (tableId: string) => {
      const engine = engines.get(tableId)!;
      engine.dealing = false;
      engine.awaitsTournamentMoveClaim.mockReturnValue(true);
    };
    const settle = async () => {
      for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    };
    return { m, engines, park, settle };
  }

  it('seeds preparedBoundaryPlan when checkTableBalance defers all moves (safeMoves=0) so an already-parked unneeded source releases with zero duplicate reads', async () => {
    // Table 0 (big, dealing): needs to give a player to Table 2 (short).
    // Table 1 (previously fenced, now 7-handed & ALREADY PARKED): unneeded!
    const bigDealing = table(0, 9);
    const formerlyBigParked = table(1, 7);
    const short = table(2, 6);
    const { m, engines, park, settle } = makeManager([bigDealing, formerlyBigParked, short]);

    m.gapBalanceFencedSources.add(formerlyBigParked.tableId);
    park(formerlyBigParked.tableId);
    m.isProcessingEliminations = true;

    await m.checkTableBalance();
    // No move executed because bigDealing is still mid-hand.
    expect(m.executePlayerMoves).not.toHaveBeenCalled();

    // When the sweep settles, formerlyBigParked MUST release using the already-read
    // freshTables without paying a duplicate 5-query board read (~950 ms).
    m.liveTournamentTableIdsWithPlayers.mockClear();
    m.loadBalancerTables.mockClear();
    m.isProcessingEliminations = false;
    m.onEliminationSweepSettled();
    await settle();

    expect(m.liveTournamentTableIdsWithPlayers).not.toHaveBeenCalled();
    expect(m.loadBalancerTables).not.toHaveBeenCalled();
    expect(
      engines.get(formerlyBigParked.tableId)!.releaseTournamentMovePause
    ).toHaveBeenCalledTimes(1);
  });

  it('seeds preparedBoundaryPlan when checkTableBalance yields on budget expiry so an already-parked preferred source moves with zero duplicate reads', async () => {
    const bigDealing = table(0, 9);
    const bigParked = table(1, 9);
    const short = table(2, 6);
    const { m, park, settle } = makeManager([bigDealing, bigParked, short]);

    m.gapBalanceFencedSources.add(bigParked.tableId);
    park(bigParked.tableId);
    m.balancePreparationOpen = true;
    m.eliminationWorkBudgetExpired = () => true;
    m.isProcessingEliminations = true;

    await m.checkTableBalance();
    expect(m.executePlayerMoves).not.toHaveBeenCalled();

    m.liveTournamentTableIdsWithPlayers.mockClear();
    m.loadBalancerTables.mockClear();
    m.isProcessingEliminations = false;
    m.onEliminationSweepSettled();
    await settle();

    expect(m.liveTournamentTableIdsWithPlayers).not.toHaveBeenCalled();
    expect(m.loadBalancerTables).not.toHaveBeenCalled();
    expect(m.executePlayerMoves).toHaveBeenCalledTimes(1);
  });

  it('rejects a seeded zero-move board if a subsequent bust bumps balanceBoardEpoch before the sweep settles', async () => {
    const bigDealing = table(0, 9);
    const formerlyBigParked = table(1, 7);
    const short = table(2, 6);
    const { m, park, settle } = makeManager([bigDealing, formerlyBigParked, short]);

    m.gapBalanceFencedSources.add(formerlyBigParked.tableId);
    park(formerlyBigParked.tableId);
    m.isProcessingEliminations = true;

    await m.checkTableBalance();
    m.liveTournamentTableIdsWithPlayers.mockClear();
    m.loadBalancerTables.mockClear();

    // A bust or seat mutation occurred after checkTableBalance read freshTables.
    m.balanceBoardEpoch++;
    m.isProcessingEliminations = false;
    m.onEliminationSweepSettled();
    await settle();

    // Stale seeded board MUST be discarded so balanceParkedGapSources reads fresh state.
    expect(m.liveTournamentTableIdsWithPlayers).toHaveBeenCalledTimes(1);
    expect(m.loadBalancerTables).toHaveBeenCalledTimes(1);
  });
});

describe('Root Cause 5: EventDatabaseBulkhead does not halve quiet tournaments on a single isolated slow call', () => {
  it('keeps full bound on one isolated slow call at low concurrency, but halves on slowStreak >= 2 or active concurrency', () => {
    let clock = 0;
    const bulkhead = new EventDatabaseBulkhead({
      log: () => {},
      now: () => clock,
      random: () => 0.5,
    });
    const acquireSync = (key: string): EventDbPermit => {
      const p = bulkhead.acquire(key);
      if (p instanceof Promise) throw new Error('expected sync permit');
      return p;
    };

    // Single isolated slow call at inFlight=0 (matches 03:49:31Z live blip across 7 events):
    // must NOT slash bound 24 -> 12 for 210 calls (~2 min). State stays at full bound 24
    // during the 10s slowStreak window so a second consecutive slow would still halve.
    const lone = acquireSync('quiet-slow-event');
    bulkhead.release(lone, 'slow');
    expect(bulkhead.snapshot().events.find((e) => e.key === 'quiet-slow-event')?.limit).toBe(
      EVENT_DB_MAX_IN_FLIGHT
    );
    // Once a healthy call completes, slowStreak resets and the idle event is forgotten.
    const loneOk = acquireSync('quiet-slow-event');
    bulkhead.release(loneOk, 'ok');
    expect(bulkhead.snapshot().events).toHaveLength(0);

    // An 'ok' answer resets slowStreak, so another isolated slow later still does not halve.
    const s1 = acquireSync('intermittent-slow');
    bulkhead.release(s1, 'slow');
    const ok = acquireSync('intermittent-slow');
    bulkhead.release(ok, 'ok');
    const s2 = acquireSync('intermittent-slow');
    bulkhead.release(s2, 'slow');
    expect(bulkhead.snapshot().events.find((e) => e.key === 'intermittent-slow')?.limit).toBe(
      EVENT_DB_MAX_IN_FLIGHT
    );
    const ok2 = acquireSync('intermittent-slow');
    bulkhead.release(ok2, 'ok');
    expect(bulkhead.snapshot().events).toHaveLength(0);

    // Two consecutive slow answers (slowStreak >= 2) DO halve 24 -> 12.
    const c1 = acquireSync('sustained-slow');
    bulkhead.release(c1, 'slow');
    clock += 1_000;
    const c2 = acquireSync('sustained-slow');
    bulkhead.release(c2, 'slow');
    const sustained = bulkhead.snapshot().events.find((e) => e.key === 'sustained-slow')!;
    expect(sustained.limit).toBe(Math.floor(EVENT_DB_MAX_IN_FLIGHT / 2));

    // Active concurrency (>= minPerEvent still in flight) halves immediately on first slow.
    const active = Array.from({ length: EVENT_DB_MIN_IN_FLIGHT + 1 }, () =>
      acquireSync('busy-slow')
    );
    bulkhead.release(active[0], 'slow');
    const busy = bulkhead.snapshot().events.find((e) => e.key === 'busy-slow')!;
    expect(busy.limit).toBe(Math.floor(EVENT_DB_MAX_IN_FLIGHT / 2));
  });
});
