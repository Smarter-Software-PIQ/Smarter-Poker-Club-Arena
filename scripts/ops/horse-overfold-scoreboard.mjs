#!/usr/bin/env node
// scripts/ops/horse-overfold-scoreboard.mjs
// THE LIVE OVER-FOLD SCOREBOARD (2026-11-27 lead-8 over-fold wave 4, lane OFF). Read-only. Method:
// horse-overfold-scoreboard-lib.mjs.
//
//   node scripts/ops/horse-overfold-scoreboard.mjs --since <ISO> [--until <ISO>] [--build <engine_build prefix>]
//        [--people-days 14] [--json] [--out <board.md>] [--save-json <rows.json>] [--from-json <rows.json>]
//        [--prior <data.ts>] [--owner-map <json>] [--supabase-workdir <dir>]
//
// Reads every PLO4/PLO5 cash hand (table and Lightning, with or without a person) in [since, until), optionally only
// those the given engine build dealt (hand_history.engine_build), and the hands WITH a person over the trailing
// --people-days (people's own fold share; 0 skips that read). SELECT only, behind SET TRANSACTION READ ONLY; it
// selects NO hole-card, showdown or winner column. Counts every Horse decision facing a bet, raise or check-raise on
// the flop, turn and river by game, table / Lightning, street, players, size and bettor (person or Horse) against
// the pure-bluff break-even and the people ceiling, with the fold-through of every bet into a Horse-only field.
//
// Exit: 0 clean facing people, 1 a person cell over at the corrected bar, 2 no person cell has 20 decisions
// (a Horse-only board), 64 usage, 70 a read failed.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PAGE_ROWS, keysetSql, readPaged } from './horse-audit-paged-read.mjs';
import { PLAYER_PROFILE_ID } from './horse-hand-audit-holdem-lib.mjs';
import { queryReadOnly } from './horse-hand-audit-omaha.mjs';
import { parseHand } from './horse-hand-audit-omaha-lib/hand.mjs';
import {
  DEFAULT_OWNER_MAP,
  DEFAULT_PRIOR,
  loadOwnerMap,
  loadPeoplePrior,
  switchSql,
  switchesOf,
} from './horse-plo-overfold-gate.mjs';
import {
  PEOPLE_DAYS,
  boardTable,
  foldThroughBoard,
  scoreboard,
  scoreboardBets,
  scoreboardSpots,
} from './horse-overfold-scoreboard-lib.mjs';

const DAY = 86400_000;
const CHUNK_HOURS = 6;
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const BUILD = /^[0-9a-f]{6,40}$/;

/**
 * One keyset page of PLO4/PLO5 cash hands. No hole-card, showdown or winner column. Each seat carries the profile's
 * Horse flag and whether a profile row was found; each hand whether it was a Lightning hand and its engine build.
 * people = true: only hands with a person seated.
 */
export function scoreboardSql({
  from,
  to,
  after = null,
  limit = PAGE_ROWS,
  build = null,
  people = false,
}) {
  const page = keysetSql(after, { limit });
  if (build !== null && !BUILD.test(build)) throw new Error(`bad build ${build}`);
  return `select h.id, h.created_at, h.game_variant gv, h.big_blind bb, h.button_seat btn, h.pot_size pot,
 (h.bomb_pot is not null) bomb, h.community_cards2 cc2, false mtt, left(h.engine_build, 12) build,
 exists (select 1 from lightning_hand lh where lh.hand_history_id = h.id) lightning,
 (select jsonb_agg(jsonb_build_array(p->'seat', p->>'userId', p->'stack', null,
    coalesce((select pr.is_horse from profiles pr where pr.id = ${PLAYER_PROFILE_ID('p')}), false),
    exists (select 1 from profiles pk where pk.id = ${PLAYER_PROFILE_ID('p')})))
    from jsonb_array_elements(h.players) p) pl,
 (select jsonb_agg(jsonb_build_array(a->'seat', a->>'stage', a->>'action', a->'amount', a->>'origin', a->'dead',
    a->'publicNode'->'pot', a->'publicNode'->'toCall', a->>'userId') order by o)
    from jsonb_array_elements(h.actions) with ordinality t(a, o)) ac
from hand_history h
where h.created_at >= '${iso(from)}' and h.created_at < '${iso(to)}'
  and h.game_variant in ('plo4','plo5') and h.tournament_id is null
  and h.bomb_pot is null and coalesce(cardinality(h.community_cards2), 0) = 0
  ${build ? `and h.engine_build like '${build}%'` : ''}
  ${people ? 'and h.has_human = true' : ''}
  ${page.where}
${page.order}`;
}

