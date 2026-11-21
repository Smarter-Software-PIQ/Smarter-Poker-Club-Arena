import sourcePolicy from './maintenanceSchedulePolicy.json' with { type: 'json' };

/**
 * Routine engine maintenance frequency, selected by protected source only.
 *
 * - 'daily': the 04:00 America/Chicago baseline (owner direction 2026-11-06).
 * - 'phase1-hourly': the revoked temporary Phase1 exception (v1 policy only).
 * - 'three-hourly': owner order 2026-11-21 02:22 Chicago (session
 *   session_01Gw7aDsC1z7GdpSYmDAM2kv), "I WANT A ENGINE CUT OVER EVERY 3
 *   HOURS": a dedicated certified cutover at 01, 04, 07, 10, 13, 16, 19 and 22
 *   America/Chicago. 04:00 stays an anchor. Reverting is one field: set the v2
 *   policy's `frequency` to 'daily'.
 */
export type MaintenanceFrequency = 'daily' | 'phase1-hourly' | 'three-hourly';
export const THREE_HOURLY_SLOT_HOURS: readonly number[] = Object.freeze([
  1, 4, 7, 10, 13, 16, 19, 22,
]);
export const THREE_HOURLY_POLICY_ID = 'three-hourly-01Gw7aDs';
export const THREE_HOURLY_OWNER_SESSION = 'session_01Gw7aDsC1z7GdpSYmDAM2kv';
const V1_KEYS = [
  'schema',
  'policyId',
  'timeZone',
  'phase1Status',
  'ownerMessageId',
  'completionEvidence',
];
const V2_KEYS = [
  'schema',
  'policyId',
  'timeZone',
  'frequency',
  'startHours',
  'phase1Status',
  'ownerMessageId',
  'ownerOrderAt',
  'ownerOrder',
  'completionEvidence',
];
const sameKeys = (p: Record<string, unknown>, keys: string[]) =>
  Object.keys(p).sort().join(',') === [...keys].sort().join(',');

export function maintenanceFrequency(policy: unknown = sourcePolicy): MaintenanceFrequency {
  if (!policy || typeof policy !== 'object') throw new Error('maintenance_schedule_policy_invalid');
  const p = policy as Record<string, unknown>;
  if (p.schema === 'engine-maintenance-schedule/v2') {
    if (
      !sameKeys(p, V2_KEYS) ||
      p.policyId !== THREE_HOURLY_POLICY_ID ||
      p.timeZone !== 'America/Chicago' ||
      (p.frequency !== 'daily' && p.frequency !== 'three-hourly') ||
      !Array.isArray(p.startHours) ||
      p.startHours.join(',') !== THREE_HOURLY_SLOT_HOURS.join(',') ||
      p.phase1Status !== 'off' ||
      p.ownerMessageId !== THREE_HOURLY_OWNER_SESSION ||
      p.ownerOrderAt !== '2026-11-21T02:22:00-06:00' ||
      typeof p.ownerOrder !== 'string' ||
      !p.ownerOrder.includes('I WANT A ENGINE CUT OVER EVERY 3 HOURS.') ||
      typeof p.completionEvidence !== 'string' ||
      p.completionEvidence.trim().length < 12
    )
      throw new Error('maintenance_schedule_policy_invalid');
    return p.frequency as MaintenanceFrequency;
  }
  if (
    !sameKeys(p, V1_KEYS) ||
    typeof p.phase1Status !== 'string' ||
    p.schema !== 'engine-maintenance-schedule/v1' ||
    p.policyId !== 'phase1-hourly-01a1944f' ||
    p.timeZone !== 'America/Chicago' ||
    p.ownerMessageId !== '01a1944f-7131-7f11-8dcc-873d576e781c' ||
    !['active', 'complete', 'off'].includes(p.phase1Status) ||
    (p.phase1Status !== 'active' &&
      (typeof p.completionEvidence !== 'string' || p.completionEvidence.trim().length < 12)) ||
    (p.phase1Status === 'active' && p.completionEvidence !== null)
  )
    throw new Error('maintenance_schedule_policy_invalid');
  return p.phase1Status === 'active' ? 'phase1-hourly' : 'daily';
}
export const MAINTENANCE_FREQUENCY = maintenanceFrequency();
export const MAINTENANCE_POLICY_ID = sourcePolicy.policyId;
export const MAINTENANCE_TIME_ZONE = 'America/Chicago';
export const MAINTENANCE_START_HOUR = 4;
/** The Chicago local hours on which a routine window starts for `frequency`. */
export function maintenanceSlotHours(
  frequency: MaintenanceFrequency = MAINTENANCE_FREQUENCY
): number[] | null {
  if (frequency === 'phase1-hourly') return null;
  return frequency === 'three-hourly' ? [...THREE_HOURLY_SLOT_HOURS] : [MAINTENANCE_START_HOUR];
}
const chicago = new Intl.DateTimeFormat('en-US', {
  timeZone: MAINTENANCE_TIME_ZONE,
  hour: '2-digit',
  hourCycle: 'h23',
});
const HOUR_MS = 60 * 60 * 1000;
export interface ScheduledMaintenanceWindow {
  announcedAt: number;
  startsAt: number;
  endsAt: number;
}
const windowAt = (startsAt: number): ScheduledMaintenanceWindow => ({
  announcedAt: startsAt - 2 * 60 * 1000,
  startsAt,
  endsAt: startsAt + 5 * 60 * 1000,
});

