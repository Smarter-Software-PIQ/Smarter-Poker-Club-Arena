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
  addon_period_ends_at?: string | null;
}

/** The actual open registration door remains authoritative, including pauses. */
export function horseOverlayRescueDue(t: OverlayRescueClock, nowMs: number): boolean {
  const deadlines: number[] = [];
  if (t.add_on_available) {
    const end = Date.parse(t.addon_period_ends_at ?? '');
    // Add-on admission remains open until its actual cutoff has been published.
    if (!Number.isFinite(end)) return false;
    deadlines.push(end - nowMs);
  } else {
    const started = Date.parse(t.started_at ?? '');
    if ((t.late_reg_mins ?? 0) > 0 && Number.isFinite(started))
      deadlines.push(started + t.late_reg_mins! * 60_000 - nowMs);
    const levels = Number(t.late_reg_levels ?? t.rebuy_levels ?? 0);
    const index = Number(t.current_level ?? 0);
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
  }
  return deadlines.length > 0 && Math.min(...deadlines) <= 10 * 60_000;
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
