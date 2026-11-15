/**
 * The production Cashier Statements certificate reads figures with the grammar
 * in tests/e2e/support/exact-figure.ts. That grammar must accept what exactChips
 * prints and refuse an abbreviated figure, which would now be a regression of
 * the owner's 2026-11-13 ruling (real figures are never rounded or abbreviated).
 */
import { describe, expect, it } from 'vitest';
import { exactChips } from '../src/utils/format';
import { ENTRY_PILL, EXACT_FIGURE } from './e2e/support/exact-figure';
import { ABBREVIATED_FIGURE } from './e2e/support/cashierProductionCertification';

describe('the statements certificate reads exact figures', () => {
  const values = [0, 7, 2111, 177488.28, 1234567.5, 0.01, 1e9, -12.5, -177488.28];

  it('accepts every figure exactChips prints', () => {
    for (const value of values) expect(exactChips(value), String(value)).toMatch(EXACT_FIGURE);
  });

  it('accepts the figures of the failed run, 0 | 0 | 177,488.28 | 2,111', () => {
    for (const figure of ['0', '0', '177,488.28', '2,111']) expect(figure).toMatch(EXACT_FIGURE);
  });

  it('refuses abbreviated or malformed figures', () => {
    for (const figure of ['177.5K', '1.5M', '393K', '2B', '1,23', '12,3456', '', 'Calculating'])
      expect(figure).not.toMatch(EXACT_FIGURE);
  });

  it('reads the entry pill as the page writes it', () => {
    expect(`${exactChips(1)} Entry`).toMatch(ENTRY_PILL);
    expect(`${exactChips(2111)} Entries `).toMatch(ENTRY_PILL);
    expect('Live Ledger').toMatch(ENTRY_PILL);
    expect('2.1K Entries').not.toMatch(ENTRY_PILL);
  });

  it('the page-wide guard refuses abbreviations and accepts exact figures with cents', () => {
    for (const text of ['Net 1.5K Chips', 'Total 393K', 'In: 2B', '(12.5M)'])
      expect(text, text).toMatch(ABBREVIATED_FIGURE);
    for (const text of [
      `Net ${exactChips(177488.28)} Chips`,
      `In: ${exactChips(2111)}`,
      'KINGS CLUB',
      'Week 46 Statement',
      'Balance After: 1,234.50',
    ])
      expect(text, text).not.toMatch(ABBREVIATED_FIGURE);
  });
});
