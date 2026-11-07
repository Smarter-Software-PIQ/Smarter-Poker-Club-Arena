import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServerTableEngine } from './ServerTableEngine.js';
import * as sessions from '../services/supabase/cashSessions.js';
afterEach(() => vi.restoreAllMocks());
function setup() {
  const engine = Object.create(ServerTableEngine.prototype) as any;
  engine.tableId = 'table';
  engine.lifecycleCanMutate = vi.fn(() => true);
  const player = { user_id: 'player', seat_number: 2, occupancy_id: 'original' };
  engine.seatedPlayers = [player];
  let resolve!: (result: any) => void;
  const pending = new Promise<any>((yes) => {
    resolve = yes;
  });
  const rpc = vi.spyOn(sessions, 'atomicCashoutVoluntary').mockReturnValue(pending);
  return { engine, player, resolve, rpc };
}
describe('voluntary outcomes belong only to the original stay', () => {
  it.each([
    { ok: true, stack: 25 },
    { ok: false, code: 'LEAVE_LOCKED', stayRemainingMs: 9000 },
  ])('never reflects a delayed %j outcome onto a replacement occupancy', async (outcome) => {
    const h = setup();
    const result = h.engine.cashoutVoluntaryStay(h.player);
    h.player.occupancy_id = 'replacement';
    h.resolve(outcome);
    await expect(result).resolves.toBeNull();
    expect(h.rpc).toHaveBeenCalledWith('player', 'table', 2, 'original');
  });
  it('does not initiate a new cashout from an already stale roster candidate', async () => {
    const h = setup();
    h.engine.seatedPlayers = [{ ...h.player, occupancy_id: 'replacement' }];
    await expect(h.engine.cashoutVoluntaryStay(h.player)).resolves.toBeNull();
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it('does not reflect after the engine loses authority', async () => {
    const h = setup();
    const result = h.engine.cashoutVoluntaryStay(h.player);
    h.engine.lifecycleCanMutate.mockReturnValue(false);
    h.resolve({ ok: true, stack: 25 });
    await expect(result).resolves.toBeNull();
  });
  it.each([false, true])(
    'preserves the actual outcome when original stay is gone=%s',
    async (gone) => {
      const h = setup();
      const result = h.engine.cashoutVoluntaryStay(h.player);
      if (gone) h.engine.seatedPlayers = [];
      const outcome = { ok: true, stack: 25 };
      h.resolve(outcome);
      await expect(result).resolves.toBe(outcome);
    }
  );
});

describe('HIT AND RUN: the mirror answers before the database is asked', () => {
  it('a seat owing hands in profit is refused locally and the cash-out RPC is never called', async () => {
    const h = setup();
    const leaveLock = vi.fn(() => ({ locked: true, remainingMs: 0, handsRemaining: 6 }));
    h.engine.chipContinuity = { leaveLock };
    (h.player as any).stack = 400;
    await expect(h.engine.cashoutVoluntaryStay(h.player)).resolves.toEqual({
      ok: false,
      code: 'LEAVE_LOCKED',
      stayRemainingMs: 0,
    });
    expect(leaveLock).toHaveBeenCalledWith('player', 400);
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.engine.hitRunHandsOwed('player')).toBe(6);
    expect(h.engine.hitRunHandsOwed('nobody')).toBe(0);
  });
  it('a free seat still goes to the database door', async () => {
    const h = setup();
    h.engine.chipContinuity = {
      leaveLock: vi.fn(() => ({ locked: false, remainingMs: 0, handsRemaining: 0 })),
    };
    const result = h.engine.cashoutVoluntaryStay(h.player);
    h.resolve({ ok: true, stack: 25 });
    await result;
    expect(h.rpc).toHaveBeenCalledWith('player', 'table', 2, 'original');
    expect(h.engine.hitRunHandsOwed('player')).toBe(0);
  });
});
