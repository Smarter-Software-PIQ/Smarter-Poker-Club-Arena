/**
 * EMERG lane EQUITY benchmark: ms per equityVsRanges call at SE <= 0.01 for
 * PLO4 / PLO5, heads-up and three-way, flop / turn / river, random and
 * weighted (weightFn) ranges. Synthetic deals from a fixed seed only.
 *   cd server && npx tsx src/scripts/omahaRangeEquityBench.ts
 */
import type { Card } from '../types.js';
import { equityVsRanges, type OmahaOpponentRange } from '../engine/omaha/OmahaRangeEquity.js';

const RANKS = '23456789TJQKA';
const SUITS: Card['suit'][] = ['clubs', 'diamonds', 'hearts', 'spades'];
const DECK: Card[] = SUITS.flatMap((suit) =>
  RANKS.split('').map((rank) => ({ rank: rank as Card['rank'], suit }))
);
let s = 0x1234567;
const random = () => {
  s ^= s << 13;
  s ^= s >>> 17;
  s ^= s << 5;
  return (s >>> 0) / 0x100000000;
};
const deal = (n: number) => {
  const d = DECK.slice();
  return Array.from({ length: n }, () => d.splice(Math.floor(random() * d.length), 1)[0]);
};

const CALLS = Number(process.env.BENCH_CALLS ?? 40);
const rows: Record<string, unknown>[] = [];
for (const holes of [4, 5])
  for (const opps of [1, 2])
    for (const boardSize of [3, 4, 5])
      for (const rangeKind of ['random', 'weighted'] as const) {
        const times: number[] = [];
        const samples: number[] = [];
        const ses: number[] = [];
        let failures = 0;
        for (let call = 0; call < CALLS; call++) {
          const cards = deal(holes + boardSize);
          const hero = cards.slice(0, holes);
          const board = cards.slice(holes);
          // weighted: a value-heavy range, weight rises with the made category on this board
          const range: OmahaOpponentRange =
            rangeKind === 'random'
              ? { kind: 'random' }
              : {
                  kind: 'weightFn',
                  weight: (_c, ctx) => Math.max(0.05, Math.floor(ctx.publicHigh / 0x100000) / 10),
                  maxWeight: 1,
                };
          const r = equityVsRanges(hero, board, Array(opps).fill(range), 20000, {
            targetSE: 0.01,
            minSamples: 400,
          });
          if (!r) {
            failures++;
            continue;
          }
          times.push(r.ms);
          samples.push(r.samples);
          ses.push(r.se);
        }
        times.sort((a, b) => a - b);
        const avg = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
        rows.push({
          game: `PLO${holes}`,
          players: opps === 1 ? 'HU' : '3-way',
          street: boardSize === 3 ? 'flop' : boardSize === 4 ? 'turn' : 'river',
          range: rangeKind,
          calls: times.length,
          failures,
          ms_mean: +avg(times).toFixed(2),
          ms_p50: +times[Math.floor(times.length / 2)].toFixed(2),
          ms_p95: +times[Math.floor(times.length * 0.95)].toFixed(2),
          samples_mean: Math.round(avg(samples)),
          se_max: +Math.max(...ses).toFixed(4),
        });
      }
console.table(rows);
console.log(JSON.stringify(rows));
