/**
 * A BUSTED CASH SEAT GETS TWENTY SECONDS, OR NONE (Dan 2026-11-09).
 *
 * "WHEN A PLAYER LOSES ALL HIS CHIPS, THERE SHOULD BE A REALTIME CHECK OF THE
 * DATABASE TO SEE IF HE HAS CHIPS IN HIS WALLET TO REBUY, AND IF HE DOESN'T, IT
 * KICKS HIM OFF THE TABLE RIGHT AWAY. IF HE DOES GIVE THE PLAYER 20 SECONDS TO
 * REBUY BEFORE KICKING THEM OFF THE TABLE."
 *
 * Before this a chip cash seat at zero was released after ten seconds with
 * nobody minding it, and never while its owner left the rebuy sheet open; and
 * at a union table the wallet was asked of the union's club row, which holds
 * no member wallet, so every busted player read as able to rebuy.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sliceMethod } from '../testHelpers/sourceWindow.js';

const wallets = vi.hoisted(() => ({
  read: vi.fn(async (..._args: unknown[]) => new Map<string, number>()),
}));
/* The rows a PostgREST read returns, per table. Anything not modeled answers
   with an error, which the engine treats as an unreadable read. */
const db = vi.hoisted(() => ({
  rows: {} as Record<string, unknown[] | Error>,
}));
function query(table: string) {
  const answer = db.rows[table];
  const result =
    answer instanceof Error
      ? { data: null, error: answer }
      : answer === undefined
        ? { data: null, error: new Error('Unmodeled database read: ' + table) }
        : { data: answer, error: null };
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'is', 'order', 'limit', 'gte']) chain[m] = () => chain;
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

vi.mock('../services/supabase/client.js', () => ({
  supabase: {
    from: vi.fn((table: string) => query(table)),
    rpc: vi.fn(() => {
      throw new Error('Unmodeled database RPC in bust-window fixture');
    }),
  },
  maintenanceSupabase: {},
}));
vi.mock('../services/supabase/wallets.js', async (original) => ({
  ...(await original<typeof import('../services/supabase/wallets.js')>()),
  readSeatWalletBalances: wallets.read,
}));

const { ServerTableEngine } = await import('./ServerTableEngine.js');
const { setMaintenanceFrozen } = await import('../maintenance/freezeState.js');
const {
  BUST_REBUY_WINDOW_MS,
  bustRebuyRemainingMs,
  bustRebuyVerdict,
  bustRebuyWindowExpired,
  cashRebuyMinimum,
  durableBustElapsedMs,
  rebuyRowInTime,
} = await import('./BustRebuyWindow.js');

const TABLE = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const MIN_BUY_IN = 80; // 40 big blinds at 1/2

afterEach(() => {
  setMaintenanceFrozen(false);
  vi.useRealTimers();
  wallets.read.mockReset();
  wallets.read.mockImplementation(async () => new Map<string, number>());
  db.rows = {};
});

function hero() {
  return {
    user_id: 'hero',
    occupancy_id: 'occ-hero',
    username: 'hero',
    seat_number: 4,
    stack: 0,
    is_horse: false,
  };
}

function cashEngine(players: Array<Record<string, unknown>> = [hero()]) {
  const engine = Object.create(ServerTableEngine.prototype) as any;
  engine.tableId = TABLE;
  engine.tableInfo = {
    club_id: 'union-row',
    big_blind: 2,
    small_blind: 1,
    arena: { asset: 'chips' },
  };
  engine.seatedPlayers = players;
  engine.bustedSince = new Map<string, number>();
  engine.lightningBustedSince = new Map<string, number>();
  engine.rebuyPromptOpenAt = new Map<string, number>();
  engine.pendingAddOns = new Map<string, number>();
  engine.handController = null;
  engine.isTournamentTable = () => false;
  engine.hub = { sendToUser: vi.fn(), emitEvent: vi.fn() };
  engine.usersWithPendingLedgerChips = vi.fn(async () => new Set<string>());
  engine.releaseBustedSeat = vi.fn(async () => true);
  engine.requestPendingAddOnSweep = vi.fn();
  engine.lifecycleCanMutate = () => true;
  engine.armBustRebuyExpiry = vi.fn();
  return engine;
}

