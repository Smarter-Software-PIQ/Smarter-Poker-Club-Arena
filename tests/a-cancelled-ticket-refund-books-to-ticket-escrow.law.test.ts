/**
 * A CANCELLED TICKET'S REFUND BOOKS TO TICKET ESCROW (2026-11-12).
 *
 * Incidents 9aaed91e / 496bda61, drift incident 16ef8334. The ledger tally
 * (fn_ca_tally_ledger_leg) and the trial balance (fn_ca_trial_balance) read an
 * 'escrow' leg whose category is escrow_hold or escrow_release as CASHOUT
 * custody. The two issuer-refund paths for a tournament ticket declared
 * escrow_release, so the leg landed on cashout_escrow:<ticket> while the
 * ticket float (ticket_escrow) moved with no leg, and the ledger invariant
 * refused every ticket cancel at commit. Migration 20261112184950 books the
 * issuer refund under 'refund'.
 *
 * THE PROOF IS EXECUTED. scripts/dev/test-ledger-invariant.sh (CI:
 * "Accounting transactions (PostgreSQL 17)" shard 1) installs the two live
 * production bodies verbatim, proves both are refused at commit (the Cancel
 * button exactly as in the incident, and the closed-target issuer return
 * taking its tournament's closing transaction down with it), runs this
 * migration file, and proves the Cancel button, replay, non-issuer, redeemed,
 * departed-issuer, mismatched-receipt, closed-target issuer return, holder
 * payment and second-settle cases on the real invariant.
 *
 * This law pins that stage into the harness and, for the LATEST body of each
 * ticket escrow writer, that it never declares escrow_release again, and that
 * the tally still reserves that pair for cashout custody (so the reason for
 * the rule cannot silently disappear and make the rule look arbitrary).
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'supabase/migrations';
const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();
const FIX = '20261112184950_a_cancelled_ticket_refund_books_to_ticket_escrow_not_cashout.sql';

/** Ticket escrow writers that return value to the issuer or holder. */
const TICKET_WRITERS = [
  'fn_cancel_tournament_ticket',
  'fn_ca_settle_closed_cashier_entry_tickets',
  'fn_redeem_tournament_ticket',
];

function definingFiles(fn: string): string[] {
  const re = new RegExp(`CREATE\\s+(OR\\s+REPLACE\\s+)?FUNCTION\\s+(public\\.)?${fn}\\s*\\(`, 'i');
  return files.filter((f) => re.test(readFileSync(join(DIR, f), 'utf8')));
}

describe('a cancelled ticket refund books to ticket escrow', () => {
  it('the fix migration exists and replaces escrow_release with refund in both issuer paths', () => {
    expect(files).toContain(FIX);
    const sql = readFileSync(join(DIR, FIX), 'utf8');
    expect(sql).toContain('public.fn_cancel_tournament_ticket(uuid)');
    expect(sql).toContain('public.fn_ca_settle_closed_cashier_entry_tickets(uuid,text)');
    expect(sql).toMatch(
      /c_new constant text := E'PERFORM set_config\(''app\.ledger_category'',''refund'',true\);'/
    );
  });

  for (const fn of TICKET_WRITERS) {
    it(`no migration after the fix rewrites ${fn} with escrow_release`, () => {
      const later = definingFiles(fn).filter((f) => f > FIX);
      for (const f of later) {
        const sql = readFileSync(join(DIR, f), 'utf8');
        const start = sql.search(new RegExp(`FUNCTION\\s+(public\\.)?${fn}\\s*\\(`, 'i'));
        const body = sql.slice(
          start,
          sql.indexOf('$function$', sql.indexOf('$function$', start) + 1)
        );
        expect(body, `${f} declares escrow_release inside ${fn}`).not.toMatch(/'escrow_release'/);
      }
    });
  }

  it('the executed ledger-invariant harness runs the before / migration / after stage in order', () => {
    const sh = readFileSync('scripts/dev/test-ledger-invariant.sh', 'utf8');
    expect(sh).toMatch(
      /ticket_refund=\$\(ls "\$root"\/supabase\/migrations\/\*_a_cancelled_ticket_refund_books_to_ticket_escrow_not_cashout\.sql/
    );
    const order = [
      'cashout-regression.sql',
      'ticket-refund-bootstrap.sql',
      'ticket-refund-regression-before.sql',
      '-f "$ticket_refund"',
      'ticket-refund-regression-after.sql',
      'refusal-bootstrap.sql',
    ].map((needle) => sh.indexOf(needle));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const before = readFileSync(
      'tests/fixtures/ledger-invariant/ticket-refund-regression-before.sql',
      'utf8'
    );
    expect(before).toContain(
      "public.fn_cancel_tournament_ticket('7c000000-0000-4000-8000-000000000001')"
    );
    expect(before).toContain('public.fn_ca_settle_closed_cashier_entry_tickets(');
    const after = readFileSync(
      'tests/fixtures/ledger-invariant/ticket-refund-regression-after.sql',
      'utf8'
    );
    for (const tag of ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9'])
      expect(after).toContain(tag);
  });

  it('the tally still reserves escrow_hold / escrow_release for cashout custody', () => {
    const tally = files.filter((f) =>
      /FUNCTION\s+(public\.)?fn_ca_tally_ledger_leg\s*\(/i.test(readFileSync(join(DIR, f), 'utf8'))
    );
    expect(tally.length).toBeGreaterThan(0);
    const latest = readFileSync(join(DIR, tally[tally.length - 1]), 'utf8');
    expect(latest).toMatch(
      /category IN \('escrow_hold', 'escrow_release'\)\s*THEN 'cashout_escrow:'/
    );
  });
});
