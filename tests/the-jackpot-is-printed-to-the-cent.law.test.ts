/**
 * LAW: the Bad Beat Jackpot is printed to the cent.
 * ═══════════════════════════════════════════════════════════════════════════
 * Dan, 2026-11-09, verbatim: "for the bbj display the full amount down to the
 * decimal and the exact amounts for the payouts... no rounded numbers. use
 * exact numbers 100% of the time."
 *
 * What shipped before it: the jackpot popup printed a 5,022.37 payout as "5K"
 * and the 2,511.18 the bad beat hand received as "+2.5K" (compactChips), its
 * header cut a 15,379.83 pool to "15,379" (Math.trunc), and the rules and
 * stakes tables rounded every projected payout to a whole chip (Math.round).
 * Every one of those amounts is stored to the cent; only the display lost it.
 *
 * This later, narrower instruction takes the jackpot out of the 2026-09-09
 * forward-facing compact rule. `compactChips` still governs the surfaces it
 * was written for; it may not come back to a jackpot surface.
 *
 * Diamonds are whole by custody, so the Diamond readouts are already exact and
 * are not scanned here.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  jackpotChips,
  jackpotPercent,
  jackpotSplit,
  jackpotTotalAtPercent,
} from '../src/utils/jackpotExact';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/** Every surface that prints a chip jackpot amount. */
const CHIP_SURFACES = [
  'src/components/bbj/BBJInfoModal.tsx',
  'src/components/bbj/BBJRecentHits.tsx',
  'src/components/bbj/BBJBasicPanel.tsx',
  'src/components/bbj/BBJRulesPanel.tsx',
  'src/components/bbj/BBJThresholdPanel.tsx',
  'src/components/bbj/BBJMiniPanel.tsx',
  'src/components/bbj/BBJAdminAnalytics.tsx',
  'src/components/bbj/BBJHandDetail.tsx',
  'src/components/table/BadBeatJackpot.tsx',
  'src/pages/BadBeatJackpotPage.tsx',
];

/** Strip comments so a sentence ABOUT the old formatter cannot trip the scan. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the formatter', () => {
  it('prints the stored amount with separators and both decimals', () => {
    expect(jackpotChips(15379.83)).toBe('15,379.83');
    expect(jackpotChips(5022.37)).toBe('5,022.37');
    expect(jackpotChips(2511.18)).toBe('2,511.18');
    expect(jackpotChips('644442.92')).toBe('644,442.92');
    expect(jackpotChips(700)).toBe('700.00');
    expect(jackpotChips(0)).toBe('0.00');
  });

  it('never abbreviates, however large the pool', () => {
    expect(jackpotChips(185291.65)).toBe('185,291.65');
    expect(jackpotChips(1234567.89)).toBe('1,234,567.89');
    expect(jackpotChips(1234567.89)).not.toMatch(/[KMB]/);
  });

  it('survives a payload that is not a number', () => {
    expect(jackpotChips(null)).toBe('0.00');
    expect(jackpotChips(undefined)).toBe('0.00');
    expect(jackpotChips(Number.NaN)).toBe('0.00');
  });

  it('prints a percentage as it is', () => {
    expect(jackpotPercent(10)).toBe('10');
    expect(jackpotPercent(12.5)).toBe('12.5');
    expect(jackpotPercent(0.1 * 100)).toBe('10');
    expect(jackpotPercent(15.3798)).toBe('15.38');
  });
});

describe('a projected payout uses the arithmetic the payout uses', () => {
  /* bbj_atomic_payout_v2: total = ROUND(main * pct / 100, 2); bad beat =
     ROUND(total * 0.50, 2); hand winner = ROUND(total * 0.25, 2); the table
     takes the rest. The figures below are production payout ad64a2d1 (2026-11-09,
     5,022.37) before its table share was divided between the four dealt in. */
  const SPLIT = { loser: 0.5, winner: 0.25 };

  it('splits a total to the cent and the three shares add back to it', () => {
    const s = jackpotSplit(5022.37, SPLIT);
    expect(s).toEqual({ loser: 2511.19, winner: 1255.59, table: 1255.59 });
    expect(Math.round((s.loser + s.winner + s.table) * 100)).toBe(502237);
  });

  it('keeps an even total even', () => {
    expect(jackpotSplit(425, SPLIT)).toEqual({ loser: 212.5, winner: 106.25, table: 106.25 });
    expect(jackpotSplit(700, SPLIT)).toEqual({ loser: 350, winner: 175, table: 175 });
  });

  it('takes a tier percentage of the pool to the cent, half away from zero', () => {
    expect(jackpotTotalAtPercent(15379.83, 40)).toBe(6151.93);
    expect(jackpotTotalAtPercent(15379.83, 15)).toBe(2306.97);
    expect(jackpotTotalAtPercent(100.01, 50)).toBe(50.01);
    expect(jackpotTotalAtPercent(0, 40)).toBe(0);
  });

  it('never drifts off the cent on a float', () => {
    for (const pool of [0.07, 1.15, 15379.83, 185291.65, 999999.99]) {
      for (const pct of [15, 25, 40, 55, 70, 85]) {
        const total = jackpotTotalAtPercent(pool, pct);
        expect(Number.isInteger(Math.round(total * 100))).toBe(true);
        expect(total.toFixed(2)).toBe(String(Number(total.toFixed(2)).toFixed(2)));
        const s = jackpotSplit(total, SPLIT);
        expect(Math.round((s.loser + s.winner + s.table) * 100)).toBe(Math.round(total * 100));
      }
    }
  });
});

