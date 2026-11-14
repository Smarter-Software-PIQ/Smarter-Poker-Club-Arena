/**
 * WEEKLY UNION STATEMENTS ARE SENT WITH THE MONDAY RAKEBACK (Dan 2026-11-14, binding)
 *
 * "FOR THE AUTOMATED WEEKLY RAKE BACK, YOU NEED TO INSURE THAT THE UNION IS
 *  CALCULATING AND SENDING INVOICES TO THE CLUBS WITHIN THE UNION FOR WHAT
 *  THEY OWE FOR THE WEEK, OR WHAT THEY ARE OWED FROM THE UNION FOR THE WEEK
 *  ... THERE IS NO WAY FOR THE UNION TO SEE WHAT EACH CLUB OWES WEEKLY."
 *
 * The square-up was calculated but (a) the 2026-10-15 record-only rule kept it
 * out of Messenger, so every union close since recorded notified 0, and (b)
 * the union's books were left to job 272's 240 s tick, so the square-ups for
 * the week ending 2026-11-09 arrived on 2026-11-11 after 130 attempts. This
 * pins the delivery, the payout-day close and the union's summary, and the
 * weekly horse promo's receipt (owner item 5).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dir = 'supabase/migrations';
const name = readdirSync(dir).filter((file) =>
  file.endsWith('_weekly_union_statements_are_sent_with_the_monday_rakeback.sql')
);
if (name.length !== 1) throw new Error('Expected One Weekly Union Statements Migration');
const sql = readFileSync(`${dir}/${name[0]}`, 'utf8');
const code = sql.replace(/^--[^\n]*$/gm, '');

describe('weekly union statements are sent with the monday rakeback', () => {
  it('is one transaction, guarded by the preimages it changes', () => {
    expect(code.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(code.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(code).toContain('UNION_STATEMENTS_PREIMAGE_CHANGED');
    for (const sig of [
      'public.fn_deliver_accounting_invoice(uuid)',
      'public.fn_get_user_conversations(uuid,uuid)',
      'public.fn_midway_weekly_horse_promo_due(timestamptz)',
    ]) {
      expect(code).toContain(`md5(pg_get_functiondef('${sig}'::regprocedure))`);
    }
  });

  it('a union square-up reaches the club through Messenger; the union hub row stays record-only', () => {
    expect(code).toContain("IN(''union_weekly_squareup'',''union_weekly_credit_note'')");
    expect(code).toContain(
      "inv.club_id IS DISTINCT FROM NULLIF(inv.breakdown->>''union_id'','''')::uuid"
    );
    expect(code).toContain('UNION_STATEMENTS_DELIVERY_INSTALL_MISMATCH');
    // The inbox lists the thread it lands in.
    expect(code).toContain(
      "NOT IN (''cashier_cashout'', ''union_weekly_squareup'', ''union_weekly_credit_note'')"
    );
  });

  it('the union books close on payout day with the close job 272 runs, after the payout releases', () => {
    expect(sql).toMatch(/^-- periodic-work: \S/m);
    expect(code).toContain('CREATE OR REPLACE FUNCTION smarter_private.weekly_union_books_due()');
    expect(code).toContain("'tick', public.fn_union_settlement_cascade_due()");
    expect(code).toContain("p.instance_id = 'weekly-payout-rounds'");
    expect(code).toContain("AND p.phase <> 'released'");
    expect(code).toContain("n >= due + interval '12 hours'");
    expect(code).toContain("r.status = 'complete'");
    expect(code).toContain("PERFORM cron.schedule('weekly-union-books', '*/2 * * * *'");
    expect(code).toContain("set_config('app.weekly_accounting_chunked','on',false)");
    expect(code).toContain("set_config('app.weekly_accounting_scope_budget','8 minutes',false)");
    expect(code).toContain(
      'REVOKE ALL ON FUNCTION smarter_private.weekly_union_books_due() FROM PUBLIC, anon, authenticated, service_role'
    );
  });

  it('the union owner is told what every club owes or is owed, and a notice never undoes the close', () => {
    expect(code).toContain('CREATE TRIGGER union_statements_issued_notice');
    expect(code).toContain('FOR EACH ROW WHEN (NEW.round_no = 4)');
    expect(code).toContain("' owes the union '");
    expect(code).toContain("' is owed '");
    expect(code).toContain("'/hub/club-arena/unions/' || NEW.union_id::text || '/statements'");
    expect(code).toContain("RAISE WARNING 'union statements notice not recorded: %'");
  });

  it('the weekly horse promo leaves a receipt and keeps its payment unchanged', () => {
    expect(code).toContain('weekly_horse_promo_receipt');
    expect(code).toContain('v_result:=public.fn_midway_weekly_horse_promo(v_from,v_to);');
    expect(code).toContain("RAISE WARNING 'weekly horse promo receipt not recorded: %'");
    expect(code).not.toMatch(/CREATE OR REPLACE FUNCTION public\.fn_midway_weekly_horse_promo\(/);
  });

  it('the latest closed week reaches every club once', () => {
    expect(code).toContain("'2026-11-09 08:00:00+00'");
    expect(code).toContain('UNION_STATEMENT_CURRENT_WEEK_MOVED');
  });
});
