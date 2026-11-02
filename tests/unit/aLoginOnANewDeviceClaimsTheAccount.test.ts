/**
 * Device pairing (Dan, 2026-11-01): a login on a different physical device
 * signs the others out; browsers on the SAME physical device coexist, joined
 * by approval from a browser already on that device. Identity is the enrolled
 * token, never a header, so it is unforgeable and UA-independent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rpcMock = vi.hoisted(() => vi.fn());
const rejectionMock = vi.hoisted(() => vi.fn());
const authListeners = vi.hoisted(() => [] as Array<(e: string, s: unknown) => void>);
const channelFactory = vi.hoisted(() => () => ({
  on() {
    return this;
  },
  subscribe() {
    return this;
  },
}));

vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }),
    }),
    channel: () => channelFactory(),
    removeChannel: () => Promise.resolve(),
    auth: {
      getSession: () => Promise.resolve({ data: { session: { user: { id: 'u1' } } } }),
      onAuthStateChange: (cb: (e: string, s: unknown) => void) => {
        authListeners.push(cb);
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
  },
}));

vi.mock('../../src/lib/sessionRevoked', () => ({
  handleEngineAuthRejection: (...args: unknown[]) => rejectionMock(...args),
  ANOTHER_DEVICE_SOURCE: 'account:another_device_login',
}));

import {
  ENROLLED_DEVICE_STORAGE_KEY,
  RESUME_SESSION_GONE_SOURCE,
  __resetActiveLoginForTests,
  enrollDevice,
  sessionIdOf,
  startSingleActiveLogin,
} from '../../src/lib/activeLogin';
import { __resetDeviceSightingForTests } from '../../src/lib/deviceSighting';

const SID_A = '11111111-2222-4333-8444-555555555555';
const SID_B = '99999999-8888-4777-8666-555555555555';
const DEV = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function tokenWith(sessionId: string): string {
  const payload = Buffer.from(JSON.stringify({ session_id: sessionId, sub: 'user-1' }))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `header.${payload}.sig`;
}
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}
function clickButton(text: string): boolean {
  const btns = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[];
  const b = btns.find((x) => (x.textContent || '').includes(text));
  if (b) {
    b.click();
    return true;
  }
  return false;
}

beforeEach(() => {
  rpcMock.mockReset();
  rejectionMock.mockReset();
  authListeners.length = 0;
  localStorage.clear();
  document.body.innerHTML = '';
  __resetActiveLoginForTests();
  __resetDeviceSightingForTests();
});
afterEach(() => {
  document.body.innerHTML = '';
});

describe('sessionIdOf', () => {
  it('reads the GoTrue session id, rejects garbage', () => {
    expect(sessionIdOf(tokenWith(SID_A))).toBe(SID_A);
    expect(sessionIdOf(null)).toBeNull();
    expect(sessionIdOf('nope')).toBeNull();
  });
});

describe('enrollDevice', () => {
  it('a bound browser records its device and shows no prompt', async () => {
    rpcMock.mockResolvedValue({
      data: { ok: true, bound: true, device_id: DEV, kicked: 0 },
      error: null,
    });
    await enrollDevice(tokenWith(SID_A));
    await settle();
    expect(rpcMock.mock.calls[0][0]).toBe('ca_claim_active_login');
    expect(localStorage.getItem(ENROLLED_DEVICE_STORAGE_KEY)).toBe(DEV);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('a new browser on an existing account is asked same-or-new, and "new device" registers', async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === 'ca_claim_active_login')
        return Promise.resolve({
          data: { ok: true, needs_choice: true, devices: [{ id: DEV, label: 'Dan Mac' }] },
          error: null,
        });
      if (name === 'ca_register_new_device')
        return Promise.resolve({
          data: { ok: true, device_id: 'new-dev', kicked: 2 },
          error: null,
        });
      return Promise.resolve({ data: {}, error: null });
    });
    await enrollDevice(tokenWith(SID_A));
    await settle();
    // The chooser is shown.
    expect(document.body.textContent).toContain('Is This The Same Device');
    expect(clickButton('This Is A New Device')).toBe(true);
    await settle();
    expect(rpcMock.mock.calls.some((c) => c[0] === 'ca_register_new_device')).toBe(true);
  });

  it('picking "same device" requests pairing for that device', async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === 'ca_claim_active_login')
        return Promise.resolve({
          data: { ok: true, needs_choice: true, devices: [{ id: DEV, label: 'Dan Mac' }] },
          error: null,
        });
      if (name === 'ca_request_pairing')
        return Promise.resolve({ data: { ok: true, request_id: 'req-1' }, error: null });
      return Promise.resolve({ data: {}, error: null });
    });
    await enrollDevice(tokenWith(SID_A));
    await settle();
    expect(clickButton('Same As Dan Mac')).toBe(true);
    await settle();
    const call = rpcMock.mock.calls.find((c) => c[0] === 'ca_request_pairing');
    expect(call).toBeTruthy();
    expect((call![1] as { p_target_device_id: string }).p_target_device_id).toBe(DEV);
    expect(document.body.textContent).toContain('Waiting For Approval');
  });

  it('a dead resumed session bounces, superseded uses the another-device source', async () => {
    rpcMock.mockResolvedValue({
      data: { ok: false, why: 'session_gone', superseded: true },
      error: null,
    });
    await enrollDevice(tokenWith(SID_A), true);
    await settle();
    expect(rejectionMock).toHaveBeenCalledWith('account:another_device_login', true);
  });

  it('a session that died another way uses the plain resume source', async () => {
    rpcMock.mockResolvedValue({
      data: { ok: false, why: 'session_gone', superseded: false },
      error: null,
    });
    await enrollDevice(tokenWith(SID_B), true);
    await settle();
    expect(rejectionMock).toHaveBeenCalledWith(RESUME_SESSION_GONE_SOURCE, true);
  });

  it('a transport error enrolls nothing and signs nobody out', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'offline' } });
    await enrollDevice(tokenWith(SID_A));
    await settle();
    expect(rejectionMock).not.toHaveBeenCalled();
    expect(localStorage.getItem(ENROLLED_DEVICE_STORAGE_KEY)).toBeNull();
  });
});

describe('startSingleActiveLogin', () => {
  it('enrolls on SIGNED_IN and INITIAL_SESSION, never on refresh or sign-out', async () => {
    rpcMock.mockResolvedValue({ data: { ok: true, bound: true, device_id: DEV }, error: null });
    startSingleActiveLogin();
    startSingleActiveLogin();
    expect(authListeners).toHaveLength(1);
    const emit = authListeners[0];
    emit('TOKEN_REFRESHED', { access_token: tokenWith(SID_A) });
    emit('SIGNED_OUT', null);
    await settle();
    expect(rpcMock).not.toHaveBeenCalled();
    emit('SIGNED_IN', { access_token: tokenWith(SID_A) });
    await settle();
    expect(rpcMock).toHaveBeenCalled();
  });
});
