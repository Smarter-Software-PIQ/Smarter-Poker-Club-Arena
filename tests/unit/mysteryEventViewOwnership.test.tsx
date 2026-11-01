import React from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  inventory: vi.fn(),
  awards: vi.fn(),
  leaderboard: vi.fn(),
  projection: vi.fn(),
}));
vi.mock('../../src/services/MysteryBountyService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/MysteryBountyService')>()),
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
vi.mock('../../src/lib/supabase', () => ({ supabase: {} }));
vi.mock('../../src/hooks/usePlayerPreference', () => ({
  usePlayerPreference: () => [false, vi.fn()],
}));
vi.mock('../../src/hooks/useMysteryBountyProjection', () => ({
  useMysteryBountyProjection: (...args: unknown[]) => h.projection(...args),
}));
import MysteryBountyPanel from '../../src/components/tournament/MysteryBountyPanel';
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
  expect(hook.result.current.isUnavailable).toBe(false);
  expect(hook.result.current.awardsTotal).toBe(1);
});

function LivePanel() {
  const data = useMysteryBounty('first', true);
  return <MysteryBountyPanel tournamentId="first" isMysteryBounty data={data} unitCents={100} />;
}
it('does not turn an unread initial snapshot into pending or zero awards', async () => {
  h.inventory.mockRejectedValue(new Error('offline'));
  render(<LivePanel />);
  await flush();
  expect(screen.getByText('Mystery Bounty Data Unavailable')).toBeTruthy();
  expect(screen.queryByText('Pending')).toBeNull();
  expect(screen.queryByText('0 Revealed')).toBeNull();
  expect(screen.queryByText('Nobody Has Won A Mystery Bounty Yet')).toBeNull();
  expect(h.projection.mock.calls.every((call) => call[1] === false)).toBe(true);
});
it('explicit retry recovers a real empty snapshot after the initial read failed', async () => {
  h.inventory.mockRejectedValue(new Error('offline'));
  h.awards.mockResolvedValue({ total: 0, rows: [] });
  h.leaderboard.mockResolvedValue([]);
  render(<LivePanel />);
  await flush();
  h.inventory.mockResolvedValue({ poolCents: 10000, stage: 'active', tiers: [] });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Try Again' })));
  expect(screen.getByText('0 Revealed')).toBeTruthy();
  expect(screen.queryByText('Mystery Bounty Data Unavailable')).toBeNull();
});
it('does not claim empty awards while the first snapshot is loading', async () => {
  h.inventory.mockReturnValue(new Promise(() => {}));
  render(<LivePanel />);
  await flush();
  expect(screen.queryByText('0 Revealed')).toBeNull();
  expect(screen.queryByText('Nobody Has Won A Mystery Bounty Yet')).toBeNull();
});

it('keeps authoritative empty inventory distinct from an unread snapshot', async () => {
  h.inventory.mockResolvedValue(null);
  h.awards.mockResolvedValue({ total: 0, rows: [] });
  h.leaderboard.mockResolvedValue([]);
  render(<LivePanel />);
  await flush();
  expect(screen.getByText('Pending')).toBeTruthy();
  expect(screen.getByText('0 Revealed')).toBeTruthy();
  expect(screen.queryByText('Mystery Bounty Data Unavailable')).toBeNull();
  expect(h.projection.mock.calls.some((call) => call[1] === true)).toBe(true);
});
