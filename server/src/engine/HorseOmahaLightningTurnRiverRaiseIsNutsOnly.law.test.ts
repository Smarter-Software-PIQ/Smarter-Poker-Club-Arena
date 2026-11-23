/**
 * LAW (PLO-OWNER lead-5, Turn 5b, 2026-11-22): omahaTurnRiverRaiseIsPricedInLightning is NUTS ONLY. Owner
 * ruling 2026-11-15 12:52: on the turn and the river facing a bet, a hand that is not the nuts folds or at
 * best calls; it never raises.
 *
 * In a Lightning PLO4/PLO5 cash pool, through the whole decision (HorseLogic.decide), with
 * omahaTurnRiverRaiseIsPriced on:
 *  1. switching omahaTurnRiverRaiseIsPricedInLightning ON never makes a hand that is not nut class
 *     (omahaNutClassNow, the classifier of omahaTurnRiverRaiseNeedsNuts and omahaRiverNutRaiseOnly) raise
 *     where it did not raise with the option OFF, and never raises more non-nut hands than OFF;
 *  2. with the option ON no non-nut hand raises a turn or river bet at all;
 *  3. a non-nut raise that is stopped becomes a call or a fold, never a bigger wager;
 *  4. the rule function itself: a non-nut call or fold is returned as it came, and a non-nut raise handed to
 *     it comes back as a call or a fold;
 *  5. the shadow stage re-decides the option only in a Lightning pool.
 * Before Turn 5b the option opened Lightning to a rule that raises "with any hand" on price: on the recorded
 * turn spot below it took non-nut raises from 34 to 58 of 135 hands.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Card, CardRank, CardSuit, HorseDecision } from '../types.js';
import { replayProfiles, stateAt, type ComplaintFixture } from './HorseComplaintReplay.js';
import { seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { omahaNutClassNow } from './HorseOmahaMadeHandDefense.js';
import { LIVE_OPTIONS, pricedSpot } from './HorseOmahaPricedRules.test-support.js';
import { omahaPricedTurnRiverRaiseRule } from './HorseOmahaPricedWiring.js';
import { OPTION_SHADOW_STAGE, optionShadowStageInScope } from './HorseOptionShadowStage.js';

const FX = JSON.parse(
  readFileSync(
    new URL(
      './horseComplaints/plo5-top-two-pair-jams-over-a-turn-bet-on-the-straight-card.fixture.json',
      import.meta.url
    ),
    'utf8'
  )
) as ComplaintFixture;
const LIVE = replayProfiles('cash').find((p) => p.live)!;
const SUIT: Record<string, CardSuit> = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' };
const RANKS = '23456789TJQKA';
const SUITS = 'shdc';
const cards = (str: string): Card[] =>
  (str.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: SUIT[x[1]!]! }));
const lightning = <T extends { gs: object }>(st: T): T => {
  (st.gs as { publicMemoryDomain?: object }).publicMemoryDomain = {
    version: 1,
    speed: 'lightning',
    ante: 'bb',
  };
  return st;
};
/** A seeded hand of `n` cards that avoids `used` (card keys rank+suit letter). */
const handOf = (seed: number, n: number, used: Set<string>): string => {
  let x = (seed * 2654435761) >>> 0;
  const hole: string[] = [];
  const taken = new Set(used);
  while (hole.length < n) {
    x = (x * 1664525 + 1013904223) >>> 0;
    const c = RANKS[(x >>> 8) % 13]! + SUITS[(x >>> 20) % 4]!;
    if (taken.has(c)) continue;
    taken.add(c);
    hole.push(c);
  }
  return hole.join('');
};
const LETTER: Record<string, string> = { spades: 's', hearts: 'h', diamonds: 'd', clubs: 'c' };
/** The recorded PLO5 turn spot (the Horse faces a turn bet), with a seeded hand, in a Lightning pool. */
const recordedTurnSpot = (seed: number) => {
  const copy = JSON.parse(JSON.stringify(FX)) as ComplaintFixture;
  const node = copy.actions.find((a) => a.ord === 19)!;
  const st0 = stateAt(JSON.parse(JSON.stringify(FX)), node);
  const used = new Set<string>((st0.gs.communityCards ?? []).map((c) => c.rank + LETTER[c.suit]!));
  for (const k of Object.keys(copy.hole))
    if (k !== String(node.seat))
      for (const c of copy.hole[k] as Card[]) used.add(c.rank + LETTER[c.suit]!);
  copy.hole[String(node.seat)] = cards(handOf(seed, 5, used));
  return lightning(stateAt(copy, node));
};
/** A heads-up turn or river spot facing a bet, in a Lightning pool. */
const builtSpot = (seed: number, board: string, n: 4 | 5, inPosition: boolean, bet: number) => {
  const used = new Set(board.match(/../g) ?? []);
  const st = pricedSpot({ hole: handOf(seed, n, used), board, potBefore: 200, bet, inPosition });
  const now = lightning(st.fresh());
  if (n === 4) (now.gs as { gameVariant: string }).gameVariant = 'plo4';
  return now;
};
const BASE: HorseDecideOpts = { ...LIVE_OPTIONS, omahaTurnRiverRaiseIsPriced: true };
const ON: HorseDecideOpts = { ...BASE, omahaTurnRiverRaiseIsPricedInLightning: true };
const decide = (make: () => ReturnType<typeof recordedTurnSpot>, opts: HorseDecideOpts) => {
  const st = make();
  HorseMind.reset();
  seedFastRandom(7);
  const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
    observeMind: false,
    decisionTimeMs: 1794938400000,
    ...opts,
  } as never) as HorseDecision;
  return { d, nut: omahaNutClassNow(st.hero, st.gs), st };
};
const raised = (d: HorseDecision) => d.action === 'raise' || d.action === 'all_in';

