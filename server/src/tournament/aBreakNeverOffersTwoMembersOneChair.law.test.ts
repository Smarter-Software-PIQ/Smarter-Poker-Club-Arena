/**
 * LAW: A BREAK NEVER OFFERS TWO MEMBERS ONE CHAIR (2026-11-27).
 *
 * "tournament move destination seat is occupied" kept coming in pairs about
 * 100 ms apart, in bursts every 4 to 5 s, on the release that already sent a
 * refused move once (PR #12156): 88 lines from 6 PM to 3 AM Chicago,
 * 2026-11-26/27, every hour an even count. smarter_private.f06_attempts names every chair those requests
 * asked for. Break b5685db5 (table 32756123, Midnight Free Buy 01cee40b):
 *
 *   a6cd08f3  rev 1 dbc1b125#8 fenced, rev 2 0ec2f753#8 landed 07:22:40.554
 *   c402b38e  rev 1 edfd7354#9 fenced, rev 2 0ec2f753#8 fenced,
 *             rev 3 18a0c315#4 landed 07:22:45.161
 *   ecd88691  rev 1 edfd7354#2 fenced, rev 2 0ec2f753#8 fenced,
 *             rev 3 18a0c315#4 fenced, rev 4 2242b9fc#7 landed 07:22:48.697
 *
 * and the breaks of 64f30f03 (three members to 0c9285f3#1, then two to
 * 0ec2f753#7) and 58f82b7f (three to 0c9285f3#8, then two to 4d9986ee#5) the
 * same. `repairTournamentBreakDestinations` replaced each member whose chair
 * was taken from a board of seated players and roster chairs. A chair promised
 * to another unlanded member of the same break is in neither, so every member
 * replaced in one pass was offered the same best chair, the first landed and
 * each other was refused, and the losers were given one chair again next pass.
 * Each refusal was then sent twice: a break attempt is dispatched as an outcome
 * that may already be unknown, which keeps the identical resend even for an id
 * this manager had just minted and never sent.
 *
 * The law: a replacement is chosen with the chairs of the break's other
 * unlanded members reserved; a chair an earlier unlanded member holds counts
 * as taken; an attempt id minted here and never sent is sent once when the door
 * refuses it, while an id that may have been sent before keeps its replay. A
 * gap move whose destination a pending break holds waits, door reads never
 * take the pre-move board prefetch, and a table count leaves no prefetch for a
 * later read to take.
 *
 * Ships with the next certified engine cutover after merge.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const moveRpc = vi.hoisted(() => vi.fn());
vi.mock('./tournamentSeatMoveRpc.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./tournamentSeatMoveRpc.js')>();
  return { ...actual, moveTournamentPlayerAtomically: moveRpc };
});

import { TournamentManager } from './TournamentManager.js';
import { supabase } from '../services/supabase.js';
import { TournamentSeatMoveRefusedError } from './tournamentSeatMoveRpc.js';
import {
  boardWithHeldChairs,
  chairHeldByEarlierUnlandedMember,
  chairsHeldByUnlandedBreakMembers,
} from './breakChairReservations.js';
import type { BalancerTable } from '../engine/TableBalancer.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SOURCE = id(3);
const BREAK = id(2);
const TAKEN = id(80); // the table whose planned chairs late entrants filled
const OPEN = id(81); // the table with free chairs for replacements

function member(n: number, destination = TAKEN, seat = n) {
  return {
    user_id: id(100 + n),
    source_seat_id: id(200 + n),
    source_seat_number: n,
    occupancy_id: id(300 + n),
    request_id: id(400 + n),
    destination_table_id: destination,
    destination_seat_number: seat,
    original_destination_table_id: destination,
    original_destination_seat_number: seat,
    active_request_id: id(400 + n),
    winner_request_id: null as string | null,
    winning_receipt: null,
    attempt_revision: 1,
  };
}

function breakState(members: ReturnType<typeof member>[]): any {
  return {
    ok: true,
    reason: null,
    break_id: BREAK,
    tournament_id: id(1),
    source_table_id: SOURCE,
    lifecycle: '1',
    state: 'begun',
    revision: '1',
    custody_id: null,
    custody_generation: null,
    terminal_handoff_required: false,
    members,
  };
}

function table(tableId: string, seats: number[], maxSeats = 9): BalancerTable {
  return {
    tableId,
    playerCount: seats.length,
    maxSeats,
    buttonSeat: 0,
    reservedSeats: [],
    players: seats.map((seat) => ({ userId: `${tableId}-${seat}`, seat, stack: 100 })),
  };
}

function manager() {
  const m: any = new TournamentManager(id(1), {} as any, id(9), performance.now() + 60000);
  m.running = true;
  m.eliminationSweepDeadlineAt = 0;
  m.requestUrgentEliminationSweepAfter = vi.fn();
  return m;
}

/** The f06 amend door: installs the proposal exactly as SQL did in production. */
function amendDoor(durable: { state: any }) {
  const proposals: Array<{ user: string; table: string; seat: number }> = [];
  vi.spyOn(supabase, 'rpc').mockImplementation((async (name: string, p: any) => {
    if (name === 'fn_f06_break_state') return { data: durable.state, error: null };
    proposals.push({
      user: p.p_user_id,
      table: p.p_destination_table_id,
      seat: p.p_destination_seat_number,
    });
    durable.state = {
      ...durable.state,
      members: durable.state.members.map((m: any) =>
        m.user_id === p.p_user_id
          ? {
              ...m,
              active_request_id: p.p_new_request_id,
              destination_table_id: p.p_destination_table_id,
              destination_seat_number: p.p_destination_seat_number,
              attempt_revision: m.attempt_revision + 1,
            }
          : m
      ),
    };
    return { data: durable.state, error: null };
  }) as any);
  return proposals;
}