describe('no jackpot surface rounds or abbreviates a chip amount', () => {
  it.each(CHIP_SURFACES)('%s has no compact or abbreviating formatter', (file) => {
    const src = code(read(file));
    expect(src).not.toMatch(/\bcompactChips\b/);
    expect(src).not.toMatch(/\bfmtChips\b/);
  });

  it.each(CHIP_SURFACES)('%s never formats a chip amount to zero decimals', (file) => {
    expect(code(read(file))).not.toMatch(/\bmoney\([^()]*(\([^()]*\)[^()]*)*,\s*0\)/);
  });

  it.each(CHIP_SURFACES.filter((f) => !f.endsWith('table/BadBeatJackpot.tsx')))(
    '%s never rounds an amount on its way to the screen',
    (file) => {
      const src = code(read(file));
      /* The Diamond branches (whole by custody) live in BadBeatJackpot.tsx and
         the Diamond components; none of these files has one. */
      expect(src).not.toMatch(/Math\.(round|trunc|floor|ceil)\([^;\n]*\)\s*\.toLocaleString/);
    }
  );

  it('the popup header, the winner rows and the plates read the exact formatter', () => {
    const modal = read('src/components/bbj/BBJInfoModal.tsx');
    expect(modal).toContain(': jackpotChips(poolAmount);');
    expect(modal).toContain('? jackpotChips(miniTier.amount)');

    const hits = read('src/components/bbj/BBJRecentHits.tsx');
    expect(hits).toContain('amount >= 0 ? jackpotChips(amount)');
    expect(hits).toContain('share >= 0 ? `+${jackpotChips(share)}`');

    const plate = read('src/components/table/BadBeatJackpot.tsx');
    expect(plate).toContain(': jackpotChips(Math.trunc(displayAmount * 100) / 100)}');
    expect(plate).toContain(': jackpotChips(miniAmount)}');
    expect(plate).not.toContain('displayAmount >= 1000');

    const page = read('src/pages/BadBeatJackpotPage.tsx');
    expect(page).toContain('value={jackpotChips(jackpot?.main_balance)}');
  });

  it('the union pages print the jackpot banks to the cent too', () => {
    expect(code(read('src/pages/UnionGamesPage.tsx'))).not.toMatch(/fmtChips\(bbjPool/);
    expect(code(read('src/pages/UnionDashboardPage.tsx'))).not.toMatch(/\bfmt\(bbjPool/);
  });
});
