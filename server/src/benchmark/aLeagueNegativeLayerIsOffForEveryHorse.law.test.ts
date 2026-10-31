/**
 * LAW: A LAYER THE LEAGUE RESOLVES NEGATIVE IS OFF FOR EVERY HORSE (2026-10-31)
 *
 * Dan, 2026-10-09: a strategy pack is switched on for every horse when it
 * beats the current brain on its held-out contract; the audit switches a
 * default-off layer on only on a pooled-SIGNIFICANT positive league result.
 * The other side of the same rule: a layer the league pools significantly
 * NEGATIVE is switched off for every horse, and its matchup stays on the card
 * (arm A = layer on) so it keeps measuring whether it has earned its way back.
 *
 * The 2026-10-30 daily horse audit raised two critical
 * league_layer_negative_pooled findings:
 *
 *  - plo6_v24_price, -2.34 +/- 1.12 bb/100 over 7 runs (84,000 hands). The
 *    PLO6 CASH half of the V24 Omaha price defense is now default OFF
 *    (HorseLogic v24PloDefenseOn). PLO4 keeps it: plo4_v24_price pooled
 *    +3.43 +/- 0.89 over the same nights.
 *  - tuner_tightness_down, -2.40 +/- 1.07. A candidate dial move, never a
 *    live layer: no league-gated nudge has ever been applied (the class was
 *    never admitted). Admission now also refuses any direction the audit's
 *    7-day window resolves negative, and the audit reports a refused move as
 *    a refusal, not as a losing layer.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HorseLogic, v24PloDefenseOn } from '../engine/HorseLogic.js';
import { seedFastRandom } from '../engine/HorseEval.js';
import type { ActionRecord, Card, HandStage, SeatPlayer } from '../types.js';
import { LEAGUE_MATCHUPS } from './HorseLeague.js';
import { admittedDialMoves } from '../services/HorseTunerLeagueGate.js';

const MIGRATIONS = join(__dirname, '..', '..', '..', 'supabase', 'migrations');
const MIGRATION = readFileSync(
  join(
    MIGRATIONS,
    readdirSync(MIGRATIONS).find((f) =>
      f.startsWith('20261031200450_the_league_pools_measurements_only')
    )!
  ),
  'utf8'
);

const SUITS: Card['suit'][] = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS: Card['rank'][] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

function deal(seed: number, n: number): Card[] {
  const deck: Card[] = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ rank: r, suit: s });
  let x = seed >>> 0 || 1;
  for (let i = deck.length - 1; i > 0; i--) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    const j = x % (i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck.slice(0, n);
}

function seat(n: number, cards: Card[], bet = 0): SeatPlayer {
  return {
    seat: n,
    user_id: `horse-${n}`,
    username: `Horse${n}`,
    stack: 400 - bet,
    bet,
    totalInvested: bet,
    cards,
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
    is_horse: true,
  } as SeatPlayer;
}

/** Cash, the big blind facing a 4bb open from the button (bb = 2). */
function bigBlindDefence(variant: 'plo4' | 'plo6', seed: number, v24?: boolean): string {
  const holes = variant === 'plo6' ? 6 : 4;
  const cards = deal(seed, holes * 3);
  const hero = seat(3, cards.slice(0, holes), 2);
  const players = [
    seat(1, cards.slice(holes, holes * 2), 8),
    seat(2, cards.slice(holes * 2, holes * 3), 1),
    hero,
  ];
  players[1].is_folded = true;
  const gs = {
    players,
    communityCards: [] as Card[],
    pot: 11,
    currentBet: 8,
    minRaise: 6,
    lastRaise: 6,
    stage: 'preflop' as HandStage,
    gameVariant: variant,
    bigBlind: 2,
    dealerSeat: 1,
    gameMode: 'cash',
    format: 'cash',
    ante: 0,
    actionHistory: [
      { seat: 1, userId: 'horse-1', action: 'raise', amount: 8, timestamp: 1, stage: 'preflop' },
      { seat: 2, userId: 'horse-2', action: 'fold', amount: 0, timestamp: 2, stage: 'preflop' },
    ] as ActionRecord[],
  } as unknown as Parameters<(typeof HorseLogic)['decide']>[1];
  seedFastRandom(0x24 ^ seed);
  return HorseLogic.decide(
    hero,
    gs,
    'balanced',
    {},
    {
      mind: false,
      ...(v24 === undefined ? {} : { v24PloDefense: v24 }),
    }
  ).action;
}

