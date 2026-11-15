/**
 * THE PAYOUT-DAY UNION BOOKS TICK RUNS THE POST-MONEY CLOSE (pre-flight 2026-11-15)
 *
 * Job 564 (weekly-union-books, 900 s) called fn_union_settlement_cascade_due(),
 * whose weekly_payout_due -> weekly_payout_prepare_due path refuses any budget
 * but the original 240 s tick. The payout-day close therefore never ran. The
 * migration makes the tick check the week's scope plan is empty and run the
 * cascade's post-money steps itself, under the cascade's scheduler lock.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dir = 'supabase/migrations';
const name = readdirSync(dir).filter((file) =>
  file.endsWith('_the_payout_day_union_books_tick_runs_the_post_money_close.sql')
);
if (name.length !== 1) throw new Error('Expected One Payout-Day Union Books Migration');
const sql = readFileSync(`${dir}/${name[0]}`, 'utf8');
const code = sql.replace(/^--[^\n]*$/gm, '');
const body = code.slice(code.indexOf('AS $function$'), code.indexOf('$function$;'));

describe('the payout-day union books tick runs the post-money close', () => {
  it('is one transaction guarded by the preimage it replaces and the scope authority pin', () => {
    expect(code.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(code.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(code).toContain("'fd1fe5b44d1359d08ec9b4a17fba7add'");
    expect(code).toContain("'4179282ab83f30094d4c3b2885102917'");
    expect(code).toContain('CREATE OR REPLACE FUNCTION smarter_private.weekly_union_books_due()');
  });

  it('keeps every original guard', () => {
    expect(body).toContain('fn_caller_is_engine()');
    expect(body).toContain("n >= due + interval '12 hours'");
    expect(body).toContain("'weekly_union_books_frozen'");
    expect(body).toContain("p.instance_id = 'weekly-payout-rounds'");
    expect(body).toContain("AND p.phase <> 'released'");
    expect(body).toContain("r.status = 'complete'");
  });

  it('leaves an owed week to the bounded tick and never enters the pinned payout path', () => {
    expect(body).toContain('smarter_private.weekly_payout_scope_plan(e, n)');
    expect(body).toContain("'weekly_union_books_waiting_for_owed_scopes'");
    expect(body).not.toContain('fn_union_settlement_cascade_due()');
    expect(body).not.toContain('weekly_payout_due()');
    expect(body).not.toContain('weekly_payout_prepare_due()');
  });

  it('runs the cascade post-money steps in its order under its scheduler lock', () => {
    expect(body).toContain("pg_try_advisory_xact_lock(hashtextextended('union-accounting-scheduler', 0))");
    const promo = body.indexOf('public.fn_midway_weekly_horse_promo_due()');
    const advance = body.indexOf('public.fn_accounting_close_windows_advance_due()');
    const close = body.indexOf('public.fn_process_weekly_accounting(NULL)');
    expect(promo).toBeGreaterThan(0);
    expect(advance).toBeGreaterThan(promo);
    expect(close).toBeGreaterThan(advance);
    expect(body).toContain("v_tick->>'advanced' = 'true' OR v_tick->>'owns_tick' = 'true'");
  });

  it('changes no schedule and restates the ACL', () => {
    expect(code).not.toContain('cron.schedule(');
    expect(code).not.toContain('cron.unschedule(');
    expect(code).toContain(
      'REVOKE ALL ON FUNCTION smarter_private.weekly_union_books_due() FROM PUBLIC, anon, authenticated, service_role'
    );
  });
});
