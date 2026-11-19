/**
 * A TOURNAMENT CHAIR IS SHOWN THE MOMENT IT IS TAKEN (Dan 2026-11-18).
 *
 * "WHEN A PLAYER JOINS A TABLE IN BETWEEN THE BLINDS OR ANY OTHER REASON,
 * THEIR STACK SHOULD SHOW, IT SHOULD NEVER SAY ZERO."
 *
 * Reproduced: a seat the tournament manager or the database committed during
 * a hand (a balancing move, a table break, a late registration, a re-entry)
 * was absent from every published payload until the next hand boundary, and
 * a rebuy paid during a hand left the seat reading zero. See
 * tournament/committedSeatShow.ts and SeatArrivalDisplay.ts.
 */
import { readFileSync } from 'node:fs';
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
const roster = vi.hoisted(() => ({
  rows: [] as any[],
  reads: 0,
  gate: null as Promise<void> | null,
}));
vi.mock('../services/supabase/tables.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadSeatedPlayers: vi.fn(async () => {
    roster.reads++;
    const rows = roster.rows.map((r) => ({ ...r }));
    if (roster.gate) await roster.gate;
    return rows;
  }),
}));
const { ServerTableEngine } = await import('./ServerTableEngine.js');
const { HandController } = await import('./HandController.js');
const { SeatArrivalDisplay } = await import('./SeatArrivalDisplay.js');

const engines: any[] = [];
afterEach(() => {
  for (const e of engines.splice(0)) {
    e.running = false;
    e.disconnectEngine.destroy?.();
  }
});
beforeEach(() => {
  roster.rows = [];
  roster.reads = 0;
  roster.gate = null;
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

/** A tournament table with seats 1 and 2 in a hand; `idle` rows are rostered but not dealt in. */
function midHandTournamentTable(idle: ReturnType<typeof seatRow>[] = []) {
  const e = new ServerTableEngine('tourney-chair-shown') as any;
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
      gameVariant: 'nlh',
      smallBlind: 100,
      bigBlind: 200,
      rakeConfig: { percent: 0, cap: 0, noFlopNoDrop: true },
    },
    handSeats,
    1
  );
  e.tableInfo = {
    game_variant: 'nlh',
    small_blind: 100,
    big_blind: 200,
    max_players: 6,
    tournament_id: 'tour-1',
    game_type: 'tournament',
  };
  e.handController.start();
  e.handCount = 3;
  e.currentHandDealerSeat = 1;
  e.running = true;
  e.hub = { publish: vi.fn(), emitEvent: vi.fn(), sendToUser: vi.fn() };
  e.seatedPlayers = [
    ...handSeats.map((p) => ({ ...p, seat_number: p.seat, occupancy_id: `occ-${p.user_id}` })),
    ...idle.map((r) => ({ ...r })),
  ];
  roster.rows = [seatRow('playing-1', 1, 400), seatRow('playing-2', 2, 400), ...idle];
  return e;
}
async function live(e: any) {
  e.hub.publish.mockClear();
  await e.broadcastCurrentState();
  return e.hub.publish.mock.calls.at(-1)[1];
}
async function everyPayload(e: any) {
  const liveNow = await live(e);
  e.publishIdleState();
  const idle = e.hub.publish.mock.calls.at(-1)[1];
  return [liveNow, idle, e.getTableState('someone'), e.getObserverState()];
}
const seat = (payload: any, n: number) => payload.players.find((p: any) => p.seat === n);

