/**
 * A UNION STATEMENT CAN CARRY A CHARGE NOTE (2026-11-15)
 *
 * A charge note (invoice type union_weekly_debit_note) is the credit note's
 * twin: a numbered document against an issued weekly square-up that ADDS to
 * what the club owes. Pinned here:
 *   - every production body that knows the credit note (captured in
 *     scripts/ci/fixtures/union-charge-notes/production-preimages.json) is
 *     patched by the migration under its captured md5 and learns the charge
 *     note;
 *   - every reader that SUBTRACTS credit notes also ADDS charge notes;
 *   - the issuing function keeps the credit note's caller rule and grants;
 * The behaviour itself is proved in PostgreSQL 17 by
 * scripts/ci/test-union-charge-notes-postgres.py; the client board's
 * reconciliation and "Charge Note" label by tests/unit/unionStatementBoard
 * .test.ts and tests/components/union-statements-scope.test.tsx.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const migration = readFileSync(
  join(ROOT, 'supabase/migrations/20261115205250_a_union_statement_can_carry_a_charge_note.sql'),
  'utf8'
);
const preimages = JSON.parse(
  readFileSync(
    join(ROOT, 'scripts/ci/fixtures/union-charge-notes/production-preimages.json'),
    'utf8'
  )
) as { functions: Record<string, { md5: string; definition: string }> };

/** The cn_patch call for one signature: its md5 and its edit text. */
function patchOf(sig: string): { md5: string; text: string } | null {
  const start = migration.indexOf(`SELECT pg_temp.cn_patch('${sig}'::regprocedure,`);
  if (start < 0) return null;
  const end = migration.indexOf(']);', start);
  const text = migration.slice(start, end);
  const md5 = /'([0-9a-f]{32})'/.exec(text)?.[1] ?? '';
  return { md5, text };
}

const knowsCreditNotes = Object.entries(preimages.functions).filter(
  ([, f]) =>
    f.definition.includes('union_weekly_credit_note') || f.definition.includes('union_credit_note')
);
const subtractsCredits = knowsCreditNotes.filter(([, f]) =>
  /SUM\(cn\.net_amount\)|sum\(cn\.net_amount\)|SUM\(net_amount\)[\s\S]{0,200}union_weekly_credit_note/.test(
    f.definition
  )
);

describe('a union statement can carry a charge note', () => {
  it('captured every production body that knows the credit note', () => {
    expect(knowsCreditNotes.map(([sig]) => sig).sort()).toEqual(
      [
        'public.ca_union_set_statement_paid(uuid,boolean,numeric,text)',
        'public.ca_union_statement_board(uuid,date,integer)',
        'public.fn_deliver_accounting_invoice(uuid)',
        'public.fn_get_user_conversations(uuid,uuid)',
        'public.fn_union_club_statement_of_account(uuid,uuid,timestamptz)',
        'public.fn_union_invoice_outstanding(uuid)',
        'public.fn_union_issue_credit_note(uuid,numeric,text,boolean)',
        'public.fn_union_send_club_message(uuid,uuid,text,jsonb,text)',
        'smarter_private.union_weekly_invoice_body(uuid)',
      ].sort()
    );
  });

  it.each(knowsCreditNotes)(
    '%s is patched under its captured md5 and learns the charge note',
    (sig, f) => {
      const patch = patchOf(sig);
      expect(patch, sig).not.toBeNull();
      expect(patch!.md5).toBe(f.md5);
      expect(patch!.text).toMatch(/union_weekly_debit_note|union_debit_note/);
    }
  );

  it('every reader that subtracts credit notes also adds charge notes', () => {
    expect(subtractsCredits.map(([sig]) => sig).sort()).toEqual(
      [
        'public.ca_union_set_statement_paid(uuid,boolean,numeric,text)',
        'public.fn_union_invoice_outstanding(uuid)',
        'public.fn_union_issue_credit_note(uuid,numeric,text,boolean)',
        'smarter_private.union_weekly_invoice_body(uuid)',
      ].sort()
    );
    for (const [sig] of subtractsCredits) {
      const text = patchOf(sig)!.text;
      expect(text, sig).toMatch(
        /\+ COALESCE\(\(\s*SELECT SUM\(dn\.net_amount\)[\s\S]*?union_weekly_debit_note|\+ COALESCE\(v_charged, 0\)/
      );
    }
    // The board reads fn_union_invoice_outstanding and lists the charge notes.
    expect(patchOf('public.ca_union_statement_board(uuid,date,integer)')!.text).toMatch(
      /AS charge_notes,[\s\S]*'charge_notes', b\.charge_notes,/
    );
  });

  it('the deliverer, the conversation list and the statement of account name the new type', () => {
    expect(patchOf('public.fn_deliver_accounting_invoice(uuid)')!.text).toMatch(
      /'union_weekly_debit_note'\)\$a\$, '5'/
    );
    expect(
      patchOf('public.fn_union_club_statement_of_account(uuid,uuid,timestamptz)')!.text
    ).toMatch(/THEN 'Charge note against '/);
  });

  it('the charge note is the credit note twin: same caller rule, same counter, same grants', () => {
    const credit =
      preimages.functions['public.fn_union_issue_credit_note(uuid,numeric,text,boolean)']
        .definition;
    const rule = credit.slice(
      credit.indexOf('  IF auth.uid() IS NOT NULL'),
      credit.indexOf("RAISE EXCEPTION 'not_authorised';")
    );
    const fn = migration.slice(
      migration.indexOf('CREATE FUNCTION public.fn_union_issue_debit_note(')
    );
    expect(fn).toContain(rule);
    expect(fn).toContain('v_number := public.fn_next_invoice_number(v_union_id, now());');
    expect(fn).toContain("'union_weekly_debit_note', v_number, v_orig.id,");
    expect(fn).toMatch(/charge note already issued/);
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.fn_union_issue_debit_note(uuid, numeric, text, boolean) FROM PUBLIC, anon, authenticated, service_role;'
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.fn_union_issue_debit_note(uuid, numeric, text, boolean) TO authenticated, service_role;'
    );
    expect(migration).toMatch(/CHARGE_NOTE_GRANTS_DIFFER_FROM_CREDIT_NOTE/);
  });

  it('a delivered union statement can be marked paid: the guard ignores only the four payment keys', () => {
    const sig = 'public.fn_accounting_document_immutable()';
    const patch = patchOf(sig);
    expect(patch!.md5).toBe(preimages.functions[sig].md5);
    for (const side of ['NEW', 'OLD']) {
      expect(patch!.text).toContain(
        `${side}.deductions,CASE WHEN OLD.invoice_type IN('union_weekly_squareup','union_weekly_credit_note','union_weekly_debit_note')\n` +
          `         THEN ${side}.breakdown-ARRAY['paid_total','paid_at','paid_by','payments'] ELSE ${side}.breakdown END,`
      );
    }
    // Exactly the two breakdown anchors change; nothing else in the guard.
    expect((patch!.text.match(/\$a\$, '1'/g) ?? []).length).toBe(2);
  });

  it('the one charge note is re-derived from rows and refuses to be issued twice', () => {
    expect(migration).toMatch(/CHARGE_NOTE_DERIVATION_MOVED/);
    expect(migration).toMatch(
      /v_misplaced IS DISTINCT FROM 438\.56 OR v_charge IS DISTINCT FROM 43\.86/
    );
    expect(migration).toMatch(/RETURN; {2}-- already charged/);
    expect(migration).toMatch(/IS DISTINCT FROM 110158\.16/);
  });
});
