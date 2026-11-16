/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  A SEAT STAYS UNTIL ITS POT HAS BEEN PUSHED (Dan 2026-11-15, binding)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Dan: "THE PREVIOUS HAND PLAYED, DID NOT AWARD THE POT, OR SHIP IT TO THE
 * WINNING PLAYER ANIMATION... GET TO THE ROOT CAUSE AND FIX WHAT EVER
 * PREVENTED THE ANIMATIONS FROM AWARDING THE POT."
 *
 * Hand 59517030 (Kings Club, Madness PLO5 1/2, 2026-11-15): the seat-4 winner
 * stood up 1.26 s after HAND_COMPLETE. The hand controller is already null
 * then, so leaveTable cashed the seat out on the spot, every client lost the
 * winner's chair, and the pot had nowhere to fly.
 *
 * The pins:
 *   - a participant of the hand still being presented gets the leave accepted
 *     and recorded (durable departure request), but the seat is NOT cashed out
 *     and stays on the felt;
 *   - when the completion hold ends, the seat is taken out of the next deal
 *     (the next-hand leave_pending sweep cashes it out);
 *   - someone who was NOT dealt into that hand still leaves immediately;
 *   - the dealing loop opens the window at the deal and closes it right after
 *     the completion hold.
 * Every behavioural spec has a human and a horse twin (CLAUDE.md 10.5).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const departure = vi.fn();
const cashout = vi.fn();

vi.mock('../services/supabase/seats.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/supabase/seats.js')>();
  return {
    ...actual,
    requestSeatDeparture: (...args: unknown[]) => departure(...args),
    atomicCashout: (...args: unknown[]) => cashout(...args),
  };
});
vi.mock('../services/supabase.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/supabase.js')>();
  return {
    ...actual,
    atomicCashout: (...args: unknown[]) => cashout(...args),
    markSeatAsLeft: vi.fn(async () => {
      throw new Error('markSeatAsLeft must never be a leave fallback');
    }),
  };
});

const { ServerTableEngine } = await import('./ServerTableEngine.js');
const { deadlineScheduler } = await import('./DeadlineScheduler.js');

const TABLE = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd5';
const HUMAN = 'bbbbbbbb-0000-4000-8000-000000000011';
const HORSE = 'bbbbbbbb-0000-4000-8000-000000000012';
const LATE = 'bbbbbbbb-0000-4000-8000-000000000013';
const OCC: Record<string, string> = {
  [HUMAN]: 'eeeeeeee-0000-4000-8000-000000000011',
  [HORSE]: 'eeeeeeee-0000-4000-8000-000000000012',
  [LATE]: 'eeeeeeee-0000-4000-8000-000000000013',
};

function makeEngineInCompletionHold() {
  const e = new ServerTableEngine(TABLE) as any;
  e.tableInfo = {
    id: TABLE,
    club_id: 'club',
    small_blind: 1,
    big_blind: 2,
    game_variant: 'plo5',
    max_players: 6,
    game_type: 'cash',
    min_buy_in: 100,
    max_buy_in: 400,
  };
  e.running = true;
  e.seatedPlayers = [HUMAN, HORSE, LATE].map((user_id, i) => ({
    user_id,
    username: `p${i + 1}`,
    stack: 500,
    seat_number: i + 1,
    is_horse: user_id === HORSE,
    occupancy_id: OCC[user_id],
  }));
  // HAND_COMPLETE has fired: the controller is gone, the pot is not yet pushed.
  e.handController = null;
  e.beginCompletionPresentation([{ user_id: HUMAN }, { user_id: HORSE }]);
  e.markHandCompletedForPresentation();
  e.hub = { emitEvent: vi.fn(), publish: vi.fn(), sendToUser: vi.fn() };
  e.broadcastCurrentState = vi.fn(async () => undefined);
  e.inLiveLightningHand = vi.fn(async () => false);
  return e;
}

beforeEach(() => {
  departure.mockReset().mockResolvedValue(undefined);
  cashout.mockReset().mockResolvedValue(500);
});
afterEach(() => {
  deadlineScheduler.cancelAll(TABLE);
});

