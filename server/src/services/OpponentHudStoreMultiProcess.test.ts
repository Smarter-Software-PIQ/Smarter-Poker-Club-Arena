/**
 * OPPONENT HUD STORE, MORE THAN ONE ENGINE PROCESS (2026-11-21, lane OPPONENT-HUD-5, owner order: the helpers never
 * break, regress or miscount).
 *
 * The store is one object per engine PROCESS (main thread). The eight horse decision workers are threads of that
 * process: they receive a packet per decision and never count a hand, load a row or write one
 * (TheHudProviderChangesNoDecision / the wiring law). More than one PROCESS holds the same player whenever a new
 * engine boots while the old one still finishes hands (every cutover), when a standby is armed, and when the backfill
 * runs under a live engine. Each of those writes the WHOLE profile row, so the database must refuse a writer that did
 * not start from the stored row (opponent_hud_profiles.rev, compare-and-swap inside fn_opponent_hud_profiles_upsert)
 * and the refused writer must merge: reload the stored row and re-apply only the hands it does not hold (the hand id
 * lists inside the stored profile are the idempotency key, in the database).
 *
 * FakeDb mirrors the SQL of supabase/migrations/20261120223000_opponent_hud_profiles.sql; the SQL itself is proven
 * under real concurrent transactions by scripts/ci/test-opponent-hud-upsert-postgres.sh. HUD_TEST_LEGACY_GUARD=1 runs
 * the fake with the schema as it was before `rev` (monotone hands / watermark guard only): the lost-update tests fail
 * there, which is the defect this file pins.
 */
import { describe, expect, it } from 'vitest';
import {
  HUD_PERSIST_BATCH,
  HUD_PERSIST_BATCH_BYTES,
  HUD_PERSIST_MS,
  HUD_REFRESH_MS,
  HUD_RING_MS,
  HUD_SYNC_ROW,
  OpponentHudStore,
  persistOpponentHudBeforeExit,
  setOpponentHudStoreForTest,
  type HudStoredRow,
  type OpponentHudStoreDeps,
} from './OpponentHudStore.js';
import {
  applyHudHand,
  emptyHudProfile,
  handRecordFromRow,
  type HudHandRecord,
  type OpponentHudProfile,
} from '../engine/opponentHud/OpponentHudProfile.js';

