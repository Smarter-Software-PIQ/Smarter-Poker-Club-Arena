import { afterEach, describe, expect, it, vi } from 'vitest';
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
const { ServerTableEngine } = await import('./ServerTableEngine.js');
const { HandController } = await import('./HandController.js');

const engines: any[] = [];
afterEach(() => {
  for (const e of engines.splice(0)) e.disconnectEngine.destroy?.();
});
function fixture(isHorse = true) {
  const e = new ServerTableEngine('occupied-seats') as any;
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
      handNumber: 7,
      gameVariant: 'plo5',
      smallBlind: 1,
      bigBlind: 2,
      rakeConfig: { percent: 5, cap: 3, noFlopNoDrop: true },
    },
    handSeats,
    1
  );
  e.tableInfo = {
    game_variant: 'plo5',
    small_blind: 1,
    big_blind: 2,
    max_players: 6,
    observer_show_cards: true,
  };
  e.handController.start();
  e.handCount = 7;
  e.currentHandDealerSeat = 1;
  e.hub = { publish: vi.fn(), emitEvent: vi.fn(), sendToUser: vi.fn() };
  e.seatedPlayers = handSeats.map((p) => ({ ...p, seat_number: p.seat }));
  e.seatedPlayers.push({
    user_id: 'waiting',
    username: 'utg777',
    avatar_url: 'waiting-avatar.png',
    seat_number: 4,
    stack: 1796,
    is_horse: isHorse,
    is_sitting_out: true,
    equipped_frame: 'frame',
    equipped_aura: 'aura',
  });
  e.waitingForBB.add('waiting');
  e.disconnectEngine.registerPlayer(e.tableId, 'waiting');
  return e;
}
async function live(e: any) {
  e.hub.publish.mockClear();
  await e.broadcastCurrentState();
  return e.hub.publish.mock.calls.at(-1)[1];
}

describe('an occupied seat stays on the felt outside the hand', () => {
  it.each([true, false])(
    'keeps a waiting entrant through idle/live/resync/observer (horse=%s)',
    async (horse) => {
      const e = fixture(horse);
      const handBefore = structuredClone(e.handController.getState());
      e.publishIdleState();
      const idle = e.hub.publish.mock.calls.at(-1)[1];
      for (const payload of [
        idle,
        await live(e),
        e.getTableState('waiting'),
        e.getObserverState(),
      ]) {
        expect(payload.players.find((p: any) => p.user_id === 'waiting')).toMatchObject({
          seat: 4,
          username: 'utg777',
          avatar_url: 'waiting-avatar.png',
          stack: 1796,
          cards: [],
          is_sitting_out: true,
          is_waiting_for_bb: true,
        });
        expect(payload.waiting_for_bb_user_ids).toContain('waiting');
        expect(payload.players.filter((p: any) => p.user_id === 'waiting')).toHaveLength(1);
      }
      expect(e.handController.getState()).toEqual(handBefore);
    }
  );

  it('keeps every occupied position across repeated streets and the next deal', async () => {
    const e = fixture();
    e.tableInfo.max_players = 9;
    for (let seat = 3; seat <= 9; seat++) {
      e.seatedPlayers[2].seat_number = seat;
      for (const stage of ['preflop', 'flop', 'turn', 'river', 'showdown']) {
        e.handController.state.stage = stage;
        const payload = await live(e);
        expect(payload.players.find((p: any) => p.user_id === 'waiting')).toMatchObject({
          seat,
          is_sitting_out: true,
          cards: [],
          stack: 1796,
        });
      }
    }
    const entrant = e.seatedPlayers[2];
    e.waitingForBB.delete('waiting');
    e.handController.state.players.push({
      ...entrant,
      seat: entrant.seat_number,
      cards: [],
      bet: 2,
      totalInvested: 2,
      stack: 1794,
      is_sitting_out: false,
      is_folded: false,
      is_all_in: false,
    });
    e.handController.state.stage = 'preflop';
    const admitted = (await live(e)).players.filter((p: any) => p.user_id === 'waiting');
    expect(admitted).toHaveLength(1);
    expect(admitted[0]).toMatchObject({
      stack: 1794,
      bet: 2,
      is_sitting_out: false,
      is_waiting_for_bb: false,
    });
  });

  it('does not invent cards, bets, positions, a turn or a pot share for an occupied nonparticipant', async () => {
    const e = fixture();
    const payload = await live(e);
    const waiting = payload.players.find((p: any) => p.user_id === 'waiting');
    expect(waiting).toMatchObject({
      cards: [],
      bet: 0,
      totalInvested: 0,
      position: '',
      is_folded: false,
      is_all_in: false,
    });
    expect(waiting).not.toHaveProperty('is_horse');
    expect(payload.current_player).not.toBe('waiting');
    expect(payload.pots.flatMap((p: any) => p.eligible)).not.toContain(4);
    expect(e.handController.getState().players).toHaveLength(2);
  });

  it('keeps a sitting-out seat, then removes it on release and accepts its replacement', async () => {
    const e = fixture();
    e.waitingForBB.clear();
    expect((await live(e)).players.find((p: any) => p.user_id === 'waiting')).toMatchObject({
      is_sitting_out: true,
      is_waiting_for_bb: false,
    });
    e.seatedPlayers = e.seatedPlayers.filter((p: any) => p.user_id !== 'waiting');
    expect((await live(e)).players.some((p: any) => p.user_id === 'waiting')).toBe(false);
    e.seatedPlayers.push({
      user_id: 'replacement',
      username: 'NewPlayer',
      seat_number: 4,
      stack: 200,
    });
    expect((await live(e)).players.find((p: any) => p.seat === 4)).toMatchObject({
      user_id: 'replacement',
      stack: 200,
    });
  });

  it('never overwrites the current hand stack or duplicates a seat after admission', async () => {
    const e = fixture();
    e.seatedPlayers.push({ user_id: 'playing-1', seat_number: 1, stack: 99999 });
    const payload = await live(e);
    expect(payload.players.filter((p: any) => p.seat === 1)).toHaveLength(1);
    expect(payload.players.find((p: any) => p.seat === 1).stack).toBe(
      e.handController.getState().players[0].stack
    );
  });

  it('scrubs waiting identities at anonymous tables on every publication path', async () => {
    const e = fixture();
    e.tableInfo.is_anonymous = true;
    for (const payload of [await live(e), e.getTableState('waiting'), e.getObserverState()]) {
      const waiting = payload.players.find((p: any) => p.user_id === 'waiting');
      expect(waiting).toBeDefined();
      expect(waiting.username).not.toBe('utg777');
      expect(waiting.avatar_url).toBe('');
      expect(waiting.equipped_frame).toBe('');
      expect(waiting.equipped_aura).toBe('');
    }
  });
});
