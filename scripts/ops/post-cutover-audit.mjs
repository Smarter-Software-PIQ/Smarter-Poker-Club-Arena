#!/usr/bin/env node
/**
 * Standalone Post-Cutover Audit CLI (read-only).
 *
 * Verifies in one command:
 *   1. Live /health (releaseSha, liveness=ok, settlementStatus=ok, stalledTableCount=0,
 *      maintenance.phase=idle, resumeWaves complete)
 *   2. Serving registry freshness (ca_horse_option_registry_serving matches live SHA <= 5m)
 *   3. Zero reset traps across ALL rows of public.ca_horse_style_switch
 *   4. Zero option_switch_config_% alarms in public.horse_brain_telemetry
 *   5. Git ancestry proof for any --expect-sha commits against live releaseSha
 *   6. Recent decision latency summary (gracefully degrades to explicit `unknown`)
 *   7. Optional (--exploit-split-at): horse-exploit-report.mjs --split-at <cutover> --gate, its verdict
 *      printed; non-blocking unless --strict-exploit
 *
 * Security invariants:
 *   - Read-only SELECT/WITH queries only via `supabase db query --linked -o json --agent=no`.
 *   - Auto-resolves linked Supabase workdir via `git rev-parse --git-common-dir`.
 *   - NEVER reads, sources, prints, or touches `.env` or raw database credentials.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  DEFAULT_COMPARE_HOURS,
  DEFAULT_HEALTH_URL,
  DEFAULT_MAX_REGISTRY_AGE_SEC,
  assertReadOnlySql,
  buildPsqlJsonSql,
  formatAuditReportText,
  parseCliArgs,
  parseSupabaseJsonOutput,
  resolveLinkedSupabaseWorkdir,
  runPostCutoverAudit,
} from './post-cutover-audit-lib.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const REPO_ROOT = path.resolve(__dirname, '..', '..');

const USAGE = `Usage: node scripts/ops/post-cutover-audit.mjs [options]

Options:
  --expect-sha <sha>            Verify commit is an ancestor of live /health releaseSha (repeatable)
  --compare-hours <hours>       Lookback window in hours for alarms/latency (default: ${DEFAULT_COMPARE_HOURS})
  --health-url <url>            Engine /health endpoint (default: ${DEFAULT_HEALTH_URL})
  --max-registry-age-sec <sec>  Max serving registry age in seconds (default: ${DEFAULT_MAX_REGISTRY_AGE_SEC})
  --strict-latency              Fail overall verdict if >100ms starvation alert fires
  --exploit-split-at <ISO>      Also run horse-exploit-report --split-at <ISO> --gate over the 24 h
                                before it to now, and print its verdict (a warning unless strict)
  --strict-exploit              Fail overall verdict on an exploit-report finding or failed read
  --strict-records              Fail overall verdict when docs/horse-option-switch-state.json does not
                                hold the live switch rows (a warning otherwise)
  --supabase-workdir <dir>      Override auto-resolved linked Supabase workdir
  --db-url-env <NAME>           Read the database through psql with the URL in env NAME (read-only
                                transaction) instead of the linked Supabase CLI, e.g. on a CI runner
  --json                        Emit machine-readable JSON output
  -h, --help                    Show this help text
`;

export function createRealDeps({ cwd = REPO_ROOT, supabaseWorkdir, dbUrl = null } = {}) {
  const linkedWorkdir = dbUrl
    ? null
    : (supabaseWorkdir ??
      resolveLinkedSupabaseWorkdir({
        cwd,
        gitCommonDirRunner: (dir) =>
          execFileSync('git', ['rev-parse', '--git-common-dir'], {
            cwd: dir,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
          }),
      }));

  return {
    now: () => Date.now(),

    async fetchHealth(url) {
      const response = await fetch(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      const text = await response.text();
      let body = null;
      try {
        body = JSON.parse(text);
      } catch {
        throw new Error(`Invalid JSON from ${url} (HTTP ${response.status})`);
      }
      return { status: response.status, body };
    },

    async querySupabase(sql) {
      const safeSql = assertReadOnlySql(sql);
      if (dbUrl) {
        const res = spawnSync(
          process.env.PSQL_BIN || 'psql',
          [dbUrl, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', buildPsqlJsonSql(safeSql)],
          {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 30_000,
            maxBuffer: 10 * 1024 * 1024,
            env: { ...process.env, PGOPTIONS: '-c default_transaction_read_only=on' },
          }
        );
        if (res.error) throw res.error;
        if (res.status !== 0) throw new Error((res.stderr || `psql exit ${res.status}`).trim());
        return JSON.parse(res.stdout.trim() || '[]');
      }
      const res = spawnSync(
        'supabase',
        ['db', 'query', '--linked', '-o', 'json', '--agent=no', safeSql],
        {
          cwd: linkedWorkdir,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 30_000,
          maxBuffer: 10 * 1024 * 1024,
        }
      );
      if (res.error) {
        throw res.error;
      }
      if (res.status !== 0) {
        const detail = (res.stderr || res.stdout || `exit code ${res.status}`).trim();
        throw new Error(detail);
      }
      return parseSupabaseJsonOutput(res.stdout);
    },

    /** Run the read-only Horse exploit report as a child process and read its gate. */
    runExploitReport({ splitAt, since, until }) {
      const res = spawnSync(
        process.execPath,
        [
          path.join(REPO_ROOT, 'scripts/ops/horse-exploit-report.mjs'),
          '--since',
          since,
          '--until',
          until,
          '--split-at',
          splitAt,
          '--gate',
          '--json',
          ...(supabaseWorkdir ? ['--supabase-workdir', supabaseWorkdir] : []),
        ],
        {
          cwd,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 900_000,
          maxBuffer: 256 * 1024 * 1024,
        }
      );
      if (res.error) return { exitCode: null, error: res.error.message };
      let gateLine = null;
      let findings = [];
      try {
        const report = JSON.parse(res.stdout);
        gateLine = report.gate?.line ?? null;
        findings = (report.findings ?? []).slice(0, 3).map((f) => f.text);
      } catch {
        // exit 64 / 70 print no JSON; the exit code alone is the answer
      }
      return {
        exitCode: res.status,
        gateLine,
        findings,
        error:
          res.status === 0 || res.status === 1 || res.status === 2
            ? null
            : (res.stderr || '').trim().slice(0, 300),
      };
    },

    /** The committed switch snapshot of this checkout (docs/horse-option-switch-state.json). */
    readCommittedSwitchState() {
      return readFileSync(path.join(REPO_ROOT, 'docs/horse-option-switch-state.json'), 'utf8');
    },

    isGitAncestor(ancestorSha, descendantSha) {
      const res = spawnSync('git', ['merge-base', '--is-ancestor', ancestorSha, descendantSha], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10_000,
      });
      if (res.status === 0) return { ok: true, reason: null };
      if (res.status === 1) return { ok: false, reason: 'not_ancestor' };
      const stderr = (res.stderr || '').trim();
      if (/Not a valid|bad object|unknown revision/i.test(stderr)) {
        return { ok: false, reason: 'commit_not_found_locally' };
      }
      return { ok: false, reason: stderr || `git_exit_${String(res.status)}` };
    },
  };
}

async function main() {
  let options;
  try {
    options = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`);
    process.exit(2);
  }

  if (options.help) {
    process.stdout.write(USAGE);
    process.exit(0);
  }

  let dbUrl = null;
  if (options.dbUrlEnv) {
    dbUrl = process.env[options.dbUrlEnv] || '';
    if (!dbUrl) {
      process.stderr.write(
        `Error: --db-url-env ${options.dbUrlEnv}: that environment variable is empty\n`
      );
      process.exit(2);
    }
  }
  const deps = createRealDeps({
    cwd: REPO_ROOT,
    supabaseWorkdir: options.supabaseWorkdir,
    dbUrl,
  });

  const report = await runPostCutoverAudit(options, deps);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatAuditReportText(report)}\n`);
  }
  process.exit(report.passed ? 0 : 1);
}

const isDirectRun =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  main().catch((err) => {
    process.stderr.write(`Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(2);
  });
}