for (const [who, id, seat] of [
  ['human', HUMAN, 1],
  ['horse', HORSE, 2],
] as const) {
  describe(`${who}: leaves while the hand they played is still being presented`, () => {
    it('accepts the leave, keeps the chair, and cashes nothing out yet', async () => {
      const e = makeEngineInCompletionHold();
      const res = await e.leaveTable(id);

      expect(res).toMatchObject({ success: true, immediate: false });
      expect(departure).toHaveBeenCalledWith(id, TABLE, seat, OCC[id], 'voluntary');
      expect(cashout).not.toHaveBeenCalled();
      expect(e.seatedPlayers.some((p: any) => p.user_id === id)).toBe(true);
      const emitted = e.hub.emitEvent.mock.calls.map((c: any[]) => c[1]?.type);
      expect(emitted).not.toContain('seat_left');
      // Not greyed out while the pot is still flying to them.
      expect(e.disconnectEngine.isSittingOut(TABLE, id)).toBe(false);
    });

    it('when the hold ends, the seat is out of the next deal', async () => {
      const e = makeEngineInCompletionHold();
      await e.leaveTable(id);
      e.endCompletionPresentation();
      expect(e.disconnectEngine.isSittingOut(TABLE, id)).toBe(true);
      expect(e.seatedPlayers.find((p: any) => p.user_id === id)?.leave_pending).toBe(true);
    });
  });
}

describe('settlement keeps a presented seat until the push has landed', () => {
  it('holds pot winners (main or side pot) and showdown hands; releases a folded leaver', () => {
    const e = makeEngineInCompletionHold();
    // Multiway: HUMAN wins the main pot, HORSE wins a side pot, LATE was never dealt.
    e.currentHandPerPotAwards = [
      { userId: HUMAN, potIndex: 0, low: false, amount: 120 },
      { userId: HORSE, potIndex: 1, low: false, amount: 40 },
    ];
    e.currentHandShowdownResults = [];
    expect(e.holdsSeatForPresentation(HUMAN)).toBe(true);
    expect(e.holdsSeatForPresentation(HORSE)).toBe(true);
    expect(e.holdsSeatForPresentation(LATE)).toBe(false);
  });

  it('holds a tabled losing hand, not a seat that folded out', () => {
    const e = makeEngineInCompletionHold();
    e.currentHandPerPotAwards = [{ userId: HORSE, potIndex: 0, low: false, amount: 80 }];
    e.currentHandShowdownResults = [{ userId: HUMAN }, { userId: HORSE }];
    expect(e.holdsSeatForPresentation(HUMAN)).toBe(true);
    e.currentHandShowdownResults = [{ userId: HORSE }];
    expect(e.holdsSeatForPresentation(HUMAN)).toBe(false);
  });

  it('holds a leave deferred in the hold before its request is even written', async () => {
    const e = makeEngineInCompletionHold();
    e.currentHandPerPotAwards = [];
    e.currentHandShowdownResults = [];
    let heldDuringWrite: boolean | null = null;
    departure.mockImplementationOnce(async () => {
      heldDuringWrite = e.holdsSeatForPresentation(HUMAN);
    });
    await e.leaveTable(HUMAN);
    expect(heldDuringWrite).toBe(true);
  });

  it('releases everything once the completion hold ends', () => {
    const e = makeEngineInCompletionHold();
    e.currentHandPerPotAwards = [{ userId: HUMAN, potIndex: 0, low: false, amount: 50 }];
    e.endCompletionPresentation();
    expect(e.holdsSeatForPresentation(HUMAN)).toBe(false);
  });

  it('a failed departure write leaves no hold behind', async () => {
    const e = makeEngineInCompletionHold();
    e.currentHandPerPotAwards = [];
    e.currentHandShowdownResults = [];
    departure.mockRejectedValueOnce(new Error('db down'));
    const res = await e.leaveTable(HUMAN);
    expect(res.success).toBe(false);
    expect(e.holdsSeatForPresentation(HUMAN)).toBe(false);
  });

  it('the settlement sweep asks before every cash-out, and only settlement asks', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const seats = readFileSync(join(here, '../services/supabase/seats.ts'), 'utf8');
    const settlement = readFileSync(join(here, 'ServerTableEngineSettlement.ts'), 'utf8');
    const loop = seats.indexOf('for (const seat of pendingSeats) {');
    const ask = seats.indexOf('if (holdSeat?.(seat.user_id, seat.occupancy_id)) continue;', loop);
    const pay = seats.indexOf('await atomicCashout(seat.user_id', loop);
    expect(loop).toBeGreaterThan(0);
    expect(ask).toBeGreaterThan(loop);
    expect(pay).toBeGreaterThan(ask);
    expect(settlement).toContain('if (!this.holdsSeatForPresentation(userId)) return false;');
    expect(settlement).toContain('this.noteHeldDeparture(userId, occupancyId);');
  });
});

