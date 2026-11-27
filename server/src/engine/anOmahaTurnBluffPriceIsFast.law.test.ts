/**
 * LAW: THE PLO TURN OPENING-BLUFF PRICE STAYS CHEAP (PLO-OWNER lead-7, 2026-11-26; review t3).
 *
 * omahaTurnBluffIsPricedOnBlockers / omahaTurnBluffIsPricedOnRangeAdvantage read the Horse's share with a card to come
 * against HIS measured range on the board: one call of the engine's big-draw sampler whose sampled holdings are also
 * counted by their strength bin now (omahaTurnBluffSample: the bins of omahaOpeningBinsOnBoard plus a classifier on
 * the same pair scores). Before the review fix the same spot ran the bins and the plain sampler. The bin count must
 * stay a small addition to that work.
 *
 * Measured the way theServerSuiteAssertsNoTightWallClockBound requires: against other work on the same machine, in
 * alternating rounds, the fastest round of each kept (src/testing/relativeCost.ts). Subject: omahaTurnBluffSample and
 * the price on a fixed set of PLO4 and PLO5 turn spots. Reference: omahaOpeningBinsOnBoard and the plain
 * omahaBigDrawEquities on the same spots (the work the price did before). At most RATIO of its cost.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '../types.js';
import { omahaTurnBluffPrice, omahaTurnBluffSample } from './HorseOmahaOpeningBluff.js';
import { omahaOpeningBinsOnBoard } from './HorseOmahaRiverOpeningBet.js';
import { OMAHA_BIG_DRAW_SAMPLES, omahaBigDrawEquities } from './HorseOmahaBigDrawAggression.js';
import { measureRelativeCost } from '../testing/relativeCost.js';

const RATIO = 1.6;
const SUIT = { h: 'hearts', s: 'spades', d: 'diamonds', c: 'clubs' } as const;
const c = (s: string) => ({ rank: s[0], suit: SUIT[s[1] as keyof typeof SUIT] }) as Card;
const SPOTS: { hole: Card[]; board: Card[] }[] = [
  ['Ah Qh Jc Tc', '9h 8d 2h Ks'],
  ['Kd Kc 7s 6s', 'Ks 8s 3d 2c'],
  ['As Ad 9c 8c', 'Tc 7h 2c 2d'],
  ['Qs Js Td 9d', '8s 7c 3h Kd'],
  ['Ah Kh Qd Jd Tc', '9h 8d 2h Ks'],
  ['6h 6d 5c 4c 3s', 'Ac 7c 2s 9h'],
  ['Ac Kc 8d 7d 2s', 'Qc 6d 5h Jc'],
  ['Th 9h 8s 7s 4d', 'Js 6c 2h Ad'],
].map(([h, b]) => ({ hole: h.split(' ').map(c), board: b.split(' ').map(c) }));
const HIST = [0.11, 0.02, 0.05, 0.04, 0.04, 0.29, 0.25, 0.19];

describe('LAW: the PLO turn opening-bluff price stays cheap', () => {
  it('the binned sample and price cost a small multiple of the bins and the plain sampler', () => {
    const cost = measureRelativeCost(
      () => {
        for (const s of SPOTS) {
          const x = omahaTurnBluffSample(s.hole, s.board, []);
          if (!x) throw new Error('no sample');
          omahaTurnBluffPrice({
            hist: HIST,
            bins: x.bins,
            pot: 100,
            amounts: [70, 100],
            rake: 0.05,
            realization: 0.85,
            raiseBack: 0.05,
            record: null,
            position: 'ip',
            equity: x.equity,
            variant: s.hole.length === 5 ? 'plo5' : 'plo4',
            line: 'chk',
          });
        }
      },
      () => {
        for (const s of SPOTS) {
          omahaOpeningBinsOnBoard(s.hole, s.board, []);
          omahaBigDrawEquities(s.hole, s.board, [], OMAHA_BIG_DRAW_SAMPLES, {
            got: [0, 0, 0],
            won: [0, 0, 0],
          });
        }
      },
      { warmupRounds: 1, rounds: 5 }
    );
    console.info(
      `[turn bluff price] binned ${(cost.subjectMs / SPOTS.length).toFixed(2)} ms, before ` +
        `${(cost.referenceMs / SPOTS.length).toFixed(2)} ms per spot, ratio ${cost.ratio.toFixed(3)} ` +
        `(limit ${RATIO}, fastest of ${cost.rounds})`
    );
    expect(cost.ratio).toBeLessThan(RATIO);
  }, 120_000);
});
