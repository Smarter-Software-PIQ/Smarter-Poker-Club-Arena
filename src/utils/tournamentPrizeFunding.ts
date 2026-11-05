import { formatPrizeAtUnit, moneyWordAtUnit } from './format';
import { CHIP_UNIT_CENTS } from '../../server/src/tournament/tournamentUnit';
/**
 * A guarantee counts the FULL buy-in (owner rule 2026-11-05): what the players
 * paid toward it is prize + bounty + rake, before any of those allocations.
 * Fees never fund prizes, but they do count toward meeting the guarantee.
 */
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

/**
 * The regular prize pool's floor: the guarantee less what the players already
 * put toward it outside the prize pool (bounty contributions and rake). The
 * database's fn_ca_place_guarantee_gross(guarantee, bounty_pool, total_rake) is the
 * same arithmetic; the close-out funds exactly max(0, floor - prize pool),
 * which is max(0, G - C).
 */
export function placeGuarantee(guarantee: unknown, bounties: unknown, rake: unknown = 0): number {
  return Math.max(0, amount(guarantee) - amount(bounties) - amount(rake));
}

/** C: the players' gross payments toward the guarantee (prize + bounty + rake). */
export function guaranteeCollected(prizePool: unknown, bountyPool: unknown, rake: unknown): number {
  return amount(prizePool) + amount(bountyPool) + amount(rake);
}

/**
 * True while the lobby's pool figure is the advertised guarantee rather than
 * money in the pools: the players' gross payments (C) have not reached it yet.
 * A guarantee is displayed from the start but moves no chips until the last
 * contribution window closes.
 */
export function displayPoolIsGuarantee(
  prizePool: unknown,
  guarantee: unknown,
  bountyPool: unknown = 0,
  rake: unknown = 0
): boolean {
  const gtd = amount(guarantee);
  return gtd > 0 && guaranteeCollected(prizePool, bountyPool, rake) + 0.005 < gtd;
}

/**
 * What a guaranteed event's lobby prints as its pool.
 *
 * 2026-11-04: the guarantee is shown as the floor while it is not yet met, and
 * the whole pool (prize + bounty) is shown once it is, so a 750 guarantee PKO
 * never reads 380 while 370 sits in bounties.
 * 2026-11-05 (owner rule): a guarantee counts the FULL buy-in, rake included.
 * So the guarantee is shown while the players' gross payments are below it
 * (displayPoolIsGuarantee: label it as the guarantee), and once they reach it
 * the figure is the money actually in the prize and bounty pools. That can be
 * below the guarantee by the rake: meeting a 500 buy-in guarantee with 13 x 40
 * (26 prize / 10 bounty / 4 rake) leaves 338 + 130 in the pools and 52 rake.
 */
export function displayTotalPool(
  prizePool: unknown,
  guarantee: unknown,
  bountyPool: unknown = 0,
  rake: unknown = 0
): number {
  if (displayPoolIsGuarantee(prizePool, guarantee, bountyPool, rake)) return amount(guarantee);
  const prize = Math.max(amount(prizePool), placeGuarantee(guarantee, bountyPool, rake));
  return prize + amount(bountyPool);
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
