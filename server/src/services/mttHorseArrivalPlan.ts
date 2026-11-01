import { createHash } from 'node:crypto';

/** The random event UUID is the seed; retries and restarts retain the same plan. */
function arrivalUnit(tournamentId: string, purpose: string): number {
  if (!tournamentId) throw new Error('Tournament identity is required for Horse arrival planning');
  return (
    createHash('sha256')
      .update(`${tournamentId}:horse-arrival-v1:${purpose}`)
      .digest()
      .readUInt32BE(0) / 0x1_0000_0000
  );
}

/** Random field size, preserving the funded guarantee as a minimum. */
export function mttPlannedField(
  guarantee: number,
  prizeShare: number,
  tournamentId: string
): number {
  // A house-funded pool is not evidence that entrants have arrived.
  const funded = guarantee > 0 && prizeShare > 0 ? Math.ceil(guarantee / prizeShare) : 0;
  const minimum = Math.max(32, Number.isSafeInteger(funded) ? funded : 0);
  // The floor is financial coverage, not a round-number registration target.
  const spread = Math.max(16, Math.ceil(minimum * 0.3));
  return minimum + 1 + Math.floor(arrivalUnit(tournamentId, 'field') * spread);
}

export function mttPrizeShare(row: { buy_in_amount?: unknown; bounty_amount?: unknown }): number {
  return Math.max(0, (Number(row.buy_in_amount) || 0) - (Number(row.bounty_amount) || 0));
}

export function mttPrestartPlan(
  field: number,
  maxPlayers: number | null,
  tournamentId: string,
  free = false
): number {
  const boundedField = maxPlayers === null ? field : Math.min(field, maxPlayers);
  // A regular event builds a small opening field, regardless of guarantee.
  // The funded complete-field plan belongs to late registration.
  const desired = free
    ? Math.ceil(boundedField * (0.4 + arrivalUnit(tournamentId, 'prestart-share') * 0.2))
    : 12 + Math.floor(arrivalUnit(tournamentId, 'regular-prestart-field') * 17);
  const goal = Math.min(boundedField, desired);
  return maxPlayers === null ? goal : Math.max(0, Math.min(maxPlayers - 1, goal));
}

/**
 * Stable random arrival instants across a phase. Stratified thresholds stay
 * ordered, so binary search is bounded even for a large unlimited MTT.
 * Clock progress is monotonic; repeated calls cannot move the goal backwards.
 */
export function mttArrivalTarget(
  tournamentId: string,
  phase: 'prestart' | 'late',
  total: number,
  progress: number
): number {
  if (!Number.isSafeInteger(total) || total <= 0 || !Number.isFinite(progress)) return 0;
  if (progress <= 0) return 0;
  if (progress >= 1) return total;
  const exponent = 0.65 + arrivalUnit(tournamentId, `${phase}:shape`) * 0.85;
  const clock = progress ** exponent;
  let lower = 0;
  let upper = total;
  while (lower < upper) {
    const index = lower + Math.floor((upper - lower) / 2);
    const instant = (index + arrivalUnit(tournamentId, `${phase}:entry:${index}`)) / total;
    if (instant <= clock) lower = index + 1;
    else upper = index;
  }
  return lower;
}

/** A handful at window opening, then an increasingly busy random trickle. */
export function mttPrestartArrivalTarget(
  tournamentId: string,
  total: number,
  elapsed: number,
  free = false
): number {
  if (!Number.isSafeInteger(total) || total <= 0 || !Number.isFinite(elapsed) || elapsed < 0)
    return 0;
  const opening = Math.min(
    total,
    free
      ? 1 + Math.floor(arrivalUnit(tournamentId, 'free-opening') * 3)
      : 3 + Math.floor(arrivalUnit(tournamentId, 'regular-opening') * 5)
  );
  // mttArrivalTarget has its own random exponent. This extra convex warp
  // keeps the combined exponent above one, so arrivals increase near start.
  const exponent = free
    ? 1.6 + arrivalUnit(tournamentId, 'free-prestart-shape') * 0.6
    : 2.2 + arrivalUnit(tournamentId, 'regular-prestart-shape') * 0.8;
  return (
    opening +
    mttArrivalTarget(tournamentId, 'prestart', total - opening, Math.min(1, elapsed) ** exponent)
  );
}

/** Stored schedules use JSON text and durationMinutes; legacy ladders use seconds. */
export function mttLevelWindowMs(raw: unknown, levels: number): number | undefined {
  let ladder: unknown = raw;
  if (typeof ladder === 'string') {
    try {
      ladder = JSON.parse(ladder);
    } catch {
      return undefined;
    }
  }
  if (
    !Array.isArray(ladder) ||
    !Number.isSafeInteger(levels) ||
    levels <= 0 ||
    ladder.length < levels
  )
    return undefined;
  let total = 0;
  for (const level of ladder.slice(0, levels)) {
    const seconds =
      level && typeof level === 'object'
        ? Number(level.durationMinutes ?? 0) * 60 || Number(level.duration)
        : NaN;
    if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
    total += seconds * 1000;
  }
  return Number.isSafeInteger(total) ? total : undefined;
}
