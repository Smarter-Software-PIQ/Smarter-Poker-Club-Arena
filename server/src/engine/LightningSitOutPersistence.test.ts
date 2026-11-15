import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServerTableEngine } from './ServerTableEngine.js';
import { supabase } from '../services/supabase/client.js';
import { deadlineScheduler } from './DeadlineScheduler.js';
const table = '11111111-1111-4111-8111-111111111111';
const player = '22222222-2222-4222-8222-222222222222';
const occupancy = '33333333-3333-4333-8333-333333333333';
const pool = '55555555-5555-4555-8555-555555555555';
const stamp = '2026-10-20T19:30:00.000Z';
let engine: any;
let release: () => void;
let blocked: Promise<void>;
let writes: boolean[];
let fail: boolean;
let failCode: string | undefined;
let blind: boolean;
let patch: Record<string, unknown>;
let missing: boolean;
beforeEach(() => {
  blocked = new Promise<void>((r) => {
    release = r;
  });
  writes = [];
  fail = false;
  failCode = undefined;
  blind = false;
  patch = {};
  missing = false;
  vi.spyOn(supabase, 'rpc').mockImplementation((async (name: string, args: any) => {
    expect(name).toBe('fn_cash_seat_sitout');
    expect(args).toMatchObject({ p_table_id: table, p_user_id: player, p_occupancy_id: occupancy });
    const out = args.p_sitting_out;
    writes.push(out);
    await blocked;
    if (fail) return { data: null, error: { message: 'refused', code: failCode } };
    if (missing) return { data: null, error: null };
    return {
      data: {
        seat: {
          table_id: table,
          user_id: player,
          occupancy_id: occupancy,
          left_at: null,
          leave_pending: false,
          is_sitting_out: out && !blind,
          sit_out_at: out && !blind ? stamp : null,
          ...patch,
        },
        pool_session_id: pool,
        cluster_id: table,
        sitting_out: out,
        blind_off: out && blind,
        hands_remaining: out && blind ? 7 : 0,
      },
      error: null,
    };
  }) as any);
  engine = new ServerTableEngine(table) as any;
  engine.tableInfo = {
    id: table,
    game_type: 'cash',
    club_id: 'club',
    big_blind: 2,
    max_players: 6,
  };
  engine.handController = null;
  engine.seatedPlayers = [{ user_id: player, occupancy_id: occupancy, stack: 40, seat_number: 1 }];
  engine.dealtInUserIds.add(player);
  engine.hub = { emitEvent: vi.fn(), publish: vi.fn() };
  vi.spyOn(engine.chipContinuity, 'evaluate').mockResolvedValue([]);
  engine.broadcastCurrentState = vi.fn();
});
afterEach(() => {
  release();
  deadlineScheduler.cancelAll(table);
  vi.restoreAllMocks();
});
const events = () =>
  engine.hub.emitEvent.mock.calls.filter(([, e]: any) => e.type === 'lightning_sitout_changed');
describe('the original sit-out transaction publishes its acknowledged occupancy', () => {
  it('keeps the HTTP response and published stamp behind the database ACK', async () => {
    let answered = false;
    const request = engine
      .sitOutAndWait(player, true, { requestedByClient: true })
      .then((r: any) => {
        answered = true;
        return r;
      });
    await vi.waitFor(() => expect(writes).toEqual([true]));
    expect(answered).toBe(false);
    expect(events()).toEqual([]);
    release();
    expect(await request).toMatchObject({ success: true, blindOff: false });
    expect(events()[0]).toEqual([
      pool,
      {
        type: 'lightning_sitout_changed',
        pool_session_id: pool,
        player_id: player,
        occupancy_id: occupancy,
        sitting_out: true,
        sit_out_at: stamp,
      },
    ]);
  });
  it('preserves out/back database and event order across devices', async () => {
    const out = engine.sitOutAndWait(player, true, { requestedByClient: true });
    const back = engine.sitOutAndWait(player, false, { requestedByClient: true });
    await vi.waitFor(() => expect(writes).toEqual([true]));
    release();
    await Promise.all([out, back]);
    expect(writes).toEqual([true, false]);
    expect(events().map(([, e]: any) => [e.sitting_out, e.sit_out_at])).toEqual([
      [true, stamp],
      [false, null],
    ]);
  });
  it('a confirmed blind-off preserves the logical sit-out while its anchor stays eligible', async () => {
    blind = true;
    engine.tableInfo.cluster_id = table;
    engine.dealingHaltLock = true;
    engine.dealingHaltReason = 'lightning';
    const pending = engine.sitOutAndWait(player, true, { requestedByClient: true });
    release();
    expect(await pending).toMatchObject({ success: true, blindOff: true, hands_remaining: 7 });
    expect(events()[0][1]).toMatchObject({ sitting_out: true, sit_out_at: null, blind_off: true });
    expect(engine.leaveHeldByClock.get(player)).toBe(occupancy);
    const back = engine.sitOutAndWait(player, false, { requestedByClient: true });
    expect(await back).toMatchObject({ success: true, blindOff: false });
    expect(engine.leaveHeldByClock.has(player)).toBe(false);
  });
  it.each([0, 7])(
    'restores the persisted Lightning departure after restart with %i owed',
    (owed) => {
      engine.tableInfo.cluster_id = table;
      engine.dealingHaltLock = true;
      engine.dealingHaltReason = 'lightning';
      vi.spyOn(engine.chipContinuity, 'row').mockReturnValue({ blind_off: true });
      vi.spyOn(engine.chipContinuity, 'leaveLock').mockReturnValue({
        locked: owed > 0,
        handsRemaining: owed,
      });
      engine.restoreBlindOffFromSessions();
      expect(engine.leaveHeldByClock.get(player)).toBe(occupancy);
      expect(writes).toEqual([]);
    }
  );
  it.each(['P2S01', 'P2S02'])(
    'retains the declared refusal code %s without publishing success',
    async (code) => {
      fail = true;
      failCode = code;
      const pending = engine.sitOutAndWait(player, false, { requestedByClient: true });
      release();
      await expect(pending).rejects.toMatchObject({ code });
      expect(events()).toEqual([]);
    }
  );
  it.each(['stale', 'departed', 'pending', 'wrong-status', 'failure', 'missing'])(
    'never acknowledges an unproven write: %s',
    async (why) => {
      if (why === 'stale') patch.occupancy_id = pool;
      if (why === 'departed') patch.left_at = stamp;
      if (why === 'pending') patch.leave_pending = true;
      if (why === 'wrong-status') patch.is_sitting_out = false;
      if (why === 'failure') fail = true;
      if (why === 'missing') missing = true;
      const request = engine.sitOutAndWait(player, true, { requestedByClient: true });
      release();
      if (missing) expect(await request).toMatchObject({ success: false });
      else await expect(request).rejects.toThrow();
      expect(events()).toEqual([]);
    }
  );
});
