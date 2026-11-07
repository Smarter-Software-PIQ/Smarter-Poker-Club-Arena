/**
 * 2026-11-07: Omaha decision-EV cells for horse continuations with a FULL
 * HOUSE after the horse's own aggression was raised (the V15 boats evidence).
 *
 * Input: JSON files from sql/omaha-boat-raised.sql (one array per slice, file
 * name `slice-YYYY-MM-DDT..json`; the UTC date names the day). Each row is
 * [hand8, variant, street, format (cash | tour | light | hu), hole, board,
 *  action, ev_bb, n_active, seats_dealt, bounty, chop, hero_bb, to_call/stack]
 * where ev_bb = (net + chips already invested at the node) / bb: the value of
 * continuing against folding there (a fold row carries 0 and is counted, not
 * averaged).
 *
 * The hand is classified AT THE DECISION with the engine's own evaluator:
 * omahaNutStatus(...).category === 7 (a full house now), then
 * omahaBoatDominated(omahaBoatsAbove(hole, board)) splits dominated (a bigger
 * boat live, or quads reachable by two or more holdings) from the effective
 * nut boat. A boat beaten by one exact pocket pair making quads (AAA77 vs 77)
 * is NOT dominated: that is a cooler, not an underboat.
 *
 * The action splits the continuation: "call" is a call, or an all-in for no
 * more than the price (to_call >= stack); "raise" is a raise or an all-in
 * above the price. Excluded as V81 excluded them: tables dealt two or fewer,
 * bounty / PKO / mystery-bounty events, 20bb or less behind for the horse.
 *
 * Usage (from server/): npx tsx ../scripts/horse-measure/omaha-boat-cells.ts DIR_OR_FILES...
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  omahaBoatDominated,
  omahaBoatsAbove,
  omahaNutStatus,
} from '../../server/src/engine/HorseEval.js';
import type { Card, CardRank, CardSuit } from '../../server/src/types.js';

type Row = [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  number,
  number,
  number,
  boolean,
  boolean,
  number,
  number,
];
const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };

export function parseCards(s: string): Card[] {
  const out: Card[] = [];
  for (let i = 0; i + 1 < s.length; i += 2)
    out.push({ rank: s[i] as CardRank, suit: SUIT[s[i + 1]] });
  return out;
}

/** 'dom' | 'nut' | null (not a full house at the decision). */
export function boatClass(hole: Card[], board: Card[]): 'dom' | 'nut' | null {
  if (omahaNutStatus(hole, board).category !== 7) return null;
  return omahaBoatDominated(omahaBoatsAbove(hole, board)) ? 'dom' : 'nut';
}

/** Exploratory depth tier (chosen after the fact; not an admission cell):
 *  three or more two-rank holdings make a bigger full house. */
export const DEEP_BOATS_ABOVE = 3;

interface Acc {
  hands: Map<string, { n: number; s: number }>;
  folds: number;
}
function ci(a: Acc) {
  let n = 0;
  let s = 0;
  for (const h of a.hands.values()) {
    n += h.n;
    s += h.s;
  }
  const g = a.hands.size;
  const m = n ? s / n : NaN;
  if (g < 2) return { n, g, m, lo: NaN, hi: NaN, folds: a.folds };
  let ss = 0;
  for (const h of a.hands.values()) ss += (h.s - m * h.n) ** 2;
  const se = Math.sqrt((ss * g) / (g - 1)) / n;
  return { n, g, m, lo: m - 1.96 * se, hi: m + 1.96 * se, folds: a.folds };
}

function load(paths: string[]): { day: string; r: Row }[] {
  const files: string[] = [];
  for (const p of paths) {
    if (statSync(p).isDirectory())
      for (const f of readdirSync(p).sort())
        if (/^slice-.*\.json$/.test(f)) files.push(join(p, f));
        else files.push(p);
  }
  return files.flatMap((f) => {
    const day = /slice-(\d{4}-\d{2}-\d{2})/.exec(basename(f))?.[1] ?? 'unknown';
    return (JSON.parse(readFileSync(f, 'utf8')) as Row[]).map((r) => ({ day, r }));
  });
}

if (process.argv[1]?.endsWith('omaha-boat-cells.ts')) {
  const rows = load(process.argv.slice(2));
  const days = [...new Set(rows.map((x) => x.day))].sort();
  const acc = new Map<string, Acc>();
  const cov = { rows: rows.length, boats: 0, dom: 0, excluded: 0 };
  for (const { day, r } of rows) {
    const [hand, v, street, fmt, holeS, boardS, act, ev, , seatsN, bounty, , heroBb, price] = r;
    const hole = parseCards(holeS);
    const board = parseCards(boardS);
    const cls = boatClass(hole, board);
    if (!cls) continue;
    const classes: string[] = [cls];
    if (cls === 'dom' && omahaBoatsAbove(hole, board).boats >= DEEP_BOATS_ABOVE)
      classes.push('dom_deep');
    cov.boats++;
    if (cls === 'dom') cov.dom++;
    if (bounty || seatsN <= 2 || !(heroBb > 20) || fmt === 'hu') {
      cov.excluded++;
      continue;
    }
    const kind =
      act === 'fold'
        ? 'fold'
        : act === 'call' || (act === 'all_in' && price >= 1)
          ? 'call'
          : 'raise';
    const slices = ['all', v, fmt, `${v}.${fmt}`, street, `${street}.${v}`, `${street}.${fmt}`];
    for (const c of classes)
      for (const k of ['any', kind === 'fold' ? null : kind]) {
        if (!k) continue;
        for (const sl of slices) {
          const key = `${c}|${k}|${sl}|${day}`;
          let a = acc.get(key);
          if (!a) acc.set(key, (a = { hands: new Map(), folds: 0 }));
          if (kind === 'fold') {
            a.folds++;
            continue;
          }
          const h = a.hands.get(`${day}:${hand}`) ?? { n: 0, s: 0 };
          h.n++;
          h.s += ev;
          a.hands.set(`${day}:${hand}`, h);
        }
      }
  }
  console.log(
    `# rows ${cov.rows}; full houses at the decision ${cov.boats} (dominated ${cov.dom}); excluded (dealt <= 2, bounty, <= 20bb behind) ${cov.excluded}; days ${days.join(', ')}`
  );
  console.log('# class|continuation|slice|day n hands mean_bb lo hi verdict folds');
  const verdict = (c: ReturnType<typeof ci>) =>
    c.g < 2 ? 'insuf' : c.hi < 0 ? 'BELOW' : c.lo > 0 ? 'above' : 'strad';
  for (const [k, a] of [...acc.entries()].sort((x, y) => x[0].localeCompare(y[0]))) {
    const c = ci(a);
    const f = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : 'NaN');
    console.log(
      `${k} n ${c.n} g ${c.g} mean ${f(c.m)} [${f(c.lo)}, ${f(c.hi)}] ${verdict(c)} folds ${c.folds}`
    );
  }
}
