/**
 * A request's bearer token never waits on the cross-tab sign-in lock while
 * the stored token is valid (2026-11-24, GRANDmasterFLUSH: every read in the
 * tab aborted at the 10 s lock budget while another smarter.poker tab held
 * `lock:smarter-poker-auth`, and the club route showed "Club Access Could Not
 * Be Verified"). Pinned against the REAL client, not a copy of its wiring.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const BASE = 'https://unit.supabase.co';
const LOCK = 'lock:smarter-poker-auth';
const STORAGE_KEY = 'smarter-poker-auth';

type Client = typeof import('../../src/lib/supabase');
let client: Client;

function b64url(value: object): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function jwt(expiresInSeconds: number, tag: string): string {
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: 'player-1', exp, tag })}.sig`;
}

function storeSession(accessToken: string, expiresInSeconds: number) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      access_token: accessToken,
      refresh_token: 'refresh-1',
      token_type: 'bearer',
      expires_in: expiresInSeconds,
      expires_at: Math.floor(Date.now() / 1000) + expiresInSeconds,
      user: { id: 'player-1' },
    })
  );
}

/** Another tab takes the shared sign-in lock and does not give it back. */
function anotherTabHoldsTheSignInLock(): () => void {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  void navigator.locks.request(LOCK, { mode: 'exclusive' }, () => held);
  return release;
}

function bearerOf(transport: ReturnType<typeof vi.fn>): string | null {
  const init = transport.mock.calls[0]?.[1] as RequestInit | undefined;
  return new Headers(init?.headers).get('Authorization');
}

function okTransport() {
  return vi
    .fn()
    .mockResolvedValue(
      new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
    );
}

beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', BASE);
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key-for-unit-tests');
  client = await vi.importActual<Client>('../../src/lib/supabase');
  // Let the SDK finish its own startup before a test holds the lock.
  await client.supabase.auth.getSession();
});
afterAll(() => vi.unstubAllEnvs());

let releaseLock: (() => void) | null = null;
afterEach(() => {
  releaseLock?.();
  releaseLock = null;
  localStorage.removeItem(STORAGE_KEY);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the bearer token on a database read', () => {
  it('is the client token hook, so every REST, RPC, storage and Realtime call uses it', () => {
    expect((client.supabase as unknown as { accessToken?: unknown }).accessToken).toBe(
      client.requestAccessToken
    );
  });

  it('goes out while another tab holds the sign-in lock, carrying the stored token', async () => {
    const token = jwt(7 * 24 * 3600, 'stored');
    storeSession(token, 7 * 24 * 3600);
    releaseLock = anotherTabHoldsTheSignInLock();
    const transport = okTransport();
    vi.stubGlobal('fetch', transport);
    const getSession = vi.spyOn(client.supabase.auth, 'getSession');

    const read = client.supabase.from('club_members').select('role,status');
    const outcome = await Promise.race([
      read.then((result) => ({ settled: true, error: result.error })),
      new Promise<{ settled: false }>((resolve) =>
        setTimeout(() => resolve({ settled: false }), 1_000)
      ),
    ]);

    expect(outcome).toEqual({ settled: true, error: null });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(bearerOf(transport)).toBe(`Bearer ${token}`);
    expect(getSession).not.toHaveBeenCalled();
  });

  it('asks the SDK, which refreshes under the lock, once the stored token is nearly expired', async () => {
    storeSession(jwt(30, 'expiring'), 30);
    const refreshed = jwt(7 * 24 * 3600, 'refreshed');
    const getSession = vi
      .spyOn(client.supabase.auth, 'getSession')
      .mockResolvedValue({ data: { session: { access_token: refreshed } }, error: null } as never);
    const transport = okTransport();
    vi.stubGlobal('fetch', transport);

    const { error } = await client.supabase.from('club_members').select('role,status');

    expect(error).toBeNull();
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(bearerOf(transport)).toBe(`Bearer ${refreshed}`);
  });

  it('keeps the anonymous key for a signed-out visitor', async () => {
    vi.spyOn(client.supabase.auth, 'getSession').mockResolvedValue({
      data: { session: null },
      error: null,
    } as never);

    await expect(client.requestAccessToken()).resolves.toBe('anon-key-for-unit-tests');
  });
});