function startClock() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-09T18:00:00Z'));
}

describe('the rule itself', () => {
  it('a wallet under the minimum cannot rebuy; one that covers it can', () => {
    expect(bustRebuyVerdict(79.99, MIN_BUY_IN)).toBe('cannot_rebuy');
    expect(bustRebuyVerdict(0, MIN_BUY_IN)).toBe('cannot_rebuy');
    expect(bustRebuyVerdict(80, MIN_BUY_IN)).toBe('can_rebuy');
  });

  it('an unread wallet or an unpriced table is never a reason to stand a player up', () => {
    expect(bustRebuyVerdict(undefined, MIN_BUY_IN)).toBe('can_rebuy');
    expect(bustRebuyVerdict(Number.NaN, MIN_BUY_IN)).toBe('can_rebuy');
    expect(bustRebuyVerdict(0, 0)).toBe('can_rebuy');
    expect(bustRebuyVerdict(0, Number.NaN)).toBe('can_rebuy');
  });

  it('the window is twenty seconds and is measured from the bust', () => {
    expect(BUST_REBUY_WINDOW_MS).toBe(20_000);
    expect(bustRebuyWindowExpired('can_rebuy', 1_000, 20_999)).toBe(false);
    expect(bustRebuyWindowExpired('can_rebuy', 1_000, 21_000)).toBe(true);
    expect(bustRebuyWindowExpired('cannot_rebuy', 1_000, 1_000)).toBe(true);
    expect(bustRebuyRemainingMs(1_000, 6_000)).toBe(15_000);
    expect(bustRebuyRemainingMs(1_000, 60_000)).toBe(0);
  });
});