describe('a tournament seat committed during a hand is shown at once', () => {
  it('shows the mover in the chair with the real stack on every publication path, without touching the hand', async () => {
    const e = midHandTournamentTable();
    expect(e.isTournamentTable()).toBe(true);
    // The manager moved a player in (or the database seated a late registrant).
    roster.rows.push(seatRow('mover', 3, 23_500));
    // The defect: the database holds the seat, the felt does not.
    expect(seat(await live(e), 3)).toBeUndefined();
    const handBefore = structuredClone(e.handController.getState());
    const rosterBefore = e.seatedPlayers;

    await e.showCommittedTournamentSeats();

    for (const payload of await everyPayload(e)) {
      expect(seat(payload, 3)).toMatchObject({
        user_id: 'mover',
        username: 'Name-mover',
        avatar_url: 'mover.png',
        stack: 23_500,
        cards: [],
        bet: 0,
        is_sitting_out: true,
        seat_arrival: 'seated',
      });
    }
    // Display only: the hand and the roster the hand was dealt from are untouched.
    expect(e.handController.getState()).toEqual(handBefore);
    expect(e.seatedPlayers).toBe(rosterBefore);
    expect(e.seatedPlayers.map((p: any) => p.user_id)).toEqual(['playing-1', 'playing-2']);
  });

  it('publishes the arrival by itself, once, and does not publish when nothing changed', async () => {
    const e = midHandTournamentTable();
    roster.rows.push(seatRow('mover', 3, 23_500));
    await e.showCommittedTournamentSeats();
    expect(seat(e.hub.publish.mock.calls.at(-1)[1], 3)?.stack).toBe(23_500);
    e.hub.publish.mockClear();
    await e.showCommittedTournamentSeats();
    expect(e.hub.publish).not.toHaveBeenCalled();
  });

  it('is superseded by the hand roster at the boundary', async () => {
    const e = midHandTournamentTable();
    e.lifecycleCanMutate = () => true;
    roster.rows.push(seatRow('mover', 3, 23_500));
    await e.showCommittedTournamentSeats();
    e.adoptSeatRoster([...e.seatedPlayers, { ...seatRow('mover', 3, 23_500) }]);
    const shown = (await live(e)).players.filter((p: any) => p.user_id === 'mover');
    expect(shown).toHaveLength(1);
    expect(shown[0].seat_arrival).toBeUndefined();
    expect(shown[0].stack).toBe(23_500);
  });

  it('ends at once when a later read no longer holds the row, and by itself after two rosters without it', async () => {
    const e = midHandTournamentTable();
    roster.rows.push(seatRow('mover', 3, 23_500));
    await e.showCommittedTournamentSeats();
    roster.rows = roster.rows.filter((r) => r.user_id !== 'mover');
    await e.showCommittedTournamentSeats();
    expect(seat(e.hub.publish.mock.calls.at(-1)[1], 3)).toBeUndefined();

    const f = midHandTournamentTable();
    f.lifecycleCanMutate = () => true;
    roster.rows.push(seatRow('late', 4, 10_000));
    await f.showCommittedTournamentSeats();
    f.adoptSeatRoster([...f.seatedPlayers]);
    expect(seat(await live(f), 4)?.user_id).toBe('late');
    f.adoptSeatRoster([...f.seatedPlayers]);
    expect(seat(await live(f), 4)).toBeUndefined();
  });

  it('gives the chair of a busted player the database replaced to its new occupant, never a hand player chair', async () => {
    // Seat 3 still holds last hand's bust in the roster this hand was dealt from.
    const e = midHandTournamentTable([seatRow('busted', 3, 0)]);
    expect(seat(await live(e), 3)).toMatchObject({ user_id: 'busted', stack: 0 });
    // The bust was eliminated and a balancing move filled the chair.
    roster.rows = roster.rows.filter((r) => r.user_id !== 'busted');
    roster.rows.push(seatRow('mover', 3, 18_000));
    await e.showCommittedTournamentSeats();
    for (const payload of await everyPayload(e)) {
      const chairs = payload.players.filter((p: any) => p.seat === 3);
      expect(chairs).toHaveLength(1);
      expect(chairs[0]).toMatchObject({ user_id: 'mover', stack: 18_000, seat_arrival: 'seated' });
      expect(payload.players.some((p: any) => p.user_id === 'busted')).toBe(false);
    }

    // A committed row can never displace a player the hand in the air owns.
    const f = midHandTournamentTable();
    roster.rows = [seatRow('usurper', 1, 9_000), seatRow('playing-2', 2, 400)];
    await f.showCommittedTournamentSeats();
    const payload = await live(f);
    expect(seat(payload, 1)).toMatchObject({ user_id: 'playing-1' });
    expect(seat(payload, 1).seat_arrival).toBeUndefined();
    expect(payload.players.some((p: any) => p.user_id === 'usurper')).toBe(false);
  });

  it('shows a re-entry at the same table in its new chair instead of the old zero', async () => {
    const e = midHandTournamentTable([seatRow('reentrant', 3, 0, 'occ-old')]);
    roster.rows = roster.rows.filter((r) => r.user_id !== 'reentrant');
    roster.rows.push(seatRow('reentrant', 5, 20_000, 'occ-new'));
    await e.showCommittedTournamentSeats();
    const payload = await live(e);
    const own = payload.players.filter((p: any) => p.user_id === 'reentrant');
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({ seat: 5, stack: 20_000, seat_arrival: 'seated' });
    expect(seat(payload, 3)).toBeUndefined();
  });

  it('scrubs the face at an anonymous table', async () => {
    const e = midHandTournamentTable();
    e.tableInfo.is_anonymous = true;
    roster.rows.push(seatRow('mover', 3, 23_500));
    await e.showCommittedTournamentSeats();
    expect(seat(await live(e), 3)).toMatchObject({
      username: 'Player 3',
      avatar_url: '',
      stack: 23_500,
    });
  });
});

