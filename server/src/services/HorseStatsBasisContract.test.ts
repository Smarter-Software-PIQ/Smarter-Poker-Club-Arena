import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { rpc, reportError } = vi.hoisted(() => ({ rpc: vi.fn(), reportError: vi.fn() }));
vi.mock('./supabase/client.js', () => ({
  supabase: { rpc, from: vi.fn() },
  maintenanceSupabase: {},
}));
vi.mock('./errorReporter.js', () => ({ reportError, describeError: String }));
beforeEach(() => {
  vi.resetModules();
  rpc.mockReset();
  reportError.mockReset();
});
afterEach(() => vi.useRealTimers());

it('sends the key only when the installed basis lists it, and coalesces concurrent first hands', async () => {
  rpc.mockResolvedValue({
    data: { contract: 1, accepted: ['horse_hole_cards', 'horse_rollups'] },
    error: null,
  });
  const { horseHoleCardsBasisContract } = await import('./HorseStatsBasisContract.js');
  expect(await Promise.all(Array.from({ length: 8 }, () => horseHoleCardsBasisContract()))).toEqual(
    Array(8).fill(true)
  );
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(rpc).toHaveBeenCalledWith('horse_stats_basis_accepted_keys');
});

it.each([
  { data: null, error: { message: 'function is absent (an older database)' } },
  { data: { contract: 1, accepted: ['horse_rollups'] }, error: null },
  { data: { contract: 2, accepted: ['horse_hole_cards'] }, error: null },
  { data: { contract: 1, accepted: 'horse_hole_cards' }, error: null },
  { data: { contract: 1, accepted: [1] }, error: null },
  { data: null, error: null },
])('leaves the key off for an older, refusing or malformed answer', async (reply) => {
  rpc.mockResolvedValue(reply);
  const { horseHoleCardsBasisContract } = await import('./HorseStatsBasisContract.js');
  expect(await horseHoleCardsBasisContract()).toBe(false);
  expect(await horseHoleCardsBasisContract()).toBe(false);
  expect(rpc).toHaveBeenCalledTimes(1);
});

it('a transport failure leaves the key off and is reported', async () => {
  rpc.mockRejectedValue(new Error('connection lost'));
  const { horseHoleCardsBasisContract } = await import('./HorseStatsBasisContract.js');
  expect(await horseHoleCardsBasisContract()).toBe(false);
  expect(reportError).toHaveBeenCalled();
});

it('refreshes in the background: the answer in hand is served, the next one replaces it', async () => {
  vi.useFakeTimers({ now: 1_800_000_000_000 });
  rpc.mockResolvedValueOnce({ data: { contract: 1, accepted: ['horse_hole_cards'] }, error: null });
  const { horseHoleCardsBasisContract, HORSE_STATS_BASIS_REFRESH_MS } =
    await import('./HorseStatsBasisContract.js');
  expect(await horseHoleCardsBasisContract()).toBe(true);
  vi.setSystemTime(Date.now() + HORSE_STATS_BASIS_REFRESH_MS - 1);
  expect(await horseHoleCardsBasisContract()).toBe(true);
  expect(rpc).toHaveBeenCalledTimes(1);
  // a later database that no longer accepts the key (rolled back): the stale answer serves once, then off
  rpc.mockResolvedValueOnce({ data: { contract: 1, accepted: [] }, error: null });
  vi.setSystemTime(Date.now() + 2);
  expect(await horseHoleCardsBasisContract()).toBe(true);
  await vi.waitFor(async () => expect(await horseHoleCardsBasisContract()).toBe(false));
  expect(rpc).toHaveBeenCalledTimes(2);
});

it('the database cannot widen what the engine sends: unknown keys are ignored', async () => {
  rpc.mockResolvedValue({ data: { contract: 1, accepted: ['some_future_key'] }, error: null });
  const { statsBasisAccepts } = await import('./HorseStatsBasisContract.js');
  expect(await statsBasisAccepts('horse_hole_cards')).toBe(false);
  expect(await statsBasisAccepts('horse_rollups')).toBe(false);
});
