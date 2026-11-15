/**
 * The production Cashier Statements certificate reads figures with the grammar
 * in tests/e2e/support/exact-figure.ts. That grammar must accept what exactChips
 * prints and refuse an abbreviated figure, which would now be a regression of
 * the owner's 2026-11-13 ruling (real figures are never rounded or abbreviated).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { exactChips } from '../src/utils/format';
import { ENTRY_PILL, EXACT_FIGURE, inexactFigures } from './e2e/support/exact-figure';

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

  it("the figure guard names inexact figures and passes the failed run's row amounts", () => {
    expect(inexactFigures(['+1.50', '-76.26', ' 1,145.65 ', '0', exactChips(177488.28)])).toEqual(
      []
    );
    expect(inexactFigures(['+1.5K', '393K', '2B', '12.5M', '1,145.65'])).toEqual([
      '+1.5K',
      '393K',
      '2B',
      '12.5M',
    ]);
  });

  it('the certificate reads figure nodes only, so references and names never trip it', () => {
    // Review B1: these are on the Statements page beside the figures.
    const spec = readFileSync('tests/e2e/production-cashier-statements.spec.ts', 'utf8');
    const support = readFileSync('tests/e2e/support/cashierProductionCertification.ts', 'utf8');
    expect(spec).not.toMatch(/expectExactCashierFigures\(\s*surface\s*,/);
    expect(support).not.toContain('ABBREVIATED_FIGURE');
    expect(spec).toContain('button[aria-expanded] > span:last-child');
    // And it counts them: an empty locator must not pass (post-merge review note 1).
    expect(support).toMatch(/toContain\(texts\.length\)/);
    expect(spec).toContain('[0, 4]');
    // Were such text ever handed in as a figure, it is refused, not skipped.
    expect(
      inexactFigures(['Ref 262B2E2F', 'Ref 6B6424ED', 'Ref 1234567B', 'To 100K'])
    ).toHaveLength(4);
  });
});
