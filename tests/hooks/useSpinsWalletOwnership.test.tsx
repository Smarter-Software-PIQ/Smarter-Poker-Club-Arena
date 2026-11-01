import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  clearWalletMemoryCache,
  walletCacheKey,
  writeWalletCache,
} from '../../src/lib/walletCache';
const mocks = vi.hoisted(() => ({ getState: vi.fn(), userId: 'viewer-a' }));
vi.mock('../../src/services/SpinActivationService', () => ({
  spinActivationApi: { getState: mocks.getState },
}));
vi.mock('../../src/stores/useUserStore', () => ({
  useUserStore: (select: any) => select({ user: { id: mocks.userId } }),
}));
import { useSpinsWallet } from '../../src/hooks/useSpinsWallet';
const state = (owner: string, balance: number) => ({ owner_id: owner, is_active: true, balance });
const deferred = () => {
  let resolve!: (value: any) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<any>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
beforeEach(() => {
  mocks.getState.mockReset();
  mocks.userId = 'viewer-a';
  clearWalletMemoryCache();
  localStorage.clear();
});
it.each(['owner', 'viewer', 'disabled'] as const)(
  'never paints a previous wallet during a %s change',
  async (change) => {
    mocks.getState
      .mockResolvedValueOnce({ state: state('club-a', 1234) })
      .mockImplementationOnce(() => new Promise(() => {}));
    const renders: Array<{ owner: string; viewer: string; enabled: boolean; state: any }> = [];
    const { result, rerender } = renderHook(
      ({ owner, enabled }) => {
        const value = useSpinsWallet(owner, enabled);
        renders.push({ owner, viewer: mocks.userId, enabled, state: value.state });
        return value;
      },
      { initialProps: { owner: 'club-a', enabled: true } }
    );
    await waitFor(() => expect(result.current.balance).toBe(1234));
    renders.length = 0;
    if (change === 'viewer') mocks.userId = 'viewer-b';
    rerender({ owner: change === 'owner' ? 'club-b' : 'club-a', enabled: change !== 'disabled' });
    expect(renders.every((row) => row.state === null)).toBe(true);
    expect(result.current.state).toBeNull();
    expect(result.current.active).toBe(false);
  }
);
it('keeps a late previous-owner reply out of both current state and the new owner cache', async () => {
  const old = deferred();
  mocks.getState
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce({ state: state('club-b', 99) });
  const { result, rerender } = renderHook(({ owner }) => useSpinsWallet(owner), {
    initialProps: { owner: 'club-a' },
  });
  rerender({ owner: 'club-b' });
  await waitFor(() => expect(result.current.balance).toBe(99));
  await act(async () => old.resolve({ state: state('club-a', 1234) }));
  expect(result.current.state?.owner_id).toBe('club-b');
  expect(result.current.balance).toBe(99);
});
it('uses the new owner fresh cache without painting the previous owner or requesting it again', async () => {
  mocks.getState.mockResolvedValue({ state: state('club-a', 1234) });
  const renders: any[] = [];
  const { result, rerender } = renderHook(
    ({ owner }) => {
      const value = useSpinsWallet(owner);
      renders.push(value.state);
      return value;
    },
    { initialProps: { owner: 'club-a' } }
  );
  await waitFor(() => expect(result.current.balance).toBe(1234));
  writeWalletCache(walletCacheKey('viewer-a', 'spins', 'club-b'), { s: state('club-b', 99) });
  renders.length = 0;
  rerender({ owner: 'club-b' });
  expect(renders.every((value) => value === null || value.owner_id === 'club-b')).toBe(true);
  expect(result.current.balance).toBe(99);
  expect(mocks.getState).toHaveBeenCalledTimes(1);
});

it('keeps the next owner unknown after a failed read, without restoring the old balance', async () => {
  const next = deferred();
  mocks.getState
    .mockResolvedValueOnce({ state: state('club-a', 1234) })
    .mockReturnValueOnce(next.promise);
  const { result, rerender } = renderHook(({ owner }) => useSpinsWallet(owner), {
    initialProps: { owner: 'club-a' },
  });
  await waitFor(() => expect(result.current.balance).toBe(1234));
  rerender({ owner: 'club-b' });
  expect(result.current.loading).toBe(true);
  expect(result.current.state).toBeNull();
  await act(async () => next.reject(new Error('not permitted')));
  expect(result.current.loading).toBe(false);
  expect(result.current.state).toBeNull();
});

it('an explicit reload still fetches a new value while retaining only this owner cache', async () => {
  const fresh = deferred();
  mocks.getState
    .mockResolvedValueOnce({ state: state('club-a', 1234) })
    .mockReturnValueOnce(fresh.promise);
  const { result } = renderHook(() => useSpinsWallet('club-a'));
  await waitFor(() => expect(result.current.balance).toBe(1234));
  act(() => result.current.reload());
  expect(mocks.getState).toHaveBeenCalledTimes(2);
  expect(result.current.state?.owner_id).toBe('club-a');
  await act(async () => fresh.resolve({ state: state('club-a', 2000) }));
  expect(result.current.balance).toBe(2000);
});

it('a late disabled request cannot restore a wallet or leave loading active', async () => {
  const old = deferred();
  mocks.getState.mockReturnValueOnce(old.promise);
  const { result, rerender } = renderHook(({ enabled }) => useSpinsWallet('club-a', enabled), {
    initialProps: { enabled: true },
  });
  rerender({ enabled: false });
  await act(async () => old.resolve({ state: state('club-a', 1234) }));
  expect(result.current.loading).toBe(false);
  expect(result.current.state).toBeNull();
});
