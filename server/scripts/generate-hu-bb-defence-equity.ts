/**
 * Generates the HU_BB_EQUITY table in src/engine/HorseHuBbDefence.ts: the
 * all-in equity of every hold'em class against an opener who raises the top
 * W% of hands on the heads-up small blind's V70 open order
 * (gtoOpenOrder(1)), for W in HU_BB_EQUITY_WIDTHS. Monte Carlo with a fixed
 * seed, so the table is reproducible:
 *
 *   cd server && npx tsx scripts/generate-hu-bb-defence-equity.ts [trials]
 *
 * prints the TypeScript literal to paste over the table.
 */
import type { Card } from '../src/types.js';
import { scoreHoldem } from '../src/engine/HorseEval.js';
import { HAND_CLASSES, gtoOpenOrder } from '../src/engine/HorseGtoOpeningRanges.js';
import { HU_BB_EQUITY_WIDTHS } from '../src/engine/HorseHuBbDefence.js';

const TRIALS = Number(process.argv[2] ?? 6000);
const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'] as const;
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const DECK: Card[] = SUITS.flatMap((s) => RANKS.map((r) => ({ rank: r, suit: s }) as Card));
const COMBOS: Record<string, number> = Object.fromEntries(
  HAND_CLASSES.map((h) => [h.cls, h.combos])
);

let state = 0x9e3779b9;
function rnd(): number {
  // xorshift32
  state ^= state << 13;
  state >>>= 0;
  state ^= state >>> 17;
  state ^= state << 5;
  state >>>= 0;
  return state / 4294967296;
}

function combosOf(cls: string): [Card, Card][] {
  const out: [Card, Card][] = [];
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      if (cls.length === 2) {
        if (j <= i) continue;
      } else if (cls[2] === 's') {
        if (i !== j) continue;
      } else if (i === j) continue;
      out.push([
        { rank: cls[0], suit: SUITS[i] } as Card,
        { rank: cls[1], suit: SUITS[j] } as Card,
      ]);
    }
  return out;
}

/** Weighted villain combos for the top `w` percent on the HU open order. */
function rangeCombos(w: number): { c: [Card, Card]; wt: number }[] {
  const order = gtoOpenOrder(1);
  let left = (w / 100) * 1326;
  const out: { c: [Card, Card]; wt: number }[] = [];
  for (const cls of order) {
    if (left <= 1e-9) break;
    const n = COMBOS[cls];
    const f = Math.min(1, left / n);
    left -= n * f;
    for (const c of combosOf(cls)) out.push({ c, wt: f });
  }
  return out;
}

const same = (a: Card, b: Card) => a.rank === b.rank && a.suit === b.suit;

function equity(cls: string, range: { c: [Card, Card]; wt: number }[]): number {
  const heroCombos = combosOf(cls);
  let win = 0;
  let n = 0;
  for (let t = 0; t < TRIALS; t++) {
    const h = heroCombos[t % heroCombos.length];
    // rejection-sample a villain combo by weight that does not share a card
    let v: [Card, Card] | null = null;
    for (let k = 0; k < 1000 && !v; k++) {
      const pick = range[Math.floor(rnd() * range.length)];
      if (rnd() >= pick.wt) continue;
      if (pick.c.some((x) => same(x, h[0]) || same(x, h[1]))) continue;
      v = pick.c;
    }
    if (!v) continue;
    const used = [h[0], h[1], v[0], v[1]];
    const board: Card[] = [];
    while (board.length < 5) {
      const c = DECK[Math.floor(rnd() * 52)];
      if (used.some((u) => same(u, c)) || board.some((b) => same(b, c))) continue;
      board.push(c);
    }
    const hs = scoreHoldem([h[0], h[1], ...board], 7, false);
    const vs = scoreHoldem([v[0], v[1], ...board], 7, false);
    win += hs > vs ? 1 : hs === vs ? 0.5 : 0;
    n++;
  }
  return win / n;
}

const ranges = HU_BB_EQUITY_WIDTHS.map((w) => rangeCombos(w));
const lines: string[] = [];
for (const { cls } of HAND_CLASSES) {
  const row = ranges.map((r) => Math.round(equity(cls, r) * 1000));
  lines.push(`  '${cls}': [${row.join(', ')}],`);
}
console.log(`{\n${lines.join('\n')}\n}`);
