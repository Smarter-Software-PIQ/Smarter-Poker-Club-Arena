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

/** Random field size, preserving the no-rake guarantee coverage floor. */
export function mttPlannedField(
  guarantee: number,
  entryAmount: number,
  tournamentId: string,
  attendanceFloor?: number
): number {
  // A house-funded pool is not evidence that entrants have arrived.
  const funded = guarantee > 0 && entryAmount > 0 ? Math.ceil(guarantee / entryAmount) : 0;
  if (
    attendanceFloor !== undefined &&
    (!Number.isSafeInteger(attendanceFloor) || attendanceFloor < 0)
  )
    throw new Error('Invalid Horse attendance floor');
  const minimum = Math.max(32, attendanceFloor ?? (Number.isSafeInteger(funded) ? funded : 0));
  // An explicit attendance floor preserves the original plan without promising prizes.
  const spread = Math.max(16, Math.ceil(minimum * 0.3));
  return minimum + 1 + Math.floor(arrivalUnit(tournamentId, 'field') * spread);
}

/**
 * The advertised guarantee covers regular prizes AND bounties. The owner's
 * net prize coverage uses the entry amount without rake, not a regular-pool share.
 * This plans attendance only; it never redirects fees or changes payout splits.
 */
export function mttGuaranteeEntryAmount(row: {
  buy_in_amount?: unknown;
  buy_in_fee?: unknown;
  bounty_amount?: unknown;
}): number {
  const buyIn = Number(row.buy_in_amount ?? 0);
  const fee = Number(row.buy_in_fee ?? 0);
  if (!Number.isFinite(buyIn) || !Number.isFinite(fee) || buyIn < 0 || fee < 0) return 0;
  return Math.round(buyIn * 100) / 100;
}

/** Owner November 8, 2026: a free-entry field is 400 to 600 Horses. */
export const FREE_ENTRY_FIELD_MIN = 400;
export const FREE_ENTRY_FIELD_MAX = 600;

/**
 * Owner November 17, 2026 (Nightly 20K, 37 entrants at T-7 against a 572-entry
 * funded plan): "WHY ISN'T THERE LIKE 100-200 HORSES REGISTERED FOR THIS WITHIN
 * 10 MINUTES OF STARTING?!" A paid event's prestart field now SCALES WITH ITS
 * PLANNED FIELD: a random 20-35% of it, never under the old 32-48 opening draw
 * and never over 200. A small event is unchanged; a big guarantee shows a big
 * field before the clock starts. The rest of the plan still arrives in late
 * registration.
 */
export const REGULAR_PRESTART_SHARE_MIN = 0.2;
export const REGULAR_PRESTART_SHARE_SPREAD = 0.15;
export const REGULAR_PRESTART_FIELD_MAX = 200;

export function mttPrestartPlan(
  field: number,
  maxPlayers: number | null,
  tournamentId: string,
  free = false
): number {
  // Owner November 8, 2026: every free-entry event (Midway Free Buys and any
  // other freeroll) is the biggest field on the platform - at least 400 and at
  // most 600 Horses. The event's own random draw picks where in that range.
  let desired: number;
  if (free) {
    desired =
      FREE_ENTRY_FIELD_MIN +
      Math.floor(
        arrivalUnit(tournamentId, 'free-prestart-field') *
          (FREE_ENTRY_FIELD_MAX - FREE_ENTRY_FIELD_MIN + 1)
      );
  } else {
    const opening = 32 + Math.floor(arrivalUnit(tournamentId, 'regular-prestart-field') * 17);
    const planned = Number.isFinite(field) && field > 0 ? field : 0;
    const share =
      REGULAR_PRESTART_SHARE_MIN +
      arrivalUnit(tournamentId, 'regular-prestart-share') * REGULAR_PRESTART_SHARE_SPREAD;
    const scaled = Math.min(REGULAR_PRESTART_FIELD_MAX, Math.floor(planned * share));
    desired = Math.max(opening, scaled);
  }
  // Finite capacity still bounds it, always one seat short of full.
  const goal = desired;
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
      ? Math.ceil(total * (0.6 + arrivalUnit(tournamentId, 'free-opening') * 0.2))
      : 3 + Math.floor(arrivalUnit(tournamentId, 'regular-opening') * 5)
  );
  const remaining = total - opening;
  if (!free) {
    // One random instant in each equal time slice. Unlike a convex curve,
    // this keeps the opening handful from sitting unchanged for many minutes.
    const progress = Math.min(1, elapsed);
    let arrived = 0;
    while (arrived < remaining) {
      const instant =
        (arrived + arrivalUnit(tournamentId, `regular-prestart-entry:${arrived}`)) / remaining;
      if (instant > progress) break;
      arrived++;
    }
    return opening + arrived;
  }
  const exponent = 1.6 + arrivalUnit(tournamentId, 'free-prestart-shape') * 0.6;
  return (
    opening +
    mttArrivalTarget(tournamentId, 'prestart', remaining, Math.min(1, elapsed) ** exponent)
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
