import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServerTableEngine } from './ServerTableEngine.js';
import { supabase } from '../services/supabase.js';
import { setMaintenanceFrozen } from '../maintenance/freezeState.js';

/**
 * The Horse session rotator presses Add Chips with `engine.addChips(userId, amount)`
 * and no operation id of its own (HorseSessionRotator.ts). These cases run the real
 * engine door for that caller shape with the funding RPC and the receipt reader
 * mocked: an outcome that cannot be confirmed is never answered by a guess or by a
 * second purchase, and a later invocation is a new purchase that only fits the room
 * the table has left. The database half (one key, one debit, one landing under two
 * real sessions) is scripts/ci/probes/chip-journal-atomicity/test_addon_receipts.py.
 */
afterEach(() => {
  vi.restoreAllMocks();
  setMaintenanceFrozen(false);
});

const TABLE = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const lostReply = { data: null, error: { message: 'network failed' } } as any;
const funded = { data: 90, error: null } as any;

function engine() {
  const e = new ServerTableEngine(TABLE) as any;
  e.lifecycleCanMutate = () => true;
  e.seatedPlayers = [{ user_id: 'horse', seat_number: 1, stack: 10, is_horse: true }];
  e.getMaxBuyIn = () => 50;
  e.handController = null;
  e.broadcastCurrentState = vi.fn();
  e.requestPendingAddOnSweep = vi.fn();
  e.killForRestart = vi.fn();
  e.chipContinuity = { evaluate: vi.fn().mockResolvedValue(undefined) };
  e.isContinuityActive = () => false;
  e.readCashAddonReceipt = vi.fn(async () => null);
  return e;
}
const keysOf = (rpc: any): string[] =>
  rpc.mock.calls.map((call: any[]) => String(call[1].p_idempotency_key));

describe('a cash add-on whose outcome is unknown is not answered by a guess', () => {
  it('retires the table generation when a direct add-on cannot be confirmed either way', async () => {
    const e = engine();
    const rpc = vi.spyOn(supabase, 'rpc').mockResolvedValue(lostReply);
    await expect(e.addChips('horse', 10)).resolves.toMatchObject({
      success: false,
      code: 'TRANSPORT',
    });
    // Both attempts of the one invocation asked under the one key, then the
    // original receipt was read once before and once after.
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(new Set(keysOf(rpc)).size).toBe(1);
    expect(e.readCashAddonReceipt).toHaveBeenCalledTimes(2);
    expect(e.readCashAddonReceipt.mock.calls[1][2]).toBe(keysOf(rpc)[0]);
    expect(e.killForRestart).toHaveBeenCalledWith('addon_direct_outcome_unknown');
    expect(e.seatedPlayers[0].stack).toBe(10);
    expect(e.pendingAddOns.get('horse') ?? 0).toBe(0);
  });

  it('retires the table generation when the receipt cannot be read after the lost reply', async () => {
    const e = engine();
    e.readCashAddonReceipt = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockRejectedValue(new Error('unavailable'));
    vi.spyOn(supabase, 'rpc').mockResolvedValue(lostReply);
    await expect(e.addChips('horse', 10)).resolves.toMatchObject({
      success: false,
      code: 'TRANSPORT',
    });
    expect(e.killForRestart).toHaveBeenCalledWith('addon_direct_outcome_unknown');
    expect(e.seatedPlayers[0].stack).toBe(10);
  });

  it('leaves a queued unknown outcome with the original pending owner', async () => {
    const e = engine();
    e.handController = {};
    const rpc = vi.spyOn(supabase, 'rpc').mockResolvedValue(lostReply);
    await expect(e.addChips('horse', 10)).resolves.toMatchObject({
      success: false,
      code: 'TRANSPORT',
    });
    expect(new Set(keysOf(rpc)).size).toBe(1);
    expect(e.requestPendingAddOnSweep).toHaveBeenCalled();
    expect(e.killForRestart).not.toHaveBeenCalled();
    expect(e.seatedPlayers[0].stack).toBe(10);
    expect(e.pendingAddOns.get('horse') ?? 0).toBe(0);
  });

  it('treats an empty wallet as a verdict: asked once, nothing retired, nothing credited', async () => {
    const e = engine();
    const rpc = vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: null,
      error: { message: 'Insufficient club chips for add-on (club x)' },
    } as any);
    await expect(e.addChips('horse', 10)).resolves.toMatchObject({
      success: false,
      error: 'Insufficient wallet balance',
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(e.killForRestart).not.toHaveBeenCalled();
    expect(e.seatedPlayers[0].stack).toBe(10);
  });
});

describe('a caller without an operation id buys once per invocation', () => {
  it('keeps one key through a lost first reply and mints a new key for the next invocation', async () => {
    const e = engine();
    const rpc = vi
      .spyOn(supabase, 'rpc')
      .mockResolvedValueOnce(lostReply)
      .mockResolvedValue(funded);
    await expect(e.addChips('horse', 10)).resolves.toMatchObject({ success: true, applied: 10 });
    expect(e.seatedPlayers[0].stack).toBe(20);
    await expect(e.addChips('horse', 10)).resolves.toMatchObject({ success: true, applied: 10 });
    expect(e.seatedPlayers[0].stack).toBe(30);
    const keys = keysOf(rpc);
    expect(keys).toHaveLength(3);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
    for (const key of keys) expect(key.startsWith(`addon:${TABLE}:horse:`)).toBe(true);
    expect(e.killForRestart).not.toHaveBeenCalled();
  });

  it('sizes the next invocation to the room the table has left, then refuses at the maximum', async () => {
    const e = engine();
    const rpc = vi.spyOn(supabase, 'rpc').mockResolvedValue(funded);
    await e.addChips('horse', 40);
    expect(e.seatedPlayers[0].stack).toBe(50);
    await expect(e.addChips('horse', 40)).resolves.toMatchObject({ success: false });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(e.seatedPlayers[0].stack).toBe(50);
  });

  it('counts chips still queued from the earlier invocation against the room left', async () => {
    const e = engine();
    e.handController = {};
    const rpc = vi.spyOn(supabase, 'rpc').mockResolvedValue(funded);
    await expect(e.addChips('horse', 30)).resolves.toMatchObject({ success: true, queued: true });
    await expect(e.addChips('horse', 30)).resolves.toMatchObject({
      success: true,
      queued: true,
      applied: 10,
    });
    expect(rpc.mock.calls.map((call: any[]) => call[1].p_amount)).toEqual([30, 10]);
    expect(e.pendingAddOns.get('horse')).toBe(40);
    await expect(e.addChips('horse', 30)).resolves.toMatchObject({ success: false });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(e.seatedPlayers[0].stack).toBe(10);
  });
});
