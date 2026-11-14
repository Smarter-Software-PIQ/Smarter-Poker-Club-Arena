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
  fmtChips,
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
