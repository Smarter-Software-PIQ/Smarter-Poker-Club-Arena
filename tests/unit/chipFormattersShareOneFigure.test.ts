import { describe, expect, it } from 'vitest';
import {
  compactChips,
  exactChips,
  feeFigure,
  fmtChips,
  formatChips,
  formatSignedChips,
  formatWalletChips,
  winLossChips,
} from '../../src/utils/format';

/**
 * The chip formatters are one figure (chipFigure) with different minimum
 * places, sign styles and fallbacks (2026-11-14 consolidation). These pin the
 * relations so a later edit to one copy cannot make one value print two ways.
 */
const FIGURES: unknown[] = [
  0,
  -0,
  1,
  -1,
  0.5,
  -0.5,
  1512.34,
  -2183.7,
  1e21,
  1.5e-12,
  0.1 + 0.2,
  '123456789012345678.91',
  '-0.00',
  '1.230',
  '+5',
  '.5',
  12n,
  -7n,
];
const NOT_FIGURES: unknown[] = ['abc', '', NaN, Infinity, undefined];

describe('the chip formatters share one figure', () => {
  it('the historical names are exactChips', () => {
    for (const v of [...FIGURES, ...NOT_FIGURES] as any[]) {
      expect(compactChips(v)).toBe(exactChips(v));
      expect(fmtChips(v)).toBe(exactChips(v));
    }
  });

  it('wallet, fee and two-place chips print a figure identically', () => {
    for (const v of FIGURES as any[]) {
      expect(feeFigure(v)).toBe(formatWalletChips(v));
      expect(formatChips(v)).toBe(formatWalletChips(v));
    }
    expect(feeFigure(null)).toBe('Restricted');
    expect(formatWalletChips(null)).toBe('-');
    expect(formatChips('abc')).toBe('0.00');
  });

  it('a win / loss figure is a signed two-place chip figure', () => {
    for (const v of [...FIGURES, ...NOT_FIGURES] as any[])
      expect(winLossChips(v)).toBe(formatSignedChips(v, 2));
    expect(winLossChips(-2183.7)).toBe('-2,183.70');
    expect(winLossChips(393.95)).toBe('+393.95');
    expect(winLossChips(0)).toBe('0.00');
    expect(exactChips('123456789012345678.91')).toBe('123,456,789,012,345,678.91');
    expect(exactChips(1500)).toBe('1,500');
  });
});
