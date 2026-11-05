/**
 * LAW: every horse is assigned the Hybrid, and the Hybrid plays by game mode.
 * ═══════════════════════════════════════════════════════════════════════════
 * Owner direction (2026-11-05, verbatim): "YOU NEED TO HAVE CHANGED ALL 1000
 * HORSES TO THE NEW 'HYBRID' STYLE HORSE AND RETIRE ALL OTHER 'STYLES
 * ASSIGNED TO THOSE HORSES' AND ACTIVATE THE NEW 'HYBRID' TO ALL OF THEM."
 *
 * What this pins:
 *
 *   1. 'hybrid' is a real HorseStyle. resolveHorseStyle reads it as itself,
 *      never as the id-hash default, and keeps the row's dials and persona.
 *   2. Every live path that writes a style to a horse writes 'hybrid': the
 *      new-horse brain (createHorse), the completeness sweep
 *      (ensureHorseComplete) and the migration that moved the fleet. A retired
 *      style is kept under retiredStyle for history and is never reassigned.
 *   3. A 'hybrid' row resolves to exactly the mode profile a legacy row did:
 *      cash plays grinder (pebbles), tournaments play tricky (flint), the four
 *      dials and the reference-opening setting included, so the brain makes
 *      the same decision and the worker's execution receipts
 *      (hybrid_v1_cash_grinder_decided / hybrid_v1_tournament_tricky_decided)
 *      keep firing unchanged.
 *
 * The clock is pinned: the mood layer reads decisionTimeMs by the hour, so
 * every decision here runs at one fixed instant.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PINNED_CLOCK_MS = Date.UTC(2026, 10, 5, 15, 0, 0);

const h = vi.hoisted(() => {
  const state = {
    updates: [] as Array<{ table: string; payload: Record<string, unknown>; id: unknown }>,
  };
  function builder(table: string) {
    const call = { op: 'select', payload: undefined as unknown, id: undefined as unknown };
    const b: Record<string, unknown> = {};
    const chain = () => b;
    b.select = chain;
    b.order = chain;
    b.limit = chain;
    b.gt = chain;
    b.or = chain;
    b.is = chain;
    b.in = chain;
    b.eq = (col: string, v: unknown) => {
      if (col === 'id') call.id = v;
      return b;
    };
    b.update = (payload: Record<string, unknown>) => {
      call.op = 'update';
      call.payload = payload;
      return b;
    };
    b.insert = (payload: Record<string, unknown>) => {
      call.op = 'insert';
      call.payload = payload;
      return b;
    };
    b.maybeSingle = () => Promise.resolve({ data: null, error: null });
    b.single = () =>
      Promise.resolve({
        data:
          table === 'content_authors'
            ? { id: call.id, profile_id: call.id, avatar_url: null, is_active: true }
            : null,
        error: null,
      });
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
      if (call.op === 'update' && table === 'profiles') {
        state.updates.push({
          table,
          payload: call.payload as Record<string, unknown>,
          id: call.id,
        });
      }
      return Promise.resolve({ data: [], error: null }).then(res, rej);
    };
    return b;
  }
  return { state, supabase: { from: (t: string) => builder(t), auth: { admin: {} } } };
});

vi.mock('./supabase.js', () => ({ supabase: h.supabase }));
vi.mock('./errorReporter.js', () => ({ reportError: vi.fn() }));

import { brainFor, ensureHorseComplete } from './HorseOnboarding.js';
import { voiceFor } from './HorseTableTalk.js';
import { HorseLogic, resolveHorseStyle, type HorseGameStateV2 } from '../engine/HorseLogic.js';
import { seedFastRandom } from '../engine/HorseEval.js';
import {
  HORSE_HYBRID_PROFILES,
  HORSE_HYBRID_STYLE,
  horseHybridDecisionMatches,
  horseHybridModeStyle,
  resolveHorseHybridProfile,
} from '../engine/HorseHybridProfile.js';
import {
  HORSE_ASSIGNED_STYLE,
  RETIRED_HORSE_STYLES,
  type Card,
  type SeatPlayer,
} from '../types.js';

const ROOT = resolve(__dirname, '../../..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const MIGRATION_SLUG = 'all_horses_play_the_hybrid_style';

const RETIRED = ['tag', 'lag', 'balanced', 'tricky', 'grinder'] as const;
const LEGACY_ALIASES = ['reg', 'fish', 'nit', 'maniac', 'whale', 'shark'] as const;

/** 1,000 deterministic ids, the size of the live fleet. */
const FLEET = Array.from(
  { length: 1000 },
  (_, i) => `${i.toString(16).padStart(8, '0')}-4a1b-4c2d-8e3f-5a6b7c8d9e0f`
);

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(PINNED_CLOCK_MS);
});
afterAll(() => {
  vi.useRealTimers();
});

