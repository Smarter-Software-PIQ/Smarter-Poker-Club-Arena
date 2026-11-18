/**
 * The signed-in player's presence heartbeat (src/lib/presenceHeartbeat.ts,
 * src/hooks/usePresenceHeartbeat.ts). The law that it is the only presence
 * writer and is mounted once is tests/presence-has-one-definition.law.test.ts.
 */
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('../../src/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));

import { reportError } from '../../src/utils/errorReporter';
import {
  PRESENCE_HEARTBEAT_MS,
  resetPresenceHeartbeatForTests,
  signalOffline,
} from '../../src/lib/presenceHeartbeat';
import { usePresenceHeartbeat } from '../../src/hooks/usePresenceHeartbeat';

let visibility: DocumentVisibilityState = 'visible';
const beats = () => rpc.mock.calls.filter((c) => c[0] === 'fn_update_presence');
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers();
  resetPresenceHeartbeatForTests();
  rpc.mockReset();
  rpc.mockResolvedValue({ data: null, error: null });
  vi.mocked(reportError).mockReset();
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('usePresenceHeartbeat', () => {
  it('beats on load with the player id and online true', () => {
    renderHook(() => usePresenceHeartbeat('u1'));
    expect(beats()).toEqual([['fn_update_presence', { p_user_id: 'u1', p_is_online: true }]]);
  });

  it('beats every interval while visible', async () => {
    renderHook(() => usePresenceHeartbeat('u1'));
    await vi.advanceTimersByTimeAsync(PRESENCE_HEARTBEAT_MS * 2);
    expect(beats()).toHaveLength(3);
  });

  it('does not beat while hidden, and beats at once on becoming visible', async () => {
    renderHook(() => usePresenceHeartbeat('u1'));
    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(PRESENCE_HEARTBEAT_MS * 3);
    expect(beats()).toHaveLength(1);

    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(beats()).toHaveLength(2);
  });

  it('a hidden tab that loads does not beat until it is shown', () => {
    visibility = 'hidden';
    renderHook(() => usePresenceHeartbeat('u1'));
    expect(beats()).toHaveLength(0);
  });

  it('beats for nobody when signed out, and stops when unmounted', async () => {
    renderHook(() => usePresenceHeartbeat(null));
    expect(beats()).toHaveLength(0);

    const { unmount } = renderHook(() => usePresenceHeartbeat('u1'));
    unmount();
    await vi.advanceTimersByTimeAsync(PRESENCE_HEARTBEAT_MS * 3);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(beats()).toHaveLength(1);
  });

  it('reports a failing beat once per run of failures, not every interval', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'offline' } });
    renderHook(() => usePresenceHeartbeat('u1'));
    await flush();
    await vi.advanceTimersByTimeAsync(PRESENCE_HEARTBEAT_MS * 3);
    await flush();
    expect(beats()).toHaveLength(4);
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it('coalesces overlapping resume triggers while a presence beat is in flight', async () => {
    let finish!: () => void;
    rpc.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = () => resolve({ data: null, error: null });
      })
    );
    renderHook(() => usePresenceHeartbeat('u1'));
    expect(beats()).toHaveLength(1);
    window.dispatchEvent(new Event('pageshow'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(beats()).toHaveLength(1);
    finish();
    await flush();
    window.dispatchEvent(new Event('pageshow'));
    expect(beats()).toHaveLength(2);
  });
});

describe('signalOffline', () => {
  it('sends online false for the player', async () => {
    await signalOffline('u1');
    expect(beats()).toEqual([['fn_update_presence', { p_user_id: 'u1', p_is_online: false }]]);
  });

  it('never throws, and never waits past its bound', async () => {
    rpc.mockReturnValueOnce(new Promise(() => {}));
    const done = signalOffline('u1', 2_000);
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(done).resolves.toBeUndefined();

    rpc.mockRejectedValueOnce(new Error('network'));
    await expect(signalOffline('u1')).resolves.toBeUndefined();
    expect(reportError).toHaveBeenCalledTimes(1);
  });
});

