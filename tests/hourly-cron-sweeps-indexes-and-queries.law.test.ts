/**
 * LAW: HOURLY PG_CRON SWEEPS USE BOUNDED INDEXED READS & SAFE-HORIZON CHECKPOINTS (2026-11-25).
 *
 * Migration 20261125022710_hourly_cron_sweeps_indexes_checkpoints_and_query_plans.sql
 * optimizes the 6 slowest hourly pg_cron jobs (128, 231, 155, 123, 214, 233)
 * that ran 38-56 s avg / 51-282 s max against their 60 s headroom budget.
 *
 * Pins:
 *   1. Exact CONCURRENTLY preamble before BEGIN;, one bounded transaction ending
 *      in COMMIT;, strict -- @replaces-md5: pins for all 13 replaced functions,
 *      mandatory -- @probe-for: subtransaction-unwound probes for all 13, and
 *      -- @live-proof: assertion.
 *   2. Non-collision: zero cron.job mutations, zero PR #11956 function touches,
 *      zero watched guard (fn_ca_guard_watchlist) touches, zero DROP statements.
 *   3. Permanent algorithmic shapes so later edits cannot quietly re-introduce
 *      unbounded scans or O(N^2) per-pool loops across the 6 jobs.
 *   4. Self-contained native PG17 qualification script exists alongside exact
 *      production preimage fixtures.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { splitConcurrentPreamble } from '../scripts/ci/migration-concurrent-preamble.mjs';
import { missingProbes } from '../scripts/ci/migration-function-probes.mjs';
import { functionBody, latestDeclaring } from './helpers/migrations';

const ROOT = resolve(import.meta.dirname, '..');
const MIG_NAME = '20261125022710_hourly_cron_sweeps_indexes_checkpoints_and_query_plans.sql';
const SQL = readFileSync(resolve(ROOT, 'supabase/migrations', MIG_NAME), 'utf8');

const EXPECTED_INDEXES = [
  'idx_chip_ledger_house_corrections_by_tournament',
  'idx_table_seats_joined_at_cover',
  'idx_tournaments_completed_id',
  'idx_tournament_players_winner_tid',
  'idx_bbj_contributions_created_at_cover',
  'idx_tournaments_private_union',
  'idx_tables_private_union',
  'idx_tables_live_union_club_mismatch',
  'idx_tournament_knockout_candidates_pending_unresolved',
  'idx_tournament_knockout_candidates_resolved_at',
  'idx_ca_ledger_write_failures_occurred_at',
];

const REPLACED_PINS: [string, string][] = [
  ['public.fn_club_rake_rollup_day(uuid,date)', 'a71de30b73dbe5ccfe3cc32c9e363c50'],
  ['public.fn_ca_reporting_rollups_from_facts(date)', 'cc3dde7765d2ed383b26ea9c96cd9a20'],
  ['public.fn_pay_backed_payout_shortfalls(boolean,integer)', '8a6a20c6856b200dfa0ff7a1550044e4'],
  ['public.fn_bbj_reconcile(uuid)', '516d3dbfab2ab31588907ef4934771e3'],
  ['public.fn_bbj_reconcile_all()', 'e1250fbc290628ac23400c111624eef4'],
  ['public.fn_rake_bbj_invariants(integer)', '2a8c79452ced863cfb15364d1e62a40c'],
  ['public.fn_union_integrity_sweep(uuid,integer)', 'f764df872c6812b8186bf2329e670f76'],
  ['public.fn_ca_completed_without_a_champion()', '962fc139f74e4840902d5a4655ac8f26'],
  ['public.fn_ca_undeclared_money_paths()', '86cf4170398c88a22f012c0748998fe7'],
  ['public.fn_ca_ledger_audit_checkpoint_advance()', 'dbb5a1efc418461bfd190e5fdeb204e4'],
  ['public.fn_bbj_conservation_check()', '45166a61fd8b0f36a4bed1127b075e83'],
  ['public.fn_bbj_promo_bank_check()', '8061f898a2b966eda4c518851fd7e8b9'],
  ['public.fn_ca_knockout_door_stalled(integer)', '0ac830e35079db87132632bab2e6cf37'],
];

const PR_11956_FORBIDDEN = [
  'fn_sp_digest_daily_results_compute',
  'fn_sp_digest_house_figures',
  'fn_sp_daily_metrics_compute',
  'fn_sp_digest_attention',
  'fn_sp_original_alert_proof',
  'sp_prune_hand_history',
  'sp_prune_hand_state_snapshots',
  'fn_ca_ledger_replay',
  'reliability_proved_source_resolution',
];

describe('hourly pg_cron sweeps use bounded indexed reads and safe-horizon checkpoints', () => {
  it('passes concurrent preamble split, single transaction framing, and pre-commit probes', () => {
    const split = splitConcurrentPreamble(SQL);
    expect(split.ok).toBe(true);
    if (split.ok) {
      expect(split.indexes.map((i) => i.name)).toEqual(EXPECTED_INDEXES);
    }
    expect(missingProbes(SQL)).toEqual([]);
    expect(SQL).toMatch(/^SET LOCAL lock_timeout = '3s';$/m);
    expect(SQL).toMatch(/^-- @live-proof: /m);
  });

  it('pins every replaced function preimage MD5, preserves metadata/ACLs, and enforces non-collision', () => {
    for (const [sig, md5] of REPLACED_PINS) {
      expect(SQL).toContain(`-- @replaces-md5: ${sig}=${md5}`);
      expect(SQL).toContain(`('${sig}', '${md5}',`);
    }
    expect(SQL).toContain('HOURLY_CRON_PERF_INSTALLER_ROLE');
    expect(SQL).toContain('HOURLY_CRON_PERF_INDEX_INVALID');
    expect(SQL).toContain('HOURLY_CRON_PERF_PREIMAGE_DRIFT');
    expect(SQL).toContain('HOURLY_CRON_PERF_META_CHANGED');

    // Non-collision: never touches cron.job or PR #11956 functions or drops objects
    const code = SQL.replace(/--[^\n]*/g, '');
    expect(code).not.toMatch(/cron\.(schedule|alter_job|unschedule)\s*\(/i);
    expect(code).not.toMatch(/^\s*DROP\s+(TABLE|INDEX|FUNCTION|TRIGGER)\b/im);
    for (const fn of PR_11956_FORBIDDEN) {
      expect(code).not.toContain(fn);
    }
  });

  it('keeps the permanent optimizations on the latest definitions of all 6 job paths', () => {
    // Job 128
    expect(
      functionBody(latestDeclaring('fn_club_rake_rollup_day').sql, 'fn_club_rake_rollup_day')
    ).toContain("v_cutoff := public.fn_ca_launch_accounting_cutoff('club', p_club_id);");
    expect(
      functionBody(
        latestDeclaring('fn_ca_reporting_rollups_from_facts').sql,
        'fn_ca_reporting_rollups_from_facts'
      )
    ).toContain('window_attributions AS MATERIALIZED');

    // Job 231
    expect(
      functionBody(
        latestDeclaring('fn_pay_backed_payout_shortfalls').sql,
        'fn_pay_backed_payout_shortfalls'
      )
    ).toContain("min(created_at) - interval '1 day'");

    // Job 155 (fn_bbj_reconcile / fn_bbj_reconcile_all use anchored live-source edits)
    expect(SQL).toContain("pg_get_functiondef('public.fn_bbj_reconcile(uuid)'::regprocedure)");
    expect(SQL).toContain("pg_get_functiondef('public.fn_bbj_reconcile_all()'::regprocedure)");
    expect(SQL).toContain('public.ca_bbj_reconcile_marks');
    expect(SQL).toContain('array_append(v_out_arr,');
    expect(
      functionBody(latestDeclaring('fn_rake_bbj_invariants').sql, 'fn_rake_bbj_invariants')
    ).toContain('WITH scope AS MATERIALIZED');

    // Job 123
    const sweep = functionBody(
      latestDeclaring('fn_union_integrity_sweep').sql,
      'fn_union_integrity_sweep'
    );
    expect(sweep).toContain('ct.club_id = ANY (v_scope_clubs)');
    expect(sweep).toContain('fn_union_transfer_counts_as_dump(ct)');

    // Job 214
    expect(
      functionBody(
        latestDeclaring('fn_ca_completed_without_a_champion').sql,
        'fn_ca_completed_without_a_champion'
      )
    ).toContain('WITH no_win AS MATERIALIZED');
    expect(
      functionBody(
        latestDeclaring('fn_ca_undeclared_money_paths').sql,
        'fn_ca_undeclared_money_paths'
      )
    ).toContain('position(w.tbl_l in f.src_l) > 0');

    // Job 233
    expect(
      functionBody(
        latestDeclaring('fn_ca_ledger_audit_checkpoint_advance').sql,
        'fn_ca_ledger_audit_checkpoint_advance'
      )
    ).toContain('public.ca_bbj_promo_audit_mark');
    expect(
      functionBody(latestDeclaring('fn_bbj_conservation_check').sql, 'fn_bbj_conservation_check')
    ).toContain('tail_by_pool AS MATERIALIZED');
    expect(
      functionBody(latestDeclaring('fn_bbj_promo_bank_check').sql, 'fn_bbj_promo_bank_check')
    ).toContain('public.ca_bbj_promo_audit_mark');
    expect(
      functionBody(
        latestDeclaring('fn_ca_knockout_door_stalled').sql,
        'fn_ca_knockout_door_stalled'
      )
    ).toContain('WHERE c.resolved_at IS NULL');
  });

  it('ships the self-contained native PG17 qualification script and exact preimage fixtures', () => {
    expect(
      existsSync(resolve(ROOT, 'scripts/ci/test-hourly-cron-sweeps-indexes-and-queries.py'))
    ).toBe(true);
    for (const [sig] of REPLACED_PINS) {
      const fn = sig.replace(/^public\./, '').replace(/\(.*$/, '');
      expect(existsSync(resolve(ROOT, `scripts/ci/fixtures/hourly-cron-perf/${fn}.sql`))).toBe(
        true
      );
    }
  });
});
