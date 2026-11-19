import { describe, expect, it } from 'vitest';
import {
  clusterTableRole,
  isFeederTable,
  isMainTable,
  seatMoveDestinationLabel,
} from '../../src/utils/clusterTableRole';

/** Live production rows, Midway union, 2026-11-19 (tables.name / role / main_index). */
const PROD = [
  { name: 'NLH 0.50/1 Classic', role: 'main', main_index: 1 },
  { name: 'PLO4 0.50/1 Classic Main 2', role: 'main', main_index: 2 },
  { name: 'PLO4 1.00/2.00 Lightning Games', role: 'main', main_index: 1 },
  { name: 'PLO6 0.50/1 Classic Feeder', role: 'feeder', main_index: null },
  { name: 'PLO5 1.00/2.00 Lightning Games', role: 'feeder', main_index: null },
  { name: 'NLH 1.00/2.00', role: null, main_index: null },
] as const;

/** The rule this module replaced: the table's NAME decides. */
const byName = (name: string) => /\bmain(?:\s*\d+)?\b/i.test(name);

describe('cluster table role comes from tables.role', () => {
  it('classifies every production row by its recorded role', () => {
    expect(PROD.map((row) => clusterTableRole(row))).toEqual([
      'main',
      'main',
      'main',
      'feeder',
      'feeder',
      null,
    ]);
    expect(PROD.filter(isMainTable).map((r) => r.name)).toEqual([
      'NLH 0.50/1 Classic',
      'PLO4 0.50/1 Classic Main 2',
      'PLO4 1.00/2.00 Lightning Games',
    ]);
    expect(PROD.filter(isFeederTable)).toHaveLength(2);
  });

  it('the name-based rule misclassifies the same rows (why it was replaced)', () => {
    expect(PROD.map((row) => byName(row.name))).not.toEqual(PROD.map((row) => isMainTable(row)));
    expect(byName('NLH 0.50/1 Classic')).toBe(false);
  });

  it('a renamed table keeps its role', () => {
    const main = { name: 'NLH 0.50/1 Classic', role: 'main' };
    for (const name of ['Main 1', 'Friday Night Game', 'Feeder', ''])
      expect(isMainTable({ ...main, name })).toBe(true);
    const feeder = { name: 'PLO4 0.25/0.50 Classic Feeder', role: 'feeder' };
    for (const name of ['Main 3', 'Main', 'NLH Main Event'])
      expect(isMainTable({ ...feeder, name })).toBe(false);
  });

  it('ignores anything that is not a recorded role', () => {
    for (const role of [undefined, null, '', 'Main', 'MAIN', 'lightning', 1])
      expect(clusterTableRole({ role })).toBeNull();
    expect(clusterTableRole(null)).toBeNull();
    expect(clusterTableRole(undefined)).toBeNull();
  });
});

describe('seat-move destination label', () => {
  it('a main is The Main Game whatever its name and whatever the reason', () => {
    for (const reason of ['must_move', 'break', 'balance', 'seat_change'])
      for (const { name } of PROD.slice(0, 3))
        expect(seatMoveDestinationLabel(reason, { name, role: 'main' })).toBe('The Main Game');
  });
  it('any other table is named, even when its name says Main', () => {
    expect(seatMoveDestinationLabel('seat_change', { name: ' Main 3 ', role: 'feeder' })).toBe(
      'Main 3'
    );
    expect(seatMoveDestinationLabel('balance', { name: 'NLH 1.00/2.00', role: null })).toBe(
      'NLH 1.00/2.00'
    );
    expect(seatMoveDestinationLabel('must_move', { name: 'X Feeder', role: 'feeder' })).toBe(
      'X Feeder'
    );
  });
  it('falls back on the reason only when the role is unknown', () => {
    expect(seatMoveDestinationLabel('must_move', null)).toBe('The Main Game');
    expect(seatMoveDestinationLabel('must_move', { name: 'Unread' })).toBe('The Main Game');
    expect(seatMoveDestinationLabel('seat_change', null)).toBe('Another Table');
    expect(seatMoveDestinationLabel('seat_change', { name: '  ', role: 'feeder' })).toBe(
      'Another Table'
    );
  });
});
