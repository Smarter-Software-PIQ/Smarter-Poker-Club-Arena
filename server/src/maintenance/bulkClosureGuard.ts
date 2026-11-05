/**
 * BULK CLOSURE STAYS OUT OF LIVE PLAY (owner approval, 2026-11-05, fix 2).
 *
 * On the night of November 4/5 the stuck-event closeout ran during live play.
 * Each closure takes the cancellation lane every table also needs to commit a
 * hand, then locks the event's players, tables and seats. At ~04:05 UTC a
 * settlement loop held that lane through the hourly resume and ~40 Spins and
 * Sit & Gos timed out; at 05:09 UTC one large event (243 entrants) froze 46
 * live tables. The night was finished by scripts that stayed idle :53-:08 and
 * paused between settlements. This module makes those rules the engine's own.
 *
 * The database enforces the same rules on every money door itself
 * (smarter_private.bulk_closure_admission, migration
 * 20261105181406_bulk_closure_stays_out_of_live_play.sql). This is the engine
 * half, at POST /admin/tournament-abort-boundary: it refuses BEFORE any table
 * is parked, fenced, retired or acknowledged, so an operator closure can never
 * start stopping a large event's tables during play or the resume.
 *
 * The constants are pinned equal to the migration by bulkClosureGuard.test.ts.
 */
import { DAILY_WINDOW, chicagoClock } from './dailyWindow.js';

export const BULK_CLOSURE_POLICY = {
  /** Minute-of-hour UTC the refusal opens (the :53 announcement). */
  breakOpensMinute: 53,
  /** Minute-of-hour UTC the refusal closes (after the :00 resume settles). */
  breakClosesMinute: 8,
  /** More player rows than this across the targets is a "large" closure. */
  largeEntrants: 50,
  /** Large closures run only in the daily quiet window, Chicago wall clock. */
  quietStart: DAILY_WINDOW.windowStart,
  quietEnd: DAILY_WINDOW.windowEnd,
} as const;

export type BulkClosureRefusal =
  | 'break_window'
  | 'maintenance_active'
  | 'resume_settling'
  | 'size_unknown'
  | 'large_outside_quiet_hours';

export interface BulkClosureState {
  /** Engine break is announced, counting down, or the process freeze is up. */
  maintenanceActive: boolean;
  /** The thaw's resume waves are still reaching tables. */
  resuming: boolean;
  /** Player rows in the event (null when it could not be read). */
  entrants: number | null;
}

/** True inside the quiet window, start inclusive, end exclusive. */
export function bulkClosureQuietHours(at: Date): boolean {
  const t = chicagoClock(at);
  return t >= BULK_CLOSURE_POLICY.quietStart && t < BULK_CLOSURE_POLICY.quietEnd;
}

/** Null when a closure of this size may begin at `at`; otherwise why not. */
export function bulkClosureRefusal(at: Date, state: BulkClosureState): BulkClosureRefusal | null {
  const minute = at.getUTCMinutes();
  if (
    minute >= BULK_CLOSURE_POLICY.breakOpensMinute ||
    minute < BULK_CLOSURE_POLICY.breakClosesMinute
  )
    return 'break_window';
  if (state.maintenanceActive) return 'maintenance_active';
  if (state.resuming) return 'resume_settling';
  if (state.entrants === null || !Number.isSafeInteger(state.entrants) || state.entrants < 0)
    return 'size_unknown';
  if (state.entrants > BULK_CLOSURE_POLICY.largeEntrants && !bulkClosureQuietHours(at))
    return 'large_outside_quiet_hours';
  return null;
}

/** Thrown before any physical side effect; the handler answers 409. */
export class BulkClosureRefusedError extends Error {
  constructor(readonly reason: BulkClosureRefusal) {
    super(`bulk_closure_${reason}`);
    this.name = 'BulkClosureRefusedError';
  }
}