describe('a player who has just lost their last chip', () => {
  it('is released on the first sweep when the wallet cannot cover a rebuy', async () => {
    startClock();
    const engine = cashEngine();
    wallets.read.mockResolvedValue(new Map([['hero', 12.5]]));

    engine.noteCashBust(engine.seatedPlayers);
    await engine.standUpBustedCashPlayers();

    expect(engine.releaseBustedSeat).toHaveBeenCalledTimes(1);
    expect(engine.releaseBustedSeat.mock.calls[0][0].user_id).toBe('hero');
    expect(engine.releaseBustedSeat.mock.calls[0][1]).toBe('busted_insufficient_chips');
    expect(engine.seatedPlayers).toEqual([]);
    // Nobody is told they have twenty seconds they do not have.
    expect(engine.hub.sendToUser).not.toHaveBeenCalled();
  });

  it('asks the wallet the seat was bought from, never the table club', async () => {
    startClock();
    const engine = cashEngine();
    engine.noteCashBust(engine.seatedPlayers);
    await engine.standUpBustedCashPlayers();
    expect(wallets.read).toHaveBeenCalledWith(TABLE, ['hero']);
  });

  it('is held for twenty seconds from the bust when the wallet covers a rebuy, then released', async () => {
    startClock();
    const engine = cashEngine();
    wallets.read.mockResolvedValue(new Map([['hero', 500]]));

    engine.noteCashBust(engine.seatedPlayers);
    // The table's own five-second pause passes before the first sweep.
    vi.setSystemTime(Date.now() + 5_000);
    await engine.standUpBustedCashPlayers();
    expect(engine.releaseBustedSeat).not.toHaveBeenCalled();
    expect(engine.hub.sendToUser).toHaveBeenCalledWith(TABLE, 'hero', {
      kind: 'bust_rebuy_window',
      table_id: TABLE,
      user_id: 'hero',
      occupancy_id: 'occ-hero',
      remaining_ms: 15_000,
      // The bust's deadline on the engine's clock: bust + 20 s.
      deadline_at_ms: Date.now() + 15_000,
      window_ms: 20_000,
    });

    vi.setSystemTime(Date.now() + 14_999);
    await engine.standUpBustedCashPlayers();
    expect(engine.releaseBustedSeat).not.toHaveBeenCalled();

    vi.setSystemTime(Date.now() + 1);
    await engine.standUpBustedCashPlayers();
    expect(engine.releaseBustedSeat).toHaveBeenCalledTimes(1);
    expect(engine.releaseBustedSeat.mock.calls[0][1]).toBe('busted_no_rebuy');
    // Judged once, told once.
    expect(wallets.read).toHaveBeenCalledTimes(1);
    expect(engine.hub.sendToUser).toHaveBeenCalledTimes(1);
  });

  it('gets no extra time for leaving the rebuy sheet open', async () => {
    startClock();
    const engine = cashEngine();
    wallets.read.mockResolvedValue(new Map([['hero', 500]]));
    engine.noteCashBust(engine.seatedPlayers);
    await engine.standUpBustedCashPlayers();

    for (let elapsed = 0; elapsed < 20_000; elapsed += 4_000) {
      vi.setSystemTime(Date.now() + 4_000);
      engine.rebuyPromptOpenAt.set('hero', Date.now()); // the sheet's heartbeat
      await engine.standUpBustedCashPlayers();
    }
    expect(engine.releaseBustedSeat).toHaveBeenCalledTimes(1);
  });

  it('keeps the seat when the wallet could not be read, for the same twenty seconds', async () => {
    startClock();
    const engine = cashEngine();
    engine.noteCashBust(engine.seatedPlayers);
    await engine.standUpBustedCashPlayers();
    expect(engine.releaseBustedSeat).not.toHaveBeenCalled();
    vi.setSystemTime(Date.now() + 20_000);
    await engine.standUpBustedCashPlayers();
    expect(engine.releaseBustedSeat).toHaveBeenCalledTimes(1);
    expect(engine.releaseBustedSeat.mock.calls[0][1]).toBe('busted_no_rebuy');
  });

  it('is never released while a rebuy they paid for is on its way', async () => {
    startClock();
    const engine = cashEngine();
    // The purchase emptied the wallet and wrote its ledger row together.
    wallets.read.mockResolvedValue(new Map([['hero', 0]]));
    engine.usersWithPendingLedgerChips = vi.fn(async () => new Set(['hero']));
    engine.noteCashBust(engine.seatedPlayers);
    await engine.standUpBustedCashPlayers();
    vi.setSystemTime(Date.now() + 60_000);
    await engine.standUpBustedCashPlayers();
    expect(engine.releaseBustedSeat).not.toHaveBeenCalled();
  });

  it('reads the wallet before the ledger, so a purchase between the two is never missed', async () => {
    startClock();
    const engine = cashEngine();
    const order: string[] = [];
    wallets.read.mockImplementation(async () => {
      order.push('wallet');
      return new Map([['hero', 500]]);
    });
    engine.usersWithPendingLedgerChips = vi.fn(async () => {
      order.push('ledger');
      return new Set<string>();
    });
    engine.noteCashBust(engine.seatedPlayers);
    await engine.standUpBustedCashPlayers();
    expect(order).toEqual(['wallet', 'ledger']);
  });

  it('is judged afresh on the next bust after a rebuy', async () => {
    startClock();
    const engine = cashEngine();
    wallets.read.mockResolvedValue(new Map([['hero', 500]]));
    engine.noteCashBust(engine.seatedPlayers);
    await engine.standUpBustedCashPlayers();

    engine.seatedPlayers[0].stack = 200; // rebought
    await engine.standUpBustedCashPlayers();
    engine.seatedPlayers[0].stack = 0; // and lost it
    wallets.read.mockResolvedValue(new Map([['hero', 3]]));
    engine.noteCashBust(engine.seatedPlayers);
    await engine.standUpBustedCashPlayers();

    expect(engine.releaseBustedSeat).toHaveBeenCalledTimes(1);
    expect(engine.releaseBustedSeat.mock.calls[0][1]).toBe('busted_insufficient_chips');
  });
});

