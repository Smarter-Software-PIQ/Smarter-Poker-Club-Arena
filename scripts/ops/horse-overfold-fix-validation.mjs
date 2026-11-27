#!/usr/bin/env node
// scripts/ops/horse-overfold-fix-validation.mjs
// DID THE OVER-FOLD FIX WORK? (2026-11-27, lead-8 over-fold swarm, lane of-validate). Read-only. Method:
// horse-overfold-fix-validation-lib.mjs; docs/ops/horse-overfold-fix-validation.md.
//
//   node scripts/ops/horse-overfold-fix-validation.mjs --option <name> [--on <ISO>] [--until <ISO>] [--json]
//        [--out <page.md>] [--supabase-workdir <dir>] [--from-json <rows.json>] [--save-json <rows.json>]
//
// For an option of scripts/ops/horse-overfold-owner-map.json: its ON instant (the last change to 'on' in
// ca_horse_style_switch_audit, or --on), then BEFORE (the same clock hours on each of the 7 days before ON) against
// AFTER (ON .. --until, default now) for every cell the option owns: Horse fold rate facing a person's first bet
// with n and z against the over-fold alarm's ceiling, fold-through vs break-even, realized bb per Horse call, and
// three river watch cells classed from SHOWN cards only. Reads PLO4/PLO5 cash hands with a person seated (the Omaha
// hand audit's SELECT: hole cards only for showdown entries not mucked), keyset pages, SET TRANSACTION READ ONLY.
//
// Exit: 0 VALIDATED or NOT YET, 1 a cell REGRESSED, 2 the option is not ON (nothing to validate), 64 usage, 70 a read
// failed.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readPaged } from './horse-audit-paged-read.mjs';
import { queryReadOnly } from './horse-hand-audit-omaha.mjs';
import { parseHand } from './horse-hand-audit-omaha-lib/hand.mjs';
import { auditSql } from './horse-hand-audit-omaha-lib/sql.mjs';
import { DEFAULT_OWNER_MAP, loadOwnerMap, loadPeoplePrior } from './horse-plo-overfold-gate.mjs';
import {
  BEFORE_DAYS,
  DAY,
  beforeWindows,
  collect,
  formatPage,
  validate,
} from './horse-overfold-fix-validation-lib.mjs';

const __filename = fileURLToPath(import.meta.url);
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const tsOf = (v) =>
  Date.parse(
    String(v)
      .replace(' ', 'T')
      .replace(/\+00(:00)?$/, 'Z')
  );
const OPTION_NAME = /^[A-Za-z][A-Za-z0-9]{2,80}$/;

/** The option's live state and the instant it last went ON. One SELECT. */
export function onSql(option) {
  if (!OPTION_NAME.test(option)) throw new Error('bad option name');
  return `select s.state, (select max(a.changed_at) from public.ca_horse_style_switch_audit a
    where a.option = s.option and a.new_state = 'on' and a.old_state is distinct from 'on') as on_at
from public.ca_horse_style_switch s where s.option = '${option}'`;
}

export function parseArgs(argv) {
  const o = {
    option: null,
    on: null,
    until: null,
    json: false,
    out: null,
    supabaseWorkdir: null,
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
      if (!/(Z|[+-]\d{2}:?\d{2})$/.test(v) || !Number.isFinite(Date.parse(v)))
        throw new Error(`${a} needs an ISO instant with a zone`);
      return Date.parse(v);
    };
    if (a === '--option') o.option = val();
    else if (a === '--on') o.on = instant();
    else if (a === '--until') o.until = instant();
    else if (a === '--json') o.json = true;
    else if (a === '--out') o.out = val();
    else if (a === '--supabase-workdir') o.supabaseWorkdir = val();
    else if (a === '--owner-map') o.ownerMap = val();
    else if (a === '--from-json') o.fromJson = val();
    else if (a === '--save-json') o.saveJson = val();
    else if (a === '-h' || a === '--help') o.help = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!o.help && !o.option) throw new Error('--option <name> is required');
  if (o.option && !OPTION_NAME.test(o.option)) throw new Error('--option is not an option name');
  return o;
}

