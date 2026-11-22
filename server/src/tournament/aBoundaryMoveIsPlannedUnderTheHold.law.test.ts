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

    it('loadBalancerTables issues tables, table_seats, and tournament_players reads concurrently', () => {
      const src = readFileSync(
        fileURLToPath(new URL('./TournamentManager.ts', import.meta.url)),
        'utf8'
      );
      const start = src.indexOf('private async loadBalancerTables(');
      const body = src.slice(start, src.indexOf('const tableById = new Map(', start));
      expect(body).toContain('const [tableRead, seatRead, rosterRead] = await Promise.all([');
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
});
