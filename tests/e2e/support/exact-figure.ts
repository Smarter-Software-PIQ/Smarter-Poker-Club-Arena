/**
 * The figure grammar the production Cashier Statements spec reads off the glass.
 *
 * Since 2026-11-13 (owner ruling, #10797) every real figure is printed by
 * exactChips: en-US separators, cents kept, never K/M/B. The spec used to accept
 * only whole numbers or compact K/M/B, so a correct total such as 177,488.28 kept
 * the certificate waiting until it timed out (Post-Deploy E2E 43643304336).
 *
 * tests/cashier-statements-exact-figure.test.ts runs these patterns against
 * exactChips itself, so a later formatter change fails a unit test here instead
 * of the production certificate.
 */
export const EXACT_FIGURE = /^[+-]?\d{1,3}(?:,\d{3})*(?:\.\d+)?$/;

/**
 * The texts that are not exact figures. The certificate hands this the text of
 * the nodes that carry figures (totals, row amounts), never the whole page: a
 * page-wide scan for K/M/B also matched reference codes such as "Ref 262B2E2F"
 * and names such as "100K" (independent review of aa6040f7, B1).
 */
export const inexactFigures = (texts: readonly string[]): string[] =>
  texts.map((text) => text.replace(/\s+/g, ' ').trim()).filter((text) => !EXACT_FIGURE.test(text));

/**
 * The four totals the Statements page must print for a totals answer from the
 * server: In, Out, Managed, Entries, as CashierStatementsPage writes them (a
 * plus on a non-zero In, a minus on a non-zero Out, the count with separators).
 * Both sides go through Number(), as the page does, so the comparison is exact
 * only to double precision (about 15 significant digits); a figure beyond that
 * is outside what the page can show exactly anyway.
 * `format` is the page's own chip formatter, handed in so this file stays free
 * of application imports. The certificate compares the glass with this, so a
 * page that shows well-formed but wrong totals fails (post-merge review of
 * #10889, note 3; owner 2026-11-14).
 */
export function statementTotalsFigures(
  totals: { in: unknown; out: unknown; managed: unknown; count: unknown },
  format: (value: number) => string
): string[] {
  const isZero = (value: unknown) => !/[1-9]/.test(String(value));
  const chips = (value: unknown) => format(Number(value));
  return [
    `${isZero(totals.in) ? '' : '+'}${chips(totals.in)}`,
    `${isZero(totals.out) ? '' : '-'}${chips(totals.out)}`,
    chips(totals.managed),
    Number(totals.count).toLocaleString('en-US'),
  ];
}

/**
 * Whether a totals request asks about the same statement as a page request:
 * the same club, period and filters. The page request also carries its paging
 * (`p_cursor`, `p_limit`), which the totals request has no use for; every other
 * argument must be present on both sides with the same value.
 */
export function sameStatementQuery(totalsAsked: unknown, pageAsked: unknown): boolean {
  const query = (asked: unknown): string | null => {
    if (!asked || typeof asked !== 'object' || Array.isArray(asked)) return null;
    const entries = Object.entries(asked as Record<string, unknown>)
      .filter(([name]) => name !== 'p_cursor' && name !== 'p_limit')
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return entries.length > 0 ? JSON.stringify(entries) : null;
  };
  const totals = query(totalsAsked);
  return totals !== null && totals === query(pageAsked);
}

/** The entry-count pill: "1 Entry", "2,111 Entries", or "Live Ledger". */
export const ENTRY_PILL = /^(?:\d{1,3}(?:,\d{3})* (?:Entry|Entries)|Live Ledger)\s*$/;
