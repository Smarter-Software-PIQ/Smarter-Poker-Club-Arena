/**
 * THE HIGH-STAKE HOLD'EM RELOAD BELONGS TO THREE ARCHETYPES, NOT FOUR.
 *
 * `HorseSessionRotator` reloads a cash Horse that has fallen under 45% of the
 * table's reference buy-in. At a dollar-equivalent big blind of 5 or more, a
 * Hold'em Horse whose `holdemPersonaFor` archetype is lag_shark, tricky_trap
 * or tag_crusher reloads earlier, under 80%. A nit_hunter keeps the ordinary
 * 45% rule, and under a big blind of 5 every archetype keeps it.
 *
 * Before this file the only Hold'em witness was one tag_crusher seat inside
 * the PLO suite, chosen with the PLO resolver. Nothing pinned the Hold'em
 * resolver, the tricky_trap member of the set, the nit_hunter exclusion or the
 * stake boundary, so any of them could change without a red test.
 *
 * Not covered here: Diamond tables (chip big blind divided by 100), which also
 * read Diamond custody; the wallet and exposure bounds, which
 * `HorseBankroll.test.ts` and `HorseBankrollWiring.test.ts` own.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { holdemPersonaFor, ploPersonaFor } from '../engine/HorsePersona.js';
import { HorseSessionRotator, type RotatorEngine } from './HorseSessionRotator.js';
import { supabase } from './supabase.js';

type Archetype = 'lag_shark' | 'tricky_trap' | 'tag_crusher' | 'nit_hunter';

/**
 * The Hold'em and PLO resolvers disagree on most ids. Each Horse here is
 * chosen so that reading the PLO archetype for a Hold'em seat would give the
 * opposite reload answer, which is what makes the resolver itself part of the
 * assertion.
 */
function holdemHorse(target: Archetype, ploMustBeNit: boolean): string {
  for (let i = 1; i <= 2000; i++) {
    const id = `87000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
    if (holdemPersonaFor(id).archetype !== target) continue;
    if ((ploPersonaFor(id).archetype === 'nit_hunter') !== ploMustBeNit) continue;
    return id;
  }
  throw new Error(`No Horse found for Hold'em archetype ${target}`);
}

const LAG = holdemHorse('lag_shark', true);
const TRICKY = holdemHorse('tricky_trap', true);
const TAG = holdemHorse('tag_crusher', true);
const NIT = holdemHorse('nit_hunter', false);
const ALL = [LAG, TRICKY, TAG, NIT];
const CLUB = '00000000-0000-0000-0000-000000000000';
const NOW = Date.parse('2026-11-12T16:00:00Z');

function table(id: string, bigBlind: number, minBuyIn: number, maxBuyIn: number) {
  return {
    id,
    game_variant: 'nlh',
    big_blind: bigBlind,
    small_blind: bigBlind / 2,
    min_buy_in: minBuyIn,
    max_buy_in: maxBuyIn,
    tournament_id: null,
    status: 'running',
    settings: {},
    cluster_id: null,
    lifecycle: 'live',
    created_at: new Date(NOW - 3_600_000).toISOString(),
    max_players: 9,
    is_deleted: false,
  };
}

function seat(t: ReturnType<typeof table>, userId: string, seatNumber: number, stack: number) {
  return {
    id: `seat-${t.id}-${seatNumber}`,
    table_id: t.id,
    user_id: userId,
    seat_number: seatNumber,
    stack,
    joined_at: new Date(NOW - 45 * 60_000).toISOString(),
    club_id: CLUB,
    leave_pending: false,
    is_sitting_out: false,
    left_at: null,
    auto_rebuy: false,
    tables: t,
  };
}

async function rotateOnce(
  tables: ReturnType<typeof table>[],
  seats: ReturnType<typeof seat>[]
): Promise<Record<string, ReturnType<typeof vi.fn>>> {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  for (const m of ['log', 'warn', 'error'] as const)
    vi.spyOn(console, m).mockImplementation(() => {});
  // Under TOPUP_PROB, so the reload decision is the stack rule alone.
  vi.spyOn(Math, 'random').mockReturnValue(0.1);

  const db: Record<string, Record<string, unknown>[]> = {
    table_seats: seats,
    profiles: ALL.map((id) => ({ id, is_horse: true, diamonds: 200_000 })),
    club_members: ALL.map((id) => ({ club_id: CLUB, user_id: id, chip_balance: 200_000 })),
    chip_ledger: [],
    table_waitlist: [],
    cash_game_waitlist: [],
    cash_games: [],
    cash_seat_moves: [],
    hand_history: [],
    tournament_players: [],
    tables,
  };
  vi.spyOn(supabase, 'from').mockImplementation(((name: string) => {
    let rows = [...(db[name] ?? [])];
    let lim = Infinity;
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (c: string, v: unknown) => ((rows = rows.filter((r) => r[c] === v)), b),
      in: (c: string, v: unknown[]) => ((rows = rows.filter((r) => v.includes(r[c]))), b),
      is: (c: string, v: unknown) => ((rows = rows.filter((r) => (r[c] ?? null) === v)), b),
      gt: () => b,
      gte: () => b,
      lte: () => b,
      not: () => b,
      order: () => b,
      limit: (n: number) => ((lim = n), b),
      range: () => b,
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
        Promise.resolve({ data: rows.slice(0, lim), error: null }).then(ok, bad),
    };
    return b;
  }) as never);
  vi.spyOn(supabase, 'rpc').mockImplementation((() =>
    Promise.resolve({ data: null, error: { message: 'none' } })) as never);

  const addChips: Record<string, ReturnType<typeof vi.fn>> = {};
  const engines: Record<string, RotatorEngine> = {};
  for (const t of tables) {
    addChips[t.id] = vi.fn(async () => ({ success: true }));
    engines[t.id] = {
      leaveTable: vi.fn(() => ({ success: true })),
      sitOut: vi.fn(() => ({ success: true })),
      addChips: addChips[t.id],
      hitRunHandsOwed: () => 5,
      isClientSitOut: () => false,
    } as unknown as RotatorEngine;
  }
  const rotator = new HorseSessionRotator((tid) => engines[tid]) as unknown as {
    isRunning: boolean;
    lifecycleGeneration: number;
    rotate(gen: number): Promise<void>;
  };
  rotator.isRunning = true;
  rotator.lifecycleGeneration = 1;
  await rotator.rotate(1);
  vi.useRealTimers();
  return addChips;
}

