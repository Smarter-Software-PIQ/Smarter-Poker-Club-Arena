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

/** The entry-count pill: "1 Entry", "2,111 Entries", or "Live Ledger". */
export const ENTRY_PILL = /^(?:\d{1,3}(?:,\d{3})* (?:Entry|Entries)|Live Ledger)\s*$/;
