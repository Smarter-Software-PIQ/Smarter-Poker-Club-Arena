#!/usr/bin/env node
/**
 * People vs Horses results CLI (read-only). Answers one question: are real people winning or
 * losing against the Horses, per game, and is the difference bigger than luck? With --split-at it
 * compares the windows before and after each instant (a switch change, say), and with --gate it
 * exits 0 / 1 / 2 so a switch runbook can call it. Method and rules:
 * docs/ops/person-vs-horse-results.md and person-vs-horse-results-lib.mjs.
 *
 * Security invariants (same route as holdem-blanket-scoreboard.mjs):
 *   - one read-only WITH ... SELECT via `supabase db query --linked -o json --agent=no`
 *     (assertReadOnlySql refuses anything else), bounded by a time range;
 *   - the SELECT is sent behind two fixed settings, READ_ONLY_SESSION_PREFIX: the transaction is
 *     read only (the database itself refuses a write) and the statement stops after 60 seconds;
 *   - sums per person-session only: no name, full account id, hand id or card leaves the query;
 *   - never reads .env or database credentials.
 *
 * Usage: node scripts/ops/person-vs-horse-results.mjs [options]
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  assertReadOnlySql,
  parseSupabaseJsonOutput,
  resolveLinkedSupabaseWorkdir,
} from './holdem-blanket-scoreboard-lib.mjs';
import {
  BY_DIMENSIONS,
  DEFAULT_RANGE_DAYS,
  EXIT_FAILED,
  EXIT_USAGE,
  MAX_RANGE_DAYS,
  MODES,
  STATEMENT_TIMEOUT_SECONDS,
  buildReport,
  buildPersonHandsSql,
  readResultsChunked,
  resultChunks,
  formatReportText,
  gateResult,
  parseGames,
  parseInstant,
  resolvePlan,
} from './person-vs-horse-results-lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

/** Sent in front of the one SELECT. Nothing else is ever placed in front of it. */
export const READ_ONLY_SESSION_PREFIX = `SET TRANSACTION READ ONLY; SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT_SECONDS}s'; `;

export const USAGE = `Usage: node scripts/ops/person-vs-horse-results.mjs [options]

Are real people winning or losing against the Horses, per game, and is it bigger than luck?

Options:
  --since <ISO>             Start of the range (default ${DEFAULT_RANGE_DAYS} days before --until)
  --until <ISO>             End of the range (default now); at most ${MAX_RANGE_DAYS} days after --since
  --games <a,b,...>         Games to read, such as plo4,plo5,plo6,nlh (default all)
  --mode <${MODES.join('|')}>  Cash tables, tournaments or both, reported apart (default all)
  --split-at <ISO[,ISO...]> Compare the windows before and after each instant
  --by <${BY_DIMENSIONS.join('|')}>
                            Add a breakdown under each game
  --by-option-receipt <option>
                            Compare the hands where that Horse option's receipt fired against
                            the hands where it did not (same range, games and mode)
  --gate                    Exit 0 clean, 1 people measurably better than before a split,
                            2 too few hands to judge (needs --split-at)
  --json                    Emit the report as JSON
  --sql                     Print the read-only SQL and exit
  --from-json <file>        Build the report from saved query output instead of querying
  --supabase-workdir <dir>  Override the auto-resolved linked Supabase workdir
  -h, --help                Show this help text

Instants need a zone, such as 2026-11-22T03:13:56Z. A wrong argument exits ${EXIT_USAGE}, a failed
read exits ${EXIT_FAILED}, so neither can be mistaken for a gate answer.
`;