function reloaded(fn: ReturnType<typeof vi.fn>): string[] {
  return fn.mock.calls.map((c) => String(c[0])).sort();
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the high-stake Hold'em reload is for three archetypes", () => {
  it("finds one Horse of each archetype with the Hold'em resolver", () => {
    expect(new Set(ALL).size).toBe(4);
    expect(holdemPersonaFor(LAG).archetype).toBe('lag_shark');
    expect(holdemPersonaFor(TRICKY).archetype).toBe('tricky_trap');
    expect(holdemPersonaFor(TAG).archetype).toBe('tag_crusher');
    expect(holdemPersonaFor(NIT).archetype).toBe('nit_hunter');
    for (const id of [LAG, TRICKY, TAG]) expect(ploPersonaFor(id).archetype).toBe('nit_hunter');
    expect(ploPersonaFor(NIT).archetype).not.toBe('nit_hunter');
  });

  it('at a big blind of 5, lag_shark, tricky_trap and tag_crusher reload from 70% and nit_hunter does not', async () => {
    // Reference buy-in 500: 350 is under 80% (400) and over 45% (225).
    const t = table('nlh-5', 5, 200, 500);
    const addChips = await rotateOnce(
      [t],
      ALL.map((id, i) => seat(t, id, i + 1, 350))
    );
    expect(reloaded(addChips[t.id])).toEqual([LAG, TRICKY, TAG].sort());
    for (const call of addChips[t.id].mock.calls) expect(call[1]).toBe(150);
  });

  it('at a big blind of 2, no archetype reloads from 70%', async () => {
    // Reference buy-in 200: 140 is under 80% (160) and over 45% (90).
    const t = table('nlh-2', 2, 80, 200);
    const addChips = await rotateOnce(
      [t],
      ALL.map((id, i) => seat(t, id, i + 1, 140))
    );
    expect(addChips[t.id]).not.toHaveBeenCalled();
  });

  it('a nit_hunter still reloads under the ordinary 45% rule at a big blind of 5', async () => {
    // 200 is under 45% of 500 (225): the exclusion is from the early reload only.
    const t = table('nlh-5-short', 5, 200, 500);
    const addChips = await rotateOnce([t], [seat(t, NIT, 1, 200)]);
    expect(reloaded(addChips[t.id])).toEqual([NIT]);
    expect(addChips[t.id].mock.calls[0][1]).toBe(300);
  });
});
