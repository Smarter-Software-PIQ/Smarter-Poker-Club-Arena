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
const FILE = '20261119180800_harden_rake_lock_timeout_alert_dedupe_cron_watch_and_drill_club.sql';
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

  it('fn_ca_cron_failure_watch orders infrequent/weekly failures ahead of frequent failures before LIMIT 20', () => {
    const watch = fnBody('public.fn_ca_cron_failure_watch');
    expect(watch).toContain(
      'ORDER BY (day.runs_24h = 0 AND day.last_finished_failed) DESC, day.fails DESC, day.jobname'
    );
    expect(watch).toContain('LIMIT 20');
    expect(sql).toContain(
      "SELECT public.fn_ca_declare_guard_redefinition('fn_ca_cron_failure_watch', 'migration 20261119180800_harden_rake_lock_timeout_alert_dedupe_cron_watch_and_drill_club');"
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

  it('probes all three non-exempt redefined functions before commit', () => {
    expect(sql).toMatch(/^-- @probe-for: public\.fn_ca_bank_pending_cash_rake$/m);
    expect(sql).toMatch(/^-- @probe-for: public\.fn_ca_bank_pending_hand_obligations$/m);
    expect(sql).toMatch(/^-- @probe-for: public\.fn_ca_cron_failure_watch$/m);
  });
});
