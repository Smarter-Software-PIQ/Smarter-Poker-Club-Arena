/** OPPONENT HUD STORE (2026-11-20, lane OPPONENT-HUD): event loading, the 15-second deadline, hardening. */
import { describe, expect, it } from 'vitest';
import { drainFires, enableBrainTelemetry } from '../engine/BrainTelemetry.js';
import {
  HUD_READY_DEADLINE_MS,
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
        if (cur && cur.hands > r.hands) refused.push(`${r.family}|${r.user_id}`);
        else stored.set(`${r.family}|${r.user_id}`, { ...(r as unknown as HudStoredRow) });
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

  it('not armed, or not PLO4/PLO5 cash: no field at all (the snapshot is unchanged)', async () => {
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
    expect(
      store.packetFor({
        family: 'plo5',
        cash: false,
        heroId: U(9),
        opponentIds: [U(1)],
        street: 'flop',
        atMs: T0,
      })
    ).toEqual({});
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

  it('persist writes dirty profiles; a refused stale row is dropped and reloaded, never written over lifetime', async () => {
    const stored = new Map<string, HudStoredRow>();
    const deps = fakeDeps(stored);
    const store = new OpponentHudStore(deps);
    store.setArmed(true);
    store.warm([U(1)], 'plo5', 'sit');
    await flush();
    store.onAcceptedHand(row(2, 1, 3));
    await store.persist();
    expect(stored.get(`plo5|${U(1)}`)!.hands).toBe(1);
    // the backfill lands a lifetime row with more hands; the engine's thin copy must not overwrite it
    stored.set(`plo5|${U(1)}`, lifetime(1, 50));
    store.onAcceptedHand(row(3, 1, 3));
    await store.persist();
    expect(stored.get(`plo5|${U(1)}`)!.hands).toBe(50);
    expect(store.ready(U(1), 'plo5')).toBe(false);
    store.warm([U(1)], 'plo5', 'hand');
    await flush();
    expect(store.profile(U(1), 'plo5')!.hands).toBeGreaterThanOrEqual(50);
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

  it('nightly reconciliation applies a hand the profile missed, raises drift, and resolves on a clean night', async () => {
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
    deps.handsPage = async (
      afterAt: string,
      _id: string,
      _l: number,
      _s: AbortSignal,
      until?: string
    ) => hands.filter((r) => r.created_at > afterAt && (!until || r.created_at <= until));
    const store = new OpponentHudStore(deps);
    store.setArmed(true);
    // the profiles track days from the day before; hand 60_002 never reached the engine
    store.warm([U(1), U(2)], 'plo5', 'sit');
    await flush();
    store.onAcceptedHand(row(59_000, 1, 2, day0 - 86_400_000));
    store.onAcceptedHand(hands[0]);
    store.onAcceptedHand(hands[2]);
    expect(store.profile(U(1), 'plo5')!.hands).toBe(3);
    const r = await store.reconcileDay('2027-01-14');
    expect(r).toEqual({ compared: 2, drifted: 2, repaired: 2 });
    expect(store.profile(U(1), 'plo5')!.hands).toBe(4);
    expect((await store.reconcileDay('2027-01-14')).drifted).toBe(0);
    expect(alerts).toEqual([
      ['OpponentHudDrift', true],
      ['OpponentHudDrift', false],
    ]);
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
