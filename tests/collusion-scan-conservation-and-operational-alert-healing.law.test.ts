import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const MIGRATION_PATH = resolve(
  ROOT,
  'supabase/migrations/20261110152729_collusion_scan_index_plan_conservation_and_operational_alert.sql'
);

describe('Phase 3 self-healing: index-backed collusion scan, single-pass conservation deltas, pldbgapi2 GUC hardening, and operational alert re-measurement', () => {
  const migrationSql = readFileSync(MIGRATION_PATH, 'utf8');

  it('has a valid @live-proof header and hourly break-window guard', () => {
    expect(migrationSql).toMatch(/^-- @live-proof:\s+.+/m);
    expect(migrationSql).toContain('public.fn_ca_break_window_refuses_migrations(now())');
  });

  it('optimizes fn_ca_collusion_scan to use an index-backed LATERAL aggregation over profiles and ca_hand_transfers with pre-materialized cert_users and detector retirement check', () => {
    const start = migrationSql.indexOf('CREATE OR REPLACE FUNCTION public.fn_ca_collusion_scan');
    const end = migrationSql.indexOf('$fn$;', start);
    const fnBody = migrationSql.slice(start, end);

    expect(fnBody).toContain('FROM public.profiles p');
    expect(fnBody).toContain('CROSS JOIN LATERAL (');
    expect(fnBody).toContain('WHERE t.winner_id = p.id');
    expect(fnBody).toContain('cert_users AS MATERIALIZED');
    expect(fnBody).toContain("WHERE dr.source = 'fn_ca_collusion_scan'");
    expect(migrationSql).toContain(
      'REVOKE ALL ON FUNCTION public.fn_ca_collusion_scan(integer) FROM PUBLIC, anon, authenticated;'
    );
    expect(migrationSql).toContain(
      'GRANT EXECUTE ON FUNCTION public.fn_ca_collusion_scan(integer) TO service_role;'
    );
  });

  it('optimizes fn_tournament_conservation_deltas with a shared special_ledger MATERIALIZED CTE and BitmapAnd-free entity equality while preserving service_role grants', () => {
    const start = migrationSql.indexOf(
      'CREATE OR REPLACE FUNCTION public.fn_tournament_conservation_deltas'
    );
    const end = migrationSql.indexOf('$deltas$;', start);
    const fnBody = migrationSql.slice(start, end);

    expect(fnBody).toContain('special_ledger AS MATERIALIZED');
    expect(fnBody).toContain('COALESCE(x.from_entity_id, x.from_entity_id) = x.tournament_id');
    expect(fnBody).toContain('COALESCE(x.to_entity_id, x.to_entity_id) = x.tournament_id');
    expect(migrationSql).toContain(
      'REVOKE ALL ON FUNCTION public.fn_tournament_conservation_deltas(timestamp with time zone, timestamp with time zone) FROM PUBLIC, anon, authenticated;'
    );
    expect(migrationSql).toContain(
      'GRANT EXECUTE ON FUNCTION public.fn_tournament_conservation_deltas(timestamp with time zone, timestamp with time zone) TO service_role;'
    );
  });

  it('extends fn_resolve_settled_financial_alerts with CLASS 9 operational re-measurement and twin incident upgrade', () => {
    const start = migrationSql.indexOf(
      'CREATE OR REPLACE FUNCTION public.fn_resolve_settled_financial_alerts'
    );
    const end = migrationSql.indexOf('$fn$;', start);
    const fnBody = migrationSql.slice(start, end);

    expect(fnBody).toContain("a.source = 'postHandTasks.leave_pending_failed'");
    expect(fnBody).toContain("a.source = 'drift_incident:fn_ca_cron_failure_watch'");
    expect(fnBody).toContain("a.source = 'fn_ca_daily_bonus_claim.budget_anomaly'");
    expect(fnBody).toContain("a.source = 'fn_ca_writer_lock_sentinel'");
    expect(fnBody).toContain("a.source = 'HorseFleet.stableHandHeartbeat'");
    expect(fnBody).toContain("'operational_remeasured_alerts', v_operational");
    expect(fnBody).toContain("'cron_incident_twins_upgraded', v_cron_twins");
    expect(migrationSql).toContain(
      'REVOKE ALL ON FUNCTION public.fn_resolve_settled_financial_alerts(boolean, integer) FROM PUBLIC, anon, authenticated;'
    );
  });

  it('disables plpgsql_check pldbgapi2 runtime call-stack hooks, backfills historical zero-balance terminal escrows, and verifies pre-September-9 Spin refunds', () => {
    expect(migrationSql).toContain("SET plpgsql_check.mode = 'disabled'");
    expect(migrationSql).toContain('historical zero-balance terminal escrow backfill');
    expect(migrationSql).toContain('fn_ca_declare_guard_redefinition');
    expect(migrationSql).toContain('8962ca34-84dc-4f5d-ad2a-bccf85215ef0');
    expect(migrationSql).toContain('c3f667d5-422b-47bb-9b1b-0898fa1c7003');
  });
});
