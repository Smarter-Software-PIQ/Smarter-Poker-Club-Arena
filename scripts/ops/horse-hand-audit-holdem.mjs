#!/usr/bin/env node
/**
 * Daily decision-by-decision audit of Horse play in No-Limit Hold'em hands with people (read-only).
 * Grades every Horse decision: exactly where the Horse's cards were shown at showdown, at range (node) level
 * otherwise, and gives people's and Horses' results with the all-in luck taken out.
 * Method: docs/ops/horse-hand-audit-holdem.md. Libraries: horse-hand-audit-holdem-{lib,eval,report}.mjs.
 *
 * Security invariants (same route as person-vs-horse-results.mjs):
 *   - read-only WITH ... SELECT statements via `supabase db query --linked -o json --agent=no`
 *     (assertReadOnlySql refuses anything else), each bounded by a time chunk;
 *   - every SELECT is sent behind READ_ONLY_SESSION_PREFIX: the transaction is read only and the statement stops
 *     after 60 seconds;
 *   - hole cards are read only through the showdown list and only for seats whose `mucked` is false;
 *   - never reads .env or database credentials.
 *
 * Usage: node scripts/ops/horse-hand-audit-holdem.mjs [options]
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  assertReadOnlySql,
  parseSupabaseJsonOutput,
  resolveLinkedSupabaseWorkdir,
} from './holdem-blanket-scoreboard-lib.mjs';
import { preflopMatrix } from './horse-hand-audit-holdem-eval.mjs';
import {
  CHUNK_HOURS,
  EXIT_FAILED,
  EXIT_OK,
  EXIT_TOO_FEW,
  EXIT_USAGE,
  EXIT_WORSE,
  MIN_PERSON_HANDS,
  MODES,
  STATEMENT_TIMEOUT_SECONDS,
  audit,
  buildHandsSql,
  buildTournamentSql,
  chunks,
  makeModel,
  measureBluffShares,
  measureFrequencies,
  parseHand,
  parseInstant,
  resolvePlan,
} from './horse-hand-audit-holdem-lib.mjs';
import {
  buildSummary,
  compareWindows,
  decisionsCsv,
  entriesSummary,
  formatMarkdown,
  handsCsv,
} from './horse-hand-audit-holdem-report.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

/** Sent in front of every SELECT. Nothing else is ever placed in front of it. */
export const READ_ONLY_SESSION_PREFIX = `SET TRANSACTION READ ONLY; SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT_SECONDS}s'; `;

export const USAGE = `Usage: node scripts/ops/horse-hand-audit-holdem.mjs [options]

Grade every Horse decision in No-Limit Hold'em hands with a person (cash and tournaments reported apart).

Options:
  --since <ISO>         Start of the range (default 24 hours before --until)
  --until <ISO>         End of the range (default now)
  --mode <${MODES.join('|')}>  Cash tables, tournaments (MTT, SNG, Spin, heads-up) or both (default all)
  --people-only         Only hands with a person seated (default)
  --all                 Every NLH hand, Horse-only tables included (slow)
  --split-at <ISO>      Compare after this instant against before it (default: against the same length before --since)
  --json                Emit the summary as JSON
  --csv <dir>           Also write decisions.csv and hands.csv into <dir>
  --from-json <file>    Grade saved query output ({"hands": [...], "entries": [...]}) instead of querying
  --save-json <file>    Save the query output for --from-json
  --supabase-workdir <dir>  Override the auto-resolved linked Supabase workdir
  -h, --help            Show this help text

Exit codes: 0 clean; 1 a leak node is measurably worse than in the comparison window; 2 too few hands
(fewer than ${MIN_PERSON_HANDS} person-hands in the range); ${EXIT_USAGE} wrong argument; ${EXIT_FAILED} failed read.
`;

export function parseArgs(argv) {
  const o = {
    since: null,
    until: null,
    mode: 'all',
    peopleOnly: true,
    splitAt: null,
    json: false,
    csv: null,
    fromJson: null,
    saveJson: null,
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
    else if (a === '--people-only') o.peopleOnly = true;
    else if (a === '--all') o.peopleOnly = false;
    else if (a === '-h' || a === '--help') o.help = true;
    else if (a === '--since') o.since = parseInstant(a, need(++i, a));
    else if (a === '--until') o.until = parseInstant(a, need(++i, a));
    else if (a === '--split-at') o.splitAt = parseInstant(a, need(++i, a));
    else if (a === '--mode') {
      o.mode = need(++i, a);
      if (!MODES.includes(o.mode)) throw new Error(`--mode must be one of ${MODES.join(', ')}`);
    } else if (a === '--csv') o.csv = need(++i, a);
    else if (a === '--from-json') o.fromJson = need(++i, a);
    else if (a === '--save-json') o.saveJson = need(++i, a);
    else if (a === '--supabase-workdir') o.supabaseWorkdir = need(++i, a);
    else throw new Error(`Unknown argument: ${a}`);
  }
  return o;
}

