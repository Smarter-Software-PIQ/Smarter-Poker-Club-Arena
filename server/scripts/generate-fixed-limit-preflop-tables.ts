/**
 * Generates src/engine/HorseFixedLimitPreflopTables.ts, the two tables the
 * fixed-limit priced preflop option (fixedLimitPricedPreflop, default off)
 * reads:
 *
 *  - STRENGTH_AT_TOP_SHARE[variant][k]: the decision strength (the value
 *    HorseLogic hands decidePreflopV7 before its +/-0.03 jitter) at the top
 *    k percent of hands, k = 0..100. flh: holdemPreflopScore over all 1,326
 *    combos (exact). flo8: omahaElitePreflopStrength(cards, true) over a fixed
 *    seeded sample of four-card hands.
 *  - EQUITY_VS_TOP_SHARE[variant][b][w]: showdown equity (per mille, hi-lo
 *    pots split 50/50 with an 8-or-better low, odd chips ignored) of a hand
 *    in hero top-share bucket b (5-point buckets: top 0-5%, 5-10%, ...,
 *    95-100%) against one opponent holding a hand from the top W percent of
 *    the same order, W in OPENER_WIDTHS. Monte Carlo with a fixed seed, so the
 *    file is reproducible:
 *
 *   cd server && npx tsx scripts/generate-fixed-limit-preflop-tables.ts [trialsFlh] [trialsFlo8] [poolFlo8]
 *
 * writes the file in place.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Card } from '../src/types.js';
import {
  holdemPreflopScore,
  omahaElitePreflopStrength,
  scoreHoldem,
  scoreOmahaHi,
  scoreOmahaLow,
} from '../src/engine/HorseEval.js';
import { RANKS, SUITS } from '../src/engine/PokerEngine.js';

const TRIALS_FLH = Number(process.argv[2] ?? 4000);
const TRIALS_FLO8 = Number(process.argv[3] ?? 2000);
const POOL_FLO8 = Number(process.argv[4] ?? 60000);
export const OPENER_WIDTHS = [10, 15, 20, 25, 30, 40, 50, 60, 70, 85, 100] as const;
const BUCKETS = 20;

const DECK: Card[] = SUITS.flatMap((s) => RANKS.map((r) => ({ rank: r, suit: s }) as Card));
let state = 0x2026_1115;
function rnd(): number {
  state ^= state << 13;
  state >>>= 0;
  state ^= state >>> 17;
  state ^= state << 5;
  state >>>= 0;
  return state / 4294967296;
}
const same = (a: Card, b: Card) => a.rank === b.rank && a.suit === b.suit;

interface Hand {
  cards: Card[];
  s: number;
}

function flhPool(): Hand[] {
  const out: Hand[] = [];
  for (let i = 0; i < 52; i++)
    for (let j = i + 1; j < 52; j++)
      out.push({ cards: [DECK[i], DECK[j]], s: holdemPreflopScore(DECK[i], DECK[j], false) });
  return out;
}
function flo8Pool(n: number): Hand[] {
  const out: Hand[] = [];
  while (out.length < n) {
    const cards: Card[] = [];
    while (cards.length < 4) {
      const c = DECK[Math.floor(rnd() * 52)];
      if (!cards.some((x) => same(x, c))) cards.push(c);
    }
    out.push({ cards, s: omahaElitePreflopStrength(cards, true) });
  }
  return out;
}

function showdown(hero: Card[], opp: Card[], board: Card[], hiLo: boolean): number {
  if (!hiLo) {
    const h = scoreHoldem([...hero, ...board], 7, false);
    const v = scoreHoldem([...opp, ...board], 7, false);
    return h > v ? 1 : h === v ? 0.5 : 0;
  }
  const hh = scoreOmahaHi(hero, board);
  const vh = scoreOmahaHi(opp, board);
  const hiShare = hh > vh ? 1 : hh === vh ? 0.5 : 0;
  const hl = scoreOmahaLow(hero, board);
  const vl = scoreOmahaLow(opp, board);
  if (hl === Infinity && vl === Infinity) return hiShare;
  const loShare = hl < vl ? 1 : hl === vl ? 0.5 : 0;
  return hiShare * 0.5 + loShare * 0.5;
}

function tables(pool: Hand[], trials: number, hiLo: boolean) {
  const sorted = [...pool].sort((a, b) => b.s - a.s); // strongest first
  const n = sorted.length;
  const atTop: number[] = [];
  for (let k = 0; k <= 100; k++) {
    const idx = Math.min(n - 1, Math.max(0, Math.ceil((k / 100) * n) - 1));
    atTop.push(k === 0 ? sorted[0].s : sorted[idx].s);
  }
  const equity: number[][] = [];
  for (let b = 0; b < BUCKETS; b++) {
    const lo = Math.floor((b / BUCKETS) * n);
    const hi = Math.max(lo + 1, Math.floor(((b + 1) / BUCKETS) * n));
    const row: number[] = [];
    for (const w of OPENER_WIDTHS) {
      const top = Math.max(1, Math.floor((w / 100) * n));
      let sum = 0;
      let cnt = 0;
      for (let t = 0; t < trials; t++) {
        const hero = sorted[lo + Math.floor(rnd() * (hi - lo))].cards;
        let opp: Card[] | null = null;
        for (let k = 0; k < 200 && !opp; k++) {
          const c = sorted[Math.floor(rnd() * top)].cards;
          if (!c.some((x) => hero.some((y) => same(x, y)))) opp = c;
        }
        if (!opp) continue;
        const used = [...hero, ...opp];
        const board: Card[] = [];
        while (board.length < 5) {
          const c = DECK[Math.floor(rnd() * 52)];
          if (used.some((u) => same(u, c)) || board.some((x) => same(x, c))) continue;
          board.push(c);
        }
        sum += showdown(hero, opp, board, hiLo);
        cnt++;
      }
      row.push(Math.round((sum / Math.max(1, cnt)) * 1000));
    }
    equity.push(row);
  }
  return { atTop: atTop.map((x) => Math.round(x * 1e5) / 1e5), equity };
}

const flh = tables(flhPool(), TRIALS_FLH, false);
const flo8 = tables(flo8Pool(POOL_FLO8), TRIALS_FLO8, true);
const fmt = (xs: readonly number[]) => `[${xs.join(', ')}]`;
const body = `/**
 * GENERATED by server/scripts/generate-fixed-limit-preflop-tables.ts
 * (trials flh ${TRIALS_FLH}, flo8 ${TRIALS_FLO8}, flo8 pool ${POOL_FLO8}, seed 0x20261115).
 * Do not edit by hand: rerun the script. Read only by HorseFixedLimitPreflop.ts.
 */
