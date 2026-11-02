/**
 * A TOURNAMENT TABLE NEVER PAINTS AS A CASH TABLE (Dan 2026-11-02).
 *
 * After the 05:54:50 UTC engine restart, Sunday Funday Late PKO Table 2
 * re-mounted with `isTournament: false` until its row loaded. Its top seats
 * took the cash lane for that moment and jam_degen was left on the felt.
 * The table's kind is remembered per table and seeds the first paint.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  forgetTableKindsForTest,
  knownTableIsTournament,
  rememberTableIsTournament,
} from '../../src/lib/tableKindMemory';

afterEach(() => {
  forgetTableKindsForTest();
  vi.restoreAllMocks();
});

describe('table kind memory', () => {
  it('answers nothing for a table it has never seen, so the row still decides', () => {
    expect(knownTableIsTournament('never-seen')).toBeUndefined();
    expect(knownTableIsTournament(undefined)).toBeUndefined();
  });

  it('remembers a tournament table and a cash table independently', () => {
    rememberTableIsTournament('mtt-table', true);
    rememberTableIsTournament('cash-table', false);
    expect(knownTableIsTournament('mtt-table')).toBe(true);
    expect(knownTableIsTournament('cash-table')).toBe(false);
  });

  it('survives a reload in the same tab through sessionStorage', () => {
    rememberTableIsTournament('mtt-table', true);
    const stored = sessionStorage.getItem('ca:table-kind:v1');
    forgetTableKindsForTest();
    sessionStorage.setItem('ca:table-kind:v1', stored!);
    expect(knownTableIsTournament('mtt-table')).toBe(true);
  });

  it('keeps working in memory when storage throws (private window)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => rememberTableIsTournament('mtt-table', true)).not.toThrow();
    expect(knownTableIsTournament('mtt-table')).toBe(true);
  });

  it('seeds TablePage first paint and records the kind when the row loads', () => {
    const page = readFileSync(resolve(__dirname, '../../src/pages/TablePage.tsx'), 'utf8');
    expect(page).toContain('isTournament: knownTableIsTournament(tableId) ?? false,');
    expect(page.replace(/\s+/g, ' ')).toContain(
      "rememberTableIsTournament( table.id, table.game_type === 'tournament' || !!table.tournament_id );"
    );
  });
});
