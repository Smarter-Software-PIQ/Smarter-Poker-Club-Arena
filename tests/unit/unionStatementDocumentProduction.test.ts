/**
 * The downloaded union statement, rendered by the real code path
 * (parseUnionStatementRow -> buildUnionStatementDocument ->
 * unionStatementDocumentHtml) from the four Midway statements of the week
 * 2026-11-02 exactly as production's board returned them, checked figure by
 * figure against the stored settlement_invoices rows in the same fixture.
 */
import { describe, expect, it } from 'vitest';
import { parseUnionStatementRow } from '../../src/utils/unionStatementBoard';
import {
  buildUnionStatementDocument,
  unionStatementDocumentHtml,
  type StatementForDocument,
} from '../../src/utils/unionStatementDocument';
import fixture from '../fixtures/union-statement-document/production-2026-11-09.json';

type Stored = (typeof fixture.stored)[keyof typeof fixture.stored] & {
  credit_notes?: Array<{ invoice_number: string; net_amount: string }>;
};

const row = (number: string) => {
  const raw = fixture.rows.find((r) => r.invoice_number === number);
  if (!raw) throw new Error(`fixture has no ${number}`);
  return parseUnionStatementRow(JSON.parse(JSON.stringify(raw)), fixture.union_id);
};
const stored = (number: string) => fixture.stored[number as keyof typeof fixture.stored] as Stored;
const value = (lines: Array<{ label: string; value: string }>, label: string) =>
  lines.find((line) => line.label === label)?.value;
const chips = (text: string) =>
  Number(text).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const WEEK = 'Mon Nov 2, 2026 2:00 AM to Mon Nov 9, 2026 2:00 AM Chicago Time';

const EXPECTED = {
  'MIDWAY-2026-000039': {
    club: 'KINGS CLUB',
    payLine: 'KINGS CLUB Pays Midway Union',
    toSettle: '6,021.71',
    status: 'Overdue',
    due: 'Thu Nov 12, 2026 2:00 AM Chicago Time',
    lines: {
      'Rake Generated': '25,854.24',
      'Union Fee Kept': '2,585.44',
      'Rakeback Due To Club': '23,268.80',
      "Players' Result": '-37,160.83',
      'Cash Profit Base': '33,971.59',
      'ECO On Cash': '3,397.16',
      'Tournament Profit Base': '26,458.04',
      'ECO On Tournaments': '2,645.80',
      'Already Settled In Chips': '11,962.21',
      Outstanding: '6,042.96',
    },
    adjustments: [{ kind: 'Credit Note', number: 'MIDWAY-2026-000045', amount: '-21.25' }],
    afterAdjustments: '6,021.71',
  },
  'MIDWAY-2026-000041': {
    club: 'The Felt Society',
    payLine: 'The Felt Society Pays Midway Union',
    toSettle: '88,305.04',
    status: 'Overdue',
    due: 'Thu Nov 12, 2026 2:00 AM Chicago Time',
    lines: {
      'Rake Generated': '455,510.12',
      'Union Fee Kept': '45,551.03',
      'Rakeback Due To Club': '409,959.09',
      "Players' Result": '-473,091.31',
      'Cash Profit Base': '651,967.96',
      'ECO On Cash': '65,196.80',
      'Tournament Profit Base': '231,082.44',
      'ECO On Tournaments': '23,108.24',
      'Already Settled In Chips': '392,377.90',
      Outstanding: '88,305.04',
    },
    adjustments: [],
    afterAdjustments: null,
  },
  'MIDWAY-2026-000038': {
    club: 'Deep Stack Society',
    payLine: 'Deep Stack Society Pays Midway Union',
    toSettle: '96,919.54',
    status: 'Overdue',
    due: 'Thu Nov 12, 2026 2:00 AM Chicago Time',
    lines: {
      'Rake Generated': '452,206.43',
      'Union Fee Kept': '45,220.65',
      'Rakeback Due To Club': '406,985.78',
      "Players' Result": '-562,209.57',
      'Cash Profit Base': '642,905.48',
      'ECO On Cash': '64,290.55',
      'Tournament Profit Base': '326,289.87',
      'ECO On Tournaments': '32,628.99',
      'Already Settled In Chips': '296,982.64',
      Outstanding: '96,919.54',
    },
    adjustments: [],
    afterAdjustments: null,
  },
  // Square: nothing is owed either way, so it is neither due nor overdue
  // (the board's derived overdue flag is true for it; the document does not
  // repeat that).
  'MIDWAY-2026-000037': {
    club: 'Club Savage',
    payLine: 'Square, Nothing Due',
    toSettle: '0.00',
    status: 'Generated',
    due: 'Nothing Due',
    lines: {
      'Rake Generated': '0.00',
      'Union Fee Kept': '0.00',
      'Rakeback Due To Club': '0.00',
      "Players' Result": '0.00',
      'Cash Profit Base': '0.00',
      'ECO On Cash': '0.00',
      'Tournament Profit Base': '0.00',
      'ECO On Tournaments': '0.00',
      'Already Settled In Chips': '0.00',
      Outstanding: '0.00',
    },
    adjustments: [],
    afterAdjustments: null,
  },
} as const;

