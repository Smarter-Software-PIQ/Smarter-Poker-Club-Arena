/**
 * THE LIGHTNING EVENT LOG KEEPS THIRTY DAYS (2026-11-26)
 *
 * public.cash_cluster_events had no retention: 46 GB and about 64 M rows in
 * twelve weeks. Every live reader was checked: none replays state from the
 * log, every one is time-bounded, and the only one that reaches back past a
 * window is "cluster_frozen since the current epoch began", whose events are
 * kept while their game is frozen.
 *
 * This law pins, against the newest definer of the pruner:
 *   1. the floor: no keep shorter than 30 days is accepted;
 *   2. the shape: owner-only SECURITY DEFINER, pinned search_path and
 *      timeouts, all four roles revoked;
 *   3. the bound: one call reads only the lowest p_batch ids by primary key
 *      and deletes at most 50 000 rows, so it never walks the young rows;
 *   4. the exception: a cluster_frozen event of a frozen game is never deleted;
 *   5. the schedule: one job every 5 minutes at 30 days and 15 000 rows;
 *   6. the migration obeys the transaction, cost, probe, periodic-work and
 *      @live-proof laws and the function is declared in schema-manifest.d;
 *   7. nothing else in the repo deletes from cash_cluster_events by age.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { migrationTransactionShape } from '../scripts/ci/migration-transaction-shape.mjs';
import { migrationCostRisks } from '../scripts/ci/migration-cost-shape.mjs';
import { missingProbes } from '../scripts/ci/migration-function-probes.mjs';
import { PERIODIC_WORK_MARKER, scheduledJobs } from '../scripts/ci/check-no-new-band-aids.mjs';

const ROOT = resolve(__dirname, '..');
const MIGRATIONS = resolve(ROOT, 'supabase/migrations');
const FIRST = '20261126215730_lightning_event_log_keeps_thirty_days.sql';
const FN = 'public.fn_ca_prune_cash_cluster_events';

const files = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql') && f >= FIRST)
  .sort();
const definers = files.filter((f) =>
  readFileSync(resolve(MIGRATIONS, f), 'utf8').includes(`CREATE OR REPLACE FUNCTION ${FN}(`)
);
const newest = definers[definers.length - 1];
const sql = readFileSync(resolve(MIGRATIONS, newest ?? FIRST), 'utf8');
const body = (() => {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION ${FN}(`);
  const end = sql.indexOf('END $function$;', start);
  return sql.slice(start, end);
})();

describe('the Lightning event log keeps thirty days', () => {
  it('is defined by a migration at or after the first one', () => {
    expect(definers[0]).toBe(FIRST);
  });

  it('refuses a keep shorter than 30 days', () => {
    expect(body).toContain("p_keep interval DEFAULT interval '30 days'");
    expect(body).toContain("IF p_keep IS NULL OR p_keep < interval '30 days' THEN");
    expect(body).toMatch(/RAISE EXCEPTION[^;]*USING ERRCODE = '22023'/);
  });

  it('is owner-only with pinned search_path and timeouts', () => {
    expect(body).toContain('SECURITY DEFINER');
    expect(body).toContain("SET search_path TO 'public'");
    expect(body).toMatch(/SET statement_timeout TO '\d+s'/);
    expect(body).toMatch(/SET lock_timeout TO '\d+s'/);
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.fn_ca_prune_cash_cluster_events\(interval, integer\)\s+FROM PUBLIC, anon, authenticated, service_role;/
    );
  });

  it('reads only the lowest p_batch ids and deletes at most 50 000 rows a call', () => {
    expect(body).toContain('LEAST(50000, GREATEST(COALESCE(p_batch');
    expect(body).toMatch(
      /lowest AS MATERIALIZED \(\s*SELECT e\.id, e\.at, e\.kind, e\.game_id\s+FROM public\.cash_cluster_events e\s+ORDER BY e\.id\s+LIMIT v_batch\s*\)/
    );
    expect(body).toMatch(/FROM lowest l\s+WHERE l\.at < v_cutoff/);
    expect(body).toMatch(/WHERE t\.id = d\.id\s+AND t\.at < v_cutoff/);
    expect(body.match(/FROM public\.cash_cluster_events/g)).toHaveLength(2);
  });

  it('never deletes a cluster_frozen event of a game that is frozen now', () => {
    expect(body).toMatch(
      /AND NOT \(l\.kind = 'cluster_frozen'\s+AND EXISTS \(SELECT 1 FROM public\.cash_games g\s+WHERE g\.id = l\.game_id AND g\.cluster_mode = 'frozen'\)\)/
    );
  });

  it('runs every 5 minutes at 30 days and 15 000 rows', () => {
    const first = readFileSync(resolve(MIGRATIONS, FIRST), 'utf8');
    expect(scheduledJobs(first).added).toEqual(['ca-cash-cluster-events-retention']);
    expect(first).toContain("'*/5 * * * *'");
    expect(first).toContain(
      "SELECT public.fn_ca_prune_cash_cluster_events(interval '30 days', 15000);"
    );
    expect(first).not.toMatch(/\$cron\$[\s\S]*DELETE\s+FROM/i);
  });

  it('obeys the transaction, cost, probe, periodic-work and live-proof laws', () => {
    const first = readFileSync(resolve(MIGRATIONS, FIRST), 'utf8');
    expect(migrationTransactionShape(FIRST, first).ok).toBe(true);
    expect(migrationCostRisks(FIRST, first)).toEqual([]);
    expect(missingProbes(first)).toEqual([]);
    expect(PERIODIC_WORK_MARKER.test(first)).toBe(true);
    expect(first).toMatch(/^-- @live-proof: .+/m);
  });

  it('is declared in schema-manifest.d', () => {
    const manifest = JSON.parse(
      readFileSync(
        resolve(ROOT, 'scripts/ci/schema-manifest.d/cash-cluster-events-retention.json'),
        'utf8'
      )
    ) as { functions?: string[] };
    expect(manifest.functions).toContain('fn_ca_prune_cash_cluster_events');
  });

  it('is the only age-based delete of cash_cluster_events in a migration since it', () => {
    const others = files.filter(
      (f) =>
        f !== FIRST &&
        /DELETE\s+FROM\s+public\.cash_cluster_events[\s\S]{0,200}\bat\s*</i.test(
          readFileSync(resolve(MIGRATIONS, f), 'utf8')
        )
    );
    expect(others).toEqual([]);
  });
});