describe('the PLO6 cash half of the V24 price defense is off for every horse', () => {
  it('defaults: off in PLO6 cash, on in PLO4/PLO5 and PLO6 tournaments; an explicit value decides', () => {
    expect(v24PloDefenseOn(undefined, 'plo6', false)).toBe(false);
    expect(v24PloDefenseOn(undefined, 'PLO6', false)).toBe(false);
    // The league deals cash only; the tournament half is unmeasured, not negative.
    expect(v24PloDefenseOn(undefined, 'plo6', true)).toBe(true);
    expect(v24PloDefenseOn(undefined, 'plo4', false)).toBe(true);
    expect(v24PloDefenseOn(undefined, 'plo5', false)).toBe(true);
    expect(v24PloDefenseOn(undefined, 'nlh', false)).toBe(true);
    expect(v24PloDefenseOn(true, 'plo6', false)).toBe(true);
    expect(v24PloDefenseOn(false, 'plo4', false)).toBe(false);
    expect(v24PloDefenseOn(false, 'plo6', true)).toBe(false);
  });

  it('a PLO6 cash horse with no option plays exactly the ablated brain, and the layer is real', () => {
    const seeds = Array.from({ length: 160 }, (_, i) => 6000 + i);
    const byDefault = seeds.map((s) => bigBlindDefence('plo6', s));
    const off = seeds.map((s) => bigBlindDefence('plo6', s, false));
    const on = seeds.map((s) => bigBlindDefence('plo6', s, true));
    expect(byDefault).toEqual(off);
    // The comparison has teeth: the relief changes some big-blind defences.
    expect(on.filter((a, i) => a !== off[i]).length).toBeGreaterThan(0);
  });

  it('a PLO4 horse with no option still plays the price defense', () => {
    const seeds = Array.from({ length: 160 }, (_, i) => 4000 + i);
    const byDefault = seeds.map((s) => bigBlindDefence('plo4', s));
    const on = seeds.map((s) => bigBlindDefence('plo4', s, true));
    const off = seeds.map((s) => bigBlindDefence('plo4', s, false));
    expect(byDefault).toEqual(on);
    expect(on.filter((a, i) => a !== off[i]).length).toBeGreaterThan(0);
  });

  it('keeps measuring: plo6_v24_price stays on the card with arm A = defense on', () => {
    const card = LEAGUE_MATCHUPS.find((m) => m.name === 'plo6_v24_price');
    expect(card).toBeDefined();
    expect(card!.variant).toBe('plo6');
    expect(card!.a).toEqual({ v24PloDefense: true });
    expect(card!.b).toEqual({});
    const plo4 = LEAGUE_MATCHUPS.find((m) => m.name === 'plo4_v24_price')!;
    expect(plo4.a).toEqual({});
    expect(plo4.b).toEqual({ v24PloDefense: false });
  });

  it('the audit reads a negative plo6_v24_price as the default confirmed, a positive as earned back', () => {
    expect(MIGRATION).toMatch(
      /'shortdeck_v23', 'v32_facing_defense', 'plo6_v24_price'\) then\s+-- Arm A runs a DEFAULT-OFF/
    );
    expect(MIGRATION).toContain("when 'plo6_v24_price' then 'v24PloDefense (PLO6)'");
    expect(MIGRATION).toMatch(
      /r\.matchup in \('shortdeck_v23', 'v32_facing_defense', 'plo6_v24_price'\) then\s+v := v \|\| jsonb_build_object\(\s+'severity', 'info', 'category', 'gto', 'code', 'flagged_experiment_earned_its_keep'/
    );
  });
});

describe('a tuner move the league resolves negative never reaches a horse', () => {
  it('a tightness-down proposal holds the dial unless tightness_down is admitted', () => {
    const before = { tightness: 1, aggression: 1, bluffFreq: 1 };
    const proposed = { tightness: 0.98, aggression: 1, bluffFreq: 0.98 };
    expect(admittedDialMoves(before, proposed, new Set())).toBeNull();
    expect(admittedDialMoves(before, proposed, new Set(['bluff_down', 'tightness_up']))).toEqual({
      mods: { tightness: 1, aggression: 1, bluffFreq: 0.98 },
      classes: ['bluff_down'],
    });
  });

  it('admission vetoes a direction the 7-day window resolves negative', () => {
    expect(MIGRATION).toContain(
      'CREATE OR REPLACE FUNCTION public.fn_horse_tuner_admitted_classes()'
    );
    expect(MIGRATION).toMatch(
      /WHERE NOT EXISTS \(\s+SELECT 1\s+FROM public\.fn_league_pooled\(\(now\(\) AT TIME ZONE 'utc'\)::date, 7\) p\s+WHERE p\.matchup = 'tuner_' \|\| q\.cls\s+AND p\.verdict = 'SIGNIFICANT'\s+AND p\.bb100 < 0/
    );
  });

  it('the audit calls a refused move a refusal, and critical only if a horse got it', () => {
    expect(MIGRATION).toMatch(/elsif r\.matchup like 'tuner\\_%' then/);
    expect(MIGRATION).toContain("'tuner_move_refused_by_league'");
    expect(MIGRATION).toContain("'tuner_refused_move_applied'");
    expect(MIGRATION).toMatch(
      /from horse_tuner_league_nudges n\s+where substr\(r\.matchup, 7\) = any\(n\.admitted_classes\)/
    );
    // Every other significant negative is still a critical losing layer.
    expect(MIGRATION).toContain("'code', 'league_layer_negative_pooled'");
  });

  it('pooling reads measurements only: no inert or refused zero is averaged in', () => {
    expect(MIGRATION).toMatch(
      /and r\.status = 'measured'\s+and r\.stderr::numeric > 0\s+and r\.hands > 0/
    );
  });
});
