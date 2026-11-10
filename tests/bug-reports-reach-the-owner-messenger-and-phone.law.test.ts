/**
 * EVERY BUG REPORT REACHES THE OWNER'S MESSENGER AND PHONE (Dan, 2026-11-09).
 *
 * "ALL BUGS SHOULD GO DIRECTLY TO MY SMARTER.POKER MESSENGER, AND SEND A PUSH
 * ALERT TO MY PHONE."
 *
 * Report BUG-7C1347FF reached him as an email only: the ticket was posted as
 * a direct message to the `support` account, which nobody has ever signed in
 * to, and Club Arena's own Help form wrote a table nothing read. The route
 * now lives on the report row's insert, so no client can skip it. This pins
 * the source contract; the behaviour itself is proved against a real
 * PostgreSQL by scripts/ci/test-bug-report-routing.sh, which this law also
 * requires to stay wired into CI.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const MIGRATIONS = join(ROOT, 'supabase/migrations');
const ROUTE = '20261109224532_bug_reports_reach_the_owner_messenger_and_phone.sql';
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
/** SQL with comments removed, so prose cannot satisfy or trip a pin. */
const code = (sql: string) => sql.replace(/--[^\n]*/g, '');
const route = code(read(`supabase/migrations/${ROUTE}`));

describe('every bug report reaches the owner messenger and phone', () => {
  it('routes from the insert of every report table, not from a client', () => {
    for (const table of ['live_help_tickets', 'user_feedback']) {
      expect(route).toMatch(
        new RegExp(
          `CREATE TRIGGER zz_bug_report_reaches_owner\\s+AFTER INSERT ON public\\.${table}\\s+FOR EACH ROW EXECUTE FUNCTION public\\.fn_bug_report_route_on_insert\\(\\)`
        )
      );
    }
  });

  it('writes the Messenger stack the page reads and the existing durable outbox', () => {
    expect(route).toContain('INSERT INTO public.social_messages');
    expect(route).toContain('INSERT INTO public.push_outbox');
    // Its own event: never an operational alert type, which the guards divert.
    expect(route).toContain("'bug_report',");
    expect(route).not.toMatch(/'platform_admin_alert'|'system',/);
    expect(route).toContain("public.fn_is_platform_operational_alert('bug_report'");
  });

  it('is exactly once per report and leaves a durable receipt', () => {
    expect(route).toContain(
      'CONSTRAINT bug_report_deliveries_one_per_report UNIQUE (source_table, source_id)'
    );
    expect(route).toContain("IF d.status = 'delivered' THEN");
    expect(route).toContain('bug_report_deliveries_delivered_is_complete');
  });

  it('takes its recipient from one configured row constrained to the owner', () => {
    expect(route).toContain('FROM public.bug_report_routing WHERE id FOR UPDATE');
    expect(route).toContain('CHECK (public.fn_is_platform_alert_recipient(recipient_user_id))');
    // No account literal inside either function body.
    const bodies = [...route.matchAll(/AS \$fn\$([\s\S]*?)\$fn\$/g)].map((m) => m[1]).join('\n');
    expect(bodies.length).toBeGreaterThan(1000);
    expect(bodies).not.toMatch(/47965354|2d1cd6c3|3bb71bfe/);
  });

  it('adds no timer, sweep or repair job', () => {
    expect(route).not.toMatch(
      /cron\.schedule|pg_cron|fn_\w*(repair|sweep|redrive|backpay|catchup|heal)\w*/i
    );
  });

  it('keeps reports private: no player grant on the route, the row or the receipts', () => {
    expect(route).toContain(
      'REVOKE ALL ON FUNCTION public.fn_route_bug_report_to_owner(text, uuid) FROM PUBLIC, anon, authenticated'
    );
    expect(route).toContain(
      'REVOKE ALL ON public.bug_report_routing FROM PUBLIC, anon, authenticated, service_role'
    );
    expect(route).toContain('USING (public.fn_is_platform_admin())');
  });

  it('no later migration removes the route', () => {
    const later = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql') && f > ROUTE);
    for (const f of later) {
      const sql = code(readFileSync(join(MIGRATIONS, f), 'utf8'));
      expect(sql, f).not.toMatch(/DROP TRIGGER[^;]*zz_bug_report_reaches_owner/i);
      expect(sql, f).not.toMatch(
        /DROP (TABLE|FUNCTION)[^;]*(bug_report_routing|bug_report_deliveries|fn_route_bug_report_to_owner|fn_bug_report_route_on_insert)/i
      );
    }
  });

  it('keeps the native PostgreSQL proof wired into CI', () => {
    expect(read('scripts/ci/test-data-console-postgres-contracts.sh')).toContain(
      'scripts/ci/test-bug-report-routing.sh'
    );
    const proof = read('scripts/ci/test-bug-report-routing.sh');
    expect(proof).toContain('_bug_reports_reach_the_owner_messenger_and_phone.sql');
    expect(read('tests/fixtures/bug-report-routing/assertions.sql')).toContain(
      'BUG_REPORT_ROUTING_OK'
    );
  });
});
