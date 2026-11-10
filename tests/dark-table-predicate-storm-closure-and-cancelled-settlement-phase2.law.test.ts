import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const MIGRATION_PATH = resolve(
  ROOT,
  'supabase/migrations/20261110061253_dark_table_predicate_storm_closure_and_cancelled_settlement_.sql'
);

describe('Phase 2 tournament self-healing: dark-table predicate hardening, generalized storm closure, and cancelled settlement resolution', () => {
  const migrationSql = readFileSync(MIGRATION_PATH, 'utf8');

  it('has a valid @live-proof header and hourly break-window guard', () => {
    expect(migrationSql).toMatch(/^-- @live-proof:\s+.+/m);
    expect(migrationSql).toContain('public.fn_ca_break_window_refuses_migrations(now())');
  });

  it('bounds tables.updated_at in fn_ca_tournament_dark_candidates so non-dealing table updates cannot indefinitely conceal a stopped table', () => {
    const start = migrationSql.indexOf(
      'CREATE OR REPLACE FUNCTION public.fn_ca_tournament_dark_candidates'
    );
    const end = migrationSql.indexOf('$function$;', start);
    const candidateFn = migrationSql.slice(start, end);

    // Preserves the composite progress signal (started_at, bounded tables.updated_at,
    // tournament_players.eliminated_at, and hand_history.created_at)
    expect(candidateFn).toContain('t.started_at');
    expect(candidateFn).toContain('SELECT max(tb.updated_at) FROM public.tables tb');
    expect(candidateFn).toContain('SELECT max(tp.eliminated_at) FROM public.tournament_players tp');
    expect(candidateFn).toContain('SELECT hh.created_at FROM public.hand_history hh');

    // Bounds tb.updated_at by the latest authoritative start, elimination, or committed hand
    expect(candidateFn).toContain('AND tb.updated_at <= GREATEST(');
    expect(migrationSql).toContain(
      'REVOKE ALL ON FUNCTION public.fn_ca_tournament_dark_candidates(integer) FROM PUBLIC, anon, authenticated;'
    );
  });

  it('removes non-dealing tables.updated_at from fn_ca_tournament_dark_while_running self-resolution and requires the tournament to no longer be a dark candidate', () => {
    const darkNewIdx = migrationSql.indexOf('c_dark_new constant text :=');
    const darkNewEnd = migrationSql.indexOf('v_inc_def text;', darkNewIdx);
    const darkNewBlock = migrationSql.slice(darkNewIdx, darkNewEnd);

    // Self-resolution for a RUNNING tournament checks only eliminations and committed hands, never tb.updated_at
    expect(darkNewBlock).not.toContain('max(tb.updated_at)');
    expect(darkNewBlock).toContain(
      'SELECT max(tp.eliminated_at) FROM public.tournament_players tp WHERE tp.tournament_id = t.id'
    );
    expect(darkNewBlock).toContain(
      'SELECT hh.created_at FROM public.hand_history hh WHERE hh.tournament_id = t.id ORDER BY hh.created_at DESC LIMIT 1'
    );
    expect(darkNewBlock).toContain('FROM public.fn_ca_tournament_dark_candidates(v_threshold) dc');
    expect(migrationSql).toContain(
      'REVOKE ALL ON FUNCTION public.fn_ca_tournament_dark_while_running(integer) FROM PUBLIC, anon, authenticated;'
    );
  });

  it('generalizes storm:financial_alerts:* auto-closure in fn_ca_alert_resolution_reaches_the_incident to all sources with exact versioned member proof', () => {
    const incNewIdx = migrationSql.indexOf('c_inc_new constant text :=');
    const incNewEnd = migrationSql.indexOf('v_res_def text;', incNewIdx);
    const incNewBlock = migrationSql.slice(incNewIdx, incNewEnd);

    expect(incNewBlock).toContain('IF NEW.source IS NOT NULL THEN');
    expect(incNewBlock).toContain("AND i.dedupe_key=''storm:financial_alerts:'' || NEW.source");
    expect(incNewBlock).toContain("e.detail->''financial_member_version''=''1''::jsonb");
    expect(migrationSql).toContain('$reconcile_resolved_storms$');
    expect(migrationSql).toContain(
      'REVOKE ALL ON FUNCTION public.fn_ca_alert_resolution_reaches_the_incident() FROM PUBLIC, anon, authenticated;'
    );
  });

  it('extends fn_resolve_settled_financial_alerts to resolve tournament alerts when a tournament is cancelled with 100% refund conservation and zero escrow', () => {
    expect(migrationSql).toContain(
      'round(COALESCE(e.refund_prize,0)+COALESCE(e.refund_bounty,0)+COALESCE(e.refund_fee,0),2)=round(COALESCE(e.gross_in,0),2)'
    );
    expect(migrationSql).toContain(
      'COALESCE(e.prize_out,0)=0 AND COALESCE(e.bounty_out,0)=0 AND COALESCE(e.fee_out,0)=0'
    );
    expect(migrationSql).toContain(
      'REVOKE ALL ON FUNCTION public.fn_resolve_settled_financial_alerts(boolean, integer) FROM PUBLIC, anon, authenticated;'
    );
  });
});
