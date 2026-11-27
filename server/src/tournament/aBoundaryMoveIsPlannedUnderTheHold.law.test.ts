/**
 * A BOUNDARY MOVE IS PLANNED UNDER THE HOLD (2026-11-20, incident 1e532243).
 *
 * fn_ca_hand_gap_watch paged at 08:31 and 09:31 CST on the ~50-table MTTs:
 * tournament hands whose roster changed before the next hand ran p95 1.45 to
 * 1.65 s of unintended delay between hands, against 0.19 s for every other
 * tournament hand. Move-source hands alone: p50 0.78 s, p95 4.33 s. The
 * fenced source parked after its completion hold and only THEN read the live
 * table list and the balancer board (five serial round trips) before making
 * the move; it could not deal until they finished. A source whose move
 * committed within a second of its hold ending showed the normal 130 ms.
 *
 * The law: the board is read when the fenced source settles its hand, under
 * the hold, and at the park only the committed seat moves execute; a plan
 * made stale by a sweep, a seat-move batch, a new bust or age is never used
 * (the park reads fresh, as before); and a table that is neither a move
 * source nor a destination is never parked, including a fenced source the
 * prepared plan no longer needs.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TournamentManager } from './TournamentManager.js';
import type { BalancerTable } from '../engine/TableBalancer.js';
import { supabase } from '../services/supabase.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const EVENT = id(1);
const GENERATION = id(9);

function table(n: number, players: number): BalancerTable {
  return {
    tableId: id(2000 + n),
    playerCount: players,
    maxSeats: 9,
    players: Array.from({ length: players }, (_, i) => ({
      userId: id(3000 + n * 10 + i),
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
    getCurrentButtonSeat: () => 0,
    wakeWaitingForPlayers: vi.fn(),
  };
}

function manager(board: BalancerTable[]) {
  const m: any = new TournamentManager(EVENT, {} as any, GENERATION, performance.now() + 60_000);
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
  const settleHand = (t: BalancerTable, busted: string[] = []) =>
    m.onManagedHandSettled(t.tableId, engines.get(t.tableId), [
      ...t.players.map((p) => ({ user_id: p.userId, stack: p.stack })),
      ...busted.map((user_id) => ({ user_id, stack: 0 })),
    ]);
  const readsAtTheBoundary = () =>
    m.loadBalancerTables.mock.calls.filter((call: unknown[]) => call[1] === 'balanceAtBoundary')
      .length;
  return { m, engines, park, settleHand, readsAtTheBoundary };
}

const settle = async () => {
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

afterEach(() => vi.restoreAllMocks());

describe('a boundary move is planned under the hold', () => {
  it('the board is read when the source settles, and the park only executes the moves', async () => {
    const big = table(0, 8);
    const short = table(1, 3);
    const { m, park, settleHand, readsAtTheBoundary } = manager([big, short]);
    await m.checkTableBalance();
    expect(m.gapBalanceFencedSources.has(big.tableId)).toBe(true);

    // The source settles its hand: the hold begins and the board is read now.
    m.liveTournamentTableIdsWithPlayers.mockClear();
    m.loadBalancerTables.mockClear();
    settleHand(big);
    await settle();
    expect(m.loadBalancerTables).toHaveBeenCalledWith(expect.any(Array), 'balancePrepared');

    // The hold ends and the source parks: no board read stands before the move.
    m.liveTournamentTableIdsWithPlayers.mockClear();
    m.loadBalancerTables.mockClear();
    park(big.tableId);
    expect(m.claimGapBalanceAtBoundary(big.tableId)).toBe(true);
    await settle();
    expect(m.liveTournamentTableIdsWithPlayers).not.toHaveBeenCalled();
    expect(m.loadBalancerTables).not.toHaveBeenCalled();
    expect(readsAtTheBoundary()).toBe(0);
    expect(m.executePlayerMoves).toHaveBeenCalledTimes(1);
    const moves = m.executePlayerMoves.mock.calls[0][0] as Array<{ fromTableId: string }>;
    expect(moves).toHaveLength(2);
    for (const move of moves) expect(move.fromTableId).toBe(big.tableId);
  });

  it('a park that arrives while the hold-time read is still running waits for that read, not a new one', async () => {
    const big = table(0, 8);
    const short = table(1, 3);
    const { m, park, settleHand } = manager([big, short]);
    await m.checkTableBalance();
    const read = m.loadBalancerTables.getMockImplementation();
    let finish!: () => void;
    m.loadBalancerTables.mockImplementation(
      (...args: unknown[]) =>
        new Promise((resolve) => {
          finish = () => resolve(read(...args));
        })
    );
    m.loadBalancerTables.mockClear();
    settleHand(big);
    await settle();
    park(big.tableId);
    m.claimGapBalanceAtBoundary(big.tableId);
    await settle();
    expect(m.executePlayerMoves).not.toHaveBeenCalled();
    finish();
    await settle();
    expect(m.loadBalancerTables).toHaveBeenCalledTimes(1);
    expect(m.loadBalancerTables.mock.calls[0][1]).toBe('balancePrepared');
    expect(m.executePlayerMoves).toHaveBeenCalledTimes(1);
  });

  it.each(['a sweep admitted', 'a bust at another table', 'a seat-move batch', 'age'] as const)(
    'a plan made stale by %s is never used: the park reads the board fresh',
    async (cause) => {
      // 21 players on three tables: balanced, never broken.
      const big = table(0, 9);
      const short = table(1, 5);
      const mid = table(2, 7);
      const { m, park, settleHand, readsAtTheBoundary } = manager([big, short, mid]);
      await m.checkTableBalance();
      settleHand(big);
      await settle();
      expect(m.preparedBoundaryPlan).not.toBeNull();

      if (cause === 'a sweep admitted') m.balanceBoardEpoch++;
      if (cause === 'a bust at another table') settleHand(mid, [id(7777)]);
      if (cause === 'a seat-move batch') {
        m.runWithTournamentSeatMoveAuthority = vi.fn(async () => 0);
        await (TournamentManager.prototype as any).executePlayerMoves.call(m, []);
      }
      if (cause === 'age') {
        const now = Date.now();
        vi.spyOn(Date, 'now').mockReturnValue(now + 60_000);
      }

      park(big.tableId);
      m.claimGapBalanceAtBoundary(big.tableId);
      await settle();
      expect(readsAtTheBoundary()).toBe(1);
      expect(m.executePlayerMoves).toHaveBeenCalledTimes(1);
    }
  );

  it('one bust reported twice (settlement, then the post-hold wake) counts once', async () => {
    const big = table(0, 8);
    const { m, settleHand } = manager([big, table(1, 3)]);
    const before = m.balanceBoardEpoch;
    settleHand(big, [id(8888)]);
    settleHand(big, [id(8888)]);
    expect(m.balanceBoardEpoch).toBe(before + 1);
  });

  it('a table that is neither a source nor a destination is never parked', async () => {
    // 21 players on three tables: 9/5/7 becomes 7/7/7; the 7 is untouched.
    const big = table(0, 9);
    const short = table(1, 5);
    const steady = table(2, 7);
    const { m, engines, park, settleHand } = manager([big, short, steady]);
    await m.checkTableBalance();
    settleHand(big);
    settleHand(steady);
    await settle();
    park(big.tableId);
    m.claimGapBalanceAtBoundary(big.tableId);
    await settle();
    expect(m.executePlayerMoves).toHaveBeenCalledTimes(1);
    const moves = m.executePlayerMoves.mock.calls[0][0] as Array<{
      fromTableId: string;
      toTableId: string;
    }>;
    for (const move of moves) {
      expect(move.fromTableId).not.toBe(steady.tableId);
      expect(move.toTableId).not.toBe(steady.tableId);
    }
    expect(engines.get(steady.tableId)!.parkForTournamentMove).not.toHaveBeenCalled();
    expect(engines.get(short.tableId)!.parkForTournamentMove).not.toHaveBeenCalled();
  });

  it('a fenced source the plan read under its hold no longer needs is given back before it parks', async () => {
    const big = table(0, 8);
    const short = table(1, 3);
    const { m, engines, settleHand } = manager([big, short]);
    await m.checkTableBalance();
    const engine = engines.get(big.tableId)!;
    const parkRequests = engine.parkForTournamentMove.mock.calls.length;

    // Three players bust at the big table on this hand and the short table
    // gains a late registration: 5/4, balanced.
    const busted = big.players.slice(5).map((p) => p.userId);
    big.players = big.players.slice(0, 5);
    big.playerCount = 5;
    short.players = [...short.players, { userId: id(9999), stack: 1, seat: 9 }];
    short.playerCount = 4;
    settleHand(big, busted);
    await settle();

    expect(engine.releaseTournamentMovePause).toHaveBeenCalledTimes(1);
    expect(m.gapBalanceFencedSources.has(big.tableId)).toBe(false);
    expect(engine.parkForTournamentMove.mock.calls.length).toBe(parkRequests);
    // Its dealer is not stopped at the gate: there is no edge left to claim.
    expect(m.claimGapBalanceAtBoundary(big.tableId)).toBe(false);
    expect(m.executePlayerMoves).not.toHaveBeenCalled();
  });

  it('a fence is never lifted beside a sweep, and the board is read again when the sweep settles', async () => {
    const big = table(0, 8);
    const short = table(1, 3);
    const { m, engines, settleHand } = manager([big, short]);
    await m.checkTableBalance();
    big.players = big.players.slice(0, 5);
    big.playerCount = 5;
    short.players = [...short.players, { userId: id(9999), stack: 1, seat: 9 }];
    short.playerCount = 4;
    m.isProcessingEliminations = true;
    settleHand(big);
    await settle();
    expect(m.loadBalancerTables).not.toHaveBeenCalledWith(expect.any(Array), 'balancePrepared');
    expect(engines.get(big.tableId)!.releaseTournamentMovePause).not.toHaveBeenCalled();
    expect(m.gapBalanceFencedSources.has(big.tableId)).toBe(true);

    // When that sweep settles with the source still in its hold, the board is
    // read again, under the same hold.
    m.isProcessingEliminations = false;
    m.onEliminationSweepSettled();
    await settle();
    expect(m.loadBalancerTables).toHaveBeenCalledWith(expect.any(Array), 'balancePrepared');
  });

  it('a fence is never lifted for a source already parked or claimed', async () => {
    const big = table(0, 8);
    const short = table(1, 3);
    const { m, engines, settleHand } = manager([big, short]);
    await m.checkTableBalance();
    big.players = big.players.slice(0, 5);
    big.playerCount = 5;
    short.players = [...short.players, { userId: id(9999), stack: 1, seat: 9 }];
    short.playerCount = 4;
    engines.get(big.tableId)!.hasClaimedTournamentMoveBoundary.mockReturnValue(true);
    settleHand(big);
    await settle();
    expect(engines.get(big.tableId)!.releaseTournamentMovePause).not.toHaveBeenCalled();
    expect(m.gapBalanceFencedSources.has(big.tableId)).toBe(true);
  });

  describe("the sweep's own plan lifts the fences it does not need (2026-11-21)", () => {
    // A bust at the fenced big table admits a sweep, which voids the plan read
    // under the hold. The sweep's balance stage plans from fresh rows; a fence
    // it does not need used to stand until the source parked and a later
    // boundary drain freed it (7973d396: parked 01:11:30.27, dealt 01:11:32.35).
    // 8/6 (gap 2, the 8 is fenced); two bust at the 8: 6/6, balanced. Twelve
    // players never fit one table, so no break step is involved.
    const bustTheBigTable = (big: BalancerTable) => {
      big.players = big.players.slice(0, 6);
      big.playerCount = 6;
    };

    it('a sweep that finds the field balanced hands the fenced source back while its hold plays', async () => {
      const big = table(0, 8);
      const short = table(1, 6);
      const { m, engines } = manager([big, short]);
      await m.checkTableBalance();
      expect(m.gapBalanceFencedSources.has(big.tableId)).toBe(true);
      bustTheBigTable(big);
      m.isProcessingEliminations = true;
      await m.checkTableBalance();
      expect(engines.get(big.tableId)!.releaseTournamentMovePause).toHaveBeenCalledTimes(1);
      expect(m.gapBalanceFencedSources.has(big.tableId)).toBe(false);
      expect(m.claimGapBalanceAtBoundary(big.tableId)).toBe(false);
    });

    it('a sweep keeps the fence on a source its fresh plan still names', async () => {
      const big = table(0, 8);
      const short = table(1, 6);
      const { m, engines } = manager([big, short]);
      await m.checkTableBalance();
      m.isProcessingEliminations = true;
      await m.checkTableBalance();
      expect(engines.get(big.tableId)!.releaseTournamentMovePause).not.toHaveBeenCalled();
      expect(m.gapBalanceFencedSources.has(big.tableId)).toBe(true);
    });

    it('a sweep frees a source that stopped being the big table and fences the new one', async () => {
      // 9/7/8 (a fenced); three bust at a: 6/7/8, now c is the big table.
      // 21 players need three tables, so no break step is involved.
      const a = table(0, 9);
      const b = table(1, 7);
      const c = table(2, 8);
      const { m, engines } = manager([a, b, c]);
      await m.checkTableBalance();
      expect(m.gapBalanceFencedSources.has(a.tableId)).toBe(true);
      expect(m.gapBalanceFencedSources.has(c.tableId)).toBe(false);
      a.players = a.players.slice(0, 6);
      a.playerCount = 6;
      m.isProcessingEliminations = true;
      await m.checkTableBalance();
      expect(engines.get(a.tableId)!.releaseTournamentMovePause).toHaveBeenCalledTimes(1);
      expect(m.gapBalanceFencedSources.has(a.tableId)).toBe(false);
      expect(m.gapBalanceFencedSources.has(c.tableId)).toBe(true);
    });

    it('a sweep never lifts a fence on a source already parked, claimed or held for a break', async () => {
      for (const hold of ['parked', 'claimed', 'break'] as const) {
        const big = table(0, 8);
        const short = table(1, 6);
        const { m, engines } = manager([big, short]);
        await m.checkTableBalance();
        bustTheBigTable(big);
        const engine = engines.get(big.tableId)!;
        if (hold === 'parked') engine.awaitsTournamentMoveClaim.mockReturnValue(true);
        if (hold === 'claimed') engine.hasClaimedTournamentMoveBoundary.mockReturnValue(true);
        if (hold === 'break') m.retainsTournamentBreakSource = () => true;
        m.isProcessingEliminations = true;
        await m.checkTableBalance();
        expect(engine.releaseTournamentMovePause).not.toHaveBeenCalled();
      }
    });

    it('a sweep never lifts a fence while move outcomes or recovery are pending', async () => {
      for (const pending of ['outcome', 'discovery'] as const) {
        const big = table(0, 8);
        const short = table(1, 6);
        const { m, engines } = manager([big, short]);
        await m.checkTableBalance();
        bustTheBigTable(big);
        if (pending === 'outcome') m.pendingTournamentSeatMoveOutcomes.set('x', {});
        if (pending === 'discovery') m.tournamentBreakDiscoveryComplete = false;
        m.isProcessingEliminations = true;
        try {
          await m.checkTableBalance();
        } catch {
          // A pending outcome may stop the stage earlier; either way no lift.
        }
        expect(engines.get(big.tableId)!.releaseTournamentMovePause).not.toHaveBeenCalled();
      }
    });
  });

  describe('a source that parks during a board read is moved or released in the same pass (2026-11-21, incident 1e532243)', () => {
    // Production 2026-11-22 02:34Z (event 2d444aeb): cb2d8fa8 parked while a
    // boundary balance was mid-read for d8b4fd33, and cbe6cd62 parked 63 ms
    // into a 2.3 s read for cb2d8fa8. Because `parked` was snapshotted before
    // the read, neither was moved or released, and drainBoundaryBalance then
    // yielded to a full sweep (boundaryBalanceOwesSweep), parking them 26-28 s.

    it('a fenced source that parks while balanceParkedGapSources is reading the board is moved in the same pass', async () => {
      // Three tables: a (9), b (9), c (5) -> balancer plans one move from a and one from b.
      const a = table(0, 9);
      const b = table(1, 9);
      const c = table(2, 5);
      const { m, park } = manager([a, b, c]);
      await m.checkTableBalance();
      expect(m.gapBalanceFencedSources.has(a.tableId)).toBe(true);
      expect(m.gapBalanceFencedSources.has(b.tableId)).toBe(true);

      const baseLoad = m.loadBalancerTables.getMockImplementation();
      let finishRead!: () => void;
      m.loadBalancerTables.mockImplementation(
        (...args: unknown[]) =>
          new Promise((resolve) => {
            finishRead = () => resolve(baseLoad(...args));
          })
      );

      // Table `a` parks first and starts the boundary balance board read.
      park(a.tableId);
      expect(m.claimGapBalanceAtBoundary(a.tableId)).toBe(true);
      await settle();
      expect(m.executePlayerMoves).not.toHaveBeenCalled();

      // Table `b` finishes its hand and parks WHILE the board read is in flight,
      // and a sweep also arrives so drainBoundaryBalance will yield after this pass.
      park(b.tableId);
      m.boundaryBalanceOwesSweep = true;
      finishRead();
      await settle();

      expect(m.executePlayerMoves).toHaveBeenCalledTimes(1);
      const movedFrom = new Set(
        (m.executePlayerMoves.mock.calls[0][0] as Array<{ fromTableId: string }>).map(
          (mv) => mv.fromTableId
        )
      );
      expect(movedFrom.has(a.tableId)).toBe(true);
      expect(movedFrom.has(b.tableId)).toBe(true);
      expect(m.gapBalanceFencedSources.has(b.tableId)).toBe(false);
    });

    it('a fenced source that parks during the board read and is no longer needed is released in the same pass', async () => {
      const a = table(0, 9);
      const b = table(1, 9);
      const c = table(2, 5);
      const { m, engines, park } = manager([a, b, c]);
      await m.checkTableBalance();

      const baseLoad = m.loadBalancerTables.getMockImplementation();
      let finishRead!: () => void;
      m.loadBalancerTables.mockImplementation(
        (...args: unknown[]) =>
          new Promise((resolve) => {
            finishRead = () => resolve(baseLoad(...args));
          })
      );

      // Now `a` and `b` both bust down to 6 players -> field is 6/6/5 (balanced).
      a.players = a.players.slice(0, 6);
      a.playerCount = 6;
      b.players = b.players.slice(0, 6);
      b.playerCount = 6;

      park(a.tableId);
      m.claimGapBalanceAtBoundary(a.tableId);
      await settle();

      // `b` parks while the board read is still in flight.
      park(b.tableId);
      finishRead();
      await settle();

      expect(m.executePlayerMoves).not.toHaveBeenCalled();
      expect(engines.get(a.tableId)!.releaseTournamentMovePause).toHaveBeenCalledTimes(1);
      expect(engines.get(b.tableId)!.releaseTournamentMovePause).toHaveBeenCalledTimes(1);
      expect(m.gapBalanceFencedSources.size).toBe(0);
    });

    it('a balanced boundary pass also lifts still-dealing unneeded fences so they never park', async () => {
      const a = table(0, 9);
      const b = table(1, 9);
      const c = table(2, 5);
      const { m, engines, park } = manager([a, b, c]);
      await m.checkTableBalance();
      // Field becomes balanced while `b` is still dealing.
      a.players = a.players.slice(0, 6);
      a.playerCount = 6;
      b.players = b.players.slice(0, 6);
      b.playerCount = 6;

      park(a.tableId);
      m.claimGapBalanceAtBoundary(a.tableId);
      await settle();

      expect(engines.get(a.tableId)!.releaseTournamentMovePause).toHaveBeenCalledTimes(1);
      expect(engines.get(b.tableId)!.releaseTournamentMovePause).toHaveBeenCalledTimes(1);
      expect(m.gapBalanceFencedSources.size).toBe(0);
    });

    it('onEliminationSweepSettled drains an already-parked fenced source even when boundaryBalanceRequested was cleared', async () => {
      const big = table(0, 8);
      const short = table(1, 3);
      const { m, park } = manager([big, short]);
      await m.checkTableBalance();
      park(big.tableId);
      m.boundaryBalanceRequested = false;
      m.isProcessingEliminations = false;

      m.onEliminationSweepSettled();
      await settle();

      expect(m.executePlayerMoves).toHaveBeenCalledTimes(1);
      expect(m.gapBalanceFencedSources.has(big.tableId)).toBe(false);
    });

    it('loadBalancerTables issues tables, table_seats, and tournament_players reads concurrently and fails closed on any partial read', async () => {
      const src = readFileSync(
        fileURLToPath(new URL('./TournamentManager.ts', import.meta.url)),
        'utf8'
      );
      const start = src.indexOf('private async loadBalancerTables(');
      const body = src.slice(start, src.indexOf('const tableById = new Map(', start));
      expect(body).toContain('const [tableRead, seatRead, rosterRead] = await Promise.all([');

      // Behavioral proof: all three queries are started concurrently BEFORE any
      // resolves, and any single query error fails closed (returns null).
      const a = table(0, 8);
      const b = table(1, 3);
      const m: any = new TournamentManager(
        EVENT,
        {} as any,
        GENERATION,
        performance.now() + 60_000
      );
      m.running = true;
      m.lifecycleEpoch.begin();
      m.eliminationMutationAllowed = () => true;

      const started: string[] = [];
      const resolvers = new Map<string, (v: { data: unknown; error: unknown }) => void>();
      const makeChain = (tbl: string) => {
        started.push(tbl);
        const promise = new Promise<{ data: unknown; error: unknown }>((resolve) => {
          resolvers.set(tbl, resolve);
        });
        const chain: any = {
          select: () => chain,
          in: () => chain,
          is: () => chain,
          eq: () => chain,
          then: promise.then.bind(promise),
        };
        return chain;
      };
      vi.spyOn(supabase, 'from').mockImplementation((tbl: string) => makeChain(tbl));

      const loadPromise = m.loadBalancerTables([a.tableId, b.tableId], 'balanceAtBoundary');
      await settle();
      // All three reads must already be in flight before the first resolves.
      expect(started).toEqual(['tables', 'table_seats', 'tournament_players']);

      resolvers.get('tables')!({
        data: [
          { id: a.tableId, max_players: 9 },
          { id: b.tableId, max_players: 9 },
        ],
        error: null,
      });
      resolvers.get('table_seats')!({
        data: [
          { table_id: a.tableId, user_id: a.players[0].userId, stack: 10_000, seat_number: 1 },
          { table_id: b.tableId, user_id: b.players[0].userId, stack: 10_000, seat_number: 1 },
        ],
        error: null,
      });
      resolvers.get('tournament_players')!({
        data: [
          { table_id: a.tableId, seat_number: 1 },
          { table_id: b.tableId, seat_number: 1 },
        ],
        error: null,
      });
      const loaded = await loadPromise;
      expect(loaded).not.toBeNull();
      expect(loaded).toHaveLength(2);

      // Now fail ONE of the three concurrent reads (tournament_players) -> fail closed (null).
      started.length = 0;
      resolvers.clear();
      const failPromise = m.loadBalancerTables([a.tableId, b.tableId], 'balanceAtBoundary');
      await settle();
      expect(started).toEqual(['tables', 'table_seats', 'tournament_players']);
      resolvers.get('tables')!({ data: [{ id: a.tableId, max_players: 9 }], error: null });
      resolvers.get('table_seats')!({ data: [], error: null });
      resolvers.get('tournament_players')!({ data: null, error: { message: 'boom' } });
      expect(await failPromise).toBeNull();
    });

    it('checkTableBalance budget-expired yield prefers an already-parked source over an unparked first source', async () => {
      const a = table(0, 9);
      const b = table(1, 9);
      const c = table(2, 5);
      const { m, engines, park } = manager([a, b, c]);
      // Mark `b` as already fenced and parked; `a` is still dealing and appears first.
      m.gapBalanceFencedSources.add(b.tableId);
      park(b.tableId);
      m.balancePreparationOpen = true;
      m.eliminationWorkBudgetExpired = () => true;

      await m.checkTableBalance();

      expect(engines.get(b.tableId)!.parkForTournamentMove).toHaveBeenCalledTimes(1);
      expect(engines.get(a.tableId)!.parkForTournamentMove).not.toHaveBeenCalled();
    });
  });

  it('the hand-complete edge reaches the preparation before the hold plays', () => {
    const base = readFileSync(
      fileURLToPath(new URL('./TournamentManagerBase.ts', import.meta.url)),
      'utf8'
    );
    const edge = base.slice(base.indexOf('engine.onHandComplete(('));
    const owns = edge.indexOf('if (!ownsEdge(_tableId)) return;');
    const prepare = edge.indexOf('this.onManagedHandSettled(_tableId, engine, finalStacks);');
    expect(owns).toBeGreaterThan(-1);
    expect(prepare).toBeGreaterThan(owns);
    // First thing after the ownership check, ahead of every other edge duty.
    expect(
      edge
        .slice(owns + 'if (!ownsEdge(_tableId)) return;'.length, prepare)
        .split('\n')
        .filter((l) => /^\s*(this\.|if )/.test(l))
    ).toEqual([]);
    const eliminations = readFileSync(
      fileURLToPath(new URL('./TournamentManagerEliminations.ts', import.meta.url)),
      'utf8'
    );
    // The statement right after a sweep takes the manager bumps the epoch.
    const statements = eliminations
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('//'));
    const admitted = statements.indexOf('this.isProcessingEliminations = true;');
    expect(admitted).toBeGreaterThan(-1);
    expect(statements[admitted + 1]).toBe('this.balanceBoardEpoch++;');
  });

  describe('a missed boundary probe or completion hold never orphans a gap-balance fence (2026-11-22, incident 1e532243)', () => {
    // Production 2026-11-22 on b31db252 (fb3edde2 20.55s, a515cc5d 20.47s,
    // 9646acc0 8.13s): waitForHandComplete returned true during the 1.85-7s
    // post-hand completion presentation hold, so checkTableBalance passed the
    // source into executePlayerMoves -> claimTournamentMoveBoundary ->
    // parkForTournamentMove(owner, 1000). The probe armed the pause owner,
    // timed out, returned false leaving the owner armed, and checkTableBalance
    // unconditionally deleted the source from gapBalanceFencedSources. When
    // the source parked seconds later, claimGapBalanceAtBoundary returned false
    // and releaseGapFencesNotIn ignored it, freezing the table for the full
    // 15,000 ms TOURNAMENT_MOVE_UNCLAIMED_PARK_MS expiry.

    it('waitForHandComplete returns false during the completion hold so checkTableBalance fences non-blocking', async () => {
      const big = table(0, 8);
      const short = table(1, 6);
      const { m, engines } = manager([big, short]);
      const bigEngine: any = engines.get(big.tableId)!;
      bigEngine.isBetweenHands = () => true;
      bigEngine.hasSettlementInFlight = () => false;
      bigEngine.isInCompletionPresentationHold = () => true;
      // Use the real waitForHandComplete implementation.
      m.waitForHandComplete = (TournamentManager.prototype as any).waitForHandComplete.bind(m);

      await m.checkTableBalance();

      expect(m.executePlayerMoves).not.toHaveBeenCalled();
      expect(m.gapBalanceFencedSources.has(big.tableId)).toBe(true);
      expect(bigEngine.parkForTournamentMove).toHaveBeenCalledWith(
        m.tournamentMoveBoundaryOwner,
        0
      );
    });

    it('a missed probe in claimTournamentMoveBoundary stays tracked so a balanced sweep lifts it and a park edge claims it', async () => {
      const big = table(0, 8);
      const short = table(1, 6);
      const { m, engines, park } = manager([big, short]);
      const bigEngine: any = engines.get(big.tableId)!;
      const pauseOwners = new Set<string>();
      bigEngine.dealing = false; // passes waitForHandComplete, simulating a race into a new hand or hold
      bigEngine.isBetweenHands = () => true;
      bigEngine.parkForTournamentMove = vi.fn(async (ownerId: string) => {
        pauseOwners.add(ownerId);
        return false; // probe times out leaving owner armed
      });
      bigEngine.releaseTournamentMovePause = vi.fn((ownerId: string) => {
        pauseOwners.delete(ownerId);
      });
      bigEngine.hasTournamentMovePauseOwner = vi.fn((ownerId: string) => pauseOwners.has(ownerId));
      m.gameServer.getTableEngine = (tableId: string) => engines.get(tableId) ?? null;
      m.redrivePendingTournamentSeatMoveOutcomesOwned = vi.fn(async () => true);
      m.runWithTournamentSeatMoveAuthority = async (fn: () => Promise<number>) => fn();
      m.executePlayerMoves = (TournamentManager.prototype as any).executePlayerMoves.bind(m);

      await m.checkTableBalance();

      // The pause owner was left armed by the missed probe and MUST remain tracked.
      expect(pauseOwners.has(m.tournamentMoveBoundaryOwner)).toBe(true);
      expect(m.gapBalanceFencedSources.has(big.tableId)).toBe(true);

      // Scenario A: the field balances before the table parks -> sweep lifts it
      // immediately instead of letting it sit for 15s TOURNAMENT_MOVE_UNCLAIMED_PARK_MS.
      big.players = big.players.slice(0, 6);
      big.playerCount = 6;
      await m.checkTableBalance();
      expect(bigEngine.releaseTournamentMovePause).toHaveBeenCalledWith(
        m.tournamentMoveBoundaryOwner
      );
      expect(pauseOwners.has(m.tournamentMoveBoundaryOwner)).toBe(false);
      expect(m.gapBalanceFencedSources.has(big.tableId)).toBe(false);

      // Scenario B: repeat with unbalanced field -> when the table finally parks,
      // claimGapBalanceAtBoundary claims it immediately at its own park edge.
      big.players = table(0, 8).players;
      big.playerCount = 8;
      await m.checkTableBalance();
      expect(m.gapBalanceFencedSources.has(big.tableId)).toBe(true);
      park(big.tableId);
      expect(m.claimGapBalanceAtBoundary(big.tableId)).toBe(true);
    });
  });

  describe('a balanced sweep hands its fresh board to parked sources and hold-fenced sources prepare under their hold (2026-11-22, incident 1e532243)', () => {
    // Production 2026-11-22 on ea92b56f (381c70ea +3044 ms at 20:22:56Z,
    // 02665ea8 +2373 ms at 20:27:07Z): a fenced source parked while a sweep
    // held isProcessingEliminations. checkTableBalance read freshTables and
    // proved the field balanced, left the already-parked source for the
    // boundary drain, and discarded freshTables. onEliminationSweepSettled
    // then paid a full duplicate 5-query board read (~950 ms) just to discover
    // the same balanced board and release the table.
    it('a balanced sweep seeds preparedBoundaryPlan for an already-parked fenced source so onEliminationSweepSettled releases it with zero duplicate reads', async () => {
      const big = table(0, 8);
      const short = table(1, 6);
      const { m, engines, park, readsAtTheBoundary } = manager([big, short]);
      await m.checkTableBalance();
      expect(m.gapBalanceFencedSources.has(big.tableId)).toBe(true);

      // Field becomes balanced (6/6) and the fenced source parks while a sweep holds the manager.
      big.players = big.players.slice(0, 6);
      big.playerCount = 6;
      park(big.tableId);
      m.isProcessingEliminations = true;
      await m.checkTableBalance();
      // Existing invariant preserved: the sweep itself does not directly release an already-parked source.
      expect(engines.get(big.tableId)!.releaseTournamentMovePause).not.toHaveBeenCalled();

      // The sweep settles: balanceParkedGapSources reuses freshTables with ZERO duplicate DB reads.
      m.liveTournamentTableIdsWithPlayers.mockClear();
      m.loadBalancerTables.mockClear();
      m.isProcessingEliminations = false;
      m.onEliminationSweepSettled();
      await settle();

      expect(m.liveTournamentTableIdsWithPlayers).not.toHaveBeenCalled();
      expect(m.loadBalancerTables).not.toHaveBeenCalled();
      expect(readsAtTheBoundary()).toBe(0);
      expect(engines.get(big.tableId)!.releaseTournamentMovePause).toHaveBeenCalledTimes(1);
      expect(m.gapBalanceFencedSources.size).toBe(0);
    });

    it('a bust arriving during checkTableBalance invalidates the seeded board so the boundary drain reads fresh', async () => {
      const big = table(0, 8);
      const short = table(1, 6);
      const { m, engines, park, settleHand, readsAtTheBoundary } = manager([big, short]);
      await m.checkTableBalance();

      big.players = big.players.slice(0, 6);
      big.playerCount = 6;
      park(big.tableId);

      const baseLoad = m.loadBalancerTables.getMockImplementation();
      m.loadBalancerTables.mockImplementation(async (ids: string[], tag: string) => {
        // A bust during STEP 1 forces STEP 2 to re-read balanceFresh, and a bust
        // during balanceFresh advances balanceBoardEpoch so the seeded board is
        // invalidated and the boundary drain reads fresh.
        if (tag === 'balanceInitial') settleHand(short, [id(7776)]);
        if (tag === 'balanceFresh') settleHand(short, [id(7777)]);
        return baseLoad(ids, tag);
      });

      m.isProcessingEliminations = true;
      await m.checkTableBalance();
      m.liveTournamentTableIdsWithPlayers.mockClear();
      m.loadBalancerTables.mockClear();
      m.isProcessingEliminations = false;
      m.onEliminationSweepSettled();
      await settle();

      expect(readsAtTheBoundary()).toBe(1);
      expect(engines.get(big.tableId)!.releaseTournamentMovePause).toHaveBeenCalledTimes(1);
    });

    it('fencing a source already in its completion hold registers it for hold-time board preparation once the sweep settles', async () => {
      const big = table(0, 8);
      const short = table(1, 6);
      const { m, engines } = manager([big, short]);
      const bigEngine: any = engines.get(big.tableId)!;
      bigEngine.isInCompletionPresentationHold = () => true;

      m.isProcessingEliminations = true;
      await m.checkTableBalance();
      expect(m.gapBalanceFencedSources.has(big.tableId)).toBe(true);

      m.loadBalancerTables.mockClear();
      m.isProcessingEliminations = false;
      m.onEliminationSweepSettled();
      await settle();

      expect(m.loadBalancerTables).toHaveBeenCalledWith(expect.any(Array), 'balancePrepared');
    });
  });

  describe('zero-break sweep reuse, parked-source tie-break, and post-balance sweep yield (1e532243)', () => {
    it('reuses STEP 1 board in STEP 2 when no tables broke and balanceBoardEpoch did not advance', async () => {
      const a = table(0, 8);
      const b = table(1, 8);
      const { m } = manager([a, b]);

      await m.checkTableBalance();

      expect(m.liveTournamentTableIdsWithPlayers).toHaveBeenCalledTimes(1);
      const tags = m.loadBalancerTables.mock.calls.map((c: unknown[]) => c[1]);
      expect(tags).toEqual(['balanceInitial']);
    });

    it('re-reads balanceFresh in STEP 2 when a bust advances balanceBoardEpoch during STEP 1', async () => {
      const a = table(0, 8);
      const b = table(1, 8);
      const { m, settleHand } = manager([a, b]);
      const baseLoad = m.loadBalancerTables.getMockImplementation();
      m.loadBalancerTables.mockImplementation(async (ids: string[], tag: string) => {
        if (tag === 'balanceInitial') settleHand(b, [id(9901)]);
        return baseLoad(ids, tag);
      });

      await m.checkTableBalance();

      expect(m.liveTournamentTableIdsWithPlayers).toHaveBeenCalledTimes(2);
      const tags = m.loadBalancerTables.mock.calls.map((c: unknown[]) => c[1]);
      expect(tags).toEqual(['balanceInitial', 'balanceFresh']);
    });

    it('chooses an already-parked 9-player table on a 9/9/7 tie instead of fencing a mid-hand 9-player table', async () => {
      // Array order places firstBig before secondBig; without tie-breaking,
      // calculateMoves keeps firstBig at 9 and picks secondBig to shed 1.
      const sweepCase = manager([table(0, 9), table(1, 9), table(2, 7)]);
      const firstBigId = id(2000);
      const secondBigId = id(2001);
      const shortId = id(2002);

      // 1. checkTableBalance sees firstBig already parked, moves from firstBig immediately,
      // and NEVER fences the mid-hand secondBig.
      sweepCase.m.gapBalanceFencedSources.add(firstBigId);
      sweepCase.park(firstBigId);
      await sweepCase.m.checkTableBalance();
      expect(sweepCase.m.gapBalanceFencedSources.has(secondBigId)).toBe(false);
      expect(sweepCase.engines.get(secondBigId)!.parkForTournamentMove).not.toHaveBeenCalled();
      expect(sweepCase.m.executePlayerMoves).toHaveBeenCalledTimes(1);
      const sweepMoves = sweepCase.m.executePlayerMoves.mock.calls[0][0] as Array<{
        fromTableId: string;
        toTableId: string;
      }>;
      expect(sweepMoves).toHaveLength(1);
      expect(sweepMoves[0].fromTableId).toBe(firstBigId);
      expect(sweepMoves[0].toTableId).toBe(shortId);

      // 2. balanceParkedGapSources moves from already-parked firstBig directly without fencing secondBig.
      const boundaryCase = manager([table(0, 9), table(1, 9), table(2, 7)]);
      boundaryCase.m.gapBalanceFencedSources.add(firstBigId);
      boundaryCase.park(firstBigId);
      await boundaryCase.m.balanceParkedGapSources();
      expect(boundaryCase.m.executePlayerMoves).toHaveBeenCalledTimes(1);
      const boundaryMoves = boundaryCase.m.executePlayerMoves.mock.calls[0][0] as Array<{
        fromTableId: string;
        toTableId: string;
      }>;
      expect(boundaryMoves).toHaveLength(1);
      expect(boundaryMoves[0].fromTableId).toBe(firstBigId);
      expect(boundaryMoves[0].toTableId).toBe(shortId);
      expect(boundaryCase.m.gapBalanceFencedSources.has(secondBigId)).toBe(false);
      expect(boundaryCase.engines.get(secondBigId)!.parkForTournamentMove).not.toHaveBeenCalled();
    });

    it('yields runEliminationSweep immediately after balanceStage when a parked gap-balance source awaits settlement, then resumes at expansionStage without livelock', async () => {
      const big = table(0, 9);
      const short = table(1, 7);
      const { m, park } = manager([big, short]);

      const order: string[] = [];
      m.eliminationSweepCursor.reset();
      // Start directly at balanceStage (stage 5) to isolate the stage 5 -> stage 6 yield.
      m.eliminationSweepCursor.advanceTo(5);
      m.checkTableBalance = vi.fn(async () => {
        order.push('balanceStage');
        m.gapBalanceFencedSources.add(big.tableId);
        park(big.tableId);
        return { kind: 'planning-complete' as const };
      });
      m.checkDynamicTableExpansion = vi.fn(async () => {
        order.push('expansionStage');
        return true;
      });
      // Stub manager wake inbox & hand-for-hand DB reads cleanly.
      vi.spyOn(supabase, 'from').mockImplementation(((relation: string) => {
        const q: Record<string, unknown> = {};
        for (const name of ['select', 'eq', 'in', 'is', 'order', 'gt', 'limit', 'not', 'lte']) {
          q[name] = () => q;
        }
        q.then = (resolve: (value: unknown) => unknown) =>
          Promise.resolve(
            relation === 'tournament_manager_wakes'
              ? { data: [], error: null }
              : { data: [], count: 16, error: null }
          ).then(resolve);
        return q;
      }) as never);
      m.onEliminationSweepSettled = vi.fn(() => {
        order.push('onEliminationSweepSettled');
        // Simulate boundary drain releasing the parked source.
        m.gapBalanceFencedSources.clear();
        m.boundaryBalanceRequested = false;
      });

      // Pass 1: balanceStage completes, sees parked source, yields before expansionStage!
      await m.runEliminationSweep(new AbortController().signal);
      expect(order).toEqual(['balanceStage', 'onEliminationSweepSettled']);
      expect(m.eliminationSweepCursor.nextStage).toBe(6);
      expect(m.requestEliminationSweep).toHaveBeenCalledTimes(1);

      // Pass 2: resumed sweep starts at stage 6 (skips balanceStage) and completes cleanly.
      await m.runEliminationSweep(new AbortController().signal);
      expect(order).toEqual([
        'balanceStage',
        'onEliminationSweepSettled',
        'expansionStage',
        'onEliminationSweepSettled',
      ]);
      expect(m.checkTableBalance).toHaveBeenCalledTimes(1);
      expect(m.checkDynamicTableExpansion).toHaveBeenCalledTimes(1);
    });

    it('reuses liveTournamentTableIdsWithPlayers tables/table_seats prefetch in loadBalancerTables so Wave 2 queries only tournament_players (1e532243)', async () => {
      const a = table(0, 6);
      const b = table(1, 6);
      const { m } = manager([a, b]);
      // Restore real methods to exercise the actual PostgREST prefetch handshake.
      delete m.liveTournamentTableIdsWithPlayers;
      delete m.loadBalancerTables;

      const queriedRelations: string[] = [];
      const chunkSizes: Array<{ relation: string; size: number }> = [];
      vi.spyOn(supabase, 'from').mockImplementation(((relation: string) => {
        queriedRelations.push(relation);
        let inSize = 0;
        const q: Record<string, unknown> = {};
        for (const name of ['select', 'eq', 'is', 'order', 'gt', 'limit']) q[name] = () => q;
        q.in = (col: string, vals: unknown[]) => {
          if (col === 'id' || col === 'table_id') inSize = vals.length;
          return q;
        };
        q.then = (resolve: (value: unknown) => unknown) => {
          if (inSize > 0) chunkSizes.push({ relation, size: inSize });
          if (relation === 'tables') {
            return Promise.resolve({
              data: [
                { id: a.tableId, max_players: 9 },
                { id: b.tableId, max_players: 9 },
              ],
              error: null,
            }).then(resolve);
          }
          if (relation === 'table_seats') {
            return Promise.resolve({
              data: [...a.players, ...b.players].map((p, idx) => ({
                id: id(8000 + idx),
                table_id: idx < a.players.length ? a.tableId : b.tableId,
                user_id: p.userId,
                stack: p.stack,
                seat_number: p.seat,
              })),
              error: null,
            }).then(resolve);
          }
          return Promise.resolve({
            data: [...a.players, ...b.players].map((p, idx) => ({
              table_id: idx < a.players.length ? a.tableId : b.tableId,
              seat_number: p.seat,
            })),
            error: null,
          }).then(resolve);
        };
        return q;
      }) as never);

      const liveIds = await m.liveTournamentTableIdsWithPlayers();
      expect(liveIds).toEqual([a.tableId, b.tableId]);
      expect(queriedRelations.sort()).toEqual(['table_seats', 'tables']);

      // Wave 2 consumes the same-epoch prefetch and queries ONLY tournament_players.
      queriedRelations.length = 0;
      const loaded = await m.loadBalancerTables(liveIds, 'balanceInitial');
      expect(queriedRelations).toEqual(['tournament_players']);
      expect(loaded).toHaveLength(2);
      expect(loaded[0].playerCount).toBe(6);
      expect(loaded[1].playerCount).toBe(6);

      // Prefetch is single-use: a second direct call queries all three tables.
      queriedRelations.length = 0;
      await m.loadBalancerTables(liveIds, 'balanceFresh');
      expect(queriedRelations.sort()).toEqual(['table_seats', 'tables', 'tournament_players']);
    });
  });
});