describe("'hybrid' is the assigned style and reads as itself", () => {
  it('the assigned style is hybrid and the five legacy styles are the retired set', () => {
    expect(HORSE_ASSIGNED_STYLE).toBe('hybrid');
    expect(HORSE_HYBRID_STYLE).toBe('hybrid');
    expect([...RETIRED_HORSE_STYLES]).toEqual([...RETIRED]);
    expect(RETIRED_HORSE_STYLES).not.toContain('hybrid');
  });

  it('resolveHorseStyle never turns hybrid into a default and keeps the dials', () => {
    for (const id of FLEET.slice(0, 100)) {
      const fallback = resolveHorseStyle({}, id).style;
      expect(resolveHorseStyle({ style: 'hybrid' }, id).style).toBe('hybrid');
      expect(resolveHorseStyle({ style: 'HYBRID' }, id).style).toBe('hybrid');
      expect(resolveHorseStyle('hybrid', id).style).toBe('hybrid');
      // The default for an empty row is still a deterministic read-time
      // choice; it is not what a hybrid row resolves to unless it happens to
      // be the same word, which it never is.
      expect(fallback).not.toBe('hybrid');
    }
    const r = resolveHorseStyle(
      {
        style: 'hybrid',
        retiredStyle: 'lag',
        tightness: 1.05,
        aggression: 0.9,
        bluffFreq: 1.1,
        sizingMultiplier: 0.95,
        persona: { straddleRate: 0.2 },
      },
      FLEET[3]
    );
    expect(r.style).toBe('hybrid');
    expect(r.mods.tightness).toBe(1.05);
    expect(r.mods.aggression).toBe(0.9);
    expect(r.mods.bluffFreq).toBe(1.1);
    expect(r.mods.sizingMultiplier).toBe(0.95);
    expect(r.mods.persona?.straddleRate).toBe(0.2);
  });
});

