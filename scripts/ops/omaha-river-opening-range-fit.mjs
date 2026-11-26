#!/usr/bin/env node
/**
 * PLO4 / PLO5 cash HEADS-UP RIVER OPENING RANGES (PLO-OWNER lead-7 lane plo-postflop, 2026-11-26).
 * Feeds server/src/engine/HorseOmahaRiverOpeningRangeTables.json (HorseOmahaRiverOpeningBet.ts).
 *
 *   fit --in <dir of pull files> --out <tables.json> --version <label>     (run from server/ with node --import tsx)
 *
 * The pull files are the SELECT-only extracts of scripts/ops/omaha-facing-bet-range-fit.mjs `pull` (public actions
 * and the hole cards of showdown entries with mucked = false only; never an unshown card).
 *
 * Two cells per game, heads-up rivers only (two players live at the first river action), no bomb pot, one board:
 *  checkfirst  the first river action was a CHECK by the player out of position: his strength;
 *  ipstart     the player in position, at the start of the river (before anyone acts): his strength.
 *  oopstart    the player out of position, at the start of the river: his strength.
 * And the heads-up river first-wager rates: `fta` (the first action is a wager) and `unopened` (every unopened
 * opportunity: the first action, and the in-position player's after a check).
 * Each is also split by whether the turn had a wager (`|bet` / `|check`), shrunk to the game cell by SHRINK_K
 * pseudo-samples.
 *
 * STRENGTH is the share of holdings of his own size (from the cards unseen to him) that beat his hand on the river
 * board: 0 is the nuts (the scale of omaha-facing-bet-range-fit.mjs and of HorseOmahaMeasuredBettorRange).
 *
 * SHOWDOWN BIAS: a player who folds later on the river, or who reaches a showdown and is not shown (mucked), is
 * never in the shown sample; that share is added as weak hands (the cell's own shown hands at strength >= WEAK_EDGE,
 * by their shape), as the facing-bet fit does. Identity-free: every player who made the action is pooled, nobody is
 * keyed.
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
    if (!c) cells.set(k, (c = { hist: new Array(nb).fill(0), shown: 0, n: 0, lf: 0 }));
    return c;
  };
  let hands = 0, used = 0, from = null, to = null;
  const rates = new Map();
  const rate = (k, hit) => { const c = rates.get(k) ?? { n: 0, k: 0 }; c.n++; if (hit) c.k++; rates.set(k, c); };
  const dir = resolve(arg('in'));
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    let rows;
    try { rows = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { continue; }
    if (!Array.isArray(rows)) continue;
    for (const h of rows) {
      hands++;
      if (h.bomb === true || h.cc2 || (Array.isArray(h.rit) && h.rit.length)) continue;
      const board = (h.cc ?? []).map(omahaBetReadCard);
      if (board.length !== 5 || board.some((c) => !c)) continue;
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
        if (!u || !['preflop', 'flop', 'turn', 'river'].includes(stage)) continue;
        acts.push({ u, stage, act, amt: Number(amt0 ?? 0) });
      }
      if (rit) continue;
      const foldedBefore = new Set(acts.filter((x) => x.act === 'fold' && x.stage !== 'river').map((x) => x.u));
      const river = acts.filter((x) => x.stage === 'river');
      if (!river.length) continue;
      const live = [...new Set((h.pl ?? []).map((p) => p[1]))].filter((u) => !foldedBefore.has(u));
      // players live at the river: those who acted on the river or are all in (no river action) and not folded
      const riverActors = [...new Set(river.map((x) => x.u))];
      if (riverActors.length !== 2) continue;
      if (live.length !== 2) continue;
      used++;
      const t = String(h.created_at);
      if (!from || t < from) from = t;
      if (!to || t > to) to = t;
      const shown = new Map();
      for (const [u, cs] of Object.entries(h.hc ?? {})) {
        const cards = (Array.isArray(cs) ? cs : []).map(omahaBetReadCard);
        if ((cards.length === 4 || cards.length === 5) && cards.every(Boolean)) shown.set(u, cards);
      }
      const turnWager = acts.some((x) => x.stage === 'turn' && (x.act === 'bet' || x.act === 'raise' || x.act === 'all_in' || x.act === 'allin'));
      const prev = turnWager ? 'bet' : 'check';
      const oop = river[0].u;
      const ip = riverActors.find((u) => u !== oop);
      const laterFold = (u) => river.some((x) => x.u === u && x.act === 'fold');
      const record = (key, u) => {
        for (const k of [key, `${key}|${prev}`]) {
          const c = cell(k);
          c.n++;
          if (laterFold(u)) c.lf++;
          else if (shown.size > 0 && !shown.has(u)) c.lf++;
          else if (shown.size === 0) c.lf++; // nobody shown and he did not fold: the other folded; not shown either way
          const hole = shown.get(u);
          if (hole) {
            c.hist[binOf(strength(hole, board))]++;
            c.shown++;
          }
        }
      };
      if (river[0].act === 'check') record(`checkfirst|${v}`, oop);
      record(`ipstart|${v}`, ip);
      record(`oopstart|${v}`, oop);
      // first-wager rates on the heads-up river: first to act (out of position), and every unopened opportunity
      const W = (a) => a === 'bet' || a === 'raise' || a === 'all_in' || a === 'allin';
      rate(`fta|${v}`, W(river[0].act));
      rate(`unopened|${v}`, W(river[0].act));
      if (river[0].act === 'check' && river[1] && river[1].u === ip) rate(`unopened|${v}`, W(river[1].act));
    }
  }
  const norm = (h) => {
    const s = h.reduce((a, b) => a + b, 0);
    return s > 0 ? h.map((x) => x / s) : null;
  };
  const corrected = (c) => {
    const base = norm(c.hist);
    if (!base) return null;
    const f = Math.max(0, Math.min(0.9, c.lf / Math.max(1, c.n)));
    const wn = norm(base.map((x, i) => (BIN_EDGES[i] >= WEAK_EDGE ? x : 0))) ?? base.map((_, i) => (i === nb - 1 ? 1 : 0));
    return base.map((x, i) => (1 - f) * x + f * wn[i]);
  };
  const r5 = (x) => Math.round(x * 1e5) / 1e5;
  const out = {};
  for (const kind of ['checkfirst', 'ipstart', 'oopstart'])
    for (const v of ['plo4', 'plo5']) {
      const top = cells.get(`${kind}|${v}`);
      if (!top) continue;
      const parent = corrected(top);
      out[`${v}|${kind}`] = { hist: parent.map(r5), shown: top.shown, n: top.n, notShown: top.lf };
      for (const prev of ['bet', 'check']) {
        const c = cells.get(`${kind}|${v}|${prev}`);
        if (!c) continue;
        const own = corrected(c);
        const mixed = own ? own.map((x, i) => (c.shown * x + SHRINK_K * parent[i]) / (c.shown + SHRINK_K)) : parent;
        out[`${v}|${kind}|${prev}`] = { hist: mixed.map(r5), shown: c.shown, n: c.n, notShown: c.lf };
      }
    }
  const tables = {
    version: arg('version'),
    note: 'Measured by scripts/ops/omaha-river-opening-range-fit.mjs from PLO4/PLO5 cash hand_history (shown cards only, showdown bias corrected). Strength = share of holdings of his size that beat his hand on the river (0 = the nuts).',
    source: { from, to, handsRead: hands, handsUsed: used },
    binEdges: BIN_EDGES,
    weakEdge: WEAK_EDGE,
    shrinkK: SHRINK_K,
    cells: out,
    rates: Object.fromEntries([...rates].map(([k, c]) => [k, { n: c.n, rate: Math.round((c.k / c.n) * 1e5) / 1e5 }])),
  };
  writeFileSync(resolve(arg('out')), JSON.stringify(tables, null, 1) + '\n');
  console.log(JSON.stringify({ hands, used, cells: Object.fromEntries(Object.entries(out).map(([k, c]) => [k, [c.n, c.shown, c.hist.map((x) => x.toFixed(3)).join(' ')]])) }, null, 1));
}
if (cmd === 'fit') await fit();
else console.log('usage: fit --in <dir> --out <tables.json> --version <label>');
