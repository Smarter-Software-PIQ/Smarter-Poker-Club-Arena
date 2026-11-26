/**
 * Test support for the big-draw sampler laws (PLO-OWNER lead-7, 2026-11-26): omahaBigDrawEquities as it was before
 * it moved to card ids, frozen, for anOmahaBigDrawEquityIsUnchanged (the same numbers) and anOmahaBigDrawPriceIsFast
 * (the relative cost).
 */
import type { Card } from '../types.js';
import { scoreOmahaHi } from './HorseEval.js';
import {
  OMAHA_BIG_DRAW_RUNOUTS,
  OMAHA_BIG_DRAW_SAMPLES,
  omahaBigDrawContinues,
  type OmahaBigDrawCounts,
} from './HorseOmahaBigDrawAggression.js';
import { omahaStrategyConstant } from './HorseOmahaStrategyGame.js';
import { RANKS, SUITS } from './PokerEngine.js';

/** omahaBigDrawEquities as it was before 2026-11-26 (frozen, with its private seed, generator and deck). */
const key = (c: Card): string => `${c.rank}:${c.suit}`;
export function frozenBigDrawEquities(
  hole: readonly Card[],
  board: readonly Card[],
  dead: readonly Card[] = [],
  samples: number = OMAHA_BIG_DRAW_SAMPLES,
  counts?: OmahaBigDrawCounts
): { all: number; bet: number; raise: number } | null {
  const seen = new Set([...hole, ...board, ...dead].map(key));
  const deck: Card[] = [];
  for (const rank of RANKS)
    for (const suit of SUITS) {
      const c = { rank, suit } as Card;
      if (!seen.has(key(c))) deck.push(c);
    }
  const size = hole.length;
  const need = 5 - board.length;
  if (need < 1 || deck.length < size + need) return null;
  let h0 = 2166136261;
  for (const c of [...hole, ...board])
    for (const ch of key(c)) {
      h0 ^= ch.charCodeAt(0);
      h0 = Math.imul(h0, 16777619);
    }
  let s = (h0 >>> 0 || 1) >>> 0;
  const rnd = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const take = (n: number, from: Card[], start: number): void => {
    for (let i = start; i < start + n; i++) {
      const j = i + Math.floor(rnd() * (from.length - i));
      const t = from[i]!;
      from[i] = from[j]!;
      from[j] = t;
    }
  };
  const won = [0, 0, 0];
  const got = [0, 0, 0];
  const h = [...hole];
  const continueStraightOuts = omahaStrategyConstant('bigDrawContinueStraightOuts', {
    gameVariant: `plo${size}`,
  });
  for (let k = 0; k < samples; k++) {
    const d = deck.slice();
    take(size, d, 0);
    const opp = d.slice(0, size);
    const level = omahaBigDrawContinues(opp, board, continueStraightOuts);
    let share = 0;
    for (let r = 0; r < OMAHA_BIG_DRAW_RUNOUTS; r++) {
      take(need, d, size);
      const run = [...board, ...d.slice(size, size + need)];
      const a = scoreOmahaHi(h, run);
      const o = scoreOmahaHi(opp, run);
      share += a > o ? 1 : a === o ? 0.5 : 0;
    }
    share /= OMAHA_BIG_DRAW_RUNOUTS;
    for (let lv = 0; lv <= level; lv++) {
      won[lv]! += share;
      got[lv]!++;
    }
  }
  if (got[0]! === 0) return null;
  const all = won[0]! / got[0]!;
  const bet = got[1]! >= 40 ? won[1]! / got[1]! : all;
  const raise = got[2]! >= 40 ? won[2]! / got[2]! : bet;
  if (counts) {
    counts.got = got;
    counts.won = won;
  }
  return { all, bet, raise };
}