const LEGACY = process.env.HUD_TEST_LEGACY_GUARD === '1';
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const H = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T0 = 1_800_000_000_000;
type Row = ReturnType<typeof row>;
function row(id: number, a: number, b: number, at: number) {
  return {
    id: H(id),
    created_at: new Date(at).toISOString(),
    game_variant: 'plo5',
    tournament_id: null,
    big_blind: 2,
    button_seat: 1,
    players: [
      { seat: 1, userId: U(a), stack: 400 },
      { seat: 2, userId: U(b), stack: 400 },
    ],
    actions: [
      { seat: 1, userId: U(a), stage: 'preflop', action: 'sb', amount: 1 },
      { seat: 2, userId: U(b), stage: 'preflop', action: 'bb', amount: 2 },
      { seat: 1, userId: U(a), stage: 'preflop', action: 'raise', amount: 6 },
      { seat: 2, userId: U(b), stage: 'preflop', action: 'fold', amount: 0 },
    ],
    community_cards: [],
    showdown: [],
    winners: [{ userId: U(a), amount: 8 }],
  };
}
type Stored = HudStoredRow & { rev: number };
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** One database shared by every process of a test: rows are copied in and out (no object is shared with a store). */
class FakeDb {
  readonly rows = new Map<string, Stored>();
  readonly hands: Row[] = [];
  now = T0;
  writes = 0;
  constructor() {
    this.rows.set('plo5|*', {
      user_id: '*',
      family: 'plo5',
      version: 1,
      hands: 0,
      wm_ms: T0,
      rev: 1,
      profile: { family: {}, stakes: {} },
    });
  }
  /** the engine's hand_history insert (the hand is accepted once, by the process that dealt it) */
  accept(h: Row): Row {
    this.hands.push(h);
    this.hands.sort((x, y) =>
      x.created_at < y.created_at ? -1 : x.created_at > y.created_at ? 1 : 0
    );
    return h;
  }
  seedLifetime(user: number, n: number): void {
    const p = emptyHudProfile(U(user), 'plo5');
    for (let i = 0; i < n; i++)
      applyHudHand(
        p,
        handRecordFromRow(row(10_000 + i, user, 99, T0 - 86_400_000 + i * 1000)) as HudHandRecord
      );
    this.rows.set(`plo5|${U(user)}`, {
      user_id: U(user),
      family: 'plo5',
      version: 1,
      hands: p.hands,
      wm_ms: p.wm,
      rev: 1,
      profile: clone(p),
    });
  }
  profile(user: number): OpponentHudProfile {
    return this.rows.get(`plo5|${U(user)}`)!.profile as OpponentHudProfile;
  }
  /** fn_opponent_hud_profiles_upsert, statement for statement */
  upsert(rows: object[]): string[] {
    const refused: string[] = [];
    for (const raw of rows) {
      const r = clone(raw) as Stored & { base_rev?: number; rebuild?: boolean };
      const k = `${r.family}|${r.user_id}`;
      const cur = this.rows.get(k);
      const put = (rev: number) => {
        this.writes += 1;
        this.rows.set(k, {
          user_id: r.user_id,
          family: r.family,
          version: r.version,
          hands: r.hands,
          wm_ms: r.wm_ms,
          rev,
          profile: r.profile,
        });
      };
      if (r.rebuild === true) put((cur?.rev ?? 0) + 1);
      else if (LEGACY || r.user_id === '*' || r.user_id === HUD_SYNC_ROW) {
        if (cur && r.version === cur.version && (r.hands < cur.hands || r.wm_ms < cur.wm_ms))
          refused.push(k);
        else put((cur?.rev ?? 0) + 1);
      } else if (typeof r.base_rev !== 'number') refused.push(k);
      else if (cur) {
        if (r.base_rev !== cur.rev) refused.push(k);
        else put(cur.rev + 1);
      } else put(r.base_rev + 1);
    }
    return refused;
  }
  /** one engine process: its own clock view, its own store */
  process(opts: { gate?: () => Promise<void> } = {}): OpponentHudStore {
    const deps: OpponentHudStoreDeps = {
      read: async (ids, family) =>
        ids.flatMap((u) => {
          const r = this.rows.get(`${family}|${u}`);
          return r ? [clone(r)] : [];
        }),
      recent: async () => [...this.rows.values()].map((r) => clone(r)),
      upsert: async (rows) => {
        const sent = clone(rows); // the request body is built when the call is made
        if (opts.gate) await opts.gate();
        return this.upsert(sent);
      },
      handsPage: async (afterAt, afterId, limit, _signal, untilIso) =>
        this.hands
          .filter(
            (h) =>
              (h.created_at > afterAt || (h.created_at === afterAt && h.id > afterId)) &&
              (untilIso === undefined || h.created_at <= untilIso)
          )
          .slice(0, limit)
          .map((h) => clone(h)),
      now: () => this.now,
      sleep: async () => undefined,
    };
    return new OpponentHudStore(deps);
  }
}
const flush = async (n = 12) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};
async function boot(db: FakeDb, users: number[], opts: { gate?: () => Promise<void> } = {}) {
  const s = db.process(opts);
  s.setArmed(true);
  await flush();
  s.warm(users.map(U), 'plo5', 'sit');
  await flush();
  return s;
}
const ids = (p: OpponentHudProfile) => new Set(p.ids);

