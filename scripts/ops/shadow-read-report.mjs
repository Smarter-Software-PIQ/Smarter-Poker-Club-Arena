#!/usr/bin/env node
/**
 * Standalone Live Shadow Readback Report CLI (read-only).
 *
 * Instant +3m / +20m / +40m / +60m readback for any Horse option running in `shadow`
 * or `on_shadow` across the Shadow Queue (holdemPersonaPostflop, holdemManiacSampleGate,
 * holdemCallDownExcludesCurrentHand, holdemGearShiftReach, etc.):
 *   1. Live switch state (public.ca_horse_style_switch) + latest audit entry
 *      (public.ca_horse_style_switch_audit, auto-detecting --since from the latest
 *      shadow/on_shadow transition when omitted)
 *   2. Live engine /health (releaseSha, stalledTableCount, activeTables, liveness)
 *   3. Worker pickup count (option_switch_<option>_<state>_seen) from public.horse_brain_telemetry
 *      and window-scoped flush receipts
 *   4. Shadow re-decision counts (same/changed overall & person-present), exact change rate
 *      + 95% Wilson CI, and people-first share
 *   5. Shadow skip counters (backlog, budget, rate, stage_self_disabled, redecide_failed, etc.)
 *   6. Safety & latency since `since`: horse_error_log, alarm/config_error/illegal/exception/breaker,
 *      and horse_brain_flush_receipts latency (nlh / style_read / shadow avg/max/>100ms %)
 *   7. Deterministic verdict: HEALTHY_ACTIVE | HEALTHY_IDLE | ROLLBACK_TRIGGERED + ready-to-paste
 *      inbox receipt summary.
 *
 * Security invariants:
 *   - Read-only SELECT/WITH queries ONLY via `supabase db query --linked -o json --agent=no`.
 *   - Auto-resolves linked Supabase workdir via `git rev-parse --git-common-dir`.
 *   - NEVER reads, sources, prints, or touches local credential files or raw secrets.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  DEFAULT_HEALTH_URL,
  assertReadOnlySql,
  buildOptionStateAndAuditSql,
  buildShadowReadReport,
  buildShadowWindowBatchSql,
  evaluateLiveHealth,
  formatShadowReportText,
  parseCliArgs,
  parseSupabaseJsonOutput,
  resolveLinkedSupabaseWorkdir,
  resolveShadowWindow,
} from './shadow-read-report-lib.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');

export const USAGE = `Usage: node scripts/ops/shadow-read-report.mjs <option> [options]

Arguments:
  <option>                      Registered Horse option name (e.g. holdemPersonaPostflop)

Options:
  --since <iso>                 Window start UTC ISO-8601 timestamp (default: auto-detected from
                                latest shadow/on_shadow audit transition)
  --until <iso>                 Window end UTC ISO-8601 timestamp (default: now, or completed
                                shadow exit + 90s flush grace when auto-detected post-run)
  --health-url <url>            Engine /health endpoint (default: ${DEFAULT_HEALTH_URL})
  --skip-health                 Skip live HTTP /health request
  --supabase-workdir <dir>      Override auto-resolved linked Supabase workdir
  --json                        Emit machine-readable JSON output
  -h, --help                    Show this help text
`;

export function querySupabaseReadOnly(sql, { cwd = REPO_ROOT, supabaseWorkdir = null } = {}) {
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
  if (linkedWorkdir) {
    args.push('--workdir', linkedWorkdir);
  }
  args.push(safeSql);

  const res = spawnSync('supabase', args, {
    cwd: linkedWorkdir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 45_000,
    maxBuffer: 16 * 1024 * 1024,
  });

  if (res.error) throw res.error;
  if (res.status !== 0) {
    const detail = (res.stderr || res.stdout || `exit code ${String(res.status)}`).trim();
    throw new Error(`Supabase query failed: ${detail}`);
  }
  return parseSupabaseJsonOutput(res.stdout);
}

export async function fetchHealthDefault(url) {
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
}

export async function runCli(argv, injectedDeps = {}) {
  const stderr = injectedDeps.stderr ?? ((msg) => process.stderr.write(`${msg}\n`));
  const stdout = injectedDeps.stdout ?? ((msg) => process.stdout.write(`${msg}\n`));

  let options;
  try {
    options = parseCliArgs(argv);
  } catch (err) {
    stderr(`Error: ${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`);
    return { exitCode: 2, data: null };
  }

  if (options.help) {
    stdout(USAGE);
    return { exitCode: 0, data: null };
  }

  const querySupabase =
    injectedDeps.querySupabase ??
    ((sql) =>
      querySupabaseReadOnly(sql, {
        cwd: REPO_ROOT,
        supabaseWorkdir: options.supabaseWorkdir,
      }));

  const fetchHealth = injectedDeps.fetchHealth ?? fetchHealthDefault;
  const nowMs = injectedDeps.now ? Number(injectedDeps.now()) : Date.now();
  const measuredAt = new Date(nowMs).toISOString();

  // Step 1: Fetch live switch state + recent audit history (and live /health in parallel).
  const metaSql = buildOptionStateAndAuditSql(options.option);
  const metaPromise = Promise.resolve().then(() => querySupabase(metaSql));
  const healthPromise = options.skipHealth
    ? Promise.resolve({
        status: 'skipped',
        httpStatus: null,
        releaseSha: null,
        liveness: null,
        settlementStatus: null,
        stalledTableCount: null,
        activeTables: null,
        maintenancePhase: null,
        issues: [],
      })
    : Promise.resolve()
        .then(() => fetchHealth(options.healthUrl))
        .then((res) => evaluateLiveHealth(res.body, res.status))
        .catch((err) => ({
          status: 'unreachable',
          httpStatus: null,
          releaseSha: null,
          liveness: null,
          settlementStatus: null,
          stalledTableCount: null,
          activeTables: null,
          maintenancePhase: null,
          issues: [],
          error: err instanceof Error ? err.message : String(err),
        }));

  const [metaRows, health] = await Promise.all([metaPromise, healthPromise]);
  const firstMeta = Array.isArray(metaRows) ? metaRows[0] : metaRows;
  const meta = firstMeta?.meta ?? firstMeta ?? {};
  const switchRow = meta.switchRow ?? null;
  const auditRows = Array.isArray(meta.auditRows) ? meta.auditRows : [];

  const windowMeta = resolveShadowWindow({
    switchRow,
    auditRows,
    explicitSince: options.since,
    explicitUntil: options.until,
    nowMs,
  });

  // Step 2: Single batched read-only query for the resolved [since, until] window.
  const batchSql = buildShadowWindowBatchSql({
    option: options.option,
    since: windowMeta.since,
    until: windowMeta.until,
  });
  const batchRows = await querySupabase(batchSql);
  const firstBatch = Array.isArray(batchRows) ? batchRows[0] : batchRows;
  const dbSnapshot = firstBatch?.snapshot ?? firstBatch ?? {};

  const report = buildShadowReadReport({
    option: options.option,
    switchRow,
    auditRows,
    windowMeta,
    dbSnapshot,
    health,
    measuredAt,
  });

  if (options.json) {
    stdout(JSON.stringify(report, null, 2));
  } else {
    stdout(formatShadowReportText(report));
  }

  const exitCode = report.verdict === 'ROLLBACK_TRIGGERED' ? 1 : 0;
  return { exitCode, data: report };
}

const isDirectRun =
  process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  runCli(process.argv.slice(2))
    .then(({ exitCode }) => {
      process.exitCode = exitCode;
    })
    .catch((err) => {
      process.stderr.write(`Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 2;
    });
}
