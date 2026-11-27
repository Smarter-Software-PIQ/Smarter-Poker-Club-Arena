#!/usr/bin/env node
// scripts/ops/horse-plo-overfold-gate.mjs
// THE OVER-FOLD ALARM, EVERY CELL (2026-11-26 PLO-OWNER lead-7 lane HARDEN; every cell and Hold'em 2026-11-27
// lead-8 lane ALARM). Read-only. Method: horse-plo-overfold-gate-lib.mjs.
//
//   node scripts/ops/horse-plo-overfold-gate.mjs --since <ISO> --until <ISO> [--json] [--table] [--supabase-workdir <dir>]
//        [--prior <data.ts>] [--owner-map <json>] [--from-json <rows.json>] [--save-json <rows.json>]
//
// Reads PLO4/PLO5 cash and Hold'em cash and tournament hands with a person seated over
// [min(since - 3 days, until - 14 days), until) (keyset pages, SELECT only, behind SET TRANSACTION READ ONLY), and
// the live state of the options that own a cell (ca_horse_style_switch, SELECT). It selects NO hole cards: actions,
// seats and the profiles' Horse flag only; it never reads a HUD row. Counts every Horse decision facing a person's
// first bet on the flop, turn or river, by game, street, heads-up or multiway and size, and gates a cell whose fold
// rate is above its ceiling (people prior table, else people's own folds over the trailing 14 days, else minimum
// defence) by a multiple-comparison-corrected z, on the range or on the range pooled with the 3 days before it.
// Every gating cell says whether its fix option is ON (a regression, listed first) or OFF, or that it has no owner.
//
// Exit: 0 clean, 1 a cell gates, 2 too few decisions in every cell, 64 usage, 70 a read failed.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PAGE_ROWS, keysetSql, readPaged } from './horse-audit-paged-read.mjs';
import { PLAYER_PROFILE_ID } from './horse-hand-audit-holdem-lib.mjs';
import { queryReadOnly } from './horse-hand-audit-omaha.mjs';
import { parseHand } from './horse-hand-audit-omaha-lib/hand.mjs';
import {
  GAMES,
  PEOPLE_DAYS,
  PEOPLE_ONLY_SOURCE,
  PREVIOUS_DAYS,
  cellTable,
  gateCells,
  overfoldSpots,
} from './horse-plo-overfold-gate-lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
export const DEFAULT_PRIOR = join(
  REPO_ROOT,
  'server/src/engine/HorseOmahaFacingBetPeoplePrior.data.ts'
);
export const DEFAULT_OWNER_MAP = join(__dirname, 'horse-overfold-owner-map.json');
const CHUNK_HOURS = 24;
const DAY = 86400_000;
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const tsOf = (v) =>
  Date.parse(
    String(v)
      .replace(' ', 'T')
      .replace(/\+00(:00)?$/, 'Z')
  );

/**
 * One keyset page of hands. No hole-card, showdown or winner column is selected. Each seat carries the profile's
 * Horse flag and whether a profile row was found (a seat without one is neither a Horse nor counted as a person).
 * PLO4/PLO5: cash only. Hold'em: cash and tournaments (mtt says which).
 */
export function overfoldSql({ from, to, after = null, limit = PAGE_ROWS }) {
  const page = keysetSql(after, { limit });
  const g = GAMES.map((x) => `'${x}'`).join(',');
  return `select h.id, h.created_at, h.game_variant gv, h.big_blind bb, h.button_seat btn, h.pot_size pot,
 (h.bomb_pot is not null) bomb, h.community_cards2 cc2, (h.tournament_id is not null) mtt,
 (select jsonb_agg(jsonb_build_array(p->'seat', p->>'userId', p->'stack', null,
    coalesce((select pr.is_horse from profiles pr where pr.id = ${PLAYER_PROFILE_ID('p')}), false),
    exists (select 1 from profiles pk where pk.id = ${PLAYER_PROFILE_ID('p')})))
    from jsonb_array_elements(h.players) p) pl,
 (select jsonb_agg(jsonb_build_array(a->'seat', a->>'stage', a->>'action', a->'amount', a->>'origin', a->'dead',
    a->'publicNode'->'pot', a->'publicNode'->'toCall', a->>'userId') order by o)
    from jsonb_array_elements(h.actions) with ordinality t(a, o)) ac
from hand_history h
where h.created_at >= '${iso(from)}' and h.created_at < '${iso(to)}'
  and h.game_variant in (${g}) and (h.game_variant = 'nlh' or h.tournament_id is null) and h.has_human = true
  and h.bomb_pot is null and coalesce(cardinality(h.community_cards2), 0) = 0
  and exists (select 1 from jsonb_array_elements(h.players) p2 join profiles pr2 on pr2.id = ${PLAYER_PROFILE_ID('p2')}
              where pr2.is_horse = false)
  ${page.where}
${page.order}`;
}

