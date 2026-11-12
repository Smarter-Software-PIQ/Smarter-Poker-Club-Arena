/** Owner November 1: cash only, effective midnight November 2 Chicago (CST). */
export const HORSE_CASH_POLICY_START_MS = Date.parse('2026-11-02T06:00:00Z');
export const PREVIOUS_CASH_ACTIVITY_SCALE = 0.5;
export const REDUCED_CASH_ACTIVITY_SCALE = PREVIOUS_CASH_ACTIVITY_SCALE * 0.4;
/** Owner November 11 relaunch: the weekly rake throttle is lifted and the cash
 * floor runs at TRIPLE the reduced rate, effective 6 PM Chicago November 11
 * ("RELAUNCH ALL THE 1/2 PLO AND HOLDEM CASH GAMES ... TRIPLE THE CURRENT
 * RATE"). The ladder of stages is kept so dated tests and replays stay true. */
export const RELAUNCH_CASH_POLICY_START_MS = Date.parse('2026-11-12T00:00:00Z');
export const RELAUNCHED_CASH_ACTIVITY_SCALE = REDUCED_CASH_ACTIVITY_SCALE * 3;

export function cashActivityScaleAt(nowMs: number): number {
  if (nowMs >= RELAUNCH_CASH_POLICY_START_MS) return RELAUNCHED_CASH_ACTIVITY_SCALE;
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
  const sb = Number(table.small_blind);
  const bb = Number(table.big_blind);
  // Owner November 3: NLH/PLO through 1/2; fixed limit through 5/10 blinds.
  const fixedLimit = variant === 'flh' || variant === 'flo8';
  const standard = ['nlh', 'plo', 'plo4', 'plo5', 'plo6'].includes(variant);
  const maxSb = fixedLimit ? 5 : standard ? 1 : 0.5;
  const maxBb = fixedLimit ? 10 : standard ? 2 : 1;
  // Callers apply this only to horse admission/departure, never human access.
  return (
    Number.isFinite(bb) &&
    bb > 0 &&
    bb <= maxBb &&
    table.small_blind != null &&
    Number.isFinite(sb) &&
    sb >= 0 &&
    sb <= maxSb
  );
}
