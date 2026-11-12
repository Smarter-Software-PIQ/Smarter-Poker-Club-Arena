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
 * This law reads the migrations in version order and pins, for the LATEST body
 * of each ticket escrow writer, that it never declares escrow_release, and
 * that the tally still reserves that pair for cashout custody (so the reason
 * for the rule cannot silently disappear and make the rule look arbitrary).
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
    expect(sql).toContain("public.fn_cancel_tournament_ticket(uuid)");
    expect(sql).toContain("public.fn_ca_settle_closed_cashier_entry_tickets(uuid,text)");
    expect(sql).toMatch(/c_new constant text := E'PERFORM set_config\(''app\.ledger_category'',''refund'',true\);'/);
  });

  for (const fn of TICKET_WRITERS) {
    it(`no migration after the fix rewrites ${fn} with escrow_release`, () => {
      const later = definingFiles(fn).filter((f) => f > FIX);
      for (const f of later) {
        const sql = readFileSync(join(DIR, f), 'utf8');
        const start = sql.search(new RegExp(`FUNCTION\\s+(public\\.)?${fn}\\s*\\(`, 'i'));
        const body = sql.slice(start, sql.indexOf('$function$', sql.indexOf('$function$', start) + 1));
        expect(body, `${f} declares escrow_release inside ${fn}`).not.toMatch(/'escrow_release'/);
      }
    });
  }

  it('the tally still reserves escrow_hold / escrow_release for cashout custody', () => {
    const tally = files.filter((f) => /FUNCTION\s+(public\.)?fn_ca_tally_ledger_leg\s*\(/i.test(readFileSync(join(DIR, f), 'utf8')));
    expect(tally.length).toBeGreaterThan(0);
    const latest = readFileSync(join(DIR, tally[tally.length - 1]), 'utf8');
    expect(latest).toMatch(/category IN \('escrow_hold', 'escrow_release'\)\s*THEN 'cashout_escrow:'/);
  });
});
