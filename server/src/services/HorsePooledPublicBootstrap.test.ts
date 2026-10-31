import { beforeEach, expect, it, vi } from 'vitest';
import { PooledPublicProfiles } from '../engine/horseDecision/pooledPublicProfiles.js';
import { freshExploitCounters } from '../engine/HorseOpponentExploit.js';
const mock = vi.hoisted(() => ({
  from: vi.fn(),
  abort: vi.fn(),
  order: vi.fn(),
  gt: vi.fn(),
  limit: vi.fn(),
  select: vi.fn(),
}));
vi.mock('./supabase.js', () => ({ supabase: { from: mock.from } }));
import {
  HORSE_POOLED_BOOTSTRAP_CAPACITY,
  readHorsePooledPublicBootstrap,
} from './HorsePooledPublicBootstrap.js';

const uid = (n: number) => `90000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const VARIANTS = ['nlh', 'plo4', 'plo5', 'plo6', 'plo8'] as const;
const row = (n = 1, v = 0, hands = 40) => ({
  user_id: uid(n),
  variant: VARIANTS[v % VARIANTS.length],
  mode: 'cash',
  size: 'short',
  initialized: true,
  observed_hands: hands,
  counters: freshExploitCounters(),
});

/** An in-memory table answering the keyset query exactly as PostgREST would. */
function table(rows: ReturnType<typeof row>[]) {
  const sorted = [...rows].sort((a, b) =>
    a.user_id === b.user_id ? (a.variant < b.variant ? -1 : 1) : a.user_id < b.user_id ? -1 : 1
  );
  const calls: Array<string | null> = [];
  const page = async (after: string | null) => {
    calls.push(after);
    const data = sorted.filter((r) => after === null || r.user_id > after).slice(0, 1000);
    return { data, error: null };
  };
  return { page, calls, sorted };
}

beforeEach(() => {
  vi.clearAllMocks();
  const query = {
    select: mock.select,
    order: mock.order,
    gt: mock.gt,
    limit: mock.limit,
    abortSignal: mock.abort,
  };
  mock.from.mockReturnValue(query);
  mock.select.mockReturnValue(query);
  mock.order.mockReturnValue(query);
  mock.gt.mockReturnValue(query);
  mock.limit.mockReturnValue(query);
});

it('reads only saved public columns with observed hands, by keyset, before the first decision', async () => {
  const before = Date.now();
  mock.abort.mockResolvedValueOnce({ data: [row()], error: null });
  const result = await readHorsePooledPublicBootstrap();
  expect(result?.profiles).toEqual([row()]);
  expect(result!.availableAtMs).toBeGreaterThanOrEqual(before);
  expect(mock.from).toHaveBeenCalledWith('horse_exploit_profiles');
  expect(mock.select).toHaveBeenCalledWith(
    'user_id,variant,mode,size,counters,observed_hands,initialized'
  );
  expect(mock.gt).toHaveBeenCalledWith('observed_hands', 0);
  expect(mock.limit).toHaveBeenCalledWith(1000);
  expect(mock.abort).toHaveBeenCalledTimes(1);
});

it('a player split across a page boundary is read whole, once', async () => {
  // 990 single-row players, then one player with 30 rows straddling row 1,000.
  const rows = [
    ...Array.from({ length: 990 }, (_, i) => row(i + 1)),
    // 5 variants x 2 modes x 3 sizes: thirty distinct rows for one player.
    ...Array.from({ length: 30 }, (_, k) => ({
      ...row(5000, k % 5),
      mode: (['cash', 'tournament'] as const)[Math.floor(k / 5) % 2],
      size: (['hu', 'short', 'full'] as const)[Math.floor(k / 10)],
    })),
  ];
  const t = table(rows);
  const snapshot = await readHorsePooledPublicBootstrap(t.page);
  expect(snapshot?.profiles).toHaveLength(rows.length);
  expect(t.calls).toEqual([null, uid(990)]);
});

it('a profile inserted between pages neither duplicates nor skips (the offset failure)', async () => {
  const rows = Array.from({ length: 1500 }, (_, i) => row(i * 2 + 2));
  const t = table(rows);
  let first = true;
  const page = async (after: string | null) => {
    const out = await t.page(after);
    if (first) {
      first = false;
      // A new opponent arrives with an id that sorts before the next page.
      t.sorted.unshift(row(1));
      t.sorted.sort((a, b) => (a.user_id < b.user_id ? -1 : 1));
    }
    return out;
  };
  const snapshot = await readHorsePooledPublicBootstrap(page);
  expect(snapshot?.profiles).toHaveLength(1500);
  expect(new Set(snapshot!.profiles.map((p) => p.user_id)).size).toBe(1500);
});

it('loads the production population (29,816 rows on 2026-10-31) and the worker cache accepts it', async () => {
  const rows = Array.from({ length: 29816 }, (_, i) => row(Math.floor(i / 5) + 1, i % 5));
  const snapshot = await readHorsePooledPublicBootstrap(table(rows).page);
  expect(snapshot?.profiles).toHaveLength(29816);
  expect(new PooledPublicProfiles().bootstrap(snapshot!)).toBe(true);
});

it('past the cache capacity it keeps the most-observed profiles instead of loading nothing', async () => {
  const n = HORSE_POOLED_BOOTSTRAP_CAPACITY + 500;
  const rows = Array.from({ length: n }, (_, i) => row(i + 1, 0, i < 500 ? 1 : 100));
  const snapshot = await readHorsePooledPublicBootstrap(table(rows).page);
  expect(snapshot?.profiles).toHaveLength(HORSE_POOLED_BOOTSTRAP_CAPACITY);
  expect(snapshot!.profiles.every((p) => p.observed_hands === 100)).toBe(true);
  expect(new PooledPublicProfiles().bootstrap(snapshot!)).toBe(true);
});

it('refuses malformed, duplicate, regressing, failed and over-budget reads atomically', async () => {
  const ok = async () => ({ data: [row(1)], error: null });
  expect(await readHorsePooledPublicBootstrap(ok)).not.toBeNull();
  for (const data of [[{ ...row(), counters: {} }], [row(), row()]])
    expect(await readHorsePooledPublicBootstrap(async () => ({ data, error: null }))).toBeNull();
  expect(
    await readHorsePooledPublicBootstrap(async () => ({ data: null, error: { code: 'x' } }))
  ).toBeNull();
  expect(
    await readHorsePooledPublicBootstrap(async () => {
      throw Error('transport');
    })
  ).toBeNull();
  // A page that answers rows at or before the keyset is inconsistent.
  let n = 0;
  const regress = async () => ({
    data: n++ === 0 ? Array.from({ length: 1000 }, (_, i) => row(i + 10)) : [row(1)],
    error: null,
  });
  expect(await readHorsePooledPublicBootstrap(regress)).toBeNull();
  // The budget aborts a read that never answers.
  const hang = (_: string | null, signal: AbortSignal) =>
    new Promise<{ data: unknown; error: unknown }>((_r, reject) =>
      signal.addEventListener('abort', () => reject(signal.reason))
    );
  expect(await readHorsePooledPublicBootstrap(hang, 20)).toBeNull();
});