export function parseArgs(argv) {
  const o = {
    since: null,
    until: null,
    games: null,
    mode: 'all',
    splitAt: [],
    by: null,
    byOptionReceipt: null,
    gate: false,
    json: false,
    sql: false,
    fromJson: null,
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
    else if (a === '--gate') o.gate = true;
    else if (a === '--sql') o.sql = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else if (a === '--since') o.since = parseInstant(a, need(++i, a));
    else if (a === '--until') o.until = parseInstant(a, need(++i, a));
    else if (a === '--games') o.games = parseGames(need(++i, a));
    else if (a === '--mode') o.mode = need(++i, a);
    else if (a === '--by') o.by = need(++i, a);
    else if (a === '--by-option-receipt') o.byOptionReceipt = need(++i, a);
    else if (a === '--split-at') {
      for (const part of need(++i, a).split(',')) o.splitAt.push(parseInstant(a, part));
    } else if (a === '--from-json') o.fromJson = need(++i, a);
    else if (a === '--supabase-workdir') o.supabaseWorkdir = need(++i, a);
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (o.gate && o.byOptionReceipt !== null) {
    throw new Error(
      '--gate judges a split in time and cannot be combined with --by-option-receipt'
    );
  }
  if (o.gate && o.splitAt.length === 0) throw new Error('--gate needs --split-at');
  return o;
}

/**
 * Run the one SELECT on the linked project. The CLI gives each call its own connection, so the
 * read-only transaction and the 60 second limit end with it.
 */
export function queryReadOnly(
  sql,
  { cwd = REPO_ROOT, supabaseWorkdir = null, spawn = spawnSync } = {}
) {
  const safeSql = assertReadOnlySql(sql);
  const linkedWorkdir =
    supabaseWorkdir ??
    resolveLinkedSupabaseWorkdir({
      cwd,
      gitCommonDirRunner: (dir) =>
        execFileSync('git', ['rev-parse', '--git-common-dir'], {
          cwd: dir,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 5_000,
        }),
    });
  const args = ['db', 'query', '--linked', '-o', 'json', '--agent=no'];
  if (linkedWorkdir) args.push('--workdir', linkedWorkdir);
  args.push(`${READ_ONLY_SESSION_PREFIX}${safeSql}`);
  const res = spawn('supabase', args, {
    cwd: linkedWorkdir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: (STATEMENT_TIMEOUT_SECONDS + 30) * 1000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    const detail = (res.stderr || res.stdout || `exit code ${String(res.status)}`).trim();
    throw new Error(`Supabase query failed: ${detail}`);
  }
  return parseSupabaseJsonOutput(res.stdout);
}

export function runCli(argv, deps = {}) {
  const stdout = deps.stdout ?? ((s) => process.stdout.write(`${s}\n`));
  const stderr = deps.stderr ?? ((s) => process.stderr.write(`${s}\n`));
  let o;
  let plan;
  try {
    o = parseArgs(argv);
    if (o.help) {
      stdout(USAGE);
      return 0;
    }
    plan = resolvePlan(o, deps.now ? deps.now() : Date.now());
  } catch (err) {
    stderr(`Error: ${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`);
    return EXIT_USAGE;
  }
  try {
    if (o.sql) {
      // the read is a day at a time (readResultsChunked): this is the first day's statement
      stdout(buildPersonHandsSql(plan, resultChunks(plan.sinceMs, plan.untilMs)[0]));
      return 0;
    }
    const query = deps.query ?? queryReadOnly;
    // deps.readReport: a test seam returning the report rows for a plan (the shape the single read returned)
    const raw = o.fromJson
      ? JSON.parse(readFileSync(o.fromJson, 'utf8'))
      : deps.readReport
        ? deps.readReport(plan)
        : [
            {
              report: readResultsChunked(plan, (sql) =>
                query(sql, { supabaseWorkdir: o.supabaseWorkdir })
              ),
            },
          ];
    const report = buildReport(raw, plan);
    const gate = o.gate ? gateResult(report) : null;
    if (gate) report.gate = gate;
    stdout(o.json ? JSON.stringify(report, null, 2) : formatReportText(report, { gate }));
    return gate ? gate.exitCode : 0;
  } catch (err) {
    stderr(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    return EXIT_FAILED;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = runCli(process.argv.slice(2));
}
