/**
 * getSession() reads a still-valid stored session without the cross-tab lock
 * (2026-11-24). Every smarter.poker tab shares `lock:smarter-poker-auth`; when
 * another tab held it past the acquire budget, every getSession() caller in
 * this tab (REST token, table socket, action submit, 45 app call sites) failed
 * with "AbortError: signal is aborted without reason". Pinned against both
 * runtime builds of the vendored SDK, the same way as the initialization
 * recovery suite.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { buildSync } from 'esbuild';

const require = createRequire(import.meta.url);
const esm = { exports: {} as any };
const compiled = buildSync({
  entryPoints: [resolve('node_modules/@supabase/auth-js/dist/module/index.js')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  logLevel: 'silent',
}).outputFiles[0].text;
new Function('require', 'module', 'exports', compiled)(require, esm, esm.exports);

const constructors = [
  ['CommonJS', require('@supabase/auth-js').AuthClient],
  ['ES module', esm.exports.AuthClient],
] as const;
let serial = 0;
afterEach(() => vi.restoreAllMocks());

function session(expiresInSeconds: number, tag = 'stored') {
  return {
    access_token: `access-${tag}`,
    refresh_token: `refresh-${tag}`,
    token_type: 'bearer',
    expires_in: expiresInSeconds,
    expires_at: Math.floor(Date.now() / 1000) + expiresInSeconds,
    user: { id: 'player-1' },
  };
}

/** A lock this tab can hand to "another tab" that then never gives it back. */
function sharedLock() {
  const state = { otherTabHoldsIt: false, requests: 0 };
  const lock = vi.fn(async (_name: string, _timeout: number, body: () => Promise<unknown>) => {
    state.requests++;
    if (state.otherTabHoldsIt) return new Promise(() => {});
    return await body();
  });
  return { lock, state };
}

function client(AuthClient: any, lock: unknown, storage: Map<string, string>, extra = {}) {
  const storageKey = `session-read-${serial++}`;
  const instance = new AuthClient({
    url: 'https://auth-fixture.invalid/auth/v1',
    storageKey,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: true,
    storage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
    },
    lock,
    ...extra,
  });
  return { instance, storageKey };
}

async function settlesWithin<T>(promise: Promise<T>, ms = 200) {
  return await Promise.race([
    promise.then((value) => ({ settled: true as const, value })),
    new Promise<{ settled: false }>((done) => setTimeout(() => done({ settled: false }), ms)),
  ]);
}

describe.each(constructors)('%s getSession() and the cross-tab lock', (_kind, AuthClient) => {
  it('returns a valid stored session while another tab holds the lock', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = new Map<string, string>();
    const { lock, state } = sharedLock();
    const { instance, storageKey } = client(AuthClient, lock, storage);
    await instance.initialize();
    const stored = session(7 * 24 * 3600, 'week');
    storage.set(storageKey, JSON.stringify(stored));
    state.otherTabHoldsIt = true;
    const before = state.requests;

    const outcome = await settlesWithin(instance.getSession());

    expect(outcome.settled).toBe(true);
    if (!outcome.settled) return;
    expect(outcome.value.error).toBeNull();
    expect(outcome.value.data.session.access_token).toBe('access-week');
    expect(state.requests).toBe(before);
  });

  it('a token inside the expiry margin still goes through the lock to refresh', async () => {
    const storage = new Map<string, string>();
    const { lock, state } = sharedLock();
    const { instance, storageKey } = client(AuthClient, lock, storage);
    await instance.initialize();
    storage.set(storageKey, JSON.stringify(session(30, 'expiring')));
    state.otherTabHoldsIt = true;
    const before = state.requests;

    const outcome = await settlesWithin(instance.getSession());

    expect(outcome.settled).toBe(false);
    expect(state.requests).toBe(before + 1);
  });

  it('a session another tab signed out of is not served from memory', async () => {
    const storage = new Map<string, string>();
    const { lock } = sharedLock();
    const { instance, storageKey } = client(AuthClient, lock, storage);
    await instance.initialize();
    storage.set(storageKey, JSON.stringify(session(7 * 24 * 3600)));
    expect((await instance.getSession()).data.session).not.toBeNull();
    storage.delete(storageKey);

    const { data, error } = await instance.getSession();

    expect(error).toBeNull();
    expect(data.session).toBeNull();
  });

  it('before this client has initialized, the read waits for initialization under the lock', async () => {
    const storage = new Map<string, string>();
    const { lock, state } = sharedLock();
    state.otherTabHoldsIt = true;
    const { instance, storageKey } = client(AuthClient, lock, storage);
    storage.set(storageKey, JSON.stringify(session(7 * 24 * 3600)));

    const outcome = await settlesWithin(instance.getSession());

    expect(outcome.settled).toBe(false);
    expect(state.requests).toBeGreaterThan(0);
  });

  it('a client with separate user storage keeps the upstream locked read', async () => {
    const storage = new Map<string, string>();
    const users = new Map<string, string>();
    const { lock, state } = sharedLock();
    const { instance, storageKey } = client(AuthClient, lock, storage, {
      userStorage: {
        getItem: (key: string) => users.get(key) ?? null,
        setItem: (key: string, value: string) => void users.set(key, value),
        removeItem: (key: string) => void users.delete(key),
      },
    });
    await instance.initialize();
    storage.set(storageKey, JSON.stringify(session(7 * 24 * 3600)));
    state.otherTabHoldsIt = true;
    const before = state.requests;

    const outcome = await settlesWithin(instance.getSession());

    expect(outcome.settled).toBe(false);
    expect(state.requests).toBe(before + 1);
  });
});
