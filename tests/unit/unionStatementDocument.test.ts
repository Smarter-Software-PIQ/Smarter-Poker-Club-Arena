import { describe, expect, it } from 'vitest';
import { parseUnionStatementBoard } from '../../src/utils/unionStatementBoard';
import {
  buildUnionStatementDocument,
  unionStatementDocumentHtml,
  type StatementForDocument,
} from '../../src/utils/unionStatementDocument';
import weekEndingNov9 from '../fixtures/union-invoice-week-2026-11-02/board.json';

const UNION = 'fade0000-0000-0000-0000-000000000001';

/** Last week's KINGS statement as the board returns it, optionally credited. */
function kings(credit: boolean): StatementForDocument {
  const raw = JSON.parse(JSON.stringify(weekEndingNov9));
  const row = raw.clubs.find((c: { club_name: string }) => c.club_name === 'KINGS CLUB');
  if (credit) {
    row.credit_notes = [{ invoice_number: 'MIDWAY-2026-000045', amount: 21.25 }];
    row.remaining_after_credits = 6021.71;
  }
  const board = parseUnionStatementBoard(raw, raw.union_id ?? UNION, null);
  return board.clubs.find((c) => c.club_name === 'KINGS CLUB') as StatementForDocument;
}

const value = (lines: Array<{ label: string; value: string }>, label: string) =>
  lines.find((line) => line.label === label)?.value;

describe('union statement document', () => {
  it('prints MIDWAY-2026-000039 for KINGS with its credit note, in order', () => {
    const doc = buildUnionStatementDocument(kings(true), 'Midway Union');

    expect(doc.header.map((l) => l.label)).toEqual([
      'Union',
      'Statement Number',
      'Club',
      'Week',
      'Issued',
      'Due',
      'Status',
      'Who Pays Whom',
      'Amount To Settle',
    ]);
    expect(value(doc.header, 'Union')).toBe('Midway Union');
    expect(value(doc.header, 'Statement Number')).toBe('MIDWAY-2026-000039');
    expect(value(doc.header, 'Club')).toBe('KINGS CLUB'); // the board's own house capitalisation keeps the stored capitals
    expect(value(doc.header, 'Week')).toBe(
      'Mon Nov 2, 2026 2:00 AM to Mon Nov 9, 2026 2:00 AM Chicago Time'
    );
    expect(value(doc.header, 'Issued')).toBe('Wed Nov 11, 2026 3:05 AM Chicago Time');
    expect(value(doc.header, 'Due')).toBe('Thu Nov 12, 2026 2:00 AM Chicago Time');
    expect(value(doc.header, 'Status')).toBe('Overdue');
    expect(value(doc.header, 'Who Pays Whom')).toBe('KINGS CLUB Pays Midway Union');
    expect(value(doc.header, 'Amount To Settle')).toBe('6,021.71');

    expect(doc.lines).toEqual([
      { label: 'Rake Generated', value: '25,854.24' },
      { label: 'Union Fee Kept', value: '2,585.44' },
      { label: 'Rakeback Due To Club', value: '23,268.80' },
      { label: "Players' Result", value: '-37,160.83' },
      { label: 'Cash Profit Base', value: '33,971.59' },
      { label: 'ECO On Cash', value: '3,397.16' },
      { label: 'Tournament Profit Base', value: '26,458.04' },
      { label: 'ECO On Tournaments', value: '2,645.80' },
      { label: 'Already Settled In Chips', value: '11,962.21' },
      { label: 'Outstanding', value: '6,042.96' },
    ]);
    expect(doc.adjustments).toEqual([
      { kind: 'Credit Note', number: 'MIDWAY-2026-000045', date: 'Not Recorded', amount: '-21.25' },
    ]);
    expect(doc.amountToSettleAfterAdjustments).toBe('6,021.71');
    expect(doc.footer).toBe('All Amounts In Chips.');
    expect(doc.title).toBe('MIDWAY-2026-000039 KINGS CLUB Statement');

    const html = unionStatementDocumentHtml(doc);
    expect(html).toContain('<title>MIDWAY-2026-000039 KINGS CLUB Statement</title>');
    expect(html).toContain('Amount To Settle After Adjustments');
    expect(html).toContain('font-variant-numeric: tabular-nums');
    expect(html).toContain('background: #fff; color: #000;');
    expect(html).toContain('Players&#39; Result');
    // Header, lines, adjustments, footer appear in that order.
    const at = (text: string) => html.indexOf(text);
    expect(at('MIDWAY-2026-000039</td>')).toBeLessThan(at('Rake Generated'));
    expect(at('Outstanding</th>')).toBeLessThan(at('MIDWAY-2026-000045'));
    expect(at('MIDWAY-2026-000045')).toBeLessThan(at('All Amounts In Chips.'));
  });

  it('prints a statement with no adjustments and says so', () => {
    const doc = buildUnionStatementDocument(kings(false), 'Midway Union');
    expect(value(doc.header, 'Amount To Settle')).toBe('6,042.96');
    expect(value(doc.lines, 'Outstanding')).toBe('6,042.96');
    expect(doc.adjustments).toEqual([]);
    expect(doc.amountToSettleAfterAdjustments).toBeNull();
    const html = unionStatementDocumentHtml(doc);
    expect(html).toContain('No Adjustments Are Recorded Against This Statement.');
    expect(html).not.toContain('Amount To Settle After Adjustments');
  });

  it('renders a charge note when the board carries one', () => {
    const club: StatementForDocument = {
      ...kings(false),
      charge_notes: [{ invoice_number: 'MIDWAY-2026-000046', amount: 43.86 }],
      remaining_after_credits: 6086.82,
    };
    const doc = buildUnionStatementDocument(club, 'Midway Union');
    expect(doc.adjustments).toEqual([
      { kind: 'Charge Note', number: 'MIDWAY-2026-000046', date: 'Not Recorded', amount: '43.86' },
    ]);
    expect(doc.amountToSettleAfterAdjustments).toBe('6,086.82');
    expect(value(doc.header, 'Amount To Settle')).toBe('6,086.82');
  });
});
