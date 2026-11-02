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
import {
  fixtureBrowserDevice,
  fixtureBrowserStorage,
  fixtureEnrollmentObserved,
} from '../e2e/support/fixtureBrowserDevice';

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

describe('owned disposable fixture browser continuity', () => {
  const fixture = {
    id: '12345678-1234-4234-8234-123456789abc',
    email:
      'ca-customization-cert-postdeploy-1793599200000-11111111-2222-4333-8444-555555555555@example.invalid',
    createdAt: '2026-11-02T06:00:00.000Z',
  };
  const identity = (baseURL = location.origin) =>
    fixtureBrowserDevice(fixture, fixture, fixture.email, baseURL);
  function freshBrowser(device?: ReturnType<typeof identity>) {
    localStorage.clear();
    document.body.innerHTML = '';
    __resetActiveLoginForTests();
    __resetDeviceSightingForTests();
    if (device)
      for (const item of fixtureBrowserStorage(device).origins[0].localStorage)
        localStorage.setItem(item.name, item.value);
  }
  function deviceDoor() {
    let bound: string | undefined;
    rpcMock.mockImplementation(async (name: string, args: { p_device_id: string }) => {
      expect(name).toBe('ca_claim_active_login');
      if (!bound) bound = args.p_device_id;
      return {
        data:
          bound === args.p_device_id
            ? { ok: true, bound: true, device_id: DEV }
            : { ok: false, needs_choice: true, devices: [{ id: DEV, label: 'Existing Browser' }] },
        error: null,
      };
    });
  }
  it('reproduces the old fresh-context failure through the real enrollment consumer', async () => {
    deviceDoor();
    freshBrowser();
    await enrollDevice(tokenWith(SID_A));
    await settle();
    freshBrowser();
    await enrollDevice(tokenWith(SID_B));
    await settle();
    expect(document.body.textContent).toContain('Is This The Same Device?');
    expect(localStorage.getItem(ENROLLED_DEVICE_STORAGE_KEY)).toBeNull();
  });
  it('reuses only this owned account and origin browser, and observes fresh enrollment both times', async () => {
    deviceDoor();
    const device = identity();
    for (const sid of [SID_A, SID_B]) {
      freshBrowser(device);
      localStorage.setItem('smarter-poker-auth', JSON.stringify({ user: { id: fixture.id } }));
      expect(fixtureEnrollmentObserved(device)).toBe(false);
      await enrollDevice(tokenWith(sid));
      await settle();
      expect(fixtureEnrollmentObserved(device)).toBe(true);
      expect(document.body.textContent).not.toContain('Is This The Same Device?');
    }
    expect(rpcMock.mock.calls.map((call) => call[1].p_device_id)).toEqual([
      device.browserId,
      device.browserId,
    ]);
    expect(fixtureBrowserStorage(device).origins[0].localStorage).toEqual([
      { name: 'ca_device_id', value: device.browserId },
    ]);
  });
  it('normalizes paths to the exact origin but isolates another origin and account', () => {
    expect(identity('https://smarter.poker/hub/club-arena/')).toEqual(
      identity('https://smarter.poker:443/another-path')
    );
    expect(identity('https://other.smarter.poker').browserId).not.toBe(
      identity('https://smarter.poker').browserId
    );
    const other = { ...fixture, id: '22345678-1234-4234-8234-123456789abc' };
    expect(fixtureBrowserDevice(other, other, other.email, location.origin).browserId).not.toBe(
      identity().browserId
    );
  });
  it('refuses account mismatch and non-disposable identities', () => {
    expect(() =>
      fixtureBrowserDevice(fixture, { ...fixture, id: DEV }, fixture.email, location.origin)
    ).toThrow(/does not match/);
    expect(() =>
      fixtureBrowserDevice(fixture, fixture, 'real-player@example.com', location.origin)
    ).toThrow(/does not match/);
    expect(() =>
      fixtureBrowserDevice({ ...fixture, createdAt: null }, fixture, fixture.email, location.origin)
    ).toThrow(/does not match/);
    expect(() => identity('file:///private/path')).toThrow(/HTTP app origin/);
  });
  it('does not certify a missing enrollment, another token or another authenticated account', () => {
    const device = identity();
    freshBrowser(device);
    localStorage.setItem('smarter-poker-auth', JSON.stringify({ user: { id: fixture.id } }));
    expect(fixtureEnrollmentObserved(device)).toBe(false);
    localStorage.setItem(ENROLLED_DEVICE_STORAGE_KEY, DEV);
    expect(fixtureEnrollmentObserved(device)).toBe(true);
    localStorage.setItem('ca_device_id', SID_A);
    expect(fixtureEnrollmentObserved(device)).toBe(false);
    localStorage.setItem('ca_device_id', device.browserId);
    localStorage.setItem('smarter-poker-auth', JSON.stringify({ user: { id: DEV } }));
    expect(fixtureEnrollmentObserved(device)).toBe(false);
  });
});
