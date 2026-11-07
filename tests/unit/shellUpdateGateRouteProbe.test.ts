/**
 * The shell update gate's poll, run for real (src/hooks/useShellUpdateGate.ts).
 *
 * 2026-10-05 audit: a route change that landed inside the probe's one-minute
 * throttle was marked as seen even though no probe ran, so a tab that had just
 * been focused and then navigated did not learn it was stale until the
 * 15-minute idle check. The route change now stays due until a probe runs.
 * None of this reloads anything: a stale answer only arms the same gate.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/core/MasterBus', () => ({ masterBus: { emit: vi.fn() } }));
vi.mock('../../src/lib/readDeployedShell', () => ({ readDeployedShell: vi.fn() }));

import { readDeployedShell } from '../../src/lib/readDeployedShell';
import {
  STALE_CHECK_IDLE_MS,
  STALE_CHECK_MIN_INTERVAL_MS,
  useShellUpdateGate,
} from '../../src/hooks/useShellUpdateGate';

const probes = vi.mocked(readDeployedShell);
let entry: HTMLMetaElement;

beforeEach(() => {
  vi.useFakeTimers();
  probes.mockReset();
  // The deployed shell is the one running: nothing is ever stale here.
  probes.mockResolvedValue('<script type="module" src="/assets/index-same.js"></script>');
  // The running shell's entry chunk, as extractEntryScript reads it from the page.
  entry = document.createElement('meta');
  entry.setAttribute('content', '/assets/index-same.js');
  document.head.appendChild(entry);
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getRegistration: vi.fn().mockResolvedValue(undefined),
    },
  });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  window.history.replaceState(null, '', '/hub/club-arena/clubs/a');
});

afterEach(() => {
  entry.remove();
  vi.useRealTimers();
});

describe('useShellUpdateGate poll', () => {
  it('a route change inside the throttle is probed once the throttle allows, not forgotten', async () => {
    renderHook(() => useShellUpdateGate());
    expect(probes).toHaveBeenCalledTimes(1); // the mount check

    window.history.replaceState(null, '', '/hub/club-arena/clubs/b');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(probes).toHaveBeenCalledTimes(1); // inside the throttle

    await vi.advanceTimersByTimeAsync(STALE_CHECK_MIN_INTERVAL_MS);
    expect(probes).toHaveBeenCalledTimes(2); // the route change, once allowed

    // Consumed: no further probe until the idle interval.
    await vi.advanceTimersByTimeAsync(STALE_CHECK_MIN_INTERVAL_MS * 2);
    expect(probes).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(STALE_CHECK_IDLE_MS);
    expect(probes).toHaveBeenCalledTimes(3);
  });

  it('defers stale shell adoption on Cashier through focus and idle checks', async () => {
    window.history.replaceState(null, '', '/hub/club-arena/clubs/a/cashier-classic');
    probes.mockResolvedValue('<script src="/assets/index-new.js"></script>');
    renderHook(() => useShellUpdateGate());
    await vi.advanceTimersByTimeAsync(5_000);
    // The mount probe may check for an update, but cannot hand over the worker
    // or reload a financial form, even when the deployed shell is newer.
    expect(navigator.serviceWorker.getRegistration).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(STALE_CHECK_IDLE_MS * 2);
    expect(probes).toHaveBeenCalled();
    expect(navigator.serviceWorker.getRegistration).toHaveBeenCalledTimes(probes.mock.calls.length);
  });

  it.each([
    '/hub/club-arena/clubs/a',
    '/hub/club-arena/clubs/a/table-management',
    '/hub/club-arena/clubs/a/members',
    '/hub/club-arena/clubs/a/operations',
    '/hub/club-arena/clubs/a/cashier',
    '/hub/club-arena/table/a',
  ])('keeps %s mounted across a newer deploy, navigation and resume', async (path) => {
    window.history.replaceState(null, '', path);
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
    const postMessage = vi.fn();
    vi.mocked(navigator.serviceWorker.getRegistration).mockResolvedValue({
      update: vi.fn().mockResolvedValue(undefined),
      waiting: { postMessage },
    } as unknown as ServiceWorkerRegistration);
    probes.mockResolvedValue('<script src="/assets/index-new.js"></script>');
    const hook = renderHook(() => useShellUpdateGate());
    const listeners = vi.mocked(navigator.serviceWorker.addEventListener).mock.calls;
    const message = listeners.find(([type]) => type === 'message')![1] as (
      event: MessageEvent
    ) => void;
    const controller = listeners.find(([type]) => type === 'controllerchange')![1] as () => void;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
      message(new MessageEvent('message', { data: { type: 'SHELL_UPDATED' } }));
      controller();
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('pageshow'));
      window.history.replaceState(null, '', '/hub/club-arena/clubs/b');
      await vi.advanceTimersByTimeAsync(STALE_CHECK_IDLE_MS * 2);
    });
    expect(reload).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
    hook.unmount();
    reload.mockRestore();
  });

  it('stops polling on unmount', async () => {
    const { unmount } = renderHook(() => useShellUpdateGate());
    unmount();
    window.history.replaceState(null, '', '/hub/club-arena/clubs/c');
    await vi.advanceTimersByTimeAsync(STALE_CHECK_IDLE_MS * 2);
    expect(probes).toHaveBeenCalledTimes(1);
  });
});
