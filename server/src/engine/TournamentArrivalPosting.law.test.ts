/** Tournament arrivals owe only the natural blinds, never a cash-style entry post. */
import { describe, it, expect, vi, afterEach } from 'vitest';

const historyFrom = vi.hoisted(() => vi.fn());
vi.mock('../services/supabase/client.js', () => ({
  supabase: { from: historyFrom },
  maintenanceSupabase: {},
}));

const { ServerTableEngine } = await import('./ServerTableEngine.js');

const TABLE = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

const engines: any[] = [];
afterEach(() => {
  for (const engine of engines.splice(0)) engine.preciseTimer.dispose();
  vi.restoreAllMocks();
});

/**
 * Six seats, all funded. lastButtonSeat = 1, so the coming hand has the button
 * on seat 2, the small blind on seat 3 and the big blind on seat 4 — meaning
 * the big blind has just passed seats 2 and 3.
 */
function tournamentEngine(opts: { tournament: boolean; seats?: number[] }) {
  const engine = new ServerTableEngine(TABLE) as any;
  engines.push(engine);
  const list = opts.seats ?? [1, 2, 3, 4, 5, 6];
  engine.seatedPlayers = list.map((s) => ({
    user_id: `u${s}`,
    seat_number: s,
    stack: 1000,
    is_horse: false,
  }));
  engine.tableInfo = { id: TABLE, tournament_id: opts.tournament ? 'tid' : null };
  engine.lastButtonSeat = 1;
  engine.disconnectEngine = { isSittingOut: () => false };
  return engine;
}

describe('tournament arrivals never owe an entry blind', () => {
  it.each([1, 2, 3, 4, 5, 6])('discards a legacy entry obligation at seat %s', (seat) => {
    const engine = tournamentEngine({ tournament: true });
    engine.mustPostBB.add(`u${seat}`);
    engine.noteTournamentArrival(seat, `u${seat}`);
    expect(engine.mustPostBB.size).toBe(0);
  });
  it('never charges an arrival on the button', () => {
    const engine = tournamentEngine({ tournament: true });
    // Receiving the button on arrival creates no blind obligation.
    engine.noteTournamentArrival(2, 'u2');
    expect(engine.mustPostBB.has('u2')).toBe(false);
  });

  it('never charges an arrival in the small blind seat a second blind (Dan 2026-10-21)', () => {
    const engine = tournamentEngine({ tournament: true });
    // Seat 3 is the small blind for the coming hand. The arrival posts that
    // small blind and is dealt in; it owes nothing more. Under the dead button
    // the seat is the button next hand, and billing a big blind there is the
    // "paid the small blind, then had to pay the big blind again" bug.
    engine.noteTournamentArrival(3, 'u3');
    expect(engine.mustPostBB.has('u3')).toBe(false);
  });

  it('charges nothing for a seat whose big blind is still ahead of it', () => {
    const engine = tournamentEngine({ tournament: true });
    // Seat 4 IS the big blind this hand — it posts naturally.
    engine.noteTournamentArrival(4, 'u4');
    // Seats 5 and 6 reach the big blind inside the current orbit on their own.
    engine.noteTournamentArrival(5, 'u5');
    engine.noteTournamentArrival(6, 'u6');
    expect(engine.mustPostBB.size).toBe(0);
  });

  it('does nothing on a cash table (that path has its own rules)', () => {
    const engine = tournamentEngine({ tournament: false });
    engine.noteTournamentArrival(2, 'u2');
    engine.noteTournamentArrival(3, 'u3');
    expect(engine.mustPostBB.size).toBe(0);
  });

  it('leaves heads-up natural blinds to the deal', () => {
    // Heads-up: the button IS the small blind and both players pay every hand.
    const engine = tournamentEngine({ tournament: true, seats: [1, 2] });
    engine.noteTournamentArrival(2, 'u2');
    expect(engine.mustPostBB.size).toBe(0);
  });
});

describe('moved seat at the dead small blind in hand 58265757', () => {
  it.each([true, false])('holds seat 8 until the button passes (tournament=%s)', (tournament) => {
    const engine = tournamentEngine({ tournament, seats: [1, 2, 3, 4, 5, 6, 7, 8] });
    const seats = engine.seatedPlayers;
    seats[7].entry_hold = 'moved';
    engine.previousHandOccupants = new Map(
      seats.slice(0, 7).map((p: any) => [p.seat_number, p.user_id])
    );
    engine.lastButtonSeat = 6;
    engine.lastSmallBlindSeat = 8;
    engine.lastBigBlindSeat = 1;
    expect(engine.admitMovedSeats(seats)).toEqual(seats.slice(0, 7));
    engine.lastButtonSeat = tournament ? 8 : 1;
    engine.lastSmallBlindSeat = 1;
    engine.lastBigBlindSeat = 2;
    expect(engine.admitMovedSeats(seats)).toEqual(seats);
  });
});

