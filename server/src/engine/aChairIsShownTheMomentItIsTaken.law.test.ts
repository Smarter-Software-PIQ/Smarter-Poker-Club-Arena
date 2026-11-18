/**
 * A CHAIR IS SHOWN THE MOMENT IT IS TAKEN (Dan 2026-11-17).
 *
 * "as soon as a player clicks the + button at a table, their avatar should be
 * shown, and they are given 60 seconds to buy in. even after they buy in, it
 * doesn't show the avatar until after they are dealt in."
 *
 * Reproduced: a buy-in committed in the database during a hand was absent
 * from every published payload until the next hand boundary adopted the
 * roster. See SeatArrivalDisplay.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../services/supabase/client.js', () => ({
  supabase: {
    from: vi.fn(() => {
      throw Error('Unexpected database access');
    }),
    rpc: vi.fn(),
  },
  maintenanceSupabase: {},
}));
vi.mock('../services/errorReporter.js', () => ({ reportError: vi.fn() }));
const roster = vi.hoisted(() => ({ rows: [] as any[] }));
vi.mock('../services/supabase/tables.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadSeatedPlayers: vi.fn(async () => roster.rows.map((r) => ({ ...r }))),
  loadSeatHoldIdentity: vi.fn(async (userId: string) =>
    userId === 'no-profile'
      ? null
      : {
          username: `Name-${userId}`,
          avatar_url: `${userId}.png`,
          equipped_frame: 'frame',
          equipped_aura: 'aura',
        }
  ),
}));
const { ServerTableEngine } = await import('./ServerTableEngine.js');
const { HandController } = await import('./HandController.js');
const { SEAT_HOLD_DISPLAY_MS, SeatArrivalDisplay } = await import('./SeatArrivalDisplay.js');

const engines: any[] = [];
afterEach(() => {
  for (const e of engines.splice(0)) {
    e.running = false;
    e.disconnectEngine.destroy?.();
  }
  vi.useRealTimers();
});
beforeEach(() => {
  roster.rows = [];
});

function seatRow(user: string, seat: number, stack: number, occupancy = `occ-${user}`) {
  return {
    user_id: user,
    occupancy_id: occupancy,
    seat_number: seat,
    stack,
    username: `Name-${user}`,
    avatar_url: `${user}.png`,
    equipped_frame: '',
    equipped_aura: '',
    is_horse: false,
  };
}

function midHandTable() {
  const e = new ServerTableEngine('chair-shown') as any;
  engines.push(e);
  const handSeats = [1, 2].map((seat) => ({
    seat,
    user_id: `playing-${seat}`,
    username: `Playing${seat}`,
    stack: 400,
    bet: 0,
    totalInvested: 0,
    cards: [],
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
  }));
  e.handController = new HandController(
    {
      tableId: e.tableId,
      handNumber: 3,
      gameVariant: 'plo5',
      smallBlind: 1,
      bigBlind: 2,
      rakeConfig: { percent: 5, cap: 3, noFlopNoDrop: true },
    },
    handSeats,
    1
  );
  e.tableInfo = { game_variant: 'plo5', small_blind: 1, big_blind: 2, max_players: 6 };
  e.handController.start();
  e.handCount = 3;
  e.currentHandDealerSeat = 1;
  e.running = true;
  e.hub = { publish: vi.fn(), emitEvent: vi.fn(), sendToUser: vi.fn() };
  e.seatedPlayers = handSeats.map((p) => ({
    ...p,
    seat_number: p.seat,
    occupancy_id: `occ-${p.user_id}`,
  }));
  roster.rows = [seatRow('playing-1', 1, 400), seatRow('playing-2', 2, 400)];
  return e;
}
async function live(e: any) {
  e.hub.publish.mockClear();
  await e.broadcastCurrentState();
  return e.hub.publish.mock.calls.at(-1)[1];
}
const seat = (payload: any, n: number) => payload.players.find((p: any) => p.seat === n);

describe('a committed buy-in is shown before the player is dealt in', () => {
  it('shows the committed chair on every publication path at once, without touching the hand', async () => {
    const e = midHandTable();
    roster.rows.push(seatRow('woowoo', 3, 1000));
    // The defect: the database holds the seat, the felt does not.
    expect(seat(await live(e), 3)).toBeUndefined();
    const handBefore = structuredClone(e.handController.getState());

    expect(await e.noteSeatArrival('woowoo', { state: 'seated' })).toEqual({ ok: true });

    e.publishIdleState();
    const idle = e.hub.publish.mock.calls.at(-1)[1];
    for (const payload of [await live(e), idle, e.getTableState('someone'), e.getObserverState()]) {
      expect(seat(payload, 3)).toMatchObject({
        user_id: 'woowoo',
        username: 'Name-woowoo',
        avatar_url: 'woowoo.png',
        stack: 1000,
        cards: [],
        bet: 0,
        is_sitting_out: true,
        seat_arrival: 'seated',
      });
    }
    expect(e.handController.getState()).toEqual(handBefore);
    expect(e.seatedPlayers.map((p: any) => p.user_id)).toEqual(['playing-1', 'playing-2']);
  });

  it('answers not_seated for a buy-in the database does not hold, and shows nothing', async () => {
    const e = midHandTable();
    expect(await e.noteSeatArrival('ghost', { state: 'seated' })).toEqual({
      ok: false,
      reason: 'not_seated',
    });
    expect(seat(await live(e), 3)).toBeUndefined();
  });

  it('hands the chair to the hand roster at the boundary, and drops an arrival two rosters miss', async () => {
    const e = midHandTable();
    e.lifecycleCanMutate = () => true;
    roster.rows.push(seatRow('woowoo', 3, 1000));
    await e.noteSeatArrival('woowoo', { state: 'seated' });
    // Adopted: one entry, from the roster, no arrival label.
    e.adoptSeatRoster([...e.seatedPlayers, { ...seatRow('woowoo', 3, 1000) }]);
    const adopted = (await live(e)).players.filter((p: any) => p.user_id === 'woowoo');
    expect(adopted).toHaveLength(1);
    expect(adopted[0].seat_arrival).toBeUndefined();

    // A roster read that began before the commit misses it once: still shown.
    const f = midHandTable();
    f.lifecycleCanMutate = () => true;
    roster.rows.push(seatRow('late', 4, 500));
    await f.noteSeatArrival('late', { state: 'seated' });
    f.adoptSeatRoster([...f.seatedPlayers]);
    expect(seat(await live(f), 4)?.user_id).toBe('late');
    f.adoptSeatRoster([...f.seatedPlayers]);
    expect(seat(await live(f), 4)).toBeUndefined();
  });

  it('is never used at a tournament table', async () => {
    const e = midHandTable();
    e.tableInfo.tournament_id = 'tour';
    e.isTournamentTable = () => true;
    roster.rows.push(seatRow('woowoo', 3, 1000));
    expect(await e.noteSeatArrival('woowoo', { state: 'seated' })).toEqual({
      ok: false,
      reason: 'tournament_table',
    });
  });
});

describe('the + tap shows the face for the sixty-second buy-in window', () => {
  it('shows a buying-in chair with no chips, then closes it when the window ends', async () => {
    vi.useFakeTimers();
    const e = midHandTable();
    const verdict = await e.noteSeatArrival('tapper', { state: 'hold', seatNumber: 5 });
    expect(verdict).toMatchObject({ ok: true });
    const shown = seat(e.hub.publish.mock.calls.at(-1)[1], 5);
    expect(shown).toMatchObject({
      user_id: 'tapper',
      username: 'Name-tapper',
      avatar_url: 'tapper.png',
      stack: 0,
      cards: [],
      seat_arrival: 'buying_in',
    });
    e.hub.publish.mockClear();
    vi.advanceTimersByTime(SEAT_HOLD_DISPLAY_MS + 100);
    // The window's close is published by itself, with no further request.
    expect(e.hub.publish).toHaveBeenCalled();
    expect(seat(e.hub.publish.mock.calls.at(-1)[1], 5)).toBeUndefined();
  });

  it('refuses a chair that is seated, held by another, or a player already seated', async () => {
    const e = midHandTable();
    roster.rows.push(seatRow('bought-mid-hand', 4, 300));
    expect(await e.noteSeatArrival('tapper', { state: 'hold', seatNumber: 1 })).toEqual({
      ok: false,
      reason: 'seat_taken',
    });
    // A seat committed in the database but not yet adopted is taken too.
    expect(await e.noteSeatArrival('tapper', { state: 'hold', seatNumber: 4 })).toEqual({
      ok: false,
      reason: 'seat_taken',
    });
    expect(await e.noteSeatArrival('first', { state: 'hold', seatNumber: 5 })).toMatchObject({
      ok: true,
    });
    expect(await e.noteSeatArrival('second', { state: 'hold', seatNumber: 5 })).toEqual({
      ok: false,
      reason: 'seat_held',
    });
    expect(await e.noteSeatArrival('playing-1', { state: 'hold', seatNumber: 6 })).toEqual({
      ok: false,
      reason: 'already_seated',
    });
    expect(await e.noteSeatArrival('tapper', { state: 'hold', seatNumber: 7 })).toEqual({
      ok: false,
      reason: 'invalid_seat',
    });
    expect(await e.noteSeatArrival('no-profile', { state: 'hold', seatNumber: 6 })).toEqual({
      ok: false,
      reason: 'profile_not_found',
    });
  });

  it('releases on an unpaid close, and becomes the committed chair on purchase', async () => {
    const e = midHandTable();
    await e.noteSeatArrival('tapper', { state: 'hold', seatNumber: 5 });
    await e.noteSeatArrival('tapper', { state: 'release' });
    expect(seat(await live(e), 5)).toBeUndefined();

    await e.noteSeatArrival('tapper', { state: 'hold', seatNumber: 5 });
    roster.rows.push(seatRow('tapper', 5, 250));
    await e.noteSeatArrival('tapper', { state: 'seated' });
    // A late release of the old sheet cannot remove a bought chair.
    await e.noteSeatArrival('tapper', { state: 'release' });
    expect(seat(await live(e), 5)).toMatchObject({
      user_id: 'tapper',
      stack: 250,
      seat_arrival: 'seated',
    });
  });

  it('scrubs the face at an anonymous table', async () => {
    const e = midHandTable();
    e.tableInfo.is_anonymous = true;
    await e.noteSeatArrival('tapper', { state: 'hold', seatNumber: 5 });
    expect(seat(await live(e), 5)).toMatchObject({
      username: 'Player 5',
      avatar_url: '',
      equipped_frame: '',
      equipped_aura: '',
    });
  });
});

describe('SeatArrivalDisplay', () => {
  const identity = { username: 'n', avatar_url: 'a', equipped_frame: '', equipped_aura: '' };
  const empty = { seats: new Set<number>(), users: new Set<string>() };
  it('keeps one hold per player and moves it on a new tap', () => {
    const d = new SeatArrivalDisplay();
    d.hold('u', 2, identity, empty, 6, 0);
    d.hold('u', 3, identity, empty, 6, 0);
    expect(d.live(0).map((a) => a.seat_number)).toEqual([3]);
  });
  it('forgets a departed player at once', () => {
    const d = new SeatArrivalDisplay();
    d.confirm({ ...identity, user_id: 'u', seat_number: 2, stack: 9 });
    expect(d.forget('u')).toBe(true);
    expect(d.live(0)).toEqual([]);
  });
  it('voids another player hold on the chair the database assigned', () => {
    const d = new SeatArrivalDisplay();
    d.hold('tapper', 2, identity, empty, 6, 0);
    d.confirm({ ...identity, user_id: 'buyer', seat_number: 2, stack: 9 });
    expect(d.live(0).map((a) => a.user_id)).toEqual(['buyer']);
  });
});