describe('OpponentHudStore with more than one engine process', () => {
  it('two processes that count DIFFERENT hands of the same player: every hand is in the stored row once (no lost update)', async () => {
    const db = new FakeDb();
    db.seedLifetime(1, 100);
    const a = await boot(db, [1]);
    const b = await boot(db, [1]);
    db.now = T0 + 60_000;
    for (const n of [1, 2]) a.onAcceptedHand(db.accept(row(n, 1, 2, T0 + n * 1000)));
    for (const n of [3, 4, 5]) b.onAcceptedHand(db.accept(row(n, 1, 3, T0 + n * 1000)));
    await a.persist();
    await b.persist(); // more hands than the stored row and a later watermark, but not built on it
    await a.persist();
    const p = db.profile(1);
    expect(p.hands).toBe(105);
    for (const n of [1, 2, 3, 4, 5]) expect(ids(p).has(H(n))).toBe(true);
    // and both processes now serve the whole record
    expect(b.profile(U(1), 'plo5')!.hands).toBe(105);
    db.now += HUD_REFRESH_MS + 1;
    a.warm([U(1)], 'plo5', 'sit');
    await flush();
    expect(a.profile(U(1), 'plo5')!.hands).toBe(105);
  });

  it('the SAME hand counted by two processes is stored once', async () => {
    const db = new FakeDb();
    db.seedLifetime(1, 100);
    const a = await boot(db, [1]);
    const b = await boot(db, [1]);
    const h = db.accept(row(1, 1, 2, T0 + 1000));
    a.onAcceptedHand(h);
    b.onAcceptedHand(clone(h));
    b.onAcceptedHand(db.accept(row(2, 1, 2, T0 + 2000)));
    await a.persist();
    await b.persist();
    await a.persist();
    await b.persist();
    expect(db.profile(1).hands).toBe(102);
    expect(db.profile(1).ids.filter((x) => x === H(1)).length).toBe(1);
    expect(b.profile(U(1), 'plo5')!.hands).toBe(102);
  });

  it('a new player first seen by two processes at once: one row, both hands', async () => {
    const db = new FakeDb();
    const a = await boot(db, [7]);
    const b = await boot(db, [7]);
    a.onAcceptedHand(db.accept(row(1, 7, 2, T0 + 1000)));
    b.onAcceptedHand(db.accept(row(2, 7, 3, T0 + 2000)));
    await a.persist();
    await b.persist();
    expect(db.profile(7).hands).toBe(2);
    expect(ids(db.profile(7))).toEqual(new Set([H(1), H(2)]));
  });

  it('cutover: the old process saves on its way out (the real graceful-stop hook) AFTER the new one loaded and counted; neither erases the other', async () => {
    const db = new FakeDb();
    db.seedLifetime(1, 100);
    const old = await boot(db, [1]);
    old.onAcceptedHand(db.accept(row(1, 1, 2, T0 + 1000)));
    await old.persist(); // 101 stored
    old.onAcceptedHand(db.accept(row(2, 1, 2, T0 + 2000))); // in flight when the new process boots
    db.now = T0 + 10_000;
    const next = await boot(db, [1]); // reads 101, catches hand 2 up from hand_history
    expect(next.profile(U(1), 'plo5')!.hands).toBe(102);
    old.onAcceptedHand(db.accept(row(3, 1, 2, T0 + 11_000))); // the old process finishes its last hand
    next.onAcceptedHand(db.accept(row(4, 1, 2, T0 + 12_000)));
    next.onAcceptedHand(db.accept(row(5, 1, 2, T0 + 13_000)));
    await next.persist();
    // shutdown: the engine's graceful stop (index.ts performShutdown -> persistOpponentHudBeforeExit), NOT a hand-made
    // save and not the switch going off: the old process is still armed when it exits
    setOpponentHudStoreForTest(old);
    try {
      await persistOpponentHudBeforeExit();
    } finally {
      setOpponentHudStoreForTest(null);
    }
    expect(old.armed()).toBe(true);
    await flush();
    await next.persist();
    next.onAcceptedHand(db.accept(row(6, 1, 2, T0 + 14_000)));
    await next.persist();
    const p = db.profile(1);
    expect(p.hands).toBe(106);
    for (const n of [1, 2, 3, 4, 5, 6]) expect(ids(p).has(H(n))).toBe(true);
    expect(next.profile(U(1), 'plo5')!.hands).toBe(106);
  });

  it('a process that dies with unsaved hands: its successor counts each of them once, and the hand of the restart once', async () => {
    const db = new FakeDb();
    db.seedLifetime(1, 100);
    const dead = await boot(db, [1]);
    dead.onAcceptedHand(db.accept(row(1, 1, 2, T0 + 1000)));
    await dead.persist();
    dead.onAcceptedHand(db.accept(row(2, 1, 2, T0 + 2000)));
    dead.onAcceptedHand(db.accept(row(3, 1, 2, T0 + 3000)));
    // killed here: nothing saved since hand 1. A hand accepted by the database in the same second is the restart's.
    db.accept(row(4, 1, 2, T0 + 3500));
    db.now = T0 + 20_000;
    const next = await boot(db, [1]);
    expect(next.profile(U(1), 'plo5')!.hands).toBe(104);
    next.onAcceptedHand(clone(db.hands[db.hands.length - 1])); // delivered again: refused by its id
    expect(next.profile(U(1), 'plo5')!.hands).toBe(104);
    await next.persist();
    expect(db.profile(1).hands).toBe(104);
  });

  it('a hand accepted while a save is in flight stays unsaved and is written by the next save', async () => {
    const db = new FakeDb();
    db.seedLifetime(1, 100);
    let release: () => void = () => undefined;
    let gated = true;
    const s = await boot(db, [1], {
      gate: () => (gated ? new Promise<void>((r) => (release = r)) : Promise.resolve()),
    });
    s.onAcceptedHand(db.accept(row(1, 1, 2, T0 + 1000)));
    await flush(); // the opponent's profile is loaded too
    const saving = s.persist();
    await flush();
    s.onAcceptedHand(db.accept(row(2, 1, 2, T0 + 2000))); // after the request was built
    gated = false;
    release();
    await saving;
    expect(db.profile(1).hands).toBe(101);
    expect(db.profile(2).hands).toBe(1);
    expect(s.stats().dirty).toBe(2); // both players of hand 2 are still unsaved
    await s.persist();
    expect(db.profile(1).hands).toBe(102);
    expect(db.profile(2).hands).toBe(2);
    expect(s.stats().dirty).toBe(0);
  });

  it('a save whose answer was lost (written, reported failed) is not written twice and loses nothing', async () => {
    const db = new FakeDb();
    db.seedLifetime(1, 100);
    let lose = true;
    const s = db.process();
    const real = db.upsert.bind(db);
    db.upsert = (rows) => {
      const out = real(rows);
      if (lose && (rows as { user_id: string }[]).some((r) => r.user_id === U(1))) {
        lose = false;
        throw new Error('timeout after commit');
      }
      return out;
    };
    s.setArmed(true);
    await flush();
    s.warm([U(1)], 'plo5', 'sit');
    await flush();
    s.onAcceptedHand(db.accept(row(1, 1, 2, T0 + 1000)));
    await s.persist();
    expect(db.profile(1).hands).toBe(101);
    s.onAcceptedHand(db.accept(row(2, 1, 2, T0 + 2000)));
    await s.persist();
    expect(db.profile(1).hands).toBe(102);
    expect(s.profile(U(1), 'plo5')!.hands).toBe(102);
  });

  it('the backfill replacing a row under a live engine: the engine merges onto the rebuilt row, never over it', async () => {
    const db = new FakeDb();
    db.seedLifetime(1, 10);
    const s = await boot(db, [1]);
    s.onAcceptedHand(db.accept(row(1, 1, 2, T0 + 1000)));
    // the rebuild holds the lifetime (50 hands) but not the live hand
    const p = emptyHudProfile(U(1), 'plo5');
    for (let i = 0; i < 50; i++)
      applyHudHand(
        p,
        handRecordFromRow(row(10_000 + i, 1, 99, T0 - 86_400_000 + i * 1000)) as HudHandRecord
      );
    db.upsert([
      {
        user_id: U(1),
        family: 'plo5',
        version: p.v,
        hands: p.hands,
        wm_ms: p.wm,
        profile: p,
        rebuild: true,
      },
    ]);
    await s.persist();
    expect(db.profile(1).hands).toBe(51);
    expect(s.profile(U(1), 'plo5')!.hands).toBe(51);
  });

  it('stale-read bound: a clean cached profile is re-read on the first seat event after HUD_REFRESH_MS, and never before', async () => {
    const db = new FakeDb();
    db.seedLifetime(1, 100);
    const a = await boot(db, [1]);
    const b = await boot(db, [1]);
    b.onAcceptedHand(db.accept(row(1, 1, 2, T0 + 1000)));
    await b.persist();
    db.now = T0 + HUD_REFRESH_MS - 1000;
    a.warm([U(1)], 'plo5', 'sit');
    await flush();
    expect(a.profile(U(1), 'plo5')!.hands).toBe(100);
    db.now = T0 + HUD_REFRESH_MS + 1000;
    a.warm([U(1)], 'plo5', 'sit');
    expect(a.ready(U(1), 'plo5')).toBe(true); // the refresh never takes a ready profile away
    await flush();
    expect(a.profile(U(1), 'plo5')!.hands).toBe(101);
    expect(HUD_REFRESH_MS).toBeLessThanOrEqual(HUD_PERSIST_MS);
  });

  it('the sync point moves only when every changed profile is saved', async () => {
    const db = new FakeDb();
    db.seedLifetime(1, 100);
    const s = await boot(db, [1]);
    s.onAcceptedHand(db.accept(row(1, 1, 2, T0 + 1000)));
    await flush();
    const real = db.upsert.bind(db);
    // U(1) is refused every time (another writer keeps winning); every other row is written
    db.upsert = (rows) => {
      const all = rows as { user_id: string }[];
      const out = real(all.filter((r) => r.user_id !== U(1)));
      return all.some((r) => r.user_id === U(1)) ? [...out, `plo5|${U(1)}`] : out;
    };
    db.now = T0 + 60_000;
    await s.persist();
    expect(db.rows.get(`plo5|${HUD_SYNC_ROW}`)).toBeUndefined();
    expect(s.stats().dirty).toBe(1);
    db.upsert = real;
    await s.persist();
    expect(db.profile(1).hands).toBe(101);
    expect(db.rows.get(`plo5|${HUD_SYNC_ROW}`)!.wm_ms).toBe(T0 + 60_000);
  });

  it('a save call carries at most HUD_PERSIST_BATCH rows and HUD_PERSIST_BATCH_BYTES of profiles', async () => {
    const db = new FakeDb();
    const calls: number[] = [];
    const real = db.upsert.bind(db);
    db.upsert = (rows) => {
      calls.push(rows.length);
      return real(rows);
    };
    const users = Array.from({ length: 61 }, (_, i) => 100 + i);
    const s = await boot(db, users);
    users.forEach((u, i) => s.onAcceptedHand(db.accept(row(i + 1, u, 99, T0 + i * 1000))));
    await flush();
    // one player with three busy days: his row alone is most of a call's byte budget
    const heavy = s.profile(U(100), 'plo5')!;
    heavy.days = {
      ...heavy.days,
      '2026-01-01': Array.from({ length: 90_000 }, (_, i) => String(i).padStart(12, '0')),
    };
    await s.persist();
    const profileCalls = calls.slice(0, -1); // the last call is the sync point
    expect(calls.at(-1)).toBe(1);
    expect(Math.max(...profileCalls)).toBeLessThanOrEqual(HUD_PERSIST_BATCH);
    expect(profileCalls.reduce((a, b) => a + b, 0)).toBe(62);
    expect(profileCalls.length).toBeGreaterThan(Math.ceil(62 / HUD_PERSIST_BATCH)); // the heavy row cut a call short
    expect(s.stats().dirty).toBe(0);
    expect(HUD_PERSIST_BATCH_BYTES).toBeLessThanOrEqual(2_000_000);
  });

  it('unsaved hands older than the ring are read back from hand_history when a save is refused', async () => {
    const db = new FakeDb();
    db.seedLifetime(1, 100);
    const a = await boot(db, [1]);
    const b = await boot(db, [1]);
    a.onAcceptedHand(db.accept(row(1, 1, 2, T0 + 1000)));
    // a's saves fail for longer than the ring; other players' hands push hand 1 out of a's ring
    db.now = T0 + HUD_RING_MS + 120_000;
    a.onAcceptedHand(db.accept(row(2, 8, 9, db.now - 1000)));
    b.onAcceptedHand(db.accept(row(3, 1, 4, db.now - 500)));
    await b.persist();
    await a.persist();
    await flush(40);
    await a.persist();
    expect(db.profile(1).hands).toBe(102);
    expect(ids(db.profile(1))).toContain(H(1));
  });
});