describe('a seat merely found at zero', () => {
  it('is not released on sight even with an empty wallet: its first chips may be arriving', async () => {
    startClock();
    const engine = cashEngine();
    wallets.read.mockResolvedValue(new Map([['hero', 0]]));

    await engine.standUpBustedCashPlayers(); // no bust was witnessed
    expect(engine.releaseBustedSeat).not.toHaveBeenCalled();

    vi.setSystemTime(Date.now() + ServerTableEngine.BUSTED_GRACE_MS);
    await engine.standUpBustedCashPlayers();
    expect(engine.releaseBustedSeat).toHaveBeenCalledTimes(1);
    expect(engine.releaseBustedSeat.mock.calls[0][1]).toBe('busted_insufficient_chips');
  });
});

describe('where the rule does not reach', () => {
  it('leaves a tournament seat to its elimination', async () => {
    const engine = cashEngine();
    engine.isTournamentTable = () => true;
    engine.noteCashBust(engine.seatedPlayers);
    await engine.standUpBustedCashPlayers();
    expect(wallets.read).not.toHaveBeenCalled();
    expect(engine.releaseBustedSeat).not.toHaveBeenCalled();
  });

  it('leaves Diamond and Lightning seats on their own clocks', async () => {
    for (const shape of ['diamonds', 'lightning'] as const) {
      startClock();
      const engine = cashEngine();
      if (shape === 'diamonds') engine.tableInfo.arena.asset = 'diamonds';
      else engine.clusterLightningEnabled = true;
      engine.noteCashBust(engine.seatedPlayers);
      await engine.standUpBustedCashPlayers();
      expect(wallets.read, shape).not.toHaveBeenCalled();
      expect(engine.releaseBustedSeat, shape).not.toHaveBeenCalled();
      vi.useRealTimers();
    }
  });
});

describe('the minimum is the one the purchase enforces', () => {
  it('is greatest(min_buy_in, 40 big blinds), as atomic_table_rebuy reads it', () => {
    expect(cashRebuyMinimum({ min_buy_in: 40, big_blind: 2 })).toBe(80);
    expect(cashRebuyMinimum({ min_buy_in: 200, big_blind: 2 })).toBe(200);
    expect(cashRebuyMinimum({ min_buy_in: null, big_blind: 0.1 })).toBe(4);
    expect(cashRebuyMinimum({ min_buy_in: 0, big_blind: 0 })).toBe(0);
  });

  it('stands up a wallet the seat-taking minimum would have held', async () => {
    startClock();
    const engine = cashEngine();
    engine.tableInfo.min_buy_in = 40; // seat-taking minimum 40, rebuy minimum 80
    wallets.read.mockResolvedValue(new Map([['hero', 60]]));
    engine.noteCashBust(engine.seatedPlayers);
    await engine.standUpBustedCashPlayers();
    expect(engine.releaseBustedSeat.mock.calls[0]?.[1]).toBe('busted_insufficient_chips');
  });
});

