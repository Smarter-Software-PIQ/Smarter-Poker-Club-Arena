/**
 * LAW: THE WEEK'S P&L IS CERTIFIED BEFORE THE MONEY (2026-11-26, Mondays
 * 2026-11-16 and 2026-11-23).
 *
 * Union invoices are round 4 of the settlement cascade, which job 564
 * (weekly_union_books_due) reaches only after the payout rounds release the
 * week. The union P&L was certified only then, one step a tick, so every P&L
 * problem was found after the payout and invoices went out at 20:49 and
 * 20:05 Chicago. Its inputs are final hours earlier and the payout writes
 * nothing it reads, so it is now certified between the week close and ten
 * minutes before the payout, with the scope's own nonpaying sequence, and a
 * blocked P&L raises one critical alert before the money.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SQL = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20261126181638_weekly_pnl_is_certified_before_the_money.sql'),
  'utf8'
);
const fnBody = (name: string): string => {
  const start = SQL.indexOf(`CREATE OR REPLACE FUNCTION smarter_private.${name}(`);
  expect(start).toBeGreaterThan(-1);
  return SQL.slice(start, SQL.indexOf('$f$;', start));
};

describe('the week P&L is certified before the money', () => {
  it('is one transaction with lock and statement timeouts and a live proof', () => {
    expect(SQL.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(SQL.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(SQL).toContain("SET LOCAL lock_timeout = '5s';");
    expect(SQL).toContain("SET LOCAL statement_timeout = '10s';");
    expect(SQL).toMatch(/^-- @live-proof: /m);
    expect(SQL).not.toMatch(/^-- @install-window:/m);
  });

  it('refuses to install before the closed-week cash gate exists', () => {
    expect(SQL).toContain("to_regprocedure('smarter_private.weekly_closed_week_cash_settled(timestamptz)') IS NULL");
  });

  it('runs only between the week close and ten minutes before the payout, never once the payout started', () => {
    const f = fnBody('weekly_pnl_precertify');
    expect(f).toContain('OR p_at < p_end OR p_end > clock_timestamp() THEN');
    expect(f).toContain("IF due IS NULL OR p_at >= due - interval '10 minutes' THEN RETURN NULL; END IF;");
    expect(f).toMatch(/weekly_accounting_payout_pauses p\s+WHERE p\.period_end = p_end AND p\.instance_id = 'weekly-payout-rounds'\) THEN\s+RETURN NULL;/);
    // its attempt deadline ends before the payout, so the scope key is never held into the money
    expect(f).toContain("due - interval '2 minutes')::text, true);");
  });

  it('waits for the week cash, idle preparation, no seal and no freeze', () => {
    const f = fnBody('weekly_pnl_precertify');
    expect(f).toContain('smarter_private.weekly_closed_week_cash_settled(p_end) IS DISTINCT FROM true');
    expect(f).toContain('smarter_private.weekly_prep_caught_up(p_end, p_at) IS DISTINCT FROM true');
    expect(f).toContain('public.fn_union_pnl_inventory_seal_in_progress() IS NOT FALSE');
    expect(f).toContain('public.fn_platform_frozen() IS NOT FALSE OR public.fn_entry_purchases_frozen() IS NOT FALSE');
    const c = fnBody('weekly_prep_caught_up');
    expect(c).toContain('l.finished_at IS NULL OR l.units IS DISTINCT FROM 0 OR l.last_error IS NOT NULL');
    expect(c).toContain("OR l.started_at < p_at - interval '10 minutes'");
    expect(f).toContain('CONTINUE WHEN EXISTS (SELECT 1 FROM public.accounting_close_gates g');
  });

  it('seals the boundary inventory first, as the scheduler does, never in the last 15 minutes', () => {
    const f = fnBody('weekly_pnl_precertify');
    const seal = f.indexOf('public.fn_union_pnl_inventory_checkpoint_due()');
    expect(seal).toBeGreaterThan(-1);
    expect(seal).toBeLessThan(f.indexOf('public.fn_union_pnl_close_quality(u, s, p_end)'));
    expect(f).toContain('NOT EXISTS (SELECT 1 FROM public.union_pnl_inventory_checkpoints c WHERE c.boundary = p_end)');
    expect(f).toContain("p_at >= due - interval '15 minutes' OR public.fn_accounting_close_seal_held(p_end) IS NOT FALSE");
    expect(f).toContain("IF NOT pg_try_advisory_xact_lock(hashtextextended('union-accounting-scheduler', 0)) THEN");
    expect(f).toContain("'weekly-pnl-precertify-seal-failed:'");
  });

  it('only TRY-locks the scope key that preparation and late admissions share', () => {
    const f = fnBody('weekly_pnl_precertify');
    expect(f).toContain(
      "pg_try_advisory_xact_lock(hashtextextended('union-accounting:'||u::text||':'||extract(epoch FROM s)::text||':'||extract(epoch FROM p_end)::text,0))"
    );
    expect(f.replace(/--[^\n]*/g, '')).not.toMatch(/\bpg_advisory_xact_lock\(/);
    expect(f).toContain("pg_try_advisory_xact_lock(hashtextextended('union-pnl-precertify', 0))");
  });

  it('runs the scope nonpaying qualification sequence in order, and moves no money', () => {
    const f = fnBody('weekly_pnl_precertify');
    const order = [
      'public.fn_union_pnl_closed_book_barrier(p_end)',
      'public.fn_weekly_accounting_attempt_begin(true)',
      'public.fn_accounting_close_report_seed(u, s, p_end)',
      'public.fn_union_pnl_close_quality(u, s, p_end)',
      'public.fn_accounting_union_earned_plan_advance(u, s, p_end)',
      'public.fn_accounting_close_report_keep(u, s, p_end)',
    ];
    let at = -1;
    for (const step of order) {
      const i = f.indexOf(step, at + 1);
      expect(i, step).toBeGreaterThan(at);
      at = i;
    }
    const code = f.replace(/--[^\n]*/g, '');
    for (const money of ['fn_union_settlement_cascade', 'fn_process_weekly_accounting', 'union_accounting_runs', 'weekly_payout_execute']) {
      expect(code).not.toContain(money);
    }
  });

  it('a blocked P&L raises one deduplicated critical alert before the payout', () => {
    const f = fnBody('weekly_pnl_precertify');
    expect(f).toContain("'critical', 'weekly_pnl_precertify'");
    expect(f).toContain("'weekly-pnl-precertify-blocked:'||u::text||':'||extract(epoch FROM p_end)::bigint::text");
    expect(f).toContain(`q->'issues' IS DISTINCT FROM '["union_pnl_certification_in_progress"]'::jsonb`);
  });

  it('a failure falls through to the unchanged books logic with one warning', () => {
    const f = fnBody('weekly_pnl_precertify');
    expect(f).toMatch(/EXCEPTION WHEN OTHERS THEN\s+PERFORM public\.fn_weekly_accounting_attempt_end\(\);/);
    expect(f).toContain("'weekly-pnl-precertify-failed:'");
  });

  it('job 564 calls it first only before the payout, from the pinned live definition', () => {
    expect(SQL).toContain("old_books constant text := 'c4b8c5572632490aaa7fb03ac79de49e'");
    expect(SQL).toContain("anchor constant text := E'  due := public.fn_union_accounting_run_at(e);\\n'");
    expect(SQL).toContain("E'  IF n >= e AND n < due THEN\\n'");
    expect(SQL).toContain("E'    v_tick := smarter_private.weekly_pnl_precertify(e, n);\\n'");
    expect(SQL).toContain("E'    IF v_tick IS NOT NULL THEN RETURN v_tick; END IF;\\n'");
    expect(SQL).toContain('PNL_BEFORE_MONEY_ANCHOR_COUNT');
    expect(SQL).toContain('PNL_BEFORE_MONEY_POSTIMAGE');
  });

  it('revokes the new functions from PUBLIC, anon and authenticated', () => {
    expect(SQL).toContain(
      'REVOKE ALL ON FUNCTION smarter_private.weekly_pnl_precertify(timestamptz, timestamptz)\n  FROM PUBLIC, anon, authenticated;'
    );
    expect(SQL).toContain(
      'REVOKE ALL ON FUNCTION smarter_private.weekly_prep_caught_up(timestamptz, timestamptz)\n  FROM PUBLIC, anon, authenticated;'
    );
  });
});
