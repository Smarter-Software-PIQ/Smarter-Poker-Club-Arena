/**
 * A HELD TABLE THAT NEVER LIFTS IS A STALLED TABLE (2026-11-06).
 *
 * /health counted a table as stalled only when it was NOT paused by design and
 * had made no progress for 120 s. A paused table was always "healthy". That
 * was right for a scheduled break and wrong for everything else: on
 * 2026-11-05 Sunday Deep Stack Satellite 25 (fbb86b2a) sat for nine hours
 * with five tables parked behind its qualifier boundary (terminal closeout)
 * and one table holding a retained hand that never started, while /health
 * reported stalledTableCount 0 and every alert stayed quiet.
 *
 * The rule: a seated table that has been held longer than its bound by an
 * owner that is NOT a scheduled, self-ending pause is stalled, and is named
 * with who is holding it.
 *
 *   scheduled, never a stall here:  maintenance, final_table_deal,
 *     weekly_payout, dealing_halt, operator_floor, deal_hold, fsm_paused
 *     (each has its own deadline or an operator behind it)
 *   boundary owners, stalled after HELD_STALL_MS:  terminal_closeout,
 *     tournament_move, and a retained original that never started
 *   hand_for_hand (also the tournament's own :55 break), stalled only after
 *     HAND_FOR_HAND_STALL_MS - longer than a break plus its overlap with the
 *     hourly break
 *
 * IDENTIFICATION ONLY. These tables are added to /health stalledTables and
 * stalledTableCount; they are deliberately kept OUT of the liveness verdict
 * (deadStalledCount / wholeFleetStalled), exactly like the tables failing
 * admission: nothing here may restart the process.
 */

export const HELD_STALL_MS = 60_000;
export const HAND_FOR_HAND_STALL_MS = 600_000;

export const SCHEDULED_PAUSE_OWNERS: ReadonlySet<string> = new Set([
  'maintenance',
  'final_table_deal',
  'weekly_payout',
  'dealing_halt',
  'operator_floor',
  'deal_hold',
  'fsm_paused',
]);

const BOUNDARY_PAUSE_OWNERS: ReadonlySet<string> = new Set([
  'terminal_closeout',
  'tournament_move',
]);

export interface HeldTableObservation {
  seated: number;
  paused: boolean;
  /** Ms in the current by-design pause (msPaused), 0 when unstamped. */
  msPaused: number;
  /** Ms since the table last made progress. Used when msPaused is unstamped. */
  msSinceProgress: number;
  owners: readonly string[];
  /** A retained original held at the pause gate that never started. */
  heldOriginal: boolean;
}

export interface HeldTableStall {
  reason:
    | 'held_by_boundary'
    | 'held_original_unstarted'
    | 'hand_for_hand_overlong'
    | 'held_unnamed';
  heldBy: string[];
  msHeld: number;
}

export function classifyHeldStall(t: HeldTableObservation): HeldTableStall | null {
  if (!(t.seated >= 2)) return null;
  if (!t.paused && !t.heldOriginal) return null;
  const owners = [...t.owners];
  if (owners.some((o) => SCHEDULED_PAUSE_OWNERS.has(o))) return null;
  const msHeld = t.msPaused > 0 ? t.msPaused : Math.max(0, t.msSinceProgress);
  const boundary = owners.filter((o) => BOUNDARY_PAUSE_OWNERS.has(o));
  if (boundary.length > 0 && msHeld > HELD_STALL_MS)
    return { reason: 'held_by_boundary', heldBy: owners, msHeld };
  if (t.heldOriginal && msHeld > HELD_STALL_MS)
    return { reason: 'held_original_unstarted', heldBy: owners, msHeld };
  if (owners.length > 0 && owners.every((o) => o === 'hand_for_hand')) {
    return msHeld > HAND_FOR_HAND_STALL_MS
      ? { reason: 'hand_for_hand_overlong', heldBy: owners, msHeld }
      : null;
  }
  if (owners.length === 0 && t.paused && msHeld > HELD_STALL_MS)
    return { reason: 'held_unnamed', heldBy: owners, msHeld };
  return null;
}
