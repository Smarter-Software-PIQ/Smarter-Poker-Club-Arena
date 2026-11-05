import { describe, expect, it } from 'vitest';
import {
  MIDWAY_FREE_BUY_FORMATS,
  MIDWAY_FREE_BUY_SLOT_FORMATS,
  MIDWAY_FREE_BUY_UNION_ID,
  isMidwayFreeBuy,
  midwayFreeBuyPolicyFor,
  withMidwayFreeBuyPolicy,
} from './midwayFreeBuyPolicy.js';

const entry = {
  union_id: MIDWAY_FREE_BUY_UNION_ID,
  club_id: MIDWAY_FREE_BUY_UNION_ID,
  name: 'Midday Free Buy (NLH)',
  tournament_type: 'MTT',
  variant: 'freezeout',
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
const named = (name: string) => withMidwayFreeBuyPolicy({ ...entry, name });

describe('the Midway daily Free Buy rotation (owner 2026-11-04)', () => {
  it('names one format per slot, in the daily order', () => {
    expect(MIDWAY_FREE_BUY_SLOT_FORMATS).toEqual({
      'Morning Free Buy (NLH)': 'regular',
      'Midday Free Buy (NLH)': 'pko',
      'Afternoon Free Buy (NLH)': 'aiof',
      'Prime Time Free Buy (NLH)': 'mystery',
      'Midnight Free Buy (NLH)': 'pko',
    });
    expect(midwayFreeBuyPolicyFor('Night Owl Special (NLH)')).toBeNull();
  });

  it('keeps the 12:30 PM and 12:30 AM PKO exactly as published on 2026-11-02', () => {
    for (const name of ['Midday Free Buy (NLH)', 'Midnight Free Buy (NLH)']) {
      const row = named(name);
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
        addon_levels: null,
        all_in_or_fold: false,
        starting_chips: 3000,
        late_reg_levels: 12,
        rebuy_levels: 12,
        short_description:
          'Free Entry. Midway Promo Funds Your 1-Chip Bounty. 1-Chip Rebuys. No Add-Ons Or Rake. All Prizes Are Bounties: 50% To Your Wallet, 50% To Your Head. The Winner Keeps Their Bounty.',
      });
      expect(withMidwayFreeBuyPolicy(row)).toEqual(row);
    }
    expect(MIDWAY_FREE_BUY_FORMATS.pko.midwayFreeBuyFormat).toBe('promo-pko-v1');
  });

  it('runs the 8:30 AM as a regular 250 guarantee with 1-chip rebuys and add-ons', () => {
    const row = named('Morning Free Buy (NLH)');
    expect(row).toMatchObject({
      guaranteed_prize: 250,
      is_bounty: false,
      is_pko: false,
      is_mystery_bounty: false,
      bounty_amount: 0,
      buy_in_fee: 0,
      is_rebuy: true,
      is_reentry: true,
      rebuy_cost: 1,
      add_on_available: true,
      addon_from_start: true,
      addon_cost: 1,
      addon_chips: 3000,
      addon_levels: 1,
      all_in_or_fold: false,
      variant: 'freezeout',
      short_description:
        'Free Entry. Midway Promo Funds Your Entry. 250 Chip Guarantee. 1-Chip Rebuys And Add-Ons For The First Hour. No Rake.',
    });
    expect(withMidwayFreeBuyPolicy(row)).toEqual(row);
  });

  it('runs the 4:30 PM as all-in-or-fold, 500 guarantee, rebuys only', () => {
    const row = named('Afternoon Free Buy (NLH)');
    expect(row).toMatchObject({
      guaranteed_prize: 500,
      is_bounty: false,
      is_pko: false,
      is_mystery_bounty: false,
      bounty_amount: 0,
      rebuy_cost: 1,
      is_rebuy: true,
      add_on_available: false,
      addon_from_start: false,
      addon_cost: null,
      addon_chips: null,
      addon_levels: null,
      all_in_or_fold: true,
      short_description:
        'All-In Or Fold. Free Entry. Midway Promo Funds Your Entry. 500 Chip Guarantee. 1-Chip Rebuys For The First Hour. No Add-Ons Or Rake.',
    });
    expect(withMidwayFreeBuyPolicy(row)).toEqual(row);
  });

  it('runs the 8:30 PM as a 50/50 mystery bounty with rebuys and add-ons', () => {
    const row = named('Prime Time Free Buy (NLH)');
    expect(row).toMatchObject({
      guaranteed_prize: 0,
      is_bounty: true,
      is_pko: false,
      is_mystery_bounty: true,
      variant: 'mystery_bounty',
      bounty_amount: 0.5,
      mystery_bounty_pool_percent: 100,
      mystery_bounty_regular_pool_percent: 0,
      mystery_bounty_profile: 'classic',
      mystery_bounty_activation: 'at_the_money',
      mystery_bounty_min: 0.25,
      mystery_bounty_max: 5,
      mystery_bounty_top_percent: 20,
      rebuy_cost: 1,
      add_on_available: true,
      addon_from_start: true,
      addon_cost: 1,
      addon_chips: 3000,
      addon_levels: 1,
      all_in_or_fold: false,
    });
    expect(isMidwayFreeBuy(row)).toBe(true);
    expect(withMidwayFreeBuyPolicy(row)).toEqual(row);
  });

  it('every format stays a Midway Free Buy (the horse rules read isMidwayFreeBuy)', () => {
    for (const name of Object.keys(MIDWAY_FREE_BUY_SLOT_FORMATS))
      expect(isMidwayFreeBuy(named(name)), name).toBe(true);
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

describe('the persistent fixed board carries each slot its own Midway format', () => {
  it('writes the slot policy into the schedule config and stays stable after synchronization', () => {
    const club = FIXED_BOARD_CLUBS[0];
    for (const [name, key] of Object.entries(MIDWAY_FREE_BUY_SLOT_FORMATS)) {
      const event = FIXED_BOARD.find((e) => e.name === name)!;
      expect(event, name).toBeTruthy();
      const row = fixedBoardRowFor(club, event);
      expect(row.config).toMatchObject(MIDWAY_FREE_BUY_FORMATS[key]);
      expect(planFixedBoardSync([{ ...row, id: 'schedule' }], [club], [event]).updates).toEqual([]);
    }
    expect(
      fixedBoardRowFor(club, FIXED_BOARD.find((e) => e.name === 'Afternoon Free Buy (NLH)')!).config
    ).toMatchObject({ allInOrFold: true, guaranteedPrize: 500, addOnAvailable: false });
    expect(
      fixedBoardRowFor(club, FIXED_BOARD.find((e) => e.name === 'Prime Time Free Buy (NLH)')!)
        .config
    ).toMatchObject({ isMysteryBounty: true, bountyAmount: 0.5, mysteryBountyMax: 5 });
  });

  it('the 10-minute resync corrects a schedule still on the PKO, and re-activates Midnight', () => {
    const club = FIXED_BOARD_CLUBS[0];
    const morning = FIXED_BOARD.find((e) => e.name === 'Morning Free Buy (NLH)')!;
    const midday = FIXED_BOARD.find((e) => e.name === 'Midday Free Buy (NLH)')!;
    const want = fixedBoardRowFor(club, morning);
    const stale = {
      ...want,
      id: 'schedule',
      config: { ...want.config, ...MIDWAY_FREE_BUY_FORMATS.pko },
    };
    expect(planFixedBoardSync([stale], [club], [morning]).updates).toEqual([
      { id: 'schedule', row: want },
    ]);
    const midnight = FIXED_BOARD.find((e) => e.name === 'Midnight Free Buy (NLH)')!;
    const midnightRow = fixedBoardRowFor(club, midnight);
    const inactive = { ...midnightRow, active: false, id: 'b9c31f19-70df-4b5c-9e8a-04ebaa945f61' };
    const plan = planFixedBoardSync([inactive], [club], [midnight]);
    expect(plan.inserts).toEqual([]);
    expect(plan.updates).toEqual([{ id: inactive.id, row: midnightRow }]);
    expect(fixedBoardRowFor(club, midday).config).toMatchObject(MIDWAY_FREE_BUY_FORMATS.pko);
    expect(fixedBoardRowFor(FIXED_BOARD_CLUBS[1], morning).config).not.toHaveProperty(
      'midwayFreeBuyFormat'
    );
  });

  it('the Diamond Arena never gets the 12:30 AM event back', () => {
    const arena = FIXED_BOARD_CLUBS[1];
    const plan = planFixedBoardSync([], [arena]);
    expect(plan.inserts.map((r) => r.name)).not.toContain('Midnight Free Buy (NLH)');
    const old = {
      ...fixedBoardRowFor(arena, FIXED_BOARD.find((e) => e.name === 'Midnight Free Buy (NLH)')!),
      id: 'arena-midnight',
    };
    expect(planFixedBoardSync([old], [arena]).deactivate).toEqual(['arena-midnight']);
  });
});
