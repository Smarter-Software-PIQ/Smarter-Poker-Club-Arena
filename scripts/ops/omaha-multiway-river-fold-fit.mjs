#!/usr/bin/env node
/**
 * PLO4 / PLO5 cash MULTIWAY PEOPLE-ONLY FOLD TO A RIVER OPENING BET (PLO-OWNER lead-9 lane underbluff, 2026-11-27;
 * owner order "the stats need to be used against human players, not horses"). Feeds
 * server/src/engine/HorseOmahaMultiwayRiverFoldTables.json (HorseOmahaMultiwayRiverBluff.ts).
 *
 *   sql <fromISO> <toISO>                                   prints the SELECT-only pull (public actions; no hole card)
 *   fit --in <dir>[,<dir>...] --out <tables.json> --version <label>
 *
 * A pull file is the JSON array the SELECT returns. No column carries a hole card: the fit reads public actions only.
 * One answer per PERSON per spot: a river with nothing wagered yet, a first wager B into P made with two or more
 * opponents live, and each answer (fold, call, raise) given by a person before anybody raises. An answer by a Horse
 * never enters a cell (the pull marks each seat from profiles.is_horse; an answer whose recorded origin is
 * 'horse_policy' is dropped too); the stored HUD population rows are not read. The bettor may be a Horse or a person.
 * Cells: game | the turn line (chk: the turn was checked through; bet: the turn had a wager) | size (a<40, b40-70,
 * c70-110, d>110 per cent of the pot), and the same without the line ("all"). Each cell keeps n answers, folds,
 * raises, and eq = the sum over its answers of the multiway equilibrium fold of one opponent of N: the bettor is
 * indifferent when all N fold B / (P + B) of the time, so each folds (B / (P + B)) ^ (1 / N).
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const TO = new Set(['bet', 'raise', 'all_in', 'allin']);
const INC = new Set([
  'call',
  'sb',
  'bb',
  'post',
  'post_sb',
  'post_bb',
  'blind',
  'small_blind',
  'big_blind',
  'straddle',
  'ante',
  'bomb_ante',
]);
const FORCED = new Set([...INC, 'return'].filter((a) => a !== 'call'));
const STREETS = ['preflop', 'flop', 'turn', 'river'];

export function multiwayRiverFoldSql(from, to) {
  const iso = (d) => new Date(d).toISOString();
  return `select h.id, h.created_at, h.game_variant gv, h.big_blind bb, (h.bomb_pot is not null) bomb,
 (select jsonb_agg(jsonb_build_array(p->'seat', p->>'userId',
    coalesce((select pr.is_horse from profiles pr where pr.id::text = p->>'userId'), false)))
    from jsonb_array_elements(h.players) p) pl,
 (select jsonb_agg(jsonb_build_array(a->'seat', a->>'stage', a->>'action', a->'amount', a->>'origin', a->'dead',
    a->'publicNode'->'pot', a->>'userId') order by o)
    from jsonb_array_elements(h.actions) with ordinality t(a, o)) ac
from hand_history h
where h.created_at >= '${iso(from)}' and h.created_at < '${iso(to)}'
  and h.tournament_id is null and h.game_variant in ('plo4','plo5') and h.has_human = true
order by h.created_at`;
}

export const sizeCell = (r) =>
  r < 0.4 ? 'a<40' : r < 0.7 ? 'b40-70' : r <= 1.1 ? 'c70-110' : 'd>110';

/**
 * The people answers of one pulled hand. `row.pl` = [[seat, userId, isHorse, ...]] (a longer seat tuple whose LAST
 * boolean is the Horse flag is read too), `row.ac` = [[seat, stage, action, amount, origin, dead, publicPot, ...,
 * userId]] (the acting account is the last element).
 */