describe('every live assignment path writes hybrid', () => {
  it('a new horse brain is hybrid for all 1,000 ids, with no retired persona', () => {
    const styles = new Set<unknown>();
    for (const id of FLEET) {
      const b = brainFor(id, null);
      styles.add(b.style);
      expect(b.retiredStyle).toBeUndefined();
      for (const dial of ['tightness', 'aggression', 'bluffFreq', 'sizingMultiplier']) {
        expect(typeof b[dial]).toBe('number');
      }
    }
    expect([...styles]).toEqual(['hybrid']);
  });

  it('a horse still on a retired style or alias is moved to hybrid and keeps it for history', () => {
    for (const id of FLEET.slice(0, 50)) {
      for (const old of [...RETIRED, ...LEGACY_ALIASES]) {
        const fromObject = brainFor(id, { style: old, aggression: 1.02, tightness: 0.97 });
        expect(fromObject.style).toBe('hybrid');
        expect(fromObject.retiredStyle).toBe(old);
        expect(fromObject.aggression).toBe(1.02);
        expect(fromObject.tightness).toBe(0.97);
        const fromString = brainFor(id, old);
        expect(fromString.style).toBe('hybrid');
        expect(fromString.retiredStyle).toBe(old);
      }
      // Already hybrid: the earlier retirement is kept, never overwritten.
      const kept = brainFor(id, { style: 'hybrid', retiredStyle: 'tricky', aggression: 1 });
      expect(kept.style).toBe('hybrid');
      expect(kept.retiredStyle).toBe('tricky');
    }
  });

  it('the completeness sweep writes hybrid over a retired style and never a retired style', async () => {
    h.state.updates = [];
    const row = {
      id: FLEET[7],
      display_name: 'Pebble Stone',
      username: 'pebblestone',
      alias: 'Pebbles',
      player_number: 100007,
      ['avatar_url']: null,
      is_vip: true,
      vip_tier: 'lifetime',
      horse_profile: { style: 'grinder', aggression: 1.1, tightness: 1.0, bluffFreq: 0.95 },
      status: 'active',
      horse_status: 'available',
    };
    const fixed = await ensureHorseComplete(row as never);
    expect(fixed).toContain('hybrid-style');
    const write = h.state.updates.find((u) => u.id === FLEET[7] && 'horse_profile' in u.payload);
    expect(write).toBeDefined();
    const written = write!.payload.horse_profile as Record<string, unknown>;
    // Only the style moves; the dials the horse learned are exactly as stored.
    expect(written).toEqual({
      style: 'hybrid',
      retiredStyle: 'grinder',
      aggression: 1.1,
      tightness: 1.0,
      bluffFreq: 0.95,
    });

    // A horse already on the Hybrid with its dials is left alone.
    h.state.updates = [];
    const done = await ensureHorseComplete({
      ...row,
      horse_profile: { ...written },
    } as never);
    expect(done).not.toContain('hybrid-style');
    expect(done).not.toContain('brain');
    expect(h.state.updates.filter((u) => 'horse_profile' in u.payload)).toEqual([]);

    // A learned brain with dials and no style key is not an assigned style:
    // the sweep leaves it exactly as it is (replay and CAS laws depend on it).
    h.state.updates = [];
    const learned = await ensureHorseComplete({
      ...row,
      horse_profile: { aggression: 0.91, learned: 'retained' },
    } as never);
    expect(learned).not.toContain('hybrid-style');
    expect(learned).not.toContain('brain');
    expect(h.state.updates.filter((u) => 'horse_profile' in u.payload)).toEqual([]);

    // Nothing the sweep ever wrote names a retired style as the style.
    for (const u of h.state.updates) {
      const p = u.payload.horse_profile as Record<string, unknown> | undefined;
      if (p) expect(RETIRED).not.toContain(p.style);
    }
  });

  it('the onboarding source no longer carries the retired-style draw', () => {
    const src = readFileSync(join(ROOT, 'server/src/services/HorseOnboarding.ts'), 'utf8');
    expect(src).not.toMatch(/\[\s*'tag',\s*'lag',\s*'balanced',\s*'tricky',\s*'grinder'\s*\]/);
    expect(src).toContain('HORSE_ASSIGNED_STYLE');
  });

  it('the fleet migration sets every horse row to hybrid and records the retired style', () => {
    const file = readdirSync(MIGRATIONS).find((f) => f.endsWith(`_${MIGRATION_SLUG}.sql`));
    expect(file, `supabase/migrations/*_${MIGRATION_SLUG}.sql must exist`).toBeDefined();
    const sql = readFileSync(join(MIGRATIONS, file!), 'utf8');
    expect(sql).toMatch(/^\s*BEGIN\s*;/im);
    expect(sql.trim()).toMatch(/COMMIT\s*;$/i);
    expect(sql).toMatch(/^-- @live-proof: /m);
    expect(sql).toContain("'{style}'");
    expect(sql).toContain('"hybrid"');
    expect(sql).toContain('retiredStyle');
    expect(sql).toMatch(/is_horse\s+IS\s+TRUE/i);
    // Only the profiles horse rows and only that key: no other table, no DDL.
    expect(sql).not.toMatch(/\b(CREATE|ALTER|DROP)\s+(TABLE|FUNCTION|INDEX|TRIGGER|TYPE)\b/i);
    expect(sql).not.toMatch(/^\s*UPDATE\s+(?!public\.profiles\b)/im);
  });
});

