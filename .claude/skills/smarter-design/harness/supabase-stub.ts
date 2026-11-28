/* Render-harness stand-in for src/lib/supabase.ts: every read answers from
   Kings Club fixtures so the pages render offline. Never shipped. */
import { fixtures, rpcFixtures } from './fixtures';

type Result = { data: unknown; error: null; count?: number };

function builder(rows: unknown, single = false): any {
  const list = Array.isArray(rows) ? rows : rows == null ? [] : [rows];
  let mode: 'list' | 'single' = single ? 'single' : 'list';
  const result = (): Result =>
    mode === 'single'
      ? { data: list[0] ?? null, error: null }
      : {
          data: Array.isArray(rows) || rows == null ? list : rows,
          error: null,
          count: list.length,
        };
  const target: any = {
    then: (ok: (r: Result) => unknown, bad?: (e: unknown) => unknown) =>
      Promise.resolve(result()).then(ok, bad),
    catch: (bad: (e: unknown) => unknown) => Promise.resolve(result()).catch(bad),
    finally: (f: () => void) => Promise.resolve(result()).finally(f),
    maybeSingle: () => {
      mode = 'single';
    },
    single: () => {
      mode = 'single';
    },
  };
  const proxy: any = new Proxy(target, {
    get(t, key) {
      if (key in t) {
        const v = t[key];
        return typeof v === 'function' && key !== 'then' && key !== 'finally' && key !== 'catch'
          ? (...a: unknown[]) => (v(...a), proxy)
          : v;
      }
      return () => proxy;
    },
  });
  return proxy;
}

function chain(rows: unknown) {
  const b = builder(rows);
  return b;
}

const channel = () => {
  const c: any = {
    on: () => c,
    subscribe: (cb?: (s: string) => void) => (cb?.('SUBSCRIBED'), c),
    unsubscribe: () => Promise.resolve('ok'),
    send: () => Promise.resolve('ok'),
    track: () => Promise.resolve('ok'),
    presenceState: () => ({}),
  };
  return c;
};

const user = { id: fixtures.ownerId, email: 'owner@kings.club', user_metadata: {} };
const session = { access_token: 'h', refresh_token: 'h', expires_at: 4e9, user };

export const supabase: any = {
  from: (table: string) => {
    const b: any = chain(fixtures.tables[table] ?? []);
    return b;
  },
  rpc: (name: string) => chain(rpcFixtures[name] ?? null),
  channel,
  removeChannel: () => Promise.resolve('ok'),
  removeAllChannels: () => Promise.resolve([]),
  getChannels: () => [],
  realtime: { setAuth: () => undefined, connect: () => undefined },
  functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
  storage: {
    from: () => ({
      getPublicUrl: (p: string) => ({ data: { publicUrl: p } }),
      upload: () => Promise.resolve({ data: null, error: null }),
    }),
  },
  auth: {
    getSession: () => Promise.resolve({ data: { session }, error: null }),
    getUser: () => Promise.resolve({ data: { user }, error: null }),
    refreshSession: () => Promise.resolve({ data: { session }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
    signOut: () => Promise.resolve({ error: null }),
  },
};
export const REQUEST_TOKEN_MARGIN_MS = 90_000;
export async function requestAccessToken() {
  return 'h';
}
export async function getAuthUser() {
  return user;
}
export type SupabaseClient = typeof supabase;
export default supabase;
