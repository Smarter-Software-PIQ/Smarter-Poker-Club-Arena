/**
 * UNION STATEMENT DOCUMENT
 * ============================================================================
 * The printable copy of one weekly union statement, built only from the row
 * the Union Statements board already holds (ca_union_statement_board). It is
 * turned into a PDF by the browser's own print dialog ("Save As PDF"), so no
 * PDF library and no server call is involved.
 *
 * Every figure is the stored figure, printed with separators and two places.
 * Nothing here recomputes what is owed: the amount to settle is the board's
 * own remaining_after_credits whenever a credit or charge note is recorded.
 */
import { formatWalletChips } from './format';
import { titleCase } from './titleCase';
import {
  chicagoInstantLabel,
  statementClubName,
  unionStatementPayLine,
  unionStatementWeekLabel,
  type StatementCredit,
  type UnionStatementClub,
} from './unionStatementBoard';

/** A board row, with the charge notes (debit notes) the board may carry and,
 *  when read from ca_union_statement_document, each note's issue time keyed
 *  by its number. */
export type StatementForDocument = UnionStatementClub & {
  charge_notes?: StatementCredit[] | null;
  note_dates?: Record<string, string> | null;
};

export interface StatementDocumentLine {
  label: string;
  value: string;
}

export interface StatementDocumentAdjustment {
  kind: 'Credit Note' | 'Charge Note';
  number: string;
  /** When the note was issued, Chicago time; "Not Recorded" when the source carries no date. */
  date: string;
  /** Signed toward what is owed: a credit note reduces it, a charge note adds to it. */
  amount: string;
}

export interface UnionStatementDocument {
  /** Also the suggested file name when the copy is saved as a PDF. */
  title: string;
  header: StatementDocumentLine[];
  lines: StatementDocumentLine[];
  adjustments: StatementDocumentAdjustment[];
  /** Null when no adjustment is recorded against the statement. */
  amountToSettleAfterAdjustments: string | null;
  notes: string[];
  footer: string;
}

const NOT_RECORDED = 'Not Recorded';

const chips = (value: number | null | undefined): string =>
  value === null || value === undefined ? NOT_RECORDED : formatWalletChips(value);

const cents = (value: number): number => Math.round(value * 100);

/* A statement with nothing left to settle (square, or credited to zero) is
   never overdue and has no due date, whatever the board's flag says: the
   statement's own message body (union_weekly_invoice_body) prints a due date
   only when something remains. */
function statusLabel(club: StatementForDocument, nothingDue: boolean): string {
  if (club.payment_details_available === false) return 'Paid Record Only';
  if (club.overdue && !nothingDue) return 'Overdue';
  return titleCase(club.status);
}

/**
 * The document for one issued statement. `fallbackWeek` is the board's own
 * week label for a statement that predates stored week instants.
 */
export function buildUnionStatementDocument(
  club: StatementForDocument,
  unionName: string | null,
  fallbackWeek: string | null = null
): UnionStatementDocument {
  const union = unionName ? titleCase(unionName) : 'The Union';
  const clubLabel = titleCase(club.club_name);
  const number = club.invoice_number ?? 'Not Numbered';
  const square = club.direction === 'square' || cents(club.amount) === 0;
  const credits = club.credit_notes ?? [];
  const charges = club.charge_notes ?? [];
  const adjusted = credits.length > 0 || charges.length > 0;
  const original = Math.abs(club.amount);
  const toSettle = square ? 0 : adjusted ? (club.remaining_after_credits ?? null) : original;
  const nothingDue = toSettle !== null && cents(toSettle) <= 0;
  const eco = (activity: 'cash' | 'tournament') =>
    club.eco_components?.find((component) => component.activity === activity) ?? null;
  const cash = eco('cash');
  const tournament = eco('tournament');

  const header: StatementDocumentLine[] = [
    { label: 'Union', value: union },
    { label: 'Statement Number', value: number },
    { label: 'Club', value: statementClubName(club, clubLabel) },
    {
      label: 'Week',
      value:
        unionStatementWeekLabel(club.period_start_at, club.period_end_at) ??
        fallbackWeek ??
        NOT_RECORDED,
    },
    {
      label: 'Issued',
      value: club.issued_at ? `${chicagoInstantLabel(club.issued_at)} Chicago Time` : NOT_RECORDED,
    },
    {
      label: 'Due',
      value: nothingDue
        ? 'Nothing Due'
        : club.due_at
          ? `${chicagoInstantLabel(club.due_at)} Chicago Time`
          : NOT_RECORDED,
    },
    { label: 'Status', value: statusLabel(club, nothingDue) },
    { label: 'Who Pays Whom', value: unionStatementPayLine(club, clubLabel, union) },
    { label: 'Amount To Settle', value: chips(toSettle) },
  ];

  const lines: StatementDocumentLine[] = [
    { label: 'Rake Generated', value: chips(club.rake_generated) },
    { label: 'Union Fee Kept', value: chips(club.union_fee_kept) },
    { label: 'Rakeback Due To Club', value: chips(club.rakeback_due) },
    { label: "Players' Result", value: chips(club.players_won) },
    { label: 'Cash Profit Base', value: chips(cash?.base) },
    // ECO is stored toward the club (negative means the club pays); the
    // document prints it as a charge, so positive means the club pays.
    { label: 'ECO On Cash', value: chips(cash ? -cash.amount : null) },
    { label: 'Tournament Profit Base', value: chips(tournament?.base) },
    { label: 'ECO On Tournaments', value: chips(tournament ? -tournament.amount : null) },
    { label: 'Already Settled In Chips', value: chips(club.settled_in_chips) },
    { label: 'Outstanding', value: chips(square ? 0 : original) },
  ];

  const noteDate = (number: string): string => {
    const at = club.note_dates?.[number];
    return at ? `${chicagoInstantLabel(at)} Chicago Time` : NOT_RECORDED;
  };
  const adjustments: StatementDocumentAdjustment[] = [
    ...credits.map((note) => ({
      kind: 'Credit Note' as const,
      number: note.invoice_number,
      date: noteDate(note.invoice_number),
      amount: formatWalletChips(-Math.abs(note.amount)),
    })),
    ...charges.map((note) => ({
      kind: 'Charge Note' as const,
      number: note.invoice_number,
      date: noteDate(note.invoice_number),
      amount: formatWalletChips(Math.abs(note.amount)),
    })),
  ];

  return {
    title: `${number} ${clubLabel} Statement`,
    header,
    lines,
    adjustments,
    amountToSettleAfterAdjustments: adjusted ? chips(club.remaining_after_credits) : null,
    notes: [
      "Players' Result Is Counted Toward The Club: Negative Means Players Lost.",
      'ECO Lines Are Charges: Positive Means The Club Pays The Union.',
      'Already Settled In Chips Has Already Moved And Is Not Billed Again.',
      'Outstanding Is The Amount Due On The Statement Before Adjustments.',
    ],
    footer: 'All Amounts In Chips.',
  };
}