describe('sign-out is the last beat (2026-10-05 audit)', () => {
  const online = () => beats().filter((c) => (c[1] as { p_is_online: boolean }).p_is_online);

  it('no beat goes out for the account between signing out and the user clearing', async () => {
    renderHook(() => usePresenceHeartbeat('u1'));
    expect(online()).toHaveLength(1);
    await signalOffline('u1');
    // The auth listener has not cleared the user yet: the interval and a
    // return to the tab both fire.
    await vi.advanceTimersByTimeAsync(PRESENCE_HEARTBEAT_MS * 2);
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(online()).toHaveLength(1);
    expect(beats().at(-1)?.[1]).toEqual({ p_user_id: 'u1', p_is_online: false });
  });

  it('the offline beat is sent after a beat already in flight lands', async () => {
    let land!: () => void;
    const order: string[] = [];
    rpc.mockImplementation((_fn: string, args: { p_is_online: boolean }) => {
      order.push(args.p_is_online ? 'sent online' : 'sent offline');
      if (!args.p_is_online) return Promise.resolve({ data: null, error: null });
      return new Promise((resolve) => {
        land = () => {
          order.push('online landed');
          resolve({ data: null, error: null });
        };
      });
    });
    renderHook(() => usePresenceHeartbeat('u1'));
    const done = signalOffline('u1');
    await flush();
    expect(order).toEqual(['sent online']);
    land();
    await done;
    expect(order).toEqual(['sent online', 'online landed', 'sent offline']);
  });

  it('signing in again beats again', async () => {
    const first = renderHook(() => usePresenceHeartbeat('u1'));
    await signalOffline('u1');
    first.unmount();
    renderHook(() => usePresenceHeartbeat('u1'));
    expect(online()).toHaveLength(2);
  });

  it('each beat is one request, even though the offline beat waits on it', async () => {
    let thens = 0;
    rpc.mockImplementation(() => ({
      then(resolve: (v: unknown) => void) {
        thens++;
        resolve({ data: null, error: null });
      },
    }));
    renderHook(() => usePresenceHeartbeat('u1'));
    await signalOffline('u1');
    // one online beat + one offline beat, each executed once
    expect(thens).toBe(2);
  });
});

describe('Messenger Active Status', () => {
  afterEach(() => window.localStorage.removeItem('messenger-active-status'));

  it('beats offline while this device turned Active Status off', () => {
    window.localStorage.setItem('messenger-active-status', 'false');
    renderHook(() => usePresenceHeartbeat('u1'));
    expect(beats()).toEqual([['fn_update_presence', { p_user_id: 'u1', p_is_online: false }]]);
  });

  it('beats online when Active Status is on or was never set', () => {
    window.localStorage.setItem('messenger-active-status', 'true');
    renderHook(() => usePresenceHeartbeat('u1'));
    expect(beats()).toEqual([['fn_update_presence', { p_user_id: 'u1', p_is_online: true }]]);
  });
});

describe('signalLeave: leaving is the last beat (2026-11-12)', () => {
  const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('VITE_SUPABASE_URL', 'https://db.example.test/');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
    localStorage.setItem('smarter-poker-auth', JSON.stringify({ access_token: 'jwt-1' }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('the last tab of the account beats offline with keepalive through the same door', async () => {
    const { signalLeave, stampTabLease } = await import('../../src/lib/presenceHeartbeat');
    stampTabLease('u1');
    expect(signalLeave('u1')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://db.example.test/rest/v1/rpc/fn_update_presence');
    expect(init.keepalive).toBe(true);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-1');
    expect(JSON.parse(String(init.body))).toEqual({ p_user_id: 'u1', p_is_online: false });
    // Its own lease is gone.
    expect(Object.keys(localStorage).filter((k) => k.startsWith('presence-tab:u1:'))).toEqual([]);
  });

  it('does not beat offline while another tab of the account is still beating', async () => {
    const { signalLeave, stampTabLease } = await import('../../src/lib/presenceHeartbeat');
    stampTabLease('u1');
    localStorage.setItem('presence-tab:u1:other', String(Date.now() - 30_000));
    expect(signalLeave('u1')).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    // A stale sibling lease is not alive, and is cleaned up.
    localStorage.setItem('presence-tab:u1:other', String(Date.now() - 10 * 60_000));
    expect(signalLeave('u1')).toBe(true);
    expect(localStorage.getItem('presence-tab:u1:other')).toBeNull();
  });

  it('a signed-out account and a missing session send nothing', async () => {
    const { signalLeave } = await import('../../src/lib/presenceHeartbeat');
    await signalOffline('u1');
    expect(signalLeave('u1')).toBe(false);
    resetPresenceHeartbeatForTests();
    localStorage.removeItem('smarter-poker-auth');
    expect(signalLeave('u1')).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('the hook sends the leave beat on pagehide and beats again on pageshow', async () => {
    renderHook(() => usePresenceHeartbeat('u1'));
    await flush();
    expect(beats()).toHaveLength(1);
    window.dispatchEvent(new Event('pagehide'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('pageshow'));
    expect(beats()).toHaveLength(2);
  });
});
