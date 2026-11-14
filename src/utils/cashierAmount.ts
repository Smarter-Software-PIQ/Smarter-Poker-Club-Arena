/**
 * Chip amount helpers shared by the Trade cashier and its tests.
 *
 * They lived in src/pages/CashierTradePage.tsx until the regression review of
 * 2026-10-10 (G-06): a route module that exports plain functions next to its
 * component loses React Fast Refresh, so they sit here and the page imports
 * them.
 */

import { exactChips } from './format';

/**
 * THE FIGURE A USER CONFIRMS IS THE FIGURE THAT MOVES (launch audit
 * 2026-10-09, P-10). `fmt` floors to one decimal of K/M/B for head zones and
 * list rows, which is the console law. Inside a confirmation - the Send Out
 * total and its per-target rows, an Insufficient Chips refusal, the receipt
 * amount - the exact two-decimal figure prints instead, grouped by thousands:
 * 5 x 1,999.99 is "9,999.95", never "9.9K". Whole chips print whole.
 */
export function exactChipFigure(value: number | string): string {
  // Decimal text from the database prints digit for digit (Dan 2026-11-13).
  // A number here is a cashier amount: every source is a scale-2 chip column
  // (chip_transactions.amount numeric(14,2), wallets numeric(20,2)), or a sum
  // of them, so its explicit precision is cents and chipCents applies it.
  if (typeof value === 'string') return exactChips(value);
  return exactChips(Number.isFinite(value) ? chipCents(value) : 0);
}

/**
 * Money is summed in CENTS (launch audit 2026-10-09, P-16). `0.1 + 0.2 - 0.3`
 * is 5.55e-17 in binary floating point, which `net` printed as "+0"; every
 * displayed sum on the Trade page goes through here so a figure can never carry
 * drift the ledger does not have.
 */
/**
 * The result of client-side chip arithmetic, at the platform's stored chip
 * precision: cents (every chip column is scale 2). The explicit rounding rule
 * for a sum, difference or average computed in the browser, applied before a
 * formatter prints it (the formatter itself never guesses at noise).
 */
export function chipCents(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function sumChips(values: Iterable<number>): number {
  let cents = 0;
  for (const value of values) cents += Math.round((Number(value) || 0) * 100);
  return cents / 100;
}

/**
 * "1,000" used to reach `Number()` as NaN and be refused as "Enter A Positive
 * Amount" - the message blamed the sign, not the comma (launch audit
 * 2026-10-09, P-20). Conventional thousands grouping is accepted and stripped;
 * any other comma is named for what it is. Same words as the classic cashier.
 */
export function parseTradeAmount(
  input: string
): { ok: true; value: number } | { ok: false; error: string } {
  const trimmed = String(input ?? '').trim();
  const grouped = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(trimmed);
  const spelled = grouped ? trimmed.replace(/,/g, '') : trimmed;
  if (spelled.includes(',')) return { ok: false, error: 'Enter The Amount Without Commas' };
  const raw = spelled === '' ? NaN : Number(spelled);
  if (!Number.isFinite(raw) || raw <= 0) return { ok: false, error: 'Enter A Positive Amount' };
  // THE SPELLING, NOT THE FLOAT (regression review 2026-10-10, G-08). `Number`
  // reads "1e3" as 1000 and "0x10" as 16; the classic cashier refuses both on
  // the typed text (P-14), and so does this page now. Digits and at most two
  // decimals are the only spelling of a chip amount.
  if (!/^\d+(\.\d{1,2})?$/.test(spelled)) {
    return { ok: false, error: 'Enter The Amount As Digits, With Up To Two Decimals' };
  }
  return { ok: true, value: raw };
}

/** Group the editable whole part without rounding or hiding invalid input. */
export function formatCashierAmountInput(input: string): string {
  const raw = cashierAmountInputValue(input);
  if (!/^\d*(\.\d*)?$/.test(raw)) return input;
  const [whole, fraction] = raw.split('.');
  return (
    whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction === undefined ? '' : `.${fraction}`)
  );
}

/**
 * Normalize the editable figure before regrouping it. Inserting a digit into
 * "1,000" produces "1,0000" before React renders again; grouping validation
 * belongs to the submitted amount, not this intermediate editing state.
 * Letters, signs and other invalid spelling stay visible and are refused.
 */
export function cashierAmountInputValue(input: string): string {
  return /^[\d,]+(\.\d*)?$/.test(input) ? input.replace(/,/g, '') : input;
}