describe('the downloaded statement prints the stored production figures', () => {
  for (const [number, want] of Object.entries(EXPECTED)) {
    it(`${number} (${want.club})`, () => {
      const club = row(number);
      const db = stored(number);
      const doc = buildUnionStatementDocument(club, fixture.union_name);

      // Identity and week, exactly the stored instants.
      expect(value(doc.header, 'Union')).toBe('Midway Union');
      expect(value(doc.header, 'Statement Number')).toBe(number);
      expect(value(doc.header, 'Club')).toBe(db.club);
      expect(value(doc.header, 'Club')).toBe(want.club);
      expect(club.period_start_at).toBe(db.period_start);
      expect(club.period_end_at).toBe(db.period_end);
      expect(value(doc.header, 'Week')).toBe(WEEK);
      expect(value(doc.header, 'Issued')).toBe('Wed Nov 11, 2026 3:05 AM Chicago Time');
      expect(value(doc.header, 'Due')).toBe(want.due);
      expect(value(doc.header, 'Status')).toBe(want.status);

      // Direction: the stored from/to parties.
      expect(club.direction).toBe(db.direction);
      expect(club.payer_type).toBe(db.from);
      expect(club.payee_type).toBe(db.to);
      expect(value(doc.header, 'Who Pays Whom')).toBe(want.payLine);

      // Amounts: the stored net, the stored balance after notes.
      expect(value(doc.lines, 'Outstanding')).toBe(chips(db.net_amount));
      expect(value(doc.header, 'Amount To Settle')).toBe(chips(db.outstanding_after_notes));
      expect(value(doc.header, 'Amount To Settle')).toBe(want.toSettle);
      expect(Object.fromEntries(doc.lines.map((l) => [l.label, l.value]))).toEqual(want.lines);

      // Notes: every stored note, by number and amount; the net after them.
      expect(doc.adjustments).toEqual(want.adjustments);
      expect(doc.adjustments.map((a) => a.number)).toEqual(
        (db.credit_notes ?? []).map((n) => n.invoice_number)
      );
      expect(doc.adjustments.map((a) => a.amount)).toEqual(
        (db.credit_notes ?? []).map((n) => `-${chips(n.net_amount)}`)
      );
      expect(doc.amountToSettleAfterAdjustments).toBe(want.afterAdjustments);

      // The printed page carries the same figures.
      const html = unionStatementDocumentHtml(doc);
      expect(html).toContain(`<title>${number} ${want.club} Statement</title>`);
      expect(html).toContain(WEEK);
      for (const figure of Object.values(want.lines)) expect(html).toContain(figure);
      for (const note of want.adjustments) expect(html).toContain(note.number);
    });
  }

  it('the ECO lines add up to the stored amount billed', () => {
    for (const number of ['MIDWAY-2026-000038', 'MIDWAY-2026-000039', 'MIDWAY-2026-000041']) {
      const doc = buildUnionStatementDocument(row(number), fixture.union_name);
      const n = (label: string) => Number(value(doc.lines, label)!.replace(/,/g, ''));
      expect(Math.round((n('ECO On Cash') + n('ECO On Tournaments')) * 100)).toBe(
        Math.round(Number(stored(number).net_amount) * 100)
      );
    }
  });
});

describe('the statement week is the stored 2:00 AM Chicago boundaries', () => {
  const week = (start: string, end: string): StatementForDocument => ({
    ...row('MIDWAY-2026-000041'),
    period_start_at: start,
    period_end_at: end,
  });
  const printed = (start: string, end: string) =>
    value(buildUnionStatementDocument(week(start, end), 'Midway Union').header, 'Week');

  it('a week that ends after daylight saving ends (CDT -> CST) reads 2:00 AM at both ends', () => {
    // MIDWAY-2026-000034's week: 07:00Z is 2:00 AM CDT, 08:00Z is 2:00 AM CST.
    expect(printed('2026-10-26T07:00:00+00:00', '2026-11-02T08:00:00+00:00')).toBe(
      'Mon Oct 26, 2026 2:00 AM to Mon Nov 2, 2026 2:00 AM Chicago Time'
    );
  });

  it('a week that ends after daylight saving starts (CST -> CDT) reads 2:00 AM at both ends', () => {
    expect(printed('2027-03-08T08:00:00+00:00', '2027-03-15T07:00:00+00:00')).toBe(
      'Mon Mar 8, 2027 2:00 AM to Mon Mar 15, 2027 2:00 AM Chicago Time'
    );
  });

  it('prints the stored instant, never a boundary snapped to 2:00 AM', () => {
    // A week end stored an hour early (07:00Z after the fall change) is shown
    // as the 1:00 AM it is, not corrected into a boundary it is not.
    expect(printed('2026-10-26T07:00:00+00:00', '2026-11-02T07:00:00+00:00')).toBe(
      'Mon Oct 26, 2026 2:00 AM to Mon Nov 2, 2026 1:00 AM Chicago Time'
    );
  });

  it('a statement with no stored week instants falls back to the board label, never a guess', () => {
    const doc = buildUnionStatementDocument(
      { ...row('MIDWAY-2026-000041'), period_start_at: null, period_end_at: null },
      'Midway Union',
      'Nov 2 To Nov 9'
    );
    expect(value(doc.header, 'Week')).toBe('Nov 2 To Nov 9');
  });
});
