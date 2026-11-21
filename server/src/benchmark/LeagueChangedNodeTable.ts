/**
 * THE PER-NODE TABLE OF CHANGED DECISIONS (2026-11-21).
 *
 * docs/HORSE-DECISION-CHANGE-EVIDENCE.md, row 3 (Value): "Expected value of
 * the new action against the old one at each changed node, under at least
 * three stated opponent ranges ... An aggregate with no per-node table" does
 * not count. This collector is a LeagueFieldPairObserver (HorseLeague.ts
 * runMatchup): in each pair it records the hero Horse's decisions on both
 * passes, finds the FIRST decision where arm A and arm B differ, and books the
 * pair's hero result (A minus B, big blinds) to that node. Everything before
 * that decision is the same deal, the same field and the same history on
 * both passes, so the pair's difference is the value of the changed decision
 * together with everything it caused afterwards.
 *
 * A node is the street, whether the hero faced a wager, and how many bets and
 * raises the street held before the decision (the blinds are not counted):
 * `river/facing_1` is a river decision facing one bet. Read-only: it never
 * changes a decision and consumes no randomness. Measurement plumbing only.
 */
import type { LeagueFieldPairObserver, LeagueHandObserver } from './HorseLeague.js';

export interface ChangedNodeRow {
  node: string;
  actionA: string;
  actionB: string;
  pairs: number;
  /** Mean hero result A minus B over these pairs, big blinds per changed pair. */
  meanBb: number;
  /** Standard error of that mean (sample standard deviation / sqrt(pairs)). */
  stderrBb: number;
  /** This row's contribution to the card's bb/100 (sum of its differences / total pairs * 100). */
  bb100Share: number;
}

export interface ChangedNodeTable {
  totalPairs: number;
  /** Pairs whose hero result differs. */
  divergentPairs: number;
  /** Pairs with at least one changed hero decision. */
  changedPairs: number;
  /** Changed pairs whose hero result is equal anyway. */
  changedButEqual: number;
  /** Pairs whose result differs with no changed hero decision (expected 0). */
  unexplained: number;
  rows: ChangedNodeRow[];
}

interface Decision {
  node: string;
  action: string;
}

/** The node label of one decision: street, facing or checked to, wagers already on the street. */
export function changedNodeLabel(stage: string, toCall: number, streetWagers: number): string {
  return `${stage}/${toCall > 0 ? `facing_${streetWagers}` : 'checked_to'}`;
}

export function createChangedNodeCollector(heroSeat: number): {
  observer: LeagueFieldPairObserver;
  table: () => ChangedNodeTable;
} {
  const passes = new Map<number, { pass1?: Decision[]; pass2?: Decision[] }>();
  const cells = new Map<string, { node: string; a: string; b: string; diffs: number[] }>();
  let totalPairs = 0;
  let divergentPairs = 0;
  let changedPairs = 0;
  let changedButEqual = 0;
  let unexplained = 0;
  let sumAll = 0;

  const hand = (pair: number, pass: 'pass1' | 'pass2'): LeagueHandObserver => {
    const decisions: Decision[] = [];
    const entry = passes.get(pair) ?? {};
    entry[pass] = decisions;
    passes.set(pair, entry);
    let stage = '';
    let wagers = 0;
    return {
      onAction: (e) => {
        if (e.stage !== stage) {
          stage = e.stage;
          wagers = 0;
        }
        if (e.seatIdx === heroSeat)
          decisions.push({ node: changedNodeLabel(e.stage, e.toCall, wagers), action: e.action });
        if (e.action === 'bet' || e.action === 'raise' || e.action === 'all_in') wagers++;
      },
    };
  };

  const pair = (p: number, a: number, b: number): void => {
    const entry = passes.get(p);
    passes.delete(p);
    totalPairs++;
    const diff = a - b;
    sumAll += diff;
    if (diff !== 0) divergentPairs++;
    const da = entry?.pass1 ?? [];
    const db = entry?.pass2 ?? [];
    let i = 0;
    while (
      i < da.length &&
      i < db.length &&
      da[i].node === db[i].node &&
      da[i].action === db[i].action
    )
      i++;
    if (i === da.length && i === db.length) {
      if (diff !== 0) unexplained++;
      return;
    }
    changedPairs++;
    if (diff === 0) changedButEqual++;
    const nodeA = da[i]?.node ?? '(no decision)';
    const nodeB = db[i]?.node ?? '(no decision)';
    const node = nodeA === nodeB ? nodeA : `${nodeA} | ${nodeB}`;
    const actA = da[i]?.action ?? '(none)';
    const actB = db[i]?.action ?? '(none)';
    const key = `${node}\u0000${actA}\u0000${actB}`;
    const cell = cells.get(key) ?? { node, a: actA, b: actB, diffs: [] };
    cell.diffs.push(diff);
    cells.set(key, cell);
  };

  const table = (): ChangedNodeTable => {
    const rows = [...cells.values()]
      .map((c): ChangedNodeRow => {
        const n = c.diffs.length;
        const mean = c.diffs.reduce((s, x) => s + x, 0) / n;
        const v = n > 1 ? c.diffs.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1) : 0;
        return {
          node: c.node,
          actionA: c.a,
          actionB: c.b,
          pairs: n,
          meanBb: mean,
          stderrBb: Math.sqrt(v / n),
          bb100Share: totalPairs > 0 ? ((mean * n) / totalPairs) * 100 : 0,
        };
      })
      .sort((x, y) => y.pairs - x.pairs || x.node.localeCompare(y.node));
    void sumAll;
    return { totalPairs, divergentPairs, changedPairs, changedButEqual, unexplained, rows };
  };

  return { observer: { hand, pair }, table };
}

/** The table as Markdown, numbers rounded for reading (the raw rows are in the JSON line). */
export function formatChangedNodeTable(t: ChangedNodeTable): string {
  const f = (x: number, d = 2) => x.toFixed(d);
  const lines = [
    `pairs ${t.totalPairs}, divergent ${t.divergentPairs}, changed ${t.changedPairs} (equal result ${t.changedButEqual}), unexplained ${t.unexplained}`,
    '',
    '| Node | Arm A (on) | Arm B (off) | Pairs | Mean A-B (bb per pair) | Std. error | Share of bb/100 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...t.rows.map(
      (r) =>
        `| ${r.node} | ${r.actionA} | ${r.actionB} | ${r.pairs} | ${f(r.meanBb)} | ${f(r.stderrBb)} | ${f(r.bb100Share)} |`
    ),
  ];
  return lines.join('\n');
}
