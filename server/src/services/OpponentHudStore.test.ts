/** OPPONENT HUD STORE (2026-11-20, lane OPPONENT-HUD): event loading, the 15-second deadline, hardening. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { drainFires, enableBrainTelemetry } from '../engine/BrainTelemetry.js';
import {
  HUD_CATCHUP_MAX_PAUSE_MS,
  HUD_CATCHUP_PAGE_ROWS,
  HUD_CATCHUP_PAUSE_MS,
  HUD_READY_DEADLINE_MS,
  HUD_RING_MS,
  OpponentHudStore,
  type HudStoredRow,
  type OpponentHudStoreDeps,
} from './OpponentHudStore.js';
import {
  applyHudHand,
  emptyHudProfile,
  handRecordFromRow,
  type HudHandRecord,
} from '../engine/opponentHud/OpponentHudProfile.js';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const H = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T0 = 1_800_000_000_000;
function row(id: number, a: number, b: number, at = T0 + id * 1000) {
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
function fakeDeps(
  stored: Map<string, HudStoredRow>,
  opts: { fail?: boolean; hang?: boolean } = {}
) {
  // a sync point at T0 (as after a backfill), unless the test stores its own
  if (!stored.has('plo5|*'))
    stored.set('plo5|*', {
      user_id: '*',
      family: 'plo5',
      version: 1,
      hands: 0,
      wm_ms: T0,
      profile: { family: {}, stakes: {} },
    });
  let now = T0;
  const upserts: object[][] = [];
  const deps: OpponentHudStoreDeps & { tick(ms: number): void; upserts: object[][] } = {
    handsPage: undefined,
    async read(ids, family) {
      if (opts.fail) throw new Error('down');
      if (opts.hang) return new Promise(() => {});
      return ids.flatMap((u) => {
        const r = stored.get(`${family}|${u}`);
        return r ? [r] : [];
      });
    },
    async recent() {
      return [...stored.values()];
    },
    async upsert(rows) {
      upserts.push(rows);
      const refused: string[] = [];
      for (const r of rows as {
        user_id: string;
        family: string;
        hands: number;
        profile: unknown;
      }[]) {
        const cur = stored.get(`${r.family}|${r.user_id}`);
        // the function's law: a player's row is written only on the revision it was built on
        const special = r.user_id === '*' || r.user_id === '#sync';
        const base = (r as { base_rev?: number }).base_rev;
        if (special ? cur !== undefined && cur.hands > r.hands : base !== (cur?.rev ?? 0))
          refused.push(`${r.family}|${r.user_id}`);
        else
          stored.set(`${r.family}|${r.user_id}`, {
            ...(r as unknown as HudStoredRow),
            rev: (cur?.rev ?? 0) + 1,
          });
      }
      return refused;
    },
    now: () => now,
    tick(ms) {
      now += ms;
    },
    upserts,
  };
  return deps;
}
const flush = () => new Promise((r) => setTimeout(r, 0));
function lifetime(user: number, n: number): HudStoredRow {
  const p = emptyHudProfile(U(user), 'plo5');
  for (let i = 0; i < n; i++)
    applyHudHand(
      p,
      handRecordFromRow(row(10_000 + i, user, 99, T0 - 86_400_000 + i * 1000)) as HudHandRecord
    );
  return { user_id: U(user), family: 'plo5', version: 1, hands: p.hands, wm_ms: p.wm, profile: p };
}

describe('OpponentHudStore: option off is a build without the HUD', () => {
  it('off: zero database statements and zero work on the seat, hand, decision, timer and reconcile paths', async () => {
    let statements = 0;
    const count = <T>(v: T) => {
      statements += 1;
      return v;
    };
    const deps = fakeDeps(new Map([[`plo5|${U(1)}`, lifetime(1, 5)]]));
    const real = { read: deps.read, recent: deps.recent, upsert: deps.upsert };
    deps.read = async (...a) => count(await real.read(...a));
    deps.recent = async (...a) => count(await real.recent(...a));
    deps.upsert = async (...a) => count(await real.upsert(...a));
    deps.handsPage = async () => count([]);
    const alerts: string[] = [];
    deps.alert = (n) => alerts.push(n);
    const store = new OpponentHudStore(deps);
    store.warm([U(1), U(2)], 'plo5', 'sit');
    expect(store.onAcceptedHand(row(1, 1, 2))).toBe(0);
    expect(
      store.packetFor({
        family: 'plo5',
        cash: true,
        heroId: U(9),
        opponentIds: [U(1)],
        street: 'flop',
        atMs: T0,
      })
    ).toEqual({});
    await store.persist();
    await store.prewarm();
    store.tickAlerts();
    deps.tick(36 * 3600_000);
    await store.maybeReconcile();
    await flush();
    expect(statements).toBe(0);
    expect(alerts).toEqual([]);
    expect(store.stats()).toEqual({ ready: 0, loading: 0, failed: 0, dirty: 0, ring: 0 });
  });

  it('switching on catches up from the sync point, then switching off saves once and drops everything', async () => {
    const stored = new Map<string, HudStoredRow>([[`plo5|${U(1)}`, lifetime(1, 5)]]);
    stored.set('plo5|*', {
      user_id: '*',
      family: 'plo5',
      version: 1,
      hands: 0,
      wm_ms: T0 - 60_000,
      profile: { family: {}, stakes: {} },
    });
    const deps = fakeDeps(stored);
    const since = [row(70_001, 1, 2, T0 - 30_000), row(70_002, 1, 3, T0 - 20_000)];
    deps.handsPage = async (afterAt: string) => since.filter((r) => r.created_at > afterAt);
    const store = new OpponentHudStore(deps);
    store.setArmed(true);
    for (let i = 0; i < 20 && !store.lastActivation; i++) await flush();
    expect(store.lastActivation).toMatchObject({ applied: 4, capped: false });
    expect(store.profile(U(1), 'plo5')!.hands).toBe(7);
    expect(stored.get(`plo5|${U(1)}`)!.hands).toBe(7);
    expect(stored.get('plo5|#sync')).toBeDefined();
    store.setArmed(false);
    await flush();
    await flush();
    expect(store.stats().ready).toBe(0);
  });
});

describe('OpponentHudStore: the switch-on catch-up is rate limited and never ahead of seated players', () => {
  const syncAt = (stored: Map<string, HudStoredRow>, at: number) =>
    stored.set('plo5|*', {
      user_id: '*',
      family: 'plo5',
      version: 1,
      hands: 0,
      wm_ms: at,
      profile: { family: {}, stakes: {} },
    });
  const pager = (rows: ReturnType<typeof row>[], onCall?: (n: number) => void) => {
    const limits: number[] = [];
    let calls = 0;
    const page = async (afterAt: string, afterId: string, limit: number) => {
      limits.push(limit);
      onCall?.(++calls);
      return rows
        .filter((r) => r.created_at > afterAt || (r.created_at === afterAt && r.id > afterId))
        .slice(0, limit);
    };
    return { page, limits, calls: () => calls };
  };

  it('pages of at most HUD_CATCHUP_PAGE_ROWS rows, a pause between pages, doubling on slow pages and halving back', async () => {
    const stored = new Map<string, HudStoredRow>();
    syncAt(stored, T0 - 3 * 3600_000);
    const deps = fakeDeps(stored);
    const rows = Array.from({ length: 600 }, (_, i) =>
      row(80_000 + i, 1 + (i % 20), 21 + (i % 20), T0 - 3 * 3600_000 + i * 1000)
    );
    // pages 2 and 3 of the first pass are slow (1.5 s each): the pause doubles twice, then halves back
    const p = pager(rows, (n) => {
      if (n === 2 || n === 3) deps.tick(1_500);
    });
    deps.handsPage = p.page;
    const pauses: number[] = [];
    deps.sleep = async (ms) => {
      if (ms > 0) pauses.push(ms);
    };
    const store = new OpponentHudStore(deps);
    store.setArmed(true);
    for (let i = 0; i < 400 && !store.lastActivation; i++) await flush();
    expect(store.lastActivation).toMatchObject({ applied: 1200, capped: false });
    expect(p.limits.every((l) => l <= HUD_CATCHUP_PAGE_ROWS)).toBe(true);
    expect(p.calls()).toBe(6); // two passes of 250 + 250 + 100
    expect(store.catchupStats.backoffs).toBe(2);
    expect(store.catchupStats.rows).toBe(1200);
    const pagePauses = pauses.filter((ms) => ms >= HUD_CATCHUP_PAUSE_MS);
    expect(pagePauses.slice(0, 2)).toEqual([HUD_CATCHUP_PAUSE_MS, HUD_CATCHUP_PAUSE_MS * 2]); // doubled after slow page 2
    expect(store.catchupStats.maxPauseMs).toBe(HUD_CATCHUP_PAUSE_MS * 4); // and again after slow page 3
    expect(Math.max(...pagePauses)).toBeLessThanOrEqual(HUD_CATCHUP_MAX_PAUSE_MS);
    expect(pagePauses[pagePauses.length - 1]).toBe(HUD_CATCHUP_PAUSE_MS); // recovered
  });

  it('a seated player is loaded before the catch-up reads its next page, and a decision is never blocked', async () => {
    const stored = new Map<string, HudStoredRow>([[`plo5|${U(50)}`, lifetime(50, 12)]]);
    syncAt(stored, T0 - 3600_000);
    const deps = fakeDeps(stored);
    const order: string[] = [];
    const rows = [row(90_001, 1, 2, T0 - 1800_000)];
    deps.handsPage = async (afterAt: string) => {
      order.push('page');
      return rows.filter((r) => r.created_at > afterAt);
    };
    const realRead = deps.read;
    let release: (() => void) | null = null;
    deps.read = async (ids, family, signal) => {
      if (ids.includes(U(50))) {
        await new Promise<void>((r) => (release = r));
        order.push('seat');
      }
      return realRead(ids, family, signal);
    };
    let sleeps = 0;
    deps.sleep = async (ms) => {
      deps.tick(ms);
      if (++sleeps === 5 && release) release();
    };
    const store = new OpponentHudStore(deps);
    store.setArmed(true);
    store.warm([U(50)], 'plo5', 'sit'); // the table join, while the switch-on catch-up starts
    // the decision path answers at once while the seat load and the catch-up are both in flight
    const f = store.packetFor({
      family: 'plo5',
      cash: true,
      heroId: U(9),
      opponentIds: [U(50)],
      street: 'preflop',
      atMs: T0,
    });
    expect(f.opponentHud).toBeDefined();
    for (let i = 0; i < 200 && !store.lastActivation; i++) await flush();
    expect(order[0]).toBe('seat');
    expect(order.indexOf('page')).toBeGreaterThan(0);
    expect(store.catchupStats.yieldedToSeats).toBeGreaterThanOrEqual(1);
    expect(store.profile(U(50), 'plo5')!.hands).toBe(12);
    expect(store.readyLatencies.every((ms) => ms < HUD_READY_DEADLINE_MS)).toBe(true);
  });
});

describe('OpponentHudStore', () => {
  it('a sit-down loads the profile ahead of the first decision, and the packet carries it', async () => {
    const stored = new Map([[`plo5|${U(1)}`, lifetime(1, 30)]]);
    const deps = fakeDeps(stored);
    const store = new OpponentHudStore(deps);
    store.setArmed(true);
    store.warm([U(1), U(2)], 'plo5', 'sit');
    await flush();
    expect(store.ready(U(1), 'plo5')).toBe(true);
    expect(store.ready(U(2), 'plo5')).toBe(true); // no row: the empty profile (population prior)
    const f = store.packetFor({
      family: 'plo5',
      cash: true,
      heroId: U(9),
      opponentIds: [U(1), U(2)],
      street: 'preflop',
      atMs: T0,
    });
    expect(f.opponentHud!.opp[U(1)].hands).toBe(30);
    expect(f.opponentHud!.opp[U(2)].hands).toBe(0);
    expect(store.readyLatencies.every((ms) => ms < HUD_READY_DEADLINE_MS)).toBe(true);
  });

  it('not armed, or not PLO4/PLO5: no field at all (the snapshot is unchanged); a PLO tournament decision gets it', async () => {
    const store = new OpponentHudStore(fakeDeps(new Map()));
    expect(
      store.packetFor({
        family: 'plo5',
        cash: true,
        heroId: U(9),
        opponentIds: [U(1)],
        street: 'flop',
        atMs: T0,
      })
    ).toEqual({});
    store.setArmed(true);
    expect(
      store.packetFor({
        family: 'plo6',
        cash: true,
        heroId: U(9),
        opponentIds: [U(1)],
        street: 'flop',
        atMs: T0,
      })
    ).toEqual({});
    // OPPONENT-HUD-FIX-1 (lead ruling 2026-11-21 18:38Z): tournaments are in scope, behind the same switch row
    expect(
      store.packetFor({
        family: 'plo5',
        cash: false,
        heroId: U(9),
        opponentIds: [U(1)],
        street: 'flop',
        atMs: T0,
        bigBlind: 400,
      }).opponentHud
    ).toBeDefined();
  });

  it('a failing or hanging database never throws and never blocks; the decision proceeds without the profile', async () => {
    for (const o of [{ fail: true }, { hang: true }]) {
      const store = new OpponentHudStore(fakeDeps(new Map(), o));
      store.setArmed(true);
      expect(() => store.warm([U(1)], 'plo5', 'lightning')).not.toThrow();
      await flush();
      const f = store.packetFor({
        family: 'plo5',
        cash: true,
        heroId: U(9),
        opponentIds: [U(1)],
        street: 'preflop',
        atMs: T0,
      });
      expect(f.opponentHud!.opp[U(1)]).toBeUndefined();
    }
  });

  it('every accepted hand updates every dealt player exactly once; a hand during the load is applied after it', async () => {
    const stored = new Map([[`plo5|${U(1)}`, lifetime(1, 10)]]);
    const deps = fakeDeps(stored);
    const store = new OpponentHudStore(deps);
    store.setArmed(true);
    store.warm([U(1)], 'plo5', 'sit');
    await flush();
    expect(store.onAcceptedHand(row(1, 1, 2))).toBe(1);
    expect(store.onAcceptedHand(row(1, 1, 2))).toBe(0); // the same hand again: nothing
    expect(store.profile(U(1), 'plo5')!.hands).toBe(11);
    // U(2) was warmed by the hand itself and gets the ring hand when it loads
    await flush();
    expect(store.profile(U(2), 'plo5')!.hands).toBe(1);
  });

  it('persist writes dirty profiles; a refused row is merged onto the stored row, never written over lifetime', async () => {
    const stored = new Map<string, HudStoredRow>();
    const deps = fakeDeps(stored);
    const store = new OpponentHudStore(deps);
    store.setArmed(true);
    store.warm([U(1)], 'plo5', 'sit');
    await flush();
    store.onAcceptedHand(row(2, 1, 3));
    await store.persist();
    expect(stored.get(`plo5|${U(1)}`)!.hands).toBe(1);
    // the backfill lands a lifetime row with more hands (its revision moves); the engine's thin copy must not
    // overwrite it: the save is refused, the engine's two live hands are merged onto the lifetime row and saved
    // (OpponentHudStoreMultiProcess.test.ts holds the multi-writer laws)
    stored.set(`plo5|${U(1)}`, { ...lifetime(1, 50), rev: 7 });
    store.onAcceptedHand(row(3, 1, 3));
    await store.persist();
    expect(stored.get(`plo5|${U(1)}`)!.hands).toBe(52);
    expect(store.ready(U(1), 'plo5')).toBe(true); // never taken away from a seated player
    expect(store.profile(U(1), 'plo5')!.hands).toBe(52);
  });

  it('an opponent still not ready 15 seconds after he was asked for is counted late; before that, missing', async () => {
    enableBrainTelemetry();
    drainFires();
    const deps = fakeDeps(new Map(), { hang: true });
    const store = new OpponentHudStore(deps);
    store.setArmed(true);
    store.warm([U(1)], 'plo5', 'sit');
    store.packetFor({
      family: 'plo5',
      cash: true,
      heroId: U(9),
      opponentIds: [U(1)],
      street: 'flop',
      atMs: T0,
    });
    deps.tick(HUD_READY_DEADLINE_MS + 1);
    store.packetFor({
      family: 'plo5',
      cash: true,
      heroId: U(9),
      opponentIds: [U(1)],
      street: 'flop',
      atMs: T0,
    });
    const fires = drainFires().map((f) => f.feature);
    expect(fires).toContain('opponent_hud_packet_opponent_missing');
    expect(fires).toContain('opponent_hud_packet_opponent_late');
  });

  it('a restart loses no hand: boot catches up hand_history since before the last persistence, each hand once', async () => {
    const stored = new Map([[`plo5|${U(1)}`, lifetime(1, 10)]]);
    const deps = fakeDeps(stored);
    deps.tick(86_400_000);
    const late = [
      row(50_001, 1, 2, T0 + 86_400_000 - 60_000),
      row(50_002, 1, 2, T0 + 86_400_000 - 30_000),
    ];
    deps.handsPage = async (afterAt: string) => late.filter((r) => r.created_at > afterAt);
    const store = new OpponentHudStore(deps);
    store.setArmed(true);
    await store.prewarm();
    expect(store.profile(U(1), 'plo5')!.hands).toBe(12);
    await store.catchUp(new Date(T0).toISOString());
    expect(store.profile(U(1), 'plo5')!.hands).toBe(12);
    // a player warmed after boot gets the caught-up hands from the ring
    store.warm([U(2)], 'plo5', 'sit');
    await flush();
    expect(store.profile(U(2), 'plo5')!.hands).toBe(2);
  });

  it("the packet takes the population prior of the hand's stake", async () => {
    const store = new OpponentHudStore(fakeDeps(new Map()));
    store.setArmed(true);
    store.setPriors('plo5', {
      family: { 'pf.vpip': [0.4, 10] },
      stakes: { b1: { 'pf.vpip': [0.6, 500] } },
    });
    const at1 = store.packetFor({
      family: 'plo5',
      cash: true,
      heroId: U(9),
      opponentIds: [],
      street: 'preflop',
      atMs: T0,
      bigBlind: 1,
    });
    const at5 = store.packetFor({
      family: 'plo5',
      cash: true,
      heroId: U(9),
      opponentIds: [],
      street: 'preflop',
      atMs: T0,
      bigBlind: 5,
    });
    expect(at1.opponentHud!.pri['pf.vpip']).toEqual([0.6, 10]);
    expect(at5.opponentHud!.pri['pf.vpip']).toEqual([0.4, 10]);
  });

  it('failures and late profiles go to Production Alerts once and resolve when clean (never a page)', async () => {
    const alerts: [string, boolean][] = [];
    const deps = fakeDeps(new Map(), { fail: true });
    deps.alert = (name, firing) => alerts.push([name, firing]);
    const store = new OpponentHudStore(deps);
    store.setArmed(true);
    for (let i = 0; i < 6; i++) {
      store.warm([U(100 + i)], 'plo5', 'sit');
      await flush();
    }
    store.warm([U(1)], 'plo5', 'sit');
    deps.tick(HUD_READY_DEADLINE_MS + 1);
    store.packetFor({
      family: 'plo5',
      cash: true,
      heroId: U(9),
      opponentIds: [U(1)],
      street: 'flop',
      atMs: T0,
    });
    store.tickAlerts();
    store.tickAlerts();
    store.tickAlerts();
    expect(alerts).toEqual([
      ['OpponentHudLoadFailing', true],
      ['OpponentHudProfileLate', true],
      ['OpponentHudLoadFailing', false],
      ['OpponentHudProfileLate', false],
    ]);
  });

  it('nightly verification rebuilds the day from the raw rows and compares; any difference alerts; it never writes a count', async () => {
    const alerts: [string, boolean][] = [];
    const stored = new Map<string, HudStoredRow>();
    const deps = fakeDeps(stored);
    deps.alert = (name, firing) => alerts.push([name, firing]);
    const day0 = Date.parse('2027-01-14T18:00:00Z'); // noon Chicago
    const hands = [
      row(60_001, 1, 2, day0),
      row(60_002, 1, 2, day0 + 60_000),
      row(60_003, 1, 2, day0 + 120_000),
    ];
    let history = hands;
    deps.handsPage = async (
      afterAt: string,
      _id: string,
      _l: number,
      _s: AbortSignal,
      until?: string
    ) => history.filter((r) => r.created_at > afterAt && (!until || r.created_at <= until));
    const store = new OpponentHudStore(deps);
    // armed with no history to catch up, then the profiles track days from the day before
    history = [];
    store.setArmed(true);
    await flush();
    store.warm([U(1), U(2)], 'plo5', 'sit');
    await flush();
    store.onAcceptedHand(row(59_000, 1, 2, day0 - 86_400_000));
    store.onAcceptedHand(hands[0]);
    store.onAcceptedHand(hands[2]);
    history = hands;
    const before = JSON.stringify(store.profile(U(1), 'plo5'));
    const writes = deps.upserts.length;
    // hand 60_002 never reached the engine: reported, NOT applied
    expect(await store.reconcileDay('2027-01-14')).toEqual({
      compared: 2,
      drifted: 2,
      missed: 2,
      extra: 0,
      miscounted: 0,
    });
    expect(JSON.stringify(store.profile(U(1), 'plo5'))).toBe(before);
    expect(store.profile(U(1), 'plo5')!.hands).toBe(3);
    expect(deps.upserts.length).toBe(writes);
    // the root path counts it (the hand arrives late, out of order): the next verification is clean
    store.onAcceptedHand(hands[1]);
    expect(store.profile(U(1), 'plo5')!.hands).toBe(4);
    expect((await store.reconcileDay('2027-01-14')).drifted).toBe(0);
    // a hand counted that hand_history does not hold
    history = hands.slice(0, 2);
    expect(await store.reconcileDay('2027-01-14')).toMatchObject({
      drifted: 2,
      extra: 2,
      missed: 0,
    });
    // the same hands, a different sum (a count that is not what the raw rows give)
    history = hands;
    store.profile(U(1), 'plo5')!.dsum!['2027-01-14'] += 1;
    expect(await store.reconcileDay('2027-01-14')).toMatchObject({ drifted: 1, miscounted: 1 });
    store.profile(U(1), 'plo5')!.dsum!['2027-01-14'] -= 1;
    expect((await store.reconcileDay('2027-01-14')).drifted).toBe(0);
    expect(alerts).toEqual([
      ['OpponentHudDrift', true],
      ['OpponentHudDrift', false],
      ['OpponentHudDrift', true],
      ['OpponentHudDrift', false],
    ]);
    const src = readFileSync(
      fileURLToPath(new URL('./OpponentHudStore.ts', import.meta.url)),
      'utf8'
    );
    const body = src.slice(
      src.indexOf('async reconcileDay('),
      src.indexOf('/** Operator / metrics snapshot. */')
    );
    expect(body).not.toMatch(/applyHudHand|\.dirty|persist\(|upsert\(/);
  });

  it('boot prewarm loads stored profiles and the population priors', async () => {
    const stored = new Map<string, HudStoredRow>([
      [`plo5|${U(1)}`, lifetime(1, 5)],
      [
        'plo5|*',
        {
          user_id: '*',
          family: 'plo5',
          version: 1,
          hands: 0,
          wm_ms: -1,
          profile: { 'pf.vpip': [0.4, 10] },
        },
      ],
    ]);
    const store = new OpponentHudStore(fakeDeps(stored));
    store.setArmed(true);
    expect(await store.prewarm()).toBeGreaterThanOrEqual(1);
    expect(store.ready(U(1), 'plo5')).toBe(true);
  });
});

