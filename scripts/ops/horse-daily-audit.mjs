// scripts/ops/horse-daily-audit.mjs
// THE HORSE DAILY AUDIT, ONE COMMAND (2026-11-26, PLO-OWNER lead-7, lane HARDENING). Read-only. See
// docs/ops/horse-daily-audit.md.
//
//   node scripts/ops/horse-daily-audit.mjs --out-root <dir> [--until <ISO>] [--since <ISO>]
//        [--supabase-workdir <dir>] [--plan]
//
// For the last 24 hours (or --since/--until): reads every Horse option switch change (ca_horse_style_switch_audit)
// and engine build boundary (hand_history.engine_build) in the range, then runs both hand audits, the exploit report
// gated and split at every one of those instants, and the person-vs-Horse results split at the same instants, and
// writes <out-root>/<until, YYYY-MM-DD-HHMMZ>/ with every tool's output and a one-page SUMMARY.md (top leaks,
// regressions, owner-rule breaches). --plan prints the boundaries and the commands and runs nothing else.
//
// No cron, no watcher: an agent runs it. Security invariant: SELECTs only, behind SET TRANSACTION READ ONLY (the
// hand audit's queryReadOnly); the tools it runs are read-only themselves. Never reads or prints .env or a key.
//
// Exit: 0 clean, 1 a regression or an owner-rule breach, 64 usage, 70 a tool or a read failed (the summary is still
// written and says which).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { queryReadOnly } from './horse-hand-audit-holdem.mjs';
import {
  RANGE_HOURS,
  boundarySql,
  formatSummary,
  iso,
  overallExit,
  planRuns,
  planSplits,
} from './horse-daily-audit-lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

export function parseArgs(argv) {
  const o = { outRoot: null, since: null, until: null, supabaseWorkdir: null, plan: false };
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
    if (a === '--out-root') o.outRoot = val();
    else if (a === '--since') o.since = instant();
    else if (a === '--until') o.until = instant();
    else if (a === '--supabase-workdir') o.supabaseWorkdir = val();
    else if (a === '--plan') o.plan = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

export function folderName(untilMs) {
  return iso(untilMs).slice(0, 16).replace('T', '-').replace(':', '') + 'Z';
}

export function runDailyAudit(argv, deps = {}) {
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
    if (!o.outRoot && !o.plan)
      throw new Error('--out-root <dir> is required (no default: it never guesses a place)');
  } catch (e) {
    err(`Error: ${e.message}`);
    return 64;
  }
  const untilMs = o.until ?? Math.floor((deps.now ? deps.now() : Date.now()) / 60_000) * 60_000;
  const sinceMs = o.since ?? untilMs - RANGE_HOURS * 3600_000;
  if (!(sinceMs < untilMs)) {
    err('Error: --since must be before --until');
    return 64;
  }
  const query = deps.query ?? ((sql) => queryReadOnly(sql, { supabaseWorkdir: o.supabaseWorkdir }));
  let plan;
  try {
    const sql = boundarySql(sinceMs, untilMs);
    plan = planSplits(sinceMs, untilMs, {
      switches: query(sql.switches),
      builds: query(sql.builds),
    });
  } catch (e) {
    err(`Failed reading the switch changes and build boundaries: ${e.message}`);
    return 70;
  }
  const runs = planRuns(
    sinceMs,
    untilMs,
    plan.splits.map((s) => s.at).map((a) => ({ at: a }))
  );
  if (o.plan) {
    out(
      JSON.stringify(
        {
          since: iso(sinceMs),
          until: iso(untilMs),
          ...plan,
          runs: runs.map((r) => `node scripts/ops/${r.script} ${r.args.join(' ')}`),
        },
        null,
        1
      )
    );
    return 0;
  }
  const folder = resolve(o.outRoot, folderName(untilMs));
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, 'plan.json'),
    JSON.stringify({ since: iso(sinceMs), until: iso(untilMs), ...plan, runs }, null, 1)
  );
  const spawn = deps.spawn ?? spawnSync;
  const results = {};
  for (const r of runs) {
    const args = r.args.map((a) => (a === 'omaha-audit-csv' ? join(folder, a) : a));
    if (o.supabaseWorkdir) args.push('--supabase-workdir', o.supabaseWorkdir);
    const t0 = Date.now();
    const res = spawn(process.execPath, [join(__dirname, r.script), ...args], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 512 * 1024 * 1024,
    });
    const code = typeof res.status === 'number' ? res.status : null;
    writeFileSync(join(folder, r.out), res.stdout ?? '');
    writeFileSync(
      join(folder, `${r.name}.err`),
      `${res.stderr ?? ''}${res.error ? `\n${res.error}` : ''}`
    );
    let json = null;
    try {
      // a tool may print a verdict line after its JSON: read the JSON object only
      const text = String(res.stdout ?? '');
      json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    } catch {
      json = null;
    }
    results[r.name] = { code, secs: Math.round((Date.now() - t0) / 1000), json, out: r.out };
    err(`[horse-daily-audit] ${r.name}: exit ${code} in ${results[r.name].secs}s`);
  }
  const summary = formatSummary({ sinceMs, untilMs, plan, runs, results, folder });
  writeFileSync(join(folder, 'SUMMARY.md'), summary + '\n');
  out(summary);
  return overallExit(runs, results);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = runDailyAudit(process.argv.slice(2));
}
