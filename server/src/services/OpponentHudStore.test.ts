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
    await store.prewarm();
    expect(store.profile(U(1), 'plo5')!.hands).toBe(12);
    await store.catchUp(new Date(T0).toISOString());
    expect(store.profile(U(1), 'plo5')!.hands).toBe(12);
    // a player warmed after boot gets the caught-up hands from the ring
    store.warm([U(2)], 'plo5', 'sit');
    await flush();
    expect(store.profile(U(2), 'plo5')!.hands).toBe(2);
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
    expect(await store.prewarm()).toBeGreaterThanOrEqual(1);
    expect(store.ready(U(1), 'plo5')).toBe(true);
  });
});