export function multiwayRiverAnswers(row) {
  const out = [];
  const gv = String(row.gv ?? '').toLowerCase();
  if ((gv !== 'plo4' && gv !== 'plo5') || row.bomb === true) return out;
  const horse = new Map();
  for (const p of row.pl ?? []) horse.set(p[1], p[p.length - 1] === true);
  const bySeat = new Map((row.pl ?? []).map((p) => [Number(p[0]), p[1]]));
  const level = { preflop: 0, flop: 0, turn: 0, river: 0 };
  const com = new Map();
  let pot = 0;
  const folded = new Set();
  let turnWager = false;
  let open = null; // the river first wager being answered
  for (const a of row.ac ?? []) {
    const stage = a[1];
    const act = String(a[2] ?? '').toLowerCase();
    if (!(stage in level)) continue;
    const amt = Number(a[3] ?? 0);
    const u = a[a.length - 1] ?? bySeat.get(Number(a[0]));
    if (!u) continue;
    const key = u + '|' + stage;
    const c = com.get(key) ?? 0;
    const forced = FORCED.has(act) || a[4] === 'forced';
    const wager = TO.has(act) && amt > level[stage] + 1e-9;
    if (!forced && stage === 'river') {
      if (open && u !== open.u && !open.closed) {
        if (horse.get(u) !== true && a[4] !== 'horse_policy')
          out.push({
            gv,
            line: turnWager ? 'bet' : 'chk',
            size: sizeCell(open.ratio),
            eq: open.eq,
            fold: act === 'fold',
            raise: wager,
          });
        if (wager) open.closed = true;
      } else if (!open && wager && level.river === 0) {
        const live = (row.pl ?? []).filter((p) => !folded.has(p[1]) && p[1] !== u).length;
        const p0 = a[6] !== null && a[6] !== undefined ? Number(a[6]) : pot;
        const b = amt - c;
        if (live >= 2 && p0 > 0 && b > 0)
          open = { u, ratio: b / p0, eq: Math.pow(b / (p0 + b), 1 / live), closed: false };
        else open = { u, ratio: 1, eq: 0.5, closed: true };
      }
    }
    if (act === 'fold') folded.add(u);
    else if (act === 'return') pot -= amt;
    else if (a[5] === true || act === 'ante' || act === 'bomb_ante') pot += amt;
    else if (TO.has(act)) {
      if (wager) {
        level[stage] = amt;
        if (stage === 'turn') turnWager = true;
      }
      const nv = Math.max(c, amt);
      pot += nv - c;
      com.set(key, nv);
    } else if (INC.has(act)) {
      com.set(key, c + amt);
      pot += amt;
      if (c + amt > level[stage]) level[stage] = c + amt;
    }
  }
  return out;
}

export function multiwayRiverFoldFit(rows, version) {
  const cells = {};
  let handsRead = 0;
  let from = null;
  let to = null;
  const seen = new Set();
  const add = (k, x) => {
    const c = (cells[k] ??= { n: 0, fold: 0, raise: 0, eq: 0 });
    c.n++;
    if (x.fold) c.fold++;
    if (x.raise) c.raise++;
    c.eq += x.eq;
  };
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    handsRead++;
    const t = String(row.created_at);
    if (!from || t < from) from = t;
    if (!to || t > to) to = t;
    for (const x of multiwayRiverAnswers(row)) {
      add(`${x.gv}|${x.line}|${x.size}`, x);
      add(`${x.gv}|all|${x.size}`, x);
    }
  }
  const sorted = {};
  for (const k of Object.keys(cells).sort())
    sorted[k] = { ...cells[k], eq: Math.round(cells[k].eq * 1e4) / 1e4 };
  return {
    version,
    note: 'People-only answers (responder not a Horse) to the first wager of a PLO4/PLO5 cash river made with two or more opponents live, by game, turn line (chk: turn checked through; bet: the turn had a wager) and size; eq = sum of the multiway equilibrium fold of one opponent of N, (B/(P+B))^(1/N). Public actions only. scripts/ops/omaha-multiway-river-fold-fit.mjs.',
    source: { from, to, handsRead },
    sizes: { 'a<40': [0, 0.4], 'b40-70': [0.4, 0.7], 'c70-110': [0.7, 1.1], 'd>110': [1.1, null] },
    cells: sorted,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const argv = process.argv.slice(2);
  const arg = (name, dflt) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
  };
  if (argv[0] === 'sql') console.log(multiwayRiverFoldSql(argv[1], argv[2]));
  else if (argv[0] === 'fit') {
    const rows = [];
    for (const dir of String(arg('in', '')).split(',').filter(Boolean))
      for (const f of readdirSync(dir)
        .filter((x) => x.endsWith('.json'))
        .sort())
        for (const r of JSON.parse(readFileSync(join(dir, f), 'utf8'))) rows.push(r);
    const t = multiwayRiverFoldFit(rows, arg('version', 'dev'));
    writeFileSync(arg('out'), JSON.stringify(t, null, 2) + '\n');
    console.log(t.source, Object.keys(t.cells).length, 'cells');
  } else {
    console.error('usage: sql <from> <to> | fit --in <dir,dir> --out <json> --version <label>');
    process.exit(2);
  }
}
