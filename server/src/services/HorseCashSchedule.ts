/** Owner November 1: cash only, effective midnight November 2 Chicago (CST). */
export const HORSE_CASH_POLICY_START_MS = Date.parse('2026-11-02T06:00:00Z');
export const PREVIOUS_CASH_ACTIVITY_SCALE = 0.5;
export const REDUCED_CASH_ACTIVITY_SCALE = PREVIOUS_CASH_ACTIVITY_SCALE * 0.4;

export function cashActivityScaleAt(nowMs: number): number {
  return nowMs >= HORSE_CASH_POLICY_START_MS
    ? REDUCED_CASH_ACTIVITY_SCALE
    : PREVIOUS_CASH_ACTIVITY_SCALE;
}

/** Table-level eligibility; never changes tournament admission or human play. */
export function horseCashGameAllowed(
  table: {
    game_variant?: unknown;
    small_blind?: unknown;
    big_blind?: unknown;
    tournament_id?: unknown;
  },
  nowMs: number
): boolean {
  if (table.tournament_id != null || nowMs < HORSE_CASH_POLICY_START_MS) return true;
  const variant = String(table.game_variant ?? '')
    .trim()
    .toLowerCase();
  if (variant.includes('pineapple') || ['short_deck', 'shortdeck', '6+', 'plo8'].includes(variant))
    return false;
  if (variant.startsWith('plo')) {
    const sb = Number(table.small_blind);
    const bb = Number(table.big_blind);
    // Both admission and the rotator read the actual table blinds.
    return (
      Number.isFinite(bb) &&
      bb > 0 &&
      bb <= 1 &&
      table.small_blind != null &&
      Number.isFinite(sb) &&
      sb >= 0 &&
      sb <= 0.5
    );
  }
  return true;
}
