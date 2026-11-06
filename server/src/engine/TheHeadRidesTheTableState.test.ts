/**
 * THE HEAD RIDES THE TABLE STATE (Dan 2026-11-05: "the number on the screen
 * above their head didn't update").
 *
 * The tournament manager reads the bounty heads from the ledger and hands
 * them to every table engine (SeatHeadsRefresher -> setSeatBounties). These
 * tests drive the maintained pieces end to end: a real SeatHeadsRefresher, a
 * real ServerTableEngine publishing through its own broadcast and resync
 * builders, ledger rows changing the way a knockout, a split pot and a table
 * move change them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../services/supabase/client.js', () => ({
  supabase: {
    from: vi.fn(() => {
      throw Error('Unexpected database access in seat head fixture');
    }),
    rpc: vi.fn(() => {
      throw Error('Unexpected database RPC in seat head fixture');
    }),
  },
  maintenanceSupabase: {},
}));
vi.mock('../services/errorReporter.js', () => ({ reportError: vi.fn() }));
const { ServerTableEngine } = await import('./ServerTableEngine.js');
const { HandController } = await import('./HandController.js');
const { SeatHeadsRefresher, headsFromRows, isSeatBountyEvent } =
  await import('../tournament/seatBountyHeads.js');
import type { SeatPlayer } from '../types.js';

function seat(seatNo: number, userId: string, stack: number): SeatPlayer {
  return {
    seat: seatNo,
    user_id: userId,
    username: userId,
    stack,
    bet: 0,
    totalInvested: 0,
    cards: [],
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
  };
}

/** A real engine mid-hand at one table, publishing to a captured hub. */
function tableWith(tableId: string, players: SeatPlayer[]) {
  const e = new ServerTableEngine(tableId) as any;
  e.handController = new HandController(
    {
      tableId,
      handNumber: 3,
      gameVariant: 'nlh',
      smallBlind: 1,
      bigBlind: 2,
      rakeConfig: { percent: 0, cap: 0, noFlopNoDrop: true },
    },
    players,
    players[0].seat
  );
  e.tableInfo = { game_variant: 'nlh', small_blind: 1, big_blind: 2, max_players: 9 };
  e.handCount = 3;
  e.currentHandDealerSeat = players[0].seat;
  e.hub = { publish: vi.fn(), emitEvent: vi.fn(), sendToUser: vi.fn() };
  e.showHandCards = new Map();
  e.seatedPlayers = players.map((p) => ({
    user_id: p.user_id,
    seat_number: p.seat,
    stack: p.stack,
    username: p.username,
  }));
  return e;
}

const lastPublished = (e: any) => e.hub.publish.mock.calls.at(-1)?.[1];
const headsOn = (payload: any) =>
  Object.fromEntries((payload?.players ?? []).map((p: any) => [p.user_id, p.bounty]));
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

