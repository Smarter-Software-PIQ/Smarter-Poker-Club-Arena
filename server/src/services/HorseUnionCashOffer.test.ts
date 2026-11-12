import { afterEach, describe, expect, it, vi } from 'vitest';
import { HorseFleetManager } from './HorseFleetManager.js';
import { supabase } from './supabase.js';
import { HORSE_UNION_CASH_PLAN as plan } from './HorseUnionCashPlan.js';

type OfferFleet = {
  claimOfferedSeats(...args: unknown[]): Promise<number>;
  resolveSeatClub(...args: unknown[]): string;
  computeHorseBuyIn(...args: unknown[]): number;
  sitsWithAutoTopUp(...args: unknown[]): Promise<boolean>;
  seatHorse(...args: unknown[]): Promise<boolean>;
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('the actual cash seat-offer handler obeys the relaunched union schedule (every plan game, every hour)', () => {
  it.each([
    ['overnight 1/2 without humans', 'Classic NLH 1/2', 5, null, true],
    ['overnight 1/2 with a playing human', 'Classic NLH 1/2', 5, {}, true],
    [
      'overnight 1/2 with a sitting-out human',
      'Classic NLH 1/2',
      5,
      { is_sitting_out: true },
      true,
    ],
    ['relaunched Classic PLO4 1/2 without humans', 'Classic PLO4 1/2', 5, null, true],
    ['relaunched Classic PLO5 1/2 without humans', 'Classic PLO5 1/2', 5, null, true],
    ['prime-time higher stakes without humans', 'Classic NLH 1/2', 18, null, true],
    ['overnight NLH without humans', 'Classic NLH .10/.25', 5, null, true],
    ['overnight PLO without humans', 'Classic PLO4 .10/.25', 5, null, true],
    ['overnight lower stakes with a human', 'Classic PLO4 .25/.50', 5, {}, true],
  ] as const)('%s', async (_label, gameName, hour, human, expected) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.UTC(2026, 10, 4, hour + 6)));
    const game = plan.games.find((row) => row.name === gameName)!;
    expect(game).toBeDefined();
    const table = {
      id: 'table',
      club_id: plan.unionId,
      union_id: plan.unionId,
      cluster_id: game.id,
      role: 'main',
      main_index: 1,
      lifecycle: 'live',
      game_variant: game.variant,
      small_blind: game.smallBlind,
      big_blind: game.bigBlind,
      max_players: 9,
    };
    const offer = {
      id: 'offer',
      table_id: table.id,
      user_id: 'horse',
      hold_expires_at: new Date(Date.now() + 60000).toISOString(),
    };
    const builder: Record<string, unknown> = {};
    for (const key of ['select', 'eq', 'order', 'limit', 'gt']) builder[key] = () => builder;
    const update = vi.fn(() => builder);
    builder.update = update;
    builder.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: [offer], error: null }).then(resolve);
    vi.spyOn(supabase, 'from').mockReturnValue(builder as never);
    const fleet = new HorseFleetManager() as unknown as OfferFleet;
    const wallet = vi.spyOn(fleet, 'resolveSeatClub').mockReturnValue(plan.unionId);
    vi.spyOn(fleet, 'computeHorseBuyIn').mockReturnValue(20);
    vi.spyOn(fleet, 'sitsWithAutoTopUp').mockResolvedValue(false);
    const seat = vi.spyOn(fleet, 'seatHorse').mockResolvedValue(true);
    const seats =
      human === null ? [] : [{ user_id: 'human', table_id: table.id, seat_number: 1, ...human }];
    const claimed = await fleet.claimOfferedSeats(
      [table],
      seats,
      new Map(),
      false,
      new Set(['horse']),
      {},
      new Set()
    );
    expect(claimed).toBe(expected ? 1 : 0);
    expect(seat).toHaveBeenCalledTimes(expected ? 1 : 0);
    expect(wallet).toHaveBeenCalledTimes(expected ? 1 : 0);
    expect(update).toHaveBeenCalledTimes(expected ? 1 : 0);
  });
});
