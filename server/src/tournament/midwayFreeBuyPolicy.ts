/** THE MIDWAY UNION'S DAILY FREE BUY ROTATION (owner rulings 2026-11-02 and
 * 2026-11-04). Five Free Buys a day, each with its own format:
 *
 *   08:30 Morning     regular  250 guarantee, 1-chip rebuys and add-ons
 *   12:30 Midday      pko      promo-funded 1-chip PKO heads, 1-chip rebuys
 *   16:30 Afternoon   aiof     all-in-or-fold, 500 guarantee, 1-chip rebuys
 *   20:30 Prime Time  mystery  every chip splits 0.50 bounty / 0.50 prize pool
 *   00:30 Midnight    pko      same as Midday
 *
 * Midway funds every free initial one-chip entry from its promo wallet; every
 * rebuy and add-on is the player's own chip and goes to the event's pools. No
 * entry rake. Funding belongs to registration's atomic database transaction,
 * never to this creation-time policy. Rebuys (and add-ons, where offered) run
 * for the first hour: late registration, plus the one add-on break. */
export const MIDWAY_FREE_BUY_UNION_ID = 'fade0000-0000-0000-0000-000000000001';

export type MidwayFreeBuyFormatKey = 'regular' | 'pko' | 'aiof' | 'mystery';

const ENTRY = {
  buyIn: 0,
  buyInFee: 0,
  isRebuy: true,
  isReentry: true,
  rebuyCost: 1,
} as const;

/** One add-on of the starting stack, open from sit-down through the add-on
 * break at the end of the first hour (addon_levels 1 past late registration). */
const ADD_ON = {
  addOnAvailable: true,
  addonFromStart: true,
  addonCost: 1,
  addonChips: 3000,
  addonLevels: 1,
} as const;

const NO_ADD_ON = {
  addOnAvailable: false,
  addonFromStart: false,
  addonCost: null,
  addonChips: null,
  addonLevels: null,
} as const;

const NO_BOUNTY = {
  isBounty: false,
  isPko: false,
  isMysteryBounty: false,
  bountyAmount: 0,
} as const;

/** The 2026-11-02 promo-funded PKO, unchanged (Midday and Midnight). */
export const MIDWAY_FREE_BUY_SCHEDULE_POLICY = {
  midwayFreeBuyFormat: 'promo-pko-v1',
  ...ENTRY,
  guaranteedPrize: 0,
  isBounty: true,
  isPko: true,
  isMysteryBounty: false,
  bountyAmount: 1,
  ...NO_ADD_ON,
} as const;

/** The tournament_schedules.config keys each format writes (camelCase, as the
 * scheduler reads them) and the board sync compares. */
export const MIDWAY_FREE_BUY_FORMATS = {
  regular: {
    midwayFreeBuyFormat: 'midway-free-buy-regular-v1',
    ...ENTRY,
    guaranteedPrize: 250,
    ...NO_BOUNTY,
    ...ADD_ON,
    allInOrFold: false,
  },
  pko: MIDWAY_FREE_BUY_SCHEDULE_POLICY,
  aiof: {
    midwayFreeBuyFormat: 'midway-free-buy-aiof-v1',
    ...ENTRY,
    guaranteedPrize: 500,
    ...NO_BOUNTY,
    ...NO_ADD_ON,
    allInOrFold: true,
  },
  mystery: {
    midwayFreeBuyFormat: 'midway-free-buy-mystery-v1',
    ...ENTRY,
    guaranteedPrize: 0,
    isBounty: true,
    isPko: false,
    isMysteryBounty: true,
    variant: 'mystery_bounty',
    bountyAmount: 0.5,
    mysteryBountyPoolPercent: 100,
    mysteryBountyRegularPoolPercent: 0,
    mysteryBountyProfile: 'classic',
    mysteryBountyActivation: 'at_the_money',
    mysteryBountyMin: 0.25,
    mysteryBountyMax: 5,
    mysteryBountyTopPercent: 20,
    ...ADD_ON,
    allInOrFold: false,
  },
} as const;

export type MidwayFreeBuySchedulePolicy = (typeof MIDWAY_FREE_BUY_FORMATS)[MidwayFreeBuyFormatKey];