describe('the end of the window', () => {
  function judgedEngine() {
    startClock();
    const engine = cashEngine();
    wallets.read.mockResolvedValue(new Map([['hero', 500]]));
    engine.noteCashBust(engine.seatedPlayers);
    return engine;
  }

  it('arms a timer for what is left, so the seat goes at twenty seconds and not at the next hand', async () => {
    const engine = judgedEngine();
    vi.setSystemTime(Date.now() + 5_000);
    await engine.standUpBustedCashPlayers();
    expect(engine.armBustRebuyExpiry).toHaveBeenCalledWith('occ-hero', 15_000);
  });

  it('releases an expired seat that has no rebuy row', async () => {
    const engine = judgedEngine();
    await engine.standUpBustedCashPlayers();
    vi.setSystemTime(Date.now() + 20_000);
    db.rows.table_pending_addons = [];
    await engine.releaseExpiredBustWindows();
    expect(engine.releaseBustedSeat).toHaveBeenCalledTimes(1);
    expect(engine.releaseBustedSeat.mock.calls[0][1]).toBe('busted_no_rebuy');
    expect(engine.seatedPlayers).toEqual([]);
    // A row that raced the release is refunded by the next pending pass.
    expect(engine.requestPendingAddOnSweep).toHaveBeenCalled();
  });

  it('keeps a seat whose rebuy the database stamped inside the window', async () => {
    const engine = judgedEngine();
    await engine.standUpBustedCashPlayers();
    const paidAt = new Date(Date.now() + 19_000).toISOString();
    vi.setSystemTime(Date.now() + 20_500);
    db.rows.table_pending_addons = [{ user_id: 'hero', created_at: paidAt }];
    await engine.releaseExpiredBustWindows();
    expect(engine.releaseBustedSeat).not.toHaveBeenCalled();
    expect(engine.requestPendingAddOnSweep).toHaveBeenCalled();
  });

  it('releases a seat whose rebuy arrived after the window (the vacated seat refunds it)', async () => {
    const engine = judgedEngine();
    await engine.standUpBustedCashPlayers();
    const lateAt = new Date(Date.now() + 25_000).toISOString();
    vi.setSystemTime(Date.now() + 25_500);
    db.rows.table_pending_addons = [{ user_id: 'hero', created_at: lateAt }];
    await engine.releaseExpiredBustWindows();
    expect(engine.releaseBustedSeat).toHaveBeenCalledTimes(1);
  });

  it('keeps the seat and asks again when the rebuy rows cannot be read', async () => {
    const engine = judgedEngine();
    await engine.standUpBustedCashPlayers();
    vi.setSystemTime(Date.now() + 20_000);
    db.rows.table_pending_addons = new Error('read failed');
    await engine.releaseExpiredBustWindows();
    expect(engine.releaseBustedSeat).not.toHaveBeenCalled();
    expect(engine.armBustRebuyExpiry).toHaveBeenLastCalledWith('occ-hero', 1_000);
  });

  it('does nothing during a freeze, and the freeze does not use up the window', async () => {
    const engine = judgedEngine();
    await engine.standUpBustedCashPlayers();
    vi.setSystemTime(Date.now() + 8_000);
    setMaintenanceFrozen(true);
    vi.setSystemTime(Date.now() + 300_000); // a five-minute break
    await engine.releaseExpiredBustWindows();
    expect(engine.releaseBustedSeat).not.toHaveBeenCalled();
    setMaintenanceFrozen(false);
    db.rows.table_pending_addons = [];
    await engine.releaseExpiredBustWindows();
    expect(engine.releaseBustedSeat).not.toHaveBeenCalled(); // 12 s still left
    vi.setSystemTime(Date.now() + 12_000);
    await engine.releaseExpiredBustWindows();
    expect(engine.releaseBustedSeat).toHaveBeenCalledTimes(1);
  });

  it('never releases a player who is still in the live hand', async () => {
    const engine = judgedEngine();
    await engine.standUpBustedCashPlayers();
    vi.setSystemTime(Date.now() + 20_000);
    db.rows.table_pending_addons = [];
    engine.handController = {
      getState: () => ({ players: [{ user_id: 'hero', is_folded: false, is_all_in: true }] }),
    };
    await engine.releaseExpiredBustWindows();
    expect(engine.releaseBustedSeat).not.toHaveBeenCalled();
  });

  it('releases once when the timer and the boundary sweep arrive together', async () => {
    const engine = judgedEngine();
    let finish!: (v: boolean) => void;
    engine.releaseBustedSeat = vi.fn(() => new Promise<boolean>((r) => (finish = r)));
    const a = engine.releaseFixedWindowSeat(engine.seatedPlayers[0], 'busted_no_rebuy');
    const b = engine.releaseFixedWindowSeat(engine.seatedPlayers[0], 'busted_no_rebuy');
    finish(true);
    expect(await a).toBe(true);
    expect(await b).toBe(true);
    expect(engine.releaseBustedSeat).toHaveBeenCalledTimes(1);
  });
});