/** Opener widths (percent of hands) the equity rows are written at. */
export const FIXED_LIMIT_OPENER_WIDTHS = ${fmt(OPENER_WIDTHS)} as const;
/** Hero top-share buckets per equity table (each 100 / buckets percent wide). */
export const FIXED_LIMIT_EQUITY_BUCKETS = ${BUCKETS};
/** Decision strength at the top k percent of hands, k = 0..100. */
export const FIXED_LIMIT_STRENGTH_AT_TOP_SHARE: Readonly<Record<'flh' | 'flo8', readonly number[]>> = {
  flh: ${fmt(flh.atTop)},
  flo8: ${fmt(flo8.atTop)},
};
/** Showdown equity (per mille) of hero bucket b against the top W percent. */
export const FIXED_LIMIT_EQUITY_VS_TOP_SHARE: Readonly<
  Record<'flh' | 'flo8', readonly (readonly number[])[]>
> = {
  flh: [
${flh.equity.map((r) => `    ${fmt(r)},`).join('\n')}
  ],
  flo8: [
${flo8.equity.map((r) => `    ${fmt(r)},`).join('\n')}
  ],
};
`;
writeFileSync(resolve(process.cwd(), 'src/engine/HorseFixedLimitPreflopTables.ts'), body);
console.log('written');
