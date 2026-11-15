import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { RAKE_SPEC, capsByPlayersDealt } from '../../server/src/config/rakeSpec';
import { chipPrices, groupByStakes } from '../../src/components/bbj/BBJRakeSchedule';
vi.mock('../../src/lib/supabase', () => ({ supabase: {} }));
const { rules } = RAKE_SPEC;
const brackets = {
  hu_percent: rules.headsUpPercent,
  hu_factor: rules.headsUpCapFactor,
  short_factor: rules.shortHandedCapFactor,
  short_seats: rules.shortHandedMinSeats,
  short_players: rules.shortHandedMaxPlayers,
};

describe('BBJ cash game rake schedule', () => {
  it('opens immediately after Qualifying Hands', () => {
    const modal = readFileSync('src/components/bbj/BBJInfoModal.tsx', 'utf8');
    expect(modal).toMatch(/label: 'Qualifying Hands' },\s*\{ key: 'rake', label: 'Rake Schedule'/);
    expect(modal).toMatch(/tab === 'rake' && \(?(?:\s*)<BBJRakeSchedule/);
  });
  it('lists each blind pair once while retaining distinct prices at that stake', () => {
    const first = { sb: 1, bb: 2, dealt: '3', rate: 10, cap: 5, seats: 6 };
    const { stakes, brackets } = groupByStakes([
      first,
      first,
      { ...first, seats: 8 },
      { ...first, seats: 9, cap: 3.75 },
      { ...first, dealt: '2', rate: 5, cap: 2.5 },
      { ...first, sb: 0.5 },
      { ...first, sb: null, bb: 50, dealt: '4+' },
    ]);
    expect(stakes.map(({ sb, bb }) => [sb, bb])).toEqual([
      [0.5, 2],
      [1, 2],
      [null, 50],
    ]);
    expect(brackets).toEqual(['2', '3', '4+']);
    expect(stakes[1].prices.get('3')).toEqual(
      new Map([
        ['10% / 5', new Set([6, 8])],
        ['10% / 3.75', new Set([9])],
      ])
    );
    expect(stakes[1].prices.get('2')?.size).toBe(1);
  });
  it.each([2, 3, 6, 9])('matches engine caps and heads-up limits for %i seats', (seats) => {
    for (const rate of [0, 3, 10])
      for (const cap of [0, 0.15, 1.25, 5]) {
        const expected = capsByPlayersDealt(cap, seats).filter((row) => row.players <= seats);
        expect(
          chipPrices(rate, cap, seats, brackets).map((row) => [row.minimum, row.rate, row.cap])
        ).toEqual(
          expected.map((row) => [
            row.players,
            row.players === 2 ? Math.min(rate, rules.headsUpPercent) : rate,
            row.cap,
          ])
        );
      }
  });
});