const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/* The print copy is a paper document: white page, black text, tabular
   figures. It carries no screen colour at all. */
const PRINT_CSS = `
@page { size: auto; margin: 16mm; }
* { box-sizing: border-box; }
html, body { background: #fff; color: #000; margin: 0; }
body { font: 12px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; padding: 24px; }
h1 { font-size: 20px; margin: 0 0 4px; }
h2 { font-size: 13px; margin: 22px 0 6px; text-transform: none; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 5px 0; border-bottom: 1px solid #000; vertical-align: top; }
th { font-weight: 600; width: 40%; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.num { font-variant-numeric: tabular-nums; }
tr.total th, tr.total td { font-weight: 700; border-top: 2px solid #000; }
.notes { margin: 18px 0 0; padding: 0; list-style: none; }
.notes li { margin: 2px 0; }
footer { margin-top: 22px; padding-top: 8px; border-top: 1px solid #000; font-weight: 600; }
@media print { body { padding: 0; } }
`;

/** The whole print-ready page for a statement document. */
export function unionStatementDocumentHtml(doc: UnionStatementDocument): string {
  const row = (line: StatementDocumentLine, numeric: boolean) =>
    `<tr><th scope="row">${escapeHtml(line.label)}</th><td${numeric ? ' class="num"' : ''}>${escapeHtml(line.value)}</td></tr>`;
  const header = doc.header.map((line) => row(line, line.label === 'Amount To Settle')).join('');
  const lines = doc.lines.map((line) => row(line, true)).join('');
  const adjustments = doc.adjustments.length
    ? `<table><thead><tr><th scope="col">Adjustment</th><th scope="col">Number</th><th scope="col">Issued</th><th scope="col" class="num">Amount</th></tr></thead><tbody>${doc.adjustments
        .map(
          (a) =>
            `<tr><td>${escapeHtml(a.kind)}</td><td>${escapeHtml(a.number)}</td><td>${escapeHtml(a.date)}</td><td class="num">${escapeHtml(a.amount)}</td></tr>`
        )
        .join(
          ''
        )}<tr class="total"><th scope="row" colspan="3">Amount To Settle After Adjustments</th><td class="num">${escapeHtml(doc.amountToSettleAfterAdjustments ?? NOT_RECORDED)}</td></tr></tbody></table>`
    : '<p>No Adjustments Are Recorded Against This Statement.</p>';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(doc.title)}</title><style>${PRINT_CSS}</style></head><body><h1>Weekly Union Statement</h1><table>${header}</table><h2>Statement Lines</h2><table>${lines}</table><h2>Adjustments</h2>${adjustments}<ul class="notes">${doc.notes
    .map((note) => `<li>${escapeHtml(note)}</li>`)
    .join('')}</ul><footer>${escapeHtml(doc.footer)}</footer></body></html>`;
}

/**
 * Prints the statement from a hidden frame on the same page, so the print
 * dialog shows only the statement; its "Save As PDF" is the download. No new
 * window is opened (inside the app a new window goes nowhere).
 */
export function printUnionStatementDocument(doc: UnionStatementDocument): void {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('title', doc.title);
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  frame.onload = () => {
    const view = frame.contentWindow;
    if (!view) return;
    view.addEventListener('afterprint', () => frame.remove(), { once: true });
    view.focus();
    view.print();
  };
  frame.srcdoc = unionStatementDocumentHtml(doc);
  document.body.appendChild(frame);
}