describe('nothing renews the window', () => {
  it('a reopened or reloaded sheet is told what is left, not twenty seconds', async () => {
    startClock();
    const engine = cashEngine();
    wallets.read.mockResolvedValue(new Map([['hero', 500]]));
    engine.noteCashBust(engine.seatedPlayers);
    await engine.standUpBustedCashPlayers();
    engine.hub.sendToUser.mockClear();
    vi.setSystemTime(Date.now() + 12_000);
    engine.noteRebuyPromptOpen('hero');
    engine.noteRebuyPromptOpen('hero'); // throttled
    expect(engine.hub.sendToUser).toHaveBeenCalledTimes(1);
    expect(engine.hub.sendToUser.mock.calls[0][2].remaining_ms).toBe(8_000);
    expect(engine.rebuyPromptOpenAt.has('hero')).toBe(true);
  });

  it('a restarted engine resumes the window from the accepted-hand record', async () => {
    startClock();
    const engine = cashEngine(); // a fresh engine: it never saw the bust
    wallets.read.mockResolvedValue(new Map([['hero', 500]]));
    db.rows.hand_atomic_commits = [
      {
        committed_at: new Date(Date.now() - 14_000).toISOString(),
        stacks: [{ user_id: 'hero', stack: 0 }],
      },
    ];
    db.rows.engine_maintenance_thaws = [];
    await engine.standUpBustedCashPlayers();
    expect(engine.hub.sendToUser.mock.calls[0][2].remaining_ms).toBe(6_000);
    vi.setSystemTime(Date.now() + 6_000);
    db.rows.table_pending_addons = [];
    await engine.releaseExpiredBustWindows();
    expect(engine.releaseBustedSeat).toHaveBeenCalledTimes(1);
  });

  it('a restart that reads a short wallet releases at once, the bust being on record', async () => {
    startClock();
    const engine = cashEngine();
    wallets.read.mockResolvedValue(new Map([['hero', 3]]));
    db.rows.hand_atomic_commits = [
      {
        committed_at: new Date(Date.now() - 2_000).toISOString(),
        stacks: [{ user_id: 'hero', stack: 0 }],
      },
    ];
    db.rows.engine_maintenance_thaws = [];
    await engine.standUpBustedCashPlayers();
    expect(engine.releaseBustedSeat.mock.calls[0]?.[1]).toBe('busted_insufficient_chips');
  });

  it('the record excludes a maintenance freeze after the bust', () => {
    const now = Date.parse('2026-11-11T10:06:00Z');
    const commits = [
      { committed_at: '2026-11-11T09:59:58Z', stacks: [{ user_id: 'hero', stack: 0 }] },
    ];
    const thaws = [{ freeze_started_at: '2026-11-11T10:00:00Z', frozen_seconds: 352 }];
    // 362 s on the wall, 352 of them frozen: 10 s of the window used.
    expect(durableBustElapsedMs(commits, thaws, 'hero', now)).toBe(10_000);
    // The newest hand listing the player had chips: not a bust on record.
    expect(
      durableBustElapsedMs(
        [
          { committed_at: '2026-11-11T10:05:00Z', stacks: [{ user_id: 'hero', stack: 40 }] },
          ...commits,
        ],
        thaws,
        'hero',
        now
      )
    ).toBeNull();
  });

  it('a row stamped within the clock tolerance of the end counts as paid in time', () => {
    expect(rebuyRowInTime(10_999, 10_000)).toBe(true);
    expect(rebuyRowInTime(11_001, 10_000)).toBe(false);
    expect(rebuyRowInTime(Number.NaN, 10_000)).toBe(true);
  });
});