export function runFixValidation(argv, deps = {}) {
  const out = deps.stdout ?? ((s) => process.stdout.write(`${s}\n`));
  const err = deps.stderr ?? ((s) => process.stderr.write(`${s}\n`));
  let o;
  try {
    o = parseArgs(argv);
  } catch (e) {
    err(`Error: ${e.message}`);
    return 64;
  }
  if (o.help) {
    out(
      readFileSync(__filename, 'utf8')
        .split('\n')
        .slice(1, 17)
        .map((l) => l.replace(/^\/\/ ?/, ''))
        .join('\n')
    );
    return 0;
  }
  const { ownerMap } =
    deps.ownerMap !== undefined ? { ownerMap: deps.ownerMap } : loadOwnerMap(o.ownerMap);
  const owner = (ownerMap?.owners ?? []).find((x) => x.option === o.option);
  if (!owner) {
    err(`Error: ${o.option} owns no over-fold cell in the owner map`);
    return 64;
  }
  const untilMs = o.until ?? Math.floor((deps.now ? deps.now() : Date.now()) / 60_000) * 60_000;
  const q = deps.query ?? ((sql) => queryReadOnly(sql, { supabaseWorkdir: o.supabaseWorkdir }));
  let rows;
  let onMs = o.on;
  try {
    if (o.fromJson) {
      const j = JSON.parse(readFileSync(o.fromJson, 'utf8'));
      rows = j.rows ?? [];
      onMs = onMs ?? j.onMs ?? null;
    } else {
      if (onMs === null) {
        const r = q(onSql(o.option))?.[0];
        if (!r || String(r.state).toLowerCase() !== 'on' || !Number.isFinite(tsOf(r.on_at))) {
          out(
            `Over-fold fix validation ${o.option}: not ON (state ${r?.state ?? 'no row'}): nothing to validate`
          );
          return 2;
        }
        onMs = tsOf(r.on_at);
      }
      if (!(onMs < untilMs)) throw new Error('the ON instant is not before --until');
      const from = Math.min(onMs - BEFORE_DAYS * DAY, untilMs - 14 * DAY);
      const games = owner.games.filter((g) => g === 'plo4' || g === 'plo5');
      const chunks = [];
      for (let t = from; t < untilMs; t += 12 * 3600_000)
        chunks.push([t, Math.min(untilMs, t + 12 * 3600_000)]);
      rows = readPaged({
        chunks,
        sqlFor: ([a, b], after, limit) => auditSql({ from: a, to: b, games, after, limit }),
        query: q,
        keyOf: (r) => ({ ts: r.created_at, id: r.id }),
      });
      if (o.saveJson) writeFileSync(o.saveJson, JSON.stringify({ onMs, rows }));
    }
  } catch (e) {
    err(`Failed reading: ${String(e?.message ?? e).slice(0, 400)}`);
    return 70;
  }
  if (!Number.isFinite(onMs)) {
    err('Error: no ON instant (give --on)');
    return 64;
  }
  const { prior } = deps.prior !== undefined ? { prior: deps.prior } : loadPeoplePrior();
  const before = beforeWindows(onMs, untilMs);
  const hands = rows.map((r) => parseHand(r));
  const S = collect(hands, { onMs, untilMs, before });
  const r = validate({ option: o.option, owner, S, prior, ownerMap });
  const beforeText =
    before.length === 1
      ? `${iso(before[0][0])} .. ${iso(before[0][1])}`
      : `the same clock hours on each of the ${before.length} days before (${iso(before[0][0])} .. ${iso(before[0][1])} first)`;
  const page = formatPage(r, {
    onIso: iso(onMs),
    untilIso: iso(untilMs),
    beforeText,
    hands: rows.length,
  });
  if (o.out) writeFileSync(o.out, page + '\n');
  if (o.json)
    out(
      JSON.stringify(
        {
          option: o.option,
          on: iso(onMs),
          until: iso(untilMs),
          verdict: r.verdict,
          cells: r.cells,
          watch: r.watch,
          gate: { exitCode: r.exitCode },
        },
        null,
        1
      )
    );
  else out(page);
  out(`Over-fold fix validation ${o.option}: ${r.verdict}`);
  return r.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = runFixValidation(process.argv.slice(2));
}
