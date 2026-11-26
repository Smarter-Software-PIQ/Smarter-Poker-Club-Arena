#!/usr/bin/env node
/**
 * PLO4 / PLO5 cash HEADS-UP PEOPLE-ONLY FOLD TO AN OPENING BET, TURN AND RIVER (PLO-OWNER lead-7 lane plo-bluffs,
 * 2026-11-26; owner order "the stats need to be used against human players, not horses"). Feeds
 * server/src/engine/HorseOmahaPeopleFoldTables.json (HorseOmahaPeopleFold.ts).
 *
 *   fit --in <dir of pull files> --horses <json [{id}] of profiles.is_horse> --out <tables.json> --version <label>
 *
 * The pull files are the SELECT-only extracts of scripts/ops/omaha-facing-bet-range-fit.mjs `pull` (public actions
 * only are read here; no hole card is used). The Horse list is `select id from profiles where is_horse` (read-only).
 *
 * One answer per spot: a heads-up street (two players live), the first wager of the street (nothing to call before
 * it), and the answer of the other player when that player is a PERSON (not in the Horse list). Horse answers never
 * enter a cell; the stored HUD population rows are not read (they are almost all Horse play). The bettor may be a
 * Horse or a person. Cells: game | street | the bettor's line (agg: the bettor made the last wager of the street
 * before; vsAgg: the other player did; chk: nobody did) | size (a<40, b40-70, c70-110, d>110 per cent of the pot),
 * and the same without the line ("all"). Each cell keeps n answers, folds, raises, and eq = the sum over its answers
 * of the equilibrium fold B / (P + B) of the bet answered (the fold a minimum-defence player gives that bet).
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
};
if (argv[0] !== 'fit') {
  console.error('usage: fit --in <dir> --horses <json> --out <json> --version <label>');
  process.exit(2);
}
const dir = arg('in');
const HORSE = new Set(JSON.parse(readFileSync(arg('horses'), 'utf8')).map((r) => r.id));
const FORCED = new Set(['sb', 'bb', 'ante', 'post', 'post_sb', 'post_bb', 'blind', 'small_blind', 'big_blind', 'straddle', 'bomb_ante', 'return']);
const TO = new Set(['bet', 'raise', 'all_in', 'allin']);
const INC = new Set(['call', 'sb', 'bb', 'post', 'post_sb', 'post_bb', 'blind', 'small_blind', 'big_blind', 'straddle', 'ante', 'bomb_ante']);
const STREETS = ['preflop', 'flop', 'turn', 'river'];
const sizeOf = (f) => (f < 0.4 ? 'a<40' : f < 0.7 ? 'b40-70' : f <= 1.1 ? 'c70-110' : 'd>110');

function decisionsOf(h) {
  const pl = h.pl ?? [];
  const uidOf = new Map(pl.map((p) => [Number(p[0]), p[1]]));
  const level = { preflop: 0, flop: 0, turn: 0, river: 0 };
  const com = new Map();
  let dead = 0;
  const folded = new Set();
  const out = [];
  for (const a of h.ac ?? []) {
    const [seat, stage, act0, amt0, dd, pnPot, , auid] = a;
    const act = String(act0 ?? '').toLowerCase();
    if (act.startsWith('rit_board')) return null;
    if (!(stage in level)) continue;
    const amt = Number(amt0 ?? 0);
    const u = auid ?? uidOf.get(Number(seat));
    if (!u) continue;
    const k = `${u}|${stage}`;
    const c = com.get(k) ?? 0;
    if (!FORCED.has(act)) {
      const live = pl.filter((p) => !folded.has(p[1])).length;
      let pot = [...com.values()].reduce((x, y) => x + y, 0) + dead;
      if (pnPot != null) pot = Number(pnPot);
      const raise = act === 'bet' || act === 'raise' || ((act === 'all_in' || act === 'allin') && amt > level[stage] + 1e-9);
      out.push({ u, street: stage, act, amt, pot, raise, live, streetLevel: level[stage] });
    }
    if (act === 'fold') folded.add(u);
    else if (dd === true || act === 'ante' || act === 'bomb_ante') dead += amt;
    else if (TO.has(act)) {
      if (amt > level[stage] + 1e-9) level[stage] = amt;
      com.set(k, Math.max(c, amt));
    } else if (INC.has(act)) {
      com.set(k, c + amt);
      if (c + amt > level[stage]) level[stage] = c + amt;
    }
  }
  return out;
}

const cells = {};
const add = (key, fold, raise, eq) => {
  const c = (cells[key] ??= { n: 0, fold: 0, raise: 0, eq: 0 });
  c.n++;
  c.fold += fold;
  c.raise += raise;
  c.eq += eq;
};
let read = 0;
let used = 0;
let from = null;
let to = null;
for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
  let rows;
  try {
    rows = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  } catch {
    continue;
  }
  if (!Array.isArray(rows)) continue;
  for (const h of rows) {
    read++;
    const v = String(h.gv ?? '').toLowerCase();
    if (v !== 'plo4' && v !== 'plo5') continue;
    if (h.bomb === true || h.cc2 || (Array.isArray(h.rit) && h.rit.length)) continue;
    const d = decisionsOf(h);
    if (!d) continue;
    used++;
    const t = String(h.created_at);
    if (!from || t < from) from = t;
    if (!to || t > to) to = t;
    for (const st of ['turn', 'river']) {
      const sd = d.filter((x) => x.street === st);
      const prev = STREETS[STREETS.indexOf(st) - 1];
      const i = sd.findIndex((x) => x.raise);
      if (i < 0) continue;
      const b = sd[i];
      if (b.streetLevel !== 0 || b.live !== 2 || !(b.pot > 0) || !(b.amt > 0)) continue;
      const r = sd[i + 1];
      if (!r || r.u === b.u || HORSE.has(r.u)) continue;
      const wagered = (u) => d.some((x) => x.u === u && x.street === prev && x.raise);
      const anyW = d.some((x) => x.street === prev && x.raise);
      const line = wagered(b.u) ? 'agg' : anyW ? 'vsAgg' : 'chk';
      const ratio = b.amt / b.pot;
      const fold = r.act === 'fold' ? 1 : 0;
      const raise = r.raise ? 1 : 0;
      const eq = b.amt / (b.pot + b.amt);
      add(`${v}|${st}|all|${sizeOf(ratio)}`, fold, raise, eq);
      add(`${v}|${st}|${line}|${sizeOf(ratio)}`, fold, raise, eq);
    }
  }
}
for (const c of Object.values(cells)) c.eq = Math.round(c.eq * 1e4) / 1e4;
const out = {
  version: arg('version', 'v1'),
  note: 'People-only answers (responder not a Horse) to the first wager of a heads-up PLO4/PLO5 cash turn or river, by game, street, bettor line and size; eq = sum of the equilibrium fold B/(P+B) of the bets answered. scripts/ops/omaha-people-fold-fit.mjs.',
  source: { from, to, handsRead: read, handsUsed: used },
  sizes: { 'a<40': [0, 0.4], 'b40-70': [0.4, 0.7], 'c70-110': [0.7, 1.1], 'd>110': [1.1, null] },
  cells: Object.fromEntries(Object.entries(cells).sort(([a], [b]) => (a < b ? -1 : 1))),
};
writeFileSync(arg('out'), JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify({ read, used, cells: Object.keys(cells).length, from, to }));
