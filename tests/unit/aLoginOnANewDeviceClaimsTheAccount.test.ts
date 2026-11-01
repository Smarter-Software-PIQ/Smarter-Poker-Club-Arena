/**
 * Single active device per account (Dan, 2026-11-01): "regardless if its
 * desktop, mobile or ipad, it needs to log out of all previous sessions. You
 * can have multiple desktop windows and login's open, just not different
 * devices."
 *
 * The client half of that rule: a sign-in (or the SPA booting with a session
 * the Hub's login page just created - INITIAL_SESSION) claims the login
 * through ca_claim_active_login, exactly once per GoTrue session, so a tab
 * regaining focus or a restored window can never re-claim and kick anyone.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpcMock = vi.hoisted(() => vi.fn());
const authListeners = vi.hoisted(() => [] as Array<(e: string, s: unknown) => void>);

vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    auth: {
      onAuthStateChange: (cb: (e: string, s: unknown) => void) => {
        authListeners.push(cb);
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
  },
}));

import {
  CLAIMED_LOGIN_STORAGE_KEY,
  __resetActiveLoginForTests,
  claimActiveLogin,
  sessionIdOf,
  startSingleActiveLogin,
} from '../../src/lib/activeLogin';
import { __resetDeviceSightingForTests } from '../../src/lib/deviceSighting';

const SID_A = '11111111-2222-4333-8444-555555555555';
const SID_B = '99999999-8888-4777-8666-555555555555';

function tokenWith(sessionId: string): string {
  const payload = Buffer.from(JSON.stringify({ session_id: sessionId, sub: 'user-1' }))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `header.${payload}.sig`;
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({ data: { ok: true, kicked: 0 }, error: null });
  authListeners.length = 0;
  localStorage.clear();
  __resetActiveLoginForTests();
  __resetDeviceSightingForTests();
});

describe('sessionIdOf', () => {
  it('reads the GoTrue session id out of the access token', () => {
    expect(sessionIdOf(tokenWith(SID_A))).toBe(SID_A);
  });
  it('rejects garbage, absent tokens and non-uuid claims', () => {
    expect(sessionIdOf(null)).toBeNull();
    expect(sessionIdOf('not-a-jwt')).toBeNull();
    expect(sessionIdOf(tokenWith('not-a-uuid'))).toBeNull();
  });
});

describe('claimActiveLogin', () => {
  it('claims a new session once and remembers it', async () => {
    await claimActiveLogin(tokenWith(SID_A));
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock.mock.calls[0][0]).toBe('ca_claim_active_login');
    expect((rpcMock.mock.calls[0][1] as { p_device_id: string }).p_device_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(localStorage.getItem(CLAIMED_LOGIN_STORAGE_KEY)).toBe(SID_A);

    // The same session re-announcing itself (tab focus) claims nothing.
    await claimActiveLogin(tokenWith(SID_A));
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it('a NEW session claims again - that is the login that kicks the others', async () => {
    await claimActiveLogin(tokenWith(SID_A));
    await claimActiveLogin(tokenWith(SID_B));
    expect(rpcMock).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(CLAIMED_LOGIN_STORAGE_KEY)).toBe(SID_B);
  });

  it('a transport failure is not remembered, so the next event retries', async () => {
    rpcMock.mockRejectedValueOnce(new Error('offline'));
    await claimActiveLogin(tokenWith(SID_A));
    expect(localStorage.getItem(CLAIMED_LOGIN_STORAGE_KEY)).toBeNull();
    await claimActiveLogin(tokenWith(SID_A));
    expect(rpcMock).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(CLAIMED_LOGIN_STORAGE_KEY)).toBe(SID_A);
  });

  it('an error answer is not remembered either - PostgREST 503s must retry', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'service unavailable' } });
    await claimActiveLogin(tokenWith(SID_A));
    // the database treats a duplicate claim as a no-op, so retrying is safe.
    expect(localStorage.getItem(CLAIMED_LOGIN_STORAGE_KEY)).toBeNull();
  });

  it('never claims without a session id', async () => {
    await claimActiveLogin(null);
    await claimActiveLogin('broken');
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe('startSingleActiveLogin', () => {
  it('claims on SIGNED_IN and INITIAL_SESSION, never on refresh or sign-out', async () => {
    startSingleActiveLogin();
    startSingleActiveLogin(); // idempotent
    expect(authListeners).toHaveLength(1);
    const emit = authListeners[0];

    emit('TOKEN_REFRESHED', { access_token: tokenWith(SID_A) });
    emit('SIGNED_OUT', null);
    await settle();
    expect(rpcMock).not.toHaveBeenCalled();

    emit('SIGNED_IN', { access_token: tokenWith(SID_A) });
    await settle();
    expect(rpcMock).toHaveBeenCalledTimes(1);

    // The Hub web login lands here as INITIAL_SESSION with a new session.
    emit('INITIAL_SESSION', { access_token: tokenWith(SID_B) });
    await settle();
    expect(rpcMock).toHaveBeenCalledTimes(2);

    // A restored tab re-announcing the claimed session is silent.
    emit('INITIAL_SESSION', { access_token: tokenWith(SID_B) });
    emit('SIGNED_IN', { access_token: tokenWith(SID_B) });
    await settle();
    expect(rpcMock).toHaveBeenCalledTimes(2);
  });
});