describe('review fixes (2026-11-15)', () => {
  it('before HAND_COMPLETE nothing is presented: a leave at the deal takes the ordinary path', async () => {
    const e = makeEngineInCompletionHold();
    e.beginCompletionPresentation([{ user_id: HUMAN }, { user_id: HORSE }]); // dealt, not completed
    const res = await e.leaveTable(HUMAN);
    expect(res).toMatchObject({ success: true, immediate: true });
    expect(cashout).toHaveBeenCalled();
    e.currentHandPerPotAwards = [{ userId: HORSE, potIndex: 0, low: false, amount: 10 }];
    expect(e.holdsSeatForPresentation(HORSE)).toBe(false);
  });

  it('a held seat is never carried to another table by a seat move', async () => {
    const e = makeEngineInCompletionHold();
    await e.leaveTable(HUMAN);
    expect(e.heldDepartures.has(OCC[HUMAN])).toBe(true);
    const here = dirname(fileURLToPath(import.meta.url));
    const base = readFileSync(join(here, 'ServerTableEngineBase.ts'), 'utf8');
    const at = base.indexOf('protected async executePendingSeatMoves(');
    const filter = base.indexOf(
      'const movable = pending.filter((m) => !this.heldDepartures?.has(m.source_occupancy_id));',
      at
    );
    const exec = base.indexOf('outcome = await executePendingSeatMoves(', at);
    expect(filter).toBeGreaterThan(at);
    expect(exec).toBeGreaterThan(filter);
    expect(base.slice(exec, base.indexOf(');', exec))).toContain('movable,');
  });

  it('the seat-move block is in place before the departure request is written', async () => {
    const e = makeEngineInCompletionHold();
    let blockedDuringWrite: boolean | null = null;
    departure.mockImplementationOnce(async () => {
      blockedDuringWrite = e.heldDepartures.has(OCC[HUMAN]);
    });
    await e.leaveTable(HUMAN);
    expect(blockedDuringWrite).toBe(true);
  });

  it('a failed repeat leave never lifts a hold settlement already placed', async () => {
    const e = makeEngineInCompletionHold();
    e.noteHeldDeparture(HUMAN, OCC[HUMAN]); // settlement held this seat
    departure.mockRejectedValueOnce(new Error('db down'));
    await e.leaveTable(HUMAN);
    expect(e.heldDepartures.has(OCC[HUMAN])).toBe(true);
  });

  it('when the held seat is cashed out, every client is told it left', async () => {
    const e = makeEngineInCompletionHold();
    e.wakeClusterGame = vi.fn();
    await e.leaveTable(HORSE);
    e.endCompletionPresentation();
    e.releaseDepartedSeats([{ userId: HORSE, occupancyId: OCC[HORSE] }]);
    const left = e.hub.emitEvent.mock.calls.map((c: any[]) => c[1]).filter((ev: any) => ev?.type === 'seat_left');
    expect(left).toEqual([expect.objectContaining({ user_id: HORSE, seat: 2, mid_hand: false })]);
    expect(e.wakeClusterGame).toHaveBeenCalledWith('seat_left');
    expect(e.heldDepartures.has(OCC[HORSE])).toBe(false);
  });

  it('a write that fails after the hold ended leaves the player seated and NOT sat out', async () => {
    const e = makeEngineInCompletionHold();
    e.currentHandPerPotAwards = [];
    e.currentHandShowdownResults = [];
    departure.mockImplementationOnce(async () => {
      e.endCompletionPresentation(); // the hold ends mid-write
      throw new Error('db down');
    });
    const res = await e.leaveTable(HUMAN);
    expect(res.success).toBe(false);
    expect(e.disconnectEngine.isSittingOut(TABLE, HUMAN)).toBe(false);
    expect(e.heldDepartures.has(OCC[HUMAN])).toBe(false);
  });
});