export function parseArgs(argv) {
  const o = {
    since: null,
    until: Date.now(),
    build: null,
    peopleDays: PEOPLE_DAYS,
    json: false,
    out: null,
    saveJson: null,
    fromJson: null,
    prior: DEFAULT_PRIOR,
    ownerMap: DEFAULT_OWNER_MAP,
    supabaseWorkdir: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    const time = () => {
      const t = Date.parse(val());
      if (!Number.isFinite(t)) throw new Error(`${a}: not a time`);
      return t;
    };
    if (a === '--since') o.since = time();
    else if (a === '--until') o.until = time();
    else if (a === '--build') {
      o.build = val().toLowerCase();
      if (!BUILD.test(o.build)) throw new Error('--build: 6-40 hex characters');
    } else if (a === '--people-days') {
      o.peopleDays = Number(val());
      if (!(Number.isInteger(o.peopleDays) && o.peopleDays >= 0 && o.peopleDays <= 31))
        throw new Error('--people-days: an integer 0-31');
    } else if (a === '--json') o.json = true;
    else if (a === '--out') o.out = val();
    else if (a === '--save-json') o.saveJson = val();
    else if (a === '--from-json') o.fromJson = val();
    else if (a === '--prior') o.prior = val();
    else if (a === '--owner-map') o.ownerMap = val();
    else if (a === '--supabase-workdir') o.supabaseWorkdir = val();
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

/** Parsed hands of rows, with the venue, the build and the known seats (a profile row found). */
function handsOf(rows) {
  return rows.map((r) => {
    const hand = parseHand(r);
    hand.mtt = false;
    hand.venue = r.lightning === true ? 'lightning' : 'table';
    hand.build = r.build ?? null;
    hand.known = new Set((r.pl ?? []).filter((p) => p[5] !== false).map((p) => p[1]));
    return hand;
  });
}

/** Horse spots and bets of the range, people's spots of the people window, hand counts by game/venue/build. */
export function spotsOfRows(rangeRows, peopleRows) {
  const spots = [];
  const bets = [];
  const builds = {};
  for (const h of handsOf(rangeRows)) {
    const k = `${h.gv} ${h.venue} ${h.build ?? '?'}`;
    builds[k] = (builds[k] ?? 0) + 1;
    for (const x of scoreboardSpots(h, { known: h.known })) if (x.who === 'horse') spots.push(x);
    bets.push(...scoreboardBets(h, { known: h.known }));
  }
  const people = [];
  for (const h of handsOf(peopleRows))
    for (const x of scoreboardSpots(h, { known: h.known })) if (x.who === 'person') people.push(x);
  return { spots, bets, people, builds };
}

export function renderBoard(report, sb) {
  const L = [];
  L.push(
    `# Over-fold scoreboard ${report.since} .. ${report.until}${report.build ? ` (engine build ${report.build})` : ''}`
  );
  L.push('');
  L.push(
    `Hands read: ${report.hands} in range; ${report.peopleHands} with a person over the people window (${report.peopleSince} ..). By game, venue, build: ${
      Object.entries(report.builds)
        .map(([k, v]) => `${k} ${v}`)
        .join('; ') || '-'
    }.`
  );
  L.push(
    `Horse decisions facing aggression: ${report.spots} (facing a person ${report.personSpots}, facing a Horse ${report.horseSpots}). ${report.prior}. ${report.ownerMapNote}.`
  );
  L.push('');
  for (const l of sb.lines) L.push(`- ${l}`);
  L.push('');
  L.push('## Facing a PERSON (headline; gates at the corrected bar)');
  L.push('');
  if (sb.cells.some((c) => c.bettor === 'person'))
    L.push(...boardTable(sb.cells, { bettor: 'person' }));
  else L.push('No Horse decision faced a person in the range.');
  L.push('');
  L.push(
    "## Facing a HORSE (information: break-even says whether a pure bluff prints against the serving engine; the people ceiling is people's own fold share in the cell)"
  );
  L.push('');
  L.push(...boardTable(sb.cells, { bettor: 'horse' }));
  L.push('');
  L.push('## Fold-through of every bet / raise into a Horse-only field (on that street)');
  L.push('');
  L.push(...foldThroughBoard(sb.foldThrough));
  L.push('');
  return L;
}

export function runScoreboard(argv, deps = {}) {
  const out = deps.stdout ?? ((s) => process.stdout.write(`${s}\n`));
  const err = deps.stderr ?? ((s) => process.stderr.write(`${s}\n`));
  let o;
  try {
    o = parseArgs(argv);
    if (o.help) {
      out(
        readFileSync(fileURLToPath(import.meta.url), 'utf8')
          .split('\n')
          .slice(1, 19)
          .map((l) => l.replace(/^\/\/ ?/, ''))
          .join('\n')
      );
      return 0;
    }
    if (o.since === null) throw new Error('--since is required');
    if (!(o.since < o.until)) throw new Error('--since must be before --until');
  } catch (e) {
    err(`Error: ${e.message}`);
    return 64;
  }
  const { ownerMap, note: ownerMapNote } =
    deps.ownerMap !== undefined
      ? { ownerMap: deps.ownerMap, note: 'owner map (given)' }
      : loadOwnerMap(o.ownerMap);
  const peopleSince = o.until - o.peopleDays * DAY;
  let rangeRows;
  let peopleRows;
  let switches = null;
  try {
    if (o.fromJson) {
      const j = JSON.parse(readFileSync(o.fromJson, 'utf8'));
      rangeRows = j.rangeRows ?? [];
      peopleRows = j.peopleRows ?? [];
      switches = j.switches ?? null;
    } else {
      const q = deps.query ?? ((sql) => queryReadOnly(sql, { supabaseWorkdir: o.supabaseWorkdir }));
      const chunksOf = (a, b) => {
        const c = [];
        for (let t = a; t < b; t += CHUNK_HOURS * 3600_000)
          c.push([t, Math.min(b, t + CHUNK_HOURS * 3600_000)]);
        return c;
      };
      const keyOf = (r) => ({ ts: r.created_at, id: r.id });
      rangeRows = readPaged({
        chunks: chunksOf(o.since, o.until),
        sqlFor: ([a, b], after, limit) =>
          scoreboardSql({ from: a, to: b, after, limit, build: o.build }),
        query: q,
        keyOf,
      });
      peopleRows = o.peopleDays
        ? readPaged({
            chunks: chunksOf(peopleSince, o.until),
            sqlFor: ([a, b], after, limit) =>
              scoreboardSql({ from: a, to: b, after, limit, people: true }),
            query: q,
            keyOf,
          })
        : [];
      const sw = switchSql((ownerMap?.owners ?? []).map((x) => x.option));
      switches = sw ? switchesOf(q(sw)) : {};
      if (o.saveJson)
        writeFileSync(o.saveJson, JSON.stringify({ rangeRows, peopleRows, switches }));
    }
  } catch (e) {
    err(`Failed reading hands: ${String(e?.message ?? e).slice(0, 400)}`);
    return 70;
  }
  const { prior, note } =
    deps.prior !== undefined
      ? { prior: deps.prior, note: 'people prior (given)' }
      : loadPeoplePrior(o.prior);
  const { spots, bets, people, builds } = spotsOfRows(rangeRows, peopleRows);
  const sb = scoreboard({ spots, people, bets, prior, ownerMap, switches, sinceMs: o.since });
  const report = {
    since: iso(o.since),
    until: iso(o.until),
    build: o.build,
    peopleSince: iso(peopleSince),
    hands: rangeRows.length,
    peopleHands: peopleRows.length,
    builds,
    spots: spots.length,
    personSpots: spots.filter((x) => x.bettor === 'person').length,
    horseSpots: spots.filter((x) => x.bettor === 'horse').length,
    prior: note,
    ownerMapNote,
    switches,
    personTests: sb.personTests,
    zBar: sb.zBar,
    exitCode: sb.exitCode,
    lines: sb.lines,
    cells: sb.cells,
    foldThrough: sb.foldThrough,
    gating: sb.gating.map((c) => c.key),
  };
  const md = renderBoard(report, sb);
  if (o.out) writeFileSync(o.out, md.join('\n'));
  if (o.json) out(JSON.stringify(report, null, 1));
  else for (const l of md) out(l);
  return sb.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = runScoreboard(process.argv.slice(2));
}
