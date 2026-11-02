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
