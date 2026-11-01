import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ inventory: vi.fn(), awards: vi.fn(), leaderboard: vi.fn() }));
vi.mock('../../src/services/MysteryBountyService', () => ({
  MysteryBountyService: {
    getInventory: h.inventory,
    getAllAwards: h.awards,
    getLeaderboard: h.leaderboard,
  },
}));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../../src/core/MasterBus', () => ({
  masterBus: {
    hasChannel: () => false,
    getOrCreateChannel: () => {
      const channel: any = { on: () => channel, subscribe: () => channel };
      return channel;
    },
    removeRegisteredChannel: vi.fn(),
  },
}));
import { useMysteryBounty } from '../../src/hooks/useMysteryBounty';
beforeEach(() => {
  vi.resetAllMocks();
  h.inventory.mockResolvedValue({ poolCents: 10000, tiers: [] });
  h.awards.mockResolvedValue({ total: 1, rows: [{ awardId: 'old-award' }] });
  h.leaderboard.mockResolvedValue([{ userId: 'old-winner' }]);
});
afterEach(cleanup);
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};
it.each(['changed event', 'disabled event', 'absent event'])(
  'never paints previous winnings for a %s',
  async (mode) => {
    const renders: ReturnType<typeof useMysteryBounty>[] = [];
    const hook = renderHook(
      ({ id, enabled }: { id: string | null; enabled: boolean }) => {
        const value = useMysteryBounty(id, enabled);
        renders.push(value);
        return value;
      },
      { initialProps: { id: 'first', enabled: true } }
    );
    await flush();
    expect(hook.result.current.awardsTotal).toBe(1);
    h.inventory.mockReturnValue(new Promise(() => {}));
    renders.length = 0;
    hook.rerender({
      id: mode === 'changed event' ? 'second' : mode === 'absent event' ? null : 'first',
      enabled: mode !== 'disabled event',
    });
    expect(renders[0]).toMatchObject({
      inventory: null,
      awards: [],
      awardsTotal: 0,
      leaderboard: [],
      pendingReveals: 0,
      isLoading: mode === 'changed event',
    });
  }
);
it('preserves a current event snapshot after a failed refresh', async () => {
  const hook = renderHook(() => useMysteryBounty('first', true));
  await flush();
  const prior = hook.result.current.inventory;
  h.inventory.mockRejectedValue(new Error('offline'));
  await act(async () => {
    hook.result.current.refresh();
  });
  expect(hook.result.current.inventory).toBe(prior);
  expect(hook.result.current.awardsTotal).toBe(1);
});
