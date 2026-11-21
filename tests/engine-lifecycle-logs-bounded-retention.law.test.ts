/**
 * ENGINE LIFECYCLE LOGS BOUNDED RETENTION (2026-11-20)
 *
 * public.engine_lifecycle_logs (20261119175748) persists append-only engine
 * boot, shutdown, and FATAL/crash logs in PostgreSQL. Without rolling
 * retention, those diagnostic rows would accumulate indefinitely on disk.
 *
 * This law pins:
 *   1. Migration 20261120213600_engine_lifecycle_logs_bounded_retention.sql
 *      defines owner-only public.fn_ca_prune_engine_lifecycle_logs with
 *      SECURITY DEFINER, SET search_path TO 'public',
 *      SET statement_timeout TO '15s', SET lock_timeout TO '2s',
 *      bounded page delete (LIMIT v_batch + FOR UPDATE SKIP LOCKED),
 *      minimum 1-day retention guard, and REVOKE ALL FROM PUBLIC, anon,
 *      authenticated, service_role.
 *   2. Daily cron job `ca-engine-lifecycle-logs-prune-daily` invokes the
 *      bounded pruner with 30-day rolling retention and a 5000-row page.
 *   3. The migration obeys transaction shape, cost shape, function-probe,
 *      periodic-work, and @live-proof laws, and registers the function in
 *      scripts/ci/schema-manifest.d/.
 *   4. The native PostgreSQL 17 proof script is wired into
 *      .github/workflows/snapshot-prune-reads-its-age-bound.yml.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { migrationTransactionShape } from '../scripts/ci/migration-transaction-shape.mjs';
import { migrationCostRisks } from '../scripts/ci/migration-cost-shape.mjs';
import { missingProbes } from '../scripts/ci/migration-function-probes.mjs';
import { PERIODIC_WORK_MARKER, scheduledJobs } from '../scripts/ci/check-no-new-band-aids.mjs';

const ROOT = resolve(__dirname, '..');
const MIGRATION_NAME = '20261120213600_engine_lifecycle_logs_bounded_retention.sql';
const MIGRATION_PATH = resolve(ROOT, 'supabase/migrations', MIGRATION_NAME);
const MANIFEST_PATH = resolve(
  ROOT,
  'scripts/ci/schema-manifest.d/engine-lifecycle-logs-bounded-retention.json'
);
const PROOF_SCRIPT = resolve(ROOT, 'scripts/ci/test-engine-lifecycle-logs-bounded-retention.py');
const WORKFLOW_PATH = resolve(ROOT, '.github/workflows/snapshot-prune-reads-its-age-bound.yml');

describe('engine_lifecycle_logs bounded 30-day rolling retention', () => {
  const sql = readFileSync(MIGRATION_PATH, 'utf8');
  const workflow = readFileSync(WORKFLOW_PATH, 'utf8');

  it('defines owner-only bounded pruner with required GUC pins and ACL revocations', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.fn_ca_prune_engine_lifecycle_logs(');
    expect(sql).toContain("p_keep interval DEFAULT interval '30 days'");
    expect(sql).toContain('p_batch integer DEFAULT 5000');
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain("SET search_path TO 'public'");
    expect(sql).toContain("SET statement_timeout TO '15s'");
    expect(sql).toContain("SET lock_timeout TO '2s'");
    expect(sql).toContain('LIMIT v_batch');
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain("IF p_keep IS NULL OR p_keep < interval '1 day' THEN");
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.fn_ca_prune_engine_lifecycle_logs\(interval, integer\)\s+FROM PUBLIC, anon, authenticated, service_role;/i
    );
  });

  it('schedules the daily retention cron job using the bounded pruner', () => {
    const { added } = scheduledJobs(sql);
    expect(added).toEqual(['ca-engine-lifecycle-logs-prune-daily']);
    expect(sql).toContain(
      "SELECT public.fn_ca_prune_engine_lifecycle_logs(interval '30 days', 5000);"
    );
    expect(sql).not.toMatch(/\$cron\$[\s\S]*DELETE\s+FROM/i);
  });

  it('satisfies transaction shape, cost shape, function-probe, periodic-work, and live-proof laws', () => {
    expect(migrationTransactionShape(MIGRATION_NAME, sql).ok).toBe(true);
    expect(migrationCostRisks(MIGRATION_NAME, sql)).toEqual([]);
    expect(missingProbes(sql)).toEqual([]);
    expect(PERIODIC_WORK_MARKER.test(sql)).toBe(true);
    expect(sql).toMatch(/^-- @live-proof: .+/m);
  });

  it('declares fn_ca_prune_engine_lifecycle_logs in schema-manifest.d', () => {
    expect(existsSync(MANIFEST_PATH)).toBe(true);
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as {
      functions?: string[];
    };
    expect(manifest.functions).toContain('fn_ca_prune_engine_lifecycle_logs');
  });

  it('wires the native PostgreSQL 17 proof script into the retention workflow', () => {
    expect(existsSync(PROOF_SCRIPT)).toBe(true);
    expect(workflow).toContain(`supabase/migrations/${MIGRATION_NAME}`);
    expect(workflow).toContain('scripts/ci/test-engine-lifecycle-logs-bounded-retention.py');
    expect(workflow).toContain('python3 scripts/ci/test-engine-lifecycle-logs-bounded-retention.py');
  });
});
