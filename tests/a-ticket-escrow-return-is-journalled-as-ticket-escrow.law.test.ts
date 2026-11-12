/**
 * A TICKET ESCROW RETURN IS JOURNALLED AS TICKET ESCROW (2026-11-12).
 *
 * fn_ca_tally_ledger_leg counts every escrow leg whose category is
 * 'escrow_hold' or 'escrow_release' against CASHOUT custody
 * ('cashout_escrow:<entity>', 20261006140948). A door that moves a cashier
 * ticket's value out of ticket escrow (tournament_tickets leaves 'issued')
 * under one of those categories therefore writes its leg to the wrong store:
 * ticket_escrow moves with no leg and the commit check refuses the whole
 * transaction, `REFUSED: balance_moved_without_its_ledger_row
 * account=ticket_escrow`. That is how every issuer cancel was refused from
 * 2026-10-06 until 20261112185222 (ca_ledger_invariant_refusals 70,
 * operational alert 377197), and how a closed tournament with a returned
 * cashier ticket would have failed to close.
 *
 * The invariant: the LATEST definition of every function that declares the
 * 'escrow' counterparty while writing tournament_tickets declares a ticket
 * category ('ticket_issue', 'ticket_redeem', 'refund'), never a cashout one.
 * Pre-fix it names fn_cancel_tournament_ticket and
 * fn_ca_settle_closed_cashier_entry_tickets; post-fix it names none.
 *
 * docs/laws.d/a-ticket-escrow-return-is-journalled-as-ticket-escrow.md
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIG_DIR = join(__dirname, '..', 'supabase', 'migrations');
const FILES = readdirSync(MIG_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

/** name -> [file, body] of the last CREATE [OR REPLACE] FUNCTION for it. */
function latestDefinitions(): Map<string, [string, string]> {
  const out = new Map<string, [string, string]>();
  const header =
    /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?(\w+)"?\s*\(/gi;
  for (const file of FILES) {
    const sql = readFileSync(join(MIG_DIR, file), 'utf8');
    header.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = header.exec(sql))) {
      const as = /\bAS\s+(\$\w*\$)/i.exec(sql.slice(m.index, m.index + 4000));
      if (!as) continue;
      const tag = as[1];
      const open = m.index + as.index + as[0].length;
      const close = sql.indexOf(tag, open);
      if (close < 0) continue;
      out.set(m[1].toLowerCase(), [file, sql.slice(open, close)]);
      header.lastIndex = close + tag.length;
    }
  }
  return out;
}

const CASHOUT_CATEGORY =
  /set_config\(\s*'app\.ledger_category'\s*,\s*'escrow_(?:release|hold)'|fn_ca_declare_ledger\(\s*'escrow_(?:release|hold)'/i;
const ESCROW_COUNTERPARTY =
  /set_config\(\s*'app\.ledger_counterparty'\s*,\s*'escrow'|fn_ca_declare_ledger\(\s*'\w+'\s*,\s*'escrow'/i;
const WRITES_TICKETS = /(?:UPDATE|INSERT\s+INTO)\s+(?:public\.)?tournament_tickets\b/i;

describe('a ticket escrow return is journalled as ticket escrow', () => {
  const defs = latestDefinitions();

  it('reads the two doors that return ticket escrow to the issuer', () => {
    expect(defs.has('fn_cancel_tournament_ticket')).toBe(true);
    expect(defs.has('fn_ca_settle_closed_cashier_entry_tickets')).toBe(true);
  });

  it('no door that writes a ticket declares a cashout escrow category', () => {
    const offenders = [...defs.entries()]
      .filter(
        ([, [, body]]) =>
          WRITES_TICKETS.test(body) && ESCROW_COUNTERPARTY.test(body) && CASHOUT_CATEGORY.test(body)
      )
      .map(([name, [file]]) => `${name} (${file})`);
    expect(offenders).toEqual([]);
  });

  it('both issuer returns declare the refund category', () => {
    for (const name of ['fn_cancel_tournament_ticket', 'fn_ca_settle_closed_cashier_entry_tickets']) {
      const body = defs.get(name)?.[1] ?? '';
      expect(body).toMatch(/set_config\('app\.ledger_category','refund',true\)/);
      expect(body).toContain("'refund_to_issuer'");
    }
  });

  it('the cashout routing this law exists for is still the tally rule', () => {
    // If the tally stops claiming these categories for cashout custody, this
    // law's reason changes; revisit it rather than delete it.
    const tally = defs.get('fn_ca_tally_ledger_leg')?.[1] ?? '';
    expect(tally).toContain("NEW.category IN ('escrow_hold', 'escrow_release')");
    expect(tally).toContain("'cashout_escrow:'");
  });

  it('the fix is one transaction pinned to the production bodies', () => {
    const file = FILES.find((f) =>
      f.endsWith('_ticket_escrow_returns_are_journalled_as_ticket_escrow.sql')
    );
    expect(file).toBeDefined();
    const sql = readFileSync(join(MIG_DIR, file!), 'utf8');
    expect(sql.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(sql.trim().endsWith('COMMIT;')).toBe(true);
    expect(sql).toMatch(/^-- @live-proof: /m);
    expect(sql).toContain('d3f65b7702d4b7f543891dd87c149353');
    expect(sql).toContain('cf968d9b75ae8ae510c4a2a3fb58e337');
    expect(sql).not.toMatch(/cron\.schedule/i);
  });
});
