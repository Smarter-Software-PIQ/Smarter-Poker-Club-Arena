/**
 * LAW: THE BIG-DRAW SAMPLER IS CHEAP (PLO-OWNER lead-7, 2026-11-26).
 *
 * omahaBigDrawEquities was most of omahaOpponentLifetimeHudDecides' cost where it applied (p95 29.7 / max 34.4 ms on
 * 600 applicable PLO4/PLO5 spots, its added time p95 27.2 ms) and of the live omahaBigDrawAggression's 60 ms
 * decisions. On card ids with the Horse's score cached per run-out (the same numbers, law
 * anOmahaBigDrawEquityIsUnchanged.law.test.ts) it costs a fraction of the Card sampler it replaced. Measured
 * relative to that frozen sampler on the same hands, as theServerSuiteAssertsNoTightWallClockBound requires: under
 * RATIO of its cost (measured 0.11).
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '../types.js';
import { omahaBigDrawEquities } from './HorseOmahaBigDrawAggression.js';
import { frozenBigDrawEquities } from './anOmahaBigDraw.test-support.js';
import { measureRelativeCost } from '../testing/relativeCost.js';

const RATIO = 0.4;
const DECK: Card[] = [];
for (const s of ['clubs', 'diamonds', 'hearts', 'spades'])
  for (const r of '23456789TJQKA'.split('')) DECK.push({ rank: r, suit: s } as Card);

describe('LAW: the big-draw sampler is cheap', () => {
  it('costs a fraction of the frozen Card sampler on the same hands', () => {
    let x = 0x5eed;
    const rnd = (): number => {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      return (x >>> 0) / 4294967296;
    };
    const cases = Array.from({ length: 8 }, (_, t) => {
      const holeCount = [4, 5][t % 2]!;
      const boardCount = [3, 4][(t >> 1) % 2]!;
      const d = DECK.slice();
      for (let i = 0; i < holeCount + boardCount; i++) {
        const j = i + Math.floor(rnd() * (d.length - i));
        [d[i], d[j]] = [d[j]!, d[i]!];
      }
      return { hole: d.slice(0, holeCount), board: d.slice(holeCount, holeCount + boardCount) };
    });
    const cost = measureRelativeCost(
      () => {
        for (const c of cases) omahaBigDrawEquities(c.hole, c.board, []);
      },
      () => {
        for (const c of cases) frozenBigDrawEquities(c.hole, c.board, []);
      },
      { warmupRounds: 1, rounds: 3 }
    );
    console.info(
      `[big-draw sampler] ids ${cost.subjectMs.toFixed(2)} ms, Card ${cost.referenceMs.toFixed(2)} ms, ` +
        `ratio ${cost.ratio.toFixed(3)} (limit ${RATIO}, fastest of ${cost.rounds})`
    );
    expect(cost.ratio).toBeLessThan(RATIO);
  }, 120_000);
});
