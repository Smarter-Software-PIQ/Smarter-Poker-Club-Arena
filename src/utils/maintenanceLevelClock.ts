/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A MAINTENANCE BREAK STOPS EVERY TOURNAMENT CLOCK (Dan 2026-11-05)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "IF THERE IS A MAINTENANCE BREAK IT NEEDS TO PAUSE ALL THE TOURNAMENT
 * CLOCKS AS WELL, THEY SHOULD NOT BE RUNNING DURING A MAINTENANCE PAUSE."
 *
 * The engine already owes every RUNNING event the frozen time: no level is
 * advanced inside the freeze, and fn_thaw_platform moves each event's
 * `level_started_at` forward by the frozen duration before play resumes
 * (engine_maintenance_thaws.shifted.level_started_at). What did NOT stop was
 * the clock a player reads. Every screen computes `level_started_at +
 * duration - now`, the row keeps its pre-freeze anchor until the thaw, so the
 * HUD, the lobby rows, the blinds tab and the tournament pages counted down
 * through the whole break and then jumped back up at the release.
 *
 * This module is the one place that answers "what instant is a level clock
 * measured at right now?":
 *
 *   - FROZEN: from the moment the countdown starts (`break_started_at`, the
 *     same freezeStartedAt the thaw credits from) every level clock reads the
 *     frozen instant. The last-hand phase before it is still being played and
 *     keeps running, exactly as the engine counts it.
 *   - RELEASED, ROW NOT YET RE-READ: a row still carrying the anchor it had
 *     during the freeze has not picked up the thaw's shift yet. It is measured
 *     with the frozen duration taken off, which is the shifted anchor's own
 *     arithmetic, so the clock resumes where it stopped with no jump. The
 *     moment the row's anchor changes (shift arrived, level moved) the real
 *     clock takes over.
 *
 * Fed app-wide by MaintenanceClockSync (useMaintenanceBreak state), read
 * by TournamentService.getCurrentLevelState and the lobby/blinds clocks.
 */

/** The engine's countdown starts exactly this long after the announcement on
 *  every scheduled break (MaintenanceBreak.beginCountdown anchors it to
 *  announcedAt + LAST_HAND_LEAD_MS), which is the freezeStartedAt the thaw
 *  credits from. An explicit break_started_at, if a frame carries one, wins. */
export const MAINTENANCE_LAST_HAND_LEAD_MS = 2 * 60 * 1000;
/** A row not re-read this long after the release is trusted as-is. */
export const RELEASED_UNSHIFTED_CEILING_MS = 10 * 60 * 1000;

export interface MaintenanceClockInput {
  active: boolean;
  phase: string;
  /** Countdown start (engine freezeStartedAt), epoch ms, when known. */
  breakStartedAtMs: number | null;
  /** The announcement instant (break_id), epoch ms, when known. */
  breakId: number | null;
}

export interface LevelClockRow {
  id?: string | null;
  status?: string | null;
  on_break?: boolean | null;
  level_started_at?: string | null;
}

let frozenAtMs: number | null = null;
let released: { frozenAtMs: number; releasedAtMs: number } | null = null;
/** Anchor each event carried while the clock was frozen. */
const anchorsSeenFrozen = new Map<string, { anchor: string; frozenAtMs: number }>();

function isHolding(phase: string): boolean {
  return phase === 'counting_down' || phase === 'finalizing';
}

/** Record the platform's maintenance state. Idempotent; safe to call per render. */
export function noteMaintenanceClock(input: MaintenanceClockInput, nowMs: number): void {
  if (input.active && isHolding(input.phase)) {
    const derived =
      input.breakStartedAtMs ??
      (input.breakId !== null ? input.breakId + MAINTENANCE_LAST_HAND_LEAD_MS : null) ??
      frozenAtMs ??
      nowMs;
    const next = Math.min(derived, nowMs);
    // A new break forgets the previous release; the same break keeps its
    // first (earliest) freeze instant even if a later read lands.
    if (frozenAtMs === null) released = null;
    frozenAtMs = frozenAtMs === null ? next : Math.min(frozenAtMs, next);
    return;
  }
  if (input.active && input.phase === 'last_hand') return;
  if (frozenAtMs !== null) {
    released = { frozenAtMs, releasedAtMs: Math.max(frozenAtMs, nowMs) };
    frozenAtMs = null;
  }
}

/** The instant a tournament's level clock is measured at. */
export function levelClockNow(row: LevelClockRow | null | undefined, nowMs: number): number {
  if (!row || String(row.status ?? '').toUpperCase() !== 'RUNNING') return nowMs;
  const anchor = row.level_started_at ?? null;
  const id = row.id ?? null;
  if (frozenAtMs !== null) {
    // An event on its own synchronized break is shown by its break clock and
    // re-anchored by its own release; it is not credited by the thaw.
    if (id && anchor && row.on_break !== true) {
      anchorsSeenFrozen.set(id, { anchor, frozenAtMs });
    }
    return Math.min(nowMs, frozenAtMs);
  }
  if (!id) return nowMs;
  const seen = anchorsSeenFrozen.get(id);
  if (!seen) return nowMs;
  if (
    released &&
    seen.frozenAtMs === released.frozenAtMs &&
    seen.anchor === anchor &&
    row.on_break !== true &&
    nowMs - released.releasedAtMs < RELEASED_UNSHIFTED_CEILING_MS
  ) {
    return nowMs - (released.releasedAtMs - released.frozenAtMs);
  }
  anchorsSeenFrozen.delete(id);
  return nowMs;
}

/** Whether level clocks are stopped right now (for paused styling). */
export function maintenanceClockFrozen(): boolean {
  return frozenAtMs !== null;
}

/** Test seam. */
export function resetMaintenanceLevelClockForTests(): void {
  frozenAtMs = null;
  released = null;
  anchorsSeenFrozen.clear();
}