interface Tally {
  hands: number;
  nonNut: number;
  offRaises: number;
  onRaises: number;
  newRaises: string[];
  bigger: string[];
}
const tally = (makes: Array<[string, () => ReturnType<typeof recordedTurnSpot>]>): Tally => {
  const t: Tally = { hands: 0, nonNut: 0, offRaises: 0, onRaises: 0, newRaises: [], bigger: [] };
  for (const [label, make] of makes) {
    const off = decide(make, BASE);
    const on = decide(make, ON);
    t.hands++;
    if (on.nut) continue;
    t.nonNut++;
    if (raised(off.d)) t.offRaises++;
    if (raised(on.d)) {
      t.onRaises++;
      if (!raised(off.d)) t.newRaises.push(label);
    }
    // a stopped raise is a call or a fold: never a bet, never more chips than the call
    if (raised(off.d) && !raised(on.d) && on.d.action !== 'call' && on.d.action !== 'fold')
      t.bigger.push(`${label}:${on.d.action}`);
  }
  return t;
};
const lawOf = (t: Tally, minNonNut: number) => {
  expect(t.nonNut).toBeGreaterThanOrEqual(minNonNut);
  expect(t.newRaises).toEqual([]);
  expect(t.onRaises).toBeLessThanOrEqual(t.offRaises);
  expect(t.onRaises).toBe(0);
  expect(t.bigger).toEqual([]);
};

describe('LAW: omahaTurnRiverRaiseIsPricedInLightning never lets a non-nut hand raise a turn or river bet', () => {
  it('the recorded PLO5 turn spot, 150 seeded hands: option ON never adds a non-nut raise and leaves none', () => {
    const makes: Array<[string, () => ReturnType<typeof recordedTurnSpot>]> = [];
    for (let h = 1; h <= 150; h++) makes.push([`recorded-turn#${h}`, () => recordedTurnSpot(h)]);
    lawOf(tally(makes), 100);
  });

  for (const [name, board] of [
    ['turn', 'Qh9h3d5c'],
    ['river', 'Qh9h3d5c2s'],
    ['paired river', 'Td8h4cTs7d'],
  ] as const)
    for (const n of [5, 4] as const)
      it(`built PLO${n} ${name} spots in and out of position, small and pot bets: option ON never adds a non-nut raise and leaves none`, () => {
        const makes: Array<[string, () => ReturnType<typeof recordedTurnSpot>]> = [];
        for (let h = 1; h <= 30; h++)
          for (const inPosition of [false, true])
            for (const bet of [60, 200])
              makes.push([
                `plo${n}-${name}#${h}-${inPosition ? 'ip' : 'oop'}-bet${bet}`,
                () => builtSpot(h * 7 + n, board, n, inPosition, bet) as never,
              ]);
        lawOf(tally(makes), 80);
      });

  it('the rule itself: a non-nut call or fold comes back untouched, a non-nut raise comes back as a call or a fold, in Lightning with the option on', () => {
    let seen = 0;
    for (let h = 1; h <= 60; h++) {
      const st = recordedTurnSpot(h);
      if (omahaNutClassNow(st.hero, st.gs)) continue;
      seen++;
      const deps = { rake: 0, realization: 1 };
      const toCall = Number(st.gs.toCall ?? 0);
      for (const passive of [
        { action: 'call', amount: toCall, thinkTime: 0 },
        { action: 'fold', thinkTime: 0 },
      ] as HorseDecision[]) {
        HorseMind.reset();
        expect(omahaPricedTurnRiverRaiseRule(passive, st.hero, st.gs, ON, deps)).toEqual(passive);
      }
      HorseMind.reset();
      const raise: HorseDecision = {
        action: 'raise',
        amount: Number(st.gs.minRaiseTo ?? toCall * 2),
        thinkTime: 0,
      };
      const out = omahaPricedTurnRiverRaiseRule(raise, st.hero, st.gs, ON, deps);
      expect(out).not.toBeNull();
      expect(['call', 'fold', 'all_in']).toContain(out!.action);
      // an all-in here is only ever the call for the whole stack
      if (out!.action === 'all_in')
        expect(Number(st.hero.stack)).toBeLessThanOrEqual(toCall + 0.005);
    }
    expect(seen).toBeGreaterThanOrEqual(40);
  });

  it('the shadow stage re-decides the option only in a Lightning pool (turn and river, PLO4/PLO5 cash)', () => {
    const OPTION = 'omahaTurnRiverRaiseIsPricedInLightning';
    expect(OPTION_SHADOW_STAGE[OPTION]?.speeds).toEqual(['lightning']);
    const picked = (st: { hero: unknown; gs: unknown }) =>
      optionShadowStageInScope([OPTION, 'streetIQ'], st.hero, st.gs).includes(OPTION);
    for (const board of ['Qh9h3d5c', 'Qh9h3d5c2s'])
      for (const n of [5, 4] as const) {
        const pool = builtSpot(11, board, n, true, 60);
        expect(picked(pool)).toBe(true);
        // the same decision on an ordinary table: flipping the option changes nothing there, so it is not re-decided
        const table = builtSpot(11, board, n, true, 60);
        delete (table.gs as { publicMemoryDomain?: object }).publicMemoryDomain;
        expect(picked(table)).toBe(false);
        (table.gs as { publicMemoryDomain?: object }).publicMemoryDomain = {
          version: 1,
          speed: 'regular',
        };
        expect(picked(table)).toBe(false);
      }
    // a Lightning flop is outside its streets
    const flop = lightning(pricedSpot({ hole: 'AhKhJcTc2s', board: 'Qh9h3d', bet: 50 }).fresh());
    expect(picked(flop)).toBe(false);
  });
});
