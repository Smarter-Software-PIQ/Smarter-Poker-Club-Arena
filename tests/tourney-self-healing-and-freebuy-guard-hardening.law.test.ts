import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATION_PATH = resolve(
  __dirname,
  '../supabase/migrations/20261110021359_tourney_self_healing_and_freebuy_guard_hardening.sql'
);
const SATELLITE_RPC_PATH = resolve(__dirname, '../server/src/tournament/satelliteSettlementRpc.ts');

const sql = readFileSync(MIGRATION_PATH, 'utf8');
const satelliteRpc = readFileSync(SATELLITE_RPC_PATH, 'utf8');

describe('tournament self-healing and free-buy transition audit guard hardening (20261110021359)', () => {
  it('declares a live-proof header and runs inside a single bounded transaction with break-window guard', () => {
    expect(sql).toMatch(/^-- @live-proof:\s+position\('9T22:30:00'/m);
    expect(sql.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(sql.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(sql).toContain("SET LOCAL lock_timeout = '2s';");
    expect(sql).toContain("SET LOCAL statement_timeout = '10s';");
    expect(sql).toContain('public.fn_ca_break_window_refuses_migrations(now())');
  });

  it('hardens fn_ca_free_buy_transition_audit_guard to match 9T22:30:00 and auditFreeBuyBoard slot strings while verifying live rows', () => {
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.fn_ca_free_buy_transition_audit_guard()'
    );
    expect(sql).toContain(
      "v_prob ~ '@ 2026-11-0(8T22:30:00|9T02:30:00|9T06:30:00|9T14:30:00|9T18:30:00|9T22:30:00)(\\.000)?(\\+00:00|Z): the rebuy period and late registration do not close together$'"
    );
    expect(sql).toContain(
      "v_prob ~ '^2 events share one host, slot and Chicago day \\(fade0000-0000-0000-0000-000000000001\\|(0|4|8|12|16)\\|2026-11-(08|09|10)\\)$'"
    );
    expect(sql).toContain("upper(coalesce(t.status, '')) NOT IN ('CANCELLED', 'CANCELED')");
    expect(sql).toContain(
      "GROUP BY t.club_id, date_trunc('hour', t.start_time AT TIME ZONE 'America/Chicago')"
    );
    expect(sql).toContain(
      'coalesce(jsonb_array_length(public.fn_sp_midway_free_buy_watch()), 0) > 0'
    );
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.fn_ca_free_buy_transition_audit_guard() FROM PUBLIC, anon, authenticated;'
    );
  });

  it('includes hand_history.created_at in fn_ca_tournament_dark_while_running self-resolution activity check', () => {
    expect(sql).toContain(
      '(SELECT hh.created_at FROM public.hand_history hh WHERE hh.tournament_id = t.id ORDER BY hh.created_at DESC LIMIT 1)) AS last_activity'
    );
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.fn_ca_tournament_dark_while_running(integer) FROM PUBLIC, anon, authenticated;'
    );
  });

  it('extends fn_resolve_settled_financial_alerts receipted closure to single-winner satellites and finalized bounty-only final-two events', () => {
    expect(sql).toContain('(cardinality(s.qualifier_ids)>0 OR s.winner_id IS NOT NULL)');
    expect(sql).toContain("'fn_ca_bounty_only_final_two_watch'");
    expect(sql).toContain(
      'round(COALESCE(t.bounty_pool_paid,0),2)=round(COALESCE(t.bounty_pool,0),2)'
    );
    expect(sql).toContain('tournament_bounty_completion_receipts');
    expect(sql).toContain('bounty-only-final-two-make-good:');
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.fn_resolve_settled_financial_alerts(boolean, integer) FROM PUBLIC, anon, authenticated;'
    );
  });

  it('retries satellite settlement outcome resolution on lock contention and distinguishes proven rollbacks from unknown outcomes', () => {
    expect(satelliteRpc).toContain('isLaneContention(error)');
    expect(satelliteRpc).toContain('isRolledBackStatementError(error)');
    expect(satelliteRpc).toContain(
      'for (let resolverAttempt = 1; resolverAttempt <= resolverAttempts; resolverAttempt++)'
    );
    expect(satelliteRpc).toContain('unprovenAttempts === 0');
    expect(satelliteRpc).toContain('resolverRolledBack');
  });
});
