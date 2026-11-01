import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({
  scope: vi.fn(),
  members: vi.fn(),
  page: vi.fn(),
  report: vi.fn(),
  signals: [] as AbortSignal[],
}));
function query(result: Promise<unknown>) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    order: () => builder,
    range: () => builder,
    abortSignal: (signal: AbortSignal) => {
      api.signals.push(signal);
      return builder;
    },
    then: result.then.bind(result),
  };
  return builder;
}
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    rpc: (name: string) => query(name === 'fn_club_scope_ids' ? api.scope() : api.page()),
    from: () => query(api.members()),
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
  api.scope.mockResolvedValue({ data: ['club'], error: null });
  api.members.mockResolvedValue({ data: [{ club_id: 'club', role: 'agent' }], error: null });
  api.page.mockResolvedValue({ data: [{ user_id: 'old-player' }], error: null });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it.each(['scope', 'members', 'page'] as const)(
  'finishes an unanswered %s read without a roster claim',
  async (step) => {
    api[step].mockImplementation(pending);
    const { result } = renderHook(() => useDownlineIds('viewer', 'club'));
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
  }
);
it.each(['viewer', 'club', 'union', 'disabled'])(
  'hides the old roster during the first %s render',
  async (change) => {
    const seen: ReturnType<typeof useDownlineIds>[] = [];
    const { result, rerender } = renderHook(
      ({ user, club, union }) => {
        const value = useDownlineIds(user, club, union);
        seen.push(value);
        return value;
      },
      { initialProps: { user: 'viewer', club: 'club', union: '' } }
    );
    await flush();
    expect(result.current.downlineIds.has('old-player')).toBe(true);
    seen.length = 0;
    api.scope.mockImplementation(pending);
    rerender({
      user: change === 'viewer' ? 'new-viewer' : change === 'disabled' ? '' : 'viewer',
      club: change === 'club' ? 'new-club' : 'club',
      union: change === 'union' ? 'new-union' : '',
    });
    expect(seen[0].downlineIds.size).toBe(0);
    expect(seen[0].carriesDownline).toBe(false);
    expect(seen[0].viewerRole).toBe('player');
  }
);

it('does not publish a partial roster or a late second page after its deadline', async () => {
  let resolveLate!: (value: unknown) => void;
  api.page
    .mockResolvedValueOnce({
      data: Array.from({ length: 500 }, (_, i) => ({ user_id: `p${i}` })),
      error: null,
    })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLate = resolve;
        })
    );
  const { result } = renderHook(() => useDownlineIds('viewer', 'club'));
  await flush();
  expect(api.page).toHaveBeenCalledTimes(2);
  expect(result.current.downlineIds.size).toBe(0);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(12000);
  });
  expect(result.current.loading).toBe(false);
  await act(async () => resolveLate({ data: [{ user_id: 'late' }], error: null }));
  expect(result.current.downlineIds.size).toBe(0);
  expect(result.current.carriesDownline).toBe(false);
});

it('aborts a retired read and clears its deadline without reporting a failure', async () => {
  api.scope.mockImplementation(pending);
  const { unmount } = renderHook(() => useDownlineIds('viewer', 'club'));
  await flush();
  const signal = api.signals[0];
  unmount();
  await flush();
  expect(signal.aborted).toBe(true);
  expect(api.report).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
