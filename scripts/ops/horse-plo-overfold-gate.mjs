#!/usr/bin/env node
// scripts/ops/horse-plo-overfold-gate.mjs
// THE PLO OVER-FOLD ALARM (2026-11-26, PLO-OWNER lead-7, lane HARDEN). Read-only. Method: horse-plo-overfold-gate-lib.mjs.
//
//   node scripts/ops/horse-plo-overfold-gate.mjs --since <ISO> --until <ISO> [--json] [--supabase-workdir <dir>]
//        [--prior <data.ts>] [--from-json <rows.json>] [--save-json <rows.json>]
//
// Reads PLO4/PLO5 cash hands with a person seated over [since - 3 days, until) (keyset pages, SELECT only, behind
// SET TRANSACTION READ ONLY). It selects NO hole cards: actions, seats and the profiles' Horse flag only. Counts every
// Horse decision heads-up on the turn or river facing a person's first bet, by street and size, and gates a cell
// whose fold rate is above the ceiling (people-measured where the people prior has the cell, else the break-even
// fold) by a multiple-comparison-corrected z. The people prior is read from
// server/src/engine/HorseOmahaFacingBetPeoplePrior.data.ts when that file exists and says source 'people-only'.
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
  PEOPLE_ONLY_SOURCE,
  PREVIOUS_DAYS,
  gateCells,
  overfoldSpots,
} from './horse-plo-overfold-gate-lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
export const DEFAULT_PRIOR = join(
  REPO_ROOT,
  'server/src/engine/HorseOmahaFacingBetPeoplePrior.data.ts'
);
const CHUNK_HOURS = 24;
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const tsOf = (v) =>
  Date.parse(
    String(v)
      .replace(' ', 'T')
      .replace(/\+00(:00)?$/, 'Z')
  );

/** One keyset page of hands. No hole-card, showdown or winner column is selected. */
export function overfoldSql({ from, to, after = null, limit = PAGE_ROWS }) {
  const page = keysetSql(after, { limit });
  const g = GAMES.map((x) => `'${x}'`).join(',');
  return `select h.id, h.created_at, h.game_variant gv, h.big_blind bb, h.button_seat btn, h.pot_size pot,
 (h.bomb_pot is not null) bomb, h.community_cards2 cc2,
 (select jsonb_agg(jsonb_build_array(p->'seat', p->>'userId', p->'stack', null,
    coalesce((select pr.is_horse from profiles pr where pr.id = ${PLAYER_PROFILE_ID('p')}), false)))
    from jsonb_array_elements(h.players) p) pl,
 (select jsonb_agg(jsonb_build_array(a->'seat', a->>'stage', a->>'action', a->'amount', a->>'origin', a->'dead',
    a->'publicNode'->'pot', a->'publicNode'->'toCall', a->>'userId') order by o)
    from jsonb_array_elements(h.actions) with ordinality t(a, o)) ac
from hand_history h
where h.created_at >= '${iso(from)}' and h.created_at < '${iso(to)}'
  and h.tournament_id is null and h.game_variant in (${g}) and h.has_human = true
  and h.bomb_pot is null and coalesce(cardinality(h.community_cards2), 0) = 0
  and exists (select 1 from jsonb_array_elements(h.players) p2 join profiles pr2 on pr2.id = ${PLAYER_PROFILE_ID('p2')}
              where pr2.is_horse = false)
  ${page.where}
${page.order}`;
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
  const o = { since: null, until: null, json: false, supabaseWorkdir: null, prior: DEFAULT_PRIOR };
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
    else if (a === '--prior') o.prior = val();
    else if (a === '--from-json') o.fromJson = val();
    else if (a === '--save-json') o.saveJson = val();
    else if (a === '-h' || a === '--help') o.help = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

/** Spots of rows, split into the range and the PREVIOUS_DAYS before it. */
export function spotsOf(rows, sinceMs, untilMs) {
  const current = [];
  const previous = [];
  const from = sinceMs - PREVIOUS_DAYS * 86400_000;
  for (const r of rows) {
    const t = tsOf(r.created_at);
    if (!(t >= from && t < untilMs)) continue;
    const spots = overfoldSpots(parseHand(r));
    (t >= sinceMs ? current : previous).push(...spots);
  }
  return { current, previous };
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
          .slice(1, 15)
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
  const from = o.since - PREVIOUS_DAYS * 86400_000;
  let rows;
  try {
    if (o.fromJson) {
      const j = JSON.parse(readFileSync(o.fromJson, 'utf8'));
      rows = Array.isArray(j) ? j : (j.rows ?? []);
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
      if (o.saveJson) writeFileSync(o.saveJson, JSON.stringify(rows));
    }
  } catch (e) {
    err(`Failed reading hands: ${String(e?.message ?? e).slice(0, 400)}`);
    return 70;
  }
  const { prior, note } =
    deps.prior !== undefined
      ? { prior: deps.prior, note: 'people prior (given)' }
      : loadPeoplePrior(o.prior);
  const { current, previous } = spotsOf(rows, o.since, o.until);
  const gate = gateCells({ current, previous, prior });
  const report = {
    since: iso(o.since),
    until: iso(o.until),
    previousSince: iso(from),
    hands: rows.length,
    prior: note,
    cells: gate.cells,
    gating: gate.gating,
    gate: { exitCode: gate.exitCode, line: gate.line, zBar: gate.zBar, tests: gate.tests },
  };
  if (o.json) out(JSON.stringify(report, null, 1));
  else for (const c of gate.cells) out(c.line);
  out(gate.line);
  return gate.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = runOverfoldGate(process.argv.slice(2));
}
