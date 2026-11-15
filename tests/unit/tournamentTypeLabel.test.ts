import { describe, expect, it } from 'vitest';
import { tournamentTypeLabel } from '../../src/utils/tournamentTypeLabel';

const freeBuy = {
  name: 'Afternoon Free Buy (NLH)',
  tournament_type: 'MTT',
  format_contract: 'mtt-v1',
  variant: null,
  satellite_target_id: null,
  satellite_target: null,
  is_bounty: false,
  is_pko: false,
  is_mystery_bounty: false,
  is_rebuy: true,
  is_reentry: true,
  add_on_available: false,
};

describe('felt tournament type line (Dan 2026-11-05)', () => {
  it('names every Free Buy schedule slot by its real prize style', () => {
    expect(tournamentTypeLabel(freeBuy)).toBe('Rebuy');
    expect(
      tournamentTypeLabel({
        ...freeBuy,
        name: 'Midday Free Buy (NLH)',
        is_bounty: true,
        is_pko: true,
      })
    ).toBe('Progressive Knockout · Rebuy');
    expect(
      tournamentTypeLabel({
        ...freeBuy,
        name: 'Prime Time Free Buy (NLH)',
        is_bounty: true,
        is_mystery_bounty: true,
        add_on_available: true,
      })
    ).toBe('Mystery Bounty · Rebuy + Add-On');
    expect(tournamentTypeLabel({ ...freeBuy, add_on_available: true })).toBe('Rebuy + Add-On');
  });

  it('columns outrank the title and an ordinary bounty is a Bounty Event', () => {
    expect(tournamentTypeLabel({ ...freeBuy, name: 'Mystery PKO Night' })).toBe('Rebuy');
    expect(tournamentTypeLabel({ ...freeBuy, is_bounty: true })).toBe('Bounty · Rebuy');
  });

  it('a satellite is a Satellite Event; entry terms follow the engine rule', () => {
    expect(
      tournamentTypeLabel({
        ...freeBuy,
        satellite_target_id: 'x',
        is_rebuy: false,
        is_reentry: false,
      })
    ).toBe('Satellite Event · Freezeout');
    expect(tournamentTypeLabel({ ...freeBuy, is_rebuy: false })).toBe('Re-Entry');
  });

  it('prints the approved Free Buy format from tournament settings', () => {
    expect(tournamentTypeLabel({ ...freeBuy, all_in_or_fold: true, blind_speed: 'turbo' })).toBe(
      'All-In or Fold · Turbo · Rebuy'
    );
  });

  it('prints nothing it cannot read', () => {
    expect(tournamentTypeLabel(null)).toBeNull();
    expect(tournamentTypeLabel({})).toBeNull();
  });
});
