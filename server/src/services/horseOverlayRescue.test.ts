import { describe, expect, it } from 'vitest';
import { horseOverlayRescueDue, horseOverlayRescueEntries } from './horseOverlayRescue.js';

const now = Date.parse('2026-11-08T03:30:00Z');
const base = {
  started_at: new Date(now - 90 * 60_000).toISOString(),
  late_reg_mins: 0,
  late_reg_levels: 12,
  rebuy_levels: 0,
  current_level: 9,
  level_started_at: new Date(now - 4 * 60_000).toISOString(),
  blind_structure: Array.from({ length: 12 }, () => ({ durationMinutes: 8 })),
};
describe('final twenty-minute net overlay rescue (owner 2026-11-13; was ten)', () => {
  it('runs at twenty minutes remaining, beyond the old thirty-minute horizon', () => {
    expect(horseOverlayRescueDue(base, now)).toBe(true);
    expect(
      horseOverlayRescueDue(
        { ...base, level_started_at: new Date(now - 239_999).toISOString() },
        now
      )
    ).toBe(false);
  });
  it('uses the paused level clock and the earliest configured deadline', () => {
    expect(horseOverlayRescueDue({ ...base, on_break: true }, now)).toBe(false);
    expect(
      horseOverlayRescueDue(
        { ...base, on_break: true, break_started_at: new Date(now).toISOString() },
        now + 5 * 60_000
      )
    ).toBe(true);
    expect(horseOverlayRescueDue({ ...base, on_break: true, late_reg_mins: 100 }, now)).toBe(true);
  });
  it('starts twenty minutes before the estimated final add-on cutoff', () => {
    const addOn = { ...base, add_on_available: true, late_reg_mins: 90 };
    expect(horseOverlayRescueDue(addOn, now)).toBe(false);
    expect(horseOverlayRescueDue(addOn, now + 59_999)).toBe(false);
    expect(horseOverlayRescueDue(addOn, now + 60_000)).toBe(true);
    expect(horseOverlayRescueDue({ ...addOn, current_level: 12 }, now)).toBe(true);
    expect(horseOverlayRescueDue({ ...addOn, late_reg_levels: 0, late_reg_mins: 99 }, now)).toBe(
      true
    );
  });
  it('ignores a legacy early offer and uses the actual closing minute once stamped', () => {
    const addOn = {
      ...base,
      add_on_available: true,
      addon_from_start: true,
      addon_period_started_at: base.started_at,
      addon_period_ends_at: new Date(now + 20 * 60_000).toISOString(),
    };
    expect(horseOverlayRescueDue(addOn, now)).toBe(false);
    expect(horseOverlayRescueDue(addOn, now + 60_000)).toBe(true);
    expect(
      horseOverlayRescueDue(
        {
          ...addOn,
          addon_period_started_at: new Date(now).toISOString(),
          addon_period_ends_at: new Date(now + 60_000).toISOString(),
        },
        now
      )
    ).toBe(true);
  });
  it('uses the actual add-on cutoff while that controls admission', () => {
    expect(horseOverlayRescueDue({ ...base, add_on_available: true }, now)).toBe(false);
    expect(
      horseOverlayRescueDue(
        {
          ...base,
          add_on_available: true,
          addon_period_ends_at: new Date(now + 600_000).toISOString(),
        },
        now
      )
    ).toBe(true);
  });
  it('the observed 67 entries require three more net 36-chip entries, regardless of house funding', () => {
    expect(
      horseOverlayRescueEntries({ guarantee: 2500, net_coverage: 2412, house_posted: 88 }, 36)
    ).toBe(3);
    expect(horseOverlayRescueEntries({ guarantee: 2500, net_coverage: 2520 }, 36)).toBe(0);
  });
  it('does not turn an unreadable funding response into invented capacity', () => {
    for (const funding of [null, true, {}, { guarantee: 2500, net_coverage: null }])
      expect(() => horseOverlayRescueEntries(funding, 36)).toThrow();
  });
});