describe('a horse that banks the win waits for its own pot push (production 2026-11-15)', () => {
  it('is deferred during the presentation and cashed out once at the next-hand boundary', async () => {
    const e = makeEngineInCompletionHold();
    e.lifecycleCanMutate = () => true;
    e.wakeClusterGame = vi.fn();
    e.currentHandPerPotAwards = [{ userId: HORSE, potIndex: 0, low: false, amount: 231 }];
    e.currentHandShowdownResults = [];
    const exits: string[] = [];
    e.cashoutVoluntaryStay = vi.fn(async (p: any) => {
      exits.push(p.user_id);
      return { ok: true };
    });
    const horse = e.seatedPlayers.find((p: any) => p.user_id === HORSE);
    // The settlement step's decision while the pot is still flying:
    expect(e.holdsSeatForPresentation(HORSE)).toBe(true);
    e.deferredBankTheWin.set(HORSE, horse);
    e.noteHeldDeparture(HORSE, OCC[HORSE]);
    expect(exits).toEqual([]);
    expect(e.heldDepartures.has(OCC[HORSE])).toBe(true);
    // The hold ends; the next-hand boundary runs the exit exactly once.
    e.endCompletionPresentation();
    await e.runDeferredBankTheWinExits();
    await e.runDeferredBankTheWinExits();
    expect(exits).toEqual([HORSE]);
    expect(e.seatedPlayers.some((p: any) => p.user_id === HORSE)).toBe(false);
    const left = e.hub.emitEvent.mock.calls.map((c: any[]) => c[1]).filter((ev: any) => ev?.type === 'seat_left');
    expect(left).toEqual([expect.objectContaining({ user_id: HORSE, seat: 2 })]);
    expect(e.heldDepartures.size).toBe(0);
  });

  it('a stay-clock refusal keeps the horse seated and lifts the move block', async () => {
    const e = makeEngineInCompletionHold();
    e.lifecycleCanMutate = () => true;
    e.cashoutVoluntaryStay = vi.fn(async () => ({ ok: false, code: 'LEAVE_LOCKED', stayRemainingMs: 1000 }));
    e.chipContinuity.noteRefusal = vi.fn();
    const horse = e.seatedPlayers.find((p: any) => p.user_id === HORSE);
    e.deferredBankTheWin.set(HORSE, horse);
    e.noteHeldDeparture(HORSE, OCC[HORSE]);
    e.endCompletionPresentation();
    await e.runDeferredBankTheWinExits();
    expect(e.seatedPlayers.some((p: any) => p.user_id === HORSE)).toBe(true);
    expect(e.heldDepartures.size).toBe(0);
  });

  it('an unexpected error neither breaks the next deal nor leaves a move block behind', async () => {
    const e = makeEngineInCompletionHold();
    e.lifecycleCanMutate = () => true;
    e.cashoutVoluntaryStay = vi.fn(async () => {
      throw new Error('boom');
    });
    const horse = e.seatedPlayers.find((p: any) => p.user_id === HORSE);
    e.deferredBankTheWin.set(HORSE, horse);
    e.noteHeldDeparture(HORSE, OCC[HORSE]);
    await expect(e.runDeferredBankTheWinExits()).resolves.toBeUndefined();
    expect(e.heldDepartures.size).toBe(0);
    expect(e.seatedPlayers.some((p: any) => p.user_id === HORSE)).toBe(true);
  });

  it('settlement defers instead of cashing out, and the boundary runs it before the roster read', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const settlement = readFileSync(join(here, 'ServerTableEngineSettlement.ts'), 'utf8');
    const dealing = readFileSync(join(here, 'ServerTableEngineDealing.ts'), 'utf8');
    const loop = settlement.indexOf('for (const horse of cashedOutHorses) {');
    const defer = settlement.indexOf('this.deferredBankTheWin.set(horse.user_id, horse);', loop);
    const exit = settlement.indexOf('await this.bankTheWinExit(horse)', loop);
    expect(defer).toBeGreaterThan(loop);
    expect(exit).toBeGreaterThan(defer);
    const prep = dealing.indexOf('protected async prepareNextHand(');
    const run = dealing.indexOf('await this.runDeferredBankTheWinExits();', prep);
    const read = dealing.indexOf('this.readNextHandInputs()', prep);
    expect(run).toBeGreaterThan(prep);
    expect(read).toBeGreaterThan(run);
  });
});

describe('a player who was not dealt into the presented hand', () => {
  it('still leaves immediately', async () => {
    const e = makeEngineInCompletionHold();
    const res = await e.leaveTable(LATE);
    expect(res).toMatchObject({ success: true, immediate: true });
    expect(cashout).toHaveBeenCalled();
  });
});

describe('the dealing loop owns the window', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const dealing = readFileSync(join(here, 'ServerTableEngineDealing.ts'), 'utf8');

  it('opens it at the deal and closes it right after the completion hold', () => {
    const open = dealing.indexOf('this.beginCompletionPresentation(activePlayers)');
    const deal = dealing.indexOf('await this.dealHand(activePlayers)');
    const hold = dealing.indexOf('await this.awaitHandCompletionDisplay(resultDisplayMs)');
    const close = dealing.indexOf('this.endCompletionPresentation()', hold);
    expect(open).toBeGreaterThan(0);
    expect(deal).toBeGreaterThan(open);
    expect(hold).toBeGreaterThan(deal);
    expect(close).toBeGreaterThan(hold);
    expect(close - hold).toBeLessThan(200);
  });
});
