import { formatPrizeAtUnit, moneyWordAtUnit } from './format';
import { CHIP_UNIT_CENTS } from '../../server/src/tournament/tournamentUnit';
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

/**
 * A BUY-IN GUARANTEE COUNTS THE WHOLE PLAYER PAYMENT (Dan, 2026-11-05).
 *
 * "The full qualifying player-funded tournament payment counts toward the
 * buy-in guarantee before deducting bounty allocations or rake." A 40-chip
 * entry split 26 prize / 10 bounty / 4 rake credits 40. So the house owes
 * only H = max(0, guarantee - gross), where gross = what reached the places
 * + what reached the bounties + the rake taken from those same payments.
 * Guarantee credit is not money: it adds nothing to any pool by itself.
 *
 * The database is the authority (fn_ca_guarantee_funding, read from the
 * ledger, funds H once at close); this is the same arithmetic for screens
 * that only hold the tournament row. Before the pool finalizes, the pending
 * house share is shown on top of what the field has paid; after it
 * finalizes the stored pool already contains it.
 */
export function guaranteeShortfall(
  guarantee: unknown,
  prizePool: unknown,
  bountyPool: unknown = 0,
  rake: unknown = 0
): number {
  const gtd = amount(guarantee);
  if (gtd <= 0) return 0;
  const gross = amount(prizePool) + amount(bountyPool) + amount(rake);
  return Math.max(0, Math.round((gtd - gross) * 100) / 100);
}

/**
 * The prize money a guaranteed event's lobby prints beside "GTD": places +
 * bounties + any house funding still owed. It is never the advertised
 * guarantee stacked on collected money (the 2,445 the owner saw on a 1,500
 * guarantee, 2026-11-04), and never the guarantee itself once the field's
 * gross payments have met it: the rake is the room's, not prize money.
 */
export function displayTotalPool(
  prizePool: unknown,
  guarantee: unknown,
  bountyPool: unknown = 0,
  rake: unknown = 0,
  finalized: unknown = false
): number {
  const money = amount(prizePool) + amount(bountyPool);
  if (finalized === true) return money;
  return money + guaranteeShortfall(guarantee, prizePool, bountyPool, rake);
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
