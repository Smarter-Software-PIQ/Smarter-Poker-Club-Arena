#!/usr/bin/env node
/**
 * PLO4 / PLO5 cash HEADS-UP RIVER OPENING RANGES (PLO-OWNER lead-7 lane plo-postflop, 2026-11-26).
 * Feeds server/src/engine/HorseOmahaRiverOpeningRangeTables.json (HorseOmahaRiverOpeningBet.ts).
 *
 *   fit --in <dir of pull files> --horses <json [{id}] of profiles.is_horse> --out <tables.json> --version <label>
 *                                                                          (run from server/ with node --import tsx)
 *
 * The pull files are the SELECT-only extracts of scripts/ops/omaha-facing-bet-range-fit.mjs `pull` (public actions
 * and the hole cards of showdown entries with mucked = false only; never an unshown card).
 *
 * Three cells per game, heads-up rivers only (two players live at the first river action), no bomb pot, one board:
 *  checkfirst  the first river action was a CHECK by the player out of position: his strength;
 *  ipstart     the player in position, at the start of the river (before anyone acts): his strength.
 *  oopstart    the player out of position, at the start of the river: his strength.
 * And the heads-up river first-wager rates: `fta` (the first action is a wager) and `unopened` (every unopened
 * opportunity: the first action, and the in-position player's after a check).
 * Each cell is also split by whether the turn had a wager (`|bet` / `|check`), shrunk to the game cell by SHRINK_K
 * pseudo-samples.
 *
 * STRENGTH is the share of holdings of his own size (from the cards unseen to him) that beat his hand on the river
 * board: 0 is the nuts (the scale of omaha-facing-bet-range-fit.mjs and of HorseOmahaMeasuredBettorRange).
 *
 * SHOWDOWN BIAS: a player who folds later on the river, or who reaches a showdown and is not shown (mucked), is
 * never in the shown sample; that share is added as weak hands (the cell's own shown hands at strength >= WEAK_EDGE,
 * by their shape), as the facing-bet fit does. A hand that is not shown only counts as not shown: its cards are
 * never read (the pull carries none).
 *
 * WHOSE HANDS (OWNER ORDER 2026-11-26 12:21 PM Chicago: "the stats need to be used against human players, not
 * horses"; the pattern of omaha-opening-bluff-range-fit.mjs, review t4). Every cell and rate here is HIS range (the
 * opponent's) or his betting rate, so two families are kept and never pooled:
 *   cells, rates  PEOPLE's shown hands and PEOPLE's own river actions only. A player in the Horse list (`--horses`,
 *                 `select id from profiles where is_horse`, read-only) never enters them.
 *   heroCells     the Horses' own shown hands only, kept apart for the deciding Horse's own range; the engine reads
 *                 no opponent statistic from it.
 * Within a family a turn-split cell shrinks to its game cell by SHRINK_K; a game cell shrinks by SHRINK_K to the
 * neutral anchor, a random holding (each bin's share is its width on the strength scale), so a thin people cell
 * reads close to "no information" rather than borrowing Horse play. The decision function is the same for every
 * opponent; nobody is keyed by name.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const BIN_EDGES = [0, 0.01, 0.03, 0.07, 0.13, 0.2, 0.35, 0.55, 1];
export const WEAK_EDGE = 0.2;
export const SHRINK_K = 30;
/** a random holding: each strength bin's share is its width (strength is uniform over holdings) */
export const ANCHOR = BIN_EDGES.slice(1).map((e, i) => e - BIN_EDGES[i]);
const FORCED = new Set(['sb', 'bb', 'ante', 'post', 'post_sb', 'post_bb', 'blind', 'small_blind', 'big_blind', 'straddle', 'bomb_ante', 'return']);
const binOf = (p) => {
  for (let b = 0; b < BIN_EDGES.length - 1; b++) if (p < BIN_EDGES[b + 1]) return b;
  return BIN_EDGES.length - 2;
};
const W = (a) => a === 'bet' || a === 'raise' || a === 'all_in' || a === 'allin';
const engine = (f) => new URL(`../../server/src/engine/${f}`, import.meta.url).href;

/**
 * The fit itself, pure on its inputs: `rows` the pull rows, `horses` the Horse account ids. Returns the tables
 * (without version / source dates when `version` is omitted).
 */