describe('a rebuy paid during a hand never leaves the seat reading zero', () => {
  it('shows the committed chips of a seated player the roster reads as broke', async () => {
    const e = midHandTournamentTable([seatRow('rebuyer', 4, 0)]);
    expect(seat(await live(e), 4)).toMatchObject({ user_id: 'rebuyer', stack: 0 });
    roster.rows = roster.rows.map((r) => (r.user_id === 'rebuyer' ? { ...r, stack: 20_000 } : r));
    const handBefore = structuredClone(e.handController.getState());

    await e.showCommittedTournamentSeats();

    for (const payload of await everyPayload(e)) {
      expect(seat(payload, 4)).toMatchObject({ user_id: 'rebuyer', stack: 20_000 });
      expect(seat(payload, 4).seat_arrival).toBeUndefined();
    }
    // The roster the next deal reads is not edited; the boundary read owns it.
    expect(e.seatedPlayers.find((p: any) => p.user_id === 'rebuyer').stack).toBe(0);
    expect(e.handController.getState()).toEqual(handBefore);
  });

  it('never shows a committed stack over a player in the hand, or while a settlement is writing', async () => {
    const e = midHandTournamentTable([seatRow('rebuyer', 4, 0)]);
    // A hand player's row differs from the hand (it always does mid-hand).
    roster.rows = roster.rows.map((r) => (r.user_id === 'playing-1' ? { ...r, stack: 99_999 } : r));
    await e.showCommittedTournamentSeats();
    expect(seat(await live(e), 1).stack).not.toBe(99_999);

    roster.rows = roster.rows.map((r) => (r.user_id === 'rebuyer' ? { ...r, stack: 20_000 } : r));
    e.settlementInFlight = new Set(['settling']);
    await e.showCommittedTournamentSeats();
    expect(seat(await live(e), 4).stack).toBe(0);
  });

  it('hands the stack back to the roster at the boundary, and survives one roster read that began too early', async () => {
    const e = midHandTournamentTable([seatRow('rebuyer', 4, 0)]);
    e.lifecycleCanMutate = () => true;
    roster.rows = roster.rows.map((r) => (r.user_id === 'rebuyer' ? { ...r, stack: 20_000 } : r));
    await e.showCommittedTournamentSeats();
    // A roster read that started before the rebuy committed still says zero.
    e.adoptSeatRoster(e.seatedPlayers.map((p: any) => ({ ...p })));
    expect(seat(await live(e), 4).stack).toBe(20_000);
    // The next one is the truth, whatever it says.
    e.adoptSeatRoster(e.seatedPlayers.map((p: any) => ({ ...p })));
    expect(seat(await live(e), 4).stack).toBe(0);
  });
});