const OPTION_NAME = /^[A-Za-z][A-Za-z0-9]{2,80}$/;
/** The live state of the owner options: one SELECT. since = the last change of state (else the row's update). */
export function switchSql(options) {
  const names = [...new Set(options)].filter((x) => OPTION_NAME.test(x));
  if (!names.length) return null;
  return `select s.option, s.state, coalesce((select max(a.changed_at) from public.ca_horse_style_switch_audit a
    where a.option = s.option and a.new_state is distinct from a.old_state), s.updated_at) as since
from public.ca_horse_style_switch s where s.option in (${names.map((x) => `'${x}'`).join(',')}) order by s.option`;
}
export function switchesOf(rows) {
  const out = {};
  for (const r of rows ?? [])
    if (r && typeof r.option === 'string')
      out[r.option] = {
        state: String(r.state ?? '').toLowerCase(),
        since: Number.isFinite(tsOf(r.since)) ? iso(tsOf(r.since)) : null,
      };
  return out;
}
/** The owner map (a committed JSON file), or null with the reason. Never throws. */
export function loadOwnerMap(path = DEFAULT_OWNER_MAP) {
  try {
    const map = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(map?.owners)) return { ownerMap: null, note: 'owner map: no owners list' };
    return { ownerMap: map, note: `owner map ${path.replace(REPO_ROOT + '/', '')}` };
  } catch (e) {
    return {
      ownerMap: null,
      note: `owner map unreadable (${String(e?.message ?? e).slice(0, 80)})`,
    };
  }
}

/** The people prior (a generated .data.ts object literal), or null with the reason. Never throws. */
export function loadPeoplePrior(path = DEFAULT_PRIOR) {
  if (!path || !existsSync(path)) return { prior: null, note: `no people prior at ${path}` };
  try {
    const text = readFileSync(path, 'utf8');
    const start = text.indexOf('{', text.search(/export const \w+\s*(:[^=]+)?=/));
    const end = text.lastIndexOf('}');
    if (start < 0 || end < start) return { prior: null, note: 'people prior: no object literal' };
    const body = text.slice(start, end + 1);
    // a generated data file in this repository: an object literal of keys, numbers, strings and null
    const prior = new Function(`"use strict"; return (${body});`)();
    if (prior?.source !== PEOPLE_ONLY_SOURCE)
      return { prior: null, note: `people prior ignored: source is not '${PEOPLE_ONLY_SOURCE}'` };
    return { prior, note: `people prior ${path.replace(REPO_ROOT + '/', '')}` };
  } catch (e) {
    return {
      prior: null,
      note: `people prior unreadable (${String(e?.message ?? e).slice(0, 80)})`,
    };
  }
}

