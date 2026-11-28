/**
 * NUMBERS STOP AFTER TWO DECIMALS, ANYWHERE AND EVERYWHERE (Dan 2026-11-27,
 * binding). Verbatim: "NUMERS AFTER A DECIMAL NEED TO STOP AFTER 2 DIGITS ANY
 * WHERE AND EVERYWHERE." His screenshot: Cash Rake Today printed
 * 403.3814552027556 on Overview, Dashboard and Finance & Risk.
 *
 * Digits past the second are CUT, never rounded (2026-09-04, "ABSOLUTELY ZERO
 * ROUNDING ANYWHERE EVER"). Two roots are pinned: the shared figure
 * formatters in src/utils/format.ts, and the browser default behind every
 * bare Number#toLocaleString(), which src/main.tsx caps before anything prints.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  compactChips,
  exactChips,
  feeFigure,
  fmt,
  fmtChips,
  formatWalletChips,
  winLossChips,
  figureDigits,
} from '../src/utils/format';
import { playerRecordMoney } from '../src/utils/playerRecordMoney';
import {
  cutToPlaces,
  installTwoDecimalDisplay,
  twoDecimalOptions,
} from '../src/utils/twoDecimalDisplay';

const ROOT = join(__dirname, '..');

describe('every figure on screen stops at two decimals', () => {
  it('prints the rake from the screenshot as 403.38 in every formatter', () => {
    const rake = 403.3814552027556;
    for (const f of [exactChips, compactChips, fmtChips, feeFigure, formatWalletChips]) {
      expect(f(rake)).toBe('403.38');
    }
    expect(winLossChips(rake)).toBe('+403.38');
    expect(exactChips('403.3814552027556')).toBe('403.38');
  });

  it('cuts, never rounds', () => {
    expect(exactChips(0.999)).toBe('0.99');
    expect(exactChips('1999.999')).toBe('1,999.99');
    expect(winLossChips(-12.349)).toBe('-12.34');
    expect(formatWalletChips(5)).toBe('5.00');
    expect(exactChips(1000)).toBe('1,000');
  });

  it('never prints a negative zero', () => {
    expect(exactChips(-0.004)).toBe('0');
    expect(winLossChips(-0.004)).toBe('0.00');
    expect(playerRecordMoney('-0.004', true)).toBe('0.00');
  });

  it('keeps the stored value exact', () => {
    expect(figureDigits('403.3814552027556')?.fraction).toBe('3814552027556');
  });

  it('caps the browser default without rounding', () => {
    installTwoDecimalDisplay();
    expect((403.3814552027556).toLocaleString('en-US')).toBe('403.38');
    expect((0.999).toLocaleString('en-US')).toBe('0.99');
    expect((1234.5).toLocaleString('en-US')).toBe('1,234.5');
    expect((1.23456).toLocaleString('en-US', { maximumFractionDigits: 4 })).toBe('1.23');
    expect((-0.004).toLocaleString('en-US')).toBe('0');
    expect(fmt(12345.6789)).toBe('12,345.67');
  });

  // Updated 2026-11-27 (display-figures-are-cut-never-rounded): these calls
  // keep their own place counts, but they no longer ROUND. The old pin
  // returned them untouched, which left `{ maximumFractionDigits: 2 }` and
  // `{ maximumFractionDigits: 0 }` rounding 0.999 up.
  it('keeps the place counts of percent, compact, significant-digit and narrower calls, and cuts them', () => {
    expect(twoDecimalOptions({ style: 'percent', maximumFractionDigits: 3 })).toEqual({
      style: 'percent',
      maximumFractionDigits: 3,
      roundingMode: 'trunc',
    });
    expect(twoDecimalOptions({ maximumFractionDigits: 1 })).toEqual({
      maximumFractionDigits: 1,
      roundingMode: 'trunc',
    });
    expect(twoDecimalOptions({ maximumSignificantDigits: 5 })).toEqual({
      maximumSignificantDigits: 5,
      roundingMode: 'trunc',
    });
    const chosen = { maximumFractionDigits: 1, roundingMode: 'halfExpand' };
    expect(twoDecimalOptions(chosen)).toBe(chosen);
    expect(cutToPlaces(2.009, 2)).toBe(2);
  });

  it('installs the cap as the first import of the app', () => {
    const main = readFileSync(join(ROOT, 'src/main.tsx'), 'utf8');
    const firstImport = /^import\s+[^\n]+$/m.exec(main)?.[0];
    expect(firstImport).toBe("import './utils/twoDecimalDisplay';");
  });
});