beforeEach(() => moveRpc.mockReset());
afterEach(() => vi.restoreAllMocks());

describe('a break never offers two members one chair', () => {
  it('replaces three members whose chairs were taken with three different chairs in one pass', async () => {
    const m = manager();
    // Production shape: every planned chair on TAKEN filled; OPEN has room.
    // The board is re-read after every amendment and never shows the chairs
    // the earlier amendments promised (they are attempts, not seats).
    m.eligibleBreakDestinations = vi.fn(async () => [
      table(TAKEN, [1, 2, 3, 4, 5, 6, 7, 8, 9]),
      table(OPEN, [1, 2, 3, 4]),
    ]);
    const durable = { state: breakState([member(1), member(2), member(3)]) };
    const proposals = amendDoor(durable);

    const result = await m.repairTournamentBreakDestinations(durable.state);

    expect(proposals).toHaveLength(3);
    const chairs = proposals.map((p) => `${p.table}#${p.seat}`);
    // The old behavior offered all three the same chair (0ec2f753#8 in production).
    expect(new Set(chairs).size).toBe(3);
    for (const p of proposals) {
      expect(p.table).toBe(OPEN);
      expect([1, 2, 3, 4]).not.toContain(p.seat);
    }
    const finalChairs = result.members.map(
      (x: any) => `${x.destination_table_id}#${x.destination_seat_number}`
    );
    expect(new Set(finalChairs).size).toBe(3);
  });

  it('a chair two unlanded members already share is kept by the first and replaced for the second', async () => {
    const m = manager();
    m.eligibleBreakDestinations = vi.fn(async () => [table(OPEN, [1, 2, 3])]);
    // The state production left behind: two active attempts on one chair.
    const durable = { state: breakState([member(1, OPEN, 8), member(2, OPEN, 8)]) };
    const proposals = amendDoor(durable);

    const result = await m.repairTournamentBreakDestinations(durable.state);

    expect(proposals).toEqual([{ user: id(102), table: OPEN, seat: expect.any(Number) }]);
    expect(proposals[0].seat).not.toBe(8);
    expect(result.members[0].destination_seat_number).toBe(8);
  });

  it('a replacement never takes a chair another unlanded member still holds', async () => {
    const m = manager();
    // Member 1 is still headed for OPEN#5 (valid); member 2 must be replaced.
    m.eligibleBreakDestinations = vi.fn(async () => [
      table(TAKEN, [1, 2, 3, 4, 5, 6, 7, 8, 9]),
      table(OPEN, [1, 2, 3, 4]),
    ]);
    const durable = { state: breakState([member(1, OPEN, 5), member(2, TAKEN, 2)]) };
    const proposals = amendDoor(durable);

    await m.repairTournamentBreakDestinations(durable.state);

    expect(proposals).toHaveLength(1);
    expect(proposals[0].table).toBe(OPEN);
    expect(proposals[0].seat).not.toBe(5);
  });

  it('a landed member holds nothing beyond the seat the board already shows', () => {
    const landed = { ...member(1, OPEN, 5), winner_request_id: id(401) };
    const held = chairsHeldByUnlandedBreakMembers([landed, member(2, OPEN, 6)], null);
    expect([...(held.get(OPEN) ?? [])]).toEqual([6]);
    expect(chairHeldByEarlierUnlandedMember([landed, member(2)], id(102), OPEN, 5)).toBe(false);
    const board = boardWithHeldChairs([table(OPEN, [1])], held);
    expect(board[0].reservedSeats).toEqual([6]);
  });

  it('the held-chair board is a copy the balancer cannot write back into', () => {
    const source = [table(OPEN, [1, 2])];
    const copy = boardWithHeldChairs(source, new Map([[OPEN, new Set([3])]]));
    copy[0].players.push({ userId: 'x', seat: 4, stack: 1 });
    expect(source[0].players).toHaveLength(2);
    expect(source[0].reservedSeats).toEqual([]);
  });
});

