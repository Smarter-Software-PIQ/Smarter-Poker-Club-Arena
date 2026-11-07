/**
 * V84 denominator (2026-11-07): every horse river decision facing a raise
 * after its own river bet or raise, from omaha-river-reraise-opportunities.sql
 * (run with the flush-candidate filter: the horse holds two cards of a suit
 * the board shows three times). Classifies each decision with the engine's own
 * omahaCallClass and prints, for the admitted V84 cell and its neighbours:
 * the actions taken, what each V81 exclusion removes, the chops, and for every
 * call the raise size, the price, the equity it needed and what beat it.
 *
 * Usage (from server/): npx tsx ../scripts/horse-measure/omaha-river-reraise-denominator.ts \
 *   --day A FILE [FILE ...] --day B FILE [FILE ...] [--prior FILE ...]
 * --prior: the earlier omaha-river-reraise-calls.sql rows (8-character hand
 * ids), reconciled against the calls found here.
 */
import { readFileSync } from 'node:fs';
import { omahaCallClass } from '../../server/src/engine/HorseOmahaBigBetCalls.js';
import { parseBoard } from './omaha-call-cells.js';

type Row = [
  string, // hand id
  string, // variant
  number, // tournament
  string, // hole
  string, // board
  string, // action
  number | null, // wager / pot before
  number | null, // effective bb
  number, // decision EV bb
  number, // live players
  number, // seats dealt
  boolean, // bounty
  boolean, // chop
  boolean, // run it twice
  number, // chips to call (capped at the stack)
  number, // pot at the node
  string | null, // raiser action
  boolean | null, // raiser all in
  string | null, // showdown hands of the others
  number, // net bb
];

const CALLS = new Set(['call', 'all_in_call']);
const MIN_PRICE = 0.13;
const ACTIONS = ['fold', 'call', 'all_in_call', 'raise', 'all_in_raise'];

function load(files: string[]): Row[] {
  return files.flatMap((f) => JSON.parse(readFileSync(f, 'utf8')) as Row[]);
}

function exclusion(r: Row): string | null {
  const [, , , , , , pf, eff, , , seats, bounty, , rit] = r;
  if (pf === null) return 'raiser not found';
  if (pf < 0.9) return 'raise under 0.9 pot';
  if (seats <= 2) return 'heads-up table';
  if (bounty) return 'bounty event';
  if (!(Number(eff) > 20)) return '20bb or less';
  if (rit) return 'run it twice';
  return null;
}

function clusteredCi(rows: Row[]) {
  const by = new Map<string, { n: number; s: number }>();
  for (const r of rows) {
    const h = by.get(r[0]) ?? { n: 0, s: 0 };
    h.n++;
    h.s += r[8];
    by.set(r[0], h);
  }
  let n = 0,
    s = 0;
  for (const h of by.values()) {
    n += h.n;
    s += h.s;
  }
  const g = by.size;
  const m = s / n;
  if (g < 2) return { n, g, m, lo: NaN, hi: NaN };
  let ss = 0;
  for (const h of by.values()) ss += (h.s - m * h.n) ** 2;
  const se = Math.sqrt((ss * g) / (g - 1)) / n;
  return { n, g, m, lo: m - 1.96 * se, hi: m + 1.96 * se };
}

const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : 'n/a');
const f3 = (x: number) => x.toFixed(3);

