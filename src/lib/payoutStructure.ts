import { parseJsonCached } from '../utils/parseJsonCached';
import { spinTier } from '../config/spinSpec';

export interface PayoutPlace {
  place: number;
  percentage: number;
}

export interface PayoutSubject {
  payout_structure?: unknown;
  variant?: string | null;
  tournament_type?: string | null;
  spin_multiplier?: number | null;
  is_pko?: boolean | null;
  is_mystery_bounty?: boolean | null;
  buy_in_amount?: number | string | null;
  guaranteed_prize?: number | string | null;
  prize_pool?: number | string | null;
}

/**
 * A BOUNTY-ONLY PKO PAYS NO PLACES (Dan, 2026-11-05: "PKO FREE ROLL ONLY PAYS
 * YOU FOR THE PLAYERS YOU ELIMINATE, AND THE LAST MAN STANDING KEEPS THE
 * BOUNTY ON THEIR HEAD ... 0 PLACES PAID").
 *
 * A PKO whose entry puts nothing into the place prize pool (a free entry with
 * no guarantee and no place prize money) is paid entirely in knockouts: 50% of
 * each head to the eliminator's wallet, 50% onto their head, and the winner
 * keeps their own head. The database settles it with a 0 prize pool; the
 * stored ladder exists only for lifecycle compatibility, so no screen may show
 * it as paid places.
 */
export function isBountyOnlyPko(t: PayoutSubject | null | undefined): boolean {
  // A mystery bounty event pays its chests in the money, never bounty only
  // (same rule as the engine's isBountyOnlyPkoRow).
  if (!t || t.is_pko !== true || t.is_mystery_bounty === true) return false;
  const n = (v: unknown) => {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
  };
  return n(t.buy_in_amount) <= 0 && n(t.guaranteed_prize) <= 0 && n(t.prize_pool) <= 0;
}

function numericJsonScalar(value: unknown): number {
  if (typeof value !== 'number' && typeof value !== 'string') return Number.NaN;
  if (typeof value === 'string' && value.trim() === '') return Number.NaN;
  return Number(value);
}

/**
 * Parse the one persisted payout-ladder shape the engine and database settle.
 *
 * The stored contract is an array of explicit, positive integer places with a
 * positive finite percentage. The first row for a duplicate place wins, which
 * matches the database authority and computePlacePrize. Any malformed row
 * invalidates the whole structure so the UI cannot advertise a ladder that the
 * settlement transaction will reject.
 */
export function parsePayoutStructure(raw: unknown): PayoutPlace[] | null {
  let value = raw;
  if (typeof value === 'string') {
    if (!value.trim()) return null;
    value = parseJsonCached(value);
  }
  if (!Array.isArray(value) || value.length === 0) return null;

  const places: PayoutPlace[] = [];
  const seen = new Set<number>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
    const row = candidate as Record<string, unknown>;
    const place = numericJsonScalar(row.place);
    const percentage = numericJsonScalar(row.percentage);
    const basisPoints = Math.round(percentage * 100);
    if (!Number.isInteger(place) || place < 1 || place > 2_147_483_647) return null;
    if (
      !Number.isFinite(percentage) ||
      percentage <= 0 ||
      !Number.isSafeInteger(basisPoints) ||
      basisPoints <= 0
    ) {
      return null;
    }
    if (seen.has(place)) continue;
    seen.add(place);
    places.push({ place, percentage });
  }

  if (!seen.has(1)) return null;
  places.sort((a, b) => a.place - b.place);
  return places;
}

/** A Spin's persisted multiplier is its payout contract, not its stored placeholder. */
export function isSpinTournament(t: PayoutSubject | null | undefined): boolean {
  if (!t) return false;
  return (
    String(t.variant ?? '').toLowerCase() === 'spin' ||
    String(t.tournament_type ?? '').toUpperCase() === 'SPIN'
  );
}

/** Resolve the canonical percentage ladder for a drawn Spin tier. */
export function spinPayoutStructure(multiplier: number | null | undefined): PayoutPlace[] | null {
  const tier = spinTier(Number(multiplier));
  if (!tier || !Array.isArray(tier.payouts) || tier.payouts.length === 0) return null;
  return tier.payouts.map((percentage, index) => ({
    place: index + 1,
    percentage: Math.round(percentage * 10_000) / 100,
  }));
}

/**
 * The exact payout ladder the settlement authority uses.
 *
 * Spin rows are created with a winner-take-all placeholder before the draw, so
 * a known multiplier must outrank that copy. An unknown Spin tier fails closed
 * instead of advertising the placeholder. Every other format keeps its stored
 * operator-authored structure.
 */
export function resolvePayoutStructure(
  tournament: PayoutSubject | null | undefined
): PayoutPlace[] | null {
  if (isSpinTournament(tournament)) {
    return spinPayoutStructure(tournament?.spin_multiplier);
  }
  // Zero places are paid in a bounty-only PKO: the ladder is not a payout.
  if (isBountyOnlyPko(tournament)) return [];
  return parsePayoutStructure(tournament?.payout_structure);
}