/** Each board name's format. A Midway Free Buy under any other name keeps the PKO. */
export const MIDWAY_FREE_BUY_SLOT_FORMATS: Readonly<Record<string, MidwayFreeBuyFormatKey>> = {
  'Morning Free Buy (NLH)': 'regular',
  'Midday Free Buy (NLH)': 'pko',
  'Afternoon Free Buy (NLH)': 'aiof',
  'Prime Time Free Buy (NLH)': 'mystery',
  'Midnight Free Buy (NLH)': 'pko',
};

export function midwayFreeBuyFormatFor(name: unknown): MidwayFreeBuyFormatKey {
  return MIDWAY_FREE_BUY_SLOT_FORMATS[String(name ?? '')] ?? 'pko';
}

/** The schedule policy of a board name, or null for a name that is not a Midway Free Buy slot. */
export function midwayFreeBuyPolicyFor(name: unknown): MidwayFreeBuySchedulePolicy | null {
  const key = MIDWAY_FREE_BUY_SLOT_FORMATS[String(name ?? '')];
  return key ? MIDWAY_FREE_BUY_FORMATS[key] : null;
}

export const MIDWAY_FREE_BUY_DESCRIPTIONS: Readonly<Record<MidwayFreeBuyFormatKey, string>> = {
  pko: 'Free Entry. Midway Promo Funds Your 1-Chip Bounty. 1-Chip Rebuys. No Add-Ons Or Rake. All Prizes Are Bounties: 50% To Your Wallet, 50% To Your Head. The Winner Keeps Their Bounty.',
  regular:
    'Free Entry. Midway Promo Funds Your Entry. 250 Chip Guarantee. 1-Chip Rebuys And Add-Ons For The First Hour. No Rake.',
  aiof: 'All-In Or Fold. Free Entry. Midway Promo Funds Your Entry. 500 Chip Guarantee. 1-Chip Rebuys For The First Hour. No Add-Ons Or Rake.',
  mystery:
    'Mystery Bounty. Free Entry. Midway Promo Funds Your 1-Chip Entry: Half To The Mystery Bounty Pool, Half To The Prize Pool. 1-Chip Rebuys And Add-Ons For The First Hour Split The Same Way. No Rake.',
};

export function isMidwayFreeBuy(row: Record<string, unknown>): boolean {
  return (
    (row.union_id === MIDWAY_FREE_BUY_UNION_ID || row.club_id === MIDWAY_FREE_BUY_UNION_ID) &&
    String(row.tournament_type ?? 'MTT').toUpperCase() === 'MTT' &&
    row.free_buy === true &&
    Number(row.buy_in_amount) === 0 &&
    Number(row.buy_in_fee) === 0 &&
    !row.satellite_target_id &&
    String(row.variant ?? '').toLowerCase() !== 'satellite'
  );
}

/** Only called by creators, before the event accepts its first registration.
 * The format is chosen by the row's board name. */
export function withMidwayFreeBuyPolicy<T extends Record<string, unknown>>(row: T): T {
  if (!isMidwayFreeBuy(row)) return row;
  const key = midwayFreeBuyFormatFor(row.name);
  const p: MidwayFreeBuySchedulePolicy = MIDWAY_FREE_BUY_FORMATS[key];
  const mystery =
    'mysteryBountyPoolPercent' in p
      ? {
          variant: p.variant,
          mystery_bounty_pool_percent: p.mysteryBountyPoolPercent,
          mystery_bounty_regular_pool_percent: p.mysteryBountyRegularPoolPercent,
          mystery_bounty_profile: p.mysteryBountyProfile,
          mystery_bounty_activation: p.mysteryBountyActivation,
          mystery_bounty_min: p.mysteryBountyMin,
          mystery_bounty_max: p.mysteryBountyMax,
          mystery_bounty_top_percent: p.mysteryBountyTopPercent,
        }
      : {};
  return {
    ...row,
    is_bounty: p.isBounty,
    is_pko: p.isPko,
    is_mystery_bounty: p.isMysteryBounty,
    bounty_amount: p.bountyAmount,
    guaranteed_prize: p.guaranteedPrize,
    buy_in_fee: 0,
    is_rebuy: true,
    is_reentry: true,
    rebuy_cost: 1,
    add_on_available: p.addOnAvailable,
    addon_from_start: p.addonFromStart,
    addon_cost: p.addonCost,
    addon_chips: p.addonChips,
    addon_levels: p.addonLevels,
    all_in_or_fold: 'allInOrFold' in p ? p.allInOrFold : false,
    ...mystery,
    short_description: MIDWAY_FREE_BUY_DESCRIPTIONS[key],
  };
}
