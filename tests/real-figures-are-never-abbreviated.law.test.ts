/**
 * REAL FIGURES ARE NEVER ROUNDED OR ABBREVIATED (Dan 2026-11-13, binding).
 *
 * Verbatim: "IN THE PLAYER MANAGEMENT OR ANYWHERE REAL DATA IS STORED. I DON'T
 * WANT ROUNDED UP NUMBERS LIKE 393 OR 1.5K OR 1K USE WHOLE NUMBERS AND DECIMALS
 * ALWAYS ... FIX THIS LOGIC GLOBALLY FOR THE POKER ARENA."
 *
 * Supersedes the 2026-09-09 "#ClubArenaConsole money: 1.2K, no decimals" rule
 * and the 2026-10-16 compact win / loss rule. Every shared figure formatter
 * prints separators and keeps the cents; no source file builds its own K/M/B.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  compactChips,
  exactChips,
  feeFigure,
  fmtChips,
  formatChips,
  formatSignedChips,
  formatWalletChips,
  formatWalletDiamonds,
  winLossChips,
} from '../src/utils/format';
import { formatWeeklyChipsForDisplay } from '../src/services/ClubWeeklyAccountingReader';
import { tournamentTabBuyInLabel } from '../src/lib/tournamentTabLabel';

const ROOT = join(__dirname, '..');

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.|\.spec\./.test(name)) out.push(path);
  }
  return out;
}

describe('real figures are never abbreviated', () => {
  it('every shared formatter prints the exact figure', () => {
    for (const f of [compactChips, exactChips, fmtChips]) {
      expect(f(1512.34)).toBe('1,512.34');
      expect(f(1500)).toBe('1,500');
      expect(f(1_000_000)).toBe('1,000,000');
      expect(f(392.57)).toBe('392.57');
    }
    expect(winLossChips(392.57)).toBe('+392.57');
    expect(winLossChips(-1512.34)).toBe('-1,512.34');
    expect(formatWalletDiamonds(2_500_000)).toBe('2,500,000');
    expect(formatWeeklyChipsForDisplay('1250.50')).toBe('1,250.50 Chips');
    expect(tournamentTabBuyInLabel(1100)).toBe('1,100');
  });

  it('keeps every stored decimal, never silently rounding to two places', () => {
    // Columns such as chip_ledger.pre_from_balance and club_members.held_chips
    // are unconstrained numeric, so a third or fourth place is real data.
    expect(exactChips(1.234)).toBe('1.234');
    expect(exactChips(0.005)).toBe('0.005');
    expect(exactChips(-12345.6789)).toBe('-12,345.6789');
    expect(exactChips(1234567.5)).toBe('1,234,567.50');
    expect(exactChips(9_999_999_999.99)).toBe('9,999,999,999.99');
    expect(exactChips(0.1 + 0.2)).toBe('0.30'); // float noise is not data
    expect(exactChips(0)).toBe('0');
    expect(exactChips(-0)).toBe('0');
    expect(winLossChips(0.125)).toBe('+0.125');
    expect(winLossChips(-0.005)).toBe('-0.005');
    expect(winLossChips(0)).toBe('0.00');
    expect(feeFigure(740.175)).toBe('740.175');
    expect(feeFigure(740.17)).toBe('740.17');
    expect(feeFigure(-12.5)).toBe('-12.50');
    expect(formatWalletChips(2131)).toBe('2,131.00');
    expect(formatWalletChips(2131.0005)).toBe('2,131.0005');
    expect(formatChips(1711.5)).toBe('1,711.50');
    expect(formatChips(1711.505)).toBe('1,711.505');
    expect(formatSignedChips(-2183.7)).toBe('-2,183.70');
    expect(formatSignedChips(0.001)).toBe('+0.001');
  });

  it('no source file builds a K / M / B suffix from a divided figure', () => {
    const offenders: string[] = [];
    const suffix = /\/\s*1_?000(?:_?000){0,2}\b[^\n]{0,80}\}\s*[kKMB]\s*[`'"]/;
    for (const file of sources(join(ROOT, 'src'))) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (suffix.test(line)) offenders.push(`${relative(ROOT, file)}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
