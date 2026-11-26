#!/usr/bin/env node
/**
 * PLO4 / PLO5 cash HEADS-UP TURN AND RIVER RANGES BY POSITION, LINE AND BOARD TEXTURE (PLO-OWNER lead-7 lane
 * plo-bluffs, 2026-11-26). Feeds server/src/engine/HorseOmahaOpeningBluffRangeTables.json
 * (HorseOmahaOpeningBluff.ts).
 *
 *   fit --in <dir of pull files> --out <tables.json> --version <label>     (run from server/ with node --import tsx)
 *
 * The pull files are the SELECT-only extracts of scripts/ops/omaha-facing-bet-range-fit.mjs `pull` (public actions
 * and the hole cards of showdown entries with mucked = false only; never an unshown card).
 *
 * One cell per game, street (turn, river), role, line and board texture; heads-up streets only (two players live at
 * the street's first action), no bomb pot, one board:
 *  role   ip        the player in position at the start of the street (before anyone acts);
 *         oop       the player out of position at the start of the street;
 *         oopcheck  the player out of position after his CHECK opened the street.
 *  line   agg   he made the last wager of the street before;  def  somebody else did;  chk  nobody wagered there.
 *  tex    paired (a rank twice on the board), flush (three or more cards of a suit), plain; each texture cell is
 *         shrunk to its line cell by SHRINK_K pseudo-samples, each line cell to its role cell.
 *
 * STRENGTH is the share of holdings of his own size (from the cards unseen to him) that beat his hand on the
 * street's board NOW: 0 is the nuts (the scale of omaha-river-opening-range-fit.mjs).
 *
 * SHOWDOWN BIAS: a player who folds later, or who reaches a showdown and is not shown (mucked), is never in the shown
 * sample; that share is added as weak hands (the cell's own shown hands at strength >= WEAK_EDGE, by their shape).
 * A player whose opponent folded (he won without a showdown) is unknown either way: counting him as weak would call
 * every bet that took the pot a weak hand, and leaving him out would drop the bets that got folds. The opponent's
 * fold cannot depend on cards he does not see, only on the public action, so the cell is cut into strata by the
 * player's own action on the street (no wager; a first wager of 0.7 pot or less; a bigger wager or a raise), each
 * stratum is corrected on its own shown and lost hands, and the strata are weighted by how often each happens (every
 * outcome counted). Identity-free: every player who was in the role is pooled, nobody is keyed.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const cmd = argv[0];
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && argv[i + 1] !== undefined) return argv[i + 1];
  if (dflt !== undefined) return dflt;
  throw new Error(`--${name} is required`);
};
export const BIN_EDGES = [0, 0.01, 0.03, 0.07, 0.13, 0.2, 0.35, 0.55, 1];
export const WEAK_EDGE = 0.2;
export const SHRINK_K = 30;
const FORCED = new Set(['sb', 'bb', 'ante', 'post', 'post_sb', 'post_bb', 'blind', 'small_blind', 'big_blind', 'straddle', 'bomb_ante', 'return']);
const binOf = (p) => {
  for (let b = 0; b < BIN_EDGES.length - 1; b++) if (p < BIN_EDGES[b + 1]) return b;
  return BIN_EDGES.length - 2;
};
const W = (a) => a === 'bet' || a === 'raise' || a === 'all_in' || a === 'allin';
export const textureOf = (board) => {
  const ranks = new Map();
  const suits = new Map();
  for (const c of board) {
    ranks.set(c.rank, (ranks.get(c.rank) ?? 0) + 1);
    suits.set(c.suit, (suits.get(c.suit) ?? 0) + 1);
  }
  if ([...ranks.values()].some((n) => n >= 2)) return 'paired';
  if ([...suits.values()].some((n) => n >= 3)) return 'flush';
  return 'plain';
};

async function fit() {
  const { scoreOmahaHiPartial } = await import(resolve('src/engine/HorseEval.ts'));
  const { PairSet, countHoldingsWithout } = await import(resolve('src/engine/HorseOmahaFacingBetEv.ts'));
  const { omahaBetReadCard } = await import(resolve('src/engine/HorseOmahaBetRead.ts'));
  const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'];
  const DECK = [];
  for (const s of SUITS) for (const r of '23456789TJQKA') DECK.push({ rank: r, suit: s });
  const ck = (c) => `${c.rank}${c.suit}`;
  const choose = (n, k) => {
    let o = 1;
    for (let i = 1; i <= k; i++) o = (o * (n - k + i)) / i;
    return Math.round(o);
  };
  function strength(hole, board) {
    const known = new Set([...hole, ...board].map(ck));
    const unseen = DECK.filter((c) => !known.has(ck(c)));
    const m = unseen.length;
    const mine = scoreOmahaHiPartial(hole, board);
    const bar = new PairSet(m);
    const two = [unseen[0], unseen[0]];
    for (let i = 0; i < m; i++) {
      two[0] = unseen[i];
      for (let j = i + 1; j < m; j++) {
        two[1] = unseen[j];
        if (scoreOmahaHiPartial(two, board) > mine) bar.add(i, j);
      }
    }
    return 1 - countHoldingsWithout(m, hole.length, bar) / choose(m, hole.length);
  }
  const nb = BIN_EDGES.length - 1;
  const cells = new Map();
  const cell = (k) => {
    let c = cells.get(k);
    if (!c) cells.set(k, (c = { hist: new Array(nb).fill(0), shown: 0, n: 0, lf: 0, strata: {} }));
    return c;
  };
  let hands = 0, used = 0, from = null, to = null;
  const dir = resolve(arg('in'));
  const ORDER = ['preflop', 'flop', 'turn', 'river'];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    let rows;
    try { rows = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { continue; }
    if (!Array.isArray(rows)) continue;
    for (const h of rows) {
      hands++;
      if (h.bomb === true || h.cc2 || (Array.isArray(h.rit) && h.rit.length)) continue;
      const board = (h.cc ?? []).map(omahaBetReadCard);
      if (board.length < 4 || board.some((c) => !c)) continue;
      const v = String(h.gv).toLowerCase();
      if (v !== 'plo4' && v !== 'plo5') continue;
      const uidOf = new Map((h.pl ?? []).map((p) => [Number(p[0]), p[1]]));
      const acts = [];
      let rit = false;
      for (const a of h.ac ?? []) {
        const [seat, stage, act0, amt0] = a;
        const act = String(act0 ?? '').toLowerCase();
        if (act.startsWith('rit_board')) rit = true;
        if (FORCED.has(act)) continue;
        const u = a[7] ?? uidOf.get(Number(seat));
        if (!u || !ORDER.includes(stage)) continue;
        acts.push({ u, stage, act, amt: Number(amt0 ?? 0), pot: a[5] == null ? null : Number(a[5]) });
      }
      if (rit) continue;
      const shown = new Map();
      for (const [u, cs] of Object.entries(h.hc ?? {})) {
        const cards = (Array.isArray(cs) ? cs : []).map(omahaBetReadCard);
        if ((cards.length === 4 || cards.length === 5) && cards.every(Boolean)) shown.set(u, cards);
      }
      let any = false;
      for (const st of ['turn', 'river']) {
        const nbd = st === 'turn' ? 4 : 5;
        if (board.length < nbd) continue;
        const sb = board.slice(0, nbd);
        const si = ORDER.indexOf(st);
        const foldedBefore = new Set(acts.filter((x) => x.act === 'fold' && ORDER.indexOf(x.stage) < si).map((x) => x.u));
        const here = acts.filter((x) => x.stage === st);
        if (!here.length) continue;
        const live = [...new Set((h.pl ?? []).map((p) => p[1]))].filter((u) => !foldedBefore.has(u));
        const actors = [...new Set(here.map((x) => x.u))];
        if (actors.length !== 2 || live.length !== 2) continue;
        any = true;
        const prevActs = acts.filter((x) => x.stage === ORDER[si - 1] && W(x.act));
        const lastAgg = prevActs.length ? prevActs[prevActs.length - 1].u : null;
        const lineOf = (u) => (lastAgg === null ? 'chk' : lastAgg === u ? 'agg' : 'def');
        const tex = textureOf(sb);
        const oop = here[0].u;
        const ip = actors.find((u) => u !== oop);
        const laterFold = (u) => acts.some((x) => x.u === u && x.act === 'fold' && ORDER.indexOf(x.stage) >= si);
        // his own action on this street: the stratum (see SHOWDOWN BIAS)
        const stratumOf = (u) => {
          const w = here.find((x) => x.u === u && W(x.act));
          if (!w) return 'nobet';
          const first = here.find((x) => W(x.act)) === w;
          const ratio = first && w.pot !== null && w.pot > 0 ? w.amt / w.pot : 1;
          return w.act !== 'bet' || ratio > 0.7 ? 'big' : 'small';
        };
        const record = (role, u) => {
          const line = lineOf(u);
          const s = stratumOf(u);
          let p = null;
          const hole = shown.get(u);
          if (hole) p = strength(hole, sb);
          const lost = laterFold(u) || (shown.size > 0 && !shown.has(u));
          for (const k of [`${v}|${st}|${role}`, `${v}|${st}|${role}|${line}`, `${v}|${st}|${role}|${line}|${tex}`]) {
            const c = cell(k);
            const g = (c.strata[s] ??= { hist: new Array(nb).fill(0), shown: 0, n: 0, lf: 0 });
            c.n++;
            g.n++;
            if (lost) {
              c.lf++;
              g.lf++;
            }
            if (p !== null) {
              c.hist[binOf(p)]++;
              c.shown++;
              g.hist[binOf(p)]++;
              g.shown++;
            }
          }
        };
        record('ip', ip);
        record('oop', oop);
        if (here[0].act === 'check') record('oopcheck', oop);
      }
      if (any) {
        used++;
        const t = String(h.created_at);
        if (!from || t < from) from = t;
        if (!to || t > to) to = t;
      }
    }
  }
  const norm = (h) => {
    const s = h.reduce((a, b) => a + b, 0);
    return s > 0 ? h.map((x) => x / s) : null;
  };
  const correctedOne = (c) => {
    const base = norm(c.hist);
    if (!base) return null;
    const f = Math.max(0, Math.min(0.9, c.lf / Math.max(1, c.lf + c.shown)));
    const wn = norm(base.map((x, i) => (BIN_EDGES[i] >= WEAK_EDGE ? x : 0))) ?? base.map((_, i) => (i === nb - 1 ? 1 : 0));
    return base.map((x, i) => (1 - f) * x + f * wn[i]);
  };
  // each stratum (his own action on the street: no wager, a small first wager, a big wager or a raise) corrected on
  // its own outcomes, weighted by how often the stratum happens (every outcome counted); a stratum with fewer than
  // MIN_STRATUM shown hands takes the cell's pooled correction
  const MIN_STRATUM = 15;
  const corrected = (c) => {
    const pooled = correctedOne(c);
    if (!pooled) return null;
    const out = new Array(nb).fill(0);
    let w = 0;
    for (const g of Object.values(c.strata)) {
      const h = g.shown >= MIN_STRATUM ? correctedOne(g) : pooled;
      for (let i = 0; i < nb; i++) out[i] += g.n * h[i];
      w += g.n;
    }
    return w > 0 ? out.map((x) => x / w) : pooled;
  };
  const r5 = (x) => Math.round(x * 1e5) / 1e5;
  const mix = (c, parent) => {
    const own = c ? corrected(c) : null;
    if (!own) return parent;
    return own.map((x, i) => (c.shown * x + SHRINK_K * parent[i]) / (c.shown + SHRINK_K));
  };
  const out = {};
  for (const v of ['plo4', 'plo5'])
    for (const st of ['turn', 'river'])
      for (const role of ['ip', 'oop', 'oopcheck']) {
        const top = cells.get(`${v}|${st}|${role}`);
        const root = top ? corrected(top) : null;
        if (!root) continue;
        for (const line of ['agg', 'def', 'chk']) {
          const lc = cells.get(`${v}|${st}|${role}|${line}`);
          const lh = mix(lc, root);
          out[`${v}|${st}|${role}|${line}`] = { hist: lh.map(r5), shown: lc?.shown ?? 0, n: lc?.n ?? 0, notShown: lc?.lf ?? 0 };
          for (const tex of ['paired', 'flush', 'plain']) {
            const tc = cells.get(`${v}|${st}|${role}|${line}|${tex}`);
            out[`${v}|${st}|${role}|${line}|${tex}`] = { hist: mix(tc, lh).map(r5), shown: tc?.shown ?? 0, n: tc?.n ?? 0, notShown: tc?.lf ?? 0 };
          }
        }
      }
  const tables = {
    version: arg('version'),
    note: 'Measured by scripts/ops/omaha-opening-bluff-range-fit.mjs from PLO4/PLO5 cash hand_history (shown cards only, showdown bias corrected). Strength = share of holdings of his size that beat his hand on the street board now (0 = the nuts). Cell = game|street|role|line|texture.',
    source: { from, to, handsRead: hands, handsUsed: used },
    binEdges: BIN_EDGES,
    weakEdge: WEAK_EDGE,
    shrinkK: SHRINK_K,
    cells: out,
  };
  writeFileSync(resolve(arg('out')), JSON.stringify(tables, null, 1) + '\n');
  console.log(JSON.stringify({ hands, used, cells: Object.fromEntries(Object.entries(out).filter(([k]) => k.split('|').length === 4).map(([k, c]) => [k, [c.n, c.shown, c.hist.map((x) => x.toFixed(3)).join(' ')]])) }, null, 1));
}
if (cmd === 'fit') await fit();
else console.log('usage: fit --in <dir> --out <tables.json> --version <label>');
