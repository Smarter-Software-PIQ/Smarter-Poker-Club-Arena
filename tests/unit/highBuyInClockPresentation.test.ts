import { describe, expect, it } from 'vitest';
import { blindLevelMinutes } from '../../src/components/lobby/tournamentFigures';

describe('priced level presentation matches the playable timer', () => {
  it('projects immutable Spin seconds without rewriting them', () => {
    const rows = [{ level: 1, duration: 180 }];
    expect(blindLevelMinutes(rows, 1, 50)).toBe(7);
    expect(blindLevelMinutes(rows, 1, 25)).toBe(3);
    expect(rows[0].duration).toBe(180);
  });
  it.each([7, 8, 9, 10])('preserves %s-minute levels', (minutes) => {
    expect(blindLevelMinutes([{ level: 1, durationMinutes: minutes }], 1, 50)).toBe(minutes);
  });
  it('caps oversized levels, keeps breaks, and never invents a missing clock', () => {
    expect(blindLevelMinutes([{ level: 1, durationMinutes: 15 }], 1, 50)).toBe(10);
    expect(blindLevelMinutes([{ level: 1, isBreak: true, durationMinutes: 3 }], 1, 50)).toBe(3);
    expect(blindLevelMinutes([{ level: 1 }], 1, 50)).toBe(0);
  });
});
