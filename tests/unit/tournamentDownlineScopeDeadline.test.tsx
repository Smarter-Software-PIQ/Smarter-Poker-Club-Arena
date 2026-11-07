import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({
  read: vi.fn(),
  report: vi.fn(),
  signals: [] as AbortSignal[],
}));
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    rpc: () => ({
      abortSignal: (signal: AbortSignal) => {
        api.signals.push(signal);
        return api.read();
      },
    }),
  },
}));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: api.report }));
import { useDownlineIds } from '../../src/components/tournament/details/useDownlineIds';
const pending = () => new Promise(() => {});
const flush = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  api.signals.length = 0;
  api.read.mockResolvedValue({ data: ['old-player'], error: null });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('finishes an unanswered read without a downline claim', async () => {
  api.read.mockImplementation(pending);
  const { result } = renderHook(() => useDownlineIds('viewer', 'event', 'club'));
  await flush();
  expect(result.current.loading).toBe(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(12000);
  });
  expect(result.current.loading).toBe(false);
  expect(result.current.carriesDownline).toBe(false);
  expect(result.current.downlineIds.size).toBe(0);
  expect(api.report).toHaveBeenCalledTimes(1);
  expect(api.signals.some((signal) => signal.aborted)).toBe(true);
});

it.each(['viewer', 'event', 'club', 'disabled'])(
  'hides the old set during the first %s render',
  async (change) => {
    const seen: ReturnType<typeof useDownlineIds>[] = [];
    const { result, rerender } = renderHook(
      ({ user, event, club }) => {
        const value = useDownlineIds(user, event, club);
        seen.push(value);
        return value;
      },
      { initialProps: { user: 'viewer', event: 'event', club: 'club' } }
    );
    await flush();
    expect(result.current.downlineIds.has('old-player')).toBe(true);
    seen.length = 0;
    api.read.mockImplementation(pending);
    rerender({
      user: change === 'viewer' ? 'new-viewer' : 'viewer',
      event: change === 'event' ? 'new-event' : 'event',
      club: change === 'club' ? 'new-club' : change === 'disabled' ? '' : 'club',
    });
    expect(seen[0].downlineIds.size).toBe(0);
    expect(seen[0].carriesDownline).toBe(false);
  }
);

it('aborts a retired read and clears its deadline without reporting a failure', async () => {
  api.read.mockImplementation(pending);
  const { unmount } = renderHook(() => useDownlineIds('viewer', 'event', 'club'));
  await flush();
  const signal = api.signals[0];
  unmount();
  await flush();
  expect(signal.aborted).toBe(true);
  expect(api.report).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