function main() {
  const args = process.argv.slice(2);
  const days: Record<string, string[]> = {};
  const prior: string[] = [];
  let cur: string[] | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--day') cur = days[args[++i]] = [];
    else if (args[i] === '--prior') cur = prior;
    else cur?.push(args[i]);
  }
  const out: string[] = [];
  const priorIds = new Set(
    prior
      .flatMap((f) => JSON.parse(readFileSync(f, 'utf8')) as unknown[][])
      .filter((p) => (p[10] as number) > 2 && !p[11] && (p[7] as number) > 20)
      .filter(
        (p) => omahaCallClass(parseBoard(String(p[4])), parseBoard(String(p[5]))) === 'flush_second'
      )
      .map((p) => String(p[0]).slice(0, 8))
  );
  const foundIds = new Set<string>();
  const allCalls: Row[] = [];
  for (const [day, files] of Object.entries(days)) {
    const rows = load(files);
    const cls = (r: Row) => omahaCallClass(parseBoard(r[3]), parseBoard(r[4]));
    out.push(`\n## Day ${day}: ${rows.length} flush-candidate decisions (all actions, unfiltered)`);
    // 1. Every flush class, eligible decisions, by action.
    out.push('class | eligible by action (fold call all_in_call raise all_in_raise) | excluded');
    const classes = [...new Set(rows.map(cls))].sort();
    for (const c of classes) {
      const rs = rows.filter((r) => cls(r) === c);
      const el = rs.filter((r) => exclusion(r) === null);
      const counts = ACTIONS.map((a) => el.filter((r) => r[5] === a).length).join(' ');
      out.push(`${c} | ${counts} | ${rs.length - el.length}`);
    }
    // 2. The admitted cell in full.
    const fs = rows.filter((r) => cls(r) === 'flush_second');
    out.push(
      `\n### flush_second (unpaired board), day ${day}: ${fs.length} decisions before exclusions`
    );
    const reasons = new Map<string, number>();
    for (const r of fs) {
      const e = exclusion(r) ?? 'ELIGIBLE';
      reasons.set(
        `${e} / ${CALLS.has(r[5]) ? 'call' : r[5]}`,
        (reasons.get(`${e} / ${CALLS.has(r[5]) ? 'call' : r[5]}`) ?? 0) + 1
      );
    }
    for (const [k, n] of [...reasons].sort()) out.push(`  ${k}: ${n}`);
    const el = fs.filter((r) => exclusion(r) === null);
    out.push('  eligible by variant / format: fold call all_in_call raise all_in_raise');
    for (const v of ['plo4', 'plo5', 'plo6'])
      for (const t of [0, 1]) {
        const s = el.filter((r) => r[1] === v && r[2] === t);
        if (!s.length) continue;
        out.push(
          `    ${v} ${t ? 'tournament' : 'cash'}: ${ACTIONS.map((a) => s.filter((r) => r[5] === a).length).join(' ')}`
        );
      }
    const calls = el.filter((r) => CALLS.has(r[5]));
    const ci = clusteredCi(calls);
    const wins = calls.filter((r) => r[8] > 0).length;
    const chops = calls.filter((r) => r[12]).length;
    out.push(
      `  calls: n ${ci.n} (hands ${ci.g}) mean ${f1(ci.m)} [${f1(ci.lo)}, ${f1(ci.hi)}] bb; won ${wins}; chopped ${chops}`
    );
    const priced = calls.filter((r) => r[14] / (r[15] + r[14]) >= MIN_PRICE);
    const pci = clusteredCi(priced);
    out.push(
      `  calls priced >= ${MIN_PRICE} (V84_MIN_CALL_PRICE): n ${pci.n} mean ${f1(pci.m)} [${f1(pci.lo)}, ${f1(pci.hi)}] bb; won ${priced.filter((r) => r[8] > 0).length}`
    );
    for (const [label, keep] of [
      ['plo4', (r: Row) => r[1] === 'plo4'],
      ['plo5', (r: Row) => r[1] === 'plo5'],
      ['plo6', (r: Row) => r[1] === 'plo6'],
      ['cash', (r: Row) => r[2] === 0],
      ['tournament', (r: Row) => r[2] === 1],
    ] as const) {
      const sl = priced.filter(keep);
      if (!sl.length) continue;
      const c = clusteredCi(sl);
      out.push(`    ${label}: n ${c.n} mean ${f1(c.m)} [${f1(c.lo)}, ${f1(c.hi)}]`);
    }
    const chopAny = fs.filter((r) => r[12]).length;
    out.push(
      `  chops among all ${fs.length} flush_second decisions (any action, any exclusion): ${chopAny}`
    );
    const raises = el.filter((r) => r[5] === 'raise' || r[5] === 'all_in_raise');
    for (const r of raises)
      out.push(`  re-raise: ${r[0]} ${r[1]} ${r[5]} ev ${r[8]} vs ${r[18] ?? 'no showdown'}`);
    // 3. Every call: size, price, required equity, result, what beat it.
    out.push(
      '  hand | variant fmt | action | raise/pot | to call | pot | price = needed equity | EV bb | chop | showdown'
    );
    for (const r of calls) {
      const price = r[14] / (r[15] + r[14]);
      foundIds.add(r[0].slice(0, 8));
      allCalls.push(r);
      out.push(
        `  ${r[0]} | ${r[1]} ${r[2] ? 'tour' : 'cash'} | ${r[5]} | ${f3(r[6] as number)} | ${r[14]} | ${r[15]} | ${f3(price)} | ${r[8]} | ${r[12] ? 'yes' : 'no'} | ${r[18] ?? 'none'}`
      );
    }
  }
  // 4. Pooled price summary and the binomial bound on the true win rate.
  const prices = allCalls.map((r) => r[14] / (r[15] + r[14])).sort((a, b) => a - b);
  const n = allCalls.length;
  const won = allCalls.filter((r) => r[8] > 0).length;
  out.push(`\n## Pooled flush_second calls: ${n}, won ${won}`);
  if (n) {
    const q = (p: number) => prices[Math.min(n - 1, Math.floor(p * (n - 1)))];
    out.push(
      `needed equity: min ${f3(prices[0])}, median ${f3(q(0.5))}, max ${f3(prices[n - 1])}, mean ${f3(prices.reduce((a, b) => a + b, 0) / n)}`
    );
    const pr = allCalls.filter((r) => r[14] / (r[15] + r[14]) >= MIN_PRICE).length;
    out.push(
      `priced >= ${MIN_PRICE}: ${pr}; 0 wins in ${pr} bounds the win rate at ${f3(1 - 0.05 ** (1 / pr))} (one-sided 95%)`
    );
    if (won === 0) {
      out.push(
        `0 wins in ${n}: one-sided 95% upper bound on the true win rate ${f3(1 - 0.05 ** (1 / n))}; Clopper-Pearson two-sided 95% upper ${f3(1 - 0.025 ** (1 / n))}`
      );
    }
  }
  if (prior.length) {
    const missing = [...priorIds].filter((id) => !foundIds.has(id));
    const added = [...foundIds].filter((id) => !priorIds.has(id));
    out.push(
      `\n## Reconciliation with the earlier pull: prior ${priorIds.size} flush_second calls, found ${foundIds.size}; prior not found: ${missing.join(' ') || 'none'}; new here: ${added.join(' ') || 'none'}`
    );
  }
  console.log(out.join('\n'));
}

main();