/**
 * OWNER REQUIREMENTS (3:20 PM Chicago Nov 20; lane OPPONENT-HUD-4, Nov 21): the laws the earlier blocks did not hold.
 */
describe('OpponentHudStore: owner requirements (15 seconds on every seat change; never miscounts; live counters)', () => {
  const ask = (store: OpponentHudStore, opp: number) =>
    store.packetFor({
      family: 'plo5',
      cash: true,
      heroId: U(9),
      opponentIds: [U(opp)],
      street: 'flop',
      atMs: T0,
    });

  it.each(['sit', 'move', 'lightning', 'hand', 'boot'] as const)(
    'a %s starts the load at the seat change: ready ahead of the first decision, with its own load-time counter',
    async (event) => {
      enableBrainTelemetry();
      const stored = new Map([[`plo5|${U(1)}`, lifetime(1, 40)]]);
      const deps = fakeDeps(stored);
      // not among the profiles the switch-on prewarm loads: the seat change is what loads him
      deps.recent = async () => [];
      const store = new OpponentHudStore(deps);
      store.setArmed(true);
      await flush();
      drainFires();
      store.warm([U(1)], 'plo5', event);
      await flush();
      expect(store.ready(U(1), 'plo5')).toBe(true);
      const pk = ask(store, 1).opponentHud!;
      expect(pk.opp[U(1)]).toBeDefined();
      const fires = drainFires().map((f) => f.feature);
      expect(fires).toContain(`opponent_hud_event_${event}`);
      expect(fires).toContain(`opponent_hud_ready_${event}_ms_le100`);
      expect(fires).toContain('opponent_hud_ready_ms_le100');
      // the share of decisions with the profile ready: one ready, none missing or late
      expect(fires).toContain('opponent_hud_packet_opponent_ready');
      expect(fires.some((f) => /packet_opponent_(missing|late)/.test(f))).toBe(false);
      expect(store.readyLatencies.at(-1)).toBeLessThanOrEqual(HUD_READY_DEADLINE_MS);
    }
  );

  it.each(['sit', 'move', 'lightning', 'hand', 'boot'] as const)(
    'a %s whose profile is still not ready after 15 seconds: every such decision is counted late and alerts',
    async (event) => {
      enableBrainTelemetry();
      const alerts: [string, boolean][] = [];
      const deps = fakeDeps(new Map(), { hang: true });
      deps.alert = (name, firing) => alerts.push([name, firing]);
      const store = new OpponentHudStore(deps);
      store.setArmed(true);
      drainFires();
      store.warm([U(1)], 'plo5', event);
      deps.tick(HUD_READY_DEADLINE_MS);
      expect(ask(store, 1).opponentHud!.opp[U(1)]).toBeUndefined();
      expect(drainFires().map((f) => f.feature)).toContain('opponent_hud_packet_opponent_missing');
      deps.tick(1);
      // the decision is answered at once on the population read, never waiting on the store
      const t0 = Date.now();
      expect(ask(store, 1).opponentHud!.opp[U(1)]).toBeUndefined();
      expect(Date.now() - t0).toBeLessThan(50);
      expect(drainFires().map((f) => f.feature)).toContain('opponent_hud_packet_opponent_late');
      store.tickAlerts();
      expect(alerts).toContainEqual(['OpponentHudProfileLate', true]);
    }
  );

  it('a catch-up walking old hands while live hands arrive counts every hand once; none is refused as stale', async () => {
    enableBrainTelemetry();
    const stored = new Map([[`plo5|${U(1)}`, lifetime(1, 10)]]);
    const deps = fakeDeps(stored);
    deps.tick(2 * 86_400_000);
    const old = Array.from({ length: 30 }, (_, i) =>
      row(70_000 + i, 1, 2, T0 + 3_600_000 + i * 60_000)
    );
    deps.handsPage = async (afterAt: string) => old.filter((r) => r.created_at > afterAt);
    const store = new OpponentHudStore(deps);
    store.setArmed(true);
    store.warm([U(1)], 'plo5', 'sit');
    await flush();
    drainFires();
    // a live hand first (the watermark is now two days ahead of the history still to be walked)
    store.onAcceptedHand(row(80_000, 1, 3, T0 + 2 * 86_400_000));
    await store.catchUp(new Date(T0).toISOString());
    await store.catchUp(new Date(T0).toISOString());
    for (let i = 0; i < 100 && store.catchupStats.pages < 2; i++) await flush();
    expect(store.profile(U(1), 'plo5')!.hands).toBe(10 + 30 + 1);
    expect(drainFires().map((f) => f.feature)).not.toContain('opponent_hud_apply_stale');
  });

  it('a load that succeeds after the ring of recent hands moved on reads the gap back from hand_history, once', async () => {
    const opts = { fail: true };
    const deps = fakeDeps(new Map(), opts);
    const played = [row(90_001, 1, 2, T0 + 1000), row(90_002, 1, 2, T0 + 2000)];
    const elsewhere = row(90_003, 3, 4, T0 + HUD_RING_MS + 60_000);
    deps.handsPage = async (afterAt: string) =>
      [...played, elsewhere].filter((r) => r.created_at > afterAt);
    const store = new OpponentHudStore(deps);
    store.setArmed(true);
    await flush();
    // the database is down while he sits and plays two hands; the ring then moves past them
    store.warm([U(1)], 'plo5', 'sit');
    await flush();
    for (const h of played) store.onAcceptedHand(h);
    deps.tick(HUD_RING_MS + 60_000);
    store.onAcceptedHand(elsewhere);
    expect(store.stats().ring).toBe(1);
    opts.fail = false;
    store.warm([U(1)], 'plo5', 'hand');
    for (let i = 0; i < 400 && store.profile(U(1), 'plo5')?.hands !== 2; i++)
      await new Promise((r) => setTimeout(r, 5));
    expect(store.profile(U(1), 'plo5')!.hands).toBe(2);
    expect(store.gapCatchUps).toBe(1);
    // read again (a retry): nothing is counted twice
    await store.catchUp(new Date(T0).toISOString());
    expect(store.profile(U(1), 'plo5')!.hands).toBe(2);
  });

  it('the engine wires every seat change to the load and no decision path awaits the store', () => {
    const code = (rel: string) =>
      readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
    // sit-down, table move and Lightning conversion all adopt a seat roster; each hand start; each Lightning hand
    expect(code('engine/ServerTableEngineBase.ts')).toMatch(
      /adoptSeatRoster\(nextRoster: SeatedPlayer\[\]\): string\[\] \{[\s\S]{0,1800}?for \(const p of nextRoster\)[\s\S]{0,400}?warmOpponentHudSeats\(moved, variant, tournamentTable, 'move'\);\s*warmOpponentHudSeats\(seated, variant, tournamentTable, 'sit'\);/
    );
    expect(code('engine/ServerTableEngineHandEvents.ts')).toMatch(
      /warmOpponentHudSeats\(\s*players\.map\(\(p\) => p\.user_id\),[\s\S]{0,120}?'hand'/
    );
    expect(code('lightning/LightningHandHost.ts')).toMatch(
      /warmOpponentHudSeats\(\s*\[\.\.\.this\.participants\.keys\(\)\],[\s\S]{0,80}?'lightning'/
    );
    // boot and cutover: the lane starts the store and every switch delivery arms it (activation catches up)
    const lane = code('engine/horseDecision/lane.ts');
    expect(lane).toMatch(/startOpponentHudStore\(\)/);
    expect(lane).toMatch(/armOpponentHudFromSwitch\(message\)/);
    // every accepted hand reaches the profiles
    expect(code('services/supabase/handHistory.ts')).toMatch(/opponentHudOnAcceptedHand\(/);
    // the decision takes what is warm: the snapshot field is spread synchronously, never awaited
    for (const f of ['engine/ServerTableEngineTurns.ts', 'lightning/LightningHorse.ts']) {
      const src = code(f);
      expect(src).toMatch(/\.\.\.opponentHudSnapshotField\(/);
      expect(src).not.toMatch(/await\s+opponentHudSnapshotField|await\s+warmOpponentHudSeats/);
    }
    const store = code('services/OpponentHudStore.ts');
    const packetFor = store.slice(
      store.indexOf('  packetFor(input: {'),
      store.indexOf('  onAcceptedHand(row: unknown)')
    );
    expect(packetFor).not.toMatch(/\bawait\b|\basync\b/);
    const field = store.slice(
      store.indexOf('export function opponentHudSnapshotField('),
      store.indexOf('export function armOpponentHudFromSwitch(')
    );
    expect(field).not.toMatch(/\bawait\b|\basync\b/);
  });
});