/** Run one SELECT on the linked project; the CLI gives each call its own connection. */
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
    maxBuffer: 512 * 1024 * 1024,
  });
  if (res.error) throw res.error;
  if (res.status !== 0)
    throw new Error(
      `Supabase query failed: ${(res.stderr || res.stdout || `exit code ${String(res.status)}`).trim()}`
    );
  return parseSupabaseJsonOutput(res.stdout);
}

/** Query every chunk of the plan (hands with the shown-cards rule, then people's tournament entries). */
export function fetchAll(plan, query) {
  const hands = [];
  for (const [a, b] of chunks(plan.since, plan.until, CHUNK_HOURS))
    hands.push(
      ...query(buildHandsSql({ since: a, until: b, mode: plan.mode, peopleOnly: plan.peopleOnly }))
    );
  const tids = [...new Set(hands.map((r) => (r.hand ?? r).tid).filter(Boolean))];
  const tsql = plan.mode === 'cash' ? null : buildTournamentSql({ tids });
  const entries = tsql ? query(tsql) : [];
  return { hands, entries };
}

function rowTs(r) {
  const h = r.hand ?? r;
  return Date.parse(String(h.ts).replace(' ', 'T').replace(/\+00$/, 'Z'));
}

export function runAudit(raw, plan, { matrix } = {}) {
  const seen = new Set();
  const uniq = raw.hands.filter((r) => {
    const id = (r.hand ?? r).id;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const inWin = (w) =>
    uniq.filter((r) => {
      const t = rowTs(r);
      return t >= w.since && t < w.until;
    });
  const curRaw = inWin(plan.current);
  const cmpRaw = inWin(plan.compare);
  const parsedCur = curRaw.map(parseHand).filter(Boolean);
  const parsedAll = [...parsedCur, ...cmpRaw.map(parseHand).filter(Boolean)];
  const M =
    matrix ?? preflopMatrix({ samples: 1500, cacheDir: join(tmpdir(), 'horse-hand-audit-holdem') });
  const nash = JSON.parse(
    readFileSync(join(__dirname, 'horse-hand-audit-holdem-nash.json'), 'utf8')
  );
  const model = makeModel({
    matrix: M,
    freqs: measureFrequencies(parsedAll),
    bluffs: measureBluffShares(parsedAll),
    nash,
  });
  const cur = audit(curRaw, { model });
  const cmp = cmpRaw.length ? audit(cmpRaw, { model }) : null;
  const personHands = cur.handRows.reduce((a, hr) => a + hr.persons.length, 0);
  const worse = cmp ? compareWindows(cur.nodes, cmp.nodes) : [];
  const exitCode =
    personHands < MIN_PERSON_HANDS ? EXIT_TOO_FEW : worse.length ? EXIT_WORSE : EXIT_OK;
  const summary = buildSummary(cur, {
    since: new Date(plan.current.since).toISOString(),
    until: new Date(plan.current.until).toISOString(),
  });
  return { cur, cmp, worse, exitCode, personHands, summary, entries: entriesSummary(raw.entries) };
}

export function summaryJson(r) {
  const s = r.summary;
  const m2o = (m) => Object.fromEntries([...m.entries()]);
  return {
    window: s.meta,
    exitCode: r.exitCode,
    personHands: r.personHands,
    coverage: {
      hands: s.fcHands,
      personHands: s.personHands,
      byFormat: s.fmtHands,
      byDay: s.dayHands,
      decisions: s.tierCount,
    },
    streets: s.streetTable,
    leaks: s.leaksCoarse.slice(0, 40).map((g) => ({ ...g, spots: undefined })),
    leakSpots: s.leaks.slice(0, 60),
    theoretical: s.theory.slice(0, 40),
    strengths: s.strengths.slice(0, 30),
    results: {
      byFormat: m2o(s.byFmt),
      byStake: m2o(s.byStake),
      byDay: m2o(s.byDay),
      byRegime: m2o(s.byRegime),
      byBuild: m2o(s.byBuild),
      people: [...s.people.values()].map((p) => ({ ...p, lines: undefined })),
    },
    entries: m2o(r.entries),
    worse: r.worse,
  };
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
    const raw = o.fromJson
      ? JSON.parse(readFileSync(o.fromJson, 'utf8'))
      : fetchAll(plan, (sql) =>
          (deps.query ?? queryReadOnly)(sql, { supabaseWorkdir: o.supabaseWorkdir })
        );
    if (!raw || !Array.isArray(raw.hands)) throw new Error('saved input needs {"hands": [...]}');
    if (o.saveJson) writeFileSync(o.saveJson, JSON.stringify(raw));
    const r = runAudit(raw, plan, { matrix: deps.matrix });
    if (o.csv) {
      mkdirSync(o.csv, { recursive: true });
      writeFileSync(join(o.csv, 'decisions.csv'), decisionsCsv(r.cur));
      writeFileSync(join(o.csv, 'hands.csv'), handsCsv(r.cur));
    }
    stdout(
      o.json
        ? JSON.stringify(summaryJson(r), null, 2)
        : formatMarkdown(r.summary, {
            entries: r.entries,
            worse: r.worse,
            top: 15,
            topExamples: 10,
          })
    );
    return r.exitCode;
  } catch (err) {
    stderr(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    return EXIT_FAILED;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = runCli(process.argv.slice(2));
}