describe('the offer leaves with the bust (2026-11-11)', () => {
  /* The sheet opened at the bust, but its deadline was sent by the next
     boundary sweep, after the table pause and the next hand's bookkeeping.
     On a slow table that came after the twenty seconds and the clock never
     appeared. The offer is now judged and sent at the bust itself. */
  function bustAt() {
    startClock();
    const engine = cashEngine();
    engine.noteCashBust(engine.seatedPlayers);
    return engine;
  }
  const offer = (remaining: number) => ({
    kind: 'bust_rebuy_window',
    table_id: TABLE,
    user_id: 'hero',
    occupancy_id: 'occ-hero',
    remaining_ms: remaining,
    deadline_at_ms: Date.now() + remaining,
    window_ms: 20_000,
  });

  it('tells an affordable bust its full twenty seconds at once and arms the deadline', async () => {
    const engine = bustAt();
    wallets.read.mockResolvedValue(new Map([['hero', 500]]));
    const read = await engine.offerCashBustWindows(engine.seatedPlayers);
    expect(read.get('hero')).toBe(500);
    expect(engine.hub.sendToUser).toHaveBeenCalledWith(TABLE, 'hero', offer(20_000));
    expect(engine.armBustRebuyExpiry).toHaveBeenCalledWith('occ-hero', 20_000);
  });

  it('a boundary sweep that runs past twenty seconds releases without a second offer or read', async () => {
    const engine = bustAt();
    wallets.read.mockResolvedValue(new Map([['hero', 500]]));
    await engine.offerCashBustWindows(engine.seatedPlayers);
    vi.setSystemTime(Date.now() + 22_500); // this table's ordinary hand gap
    await engine.standUpBustedCashPlayers();
    expect(engine.releaseBustedSeat).toHaveBeenCalledTimes(1);
    expect(engine.releaseBustedSeat.mock.calls[0][1]).toBe('busted_no_rebuy');
    expect(wallets.read).toHaveBeenCalledTimes(1);
    expect(engine.hub.sendToUser).toHaveBeenCalledTimes(1);
  });

  it('a player who paid inside the window stays seated through the sweep and the expiry', async () => {
    const engine = bustAt();
    wallets.read.mockResolvedValue(new Map([['hero', 500]]));
    await engine.offerCashBustWindows(engine.seatedPlayers);
    const paidAt = new Date(Date.now() + 9_000).toISOString();
    vi.setSystemTime(Date.now() + 21_000);
    db.rows.table_pending_addons = [{ user_id: 'hero', created_at: paidAt }];
    await engine.releaseExpiredBustWindows();
    engine.usersWithPendingLedgerChips = vi.fn(async () => new Set(['hero']));
    await engine.standUpBustedCashPlayers();
    expect(engine.releaseBustedSeat).not.toHaveBeenCalled();
    expect(engine.seatedPlayers.map((p: { user_id: string }) => p.user_id)).toEqual(['hero']);
    expect(engine.requestPendingAddOnSweep).toHaveBeenCalled();
  });

  it('an empty wallet gets no offer and is released on the first sweep', async () => {
    const engine = bustAt();
    wallets.read.mockResolvedValue(new Map([['hero', 0]]));
    await engine.offerCashBustWindows(engine.seatedPlayers);
    expect(engine.hub.sendToUser).not.toHaveBeenCalled();
    expect(engine.armBustRebuyExpiry).not.toHaveBeenCalled();
    await engine.standUpBustedCashPlayers();
    expect(engine.releaseBustedSeat.mock.calls[0][1]).toBe('busted_insufficient_chips');
    expect(wallets.read).toHaveBeenCalledTimes(1);
  });

  it('an unreadable wallet is offered the twenty seconds, never refused', async () => {
    const engine = bustAt();
    wallets.read.mockResolvedValue(new Map()); // read failed: nothing known
    await engine.offerCashBustWindows(engine.seatedPlayers);
    expect(engine.hub.sendToUser).toHaveBeenCalledWith(TABLE, 'hero', offer(20_000));
    vi.setSystemTime(Date.now() + 10_000);
    await engine.standUpBustedCashPlayers();
    expect(engine.releaseBustedSeat).not.toHaveBeenCalled();
  });

  it('decides the table pause from the same read, with no second query', async () => {
    const engine = bustAt();
    const read = new Map([['hero', 500]]);
    expect(await engine.anyBustedPlayerCanAffordARebuy(engine.seatedPlayers, read)).toBe(true);
    expect(
      await engine.anyBustedPlayerCanAffordARebuy(engine.seatedPlayers, new Map([['hero', 1]]))
    ).toBe(false);
    expect(wallets.read).not.toHaveBeenCalled();
  });

  it('a horse is not judged here: it answers at the bust through its own recovery', async () => {
    startClock();
    const engine = cashEngine([{ ...hero(), is_horse: true }]);
    engine.noteCashBust(engine.seatedPlayers);
    expect(await engine.offerCashBustWindows(engine.seatedPlayers)).toBeUndefined();
    expect(wallets.read).not.toHaveBeenCalled();
  });
});

