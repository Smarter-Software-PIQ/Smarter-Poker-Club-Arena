/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE ADD-ON PHASE STOPS THE LEVEL CLOCK A PLAYER READS (Dan 2026-11-18)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "WHEN THE ADD ON PERIOD STARTS AND HANDS ARE PAUSED, THE NEXT LEVEL STAYS
 * PAUSED UNTIL THE REBUY PERIOD IS OVER... IT CURRENTLY KEEPS RUNNING UNTIL
 * THE ADD ON STARTS. IT SHOULD PAUSE AND WAIT FOR ALL HANDS TO FINISH AND THE
 * REBUY PERIOD END, BEFORE THE NEXT LEVEL STARTS."
 *
 * The add-on phase has two parts. First the DRAIN: entry has reached its
 * boundary, every table finishes the hand it is in and parks. Then the one
 * paid MINUTE. The engine stops the level clock for both
 * (TournamentManagerBase.holdLevelClockForAddOnDrain) and re-anchors
 * `level_started_at` when the minute ends.
 *
 * Every screen computes `level_started_at + duration - now`, and the row keeps
 * the anchor it had when the drain began until that re-anchor. So the clock a
 * player read kept counting down through the drain while the tables around
 * them were already parked, and jumped back up when play resumed.
 *
 * This module answers one question from the row alone: is this event's level
 * clock stopped for its add-on right now, and at what instant did it stop?
 *
 *   DRAIN    the entry boundary has passed (the level cap was reached, or the
 *            late registration clock ran out), an add-on is still owed, and
 *            the row carries no closing minute yet.
 *   MINUTE   the closing minute is on the row and has not ended.
 *   RELEASE  the minute has ended. The row is trusted again as soon as its
 *            anchor moves; until then (the engine's re-anchor is one write
 *            behind the deadline) the clock stays where it stopped, so it
 *            never dips and jumps back.
 */
import { tournamentEntryClockDeadlineMs, tournamentEntryWindow } from './tournamentEntryWindow';

export interface AddOnClockRow {
  id?: string | null;
  status?: string | null;
  current_level?: number | null;
  late_reg_levels?: number | null;
  rebuy_levels?: number | null;
  late_reg_mins?: number | null;
  started_at?: string | null;
  level_started_at?: string | null;
  add_on_available?: boolean | null;
  prize_pool_finalized?: boolean | null;
  addon_from_start?: boolean | null;
  addon_period_started_at?: string | null;
  addon_period_ends_at?: string | null;
}

/** The paid minute; the engine's addOnBreakDurationMs. */
export const ADD_ON_MINUTE_MS = 60_000;
/** How long an ended minute is waited on for the engine's re-anchor. */
export const ADD_ON_REANCHOR_GRACE_MS = 10_000;

export type AddOnClockHold =
  | { phase: 'none' }
  | { phase: 'drain'; heldAtMs: number }
  | { phase: 'minute'; heldAtMs: number; endsAtMs: number }
  | { phase: 'releasing'; heldAtMs: number };

/** Anchor each event carried while its add-on held the clock. */
const anchorsSeenHeld = new Map<string, { anchor: string; heldAtMs: number }>();

const epoch = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
};

/** The instant the entry boundary passed and the drain began, or null before it. */
function drainStartedAt(row: AddOnClockRow, anchorMs: number, nowMs: number): number | null {
  const window = tournamentEntryWindow(row);
  if (window.mode === 'closed') return null;
  const passed: number[] = [];
  // The level that reaches the cap is the one the drain begins with, so the
  // boundary is that level's own start. A later level means play went on.
  if (window.mode === 'levels' && window.current === window.cap) passed.push(anchorMs);
  const deadline = tournamentEntryClockDeadlineMs(row);
  if (deadline !== null && nowMs >= deadline) passed.push(deadline);
  return passed.length ? Math.min(...passed) : null;
}

export function addOnClockHold(
  row: AddOnClockRow | null | undefined,
  nowMs: number
): AddOnClockHold {
  const none: AddOnClockHold = { phase: 'none' };
  if (!row || String(row.status ?? '').toUpperCase() !== 'RUNNING') return none;
  const id = row.id ?? null;
  const anchor = row.level_started_at ?? null;
  const anchorMs = epoch(anchor);
  if (row.add_on_available !== true || anchorMs === null || !Number.isFinite(nowMs)) {
    if (id) anchorsSeenHeld.delete(id);
    return none;
  }
  const startsAt = epoch(row.addon_period_started_at);
  const endsAt = epoch(row.addon_period_ends_at);
  const hasWindow = startsAt !== null && endsAt !== null && endsAt > startsAt;
  const closingMinute = hasWindow && endsAt! - startsAt! <= ADD_ON_MINUTE_MS;

  // The minute has ended: hold only until the engine's re-anchor is read.
  if (closingMinute && nowMs >= endsAt!) {
    const seen = id ? anchorsSeenHeld.get(id) : undefined;
    if (
      seen &&
      seen.anchor === anchor &&
      row.prize_pool_finalized !== true &&
      nowMs - endsAt! < ADD_ON_REANCHOR_GRACE_MS
    ) {
      return { phase: 'releasing', heldAtMs: seen.heldAtMs };
    }
    if (id) anchorsSeenHeld.delete(id);
    return none;
  }
  if (row.prize_pool_finalized === true) {
    if (id) anchorsSeenHeld.delete(id);
    return none;
  }

  const boundary = drainStartedAt(row, anchorMs, nowMs);
  if (closingMinute) {
    // The clock stopped when the drain began, never later than the minute.
    const heldAtMs = Math.max(anchorMs, Math.min(boundary ?? startsAt!, startsAt!));
    if (id && anchor) anchorsSeenHeld.set(id, { anchor, heldAtMs });
    return { phase: 'minute', heldAtMs, endsAtMs: endsAt! };
  }
  // No closing minute on the row yet (or a legacy early offer the engine is
  // about to replace): the drain holds from the boundary.
  if (boundary === null) {
    if (id) anchorsSeenHeld.delete(id);
    return none;
  }
  const heldAtMs = Math.max(anchorMs, boundary);
  if (id && anchor) anchorsSeenHeld.set(id, { anchor, heldAtMs });
  return { phase: 'drain', heldAtMs };
}

/** The instant this event's level clock is measured at, add-on phase applied. */
export function addOnClockNow(row: AddOnClockRow | null | undefined, nowMs: number): number {
  const hold = addOnClockHold(row, nowMs);
  return hold.phase === 'none' ? nowMs : Math.min(nowMs, hold.heldAtMs);
}

/** Test seam. */
export function resetAddOnLevelClockForTests(): void {
  anchorsSeenHeld.clear();
}
