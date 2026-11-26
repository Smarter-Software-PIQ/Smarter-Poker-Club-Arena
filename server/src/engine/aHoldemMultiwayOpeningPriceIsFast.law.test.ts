/**
 * LAW: THE MULTIWAY OPENING BET PRICE IS CHEAP WHERE IT APPLIES (plo-lead7 2026-11-26).
 *
 * holdemMultiwayOpeningBluffIsPriced / holdemMultiwayOpeningValueBetIsPriced read one line range per opponent and,
 * on the turn, compare the Horse's hand with every range on river cards under a fixed score budget
 * (HOLDEM_MULTIWAY_OPENING_TURN_SCORE_BUDGET), so the cost does not grow with the field. The lane's offline numbers
 * are in the options' authority files. The live shadow breaker disables an option at 50 ms.
 *
 * Measured the way theServerSuiteAssertsNoTightWallClockBound requires: against other work on the same machine, in
 * alternating rounds, the fastest round of each kept (src/testing/relativeCost.ts). The real audited multiway nodes
 * of HorseHoldemMultiwayOpeningIsPriced.fixture.json decided with the node's option on, against the same decisions
 * with it off: at most RATIO_DECISION times their cost. The pricing alone, at the widest field it takes (six
 * opponents with whole ranges on the turn), costs at most RATIO_WIDE times the same pricing against two.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  replayAt,
  replayProfiles,
  stateAt,
  type ComplaintAction,
  type ExtractedHand,
} from './HorseComplaintReplay.js';
import {
  HOLDEM_MULTIWAY_OPENING_MAX_OPPONENTS,
  holdemMultiwayOpeningPrice,
} from './HorseHoldemMultiwayOpeningIsPriced.js';
import { HOLDEM_OPENING_FOLD_ANCHOR } from './HorseHoldemOpeningIsPriced.js';
import { holdemLineRange } from './HorseHoldemValueAndCallsArePriced.js';
import { measureRelativeCost } from '../testing/relativeCost.js';
import type { Card } from '../types.js';

const RATIO_DECISION = 12;
const RATIO_WIDE = 8;

const FIX = JSON.parse(
  readFileSync(
    new URL('./HorseHoldemMultiwayOpeningIsPriced.fixture.json', import.meta.url),
    'utf8'
  )
) as {
  nodes: { hand: ExtractedHand; ord: number; option: string; expect: string }[];
  productionOpts: Record<string, unknown>;
};
const prof = replayProfiles('cash')[0];
const c = (s: string): Card => ({
  rank: (s[0] === 'T' ? '10' : s[0]) as Card['rank'],
  suit: ({ c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' } as const)[
    s[1] as 'c' | 'd' | 'h' | 's'
  ],
});

describe('LAW: the multiway opening bet price is cheap where it applies', () => {
  it('an applicable decision with the option on costs a bounded multiple of the same decision off', () => {
    const all = FIX.nodes.map((n) => ({
      st: stateAt(n.hand, n.hand.actions.find((a) => a.ord === n.ord) as ComplaintAction),
      option: n.option,
      expect: n.expect,
    }));
    expect(all.length).toBeGreaterThanOrEqual(8);
    // every node takes the priced path
    for (const s of all) {
      const r = replayAt(s.st, prof, [1, 7], { ...FIX.productionOpts, [s.option]: true });
      expect(r.receipts[s.expect]).toBe(2);
    }
    const cost = measureRelativeCost(
      () => {
        for (const s of all)
          replayAt(s.st, prof, [1, 7], { ...FIX.productionOpts, [s.option]: true });
      },
      () => {
        for (const s of all) replayAt(s.st, prof, [1, 7], FIX.productionOpts);
      },
      { warmupRounds: 1, rounds: 3 }
    );
    console.info(
      `[multiway opening decision] on ${cost.subjectMs.toFixed(2)} ms, off ${cost.referenceMs.toFixed(2)} ms for ` +
        `${all.length * 2} decisions, ratio ${cost.ratio.toFixed(2)} (limit ${RATIO_DECISION}, fastest of ${cost.rounds})`
    );
    expect(cost.ratio).toBeLessThan(RATIO_DECISION);
  }, 300_000);

  it('the widest field prices within a bounded multiple of the narrowest (the turn score budget holds)', () => {
    const turn = ['Kh', '9d', '4c', '2s'].map(c);
    const hero = [c('Ah'), c('Qh')];
    const one = () => ({
      base: holdemLineRange([], turn, null, []),
      foldRef: HOLDEM_OPENING_FOLD_ANCHOR,
      in: 0,
      stack: 1000,
    });
    const narrow = [one(), one()];
    const wide = Array.from({ length: HOLDEM_MULTIWAY_OPENING_MAX_OPPONENTS }, one);
    const spot = { pot: 100, heroIn: 0, heroStack: 1000, r: 1 };
    const sizes = [33, 50, 75, 100, 150];
    expect(holdemMultiwayOpeningPrice(spot, hero, turn, wide, sizes)).not.toBeNull();
    const cost = measureRelativeCost(
      () => {
        for (let i = 0; i < 20; i++) holdemMultiwayOpeningPrice(spot, hero, turn, wide, sizes);
      },
      () => {
        for (let i = 0; i < 20; i++) holdemMultiwayOpeningPrice(spot, hero, turn, narrow, sizes);
      },
      { warmupRounds: 1, rounds: 3 }
    );
    console.info(
      `[multiway opening price] six opponents ${(cost.subjectMs / 20).toFixed(2)} ms, two ${(cost.referenceMs / 20).toFixed(2)} ms, ` +
        `ratio ${cost.ratio.toFixed(2)} (limit ${RATIO_WIDE})`
    );
    expect(cost.ratio).toBeLessThan(RATIO_WIDE);
  }, 300_000);
});