export async function fitRiverOpeningRanges(rows, horses, version = 'test') {
  const { scoreOmahaHiPartial } = await import(engine('HorseEval.ts'));
  const { PairSet, countHoldingsWithout } = await import(engine('HorseOmahaFacingBetEv.ts'));
  const { omahaBetReadCard } = await import(engine('HorseOmahaBetRead.ts'));
  const HORSE = horses instanceof Set ? horses : new Set(horses);
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
  const families = { people: new Map(), horse: new Map() };
  const famOf = (u) => (HORSE.has(u) ? families.horse : families.people);
  const cell = (fam, k) => {
    let c = fam.get(k);
    if (!c) fam.set(k, (c = { hist: new Array(nb).fill(0), shown: 0, n: 0, lf: 0 }));
    return c;
  };
  let hands = 0, used = 0, from = null, to = null;
  // betting rates: people's own river actions only (a Horse's action never enters)
  const rates = new Map();
  const rate = (k, u, hit) => {
    if (HORSE.has(u)) return;
    const c = rates.get(k) ?? { n: 0, k: 0 };
    c.n++;
    if (hit) c.k++;
    rates.set(k, c);
  };
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
    const riverActors = [...new Set(river.map((x) => x.u))];
    if (riverActors.length !== 2) continue;
    if (live.length !== 2) continue;
    used++;
    const t = String(h.created_at);
    if (!from || t < from) from = t;
    if (!to || t > to) to = t;
    // shown hands: the pull's hc holds the cards of showdown entries with mucked = false only
    const shown = new Map();
    for (const [u, cs] of Object.entries(h.hc ?? {})) {
      const cards = (Array.isArray(cs) ? cs : []).map(omahaBetReadCard);
      if ((cards.length === 4 || cards.length === 5) && cards.every(Boolean)) shown.set(u, cards);
    }
    const turnWager = acts.some((x) => x.stage === 'turn' && W(x.act));
    const prev = turnWager ? 'bet' : 'check';
    const oop = river[0].u;
    const ip = riverActors.find((u) => u !== oop);
    const laterFold = (u) => river.some((x) => x.u === u && x.act === 'fold');
    const record = (key, u) => {
      const fam = famOf(u);
      const hole = shown.get(u);
      const p = hole ? strength(hole, board) : null;
      for (const k of [key, `${key}|${prev}`]) {
        const c = cell(fam, k);
        c.n++;
        if (laterFold(u)) c.lf++;
        else if (shown.size > 0 && !shown.has(u)) c.lf++;
        else if (shown.size === 0) c.lf++; // nobody shown and he did not fold: the other folded; not shown either way
        if (p !== null) {
          c.hist[binOf(p)]++;
          c.shown++;
        }
      }
    };
    if (river[0].act === 'check') record(`checkfirst|${v}`, oop);
    record(`ipstart|${v}`, ip);
    record(`oopstart|${v}`, oop);
    // first-wager rates on the heads-up river, by the acting player: first to act (out of position), and every
    // unopened opportunity
    rate(`fta|${v}`, oop, W(river[0].act));
    rate(`unopened|${v}`, oop, W(river[0].act));
    if (river[0].act === 'check' && river[1] && river[1].u === ip) rate(`unopened|${v}`, ip, W(river[1].act));
  }
  const norm = (hh) => {
    const s = hh.reduce((a, b) => a + b, 0);
    return s > 0 ? hh.map((x) => x / s) : null;
  };
  const corrected = (c) => {
    const base = norm(c.hist);
    if (!base) return null;
    const f = Math.max(0, Math.min(0.9, c.lf / Math.max(1, c.n)));
    const wn = norm(base.map((x, i) => (BIN_EDGES[i] >= WEAK_EDGE ? x : 0))) ?? base.map((_, i) => (i === nb - 1 ? 1 : 0));
    return base.map((x, i) => (1 - f) * x + f * wn[i]);
  };
  const mix = (c, parent) => {
    const own = c ? corrected(c) : null;
    if (!own) return parent;
    return own.map((x, i) => (c.shown * x + SHRINK_K * parent[i]) / (c.shown + SHRINK_K));
  };
  const r5 = (x) => Math.round(x * 1e5) / 1e5;
  const build = (fam) => {
    const out = {};
    for (const kind of ['checkfirst', 'ipstart', 'oopstart'])
      for (const v of ['plo4', 'plo5']) {
        const top = fam.get(`${kind}|${v}`);
        if (!top || !corrected(top)) continue;
        const parent = mix(top, ANCHOR);
        out[`${v}|${kind}`] = { hist: parent.map(r5), shown: top.shown, n: top.n, notShown: top.lf };
        for (const prev of ['bet', 'check']) {
          const c = fam.get(`${kind}|${v}|${prev}`);
          out[`${v}|${kind}|${prev}`] = {
            hist: mix(c, parent).map(r5),
            shown: c?.shown ?? 0,
            n: c?.n ?? 0,
            notShown: c?.lf ?? 0,
          };
        }
      }
    return out;
  };
  return {
    version,
    note: 'Measured by scripts/ops/omaha-river-opening-range-fit.mjs from PLO4/PLO5 cash hand_history (shown cards only, showdown bias corrected). Strength = share of holdings of his size that beat his hand on the river (0 = the nuts). cells and rates: PEOPLE only (players not in the Horse list): his range and his betting rate, each game cell shrunk by shrinkK to a random holding. heroCells: the Horses own shown hands only, never read as an opponent statistic.',
    source: { from, to, handsRead: hands, handsUsed: used },
    binEdges: BIN_EDGES,
    weakEdge: WEAK_EDGE,
    shrinkK: SHRINK_K,
    cells: build(families.people),
    heroCells: build(families.horse),
    rates: Object.fromEntries([...rates].map(([k, c]) => [k, { n: c.n, rate: Math.round((c.k / c.n) * 1e5) / 1e5 }])),
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (name) => {
    const i = argv.indexOf(`--${name}`);
    if (i >= 0 && argv[i + 1] !== undefined) return argv[i + 1];
    throw new Error(`--${name} is required`);
  };
  if (argv[0] !== 'fit') {
    console.log('usage: fit --in <dir> --horses <json> --out <tables.json> --version <label>');
    return;
  }
  const horses = JSON.parse(readFileSync(resolve(arg('horses')), 'utf8')).map((r) => r.id);
  if (!horses.length) throw new Error('--horses is empty: the people-only cells need the Horse list');
  const dir = resolve(arg('in'));
  const rows = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    let r;
    try { r = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { continue; }
    if (Array.isArray(r)) for (const h of r) rows.push(h);
  }
  const tables = await fitRiverOpeningRanges(rows, horses, arg('version'));
  writeFileSync(resolve(arg('out')), JSON.stringify(tables, null, 1) + '\n');
  const sum = (o) => Object.fromEntries(Object.entries(o).map(([k, c]) => [k, [c.n, c.shown, c.hist.map((x) => x.toFixed(3)).join(' ')]]));
  console.log(JSON.stringify({ source: tables.source, rates: tables.rates, cells: sum(tables.cells), heroCells: sum(tables.heroCells) }, null, 1));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