/** A ledger whose rows the test rewrites, read through the real refresher. */
function ledgerWith(rows: Array<{ user_id: string; current_bounty: number }>) {
  const ledger = { rows: rows.map((r) => ({ ...r })), reads: 0 };
  let clock = 0;
  const engines: any[] = [];
  const refresher = new SeatHeadsRefresher({
    read: async () => {
      ledger.reads++;
      return ledger.rows.map((r) => ({ ...r }));
    },
    publish: (heads) => {
      for (const engine of engines) engine.setSeatBounties(heads);
    },
    now: () => clock,
    later: (fn, ms) => {
      setTimeout(() => {
        clock += ms;
        fn();
      }, 0);
    },
    report: vi.fn(),
  });
  return {
    ledger,
    engines,
    refresher,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

afterEach(() => vi.useRealTimers());

describe('the head rides the table state', () => {
  it('publishes each seat head on the live broadcast and the resync', async () => {
    const t = tableWith('t1', [seat(1, 'a', 100), seat(2, 'b', 100), seat(3, 'c', 100)]);
    const world = ledgerWith([
      { user_id: 'a', current_bounty: 1 },
      { user_id: 'b', current_bounty: 2.5 },
      { user_id: 'c', current_bounty: 1 },
    ]);
    world.engines.push(t);
    world.refresher.request();
    await flush();
    expect(headsOn(lastPublished(t))).toEqual({ a: 1, b: 2.5, c: 1 });
    expect(headsOn(t.getTableState('a'))).toEqual({ a: 1, b: 2.5, c: 1 });
  });

  it('a knockout moves the winner up and the busted head to zero in the next broadcast', async () => {
    const t = tableWith('t1', [seat(1, 'danimal', 100), seat(2, 'cowboy', 100), seat(3, 'c', 100)]);
    const world = ledgerWith([
      { user_id: 'danimal', current_bounty: 2.75 },
      { user_id: 'cowboy', current_bounty: 5.25 },
      { user_id: 'c', current_bounty: 1 },
    ]);
    world.engines.push(t);
    world.refresher.request();
    await flush();
    // fn_collect_bounty: half of 5.25 to the wallet, 2.63 onto the head.
    world.ledger.rows = [
      { user_id: 'danimal', current_bounty: 5.38 },
      { user_id: 'cowboy', current_bounty: 0 },
      { user_id: 'c', current_bounty: 1 },
    ];
    world.advance(5_000);
    t.hub.publish.mockClear();
    world.refresher.request();
    await flush();
    expect(t.hub.publish).toHaveBeenCalled();
    expect(headsOn(lastPublished(t))).toEqual({ danimal: 5.38, cowboy: 0, c: 1 });
  });

  it('a split pot moves both winners heads', async () => {
    const t = tableWith('t1', [seat(1, 'a', 100), seat(2, 'b', 100), seat(3, 'x', 100)]);
    const world = ledgerWith([
      { user_id: 'a', current_bounty: 1 },
      { user_id: 'b', current_bounty: 1 },
      { user_id: 'x', current_bounty: 4 },
    ]);
    world.engines.push(t);
    world.refresher.request();
    await flush();
    world.ledger.rows = [
      { user_id: 'a', current_bounty: 2 },
      { user_id: 'b', current_bounty: 2 },
      { user_id: 'x', current_bounty: 0 },
    ];
    world.advance(5_000);
    world.refresher.request();
    await flush();
    expect(headsOn(lastPublished(t))).toEqual({ a: 2, b: 2, x: 0 });
  });

  it('a player moved to another table keeps his head there', async () => {
    const from = tableWith('t1', [seat(1, 'mover', 100), seat(2, 'b', 100)]);
    const to = tableWith('t2', [seat(4, 'c', 100), seat(5, 'mover', 100)]);
    const world = ledgerWith([
      { user_id: 'mover', current_bounty: 3.5 },
      { user_id: 'b', current_bounty: 1 },
      { user_id: 'c', current_bounty: 1 },
    ]);
    world.engines.push(from, to);
    world.refresher.request();
    await flush();
    expect(headsOn(lastPublished(to)).mover).toBe(3.5);
    // A table that joins later starts from the heads already read.
    const late = tableWith('t3', [seat(1, 'b', 100), seat(2, 'c', 100)]);
    late.setSeatBounties(world.refresher.current());
    await flush();
    expect(headsOn(late.getTableState('b'))).toEqual({ b: 1, c: 1 });
  });

  it('an unchanged head does not rebroadcast, and a table with no heads publishes no field', async () => {
    const t = tableWith('t1', [seat(1, 'a', 100), seat(2, 'b', 100)]);
    t.setSeatBounties(
      new Map([
        ['a', 1],
        ['b', 1],
      ])
    );
    await flush();
    t.hub.publish.mockClear();
    t.setSeatBounties(
      new Map([
        ['a', 1],
        ['b', 1],
        ['elsewhere', 9],
      ])
    );
    await flush();
    expect(t.hub.publish).not.toHaveBeenCalled();

    const cash = tableWith('t9', [seat(1, 'a', 100), seat(2, 'b', 100)]);
    expect(cash.getTableState('a').players.every((p: any) => !('bounty' in p))).toBe(true);
  });

  it('coalesces reads: never two in flight, one trailing read after a burst', async () => {
    let release!: () => void;
    let reads = 0;
    let clock = 0;
    const publish = vi.fn();
    const refresher = new SeatHeadsRefresher({
      read: () =>
        new Promise((resolve) => {
          reads++;
          const n = reads;
          release = () => resolve([{ user_id: 'a', current_bounty: n }]);
        }),
      publish,
      now: () => clock,
      later: (fn, ms) =>
        setTimeout(() => {
          clock += ms;
          fn();
        }, 0),
      report: vi.fn(),
    });
    refresher.request();
    refresher.request();
    refresher.request();
    expect(reads).toBe(1);
    release();
    await flush();
    await new Promise((resolve) => setTimeout(resolve, 5));
    // The burst during the first read earns exactly one trailing read.
    expect(reads).toBe(2);
    release();
    await flush();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(reads).toBe(2);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(refresher.current()?.get('a')).toBe(2);
  });

  it('a failed read keeps the last heads and reports once', async () => {
    const report = vi.fn();
    let fail = false;
    let clock = 0;
    const published: Array<ReadonlyMap<string, number>> = [];
    const refresher = new SeatHeadsRefresher({
      read: async () => (fail ? null : [{ user_id: 'a', current_bounty: 2 }]),
      publish: (h) => published.push(h),
      now: () => clock,
      later: (fn) => setTimeout(fn, 0),
      report,
    });
    refresher.request();
    await flush();
    fail = true;
    clock += 10_000;
    refresher.request();
    await flush();
    clock += 10_000;
    refresher.request();
    await flush();
    expect(published).toHaveLength(1);
    expect(refresher.current()?.get('a')).toBe(2);
    expect(report).toHaveBeenCalledTimes(1);
  });

  it('copies only ledger heads and only for bounty events', () => {
    expect([
      ...headsFromRows([
        { user_id: 'a', current_bounty: '2.50' },
        { user_id: null, current_bounty: 3 },
        { user_id: 'b', current_bounty: null },
        { user_id: 'c', current_bounty: -1 },
      ]),
    ]).toEqual([['a', 2.5]]);
    expect(isSeatBountyEvent({ is_pko: true })).toBe(true);
    expect(isSeatBountyEvent({ is_bounty: true })).toBe(true);
    expect(isSeatBountyEvent({ is_mystery_bounty: true })).toBe(true);
    expect(isSeatBountyEvent({ is_pko: false })).toBe(false);
    expect(isSeatBountyEvent(null)).toBe(false);
  });
});
