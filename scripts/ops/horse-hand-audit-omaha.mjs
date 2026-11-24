#!/usr/bin/env node
/**
 * Daily decision-by-decision audit of Horse play in PLO4 / PLO5 cash hands with people.
 *
 * Reads hand_history (one read-only SELECT per 6-hour chunk via `supabase db query --linked`, each behind
 * SET TRANSACTION READ ONLY and a statement timeout), then grades every Horse decision:
 *   tier A  the Horse's cards were shown at showdown: every option priced against the measured ranges of the
 *           opponents still in (and, labelled hindsight, against their shown hands); CORRECT or MISTAKE with bb cost
 *   tier B  cards not shown: decisions graded as node populations, with over-fold chips estimated from what the
 *           bettors at that node actually hold when shown (theoretical exploitability reported apart)
 *   tier C  per-hand results with the all-in luck adjustment
 * Hole cards are selected ONLY through the hand's showdown list, skipping mucked entries (lib/sql.mjs).
 * Method and limits: docs/ops/horse-hand-audit-omaha.md.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  assertReadOnlySql,
  parseSupabaseJsonOutput,
  resolveLinkedSupabaseWorkdir,
} from './holdem-blanket-scoreboard-lib.mjs';
import { auditSql } from './horse-hand-audit-omaha-lib/sql.mjs';
import { runAudit, tsOf } from './horse-hand-audit-omaha-lib/audit.mjs';
import { parseHand } from './horse-hand-audit-omaha-lib/hand.mjs';
import { measurePopulation } from './horse-hand-audit-omaha-lib/pop.mjs';
import { measureBettors, rangeTier } from './horse-hand-audit-omaha-lib/rangetier.mjs';
import { aggregate } from './horse-hand-audit-omaha-lib/aggregate.mjs';
import {
  DECISION_COLS,
  HAND_COLS,
  NODE_COLS,
  csv,
  markdownTables,
} from './horse-hand-audit-omaha-lib/report.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
export const EXIT_OK = 0;
export const EXIT_WORSE = 1;
export const EXIT_TOO_FEW = 2;
export const EXIT_USAGE = 64;
export const EXIT_FAILED = 70;
export const STATEMENT_TIMEOUT_SECONDS = 120;
export const CHUNK_HOURS = 6;
export const MAX_RANGE_DAYS = 8;
export const DEFAULT_MIN_HANDS = 30;
export const GAMES = ['plo4', 'plo5'];
export const DEFAULT_TABLES = join(__dirname, 'horse-hand-audit-omaha-lib', 'range-tables.json');
/** Sent in front of each SELECT. Nothing else is ever placed in front of it. */
export const READ_ONLY_SESSION_PREFIX = `SET TRANSACTION READ ONLY; SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT_SECONDS}s'; `;

export const USAGE = `Usage: node scripts/ops/horse-hand-audit-omaha.mjs [options]

Grades every Horse decision in PLO4/PLO5 cash hands with people (tier A exact where the Horse's cards were shown,
tier B by node, tier C results).

Options:
  --since <ISO>         Start (default 24 hours before --until)
  --until <ISO>         End (default now); at most ${MAX_RANGE_DAYS} days after --since
  --games <a,b>         plo4,plo5 (default both)
  --people-only         Only hands with a person and a Horse (default)
  --all                 Every hand, Horse-only hands included
  --split-at <ISO>      Compare HARD leaks versus people before and after this instant (exit 1 if one got worse)
  --min-hands <n>       Exit 2 below this many hands (default ${DEFAULT_MIN_HANDS})
  --json                Print the summary as JSON
  --csv <dir>           Write decisions.csv, hands.csv and nodes.csv into <dir>
  --from-json <file>    Grade saved query rows (a JSON array of hand rows) instead of querying
  --save-json <file>    Save the queried rows (shown cards only, as selected) for a later --from-json
  --tables <file>       Measured range tables (default the bundled copy)
  --sql                 Print the read-only SQL of the first chunk and exit
  --supabase-workdir <dir>  Override the linked Supabase workdir
  -h, --help            This text

Exit codes: 0 ok, 1 a HARD leak versus people got worse than the window before --split-at, 2 too few hands,
64 usage, 70 failure.`;

