import { beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ rpc: vi.fn(), abortSignal: vi.fn() }));
vi.mock('./supabase.js', () => ({ supabase: { rpc: mock.rpc } }));
import { readExactHorseOpponentProfiles } from './HorseExactOpponentMemory.js';
import { freshExploitCounters } from '../engine/HorseOpponentExploit.js';
const id = '10000000-0000-4000-8000-000000000001';
const domain = { version: 1, speed: 'lightning', ante: 'big_blind' } as const;
const row = () => ({
  user_id: id,
  variant: 'plo6',
  mode: 'cash',
  size: 'short',
  public_memory_domain: domain,
  observed_hands: 1,
  initialized: true,
  counters: freshExploitCounters(),
});
beforeEach(() => {
  mock.rpc.mockReset().mockReturnValue({ abortSignal: mock.abortSignal });
  mock.abortSignal.mockReset().mockResolvedValue({ data: [row()], error: null });
});
it('reads only the exact saved public domain with a bounded original request', async () => {
  expect(await readExactHorseOpponentProfiles([id], 'plo6', 'cash', 'short', domain)).toEqual([
    row(),
  ]);
  expect(mock.rpc).toHaveBeenCalledWith('fn_horse_exact_profiles_read', {
    p_user_ids: [id],
    p_variant: 'plo6',
    p_mode: 'cash',
    p_size: 'short',
    p_speed: 'lightning',
    p_ante: 'big_blind',
  });
  expect(mock.abortSignal.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
});
it('does not query unknown original rules', async () => {
  expect(await readExactHorseOpponentProfiles([id], 'plo6', 'cash', 'short', null)).toEqual([]);
  expect(mock.rpc).not.toHaveBeenCalled();
});
it.each(['legacy', 'wrong_speed', 'wrong_ante', 'wrong_variant', 'other_actor', 'duplicate'])(
  'refuses %s response without legacy fallback',
  async (fault) => {
    const r: any = row();
    if (fault === 'legacy') delete r.public_memory_domain;
    if (fault === 'wrong_speed') r.public_memory_domain = { ...domain, speed: 'table' };
    if (fault === 'wrong_ante') r.public_memory_domain = { ...domain, ante: 'none' };
    if (fault === 'wrong_variant') r.variant = 'plo4';
    if (fault === 'other_actor') r.user_id = '20000000-0000-4000-8000-000000000002';
    mock.abortSignal.mockResolvedValue({ data: fault === 'duplicate' ? [r, r] : [r], error: null });
    await expect(
      readExactHorseOpponentProfiles([id], 'plo6', 'cash', 'short', domain)
    ).rejects.toThrow('exact public memory unavailable');
    expect(mock.rpc).toHaveBeenCalledTimes(1);
  }
);
