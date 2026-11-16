/**
 * UNION STATEMENT DOWNLOAD
 * ============================================================================
 * Both sides download the same document from the same reader:
 * ca_union_statement_document(invoice) returns one issued weekly statement in
 * the board's own row shape plus every credit and charge note against it,
 * dated. The server decides who may read it (the issuing union's overseers
 * and the club's whole-club report readers); the client only says so.
 */
import { isAuthzError } from './clubDashboard';
import { parseUnionStatementRow } from './unionStatementBoard';
import {
  buildUnionStatementDocument,
  type StatementForDocument,
  type UnionStatementDocument,
} from './unionStatementDocument';

export interface StatementDocumentResponse {
  club: StatementForDocument;
  unionName: string | null;
}

type Json = Record<string, unknown>;

const record = (value: unknown, label: string): Json => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} is invalid`);
  return value as Json;
};
const cents = (value: number): number => Math.round(value * 100);

/** The reader's answer, checked: the statement by the board's row rules, the notes against it. */
export function parseUnionStatementDocumentResponse(data: unknown): StatementDocumentResponse {
  const body = record(data, 'Statement document');
  if (typeof body.union_id !== 'string' || !body.union_id)
    throw new Error('Statement union is invalid');
  const unionName =
    body.union_name === null || body.union_name === undefined
      ? null
      : typeof body.union_name === 'string'
        ? body.union_name
        : (() => {
            throw new Error('Statement union name is invalid');
          })();
  const club: StatementForDocument = parseUnionStatementRow(body.statement, body.union_id);
  if (club.status === 'missing' || !club.invoice_id) throw new Error('Statement is not issued');
  if (!Array.isArray(body.notes)) throw new Error('Statement notes are invalid');
  const notes = body.notes.map((value) => {
    const note = record(value, 'Statement note');
    if (note.kind !== 'credit' && note.kind !== 'charge')
      throw new Error('Statement note kind is invalid');
    if (typeof note.invoice_number !== 'string' || !note.invoice_number)
      throw new Error('Statement note number is invalid');
    if (typeof note.amount !== 'number' || !Number.isFinite(note.amount) || cents(note.amount) <= 0)
      throw new Error('Statement note amount is invalid');
    if (typeof note.issued_at !== 'string' || !Number.isFinite(Date.parse(note.issued_at)))
      throw new Error('Statement note date is invalid');
    return {
      kind: note.kind,
      invoice_number: note.invoice_number,
      amount: note.amount,
      issued_at: note.issued_at,
    };
  });
  // The dated list and the statement's own notes are the same notes.
  const same = (kind: 'credit' | 'charge', listed: StatementForDocument['credit_notes']) => {
    const dated = notes.filter((n) => n.kind === kind);
    const own = listed ?? [];
    return (
      dated.length === own.length &&
      dated.every(
        (n, i) =>
          n.invoice_number === own[i].invoice_number && cents(n.amount) === cents(own[i].amount)
      )
    );
  };
  if (!same('credit', club.credit_notes) || !same('charge', club.charge_notes))
    throw new Error('Statement notes do not reconcile');
  club.note_dates = Object.fromEntries(notes.map((n) => [n.invoice_number, n.issued_at]));
  return { club, unionName };
}

export type StatementDownloadResult =
  | { ok: true; document: UnionStatementDocument }
  | { ok: false; reason: 'denied' | 'failed'; error?: unknown };

type Rpc = (
  fn: 'ca_union_statement_document',
  args: { p_invoice_id: string }
) => PromiseLike<{ data: unknown; error: unknown }>;

/** The reader is not installed yet (PostgREST: no such function). */
const readerMissing = (error: unknown): boolean => {
  const e = error as { code?: string } | null;
  return e?.code === 'PGRST202' || e?.code === '42883';
};

/**
 * The document for one statement, read from the server. `fallback` is the
 * union board's own row: used only while the reader is not installed, so the
 * union's download never regresses (its notes then print without dates).
 */
export async function loadUnionStatementDocument(
  rpc: Rpc,
  invoiceId: string,
  fallback?: { club: StatementForDocument; unionName: string | null; fallbackWeek: string | null }
): Promise<StatementDownloadResult> {
  try {
    const { data, error } = await rpc('ca_union_statement_document', { p_invoice_id: invoiceId });
    if (error) {
      if (fallback && readerMissing(error))
        return {
          ok: true,
          document: buildUnionStatementDocument(
            fallback.club,
            fallback.unionName,
            fallback.fallbackWeek
          ),
        };
      return { ok: false, reason: isAuthzError(error) ? 'denied' : 'failed', error };
    }
    const { club, unionName } = parseUnionStatementDocumentResponse(data);
    return {
      ok: true,
      document: buildUnionStatementDocument(club, unionName, fallback?.fallbackWeek ?? null),
    };
  } catch (error) {
    return { ok: false, reason: 'failed', error };
  }
}
