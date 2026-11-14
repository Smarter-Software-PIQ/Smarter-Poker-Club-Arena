import { ADDON_BREAK_MS } from './FreeBuy.js';
import { mttLevelWindowMs } from './mttHorseArrivalPlan.js';

export interface OverlayRescueClock {
  started_at: string | null;
  late_reg_mins: number | null;
  late_reg_levels: number | null;
  rebuy_levels: number | null;
  current_level: number | null;
  level_started_at?: string | null;
  blind_structure?: unknown;
  on_break?: boolean | null;
  break_started_at?: string | null;
  add_on_available?: boolean | null;
  addon_from_start?: boolean | null;
  addon_period_started_at?: string | null;
  addon_period_ends_at?: string | null;
}

/** Owner 2026-11-13: horses jump in within the last twenty minutes (was ten). */
export const OVERLAY_RESCUE_WINDOW_MS = 20 * 60_000;

/** The actual open registration door remains authoritative, including pauses. */
export function horseOverlayRescueDue(t: OverlayRescueClock, nowMs: number): boolean {
  const rescueWindowMs = OVERLAY_RESCUE_WINDOW_MS;
  const addOn = t.add_on_available === true;
  if (addOn) {
    const end = Date.parse(t.addon_period_ends_at ?? '');
    const start = Date.parse(t.addon_period_started_at ?? '');
    const legacyEarlyOffer = t.addon_from_start === true && end - start > ADDON_BREAK_MS;
    if (Number.isFinite(end) && !legacyEarlyOffer) return end - nowMs <= rescueWindowMs;
  }

  const levels = Number(t.late_reg_levels ?? t.rebuy_levels ?? 0);
  const index = Number(t.current_level ?? 0);
  // Once the entry levels end, the manager parks tables before stamping the final minute.
  if (addOn && levels > 0 && index >= levels) return true;

  const deadlines: number[] = [];
  const started = Date.parse(t.started_at ?? '');
  // Add-on events with entry levels reach the closing minute at the level boundary.
  if ((!addOn || levels <= 0) && (t.late_reg_mins ?? 0) > 0 && Number.isFinite(started))
    deadlines.push(started + t.late_reg_mins! * 60_000 - nowMs);

  const total = mttLevelWindowMs(t.blind_structure, levels);
  const elapsedLevels = index === 0 ? 0 : mttLevelWindowMs(t.blind_structure, index);
  const levelStarted = Date.parse(t.level_started_at ?? '');
  if (total !== undefined && elapsedLevels !== undefined && index >= 0 && index < levels) {
    // current_level is a zero-based index. Do not burn a paused blind clock.
    const clockAt = t.on_break ? Date.parse(t.break_started_at ?? '') : nowMs;
    const elapsed =
      Number.isFinite(clockAt) && Number.isFinite(levelStarted)
        ? Math.max(0, clockAt - levelStarted)
        : 0;
    deadlines.push(total - elapsedLevels - elapsed);
  }

  const closingMinute = addOn ? ADDON_BREAK_MS : 0;
  return deadlines.length > 0 && Math.min(...deadlines) + closingMinute <= rescueWindowMs;
}

/** Count only net player funding; a house transfer cannot replace attendance. */
export function horseOverlayRescueEntries(funding: unknown, netEntry: number): number {
  const entryCents = Math.round(netEntry * 100);
  if (
    !Number.isSafeInteger(entryCents) ||
    entryCents <= 0 ||
    !funding ||
    typeof funding !== 'object' ||
    !Number.isFinite(netEntry) ||
    netEntry <= 0
  )
    throw new Error('Invalid Horse overlay funding');
  const f = funding as Record<string, unknown>;
  const guarantee = Number(f.guarantee);
  const coverage = Number(f.net_coverage);
  if (
    f.guarantee === null ||
    f.guarantee === undefined ||
    f.net_coverage === null ||
    f.net_coverage === undefined ||
    !Number.isFinite(guarantee) ||
    !Number.isFinite(coverage) ||
    guarantee < 0 ||
    coverage < 0
  )
    throw new Error('Net Horse overlay coverage is unavailable');
  return Math.ceil(Math.max(0, Math.round((guarantee - coverage) * 100)) / entryCents);
}
