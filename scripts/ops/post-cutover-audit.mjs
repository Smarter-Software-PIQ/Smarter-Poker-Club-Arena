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
 *
 * Security invariants:
 *   - Read-only SELECT/WITH queries only via `supabase db query --linked -o json --agent=no`.
 *   - Auto-resolves linked Supabase workdir via `git rev-parse --git-common-dir`.
 *   - NEVER reads, sources, prints, or touches `.env` or raw database credentials.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import {
  DEFAULT_COMPARE_HOURS,
  DEFAULT_HEALTH_URL,
  DEFAULT_MAX_REGISTRY_AGE_SEC,
  assertReadOnlySql,
  formatAuditReportText,
  parseCliArgs,
  parseSupabaseJsonOutput,
  resolveLinkedSupabaseWorkdir,
  runPostCutoverAudit,
} from './post-cutover-audit-lib.mjs';

const USAGE = `Usage: node scripts/ops/post-cutover-audit.mjs [options]

Options:
  --expect-sha <sha>            Verify commit is an ancestor of live /health releaseSha (repeatable)
  --compare-hours <hours>       Lookback window in hours for alarms/latency (default: ${DEFAULT_COMPARE_HOURS})
  --health-url <url>            Engine /health endpoint (default: ${DEFAULT_HEALTH_URL})
  --max-registry-age-sec <sec>  Max serving registry age in seconds (default: ${DEFAULT_MAX_REGISTRY_AGE_SEC})
  --strict-latency              Fail overall verdict if >100ms starvation alert fires
  --supabase-workdir <dir>      Override auto-resolved linked Supabase workdir
  --json                        Emit machine-readable JSON output
  -h, --help                    Show this help text
`;

function createRealDeps({ cwd, supabaseWorkdir }) {
  const linkedWorkdir =
    supabaseWorkdir ??
    resolveLinkedSupabaseWorkdir({
      cwd,
      gitCommonDirRunner: (dir) =>
        execFileSync('git', ['rev-parse', '--git-common-dir'], {
          cwd: dir,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        }),
    });

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

  const deps = createRealDeps({
    cwd: process.cwd(),
    supabaseWorkdir: options.supabaseWorkdir,
  });

  const report = await runPostCutoverAudit(options, deps);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatAuditReportText(report)}\n`);
  }
  process.exit(report.passed ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(2);
});
