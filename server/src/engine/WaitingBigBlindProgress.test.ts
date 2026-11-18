import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../services/supabase/client.js', () => ({ supabase: {}, maintenanceSupabase: {} }));
vi.mock('../services/errorReporter.js', () => ({ reportError: vi.fn() }));
const { ServerTableEngine } = await import('./ServerTableEngine.js');
const engines: any[] = [];
afterEach(() => {
  for (const e of engines.splice(0)) {
    e.preciseTimer.dispose();
    e.engineTelemetry.dispose();
  }
});
function fixture(active: number[], waiting: number[], horse: boolean) {
  const e = new ServerTableEngine('waiting-big-blind') as any;
  engines.push(e);
  e.tableInfo = {
    id: 'waiting-big-blind',
    game_type: 'cash',
    game_variant: 'plo5',
    small_blind: 1,
    big_blind: 2,
    ante: 0,
  };
  e.seatedPlayers = [...active, ...waiting]
    .sort((a, b) => a - b)
    .map((seat) => ({
      seat_number: seat,
      user_id: `u${seat}`,
      username: `P${seat}`,
      stack: 400,
      is_horse: horse,
      occupancy_id: `occupancy-${seat}`,
      seat_id: `00000000-0000-4000-8000-00000000000${seat}`,
      seat_joined_at: '2026-11-10T22:55:22Z',
    }));
  e.dealtInUserIds = new Set(active.map((s) => `u${s}`));
  e.waitingForBB = new Set(waiting.map((s) => `u${s}`));
  e.lastButtonSeat = active[0];
  e.lastSmallBlindSeat = active[1];
  e.lastBigBlindSeat = active[2] ?? active[1];
  e.disconnectEngine.isSittingOut = () => false;
  e.takePreparedHandNumber = () => 123;
  e.bombPotSchedPersistedJson = 'null';
  return e;
}
async function hand(e: any) {
  const predicted = e.getBBSeatIndex();
  const entrant = e.seatedPlayers.find(
    (p: any) => p.seat_number === predicted && e.waitingForBB.has(p.user_id)
  );
  if (entrant) e.waitingForBB.delete(entrant.user_id);
  const players = e.seatedPlayers.filter((p: any) => !e.waitingForBB.has(p.user_id));
  const stop = new Error('controller built');
  e.fetchTimeBankExtras = () => {
    throw stop;
  };
  await expect(e.dealHand(players)).rejects.toBe(stop);
  const hc = e.handController;
  const posted: any[] = [];
  hc.onEvent((ev: any) => {
    if (ev.type === 'FORCED_BETS_POSTED') posted.push(...ev.postings);
  });
  hc.start();
  if (entrant) {
    expect(posted.filter((p) => p.seat === entrant.seat_number)).toEqual([
      expect.objectContaining({ kind: 'bb', amount: 2 }),
    ]);
    expect(hc.getDealerSeat()).not.toBe(entrant.seat_number);
  }
  expect(posted.filter((p) => p.kind === 'bb')).toHaveLength(1);
  expect(posted.filter((p) => p.kind === 'post')).toHaveLength(0);
  expect(hc.getState().pot).toBe(3);
  return entrant?.seat_number;
}
describe('cash waiting seats reach their actual big blind', () => {
  it.each([false, true])('alternating six-seat incident progresses, Horse=%s', async (horse) => {
    const e = fixture([1, 3, 5], [2, 4, 6], horse);
    expect(e.getBBSeatIndex()).toBe(6);
    const admitted: number[] = [];
    for (let n = 0; n < 9; n++) {
      const entrant = await hand(e);
      if (entrant) admitted.push(entrant);
    }
    expect(admitted).toEqual([6, 2, 4]);
    expect(e.waitingForBB.size).toBe(0);
  });
  it.each([
    [
      [1, 5, 6],
      [2, 3, 4],
    ],
    [
      [1, 3],
      [2, 4, 5, 6],
    ],
    [
      [2, 4, 6],
      [1, 3, 5],
    ],
    [
      [1, 4, 7],
      [2, 3, 5, 6, 8, 9],
    ],
  ])('admits every adjacent or wrapped waiter: active=%j waiting=%j', async (active, waiting) => {
    const e = fixture(active, waiting, false);
    for (let n = 0; n < 18; n++) await hand(e);
    expect([...e.waitingForBB]).toEqual([]);
  });
});