describe('the wiring', () => {
  const dir = join(process.cwd(), 'src');
  const dealing = readFileSync(join(dir, 'engine', 'ServerTableEngineDealing.ts'), 'utf8');

  it('releases expired windows before pending add-ons are delivered at the boundary', () => {
    const expire = dealing.indexOf('await this.releaseExpiredBustWindows();');
    const deliver = dealing.indexOf("'pending_addons',");
    expect(expire).toBeGreaterThan(-1);
    expect(deliver).toBeGreaterThan(expire);
  });

  it('starts the clock at the end of the hand, before the table pause', () => {
    const noted = dealing.indexOf('this.noteCashBust(justBustedPlayers);');
    const paused = dealing.indexOf('await this.waitForRebuyDecisions(');
    expect(noted).toBeGreaterThan(-1);
    expect(paused).toBeGreaterThan(noted);
  });

  it('sends the offer at the bust, before the table pause, from the read the pause uses', () => {
    const noted = dealing.indexOf('this.noteCashBust(justBustedPlayers);');
    const offered = dealing.indexOf('await this.offerCashBustWindows(justBustedPlayers);');
    const paused = dealing.indexOf('await this.waitForRebuyDecisions(');
    expect(offered).toBeGreaterThan(noted);
    expect(paused).toBeGreaterThan(offered);
    expect(dealing).toMatch(
      /anyBustedPlayerCanAffordARebuy\(\s*justBustedPlayers,\s*bustWallets\s*\)/
    );
  });

  it('the sheet never lets a later frame push its deadline back', () => {
    // 2026-11-11: one decision per frame, keyed by the bust's own deadline
    // (tests/unit/bustRebuyDeadline.test.ts covers its cases).
    const page = readFileSync(join(process.cwd(), '..', 'src', 'pages', 'TablePage.tsx'), 'utf8');
    expect(page).toContain('nextBustRebuyClock(');
    expect(page).toContain('bustRebuyServerDeadlineRef.current = next.serverDeadlineAt;');
  });

  it('every resend of one bust names it by the same deadline', async () => {
    startClock();
    const engine = cashEngine();
    engine.noteCashBust(engine.seatedPlayers);
    wallets.read.mockResolvedValue(new Map([['hero', 500]]));
    await engine.offerCashBustWindows(engine.seatedPlayers);
    const first = engine.hub.sendToUser.mock.calls[0][2];
    vi.setSystemTime(Date.now() + 6_000);
    engine.noteRebuyPromptOpen('hero');
    const resent = engine.hub.sendToUser.mock.calls[1][2];
    expect(resent.remaining_ms).toBe(first.remaining_ms - 6_000);
    expect(resent.deadline_at_ms).toBe(first.deadline_at_ms);
    expect(resent.occupancy_id).toBe('occ-hero');
  });

  it('decides the table pause from the same seat wallet', () => {
    const body = sliceMethod(dealing, 'protected async anyBustedPlayerCanAffordARebuy');
    expect(body).toContain('readSeatWalletBalances(');
    expect(body).not.toContain('readClubChipBalances(');
  });

  it('reads the club the seat names', () => {
    const source = readFileSync(join(dir, 'services', 'supabase', 'wallets.ts'), 'utf8');
    const body = sliceMethod(source, 'export async function readSeatWalletBalances');
    expect(body).toContain(".select('user_id, club_id')");
    expect(body).toContain(".is('left_at', null)");
    expect(body).toContain('readClubChipBalances(club, users)');
    expect(body).not.toContain('fallbackClubId');
  });
});
