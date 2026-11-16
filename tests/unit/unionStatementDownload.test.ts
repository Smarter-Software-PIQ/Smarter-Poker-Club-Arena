/**
 * The statement both sides download comes from ca_union_statement_document.
 * The fixtures are that reader's answers for MIDWAY-2026-000039, produced by
 * scripts/ci/test-union-statement-document-postgres.py over the real stored
 * statement and credit note (isolated database, no production access).
 */
import { describe, expect, it } from 'vitest';
import {
  loadUnionStatementDocument,
  parseUnionStatementDocumentResponse,
} from '../../src/utils/unionStatementDownload';
import { buildUnionStatementDocument } from '../../src/utils/unionStatementDocument';
import { parseUnionStatementRow } from '../../src/utils/unionStatementBoard';
import reader from '../fixtures/union-statement-document/reader-MIDWAY-2026-000039.json';
import readerWithCharge from '../fixtures/union-statement-document/reader-MIDWAY-2026-000039-with-charge-note.json';
import board from '../fixtures/union-statement-document/production-2026-11-09.json';

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const value = (lines: Array<{ label: string; value: string }>, label: string) =>
  lines.find((line) => line.label === label)?.value;

describe('the statement document reader', () => {
  it('prints KINGS MIDWAY-2026-000039 with credit note MIDWAY-2026-000045 and its date', () => {
    const { club, unionName } = parseUnionStatementDocumentResponse(copy(reader));
    const doc = buildUnionStatementDocument(club, unionName);
    expect(value(doc.header, 'Statement Number')).toBe('MIDWAY-2026-000039');
    expect(value(doc.header, 'Club')).toBe('KINGS CLUB');
    expect(value(doc.header, 'Week')).toBe(
      'Mon Nov 2, 2026 2:00 AM to Mon Nov 9, 2026 2:00 AM Chicago Time'
    );
    expect(value(doc.header, 'Who Pays Whom')).toBe('KINGS CLUB Pays Midway Union');
    expect(value(doc.lines, 'Outstanding')).toBe('6,042.96');
    expect(doc.adjustments).toEqual([
      {
        kind: 'Credit Note',
        number: 'MIDWAY-2026-000045',
        date: 'Sun Nov 15, 2026 10:32 AM Chicago Time',
        amount: '-21.25',
      },
    ]);
    expect(doc.amountToSettleAfterAdjustments).toBe('6,021.71');
    expect(value(doc.header, 'Amount To Settle')).toBe('6,021.71');
  });

  it('gives exactly the document the union board row gives, plus the note date', () => {
    const fromReader = buildUnionStatementDocument(
      parseUnionStatementDocumentResponse(copy(reader)).club,
      'Midway Union'
    );
    const row = board.rows.find((r) => r.invoice_number === 'MIDWAY-2026-000039');
    const fromBoard = buildUnionStatementDocument(
      parseUnionStatementRow(copy(row), board.union_id),
      'Midway Union'
    );
    expect(fromReader.header).toEqual(fromBoard.header);
    expect(fromReader.lines).toEqual(fromBoard.lines);
    expect(fromBoard.adjustments[0].date).toBe('Not Recorded');
    expect({ ...fromReader.adjustments[0], date: 'Not Recorded' }).toEqual(
      fromBoard.adjustments[0]
    );
  });

  it('refuses a dated note list that is not the statement’s own notes', () => {
    const tampered = copy(reader);
    tampered.notes[0].amount = 21.26;
    expect(() => parseUnionStatementDocumentResponse(tampered)).toThrow(/do not reconcile/);
    const dropped = copy(reader);
    dropped.notes = [];
    expect(() => parseUnionStatementDocumentResponse(dropped)).toThrow(/do not reconcile/);
  });

  it('a charge note prints dated once the board parser knows charge notes, and is never misprinted before', () => {
    const statement = copy(readerWithCharge).statement;
    let knowsCharges = true;
    try {
      knowsCharges = Boolean(parseUnionStatementRow(statement, board.union_id).charge_notes);
    } catch {
      knowsCharges = false;
    }
    if (!knowsCharges) {
      // Before #11015's client: the remaining figure includes the charge, the
      // parser only knows credits, so the statement is refused, not misprinted.
      expect(() => parseUnionStatementDocumentResponse(copy(readerWithCharge))).toThrow();
      return;
    }
    const { club } = parseUnionStatementDocumentResponse(copy(readerWithCharge));
    const doc = buildUnionStatementDocument(club, 'Midway Union');
    expect(doc.adjustments).toEqual([
      {
        kind: 'Credit Note',
        number: 'MIDWAY-2026-000045',
        date: 'Sun Nov 15, 2026 10:32 AM Chicago Time',
        amount: '-21.25',
      },
      {
        kind: 'Charge Note',
        number: 'TEST-CHARGE-1',
        date: 'Mon Nov 16, 2026 1:00 PM Chicago Time',
        amount: '43.86',
      },
    ]);
    expect(doc.amountToSettleAfterAdjustments).toBe('6,065.57');
  });
});

describe('loading the statement for download', () => {
  const row = board.rows.find((r) => r.invoice_number === 'MIDWAY-2026-000039');
  const fallback = {
    club: parseUnionStatementRow(copy(row), board.union_id),
    unionName: 'Midway Union',
    fallbackWeek: null,
  };
  const answer = (data: unknown, error: unknown) => async () => ({ data, error });

  it('prints the reader’s statement', async () => {
    const result = await loadUnionStatementDocument(answer(copy(reader), null), 'x');
    expect(result.ok && result.document.adjustments[0].date).toBe(
      'Sun Nov 15, 2026 10:32 AM Chicago Time'
    );
  });

  it('falls back to the union board row only while the reader is not installed', async () => {
    const missing = await loadUnionStatementDocument(
      answer(null, { code: 'PGRST202' }),
      'x',
      fallback
    );
    expect(missing.ok && missing.document.adjustments[0].date).toBe('Not Recorded');
    const clubSide = await loadUnionStatementDocument(answer(null, { code: 'PGRST202' }), 'x');
    expect(clubSide).toMatchObject({ ok: false, reason: 'failed' });
  });

  it('says access is denied when the server refuses, and never falls back', async () => {
    const denied = await loadUnionStatementDocument(
      answer(null, { code: '42501', message: 'not authorized for this statement' }),
      'x',
      fallback
    );
    expect(denied).toMatchObject({ ok: false, reason: 'denied' });
  });

  it('reports a malformed answer as a failure', async () => {
    const bad = await loadUnionStatementDocument(answer({ union_id: 'u' }, null), 'x', fallback);
    expect(bad).toMatchObject({ ok: false, reason: 'failed' });
  });
});
