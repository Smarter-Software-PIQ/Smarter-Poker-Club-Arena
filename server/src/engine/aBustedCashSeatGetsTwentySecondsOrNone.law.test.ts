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

vi.mock('../services/supabase/client.js', () => ({
  supabase: {
    from: vi.fn(() => {
      throw new Error('Unmodeled database read in bust-window fixture');
    }),
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
const { BUST_REBUY_WINDOW_MS, bustRebuyRemainingMs, bustRebuyVerdict, bustRebuyWindowExpired } =
  await import('./BustRebuyWindow.js');

const TABLE = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const MIN_BUY_IN = 80; // 40 big blinds at 1/2

afterEach(() => {
  vi.useRealTimers();
  wallets.read.mockReset();
  wallets.read.mockImplementation(async () => new Map<string, number>());
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

  it('asks the wallet the seat was bought from, with the table club only as fallback', async () => {
    startClock();
    const engine = cashEngine();
    engine.noteCashBust(engine.seatedPlayers);
    await engine.standUpBustedCashPlayers();
    expect(wallets.read).toHaveBeenCalledWith(TABLE, ['hero'], 'union-row');
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
      remaining_ms: 15_000,
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

describe('the wiring', () => {
  const dir = join(process.cwd(), 'src');
  const dealing = readFileSync(join(dir, 'engine', 'ServerTableEngineDealing.ts'), 'utf8');

  it('starts the clock at the end of the hand, before the table pause', () => {
    const noted = dealing.indexOf('this.noteCashBust(justBustedPlayers);');
    const paused = dealing.indexOf('await this.waitForRebuyDecisions(');
    expect(noted).toBeGreaterThan(-1);
    expect(paused).toBeGreaterThan(noted);
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
  });
});
