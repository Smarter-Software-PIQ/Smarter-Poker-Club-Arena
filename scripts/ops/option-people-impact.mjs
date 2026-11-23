#!/usr/bin/env node
/**
 * Option people impact CLI (read-only). For every live Horse change in the lookback (switch audit
 * rows and runtime settings versions), compares people's results against the horses in the games
 * the change governs, before vs after. See option-people-impact-lib.mjs for the method and limits.
 *
 * Security invariants (same route as holdem-blanket-scoreboard.mjs):
 *   - one read-only WITH query via `supabase db query --linked -o json --agent=no`
 *     (assertReadOnlySql refuses anything else);
 *   - aggregate output only: no hand id, account id, name or card leaves the query;
 *   - never reads .env or database credentials.
 *
 * Usage: node scripts/ops/option-people-impact.mjs [options]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { querySupabaseReadOnly } from './holdem-blanket-scoreboard.mjs';
import {
  DEFAULT_LOOKBACK_DAYS,
  DEFAULT_MIN_HANDS,
  DEFAULT_WINDOW_HOURS,
  MAX_LOOKBACK_DAYS,
  MAX_WINDOW_HOURS,
  buildEvents,
  buildImpactReport,
  buildImpactSql,
  formatImpactMarkdown,
  normalizeBuckets,
  parseOverrideScopes,
  unwrapImpactRow,
} from './option-people-impact-lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

export const USAGE = `Usage: node scripts/ops/option-people-impact.mjs [options]

Options:
  --json                    Emit the report as JSON
  --sql                     Print the read-only SQL and exit (run it on any read-only path)
  --from-json <file>        Build the report from saved query output instead of querying
  --out <file>              Also write the markdown report to <file>
  --focus <option>          List this option first (repeatable; "settings" for runtime settings)
  --lookback-days <1..${MAX_LOOKBACK_DAYS}>  Changes in the last N days (default ${DEFAULT_LOOKBACK_DAYS})
  --window-hours <1..${MAX_WINDOW_HOURS}>   Hours before and after each change (default ${DEFAULT_WINDOW_HOURS})
  --min-hands <n>           Hands needed each side for a verdict (default ${DEFAULT_MIN_HANDS})
  --supabase-workdir <dir>  Override the auto-resolved linked Supabase workdir
  -h, --help                Show this help text
`;

function intArg(name, raw, lo, hi) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < lo || n > hi)
    throw new Error(`${name} must be an integer ${lo}..${hi}`);
  return n;
}

export function parseArgs(argv) {
  const o = {
    json: false,
    sql: false,
    fromJson: null,
    out: null,
    focus: [],
    lookbackDays: DEFAULT_LOOKBACK_DAYS,
    windowHours: DEFAULT_WINDOW_HOURS,
    minHands: DEFAULT_MIN_HANDS,
    supabaseWorkdir: null,
    help: false,
  };
  const args = Array.isArray(argv) ? argv : [];
  const need = (i, name) => {
    if (args[i] === undefined) throw new Error(`${name} requires a value`);
    return args[i];
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') o.json = true;
    else if (a === '--sql') o.sql = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else if (a === '--from-json') o.fromJson = need(++i, a);
    else if (a === '--out') o.out = need(++i, a);
    else if (a === '--focus') o.focus.push(need(++i, a));
    else if (a === '--lookback-days')
      o.lookbackDays = intArg(a, need(++i, a), 1, MAX_LOOKBACK_DAYS);
    else if (a === '--window-hours') o.windowHours = intArg(a, need(++i, a), 1, MAX_WINDOW_HOURS);
    else if (a === '--min-hands') o.minHands = intArg(a, need(++i, a), 1, 1000000);
    else if (a === '--supabase-workdir') o.supabaseWorkdir = need(++i, a);
    else throw new Error(`Unknown argument: ${a}`);
  }
  return o;
}

export function loadScopeTexts(repoRoot = REPO_ROOT) {
  try {
    return parseOverrideScopes(
      readFileSync(join(repoRoot, 'server/src/engine/HorseOptionSwitch.ts'), 'utf8')
    );
  } catch {
    return {};
  }
}

/** Query output -> report. Exported for tests. */
export function reportFromQueryOutput(raw, { windowHours, minHands, scopeTexts = {} }) {
  const row = unwrapImpactRow(raw);
  const events = buildEvents({ audit: row.audit, settings: row.settings }, scopeTexts);
  return buildImpactReport({
    events,
    buckets: normalizeBuckets(row.buckets),
    readAtMs: Date.parse(row.read_at),
    windowHours,
    minHands,
  });
}

export function runCli(argv, deps = {}) {
  const stdout = deps.stdout ?? ((s) => process.stdout.write(`${s}\n`));
  const stderr = deps.stderr ?? ((s) => process.stderr.write(`${s}\n`));
  let o;
  try {
    o = parseArgs(argv);
  } catch (err) {
    stderr(`Error: ${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`);
    return 2;
  }
  if (o.help) {
    stdout(USAGE);
    return 0;
  }
  const sql = buildImpactSql({ lookbackDays: o.lookbackDays, windowHours: o.windowHours });
  if (o.sql) {
    stdout(sql);
    return 0;
  }
  const raw = o.fromJson
    ? JSON.parse(readFileSync(o.fromJson, 'utf8'))
    : (deps.query ?? querySupabaseReadOnly)(sql, { supabaseWorkdir: o.supabaseWorkdir });
  const report = reportFromQueryOutput(raw, {
    windowHours: o.windowHours,
    minHands: o.minHands,
    scopeTexts: deps.scopeTexts ?? loadScopeTexts(),
  });
  const md = formatImpactMarkdown(report, { focus: o.focus });
  if (o.out) writeFileSync(o.out, `${md}\n`);
  stdout(o.json ? JSON.stringify(report, null, 2) : md);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runCli(process.argv.slice(2));
}
