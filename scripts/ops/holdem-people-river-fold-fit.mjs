#!/usr/bin/env node
/**
 * NLH cash HEADS-UP PEOPLE-ONLY FOLD TO THE RIVER'S FIRST BET (PLO-OWNER + Hold'em owner lead-8 lane nlhriver,
 * 2026-11-27; owner order "the stats need to be used against human players, not horses"). Feeds
 * server/src/engine/HorseHoldemPeopleRiverFoldTables.json (HorseHoldemPeopleRiverFold.ts).
 *
 *   sql  --from <ISO> --to <ISO>                      prints the SELECT-only pull of one window (public actions only)
 *   fit  --in <hands.ndjson[.gz]> --out <tables.json> --version <label>
 *
 * The pull selects, for every NLH hand with a person seated (hand_history.has_human), the postflop PUBLIC actions as
 * [userId, stage, action, amount, pot before the action, toCall, players live] and the seated accounts as
 * [userId, profiles.is_horse]. No hole card, showdown or summary column is selected.
 *
 * One answer per spot: a heads-up river (two players live at the bet), the FIRST wager of the river (nothing to call
 * before it), and the first answer of the other player when that player is a PERSON (profiles.is_horse false). An
 * answer by a Horse never enters a cell; the stored HUD population rows ('*', almost all Horse play) are not read. The
 * bettor may be a Horse or a person. Cash tables only (tournament_id null), one board, no bomb pot. Cells:
 * river | the bettor's line (agg: the bettor made the LAST bet / raise / all-in of the turn; vsAgg: the other player
 * did; chk: nobody did; all: every line) | size (a<40, b40-70, c70-110, d>110 per cent of the pot before the bet), plus
 * the two OPPONENT-HUD size cells river|all|sm (at most 0.7 pot) and river|all|bg (above it), which carry the mean
 * equilibrium fold of the bets a lifetime record cell was counted on. Each cell keeps n answers, folds, raises, and
 * eq = the sum over its answers of the equilibrium fold B / (P + B) of the bet answered.
 *
 * The fit also prints the between-player prior strength k = p(1 - p) / tau^2 - 1 (beta-binomial method of moments on
 * people with at least 5 answers) per size cell, for cash alone and for cash and tournaments pooled.
 */
import { createReadStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
};
const WAGER = new Set(['bet', 'raise', 'all_in']);
export const sizeOf = (f) =>
  f < 0.4 ? 'a<40' : f < 0.7 ? 'b40-70' : f <= 1.1 ? 'c70-110' : 'd>110';

export function pullSql(from, to) {
  return `select h.id, h.created_at ca, (h.tournament_id is not null) t, h.big_blind bb, (h.bomb_pot is not null) bomb, (h.community_cards2 is not null) cc2,
 (select jsonb_agg(jsonb_build_array(pl->>'userId', coalesce(p.is_horse,false))) from jsonb_array_elements(h.players) pl left join profiles p on p.id = case when pl->>'userId' ~ '^[0-9a-f-]{36}$' then (pl->>'userId')::uuid end) pl,
 (select jsonb_agg(jsonb_build_array(e.a->>'userId', e.a->>'stage', e.a->>'action', (e.a->>'amount')::numeric, (e.a->'publicNode'->>'pot')::numeric, (e.a->'publicNode'->>'toCall')::numeric,
    (select count(*) from jsonb_array_elements(e.a->'publicNode'->'seats') st where (st->>6)::int=0 and ((st->>3)::numeric>0 or (st->>2)::numeric>0))) order by e.ord)
   from jsonb_array_elements(h.actions) with ordinality e(a,ord) where e.a->>'stage' in ('flop','turn','river') and e.a->>'action' in ('fold','call','raise','all_in','check','bet')) ac
 from hand_history h where h.has_human and h.game_variant='nlh' and h.created_at>='${from}' and h.created_at<'${to}'`;
}