describe('a never-sent break attempt is sent once', () => {
  function dispatchHarness() {
    const m = manager();
    const engine = {
      releaseTournamentMovePause: vi.fn(),
      executeTournamentMoveAtBoundary: vi.fn(async (_o: string, op: () => Promise<any>) => op()),
      presenceForTournamentMove: vi.fn(() => null),
    };
    m.tableEngines = new Map([[SOURCE, engine]]);
    m.gameServer = { ownsTournamentTableEngine: vi.fn(() => true), getTableEngine: () => engine };
    m.receiptOwnsSource = () => false;
    m.retainTournamentBreakSource = () => true;
    m.claimTournamentMoveBoundary = vi.fn(async () => ({ sourceMode: 'live_source', engine }));
    return m;
  }
  const occupied = () =>
    new TournamentSeatMoveRefusedError('tournament move destination seat is occupied');

  it('an amended attempt minted here is dispatched as a first send, so its refusal is final', async () => {
    const m = dispatchHarness();
    m.eligibleBreakDestinations = vi.fn(async () => [
      table(TAKEN, [1, 2, 3, 4, 5, 6, 7, 8, 9]),
      table(OPEN, [1, 2, 3, 4]),
    ]);
    const durable = { state: breakState([member(1)]) };
    amendDoor(durable);
    const repaired = await m.repairTournamentBreakDestinations(durable.state);
    moveRpc.mockRejectedValue(occupied());

    await m.dispatchTournamentBreakMembers(repaired);
    expect(moveRpc).toHaveBeenCalledTimes(1);
    expect(moveRpc.mock.calls[0][0].requestId).toBe(repaired.members[0].active_request_id);
    expect(moveRpc.mock.calls[0][1]).toEqual({ outcomeWasAlreadyUnknown: false });

    // The same id dispatched again may have an earlier outcome: keep the replay.
    await m.dispatchTournamentBreakMembers(repaired);
    expect(moveRpc.mock.calls[1][1]).toEqual({ outcomeWasAlreadyUnknown: true });
  });

  it('an attempt this manager did not mint keeps its replay', async () => {
    const m = dispatchHarness();
    moveRpc.mockRejectedValue(occupied());
    await m.dispatchTournamentBreakMembers(breakState([member(1, OPEN, 5)]));
    expect(moveRpc.mock.calls[0][1]).toEqual({ outcomeWasAlreadyUnknown: true });
  });
});

describe('a gap move never takes a chair a pending break holds', () => {
  it('a complete door read without the destination waits instead of keeping the planned chair', async () => {
    const m = manager();
    m.loadBalancerTables = vi.fn(async () => []);
    await expect(
      m.chairFreeAtTheDoor({ playerId: id(5), fromTableId: SOURCE, toTableId: OPEN, toSeat: 3 })
    ).resolves.toBeNull();
  });

  it('a failed door read still keeps the planned chair for the door to decide', async () => {
    const m = manager();
    m.loadBalancerTables = vi.fn(async () => null);
    await expect(
      m.chairFreeAtTheDoor({ playerId: id(5), fromTableId: SOURCE, toTableId: OPEN, toSeat: 3 })
    ).resolves.toBe(3);
  });

  it('door reads never consume the board captured before this pass moved anyone', async () => {
    const m = manager();
    const consume = vi.spyOn(m, 'consumeLiveBoardPrefetch').mockReturnValue(null);
    m.eliminationMutationAllowed = () => true;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(supabase, 'from').mockImplementation(() => {
      throw new Error('no database in this test');
    });
    await m.loadBalancerTables([OPEN], 'moveChairAtTheDoor').catch(() => undefined);
    await m.loadBalancerTables([OPEN], 'breakReplacement', BREAK).catch(() => undefined);
    expect(consume).not.toHaveBeenCalled();
    await m.loadBalancerTables([OPEN], 'balanceInitial').catch(() => undefined);
    expect(consume).toHaveBeenCalledTimes(1);
  });

  it('a table count leaves no board behind for a later read to take', async () => {
    const m = manager();
    m.liveTournamentTableIdsWithPlayers = vi.fn(async () => {
      m.lastLiveBoardPrefetch = {
        epoch: m.balanceBoardEpoch,
        capturedAtMs: Date.now(),
        tablesById: new Map([[OPEN, { id: OPEN, max_players: 9 }]]),
        seats: [],
      };
      return [OPEN, TAKEN];
    });
    await expect(m.countLiveTablesWithPlayers()).resolves.toBe(2);
    expect(m.lastLiveBoardPrefetch).toBeNull();
  });
});
