/**
 * OPPONENT HUD AND LIGHTNING (2026-11-21, lane OPPONENT-HUD-5). Owner order: every Horse has every opponent's
 * lifetime public history within 15 seconds of a player joining a table, "Lightning re-seats, conversions and table
 * moves too", and the helpers never miscount.
 *
 * A Lightning hand is a new table every hand (LightningHandHost), and a cluster of tables CONVERTS into a Lightning
 * pool (MUST_MOVE -> LIGHTNING) and can fall back. Two laws:
 *  1. THE CONVERSION: the players of the converting tables and a newcomer of the pool are all ready within 15 seconds
 *     of the first Lightning hand's seat event, however slow the database is inside that bound, the first Lightning
 *     decision carries every one of them, and a fall-back to tables finds them still ready.
 *  2. EVERY LIGHTNING HAND IS COUNTED: a Lightning hand's row never passes through logHandHistory (the classic
 *     tables' door, where the store was fed), so the Lightning settlement door feeds the store itself, once, with the
 *     row as stored. Before this file the live profiles missed every Lightning hand until a restart read them back.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { drainFires, enableBrainTelemetry } from '../engine/BrainTelemetry.js';
import {
  HUD_READY_DEADLINE_MS,
  HUD_RETRY_MS,
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
/** the row LightningHandHost.handRow builds (no id, no created_at: the settlement answers the id) */
function lightningRow(users: number[], at: number) {
  return {
    table_id: 'host',
    tournament_id: null,
    hand_number: 1,
    game_variant: 'plo5',
    small_blind: 1,
    big_blind: 2,
    community_cards: [],
    community_cards2: null,
    bomb_pot: null,
    rit_boards: null,
    started_at: new Date(at - 20_000).toISOString(),
    ended_at: new Date(at).toISOString(),
    winners: [{ userId: U(users[0]), amount: 8 }],
    showdown: [],
    players: users.map((u, i) => ({
      userId: U(u),
      username: `p${u}`,
      seat: i + 1,
      stack: 400,
      cards: [],
    })),
    actions: [
      { seat: 1, userId: U(users[0]), stage: 'preflop', action: 'sb', amount: 1 },
      { seat: 2, userId: U(users[1]), stage: 'preflop', action: 'bb', amount: 2 },
      ...users.slice(2).map((u, i) => ({
        seat: i + 3,
        userId: U(u),
        stage: 'preflop',
        action: 'fold',
        amount: 0,
      })),
      { seat: 1, userId: U(users[0]), stage: 'preflop', action: 'raise', amount: 6 },
      { seat: 2, userId: U(users[1]), stage: 'preflop', action: 'fold', amount: 0 },
    ],
  };
}
function lifetime(user: number, n: number): HudStoredRow {
  const p = emptyHudProfile(U(user), 'plo5');
  for (let i = 0; i < n; i++)
    applyHudHand(
      p,
      handRecordFromRow({
        ...lightningRow([user, 99], T0 - 86_400_000 + i * 1000),
        id: H(10_000 + user * 100 + i),
      }) as HudHandRecord
    );
  return {
    user_id: U(user),
    family: 'plo5',
    version: 1,
    hands: p.hands,
    wm_ms: p.wm,
    rev: 1,
    profile: p,
  };
}
function world(readMs: number) {
  const stored = new Map<string, HudStoredRow>();
  let now = T0;
  const deps: OpponentHudStoreDeps & { tick(ms: number): void } = {
    async read(ids, family) {
      now += readMs; // the database answers this slowly
      return ids.flatMap((u) => {
        const r = stored.get(`${family}|${u}`);
        return r ? [structuredClone(r)] : [];
      });
    },
    recent: async () => [],
    upsert: async () => [],
    now: () => now,
    tick(ms) {
      now += ms;
    },
  };
  return { stored, deps };
}
const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};
const packet = (store: OpponentHudStore, hero: number, opps: number[], atMs: number) =>
  store.packetFor({
    family: 'plo5',
    cash: true,
    heroId: U(hero),
    opponentIds: opps.map(U),
    street: 'preflop',
    atMs,
  });