/** The river answer of one pulled hand, or null: { user, horse, line, ratio, eq, fold, raise }. */
export function riverAnswerOf(h) {
  if (!h || h.bomb || h.cc2 || !Array.isArray(h.ac)) return null;
  const horse = new Map((h.pl ?? []).map((p) => [p[0], p[1] === true]));
  const river = h.ac.filter((a) => a[1] === 'river');
  const i = river.findIndex((a) => WAGER.has(a[2]));
  if (i < 0 || i + 1 >= river.length) return null;
  const b = river[i];
  const r = river[i + 1];
  const pot = Number(b[4] ?? 0);
  const amt = Number(b[3] ?? 0);
  if (Number(b[5] ?? 0) > 1e-9 || Number(b[6] ?? 0) !== 2 || !(pot > 0) || !(amt > 0)) return null;
  if (r[0] === b[0] || !['fold', 'call', 'raise', 'all_in'].includes(r[2])) return null;
  let last = null;
  for (const a of h.ac) if (a[1] === 'turn' && WAGER.has(a[2])) last = a[0];
  return {
    user: r[0],
    horse: horse.get(r[0]) === true,
    line: last === null ? 'chk' : last === b[0] ? 'agg' : 'vsAgg',
    ratio: amt / pot,
    eq: amt / (pot + amt),
    fold: r[2] === 'fold' ? 1 : 0,
    raise: r[2] === 'raise' || (r[2] === 'all_in' && Number(r[3] ?? 0) > amt + 1e-9) ? 1 : 0,
  };
}

function priorStrength(users, min) {
  const xs = [...users.values()].filter((u) => u.n >= min);
  if (xs.length < 5) return null;
  const N = xs.reduce((s, u) => s + u.n, 0);
  const F = xs.reduce((s, u) => s + u.fold, 0);
  const p = F / N;
  const S = xs.reduce((s, u) => s + u.n * (u.fold / u.n - p) ** 2, 0);
  const tau2 =
    (S - (xs.length - 1) * p * (1 - p)) / (N - xs.reduce((s, u) => s + u.n * u.n, 0) / N);
  return {
    players: xs.length,
    answers: N,
    fold: Math.round(p * 1e4) / 1e4,
    k: tau2 > 1e-6 ? Math.round(((p * (1 - p)) / tau2 - 1) * 10) / 10 : null,
  };
}

async function main() {
  if (argv[0] === 'sql') {
    console.log(pullSql(arg('from'), arg('to')));
    return;
  }
  if (argv[0] !== 'fit') {
    console.error(
      'usage: sql --from <ISO> --to <ISO> | fit --in <ndjson[.gz]> --out <json> --version <label>'
    );
    process.exit(2);
  }
  const file = arg('in');
  const input = file.endsWith('.gz')
    ? createReadStream(file).pipe(createGunzip())
    : createReadStream(file);
  const cells = {};
  const add = (key, a) => {
    const c = (cells[key] ??= { n: 0, fold: 0, raise: 0, eq: 0 });
    c.n++;
    c.fold += a.fold;
    c.raise += a.raise;
    c.eq += a.eq;
  };
  const per = new Map();
  const note = (key, a) => {
    if (!per.has(key)) per.set(key, new Map());
    const u = per.get(key).get(a.user) ?? { n: 0, fold: 0 };
    u.n++;
    u.fold += a.fold;
    per.get(key).set(a.user, u);
  };
  let read = 0;
  let used = 0;
  let from = null;
  let to = null;
  for await (const line of createInterface({ input })) {
    if (!line.trim()) continue;
    const h = JSON.parse(line);
    read++;
    const a = riverAnswerOf(h);
    if (!a || a.horse) continue;
    const hud = a.ratio > 0.7 ? 'bg' : 'sm';
    note(`${h.t ? 'tournament' : 'cash'}|${hud}`, a);
    note(`pooled|${hud}`, a);
    if (h.t) continue;
    used++;
    const t = String(h.ca);
    if (!from || t < from) from = t;
    if (!to || t > to) to = t;
    add(`river|all|${sizeOf(a.ratio)}`, a);
    add(`river|${a.line}|${sizeOf(a.ratio)}`, a);
    add(`river|all|${hud}`, a);
  }
  for (const c of Object.values(cells)) c.eq = Math.round(c.eq * 1e4) / 1e4;
  const strength = {};
  for (const [key, users] of [...per.entries()].sort()) strength[key] = priorStrength(users, 5);
  const out = {
    version: arg('version', 'v1'),
    note: "People-only answers (responder not a Horse) to the first wager of a heads-up NLH cash river, by the bettor's line and the bet's size; eq = sum of the equilibrium fold B/(P+B) of the bets answered. sm / bg are the OPPONENT-HUD size cells (at most 0.7 pot / above). scripts/ops/holdem-people-river-fold-fit.mjs.",
    source: { from, to, handsRead: read, answersUsed: used },
    sizes: { 'a<40': [0, 0.4], 'b40-70': [0.4, 0.7], 'c70-110': [0.7, 1.1], 'd>110': [1.1, null] },
    priorStrength: strength,
    cells: Object.fromEntries(Object.entries(cells).sort(([a], [b]) => (a < b ? -1 : 1))),
  };
  writeFileSync(arg('out'), JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify({ read, used, cells: Object.keys(cells).length, from, to, strength }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main();