describe('a hybrid row plays the mode profile a legacy row played', () => {
  const dials = { tightness: 1.5, aggression: 0.6, bluffFreq: 1.4, sizingMultiplier: 1.5 };

  it('cash resolves to grinder/pebbles and tournament to tricky/flint, dial for dial', () => {
    expect(horseHybridModeStyle('cash')).toBe('grinder');
    expect(horseHybridModeStyle('tournament')).toBe('tricky');
    for (const mode of ['cash', 'tournament'] as const) {
      const expected = HORSE_HYBRID_PROFILES[mode];
      for (const id of FLEET.slice(0, 200)) {
        for (const retired of RETIRED) {
          const hybridRow = resolveHorseHybridProfile(
            { style: 'hybrid', retiredStyle: retired, ...dials },
            id,
            mode
          );
          const legacyRow = resolveHorseHybridProfile({ style: retired, ...dials }, id, mode);
          expect(hybridRow.style).toBe(expected.style);
          expect(hybridRow).toEqual(legacyRow);
          expect(horseHybridDecisionMatches(mode, hybridRow.style, hybridRow.mods)).toBe(true);
        }
      }
    }
  });

  it('the brain makes the same decision for a hybrid row as for its retired row, at one pinned clock', () => {
    for (const mode of ['cash', 'tournament'] as const) {
      for (let seed = 1; seed <= 12; seed++) {
        for (const retired of RETIRED) {
          const a = decideFirstIn(mode, seed, { style: 'hybrid', retiredStyle: retired, ...dials });
          const b = decideFirstIn(mode, seed, { style: retired, ...dials });
          expect(a).toEqual(b);
          expect(['fold', 'call', 'raise', 'check']).toContain(a.action);
        }
      }
    }
  });

  it('the voice is persona: a hybrid row keeps the voice of what it retired', () => {
    expect(voiceFor({ style: 'hybrid', retiredStyle: 'grinder' }, FLEET[1])).toBe('quiet');
    expect(voiceFor({ style: 'hybrid', retiredStyle: 'lag' }, FLEET[1])).toBe('needler');
    expect(voiceFor({ style: 'hybrid', retiredStyle: 'balanced' }, FLEET[1])).toBe('friendly');
    expect(voiceFor({ style: 'hybrid' }, FLEET[1])).toBe('friendly');
  });
});

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const SUITS = ['s', 'h', 'd', 'c'];

/** Hero first in from the cutoff of a six-handed table; the decision only. */
function decideFirstIn(
  mode: 'cash' | 'tournament',
  seed: number,
  profile: Record<string, unknown>
): { action: string; amount: number | undefined } {
  const BB = 100;
  const n = 6;
  const heroSeat = 5;
  const deck: Card[] = [];
  for (const r of RANKS) for (const su of SUITS) deck.push({ rank: r, suit: su } as Card);
  // A fixed shuffle per seed so both rows see the same cards.
  let x = seed * 2654435761;
  for (let i = deck.length - 1; i > 0; i--) {
    x = (Math.imul(x ^ (x >>> 15), 2246822519) + 0x9e3779b9) >>> 0;
    const j = x % (i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const players: SeatPlayer[] = [];
  for (let seat = 1; seat <= n; seat++) {
    const bet = seat === 1 ? BB / 2 : seat === 2 ? BB : 0;
    players.push({
      seat,
      user_id: `law-${seat}`,
      username: `Law${seat}`,
      stack: 100 * BB - bet,
      bet,
      totalInvested: bet,
      cards: [deck[seat * 2], deck[seat * 2 + 1]],
      is_folded: seat === 3 || seat === 4,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: true,
    } as SeatPlayer);
  }
  const gs = {
    players,
    communityCards: [],
    pot: 1.5 * BB,
    currentBet: BB,
    minRaise: BB,
    lastRaise: BB,
    stage: 'preflop',
    gameVariant: 'nlh',
    bigBlind: BB,
    dealerSeat: n,
    actionHistory: [
      { seat: 3, userId: 'law-3', action: 'fold', amount: 0, timestamp: 100, stage: 'preflop' },
      { seat: 4, userId: 'law-4', action: 'fold', amount: 0, timestamp: 101, stage: 'preflop' },
    ],
    gameMode: mode,
    ante: 0,
    bigBlindAnte: false,
    format: mode === 'cash' ? 'cash' : 'mtt',
  } as unknown as HorseGameStateV2;
  const hero = players[heroSeat - 1];
  const selected = resolveHorseHybridProfile(profile, hero.user_id, mode);
  seedFastRandom((seed * 7919 + (mode === 'cash' ? 1 : 2)) >>> 0);
  const d = HorseLogic.decide(hero, gs, selected.style, selected.mods, {
    mind: false,
    telemetry: false,
    decisionTimeMs: PINNED_CLOCK_MS,
  } as never);
  return { action: d.action, amount: d.amount };
}
