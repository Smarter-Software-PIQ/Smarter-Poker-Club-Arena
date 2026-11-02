/** Owner ruling 2026-11-02: Midway funds the free initial one-chip head
 * from its promo wallet. Paid one-chip rebuys fund only bounties. No add-ons,
 * entry rake or finishing-place prize pool. Funding belongs to registration's
 * atomic database transaction, never to this creation-time policy. */
export const MIDWAY_FREE_BUY_UNION_ID = 'fade0000-0000-0000-0000-000000000001';

export const MIDWAY_FREE_BUY_SCHEDULE_POLICY = {
  midwayFreeBuyFormat: 'promo-pko-v1',
  buyIn: 0,
  buyInFee: 0,
  guaranteedPrize: 0,
  isBounty: true,
  isPko: true,
  isMysteryBounty: false,
  bountyAmount: 1,
  isRebuy: true,
  isReentry: true,
  rebuyCost: 1,
  addOnAvailable: false,
  addonFromStart: false,
  addonCost: null,
  addonChips: null,
  addonLevels: null,
} as const;

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

/** Only called by creators, before the event accepts its first registration. */
export function withMidwayFreeBuyPolicy<T extends Record<string, unknown>>(row: T): T {
  if (!isMidwayFreeBuy(row)) return row;
  return {
    ...row,
    is_bounty: true,
    is_pko: true,
    is_mystery_bounty: false,
    bounty_amount: 1,
    guaranteed_prize: 0,
    buy_in_fee: 0,
    is_rebuy: true,
    is_reentry: true,
    rebuy_cost: 1,
    add_on_available: false,
    addon_from_start: false,
    addon_cost: null,
    addon_chips: null,
    addon_levels: null,
    short_description:
      'Free Entry. Midway Promo Funds Your 1-Chip Bounty. 1-Chip Rebuys. No Add-Ons Or Rake. All Prizes Are Bounties: 50% To Your Wallet, 50% To Your Head. The Winner Keeps Their Bounty.',
  };
}
