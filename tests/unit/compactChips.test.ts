import { describe, expect, it } from 'vitest';
import { compactChips, exactChips, winLossChips } from '../../src/utils/format';

/* Dan 2026-11-13: "I DON'T WANT ROUNDED UP NUMBERS LIKE 393 OR 1.5K OR 1K USE
   WHOLE NUMBERS AND DECIMALS ALWAYS ... FIX THIS LOGIC GLOBALLY". */
describe('exact figures, never abbreviated', () => {
  it('keeps the cents and never prints a K, M or B', () => {
    expect(compactChips(-0.5)).toBe('-0.50');
    expect(exactChips(1512.34)).toBe('1,512.34');
    expect(exactChips(1500)).toBe('1,500');
    expect(exactChips(1_000_000)).toBe('1,000,000');
    expect(exactChips(392.57)).toBe('392.57');
    expect(exactChips(0)).toBe('0');
    expect(exactChips(-0.001)).toBe('0');
    for (const n of [999, 1000, 1290, 51115, 3_226_000, 9_999_999_999.99]) {
      expect(compactChips(n)).not.toMatch(/[KMB]$/);
    }
  });

  it('signs a Player Management win / loss to the cent', () => {
    expect(winLossChips(392.57)).toBe('+392.57');
    expect(winLossChips(-1512.34)).toBe('-1,512.34');
    expect(winLossChips(1000)).toBe('+1,000.00');
    expect(winLossChips(0)).toBe('0.00');
    expect(winLossChips(-0.001)).toBe('0.00');
  });
});
