import { formatPrizeAtUnit, moneyWordAtUnit } from './format';
import { CHIP_UNIT_CENTS } from '../../server/src/tournament/tournamentUnit';
import { chipCents } from './cashierAmount';
/** Guarantees cover places and bounties together; fees never fund prizes. */
export interface TournamentPrizeTerms {
  buy_in_amount?: number | null;
  buy_in_fee?: number | null;
  bounty_amount?: number | null;
  bounty_pool?: number | null;
  is_bounty?: boolean | null;
  is_pko?: boolean | null;
  is_mystery_bounty?: boolean | null;
  short_description?: string | null;
}

const amount = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
};

export function placeGuarantee(guarantee: unknown, bounties: unknown): number {
  return Math.max(0, amount(guarantee) - amount(bounties));
}

/** Guarantee coverage includes funded places and bounties, excluding rake (owner November 7). */
export function guaranteeShortfall(
  guarantee: unknown,
  prizePool: unknown,
  bountyPool: unknown = 0,
  rake: unknown = 0
): number {
  const gtd = amount(guarantee);
  if (gtd <= 0) return 0;
  void rake;
  const net = amount(prizePool) + amount(bountyPool);
  return Math.max(0, Math.round((gtd - net) * 100) / 100);
}

/**
 * THE TOTAL PRIZE POOL IS THE MONEY THE FIELD HAS PAID IN, NET OF RAKE
 * (Dan, 2026-11-06): "the total prize pool should say 1656 and growing.
 * 36x46 (rake is subtracted from prizepool)". Places + bounties, nothing
 * else. The house's overlay is NOT stacked on top while the pool is still
 * open: it is shown on its own beside the guarantee (guaranteeShortfall) and
 * only enters the pool when it is actually funded at close, after which the
 * finalized stored pool already contains it. The guarantee and rake
 * arguments are kept so existing callers compile; they no longer move the
 * figure.
 */
export function displayTotalPool(
  prizePool: unknown,
  guarantee: unknown,
  bountyPool: unknown = 0,
  rake: unknown = 0,
  finalized: unknown = false
): number {
  void guarantee;
  void rake;
  void finalized;
  // Both columns are scale-2 chip amounts: the sum is held to cents.
  return chipCents(amount(prizePool) + amount(bountyPool));
}

/** Fixed-bounty copy comes from charged terms, never an old schedule blurb. */
export function tournamentEntryDescription(
  t: TournamentPrizeTerms,
  unitCents = CHIP_UNIT_CENTS
): string | null {
  if (!t.is_bounty || t.is_pko || t.is_mystery_bounty) return t.short_description ?? null;
  const bounty = amount(t.bounty_amount);
  const fee = amount(t.buy_in_fee);
  const places = amount(t.buy_in_amount) - bounty;
  if (places < 0) return null;
  const chips = (n: number) => formatPrizeAtUnit(n, unitCents);
  const entry = `Entry: ${chips(places)} Prize Pool + ${chips(bounty)} Bounty + ${chips(fee)} Rake.`;
  // Numeric entry descriptions may contain decimal points. Remove the entire
  // known financial sentence, preserving unrelated authored event rules.
  const authored = t.short_description
    ?.replace(
      /Entry:\s*[\d,.]+\s+Prize Pool\s*\+\s*[\d,.]+\s+Bounty\s*\+\s*[\d,.]+\s+(?:Fee|Rake)\.?/i,
      ''
    )
    .trim();
  return `${authored || `Fixed Knockout Bounty: ${chips(bounty)} ${moneyWordAtUnit(unitCents)}.`} ${entry}`;
}

/** Display the normalized share used by the canonical integer-weight payout math. */
export function payoutSharePercent(
  weight: number,
  structure: readonly { percentage?: number }[]
): number {
  const bp = (n: unknown) => Math.max(0, Math.round(amount(n) * 100));
  const total = structure.reduce((sum, row) => sum + bp(row.percentage), 0);
  return total > 0 ? Number(((bp(weight) * 100) / total).toFixed(2)) : 0;
}

/** The funding columns the pending house share is read from. */
export interface PendingHouseFunding {
  overlay: number;
  houseRequired: number | null;
  housePosted: number | null;
  houseDue: number | null;
}

/**
 * WHAT THE HOUSE STILL ADDS AT CLOSE (2026-11-07): the live overlay sentence
 * beside the guarantee. It is never added to a place prize (no projected
 * payouts, Dan 2026-11-07). `house_due` is the database's own answer; when a row
 * predates it, it is the whole obligation (house_required, or the overlay
 * when that is missing too) less what the house has already posted. A Free
 * Buy's promo chips are already in prize_pool (house_posted), so adding the
 * whole share again would price a 250 guarantee at 405. Paid events post
 * nothing before close, so for them this equals the overlay. `null` funding
 * (unread, failed, or keyed to an older pool) is zero, never a guessed one.
 */
export function pendingHouseShare(funding: PendingHouseFunding | null | undefined): number {
  if (!funding) return 0;
  if (funding.houseDue !== null && funding.houseDue !== undefined) {
    return Math.max(0, funding.houseDue);
  }
  const required = funding.houseRequired ?? funding.overlay;
  return Math.max(0, amount(required) - amount(funding.housePosted));
}
