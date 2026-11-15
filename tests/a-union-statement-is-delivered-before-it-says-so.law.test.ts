/**
 * A UNION STATEMENT IS DELIVERED BEFORE IT SAYS SO, AND OWES WHAT IT SAYS
 *
 * Audit 2026-11-15 (G3, G4, G5), Midway Union weekly square-ups.
 *
 * G3: MIDWAY-2026-000020..041 read message_sent = true and the Union
 *     Statements board said "Delivered", yet no accounting_invoice_deliveries
 *     row existed for any of them. A union statement is now marked sent only
 *     when a delivery row exists, and the board reads delivery from that record.
 * G4: ca_union_set_statement_paid took abs(net_amount) as owed and ignored
 *     credit notes; owed is now the statement less its non-cancelled credits.
 * G5: due_at was week end + 3 days whatever the issue time; ten statements
 *     were overdue when issued. due_at is now greatest(week end, issue) + 3 days.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(__dirname, '..', 'supabase', 'migrations');
const fix = readFileSync(
  join(DIR, '20261115151821_union_statements_are_delivered_and_owe_what_they_say.sql'),
  'utf8'
);
const settle = readFileSync(
  join(DIR, '20261115151824_union_statements_credit_the_misplaced_jackpot_shares.sql'),
  'utf8'
);

describe('a union statement is delivered before it says so', () => {
  it('the deliverer marks a union statement sent only when a recipient was reached', () => {
    expect(fix).toMatch(
      /AND \(n>0 OR inv\.invoice_type NOT IN\(''union_weekly_squareup'',''union_weekly_credit_note''\)\);/
    );
  });

  it('the board reads delivery from accounting_invoice_deliveries, not the flag', () => {
    expect(fix).toMatch(
      /'EXISTS \(SELECT 1 FROM accounting_invoice_deliveries d WHERE d\.invoice_id = i\.id\) AS message_sent,'/
    );
    expect(fix).toMatch(
      /count\(\*\) FILTER \(WHERE EXISTS \(SELECT 1 FROM accounting_invoice_deliveries d WHERE d\.invoice_id = s\.id\)\) AS delivered/
    );
  });

  it('the club statements marked delivered are delivered once, and every one must reach someone', () => {
    expect(fix).toMatch(/v := public\.fn_deliver_accounting_invoice\(r\.id\);/);
    expect(fix).toMatch(/UNION_STATEMENT_NOT_DELIVERED/);
    expect(fix).toMatch(/s\.club_id <> 'fade0000-0000-0000-0000-000000000001'::uuid/);
  });

  it('marking a statement paid owes the statement less its credit notes', () => {
    expect(fix).toMatch(/cn\.adjusts_invoice_id = v_inv\.id/);
    expect(fix).toMatch(/cn\.status IS DISTINCT FROM ''cancelled''/);
    expect(fix).toMatch(/v_owed     := GREATEST\(round\(abs\(COALESCE\(v_inv\.net_amount, 0\)\) - COALESCE/);
  });

  it('a statement is never due before it is issued', () => {
    expect(fix).toMatch(/v_due := GREATEST\(v_to, now\(\)\) \+ interval ''3 days'';/);
  });

  it('the misplaced jackpot shares are corrected by credit notes, never by editing a statement', () => {
    expect(settle).toMatch(/public\.fn_union_issue_credit_note\(v_id, r\.credit, c_reason \|\| r\.detail, false\)/);
    expect(settle).not.toMatch(/UPDATE\s+public\.settlement_invoices/i);
    for (const [num, credit] of [
      ['MIDWAY-2026-000031', '564.88'],
      ['MIDWAY-2026-000029', '17.65'],
      ['MIDWAY-2026-000036', '212.48'],
      ['MIDWAY-2026-000039', '21.25'],
    ]) {
      expect(settle).toContain(`('${num}'`);
      expect(settle).toContain(credit);
    }
  });
});
