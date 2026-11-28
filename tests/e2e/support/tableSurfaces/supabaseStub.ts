/* Offline stand-in for src/lib/supabase.ts, swapped in by the table surface
   ink spec's esbuild bundle (tests/e2e/css/table-surfaces-wear-smarterdesign.spec.ts).
   Every read answers from the small fixture below and nothing leaves the page:
   the spec also aborts every request that is not the fixture document or a
   repository asset, so a component that bypasses this client still reaches no
   network. Never shipped. */
export const FIXTURE_USER_ID = '00000000-0000-4000-8000-0000000000aa';

const tables: Record<string, unknown[]> = {
  friendships: [
    {
      friend_id: '00000000-0000-4000-8000-0000000000b1',
      user_id: '00000000-0000-4000-8000-0000000000b2',
    },
  ],
  profiles: [
    {
      id: '00000000-0000-4000-8000-0000000000b1',
      username: 'emerson',
      display_name: 'Emerson Blackwell',
      level: 12,
    },
    {
      id: '00000000-0000-4000-8000-0000000000b2',
      username: 'cali_duncan',
      display_name: 'Cali Duncan',
      level: 7,
    },
  ],
};

type Result = { data: unknown; error: null; count?: number };

function builder(rows: unknown[]): any {
  let single = false;
  const result = (): Result =>
    single
      ? { data: rows[0] ?? null, error: null }
      : { data: rows, error: null, count: rows.length };
  const target: any = {
    then: (ok: (r: Result) => unknown, bad?: (e: unknown) => unknown) =>
      Promise.resolve(result()).then(ok, bad),
    catch: (bad: (e: unknown) => unknown) => Promise.resolve(result()).catch(bad),
    finally: (f: () => void) => Promise.resolve(result()).finally(f),
  };
  const proxy: any = new Proxy(target, {
    get(t, key) {
      if (key in t) return t[key];
      if (key === 'maybeSingle' || key === 'single') {
        return () => {
          single = true;
          return proxy;
        };
      }
      return () => proxy;
    },
  });
  return proxy;
}

const channel = () => {
  const c: any = {
    on: () => c,
    subscribe: (cb?: (s: string) => void) => (cb?.('SUBSCRIBED'), c),
    unsubscribe: () => Promise.resolve('ok'),
    send: () => Promise.resolve('ok'),
    track: () => Promise.resolve('ok'),
    untrack: () => Promise.resolve('ok'),
    presenceState: () => ({}),
  };
  return c;
};

const user = { id: FIXTURE_USER_ID, email: 'fixture@smarter.poker', user_metadata: {} };
const session = { access_token: 'fixture', refresh_token: 'fixture', expires_at: 4e9, user };

export const supabase: any = {
  from: (table: string) => builder(tables[table] ?? []),
  rpc: () => builder([]),
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
  return 'fixture';
}
export async function getAuthUser() {
  return user;
}
export type SupabaseClient = typeof supabase;
export default supabase;