describe('Opponent HUD: a Lightning conversion', () => {
  it('tables convert to a Lightning pool: every participant of the first Lightning hand is ready within 15 seconds, the newcomer too', async () => {
    enableBrainTelemetry();
    const { stored, deps } = world(4_000);
    for (const u of [1, 2, 3, 4, 5, 6, 7]) stored.set(`plo5|${U(u)}`, lifetime(u, 30 + u));
    const store = new OpponentHudStore(deps);
    store.setArmed(true);
    await flush();
    // two classic tables of the cluster; the players sat down two hours ago
    store.warm([1, 2, 3].map(U), 'plo5', 'sit');
    store.warm([4, 5, 6].map(U), 'plo5', 'sit');
    await flush();
    deps.tick(2 * 3600_000);
    drainFires();
    // THE CONVERSION: the first Lightning hand seats players of both tables and a newcomer of the pool (7), and the
    // database takes 4 seconds to answer
    const askedAt = deps.now();
    store.warm([1, 4, 5, 7, 2, 6].map(U), 'plo5', 'lightning');
    for (const u of [1, 4, 5, 2, 6]) expect(store.ready(U(u), 'plo5')).toBe(true); // never taken away meanwhile
    await flush();
    expect(deps.now() - askedAt).toBeLessThanOrEqual(HUD_READY_DEADLINE_MS);
    for (const u of [1, 4, 5, 7, 2, 6]) expect(store.ready(U(u), 'plo5')).toBe(true);
    expect(store.profile(U(7), 'plo5')!.hands).toBe(37);
    const pk = packet(store, 1, [4, 5, 7, 2, 6], deps.now()).opponentHud!;
    for (const u of [4, 5, 7, 2, 6]) expect(pk.opp[U(u)]).toBeDefined();
    const fires = drainFires().map((f) => f.feature);
    expect(fires).toContain('opponent_hud_event_lightning');
    // one read of 4 s for the newcomer (a second one re-reads the players cached two hours ago; they stay ready)
    expect(fires.some((f) => /^opponent_hud_ready_lightning_ms_(le5000|le15000)$/.test(f))).toBe(
      true
    );
    expect(fires.some((f) => /packet_opponent_(missing|late)/.test(f))).toBe(false);
    expect(fires.some((f) => /ready_.*_ms_gt15000/.test(f))).toBe(false);
    // the Lightning hand is settled: its row, as the settlement door hands it over, counts once for every participant
    const row = { ...lightningRow([1, 4, 5, 7, 2, 6], deps.now()), id: H(1) };
    expect(store.onAcceptedHand(row)).toBe(6);
    expect(store.onAcceptedHand(structuredClone(row))).toBe(0);
    expect(store.profile(U(7), 'plo5')!.hands).toBe(38);
    // RE-SEAT: the next Lightning hand is another table (3 joins); then the pool FALLS BACK to tables
    store.warm([7, 3, 1].map(U), 'plo5', 'lightning');
    store.warm([1, 2, 3].map(U), 'plo5', 'sit');
    store.warm([1, 2, 3].map(U), 'plo5', 'hand');
    await flush();
    for (const u of [1, 2, 3, 7]) expect(store.ready(U(u), 'plo5')).toBe(true);
    expect(store.profile(U(1), 'plo5')!.hands).toBe(32);
  });

  it('a conversion while the database is down: the Lightning hand is dealt on the population read, counted late after 15 seconds, and loaded on recovery', async () => {
    enableBrainTelemetry();
    const { stored, deps } = world(0);
    stored.set(`plo5|${U(7)}`, lifetime(7, 12));
    let down = true;
    const read = deps.read.bind(deps);
    deps.read = async (ids, family, signal) => {
      if (down && !ids.includes('*')) throw new Error('down');
      return read(ids, family, signal);
    };
    const store = new OpponentHudStore(deps);
    store.setArmed(true);
    await flush();
    drainFires();
    expect(() => store.warm([U(7)], 'plo5', 'lightning')).not.toThrow();
    await flush();
    expect(packet(store, 1, [7], deps.now()).opponentHud!.opp[U(7)]).toBeUndefined();
    deps.tick(HUD_READY_DEADLINE_MS + 1);
    packet(store, 1, [7], deps.now());
    expect(drainFires().map((f) => f.feature)).toContain('opponent_hud_packet_opponent_late');
    down = false;
    deps.tick(HUD_RETRY_MS + 1); // a failed load is asked again after HUD_RETRY_MS
    store.warm([U(7)], 'plo5', 'lightning'); // the next Lightning hand
    await flush();
    expect(store.profile(U(7), 'plo5')!.hands).toBe(12);
  });

  it('the Lightning settlement door feeds the store once per accepted hand, with the row as stored', () => {
    const code = (rel: string) =>
      readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
    const backend = code('lightning/LightningHandBackend.ts');
    // after the settlement answered ok with the hand_history id, beside the hand's other once-only count
    expect(backend).toMatch(
      /if \(!isUuid\(id\)\) return \{[^}]*\};[\s\S]{0,900}?countStoredHandMemoryDomain\(a\.handRow, 'lightning'\);[\s\S]{0,700}?opponentHudOnAcceptedHand\(\{ \.\.\.a\.handRow, id \}\);/
    );
    expect(backend.match(/opponentHudOnAcceptedHand\(/g)!.length).toBe(1);
    // the classic door stays the only other one
    expect(
      code('services/supabase/handHistory.ts').match(/opponentHudOnAcceptedHand\(/g)!.length
    ).toBe(1);
    // and the row the Lightning host builds is one the profile builder reads (ended_at, players by userId and seat)
    const rec = handRecordFromRow({ ...lightningRow([1, 2, 3], T0), id: H(5) });
    expect(typeof rec).toBe('object');
    expect((rec as HudHandRecord).at).toBe(T0);
    expect((rec as HudHandRecord).seats.map((s) => s.userId)).toEqual([U(1), U(2), U(3)]);
  });
});
