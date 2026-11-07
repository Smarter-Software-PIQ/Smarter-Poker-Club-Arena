/**
 * THE PENDING HOUSE SHARE IS ONE RULE (2026-11-07). Every projected ladder
 * adds the same number to the places pool before pricing a guaranteed
 * minimum: house_due when the database says it, otherwise the whole
 * obligation less what the house already posted, never below zero, and zero
 * when the funding read is unavailable.
 */
import { describe, expect, it } from 'vitest';
import { pendingHouseShare } from '../../src/utils/tournamentPrizeFunding';

describe('pendingHouseShare', () => {
  it('is house_due when the database answers it', () => {
    expect(
      pendingHouseShare({ overlay: 660, houseRequired: 660, housePosted: 0, houseDue: 660 })
    ).toBe(660);
    // The database's answer wins over the arithmetic.
    expect(
      pendingHouseShare({ overlay: 660, houseRequired: 660, housePosted: 0, houseDue: 95 })
    ).toBe(95);
  });

  it('a Free Buy adds only what the house has not yet posted (95, never 250)', () => {
    expect(
      pendingHouseShare({ overlay: 0, houseRequired: 250, housePosted: 155, houseDue: null })
    ).toBe(95);
  });

  it('falls back to the overlay when the row predates house_required', () => {
    expect(
      pendingHouseShare({ overlay: 720, houseRequired: null, housePosted: null, houseDue: null })
    ).toBe(720);
  });

  it('never goes below zero', () => {
    expect(
      pendingHouseShare({ overlay: 0, houseRequired: 100, housePosted: 250, houseDue: null })
    ).toBe(0);
    expect(pendingHouseShare({ overlay: 0, houseRequired: 0, housePosted: 0, houseDue: -5 })).toBe(
      0
    );
  });

  it('is zero when the funding read is unavailable', () => {
    expect(pendingHouseShare(null)).toBe(0);
    expect(pendingHouseShare(undefined)).toBe(0);
  });
});
