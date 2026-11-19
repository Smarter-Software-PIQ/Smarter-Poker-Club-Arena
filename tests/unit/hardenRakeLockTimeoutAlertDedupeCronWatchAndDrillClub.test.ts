/**
 * HARDEN RAKE LOCK TIMEOUT, TERMINAL ALERT DEDUPE, CRON WATCH PRIORITY, AND ALARM DRILL CLUB (2026-11-19).
 *
 * Pins the four hardening fixes in 20261119180800:
 *   1. fn_ca_bank_pending_cash_rake always restores v_lock_timeout on every path
 *      (banked, busy, refused, terminal) and skips duplicate unresolved
 *      bank_obligation_terminal_refusal alerts on unrelated DDL re-ask.
 *   2. fn_ca_bank_pending_hand_obligations skips duplicate unresolved
 *      bank_obligation_terminal_refusal alerts for the same (hand_id, obligation, item).
 *   3. fn_ca_cron_failure_watch orders infrequent/weekly failures
 *      (day.runs_24h = 0 AND day.last_finished_failed) DESC ahead of frequent
 *      failures so 20 frequent failing jobs cannot push a failed weekly drill off LIMIT 20.
 *   4. fn_ca_alarm_drill excludes delete-protected Deep Stack Society
 *      (2a1132b9-5ba2-42e6-9f01-30a7fcffebe3) from subject selection without
 *      bypassing app.deep_stack_teardown.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { sliceSqlStatement } from '../helpers/sourceWindow';

const ROOT = resolve(__dirname, '../..');
const FILE = '20261119180800_harden_rake_lock_timeout_cron_watch_and_drill.sql';
const sql = readFileSync(join(ROOT, 'supabase/migrations', FILE), 'utf8');

const fnBody = (qualified: string) =>
  sliceSqlStatement(sql, `CREATE OR REPLACE FUNCTION ${qualified}(`);

describe('harden rake lock_timeout, terminal alert dedupe, cron watch priority, and alarm drill club', () => {
  it('wraps the migration in BEGIN ... COMMIT and preserves service_role-only grants', () => {
    expect(sql).toMatch(/^BEGIN;/m);
    expect(sql).toMatch(/^COMMIT;$/m);
    for (const sig of [
      'public.fn_ca_bank_pending_cash_rake(uuid)',
      'public.fn_ca_bank_pending_hand_obligations(uuid)',
      'public.fn_ca_alarm_drill()',
      'public.fn_ca_cron_failure_watch()',
    ]) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC, anon, authenticated;`);
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION ${sig} TO service_role;`);
    }
  });

  it('fn_ca_bank_pending_cash_rake restores v_lock_timeout on banked, busy, refused, and terminal paths', () => {
    const body = fnBody('public.fn_ca_bank_pending_cash_rake');
    expect(body).toContain("PERFORM set_config('lock_timeout', '250ms', true);");

    const busyBranch = body.slice(
      body.indexOf('WHEN lock_not_available THEN'),
      body.indexOf('WHEN OTHERS THEN')
    );
    expect(busyBranch).toContain("PERFORM set_config('lock_timeout', v_lock_timeout, true);");

    const afterBlock = body.slice(body.indexOf('GET STACKED DIAGNOSTICS'));
    const endIdx = afterBlock.indexOf('END;');
    const restoreAfterEnd = afterBlock.indexOf(
      "PERFORM set_config('lock_timeout', v_lock_timeout, true);",
      endIdx
    );
    const transientCheck = afterBlock.indexOf('smarter_private.bank_refusal_is_transient(v_state)');
    expect(restoreAfterEnd).toBeGreaterThan(endIdx);
    expect(restoreAfterEnd).toBeLessThan(transientCheck);
  });

  it('both bankers deduplicate unresolved bank_obligation_terminal_refusal alerts on re-ask', () => {
    const rake = fnBody('public.fn_ca_bank_pending_cash_rake');
    expect(rake).toMatch(
      /IF FOUND AND NOT EXISTS \(\s*SELECT 1 FROM public\.financial_alerts a[\s\S]*?a\.source = 'bank_obligation_terminal_refusal'[\s\S]*?AND NOT a\.resolved[\s\S]*?a\.context->>'hand_id' = p_hand_id::text[\s\S]*?a\.context->>'obligation' = 'rake'/
    );

    const oblig = fnBody('public.fn_ca_bank_pending_hand_obligations');
    expect(oblig).toMatch(
      /IF FOUND AND NOT EXISTS \(\s*SELECT 1 FROM public\.financial_alerts a[\s\S]*?a\.source = 'bank_obligation_terminal_refusal'[\s\S]*?AND NOT a\.resolved[\s\S]*?a\.context->>'hand_id' = p_hand_id::text[\s\S]*?a\.context->>'obligation' = k\.kind[\s\S]*?a\.context->>'item' = k\.item_key/
    );
  });

  it('fn_ca_cron_failure_watch detects weekly/infrequent failures immediately and orders them ahead of frequent failures before LIMIT 20', () => {
    const watch = fnBody('public.fn_ca_cron_failure_watch');
    expect(watch).toContain(
      "count(*) FILTER (WHERE x.status IN ('failed', 'succeeded')) AS runs_7d"
    );
    expect(watch).toContain(
      'OR ((day.runs_24h = 0 OR day.runs_7d = 1) AND day.last_finished_failed)'
    );
    expect(watch).toContain(
      'ORDER BY ((day.runs_24h = 0 OR day.runs_7d = 1) AND day.last_finished_failed) DESC, day.fails DESC, day.jobname'
    );
    expect(watch).toContain('CASE WHEN r.runs_24h = 0 OR r.runs_7d = 1');
    expect(watch).toContain('LIMIT 20');
    expect(sql).toContain(
      "SELECT public.fn_ca_declare_guard_redefinition('fn_ca_cron_failure_watch', 'migration 20261119180800_harden_rake_lock_timeout_cron_watch_and_drill');"
    );
  });

  it('fn_ca_alarm_drill excludes Deep Stack Society without bypassing app.deep_stack_teardown', () => {
    const drill = fnBody('public.fn_ca_alarm_drill');
    const selection = drill.slice(
      drill.indexOf('SELECT cm.club_id, cm.user_id INTO c_midway_club, c_cert_user'),
      drill.indexOf('IF c_cert_user IS NULL THEN')
    );
    expect(selection).toContain("AND cm.club_id <> '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'");
    expect(drill).not.toContain('deep_stack_teardown');
    expect(sql).toMatch(/^-- @probe-exempt: public\.fn_ca_alarm_drill /m);
  });

  it('smarter_private.cash_hand_earning_club_evidence keeps all provenance tiers and adds a manifest-free seat-history fallback', () => {
    const ev = fnBody('smarter_private.cash_hand_earning_club_evidence');
    for (const marker of [
      'smarter_private.cash_hand_chair_clubs',
      'smarter_private.cash_seat_occupancy_history',
      'public.cash_hand_participant_manifests',
      'public.ca_seat_stack_exits',
    ]) {
      expect(ev).toContain(marker);
    }
    expect(ev).toContain('FROM public.hands h');
    expect(ev).toContain('o.joined_at <= v_played_at');
    expect(ev).toContain('o.ended_at >= v_played_at');
    expect(ev).toContain('count(DISTINCT o.club_id) = 1');
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION smarter_private.cash_hand_earning_club_evidence(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;'
    );
  });

  it('daily evidence prune cron jobs protect rows referenced by public.cash_rake_pending and guard on pg_cron', () => {
    expect(sql).toContain("IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN");
    expect(sql).toContain('ca-cash-hand-chair-clubs-prune-daily');
    expect(sql).toContain(
      'AND NOT EXISTS (SELECT 1 FROM public.cash_rake_pending rp WHERE rp.table_id = c.table_id AND rp.hand_number = c.hand_number)'
    );
    expect(sql).toContain('ca-cash-seat-occupancy-history-prune-daily');
    expect(sql).toContain(
      'AND NOT EXISTS (SELECT 1 FROM public.cash_rake_pending rp WHERE rp.table_id = o.table_id)'
    );
  });

  it('probes all four non-exempt redefined functions before commit', () => {
    expect(sql).toMatch(/^-- @probe-for: public\.fn_ca_bank_pending_cash_rake$/m);
    expect(sql).toMatch(/^-- @probe-for: public\.fn_ca_bank_pending_hand_obligations$/m);
    expect(sql).toMatch(/^-- @probe-for: public\.fn_ca_cron_failure_watch$/m);
    expect(sql).toMatch(/^-- @probe-for: smarter_private\.cash_hand_earning_club_evidence$/m);
  });
});
