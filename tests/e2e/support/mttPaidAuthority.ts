import { pkoPaysNoFinishingPlaces } from '../../../server/src/tournament/bountyOnlyFinalTwo';

export function mttPaidAuthority(row: Record<string, unknown>) {
  const omitted = (classification: string) => ({
    expected: null,
    ladder: row.payout_structure,
    classification,
    error: null,
  });
  if (row.prize_pool_finalized !== true) return omitted('unfinalized-omission');
  if (String(row.tournament_type).toUpperCase() === 'SATELLITE' || row.satellite_target_id)
    return omitted('satellite-omission');
  // A finalized bounty-only PKO settles entirely through knockout awards.
  // Its stored ladder supports lifecycle operations and pays no finishing places.
  //
  // This asks pkoPaysNoFinishingPlaces, NOT isBountyOnlyPkoRow: the close at
  // two also requires an open bounty pool (20261107130652), but the number of
  // PAID PLACES is zero for any PKO with no place pool, bounty heads or not -
  // and this row comes from whatever columns the table page selected, which
  // need not include bounty_pool.
  if (pkoPaysNoFinishingPlaces(row)) {
    for (const field of ['is_mystery_bounty', 'buy_in_amount', 'guaranteed_prize', 'prize_pool']) {
      if (!Object.hasOwn(row, field))
        throw new Error(`Paid witness missing PKO authority: ${field}`);
    }
    return {
      expected: 0,
      ladder: row.payout_structure,
      classification: 'bounty-only-zero',
      error: null,
    };
  }
  let ladder = row.payout_structure;
  if (typeof ladder === 'string') {
    try {
      ladder = JSON.parse(ladder);
    } catch {
      return omitted('invalid-ladder-omission');
    }
  }
  if (!Array.isArray(ladder) || ladder.length === 0) return omitted('invalid-ladder-omission');
  const positions = new Set<number>();
  for (const entry of ladder) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      return omitted('invalid-ladder-omission');
    const scalar = (value: unknown) =>
      typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')
        ? Number(value)
        : NaN;
    const place = scalar(entry?.place);
    const percent = scalar(entry?.percentage);
    if (
      !Number.isInteger(place) ||
      place < 1 ||
      place > 2_147_483_647 ||
      !Number.isFinite(percent) ||
      percent <= 0 ||
      !Number.isSafeInteger(Math.round(percent * 100)) ||
      Math.round(percent * 100) <= 0
    )
      return omitted('invalid-ladder-omission');
    positions.add(place);
  }
  const places = [...positions].sort((a, b) => a - b);
  if (places.some((place, index) => place !== index + 1)) return omitted('gapped-ladder-omission');
  return {
    expected: places.length,
    ladder,
    classification: 'positive-count-witness',
    error: null,
  };
}
