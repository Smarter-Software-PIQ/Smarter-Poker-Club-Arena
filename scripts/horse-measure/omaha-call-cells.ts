/**
 * Phase 4 (2026-11-02): Omaha decision-EV cells for horse turn/river CALLS.
 *
 * Input: JSON files from omaha-calls.sql (one array per slice). Each row is
 * [hand_id, variant, street, tournament(0/1), hole_cards, board_at_node,
 *  pot_frac, effective_bb, call_ev_bb, n_active, seats_dealt, bounty, chop]
 * where call_ev_bb = (net + chips already invested at the node) / bb: the
 * call's value against folding, chops at their fractional return, later
 * streets included.
 *
 * The hand is classified AT THE DECISION with the engine's own Omaha
 * evaluator (omahaNutStatus / scoreOmahaHiPartial), not from the final board.
 * Output: one line per cell, mean EV with a 95% CI clustered by hand.
 *
 * Usage (from server/): npx tsx ../scripts/horse-measure/omaha-call-cells.ts FILE...
 */
import { readFileSync } from 'node:fs';
import { omahaCallClass as classify } from '../../server/src/engine/HorseOmahaBigBetCalls.js';
import type { Card, CardRank, CardSuit } from '../../server/src/types.js';

type Row = [
  string,
  string,
  string,
  number,
  Card[],
  string,
  number,
  number,
  number,
  number,
  number,
  boolean,
  boolean,
];
const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };

export function parseBoard(s: string): Card[] {
  const out: Card[] = [];
  for (let i = 0; i + 1 < s.length; i += 2)
    out.push({ rank: s[i] as CardRank, suit: SUIT[s[i + 1]] });
  return out;
}

function pfBucket(pf: number): string {
  return pf >= 0.9 ? 'pf>=0.9' : pf >= 0.5 ? 'pf0.5-0.9' : 'pf<0.5';
}

interface Acc {
  hands: Map<string, { n: number; s: number }>;
}
function ci(a: Acc) {
  let n = 0,
    s = 0;
  for (const h of a.hands.values()) {
    n += h.n;
    s += h.s;
  }
  const g = a.hands.size;
  const m = s / n;
  if (g < 2) return { n, g, m, lo: NaN, hi: NaN };
  let ss = 0;
  for (const h of a.hands.values()) ss += (h.s - m * h.n) ** 2;
  const se = Math.sqrt((ss * g) / (g - 1)) / n;
  return { n, g, m, lo: m - 1.96 * se, hi: m + 1.96 * se };
}

export function cells(rows: Row[], keyOf: (r: Row, cls: string) => string[]) {
  const acc = new Map<string, Acc>();
  for (const r of rows) {
    const [hand, , , , hole, boardS, , , ev] = r;
    if (!Number.isFinite(ev)) continue;
    const cls = classify(hole, parseBoard(boardS));
    for (const k of keyOf(r, cls)) {
      let a = acc.get(k);
      if (!a) acc.set(k, (a = { hands: new Map() }));
      const h = a.hands.get(hand) ?? { n: 0, s: 0 };
      h.n++;
      h.s += ev;
      a.hands.set(hand, h);
    }
  }
  return [...acc.entries()]
    .map(([k, a]) => ({ k, ...ci(a) }))
    .sort((x, y) => x.k.localeCompare(y.k));
}

if (process.argv[1]?.endsWith('omaha-call-cells.ts')) {
  const files = process.argv.slice(2);
  const rows: Row[] = files.flatMap((f) => JSON.parse(readFileSync(f, 'utf8')) as Row[]);
  const out = cells(rows, (r, cls) => {
    const [, v, street, tour, , , pf, eff, , nAct, seatsN, bounty] = r;
    if (bounty || seatsN <= 2 || !(eff > 20)) return [];
    const b = pfBucket(pf);
    const hm = nAct > 2 ? 'mw' : 'hu';
    return [
      `${cls}|${b}|all`,
      `${cls}|${b}|${v}`,
      `${cls}|${b}|${street}`,
      `${cls}|${b}|${tour ? 'tour' : 'cash'}`,
      `${cls}|${b}|${hm}`,
    ];
  });
  console.log('cell|potfrac|slice n hands mean_bb lo hi verdict');
  for (const c of out) {
    const v = c.g < 2 ? 'insufficient' : c.hi < 0 ? 'BELOW' : c.lo > 0 ? 'above' : 'straddles';
    console.log(
      `${c.k} ${c.n} ${c.g} ${c.m.toFixed(2)} ${c.lo.toFixed(2)} ${c.hi.toFixed(2)} ${v}`
    );
  }
}
