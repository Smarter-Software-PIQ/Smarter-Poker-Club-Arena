/**
 * DAILY CASH RETENTION PRUNERS ARE BOUNDED (2026-11-19)
 *
 * The two daily retention cron jobs added on 2026-11-18
 * (`ca-cash-hand-chair-clubs-prune-daily` and
 * `ca-cash-seat-occupancy-history-prune-daily`) originally ran raw, unbatched
 * `DELETE FROM ...` statements. When 14-day / 30-day retention windows fill,
 * an unbounded DELETE can lock millions of rows and spike WAL/replication lag.
 *
 * This law pins:
 *   1. Migration 20261119185027_batch_daily_cash_retention_pruners.sql defines
 *      owner-only bounded batch pruners in smarter_private with LIMIT,
 *      FOR UPDATE SKIP LOCKED, wall-clock deadline, exact 14d/30d cutoffs,
 *      and REVOKE ALL FROM PUBLIC, anon, authenticated, service_role.
 *   2. Only the two existing cron jobs are updated in place (no new cron jobs).
 *   3. The migration obeys transaction shape, cost shape, function-probe,
 *      periodic-work, and @live-proof laws.
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
const MIGRATION_NAME = '20261119185027_batch_daily_cash_retention_pruners.sql';
const MIGRATION_PATH = resolve(ROOT, 'supabase/migrations', MIGRATION_NAME);
const PROOF_SCRIPT = resolve(ROOT, 'scripts/ci/test-batch-daily-cash-retention-pruners.py');
const WORKFLOW_PATH = resolve(ROOT, '.github/workflows/snapshot-prune-reads-its-age-bound.yml');

describe('daily cash retention pruners are bounded', () => {
  const sql = readFileSync(MIGRATION_PATH, 'utf8');
  const workflow = readFileSync(WORKFLOW_PATH, 'utf8');

  it('defines both bounded owner-only pruner functions with exact retention cutoffs', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION smarter_private.fn_prune_cash_hand_chair_clubs(');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION smarter_private.fn_prune_cash_seat_occupancy_history(');
    expect(sql).toContain("v_cutoff timestamptz := now() - interval '14 days'");
    expect(sql).toContain("v_cutoff timestamptz := now() - interval '30 days'");
    expect(sql).toContain('LIMIT v_batch');
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain('clock_timestamp() >= v_deadline');

    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION smarter_private\.fn_prune_cash_hand_chair_clubs\(integer, double precision, integer\)\s+FROM PUBLIC, anon, authenticated, service_role;/i
    );
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION smarter_private\.fn_prune_cash_seat_occupancy_history\(integer, double precision, integer\)\s+FROM PUBLIC, anon, authenticated, service_role;/i
    );
  });

  it('updates only the two existing daily retention cron jobs to call the bounded pruners', () => {
    const { added } = scheduledJobs(sql);
    expect(added.sort()).toEqual([
      'ca-cash-hand-chair-clubs-prune-daily',
      'ca-cash-seat-occupancy-history-prune-daily',
    ]);
    expect(sql).toContain("SELECT smarter_private.fn_prune_cash_hand_chair_clubs(5000, 15);");
    expect(sql).toContain("SELECT smarter_private.fn_prune_cash_seat_occupancy_history(5000, 15);");
    expect(sql).not.toMatch(/\$cron\$[\s\S]*DELETE\s+FROM/i);
  });

  it('satisfies transaction shape, cost shape, function-probe, periodic-work, and live-proof laws', () => {
    expect(migrationTransactionShape(MIGRATION_NAME, sql).ok).toBe(true);
    expect(migrationCostRisks(MIGRATION_NAME, sql)).toEqual([]);
    expect(missingProbes(sql)).toEqual([]);
    expect(PERIODIC_WORK_MARKER.test(sql)).toBe(true);
    expect(sql).toMatch(/^-- @live-proof: .+/m);
  });

  it('wires the native PostgreSQL 17 proof script into the retention workflow', () => {
    expect(existsSync(PROOF_SCRIPT)).toBe(true);
    expect(workflow).toContain(`supabase/migrations/${MIGRATION_NAME}`);
    expect(workflow).toContain('scripts/ci/test-batch-daily-cash-retention-pruners.py');
    expect(workflow).toContain('python3 scripts/ci/test-batch-daily-cash-retention-pruners.py');
  });
});