describe('who may ask, and what it costs', () => {
  it('reads nothing and shows nothing at a cash table', async () => {
    const e = midHandTournamentTable();
    delete e.tableInfo.tournament_id;
    e.tableInfo.game_type = 'cash';
    roster.rows.push(seatRow('mover', 3, 23_500));
    await e.showCommittedTournamentSeats();
    expect(roster.reads).toBe(0);
    expect(e.tournamentSeatsNeedShowing(roster.rows)).toBe(false);
    expect(seat(await live(e), 3)).toBeUndefined();
  });

  it('still refuses the browser signal at a tournament table', async () => {
    const e = midHandTournamentTable();
    roster.rows.push(seatRow('mover', 3, 23_500));
    expect(await e.noteSeatArrival('mover', { state: 'seated' })).toEqual({
      ok: false,
      reason: 'tournament_table',
    });
  });

  it('answers without a read whether this table has anything new to show', async () => {
    const e = midHandTournamentTable([seatRow('rebuyer', 4, 0)]);
    expect(e.tournamentSeatsNeedShowing(roster.rows)).toBe(false);
    roster.rows.push(seatRow('mover', 3, 23_500));
    expect(e.tournamentSeatsNeedShowing(roster.rows)).toBe(true);
    await e.showCommittedTournamentSeats();
    expect(e.tournamentSeatsNeedShowing(roster.rows)).toBe(false);
    // A rebuy on a seat the roster reads as broke.
    roster.rows = roster.rows.map((r) => (r.user_id === 'rebuyer' ? { ...r, stack: 5_000 } : r));
    expect(e.tournamentSeatsNeedShowing(roster.rows)).toBe(true);
    await e.showCommittedTournamentSeats();
    expect(e.tournamentSeatsNeedShowing(roster.rows)).toBe(false);
    // A shown arrival the database no longer holds.
    roster.rows = roster.rows.filter((r) => r.user_id !== 'mover');
    expect(e.tournamentSeatsNeedShowing(roster.rows)).toBe(true);
    expect(roster.reads).toBe(2);
  });

  it('runs one read at a time and answers requests made during it with one more', async () => {
    const e = midHandTournamentTable();
    let open!: () => void;
    roster.gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const first = e.showCommittedTournamentSeats();
    const second = e.showCommittedTournamentSeats();
    const third = e.showCommittedTournamentSeats();
    // The seat commits after the first read was sent.
    roster.rows.push(seatRow('mover', 3, 23_500));
    roster.gate = null;
    open();
    await Promise.all([first, second, third]);
    expect(roster.reads).toBe(2);
    expect(seat(await live(e), 3)?.stack).toBe(23_500);
  });
});

describe('SeatArrivalDisplay, tournament additions', () => {
  const identity = { username: 'n', avatar_url: 'a', equipped_frame: '', equipped_aura: '' };
  it('drops a committed arrival a later read does not hold, and keeps a buy-in hold', () => {
    const d = new SeatArrivalDisplay();
    d.confirm({ ...identity, user_id: 'gone', seat_number: 2, stack: 9 });
    d.confirm({ ...identity, user_id: 'here', seat_number: 3, stack: 9 });
    d.hold('tapper', 5, identity, { seats: new Set(), users: new Set() }, 6, 0);
    expect(d.retainCommitted([{ user_id: 'here', seat_number: 3 }])).toBe(true);
    expect(d.live(0).map((a) => a.user_id)).toEqual(['here', 'tapper']);
    expect(d.retainCommitted([{ user_id: 'here', seat_number: 3 }])).toBe(false);
  });
  it('never records a committed stack of zero', () => {
    const d = new SeatArrivalDisplay();
    expect(d.showCommittedStack('u', 0)).toBe(false);
    expect(d.committedStack('u')).toBeNull();
    expect(d.showCommittedStack('u', 700)).toBe(true);
    expect(d.showCommittedStack('u', 700)).toBe(false);
    expect(d.committedStack('u')).toBe(700);
    d.forget('u');
    expect(d.committedStack('u')).toBeNull();
  });
});

describe('the wiring that makes it happen in production', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
  it('tells the destination table at every certified move, and the field at every seat-committing wake', () => {
    const manager = read('../tournament/TournamentManager.ts');
    expect(manager.match(/this\.committedSeatShow\.moved\(/g)).toHaveLength(3);
    expect(manager).toContain('this.committedSeatShow.moved(move.toTableId);');
    expect(manager).toContain('this.committedSeatShow.moved(pending.move.toTableId);');
    expect(manager).toContain('this.committedSeatShow.moved(receipt.destinationTableId);');
    expect(read('../GameServer.ts')).toContain(
      'if (wakeCommitsASeat(row.reason)) manager.showCommittedSeats?.();'
    );
  });
  it('writes nothing: the show path holds no rpc, insert, update, upsert or delete', () => {
    const show = read('../tournament/committedSeatShow.ts');
    expect(show).not.toMatch(/\.(rpc|insert|update|upsert|delete)\(/);
    const engine = read('./ServerTableEngine.ts');
    const block = engine.slice(
      engine.indexOf('A TOURNAMENT CHAIR IS SHOWN THE MOMENT IT IS TAKEN')
    );
    expect(block).not.toMatch(/\.(rpc|insert|update|upsert|delete)\(/);
    expect(block).not.toMatch(/this\.seatedPlayers\s*=[^=]/);
    expect(block).not.toMatch(/handController\.(?!getState\(\))/);
  });
});