function parseInstant(flag, v) {
  const t = Date.parse(v);
  if (!Number.isFinite(t)) throw new Error(`${flag} needs an ISO instant, got ${v}`);
  return t;
}
export function parseArgs(argv) {
  const o = {
    games: GAMES.slice(),
    peopleOnly: true,
    minHands: DEFAULT_MIN_HANDS,
    json: false,
    csv: null,
    splitAt: null,
  };
  const need = (i, a) => {
    if (i >= argv.length || String(argv[i]).startsWith('--')) throw new Error(`${a} needs a value`);
    return argv[i];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '--json') o.json = true;
    else if (a === '--sql') o.sql = true;
    else if (a === '--people-only') o.peopleOnly = true;
    else if (a === '--all') o.peopleOnly = false;
    else if (a === '--since') o.since = parseInstant(a, need(++i, a));
    else if (a === '--until') o.until = parseInstant(a, need(++i, a));
    else if (a === '--split-at') o.splitAt = parseInstant(a, need(++i, a));
    else if (a === '--min-hands') {
      o.minHands = Number(need(++i, a));
      if (!Number.isInteger(o.minHands) || o.minHands < 0)
        throw new Error('--min-hands needs a whole number');
    } else if (a === '--games') {
      o.games = need(++i, a)
        .split(',')
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean);
      if (!o.games.length || o.games.some((g) => !GAMES.includes(g)))
        throw new Error(`--games takes ${GAMES.join(',')}`);
    } else if (a === '--csv') o.csv = need(++i, a);
    else if (a === '--from-json') o.fromJson = need(++i, a);
    else if (a === '--save-json') o.saveJson = need(++i, a);
    else if (a === '--tables') o.tables = need(++i, a);
    else if (a === '--supabase-workdir') o.supabaseWorkdir = need(++i, a);
    else throw new Error(`unknown option ${a}`);
  }
  return o;
}
export function resolveWindow(o, now) {
  const until = o.until ?? now;
  const since = o.since ?? until - 24 * 3600e3;
  if (!(since < until)) throw new Error('--since must be before --until');
  if (until - since > MAX_RANGE_DAYS * 86400e3)
    throw new Error(`the range is at most ${MAX_RANGE_DAYS} days`);
  if (o.splitAt !== null && o.splitAt !== undefined && !(o.splitAt > since && o.splitAt < until))
    throw new Error('--split-at must be inside the range');
  return { since, until };
}
export function chunks(since, until, hours = CHUNK_HOURS) {
  const out = [];
  for (let t = since; t < until; t += hours * 3600e3)
    out.push([t, Math.min(until, t + hours * 3600e3)]);
  return out;
}
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
    maxBuffer: 256 * 1024 * 1024,
  });
  if (res.error) throw res.error;
  if (res.status !== 0)
    throw new Error(
      `Supabase query failed: ${(res.stderr || res.stdout || `exit ${res.status}`).trim()}`
    );
  const parsed = parseSupabaseJsonOutput(res.stdout);
  return Array.isArray(parsed) ? parsed : (parsed.rows ?? parsed.result ?? []);
}
/** Everything after the rows are in hand: tiers A, B, C and the summary. */
export function buildAudit(
  rows,
  { tables, games = GAMES, peopleOnly = true, splitAt = null, opts } = {}
) {
  const res = runAudit(rows, { tables, games, peopleOnly, ...(opts ? { opts } : {}) });
  const ids = new Set(res.hands.map((h) => h.hand_id));
  const seen = new Set();
  const hands = rows
    .filter((r) => ids.has(r.id) && !seen.has(r.id) && seen.add(r.id))
    .map(parseHand);
  hands.forEach((h) => (h.ms = tsOf(h.t)));
  const pop = measurePopulation(hands);
  const bettors = measureBettors(hands, tables);
  const personHands = res.hands.reduce((s, h) => s + h.n_people, 0);
  const nodes = rangeTier(hands, res.decisions, tables, pop, bettors, personHands);
  const nv = new Map(nodes.map((n) => [n.key, n.verdict]));
  for (const r of res.decisions)
    if (r.tier === 'B') r.verdict = 'RANGE:' + (nv.get(r.node) ?? 'fine');
  const summary = aggregate({
    hands: res.hands,
    decisions: res.decisions,
    nodes,
    splitAt: splitAt === null ? null : new Date(splitAt).toISOString(),
  });
  return { summary, hands: res.hands, decisions: res.decisions, nodes };
}
export function exitCodeFor(summary, minHands) {
  if (summary.hands < minHands) return EXIT_TOO_FEW;
  if (summary.split && summary.split.worse.length > 0) return EXIT_WORSE;
  return EXIT_OK;
}
export function runCli(argv, deps = {}) {
  const stdout = deps.stdout ?? ((s) => process.stdout.write(`${s}\n`));
  const stderr = deps.stderr ?? ((s) => process.stderr.write(`${s}\n`));
  let o, win;
  try {
    o = parseArgs(argv);
    if (o.help) {
      stdout(USAGE);
      return EXIT_OK;
    }
    win = resolveWindow(o, deps.now ? deps.now() : Date.now());
  } catch (err) {
    stderr(`Error: ${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`);
    return EXIT_USAGE;
  }
  try {
    const sqlOf = ([a, b]) =>
      auditSql({ from: a, to: b, games: o.games, peopleOnly: o.peopleOnly });
    if (o.sql) {
      stdout(assertReadOnlySql(sqlOf(chunks(win.since, win.until)[0])));
      return EXIT_OK;
    }
    const tables = JSON.parse(readFileSync(o.tables ?? DEFAULT_TABLES, 'utf8'));
    let rows;
    if (o.fromJson) {
      const j = JSON.parse(readFileSync(o.fromJson, 'utf8'));
      rows = (Array.isArray(j) ? j : (j.rows ?? [])).filter((r) => {
        const t = tsOf(r.created_at);
        return t >= win.since && t < win.until;
      });
    } else {
      const q = deps.query ?? queryReadOnly;
      rows = chunks(win.since, win.until).flatMap((c) =>
        q(sqlOf(c), { supabaseWorkdir: o.supabaseWorkdir })
      );
      if (o.saveJson) writeFileSync(o.saveJson, JSON.stringify(rows));
    }
    const out = buildAudit(rows, {
      tables,
      games: o.games,
      peopleOnly: o.peopleOnly,
      splitAt: o.splitAt ?? null,
      opts: deps.opts,
    });
    if (o.csv) {
      mkdirSync(o.csv, { recursive: true });
      writeFileSync(join(o.csv, 'decisions.csv'), csv(out.decisions, DECISION_COLS));
      writeFileSync(join(o.csv, 'hands.csv'), csv(out.hands, HAND_COLS));
      writeFileSync(join(o.csv, 'nodes.csv'), csv(out.nodes, NODE_COLS));
    }
    const code = exitCodeFor(out.summary, o.minHands);
    const meta = {
      since: new Date(win.since).toISOString(),
      until: new Date(win.until).toISOString(),
      games: o.games,
      peopleOnly: o.peopleOnly,
      tables: tables.version,
      exitCode: code,
    };
    if (o.json) stdout(JSON.stringify({ meta, ...out.summary }, null, 1));
    else {
      stdout(`# Horse hand audit (PLO) ${meta.since} to ${meta.until}\n`);
      stdout(
        `Hands ${out.summary.hands}, person-hands ${out.summary.personHands}, Horse decisions ${out.summary.decisions} (tier A ${out.summary.tierA}, tier B ${out.summary.tierB}).`
      );
      if (out.summary.split)
        stdout(
          `Split at ${out.summary.split.at}: ${out.summary.split.worse.length} HARD leak(s) worse: ${out.summary.split.worse.map((w) => `${w.leak} ${w.before.toFixed(1)} -> ${w.after.toFixed(1)} bb/100`).join('; ') || 'none'}.`
        );
      if (code === EXIT_TOO_FEW) stdout(`Too few hands (${out.summary.hands} < ${o.minHands}).`);
      stdout('\n' + markdownTables(out.summary));
    }
    return code;
  } catch (err) {
    stderr(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    return EXIT_FAILED;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = runCli(process.argv.slice(2));
}