it('deals both sides of the button pass with the real hand controller', async () => {
  const { HandController } = await import('./HandController.js');
  const engine = tournamentEngine({ tournament: true, seats: [1, 2, 3, 4, 5, 6, 7, 8] });
  const occupants = engine.seatedPlayers as import('../types.js').SeatedPlayer[];
  engine.previousHandOccupants = new Map(
    occupants.slice(0, 7).map((p) => [p.seat_number, p.user_id])
  );
  engine.lastButtonSeat = 6;
  engine.lastSmallBlindSeat = 8;
  engine.lastBigBlindSeat = 1;
  for (const handNumber of [1, 2]) {
    const selected = engine.admitMovedSeats(occupants) as typeof occupants;
    const blinds = engine.predictBlindSeats(selected);
    const players = selected.map((p) => ({
      seat: p.seat_number,
      user_id: p.user_id,
      username: p.user_id,
      stack: 27454,
      bet: 0,
      totalInvested: 0,
      cards: [],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
    }));
    const hand = new HandController(
      {
        tableId: TABLE,
        handNumber,
        gameVariant: 'nlh',
        isTournament: true,
        smallBlind: 400,
        bigBlind: 800,
        bigBlindAnte: true,
        ante: 800,
        blindSeats: blinds,
        rakeConfig: { percent: 0, cap: 0, noFlopNoDrop: true },
      },
      players,
      blinds.button
    );
    hand.start();
    const state = hand.getState();
    const arriving = state.players.find((p) => p.seat === 8);
    expect(state.players.every((p) => p.cards.length === 2)).toBe(true);
    if (handNumber === 1) {
      expect(arriving).toBeUndefined();
      expect(blinds.button).toBe(8);
    } else {
      expect(arriving?.cards).toHaveLength(2);
      expect(arriving?.stack).toBe(27454);
      expect(arriving?.totalInvested).toBe(0);
      expect(blinds.button).toBe(1);
    }
    engine.lastButtonSeat = blinds.button;
    engine.lastSmallBlindSeat = blinds.smallBlindSeat;
    engine.lastBigBlindSeat = blinds.bigBlind;
    engine.previousHandOccupants = new Map(selected.map((p) => [p.seat_number, p.user_id]));
  }
});

describe('button wait at tournament entry boundaries', () => {
  it('keeps heads-up playable when a new occupant lands between the last button and blind', () => {
    const engine = tournamentEngine({ tournament: true, seats: [1, 2] });
    engine.lastButtonSeat = 1;
    engine.lastBigBlindSeat = 2;
    engine.previousHandOccupants.set(1, 'u1');
    const admitted = engine.admitMovedSeats(engine.seatedPlayers);
    expect(admitted).toEqual(engine.seatedPlayers);
    expect(engine.waitingForButton.size).toBe(0);
    expect(engine.predictBlindSeats(admitted)).toMatchObject({
      button: 2,
      smallBlind: 2,
      bigBlind: 1,
    });
  });

  it('holds a late registrant inside the interval and admits one outside it', () => {
    const engine = tournamentEngine({ tournament: true });
    engine.lastButtonSeat = 2;
    engine.lastBigBlindSeat = 4;
    engine.previousHandOccupants = new Map([
      [1, 'u1'],
      [2, 'u2'],
      [4, 'u4'],
      [6, 'u6'],
    ]);
    expect(
      engine
        .admitMovedSeats(engine.seatedPlayers)
        .map((p: { seat_number: number }) => p.seat_number)
    ).toEqual([1, 2, 4, 5, 6]);
    expect([...engine.waitingForButton]).toEqual([[3, 'u3']]);
  });

  it('deals a free hand to an arrival the button has already passed (Dan 2026-11-11)', () => {
    // Nightly 20K regression, hand #58703578: the late registrant's seat sat
    // between the last button and the seat the button was about to land on.
    // The button JUMPS past them — so their free hand starts on this deal,
    // not the next one. The stale-anchor zone held them a hand too long.
    const engine = tournamentEngine({ tournament: true });
    engine.lastButtonSeat = 2;
    engine.lastSmallBlindSeat = 4;
    engine.lastBigBlindSeat = 5;
    engine.previousHandOccupants = new Map([
      [1, 'u1'],
      [2, 'u2'],
      [4, 'u4'],
      [5, 'u5'],
      [6, 'u6'],
    ]);
    const admitted = engine.admitMovedSeats(engine.seatedPlayers);
    expect(admitted.map((p: { seat_number: number }) => p.seat_number)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    expect(engine.waitingForButton.size).toBe(0);
  });

  it('deals an arrival on the small blind seat — it posts through the rotation', () => {
    // The previous big blind busted and a late registrant took the seat. TDA
    // and noteTournamentArrival: a legal small-blind arrival posts through the
    // normal rotation and PLAYS; only the button's own path is waited out.
    const engine = tournamentEngine({ tournament: true });
    engine.lastButtonSeat = 2;
    engine.lastSmallBlindSeat = 3;
    engine.lastBigBlindSeat = 4;
    engine.previousHandOccupants = new Map([
      [1, 'u1'],
      [2, 'u2'],
      [3, 'u3'],
      [5, 'u5'],
      [6, 'u6'],
    ]);
    const admitted = engine.admitMovedSeats(engine.seatedPlayers);
    expect(admitted.map((p: { seat_number: number }) => p.seat_number)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    expect(engine.waitingForButton.size).toBe(0);
    expect(engine.predictBlindSeats(admitted)).toMatchObject({
      button: 3,
      smallBlindSeat: 4,
      smallBlind: 4,
      bigBlind: 5,
    });
  });

  it.each([
    { button: 6, bb: 1, held: true },
    { button: 8, bb: 2, held: false },
  ])(
    'restores admission from settled history with the button at $button',
    async ({ button, bb, held }) => {
      const engine = tournamentEngine({ tournament: true, seats: [1, 2, 3, 4, 5, 6, 7, 8] });
      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          error: null,
          data: [
            {
              button_seat: button,
              players: engine.seatedPlayers
                .slice(0, 7)
                .map((p: { seat_number: number; user_id: string }) => ({
                  seat: p.seat_number,
                  userId: p.user_id,
                })),
              actions: [{ action: 'bb', origin: 'forced', seat: bb }],
            },
          ],
        }),
      };
      historyFrom.mockReturnValue(query);
      await engine.restoreButtonFromHistory();
      expect(
        engine
          .admitMovedSeats(engine.seatedPlayers)
          .some((p: { user_id: string }) => p.user_id === 'u8')
      ).toBe(!held);
      expect(engine.waitingForButton.has(8)).toBe(held);
    }
  );
});
