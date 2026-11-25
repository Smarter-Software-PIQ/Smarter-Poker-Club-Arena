/**
 * A MOVE TAKES A CHAIR THAT IS FREE WHEN IT LANDS (2026-11-25).
 *
 * The balancer plans every chair from one snapshot and then moves players one
 * at a time. During late registration, new entrants are seated into the same
 * freshly created tables (lowest free chair) while those moves are in flight,
 * so the planned chair was often already taken when the request reached
 * fn_move_tournament_player, which refused it with "tournament move
 * destination seat is occupied". Production 2026-11-25 00:53 to 02:13 UTC:
 * every burst of that refusal lined up with new tables being filled by late
 * registrants (event ffa1d1f9, tables 6b3ddb79, 7adc88ba, 2fecbf85, 5437fac3,
 * 33273b13).
 *
 * The law: the chair is read at the door. A planned chair that is still free
 * is kept; a taken one is replaced by a free chair chosen by the planner's own
 * blind-position rule; a full destination waits for the next pass without an
 * error; one definite "occupied" refusal (a clean rollback) gets one fresh read
 * and one new request id. The database door stays the authority.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const moveRpc = vi.hoisted(() => vi.fn());
const reportError = vi.hoisted(() => vi.fn());
vi.mock('./tournamentSeatMoveRpc.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./tournamentSeatMoveRpc.js')>();
  return { ...actual, moveTournamentPlayerAtomically: moveRpc };
});
vi.mock('../services/errorReporter.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, reportError };
});

import { TournamentManager } from './TournamentManager.js';
import { TournamentSeatMoveRefusedError } from './tournamentSeatMoveRpc.js';
import { chooseOpenSeat, type BalancerTable } from '../engine/TableBalancer.js';

const TOURNAMENT_ID = '00000000-0000-4000-8000-0000000000b1';
const SOURCE_ID = '00000000-0000-4000-8000-0000000000b2';
const DESTINATION_ID = '00000000-0000-4000-8000-0000000000b3';
const PLAYER = '00000000-0000-4000-8000-0000000000b4';

function receipt(input: any): any {
  return {
    requestId: input.requestId,
    tournamentId: input.tournamentId,
    userId: input.userId,
    sourceTableId: input.sourceTableId,
    destinationTableId: input.destinationTableId,
    sourceSeatId: '00000000-0000-4000-8000-0000000000b6',
    destinationSeatId: '00000000-0000-4000-8000-0000000000b7',
    sourceSeatNumber: 2,
    destinationSeatNumber: input.destinationSeatNumber,
    stack: 100,
    movedAt: '2026-11-25T02:00:00.000Z',
    replayed: false,
    sourceMode: input.sourceMode,
  };
}

function destination(seats: number[], reserved: number[] = [], maxSeats = 9): BalancerTable {
  return {
    tableId: DESTINATION_ID,
    playerCount: seats.length,
    maxSeats,
    buttonSeat: 0,
    reservedSeats: reserved,
    players: seats.map((seat, i) => ({ userId: `p${i}`, stack: 100, seat })),
  };
}

function harness(reads: Array<BalancerTable[] | null | Error>) {
  const engine = {
    parkForTournamentMove: vi.fn().mockResolvedValue(true),
    releaseTournamentMovePause: vi.fn(),
    executeTournamentMoveAtBoundary: vi.fn(async (_o: string, op: () => Promise<any>) => op()),
    hasReleasedProcessOwnership: vi.fn(() => true),
    hasClaimedTournamentMoveBoundary: vi.fn(() => false),
    presenceForTournamentMove: vi.fn(() => null),
  };
  const gameServer = {
    getTableEngine: vi.fn(() => engine),
    ownsTournamentTableEngine: vi.fn(() => true),
  };
  const manager = new TournamentManager(TOURNAMENT_ID, gameServer as never) as any;
  manager.running = true;
  manager.eliminationSweepSignal = null;
  manager.eliminationSweepDeadlineAt = 0;
  manager.tableEngines = new Map([[SOURCE_ID, engine]]);
  manager.requestUrgentEliminationSweepAfter = vi.fn();
  const queue = [...reads];
  manager.loadBalancerTables = vi.fn(async () => {
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next instanceof Error) throw next;
    return next;
  });
  return { manager };
}

const move = (toSeat = 3) => ({
  playerId: PLAYER,
  fromTableId: SOURCE_ID,
  fromSeat: 2,
  toTableId: DESTINATION_ID,
  toSeat,
  reason: 'Balance: source to destination',
  sourceHops: null,
});

const occupied = () =>
  new TournamentSeatMoveRefusedError('tournament move destination seat is occupied');

beforeEach(() => {
  moveRpc.mockReset();
  reportError.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe('a move takes a chair that is free when it lands', () => {
  it('keeps the planned chair when it is still free', async () => {
    const { manager } = harness([[destination([1, 2])]]);
    moveRpc.mockImplementation(async (input: any) => receipt(input));
    await expect(manager.executePlayerMoves([move(3)])).resolves.toBe(1);
    expect(moveRpc).toHaveBeenCalledTimes(1);
    expect(moveRpc.mock.calls[0][0].destinationSeatNumber).toBe(3);
  });

  it('replaces a chair a late registrant took after the plan', async () => {
    // Planned seat 3; a late registrant sat in 3 and a roster chair holds 4.
    const { manager } = harness([[destination([1, 2, 3], [4])]]);
    moveRpc.mockImplementation(async (input: any) => receipt(input));
    await expect(manager.executePlayerMoves([move(3)])).resolves.toBe(1);
    expect(moveRpc.mock.calls[0][0].destinationSeatNumber).toBe(5);
    expect(reportError).not.toHaveBeenCalled();
  });

  it('retries one definite occupied refusal with a fresh chair and a new request id', async () => {
    const { manager } = harness([[destination([1, 2])], [destination([1, 2, 3])]]);
    moveRpc
      .mockImplementationOnce(async () => {
        throw occupied();
      })
      .mockImplementation(async (input: any) => receipt(input));
    await expect(manager.executePlayerMoves([move(3)])).resolves.toBe(1);
    expect(moveRpc).toHaveBeenCalledTimes(2);
    const [first, second] = moveRpc.mock.calls.map((c) => c[0]);
    expect(first.destinationSeatNumber).toBe(3);
    expect(second.destinationSeatNumber).toBe(4);
    expect(second.requestId).not.toBe(first.requestId);
    expect(reportError).not.toHaveBeenCalled();
  });

  it('waits for the next pass, without an error, when the destination filled up', async () => {
    const { manager } = harness([[destination([1, 2, 3, 4, 5, 6], [], 6)]]);
    await expect(manager.executePlayerMoves([move(3)])).resolves.toBe(0);
    expect(moveRpc).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
    expect(manager.requestUrgentEliminationSweepAfter).toHaveBeenCalled();
  });

  it('keeps the planned chair when the read fails, and the door decides', async () => {
    const { manager } = harness([new Error('read failed')]);
    moveRpc.mockImplementation(async (input: any) => receipt(input));
    await expect(manager.executePlayerMoves([move(3)])).resolves.toBe(1);
    expect(moveRpc.mock.calls[0][0].destinationSeatNumber).toBe(3);
  });

  it('reports a second refusal of a chair the fresh read called free', async () => {
    const { manager } = harness([[destination([1, 2])]]);
    moveRpc.mockImplementation(async () => {
      throw occupied();
    });
    await expect(manager.executePlayerMoves([move(3)])).resolves.toBe(0);
    expect(moveRpc).toHaveBeenCalledTimes(2);
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it('never retries a refusal that is not a lost chair', async () => {
    const { manager } = harness([[destination([1, 2])]]);
    moveRpc.mockImplementation(async () => {
      throw new TournamentSeatMoveRefusedError('tournament move source is not live');
    });
    await expect(manager.executePlayerMoves([move(3)])).resolves.toBe(0);
    expect(moveRpc).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledTimes(1);
  });
});

describe('the door and the planner choose by one rule', () => {
  it('never picks a live or roster-held chair', () => {
    const choice = chooseOpenSeat(destination([1, 2, 3], [4, 6]));
    expect(choice.seat).toBe(5);
  });

  it('reports a full table as no chair', () => {
    expect(chooseOpenSeat(destination([1, 2], [3], 3)).seat).toBe(-1);
  });
});
