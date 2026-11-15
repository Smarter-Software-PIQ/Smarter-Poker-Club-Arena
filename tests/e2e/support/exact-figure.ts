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

/** The entry-count pill: "1 Entry", "2,111 Entries", or "Live Ledger". */
export const ENTRY_PILL = /^(?:\d{1,3}(?:,\d{3})* (?:Entry|Entries)|Live Ledger)\s*$/;
