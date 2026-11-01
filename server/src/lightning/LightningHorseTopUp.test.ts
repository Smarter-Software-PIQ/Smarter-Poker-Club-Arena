import { beforeEach, describe, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
  own: vi.fn(),
  wallet: vi.fn(),
  request: vi.fn(),
}));
vi.mock('../services/supabase.js', () => ({
  supabase: { from: f.from },
  readClubChipBalances: f.wallet,
}));
vi.mock('./LightningTopUp.js', () => ({ requestLightningTopUp: f.request }));
import { requestLightningHorseTopUps } from './LightningHorseTopUp.js';
import { horseCashTopUpStyle } from '../services/HorseTopUpStyle.js';
const horse = Array.from({ length: 100 }, (_, i) => `horse-${i}`).find(
  (id) => horseCashTopUpStyle(id, 'plo5') === 'auto_top_up'
)!;
const boundary = { handId: 'hand-a', clusterId: 'cluster', horsePlayers: [{ playerId: horse }] };
beforeEach(() => {
  vi.clearAllMocks();
  const q: any = {
    maybeSingle: async () => ({
      data: {
        table_id: 'anchor',
        stack: f.own().stack ?? 20,
        auto_rebuy: f.own().autoTopUp,
        club_id: 'club',
        is_sitting_out: f.own().sittingOut ?? false,
        leave_pending: f.own().leaving ?? false,
        tables: {
          cluster_id: 'cluster',
          game_variant: 'plo5',
          big_blind: 1,
          min_buy_in: 20,
          max_buy_in: 100,
          ...f.own().table,
        },
      },
      error: null,
    }),
  };
  for (const method of ['eq', 'is', 'limit']) q[method] = () => q;
  q.select = (fields: string) => {
    f.select(fields);
    return q;
  };
  const session: any = { maybeSingle: async () => ({ data: { baseline: 20 }, error: null }) };
  for (const method of ['select', 'eq', 'is', 'order', 'limit']) session[method] = () => session;
  f.from.mockImplementation((table: string) => (table === 'table_seats' ? q : session));
  f.own.mockReturnValue({ autoTopUp: true });
  f.wallet.mockResolvedValue(new Map([[horse, 100000]]));
  f.request.mockResolvedValue({ queued: true, charged: false, applied: 0 });
});
describe('a Lightning horse supplies the same original intent', () => {
  it('uses explicit seat opt-in, actual bankroll policy and stable original hand/user key', async () => {
    await requestLightningHorseTopUps(boundary);
    expect(f.select).toHaveBeenCalledWith(
      'table_id,stack,auto_rebuy,club_id,is_sitting_out,leave_pending,tables!table_seats_table_id_fkey!inner(cluster_id,game_variant,small_blind,big_blind,min_buy_in,max_buy_in,tournament_id)'
    );
    expect(f.from.mock.calls.map(([table]) => table)).toEqual([
      'table_seats',
      'cash_player_session',
    ]);
    expect(f.request).toHaveBeenCalledOnce();
    const [table, user, key, amount] = f.request.mock.calls[0];
    expect([table, user]).toEqual(['anchor', horse]);
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(amount).toBeGreaterThan(0);
    expect(amount).toBeLessThanOrEqual(80);
    await requestLightningHorseTopUps(boundary);
    expect(f.request.mock.calls[1]).toEqual(f.request.mock.calls[0]);
  });
  it.each([false, undefined])(
    'does not invent an opt-in when the original flag is %s',
    async (flag) => {
      f.own.mockReturnValue({ autoTopUp: flag });
      await requestLightningHorseTopUps(boundary);
      expect(f.request).not.toHaveBeenCalled();
    }
  );
  it.each([{ sittingOut: true }, { leaving: true }])(
    'does not auto-fund an inactive seat: %j',
    async (flags) => {
      f.own.mockReturnValue({ autoTopUp: true, ...flags });
      await requestLightningHorseTopUps(boundary);
      expect(f.from.mock.calls.map(([table]) => table)).toEqual(['table_seats']);
      expect(f.wallet).not.toHaveBeenCalled();
      expect(f.request).not.toHaveBeenCalled();
    }
  );
  it('does not fund with unknown wallet or missing original participant list', async () => {
    f.wallet.mockResolvedValue(new Map());
    await requestLightningHorseTopUps(boundary);
    await requestLightningHorseTopUps({ ...boundary, horsePlayers: undefined });
    expect(f.request).not.toHaveBeenCalled();
  });

  it.each(['nlh', 'plo4', 'plo5', 'plo6', 'plo8'])(
    'the 1/2 policy requests the full legal gap through the original intent for %s',
    async (variant) => {
      f.own.mockReturnValue({
        autoTopUp: false,
        stack: 250,
        table: {
          game_variant: variant,
          small_blind: 1,
          big_blind: 2,
          min_buy_in: 200,
          max_buy_in: 400,
          tournament_id: null,
        },
      });
      await requestLightningHorseTopUps(boundary);
      expect(f.request).toHaveBeenCalledOnce();
      expect(f.request.mock.calls[0]).toEqual([
        'anchor',
        horse,
        expect.stringMatching(/^[a-f0-9]{64}$/),
        150,
      ]);
      await requestLightningHorseTopUps(boundary);
      expect(f.request.mock.calls[1]).toEqual(f.request.mock.calls[0]);
    }
  );

  it('requests even a one-cent 1/2 gap but never a partial funded request', async () => {
    const table = {
      game_variant: 'plo5',
      small_blind: 1,
      big_blind: 2,
      min_buy_in: 200,
      max_buy_in: 400,
      tournament_id: null,
    };
    f.own.mockReturnValue({ autoTopUp: false, stack: 399.99, table });
    await requestLightningHorseTopUps(boundary);
    expect(f.request.mock.calls[0]?.[3]).toBe(0.01);
    f.request.mockClear();
    f.own.mockReturnValue({ autoTopUp: false, stack: 250, table });
    f.wallet.mockResolvedValue(new Map([[horse, 149.99]]));
    await requestLightningHorseTopUps(boundary);
    expect(f.request).not.toHaveBeenCalled();
  });

  it.each([undefined, 'a-tournament'])(
    'unknown or noncash 1/2 metadata does not invent a mandatory intent: %s',
    async (tournament) => {
      f.own.mockReturnValue({
        autoTopUp: false,
        stack: 250,
        table: {
          small_blind: 1,
          big_blind: 2,
          max_buy_in: 400,
          tournament_id: tournament,
        },
      });
      await requestLightningHorseTopUps(boundary);
      expect(f.request).not.toHaveBeenCalled();
    }
  );

  it('does not turn a busted 1/2 horse into an add-on and bypass auto-rebuy limits', async () => {
    f.own.mockReturnValue({
      autoTopUp: false,
      stack: 0,
      table: {
        small_blind: 1,
        big_blind: 2,
        max_buy_in: 400,
        tournament_id: null,
      },
    });
    await requestLightningHorseTopUps(boundary);
    expect(f.request).not.toHaveBeenCalled();
  });
});