export function parseArgs(argv) {
  const o = {
    since: null,
    until: null,
    json: false,
    table: false,
    supabaseWorkdir: null,
    prior: DEFAULT_PRIOR,
    ownerMap: DEFAULT_OWNER_MAP,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
      return v;
    };
    const instant = () => {
      const v = val();
      const t = Date.parse(v);
      if (!/(Z|[+-]\d{2}:?\d{2})$/.test(v) || !Number.isFinite(t))
        throw new Error(`${a} needs an ISO instant with a zone`);
      return t;
    };
    if (a === '--since') o.since = instant();
    else if (a === '--until') o.until = instant();
    else if (a === '--json') o.json = true;
    else if (a === '--supabase-workdir') o.supabaseWorkdir = val();
    else if (a === '--table') o.table = true;
    else if (a === '--prior') o.prior = val();
    else if (a === '--owner-map') o.ownerMap = val();
    else if (a === '--from-json') o.fromJson = val();
    else if (a === '--save-json') o.saveJson = val();
    else if (a === '-h' || a === '--help') o.help = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

/** Where the read starts: the previous days before the range, or people's trailing window, whichever is earlier. */
export const readFrom = (sinceMs, untilMs) =>
  Math.min(sinceMs - PREVIOUS_DAYS * DAY, untilMs - PEOPLE_DAYS * DAY);

/**
 * Spots of rows: the Horses' of the range (current) and of the PREVIOUS_DAYS before it (previous), and people's
 * own over the trailing PEOPLE_DAYS that end with the range (people).
 */
export function spotsOf(rows, sinceMs, untilMs) {
  const current = [];
  const previous = [];
  const people = [];
  const prevFrom = sinceMs - PREVIOUS_DAYS * DAY;
  const peopleFrom = untilMs - PEOPLE_DAYS * DAY;
  for (const r of rows) {
    const t = tsOf(r.created_at);
    if (!(t >= Math.min(prevFrom, peopleFrom) && t < untilMs)) continue;
    const hand = parseHand(r);
    hand.mtt = r.mtt === true;
    // a seat is a known player only where its profile row was found (rows saved before that column: trusted)
    const known = new Set((r.pl ?? []).filter((p) => p[5] !== false).map((p) => p[1]));
    for (const x of overfoldSpots(hand, { known })) {
      if (x.who === 'person') {
        if (t >= peopleFrom) people.push(x);
      } else if (t >= sinceMs) current.push(x);
      else if (t >= prevFrom) previous.push(x);
    }
  }
  return { current, previous, people };
}

export function runOverfoldGate(argv, deps = {}) {
  const out = deps.stdout ?? ((s) => process.stdout.write(`${s}\n`));
  const err = deps.stderr ?? ((s) => process.stderr.write(`${s}\n`));
  let o;
  try {
    o = parseArgs(argv);
    if (o.help) {
      out(
        readFileSync(fileURLToPath(import.meta.url), 'utf8')
          .split('\n')
          .slice(1, 18)
          .map((l) => l.replace(/^\/\/ ?/, ''))
          .join('\n')
      );
      return 0;
    }
    if (o.since === null || o.until === null) throw new Error('--since and --until are required');
    if (!(o.since < o.until)) throw new Error('--since must be before --until');
  } catch (e) {
    err(`Error: ${e.message}`);
    return 64;
  }
  const from = readFrom(o.since, o.until);
  const { ownerMap, note: ownerNote } =
    deps.ownerMap !== undefined
      ? { ownerMap: deps.ownerMap, note: 'owner map (given)' }
      : loadOwnerMap(o.ownerMap);
  let rows;
  let switches = null;
  try {
    if (o.fromJson) {
      const j = JSON.parse(readFileSync(o.fromJson, 'utf8'));
      rows = Array.isArray(j) ? j : (j.rows ?? []);
      switches = Array.isArray(j) ? null : (j.switches ?? null);
    } else {
      const q = deps.query ?? ((sql) => queryReadOnly(sql, { supabaseWorkdir: o.supabaseWorkdir }));
      const chunks = [];
      for (let t = from; t < o.until; t += CHUNK_HOURS * 3600_000)
        chunks.push([t, Math.min(o.until, t + CHUNK_HOURS * 3600_000)]);
      rows = readPaged({
        chunks,
        sqlFor: ([a, b], after, limit) => overfoldSql({ from: a, to: b, after, limit }),
        query: q,
        keyOf: (r) => ({ ts: r.created_at, id: r.id }),
      });
      const sw = switchSql((ownerMap?.owners ?? []).map((x) => x.option));
      switches = sw ? switchesOf(q(sw)) : {};
      if (o.saveJson) writeFileSync(o.saveJson, JSON.stringify({ rows, switches }));
    }
  } catch (e) {
    err(`Failed reading hands: ${String(e?.message ?? e).slice(0, 400)}`);
    return 70;
  }
  const { prior, note } =
    deps.prior !== undefined
      ? { prior: deps.prior, note: 'people prior (given)' }
      : loadPeoplePrior(o.prior);
  const { current, previous, people } = spotsOf(rows, o.since, o.until);
  const previousSince = o.since - PREVIOUS_DAYS * DAY;
  const gate = gateCells({
    current,
    previous,
    people,
    prior,
    ownerMap,
    switches,
    sinceMs: o.since,
    previousSinceMs: previousSince,
  });
  const report = {
    since: iso(o.since),
    until: iso(o.until),
    previousSince: iso(previousSince),
    peopleSince: iso(o.until - PEOPLE_DAYS * DAY),
    hands: rows.length,
    prior: note,
    ownerMap: ownerNote,
    switches,
    cells: gate.cells,
    gating: gate.gating,
    fixOn: gate.fixOn,
    gate: {
      exitCode: gate.exitCode,
      line: gate.line,
      lines: gate.lines,
      zBar: gate.zBar,
      tests: gate.tests,
    },
  };
  if (o.json) out(JSON.stringify(report, null, 1));
  else if (o.table) for (const l of cellTable(gate.cells)) out(l);
  else for (const c of gate.cells) if (c.n > 0 || c.previousN > 0) out(c.line);
  for (const l of gate.lines) out(l);
  out(gate.line);
  return gate.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = runOverfoldGate(process.argv.slice(2));
}
