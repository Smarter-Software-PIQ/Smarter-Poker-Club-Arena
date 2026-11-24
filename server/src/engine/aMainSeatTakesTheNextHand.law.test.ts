/**
 * LAW: when a Main seat opens, the player goes to Main on the NEXT hand
 * (Dan 2026-10-23, verbatim: "MAIN GAME MUST BE FED RIGHT AWAY WHEN A SEAT
 * OPENS UP. THERE SHOUDN'T BE A DELAY, NEXT HAND, PLAYER GOES TO THE MAIN
 * GAME. FIX WHAT EVER IT IS THATS BLOCKING THIS").
 *
 * #7873 moved a must-move to the first completed feeder boundary. Live on
 * c485ce7a (2026-10-24 09:05-09:11 UTC) two sub-second races were left, both
 * inside the two-second rest that the-next-hand-deals-two-seconds-after-
 * completion forbids anything to wait in:
 *   - a plan committed after the feeder's pre-deal read (0.9 s / 1.2 s before
 *     the deal) was dealt one more feeder hand;
 *   - a player whose transfer committed after Main's roster read (0.8 s /
 *     1.4 s before Main's deal) sat out Main's next hand.
 * The cure is a synchronous last look against in-process generations
 * (server/src/cluster/seatBoundarySignals.ts). These pins hold every edge of
 * it; the controller half is in
 * server/src/cluster/aCommittedPlanReachesItsFeederBeforeTheDeal.law.test.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const transport = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../services/supabase/client.js', () => ({
  supabase: transport,
  maintenanceSupabase: transport,
}));
vi.mock('../services/errorReporter.js', () => ({ reportError: vi.fn() }));
import { ServerTableEngine } from './ServerTableEngine.js';
import type { PendingSeatMove } from '../services/supabase/seatMoves.js';
import {
  noteMovesPlanned,
  noteSeatArrival,
  resetSeatBoundarySignalsForTest,
  seatArrivalGeneration,
  seatBoundaryListenerCountForTest,
} from '../cluster/seatBoundarySignals.js';

const feeder = '11111111-1111-4111-8111-111111111111';
const main = '22222222-2222-4222-8222-222222222222';
const sourceStay = '33333333-3333-4333-8333-333333333333';
const destinationStay = '44444444-4444-4444-8444-444444444444';
const player = '55555555-5555-4555-8555-555555555555';
const move = '66666666-6666-4666-8666-666666666666';
const other = '88888888-8888-4888-8888-888888888888';
const game = 'game-1';

const mustMove: PendingSeatMove = {
  move_id: move,
  player_id: player,
  source_occupancy_id: sourceStay,
  to_table_id: main,
  to_table_name: null,
  to_role: null,
  to_main_index: null,
  reason: 'must_move',
  announced_at: null,
  swap_move_id: null,
  ready_at: null,
};
const receipt = {
  ok: true,
  move_id: move,
  player_id: player,
  from_table_id: feeder,
  to_table_id: main,
  source_occupancy_id: sourceStay,
  destination_occupancy_id: destinationStay,
  source_seat_number: 1,
  to_seat_number: 2,
  stack: 25,
  idempotency_key: 'seatmove:' + move,
};

function engineAt(tableId: string, pending: PendingSeatMove[] = []) {
  const engine = Object.create(ServerTableEngine.prototype) as any;
  engine.tableId = tableId;
  engine.tableInfo = { cluster_id: game };
  engine.lifecycleCanMutate = vi.fn(() => true);
  engine.isTournamentTable = vi.fn(() => false);
  engine.seatedPlayers = [
    { user_id: player, occupancy_id: sourceStay, seat_number: 1 },
    { user_id: other, occupancy_id: other, seat_number: 3 },
  ];
  engine.announcedSeatMoves = new Set();
  engine.heldForSwap = new Set();
  engine.leaveHeldByClock = new Map();
  engine.seatMovePlanGenerationAtRead = 0;
  engine.seatArrivalGenerationAtRoster = 0;
  engine.depositPresenceForMove = vi.fn();
  engine.disconnectEngine = { unregisterPlayer: vi.fn() };
  engine.timeBankEngine = { removePlayer: vi.fn() };
  engine.timeBankMeta = new Map();
  engine.straddleEngine = { removePlayer: vi.fn() };
  engine.preActionEngine = { removePlayer: vi.fn() };
  engine.chipContinuity = { forget: vi.fn() };
  engine.hub = { emitEvent: vi.fn() };
  engine.broadcastCurrentState = vi.fn(async () => {});
  engine.wakeClusterGame = vi.fn();
  engine.setLoopPhase = vi.fn();
  engine.readPendingSeatMoves = vi.fn(async () => pending);
  return engine;
}

beforeEach(() => {
  vi.resetAllMocks();
  resetSeatBoundarySignalsForTest();
  transport.rpc.mockResolvedValue({ data: 1, error: null });
});

describe('FEEDER: a plan committed under the rest is executed before another feeder hand', () => {
  it('an ordinary deal sees no change and waits for nothing', async () => {
    const engine = engineAt(feeder);
    expect(await engine.announcePendingSeatMoves()).toBe(true);
    expect(engine.seatBoundaryChangedUnderRest()).toBe(false);
    expect(engine.setLoopPhase).not.toHaveBeenCalled();
  });

  it('a plan for this game committed after the read sends the loop round once more', async () => {
    const engine = engineAt(feeder);
    expect(await engine.announcePendingSeatMoves()).toBe(true);
    noteMovesPlanned(game); // 1440caa7: committed 0.9 s before the deal
    expect(engine.seatBoundaryChangedUnderRest()).toBe(true);
    expect(engine.setLoopPhase).toHaveBeenCalledWith('seat_move_planned_under_rest');
    // The next iteration's read sees it, executes it, and recaptures.
    engine.readPendingSeatMoves.mockResolvedValue([mustMove]);
    transport.rpc.mockResolvedValue({ data: receipt, error: null });
    expect(await engine.announcePendingSeatMoves()).toBe(true);
    expect(engine.seatedPlayers.map((p: any) => p.user_id)).toEqual([other]);
    expect(engine.seatBoundaryChangedUnderRest()).toBe(false);
  });

  it('a plan committed DURING the read is still caught (captured before, not after)', async () => {
    const engine = engineAt(feeder);
    engine.readPendingSeatMoves.mockImplementation(async () => {
      noteMovesPlanned(game);
      return [];
    });
    expect(await engine.announcePendingSeatMoves()).toBe(true);
    expect(engine.seatBoundaryChangedUnderRest()).toBe(true);
  });

  it("another game's plan does not delay this feeder", async () => {
    const engine = engineAt(feeder);
    expect(await engine.announcePendingSeatMoves()).toBe(true);
    noteMovesPlanned('another-game');
    expect(engine.seatBoundaryChangedUnderRest()).toBe(false);
  });
});

describe('MAIN: a player whose move committed under the rest is dealt into the next hand', () => {
  it('the source executor tells the destination the moment the transfer lands', async () => {
    const engine = engineAt(feeder, [mustMove]);
    transport.rpc.mockResolvedValue({ data: receipt, error: null });
    expect(seatArrivalGeneration(main)).toBe(0);
    expect(await engine.announcePendingSeatMoves()).toBe(true);
    expect(seatArrivalGeneration(main)).toBe(1);
    expect(seatArrivalGeneration(feeder)).toBe(0);
  });

  it('a refused transfer tells nobody', async () => {
    const engine = engineAt(feeder, [mustMove]);
    transport.rpc.mockResolvedValue({ data: { ok: false, reason: 'seat_taken' }, error: null });
    await engine.announcePendingSeatMoves();
    expect(seatArrivalGeneration(main)).toBe(0);
  });

  it('Main goes round once more for an arrival after its roster read, and only then', () => {
    const mainEngine = engineAt(main);
    mainEngine.captureSeatArrivalGeneration();
    expect(mainEngine.seatBoundaryChangedUnderRest()).toBe(false);
    noteSeatArrival(feeder); // somebody else's arrival
    expect(mainEngine.seatBoundaryChangedUnderRest()).toBe(false);
    noteSeatArrival(main); // 0152cb45: committed 0.8 s before Main's deal
    expect(mainEngine.seatBoundaryChangedUnderRest()).toBe(true);
    expect(mainEngine.setLoopPhase).toHaveBeenCalledWith('seat_arrived_under_rest');
    mainEngine.captureSeatArrivalGeneration(); // the re-read adopts the player
    expect(mainEngine.seatBoundaryChangedUnderRest()).toBe(false);
  });

  it('a tournament table never takes the last look', () => {
    const engine = engineAt(main);
    engine.isTournamentTable = vi.fn(() => true);
    noteSeatArrival(main);
    noteMovesPlanned(game);
    expect(engine.seatBoundaryChangedUnderRest()).toBe(false);
  });

  it('Main 1 ignores pure feeder->Main game-wide plans while still honoring swaps and real arrivals', async () => {
    const main1 = engineAt(main);
    main1.tableInfo = { cluster_id: game, role: 'main', main_index: 1 };
    const main2 = engineAt('99999999-9999-4999-8999-999999999999');
    main2.tableInfo = { cluster_id: game, role: 'main', main_index: 2 };
    const feederA = engineAt(feeder);
    feederA.tableInfo = { cluster_id: game, role: 'feeder', main_index: null };
    const feederB = engineAt('77777777-7777-4777-8777-777777777777');
    feederB.tableInfo = { cluster_id: game, role: 'feeder', main_index: null };

    for (const eng of [main1, main2, feederA, feederB]) {
      eng.captureSeatArrivalGeneration();
      expect(await eng.announcePendingSeatMoves()).toBe(true);
    }

    // Unspecified game-wide plan (pure feeder->Main): wakes feeders and Main 2, NOT Main 1.
    noteMovesPlanned(game);
    expect(main1.seatBoundaryChangedUnderRest()).toBe(false);
    expect(main2.seatBoundaryChangedUnderRest()).toBe(true);
    expect(feederA.seatBoundaryChangedUnderRest()).toBe(true);
    expect(feederB.seatBoundaryChangedUnderRest()).toBe(true);

    for (const eng of [main1, main2, feederA, feederB]) {
      expect(await eng.announcePendingSeatMoves()).toBe(true);
    }

    // Targeted plan naming only feederA: disturbs only feederA.
    noteMovesPlanned(game, [feeder]);
    expect(feederA.seatBoundaryChangedUnderRest()).toBe(true);
    expect(feederB.seatBoundaryChangedUnderRest()).toBe(false);
    expect(main1.seatBoundaryChangedUnderRest()).toBe(false);
    expect(main2.seatBoundaryChangedUnderRest()).toBe(false);

    // Swap explicitly naming Main 1: Main 1 DOES honor it.
    noteMovesPlanned(game, [main, feeder]);
    expect(main1.seatBoundaryChangedUnderRest()).toBe(true);
    expect(main1.setLoopPhase).toHaveBeenCalledWith('seat_move_planned_under_rest');
    expect(await main1.announcePendingSeatMoves()).toBe(true);
    expect(main1.seatBoundaryChangedUnderRest()).toBe(false);

    // Real seat arrival on Main 1: Main 1 ALWAYS honors it.
    noteSeatArrival(main);
    expect(main1.seatBoundaryChangedUnderRest()).toBe(true);
    expect(main1.setLoopPhase).toHaveBeenCalledWith('seat_arrived_under_rest');
  });

  it('cash rest wakes immediately on arrival or relevant plan WITHOUT clearing nextHandNotBeforeMs, leaving zero leaked listeners', async () => {
    vi.useFakeTimers();
    try {
      const startMs = 1_795_440_000_000;
      vi.setSystemTime(startMs);

      const main1 = engineAt(main);
      main1.tableInfo = { cluster_id: game, role: 'main', main_index: 1 };
      main1.settlePreparedHandNumber = vi.fn(async () => {});
      main1.accrueGapPhase = vi.fn();
      main1.seq1RestStopShortMs = 0;
      main1.lastCompletionAtMs = startMs;
      main1.gapSawIdle = false;
      main1.gapHadRebuyPause = false;
      main1.gapPhaseMs = {};
      main1.restBlindRead = null;
      main1.restBlindReadConsumed = false;
      main1.cashBreachSpan = null;
      main1.captureSeatArrivalGeneration();
      expect(await main1.announcePendingSeatMoves()).toBe(true);

      const deadline = startMs + 1500;
      main1.nextHandNotBeforeMs = deadline;

      let settled = false;
      const restPass1 = main1.awaitNextHandRest().then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(200);
      expect(settled).toBe(false);
      expect(seatBoundaryListenerCountForTest()).toBeGreaterThan(0);

      // Pure feeder->Main plan must NOT wake Main 1 early.
      noteMovesPlanned(game);
      await vi.advanceTimersByTimeAsync(200);
      expect(settled).toBe(false);

      // Real seat arrival at t=400ms wakes Main 1 IMMEDIATELY, keeping deadline intact.
      noteSeatArrival(main);
      await restPass1;
      expect(Date.now() - startMs).toBe(400);
      expect(main1.nextHandNotBeforeMs).toBe(deadline);
      expect(main1.lastCompletionAtMs).toBe(startMs);
      expect(seatBoundaryListenerCountForTest()).toBe(0);
      expect(main1.seatBoundaryChangedUnderRest()).toBe(true);

      // 2nd prepare pass runs inside remaining rest (~250ms), recaptures arrival, then finishes on time at t=1500ms.
      await vi.advanceTimersByTimeAsync(250);
      main1.captureSeatArrivalGeneration();
      const restPass2 = main1.awaitNextHandRest();
      await vi.advanceTimersByTimeAsync(850);
      await restPass2;
      expect(Date.now() - startMs).toBe(1500);
      expect(main1.nextHandNotBeforeMs).toBeNull();
      expect(main1.seatBoundaryChangedUnderRest()).toBe(false);
      expect(seatBoundaryListenerCountForTest()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the last look sits where the races were, and waits for nothing', () => {
  const ROOT = join(__dirname, '..', '..', '..');
  const strip = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  const DEALING = strip(
    readFileSync(join(ROOT, 'server/src/engine/ServerTableEngineDealing.ts'), 'utf8')
  );
  const BASE = strip(
    readFileSync(join(ROOT, 'server/src/engine/ServerTableEngineBase.ts'), 'utf8')
  );

  it('the arrival generation is captured immediately before the roster read', () => {
    expect(DEALING).toMatch(
      /this\.captureSeatArrivalGeneration\(\);\s*const \w+ = await this\.prepareNextHand\(\);/
    );
  });

  it('the plan generation is captured immediately before the pending-move read', () => {
    expect(BASE).toMatch(
      /this\.seatMovePlanGenerationAtRead = movesPlannedGeneration\(this\.tableInfo\?\.cluster_id\);\s*const pending = await this\.readPendingSeatMoves\(\);/
    );
  });

  it('the check runs after the rest and its pause gate, just ahead of the lease re-proof and the deal', () => {
    const rest = DEALING.indexOf('await this.awaitNextHandRest();');
    const pauseGate = DEALING.indexOf('if (this.isNextHandPaused()) {', rest);
    const look = DEALING.indexOf('if (this.seatBoundaryChangedUnderRest()) continue;');
    const deal = DEALING.indexOf("this.setLoopPhase('dealing');");
    const leaseProof = DEALING.lastIndexOf('if (!this.lifecycleCanMutate()) return;', deal);
    expect(rest).toBeGreaterThan(-1);
    expect(pauseGate).toBeGreaterThan(rest);
    expect(look).toBeGreaterThan(pauseGate);
    expect(leaseProof).toBeGreaterThan(look);
    expect(deal).toBeGreaterThan(leaseProof);
    // Nothing between the last look and the deal can wait on the unpaused
    // path; the gates there are the ones the rest law already admits.
    expect(DEALING.slice(look, leaseProof).replace(/\s+/g, ' ').trim()).toBe(
      'if (this.seatBoundaryChangedUnderRest()) continue;'
    );
    expect(DEALING.match(/seatBoundaryChangedUnderRest\(\)/g)).toHaveLength(1);
  });

  it('the check itself is synchronous: no async, no await, no promise', () => {
    const start = BASE.indexOf('protected seatBoundaryChangedUnderRest(): boolean {');
    const end = BASE.indexOf('\n  }\n', start);
    expect(start).toBeGreaterThan(-1);
    const body = BASE.slice(start, end);
    expect(body).not.toMatch(/\bawait\b|\basync\b|Promise|\.then\(/);
  });
});
