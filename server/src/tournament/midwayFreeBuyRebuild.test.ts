import { describe, expect, it } from 'vitest';
import {
  MIDWAY_FREE_BUY_FORMATS,
  MIDWAY_FREE_BUY_REBUILD_MIN_LEAD_MS,
  midwayFreeBuyRowFormat,
  midwayFreeBuySlotFormatOf,
  shouldRebuildMidwayOccurrence,
  withMidwayFreeBuyPolicy,
} from './midwayFreeBuyPolicy.js';

// Owner 2026-11-05: a built event must match its schedule. These pin the
// engine's courtesy copy of fn_ca_midway_free_buy_format and the rebuild
// predicate the scheduler applies before it asks the database.
const NOW = Date.parse('2026-11-06T00:45:00Z');
const in2h = new Date(NOW + 2 * 60 * 60_000).toISOString();
const pkoRow = {
  is_pko: true,
  is_bounty: true,
  is_mystery_bounty: false,
  all_in_or_fold: false,
  bounty_amount: '1.00',
  guaranteed_prize: '0.00',
};
const mysterySchedule = { ...MIDWAY_FREE_BUY_FORMATS.mystery };

describe('a built Midway Free Buy matches its schedule', () => {
  it('reads each schedule format the slot builder writes', () => {
    expect(midwayFreeBuySlotFormatOf(MIDWAY_FREE_BUY_FORMATS.pko)).toBe('pko');
    expect(midwayFreeBuySlotFormatOf(MIDWAY_FREE_BUY_FORMATS.regular)).toBe('regular');
    expect(midwayFreeBuySlotFormatOf(MIDWAY_FREE_BUY_FORMATS.aiof)).toBe('aiof');
    expect(midwayFreeBuySlotFormatOf(mysterySchedule)).toBe('mystery');
    expect(midwayFreeBuySlotFormatOf({ type: 'fixed_board' })).toBeNull();
    expect(midwayFreeBuySlotFormatOf(null)).toBeNull();
  });

  it('classifies every row the policy builds as its own format', () => {
    for (const name of [
      'Morning Free Buy (NLH)',
      'Midday Free Buy (NLH)',
      'Afternoon Free Buy (NLH)',
      'Prime Time Free Buy (NLH)',
      'Midnight Free Buy (NLH)',
    ]) {
      const row = withMidwayFreeBuyPolicy<Record<string, unknown>>({
        name,
        union_id: 'fade0000-0000-0000-0000-000000000001',
        club_id: 'fade0000-0000-0000-0000-000000000001',
        tournament_type: 'MTT',
        free_buy: true,
        buy_in_amount: 0,
        buy_in_fee: 0,
      });
      const expected = {
        'Morning Free Buy (NLH)': 'regular',
        'Midday Free Buy (NLH)': 'pko',
        'Afternoon Free Buy (NLH)': 'aiof',
        'Prime Time Free Buy (NLH)': 'mystery',
        'Midnight Free Buy (NLH)': 'pko',
      }[name];
      expect(midwayFreeBuyRowFormat(row)).toBe(expected);
    }
  });

  it('rebuilds an unstarted PKO built where the schedule names a mystery bounty', () => {
    expect(
      shouldRebuildMidwayOccurrence(
        mysterySchedule,
        { ...pkoRow, status: 'REGISTERING', start_time: in2h, started_at: null },
        NOW
      )
    ).toBe(true);
  });

  it('leaves a matching, started, finalized, late or unscheduled event as built', () => {
    const base = { ...pkoRow, status: 'REGISTERING', start_time: in2h, started_at: null };
    expect(shouldRebuildMidwayOccurrence(MIDWAY_FREE_BUY_FORMATS.pko, base, NOW)).toBe(false);
    expect(
      shouldRebuildMidwayOccurrence(mysterySchedule, { ...base, status: 'RUNNING' }, NOW)
    ).toBe(false);
    expect(shouldRebuildMidwayOccurrence(mysterySchedule, { ...base, started_at: in2h }, NOW)).toBe(
      false
    );
    expect(
      shouldRebuildMidwayOccurrence(mysterySchedule, { ...base, prize_pool_finalized: true }, NOW)
    ).toBe(false);
    const late = new Date(NOW + MIDWAY_FREE_BUY_REBUILD_MIN_LEAD_MS).toISOString();
    expect(shouldRebuildMidwayOccurrence(mysterySchedule, { ...base, start_time: late }, NOW)).toBe(
      false
    );
    expect(shouldRebuildMidwayOccurrence({ type: 'fixed_board' }, base, NOW)).toBe(false);
  });

  it('treats a PKO with a guarantee as no format, and so as not matching its slot', () => {
    const row = { ...pkoRow, guaranteed_prize: 250 };
    expect(midwayFreeBuyRowFormat(row)).toBeNull();
    expect(
      shouldRebuildMidwayOccurrence(
        MIDWAY_FREE_BUY_FORMATS.pko,
        { ...row, status: 'REGISTERING', start_time: in2h },
        NOW
      )
    ).toBe(true);
  });
});