/**
 * Enumerate REAL epoch hours and keep those whose Chicago local hour is a slot.
 * Chicago's offset is a whole number of hours, so minute 0 UTC is minute 0
 * Chicago. Never the host TZ. DST: the nonexistent spring-forward hour is never
 * invented, and the repeated fall-back hour yields ONE window, the first.
 */
function slotWindows(at: number, slots: readonly number[], fromHours: number, toHours: number) {
  const hour = Math.floor(at / HOUR_MS) * HOUR_MS;
  const windows: ScheduledMaintenanceWindow[] = [];
  for (let offset = fromHours; offset <= toHours; offset++) {
    const startsAt = hour + offset * HOUR_MS;
    const local = Number(chicago.format(startsAt));
    if (!slots.includes(local)) continue;
    // Second occurrence of a repeated local hour (fall back): not a new slot.
    if (Number(chicago.format(startsAt - HOUR_MS)) === local) continue;
    windows.push(windowAt(startsAt));
  }
  return windows;
}

/** 04:00 is neither skipped nor repeated on either Chicago DST transition. */
export function nearbyMaintenanceWindows(
  at: number,
  frequency: MaintenanceFrequency = MAINTENANCE_FREQUENCY
): ScheduledMaintenanceWindow[] {
  if (frequency === 'phase1-hourly') {
    const hour = Math.floor(at / HOUR_MS) * HOUR_MS;
    // Enumerate real epoch hours: both repeated Chicago fall-back hours are
    // distinct cycles, and the nonexistent spring-forward hour is not invented.
    return [-1, 0, 1, 2].map((offset) => windowAt(hour + offset * HOUR_MS));
  }
  if (frequency === 'three-hourly') {
    // Slots are at most four real hours apart (fall back), so -5..+9 always
    // holds the previous, current and next two windows.
    return slotWindows(at, THREE_HOURLY_SLOT_HOURS, -5, 9);
  }
  return slotWindows(at, [MAINTENANCE_START_HOUR], -25, 49);
}
export function scheduledMaintenanceAt(
  at: number,
  frequency: MaintenanceFrequency = MAINTENANCE_FREQUENCY
): ScheduledMaintenanceWindow | null {
  return (
    nearbyMaintenanceWindows(at, frequency).find((w) => at >= w.announcedAt && at < w.endsAt) ??
    null
  );
}
export function nextMaintenanceAnnouncement(
  at: number,
  frequency: MaintenanceFrequency = MAINTENANCE_FREQUENCY
): number {
  const next = nearbyMaintenanceWindows(at, frequency).find((w) => w.announcedAt > at);
  if (!next) throw new Error('daily_maintenance_schedule_unresolvable');
  return next.announcedAt;
}
