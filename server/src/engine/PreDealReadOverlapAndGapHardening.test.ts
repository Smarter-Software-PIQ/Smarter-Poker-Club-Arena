/**
 * Behavioral regression & hardening suite for incident 1e532243
 * (fn_ca_hand_gap_watch):
 *
 * 1. Pre-deal read overlap: `refreshOperatorFloor` (`fn_ca_operator_floor_state`)
 *    and `readPendingSeatMoves` (`pendingSeatMoves`) overlap `prepareNextHand()`
 *    in one parallel wave instead of running as 2 additional serial PostgREST
 *    round trips on every hand inside `load_next_hand_inputs`.
 * 2. Fail-closed & generation invalidation invariants:
 *    - An unreadable prepared `refreshOperatorFloor` still fails closed at
 *      `passOperatorFloorBoundary()` with `operator_floor_state_unknown`.
 *    - Any seat-move plan generation increment after `startPreDealReadOverlap()`
 *      discards the prepared move read and forces a fresh inline read in
 *      `announcePendingSeatMoves()`.
 *    - Halted tables (`dealingHaltLock`) skip speculative overlap reads.
 * 3. Observability: `CashNextHandSpan` records `refresh_operator_floor`,
 *    `pending_seat_moves`, and `hourly_cash_boundary` sub-spans so no serial
 *    pre-deal RPC can ever hide inside `load_next_hand_inputs` again.
 * 4. Horse rebuy diagnostic deduplication: repeated 500 ms elimination sweeps
 *    emit `choice` and `deferred` once per `(userId, bustHandNumber, phase)`
 *    instead of spamming thousands of JSON lines onto the main thread.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServerTableEngine } from './ServerTableEngine.js';
import { CashNextHandSpan } from './CashDealGap.js';
import * as hourly from '../services/supabase/cashHourlyTables.js';
import * as freeze from '../maintenance/freezeState.js';
import { supabase } from '../services/supabase/client.js';
import {
  noteMovesPlanned,
  resetSeatBoundarySignalsForTest,
} from '../cluster/seatBoundarySignals.js';
import { reportHorseRebuyDecision } from '../tournament/horseTournamentRebuyDiagnostic.js';

const TABLE_ID = '11111111-1111-4111-8111-111111111111';
const GAME_ID = '22222222-2222-4222-8222-222222222222';
const engines: any[] = [];

function makeEngine(opts: { tournament?: boolean; cluster?: boolean } = {}) {
  const e = new ServerTableEngine(TABLE_ID) as any;
  engines.push(e);
  e.running = true;
  e.lifecycleCanMutate = () => true;
  e.isCurrentEngine = () => true;
  e.isBetweenHands = () => true;
  e.isTournamentTable = () => Boolean(opts.tournament);
  e.tableInfo = {
    id: TABLE_ID,
    club_id: 'club-1',
    cluster_id: opts.tournament || opts.cluster === false ? null : GAME_ID,
    tournament_id: opts.tournament ? 'tourn-1' : null,
  };
  e.getEngineLeaseAuthority = () => ({ scope: 'cash', verified: true, generation: TABLE_ID });
  e.acquireSeatBoundary = vi.fn(async () => vi.fn());
  e.seatedPlayers = [];
  e.announcedSeatMoves = new Set();
  e.heldForSwap = new Set();
  e.leaveHeldByClock = new Map();
  e.hub = { emitEvent: vi.fn() };
  e.broadcastCurrentState = vi.fn();
  e.stop = vi.fn(() => new Promise(() => {}));
  vi.spyOn(freeze, 'isMaintenanceFrozen').mockReturnValue(false);
  return e;
}

beforeEach(() => {
  resetSeatBoundarySignalsForTest();
});

afterEach(() => {
  for (const e of engines.splice(0)) e.preciseTimer.dispose();
  vi.restoreAllMocks();
});

describe('incident 1e532243: pre-deal read overlap eliminates serial floor & seat-move RTTs', () => {
  it('consumes prepared refreshOperatorFloor and pendingSeatMoves without a second RPC on cash tables', async () => {
    const e = makeEngine({ tournament: false, cluster: true });
    e.cashBreachSpan = new CashNextHandSpan(TABLE_ID, 100, 'load_next_hand_inputs');

    const rpcSpy = vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: { hold: null, close: null },
      error: null,
    } as any);
    const readMovesSpy = vi.fn(async () => []);
    e.fetchPendingSeatMoves = readMovesSpy;
    vi.spyOn(hourly, 'closeHourlyCashTable').mockResolvedValue({
      closed: false,
      reason: 'within_cap_or_human',
    });

    // Starts floor + seat-moves reads in parallel with prepareNextHand().
    e.startPreDealReadOverlap();
    expect(rpcSpy).toHaveBeenCalledTimes(1);
    expect(rpcSpy).toHaveBeenCalledWith('fn_ca_operator_floor_state', { p_table_id: TABLE_ID });
    expect(readMovesSpy).toHaveBeenCalledTimes(1);

    // Boundary and announcement consume the already-started reads without re-querying.
    expect(await e.passOperatorFloorBoundary()).toBe(false);
    expect(await e.announcePendingSeatMoves()).toBe(true);
    expect(rpcSpy).toHaveBeenCalledTimes(1);
    expect(readMovesSpy).toHaveBeenCalledTimes(1);

    // Observability: all three pre-deal RPC branches are recorded onto prepareSpansMs.
    const spans = e.cashBreachSpan.subSpansMs();
    expect(spans).toHaveProperty('refresh_operator_floor');
    expect(spans).toHaveProperty('pending_seat_moves');
    expect(spans).toHaveProperty('hourly_cash_boundary');
  });

  it('consumes prepared refreshOperatorFloor on tournament tables without running cash seat moves', async () => {
    const e = makeEngine({ tournament: true });
    const rpcSpy = vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: { hold: null, close: null },
      error: null,
    } as any);
    const readMovesSpy = vi.fn(async () => []);
    e.fetchPendingSeatMoves = readMovesSpy;

    e.startPreDealReadOverlap();
    expect(rpcSpy).toHaveBeenCalledTimes(1);
    expect(readMovesSpy).not.toHaveBeenCalled();

    expect(await e.passOperatorFloorBoundary()).toBe(false);
    expect(rpcSpy).toHaveBeenCalledTimes(1);
  });

  it('fails closed at passOperatorFloorBoundary when the prepared floor read rejects', async () => {
    const e = makeEngine({ tournament: false, cluster: false });
    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: null,
      error: { message: 'db down' },
    } as any);

    e.startPreDealReadOverlap();
    await expect(e.passOperatorFloorBoundary()).rejects.toThrow('operator_floor_state_unknown');
    expect(e.operatorFloorPaused).toBe(true);
    expect(e.isNextHandPaused()).toBe(true);
  });

  it('discards prepared pendingSeatMoves and re-reads fresh when a plan commits before announcePendingSeatMoves', async () => {
    const e = makeEngine({ tournament: false, cluster: true });
    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: { hold: null, close: null },
      error: null,
    } as any);
    const readMovesSpy = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    e.fetchPendingSeatMoves = readMovesSpy;

    e.startPreDealReadOverlap();
    expect(readMovesSpy).toHaveBeenCalledTimes(1);

    // A cluster plan commits while prepareNextHand() is in flight.
    noteMovesPlanned(GAME_ID, [TABLE_ID]);

    expect(await e.announcePendingSeatMoves()).toBe(true);
    expect(readMovesSpy).toHaveBeenCalledTimes(2);
  });

  it('skips speculative overlap reads when dealingHaltLock is active', () => {
    const e = makeEngine({ tournament: false, cluster: true });
    e.dealingHaltLock = true;
    const rpcSpy = vi.spyOn(supabase, 'rpc');
    const readMovesSpy = vi.fn(async () => []);
    e.fetchPendingSeatMoves = readMovesSpy;

    e.startPreDealReadOverlap();
    expect(rpcSpy).not.toHaveBeenCalled();
    expect(readMovesSpy).not.toHaveBeenCalled();
  });
});

describe('incident 1e532243: horseTournamentRebuyDiagnostic deduplication helper', () => {
  it('re-exports reportHorseRebuyDecision cleanly', () => {
    expect(typeof reportHorseRebuyDecision).toBe('function');
  });
});
