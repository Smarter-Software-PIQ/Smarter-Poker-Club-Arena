/**
 * A UNION INVOICE VIEW SHOWS ITS WEEK AND WHO PAYS WHOM (Dan 2026-11-14, item 8)
 *
 * "For each invoice: display the exact week start and end, identify issuer
 *  and recipient, state payer/payee direction unambiguously, show comparable
 *  fee and player-result components, explain settlement offsets and amount
 *  due, preserve exact supported monetary precision ... Do not omit the fifth
 *  row. If it is structurally different from a club invoice, present it
 *  separately and accurately."
 *
 * Before this law every surface printed the week as two UTC dates
 * ("2026-11-02 To 2026-11-09", eight calendar days, no 2 AM), the Messenger
 * body said "Direction: Club To Union" and "settled_in_chips already moved
 * during the week", the board rounded figures under 1 to "Under 1", and the
 * union's own house row (club_id = union id) sat in the club list.
 *
 * This pins: the board carries the stored week instants, the parties, the
 * house flag and the settled-in-chips split; the Messenger body for union
 * square-ups and credit notes is written by one private builder that formats
 * the week with America/Chicago rules and prints figures digit for digit;
 * the stored note no longer calls the whole figure moved; and the page shows
 * the week, the payer and payee and the house row apart, exactly.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dir = 'supabase/migrations';
const files = readdirSync(dir).filter((file) =>
  file.endsWith('_union_invoice_views_show_the_week_and_who_pays.sql')
);
if (files.length !== 1) throw new Error('Expected One Union Invoice Views Migration');
const sql = readFileSync(`${dir}/${files[0]}`, 'utf8');
const code = sql.replace(/^--[^\n]*$/gm, '');
const page = readFileSync('src/pages/UnionStatementsPage.tsx', 'utf8');
const board = readFileSync('src/utils/unionStatementBoard.ts', 'utf8');

describe('a union invoice view shows its week and who pays whom', () => {
  it('is one transaction that patches only the reviewed sources, anchor by anchor', () => {
    expect(code.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(code.match(/^COMMIT;$/gm)).toHaveLength(1);
    for (const [sig, md5] of [
      ['public.ca_union_statement_board(uuid,date,integer)', 'e435e7955327da160148245b4d3e0d75'],
      ['public.fn_deliver_accounting_invoice(uuid)', 'c33ff353ae9ded41301fea2a25f670e4'],
      [
        'public.fn_union_issue_weekly_invoices(uuid,timestamptz,timestamptz,boolean)',
        '4a549e6a01520cefce1d103d9eb6e2ee',
      ],
    ])
      expect(code).toContain(`'${sig}'::regprocedure,\n  '${md5}'`);
    expect(code).toContain('UNION_INVOICE_VIEWS_ANCHOR_NOT_UNIQUE');
    expect(code).toContain('UNION_INVOICE_VIEWS_INSTALL_MISMATCH');
    // Delivery is patched, never redefined from a copy.
    expect(code).not.toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_deliver_accounting_invoice/
    );
    // Nothing is issued, regenerated or resent.
    expect(code).not.toMatch(/\bUPDATE\s+public\.settlement_invoices\b/i);
    expect(code).not.toMatch(
      /\bINSERT\s+INTO\s+public\.(settlement_invoices|social_messages|notifications)\b/i
    );
    expect(code).not.toMatch(/PERFORM\s+public\.fn_deliver_accounting_invoice/);
  });

  it('the board returns the stored week instants, parties, house flag and settled split', () => {
    for (const key of [
      "'invoice_number', b.invoice_number",
      "'period_start_at', b.period_start_at, 'period_end_at', b.period_end_at",
      "'payer_type', b.payer_type, 'payer_name', b.payer_name",
      "'payee_type', b.payee_type, 'payee_name', b.payee_name",
      "'union_house', b.union_house",
      "'settled_in_chips', round(b.settled_in_chips, 2)",
      "'player_pnl_net', round(b.player_pnl_net, 2)",
      "'stored_outstanding', round(b.stored_outstanding, 2)",
      "'period_start_at', (SELECT MIN(b.period_start_at) FROM board b)",
      "'period_start_at', h.period_start_at, 'period_end_at', h.period_end_at",
    ])
      expect(code).toContain(key);
    expect(code).toContain('(cu.club_id = p_union_id) AS union_house');
    expect(code).toContain(
      "THEN (i.breakdown->>'period_start')::timestamptz END AS period_start_at"
    );
  });

  it('one private builder writes the Messenger body of a union square-up or credit note', () => {
    expect(code).toContain(
      "IF inv.invoice_type IN('union_weekly_squareup','union_weekly_credit_note') THEN body:=smarter_private.union_weekly_invoice_body(inv.id);"
    );
    expect(code).toContain(
      "to_char(p AT TIME ZONE 'America/Chicago', 'Dy Mon FMDD, YYYY FMHH12:MI AM')"
    );
    expect(code).toContain("' to '");
    expect(code).toContain("' Chicago Time'");
    expect(code).toContain('The Week Includes Its Start And Excludes Its End.');
    expect(code).toContain("'Square, Nothing Due'");
    expect(code).toContain("v_payer || ' Pays ' || v_payee");
    expect(code).toContain("' House Club Statement '");
    expect(code).toContain("'Credited In Full, Nothing Due'");
    expect(code).toContain(
      "WHERE cn.adjusts_invoice_id = inv.id AND cn.invoice_type = 'union_weekly_credit_note'"
    );
    expect(code).toContain('ECO Charge Or Credit (Positive Means The Club Pays): ');
    expect(code).toContain("'remaining_after_credits', round(b.remaining_after_credits, 2)");
    expect(code).toContain('Amount Due Is What Remains: Combined ECO ');
    expect(code).toContain('Not A Union Or Club Transfer');
    expect(code).toContain('(The Only Union To Club Transfer In It)');
    expect(code).toContain('Settled In Chips Has Already Moved And Is Not Billed Again.');
    expect(code).toContain('The Two Player Figures Differ By Exactly The Rake Generated');
    // A week is never derived by adding hours to a date.
    expect(code).not.toMatch(/interval\s+'(24 hours|1 day|7 days)'/i);
    // Figures are copied digit for digit; to_char money masks round.
    expect(code).not.toMatch(/to_char\([^)]*FM9/);
    for (const fn of [
      'union_statement_figure(numeric)',
      'union_statement_amount(jsonb)',
      'union_statement_instant(timestamptz)',
      'union_statement_week(timestamptz, timestamptz)',
      'union_weekly_invoice_body(uuid)',
    ])
      expect(code).toContain(
        `REVOKE ALL ON FUNCTION smarter_private.${fn} FROM PUBLIC, anon, authenticated;`
      );
  });

  it('a new square-up never says the whole settled figure moved', () => {
    expect(code).toContain(
      "'Weekly union square-up. settled_in_chips already moved during the week; '"
    );
    expect(code).toContain(
      "'a union or club transfer; neither part is billed again. Outstanding (ECO plus recorded '"
    );
  });

  it('the page prints the week, the payer and payee, exact figures and the house row apart', () => {
    expect(page).not.toContain('compactChips');
    expect(page).not.toContain("'Under 1");
    expect(page).toContain('formatWalletChips(n)');
    expect(page).toContain('unionStatementWeekLabel(board.period_start_at, board.period_end_at)');
    expect(page).toContain('unionStatementAmountDue(c, clubLabel, unionLabel)');
    expect(page).toContain('(board?.clubs || []).filter((c) => !c.union_house)');
    expect(page).toContain('aria-label="Union House Club Statement"');
    expect(page).toContain("'payer_pays_payee'");
    expect(page).toContain("'week_end_exclusive_chicago'");
    expect(page).toContain("'credited_by'");
    expect(page).toContain('...rows.filter((r) => r.union_house)');
    expect(board).toContain("timeZone: 'America/Chicago'");
    expect(board).not.toMatch(/24\s*\*\s*60\s*\*\s*60/);
    expect(board).toContain("throw new Error('Statement amount due does not reconcile')");
    expect(board).toContain("throw new Error('Statement house row is misidentified')");
    expect(board).toContain("throw new Error('Statement credit notes do not reconcile')");
  });
});

describe('a union invoice view subtracts credit notes from what is unpaid and from its totals', () => {
  const followUps = readdirSync(dir).filter((file) =>
    file.endsWith('_union_invoice_views_subtract_credits_from_balances_and_totals.sql')
  );
  if (followUps.length !== 1) throw new Error('Expected One Union Invoice Balances Migration');
  const followUp = readFileSync(`${dir}/${followUps[0]}`, 'utf8').replace(/^--[^\n]*$/gm, '');

  it('patches only the reviewed sources, in one transaction, writing nothing', () => {
    expect(followUp.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(followUp.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(followUp).toContain(
      "'public.ca_union_statement_board(uuid,date,integer)'::regprocedure,\n  'a95dd4e582a6888bcd08b7e8d4c9ddb0'"
    );
    expect(followUp).toContain(
      "'smarter_private.union_weekly_invoice_body(uuid)'::regprocedure,\n  'a7276e1a0f917bc06a8a3da7a0167c97'"
    );
    expect(followUp).toContain('UNION_INVOICE_BALANCES_ANCHOR_NOT_UNIQUE');
    expect(followUp).not.toMatch(/\b(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+public\./i);
    expect(followUp).not.toMatch(/fn_deliver_accounting_invoice\s*\(/);
  });

  it('the unpaid balance is the amount after credit notes less payments, on the board and in the body', () => {
    expect(followUp).toContain(
      'round(GREATEST(COALESCE(b.remaining_after_credits, abs(b.amount)) - b.paid_total, 0), 2)'
    );
    expect(followUp).toContain("E'\\nRemaining Unpaid Balance: '");
    expect(followUp).toContain('greatest(v_remaining - v_paid, 0)');
    expect(board).toContain('Math.max(remainingAfterCredits - cents(parsed.paid_total ?? 0), 0)');
    expect(page).toContain("['Remaining Unpaid Balance', c.remaining_unpaid ?? null]");
    expect(page).toContain("'remaining_unpaid_balance'");
  });

  it('the rakeback credit is never described as a club payment', () => {
    expect(followUp).toContain('Less Club Rakeback Credit Is The Rakeback ');
    expect(page).toContain('Less Club Rakeback Credit Is The Rakeback The Union Paid The Club');
    expect(page).not.toContain('The Net Loss Lines, Less Club Rakeback Credit,');
  });

  it('the tiles state what is owed after credit notes', () => {
    expect(board).toContain('clubs_owe: afterCreditTotals.clubs_owe / 100');
    expect(board).toContain('net: afterCreditTotals.net / 100');
  });
});
