import { describe, expect, it } from 'vitest';
import { tournamentEntryTerms } from '../../src/components/tournament/details/entryTerms';
import { CHIP_UNIT_CENTS, DIAMOND_UNIT_CENTS } from '../../server/src/tournament/tournamentUnit';
import type { Tournament } from '../../src/types/database.types';

const now = Date.parse('2026-11-01T02:30:00Z');
const row = (over: Record<string, unknown> = {}) =>
  ({
    status: 'RUNNING',
    current_level: 6,
    late_reg_levels: 9,
    late_reg_mins: 72,
    started_at: '2026-11-01T01:30:00Z',
    level_started_at: '2026-11-01T02:28:00Z',
    blind_structure: JSON.stringify(
      Array.from({ length: 10 }, () => ({
        duration: 480,
        small_blind: 50,
        big_blind: 100,
      }))
    ),
    add_on_available: true,
    addon_cost: 30,
    addon_chips: 50000,
    addon_break_minutes: 1,
    ...over,
  }) as Tournament;

describe('tournament Details entry terms', () => {
  it('shows the actual paid add-on price, stack and timed break instead of an invented level window', () => {
    const result = tournamentEntryTerms(row(), now, CHIP_UNIT_CENTS);
    expect(result).toMatchObject({ addon: 'Yes', cost: '30 Chips', stack: '50,000 Chips' });
    expect(result.timing).toBe('After The Last Entry Level And Current Hands Finish · 1 Min Break');
    expect(result.lateRegistration).toBe('Through The End Of The 60-Second Add-On Period');
    expect(tournamentEntryTerms(row(), now, CHIP_UNIT_CENTS, true).lateRegistration).not.toContain(
      'Estimated'
    );
  });
  it('says No and omits price/window when add-ons are disabled', () => {
    expect(tournamentEntryTerms(row({ add_on_available: false }), now, CHIP_UNIT_CENTS)).toEqual({
      addon: 'No',
      lateRegistration: expect.any(String),
    });
  });
  it('remains open past level and clock bounds until the add-on ends', () => {
    expect(
      tournamentEntryTerms(row(), now + 12 * 60000, CHIP_UNIT_CENTS).lateRegistration
    ).not.toMatch(/^Closed/);
    expect(
      tournamentEntryTerms(row({ current_level: 9 }), now, CHIP_UNIT_CENTS).lateRegistration
    ).not.toMatch(/^Closed/);
  });
  it('does not advertise an estimated wall clock during a break or with missing level data', () => {
    for (const over of [{ on_break: true }, { level_started_at: null }, { status: 'ANNOUNCED' }]) {
      expect(tournamentEntryTerms(row(over), now, CHIP_UNIT_CENTS).lateRegistration).not.toContain(
        'Estimated'
      );
    }
  });
  it('uses recorded add-on dates and changes Open Now to Ended at the exact boundary', () => {
    const t = row({
      addon_period_started_at: new Date(now).toISOString(),
      addon_period_ends_at: new Date(now + 60000).toISOString(),
    });
    expect(tournamentEntryTerms(t, now - 1, CHIP_UNIT_CENTS).timing).toMatch(/^Scheduled/);
    expect(tournamentEntryTerms(t, now, CHIP_UNIT_CENTS).timing).toMatch(/^Open Now/);
    expect(tournamentEntryTerms(t, now + 60000, CHIP_UNIT_CENTS).timing).toMatch(/^Ended/);
  });
  it('shows Free Buy seating availability, configured duration and Diamond cost', () => {
    const result = tournamentEntryTerms(
      row({ addon_from_start: true, addon_break_minutes: 5, addon_cost: 100 }),
      now,
      DIAMOND_UNIT_CENTS
    );
    expect(result.timing).toBe('After The Last Entry Level And Current Hands Finish · 1 Min Break');
    expect(result.cost).toBe('100 Diamonds');
    expect(result.stack).toBe('50,000 Chips');
  });
  it('preserves purchase fallback and marks finished or finalized windows closed', () => {
    expect(
      tournamentEntryTerms(row({ addon_cost: 0, buy_in_amount: 27 }), now, CHIP_UNIT_CENTS).cost
    ).toBe('27 Chips');
    for (const over of [
      { status: 'COMPLETED' },
      { status: 'CANCELLED' },
      { prize_pool_finalized: true },
    ]) {
      const result = tournamentEntryTerms(row(over), now, CHIP_UNIT_CENTS);
      expect(result.lateRegistration).toMatch(/^Closed/);
      expect(result.timing).toBe('Closed');
    }
  });
});
