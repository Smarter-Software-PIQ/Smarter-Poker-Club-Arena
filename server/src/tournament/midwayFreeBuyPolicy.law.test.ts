import { describe, expect, it } from 'vitest';
import { MIDWAY_FREE_BUY_UNION_ID, withMidwayFreeBuyPolicy } from './midwayFreeBuyPolicy.js';

const entry = {
  union_id: MIDWAY_FREE_BUY_UNION_ID,
  club_id: MIDWAY_FREE_BUY_UNION_ID,
  tournament_type: 'MTT',
  free_buy: true,
  buy_in_amount: 0,
  buy_in_fee: 0,
  guaranteed_prize: 250,
  starting_chips: 3000,
  late_reg_levels: 12,
  rebuy_levels: 12,
  add_on_available: true,
  addon_from_start: true,
};

describe('Midway promo-funded bounty-only Free Buy creation', () => {
  it('replaces a fixed guarantee and add-ons with one-chip PKO heads and rebuys', () => {
    const row = withMidwayFreeBuyPolicy(entry);
    expect(row).toMatchObject({
      buy_in_amount: 0,
      buy_in_fee: 0,
      guaranteed_prize: 0,
      is_bounty: true,
      is_pko: true,
      is_mystery_bounty: false,
      bounty_amount: 1,
      rebuy_cost: 1,
      is_rebuy: true,
      is_reentry: true,
      add_on_available: false,
      addon_from_start: false,
      addon_cost: null,
      addon_chips: null,
      starting_chips: 3000,
      late_reg_levels: 12,
      rebuy_levels: 12,
    });
    expect(entry.add_on_available).toBe(true);
    expect(withMidwayFreeBuyPolicy(row)).toEqual(row);
  });

  it.each([
    { union_id: 'other', club_id: 'diamond' },
    { free_buy: false },
    { buy_in_amount: 10 },
    { buy_in_fee: 1 },
    { tournament_type: 'SNG' },
    { variant: 'satellite' },
    { satellite_target_id: 'target' },
  ])('preserves unrelated events: %j', (overrides) => {
    const row = { ...entry, ...overrides };
    expect(withMidwayFreeBuyPolicy(row)).toBe(row);
  });
});

import {
  FIXED_BOARD,
  FIXED_BOARD_CLUBS,
  fixedBoardRowFor,
  planFixedBoardSync,
} from '../config/fixedBoard.js';

describe('the persistent fixed board carries the same Midway format', () => {
  it('replaces stale schedule economics and remains stable after synchronization', () => {
    const event = FIXED_BOARD.find((event) => event.name === 'Morning Free Buy (NLH)')!;
    const club = FIXED_BOARD_CLUBS[0];
    const row = fixedBoardRowFor(club, event);
    expect(row.config).toMatchObject({
      guaranteedPrize: 0,
      bountyAmount: 1,
      isPko: true,
      rebuyCost: 1,
      addOnAvailable: false,
      addonCost: null,
    });
    const stale = {
      ...row,
      id: 'schedule',
      config: { ...row.config, guaranteedPrize: 250, addOnAvailable: true },
    };
    expect(planFixedBoardSync([stale], [club], [event]).updates).toEqual([{ id: 'schedule', row }]);
    expect(planFixedBoardSync([{ ...row, id: 'schedule' }], [club], [event]).updates).toEqual([]);
    expect(fixedBoardRowFor(FIXED_BOARD_CLUBS[1], event).config).not.toHaveProperty(
      'midwayFreeBuyFormat'
    );
  });
});
