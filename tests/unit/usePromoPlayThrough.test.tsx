import { act, renderHook, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ read: vi.fn(), refresh: null as null | (() => void) }));
vi.mock('../../src/services/PromoPlayThroughService', () => ({
  readMyPromoPlayThrough: state.read,
}));
vi.mock('../../src/hooks/useMasterBusSubscription', () => ({
  useMasterBusSubscriptions: (_events: unknown, callback: () => void) => {
    state.refresh = callback;
  },
}));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
import { usePromoPlayThrough } from '../../src/hooks/usePromoPlayThrough';
const figure = (locked: number) => ({
  locked,
  open_grants: 1,
  fee_target: 200,
  fee_progress: 0,
  fee_remaining: 200,
  percent: 0,
  wallet: 80,
  cashable: 80 - locked,
  next_expiry_at: null,
});
beforeEach(() => {
  state.read.mockReset();
});
afterEach(cleanup);
it('never paints an older club or account response in the new wallet', async () => {
  let oldReply!: (value: unknown) => void;
  state.read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        oldReply = resolve;
      })
  );
  state.read.mockResolvedValueOnce(figure(25));
  const hook = renderHook(({ club, user }) => usePromoPlayThrough(club, user), {
    initialProps: { club: 'club-a', user: 'user-a' },
  });
  hook.rerender({ club: 'club-b', user: 'user-b' });
  await waitFor(() => expect(hook.result.current.summary?.locked).toBe(25));
  await act(async () => oldReply(figure(50)));
  expect(hook.result.current.summary?.locked).toBe(25);
});
it('shows a failed read as unavailable and can recover on an explicit refresh', async () => {
  state.read.mockRejectedValueOnce(new Error('offline'));
  state.read.mockResolvedValueOnce(figure(50));
  const hook = renderHook(() => usePromoPlayThrough('club-a', 'user-a'));
  await waitFor(() => expect(hook.result.current.error).toBe(true));
  expect(hook.result.current.summary).toBeNull();
  act(() => {
    state.refresh?.();
  });
  await waitFor(() => expect(hook.result.current.summary?.locked).toBe(50));
});
it('a later refresh wins over an earlier in-flight response', async () => {
  let older!: (value: unknown) => void;
  state.read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        older = resolve;
      })
  );
  state.read.mockResolvedValueOnce(figure(0));
  const hook = renderHook(() => usePromoPlayThrough('club-a', 'user-a'));
  act(() => {
    state.refresh?.();
  });
  await waitFor(() => expect(hook.result.current.summary?.locked).toBe(0));
  await act(async () => older(figure(50)));
  expect(hook.result.current.summary?.locked).toBe(0);
});
