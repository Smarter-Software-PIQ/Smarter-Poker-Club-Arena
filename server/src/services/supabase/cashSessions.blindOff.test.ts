import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), abortSignal: vi.fn() }));
vi.mock('./client.js', () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock('./seats.js', () => ({ atomicCashout: vi.fn() }));
import { lightningBlindOffPlayers } from './cashSessions.js';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockReturnValue({ abortSignal: mocks.abortSignal });
});
afterEach(() => vi.restoreAllMocks());
it('uses a bounded database read and preserves the authoritative blind-off identities', async () => {
  mocks.abortSignal.mockResolvedValue({ data: ['player-a'], error: null });
  expect([...(await lightningBlindOffPlayers(['pool-a']))]).toEqual(['player-a']);
  expect(mocks.rpc).toHaveBeenCalledWith('fn_lightning_blind_off_players', {
    p_pool_session_ids: ['pool-a'],
  });
  expect(mocks.abortSignal.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
});
it.each(['error', 'rejection', 'malformed'])(
  'reports %s and retains ordinary clocks instead of forcing an unproven fold',
  async (kind) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    if (kind === 'rejection') mocks.abortSignal.mockRejectedValue(new Error('unavailable'));
    else
      mocks.abortSignal.mockResolvedValue({
        data: kind === 'malformed' ? {} : null,
        error: kind === 'error' ? { code: 'PGRST002' } : null,
      });
    expect([...(await lightningBlindOffPlayers(['pool-a']))]).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ordinary action clocks retained'));
  }
);
