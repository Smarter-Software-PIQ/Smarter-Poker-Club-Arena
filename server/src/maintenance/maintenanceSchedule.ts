import sourcePolicy from './maintenanceSchedulePolicy.json' with { type: 'json' };

/** Temporary owner order; completing/off source restores the retained daily baseline. */
export type MaintenanceFrequency = 'daily' | 'phase1-hourly';
export function maintenanceFrequency(policy: unknown = sourcePolicy): MaintenanceFrequency {
  if (!policy || typeof policy !== 'object') throw new Error('maintenance_schedule_policy_invalid');
  const p = policy as Record<string, unknown>;
  if (
    Object.keys(p).sort().join(',') !==
      ['schema', 'policyId', 'timeZone', 'phase1Status', 'ownerMessageId', 'completionEvidence']
        .sort()
        .join(',') ||
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
const chicago = new Intl.DateTimeFormat('en-US', {
  timeZone: MAINTENANCE_TIME_ZONE,
  hour: '2-digit',
  hourCycle: 'h23',
});
const DAY_MS = 24 * 60 * 60 * 1000;
export interface ScheduledMaintenanceWindow {
  announcedAt: number;
  startsAt: number;
  endsAt: number;
}

/** 04:00 is neither skipped nor repeated on either Chicago DST transition. */
export function nearbyMaintenanceWindows(
  at: number,
  frequency: MaintenanceFrequency = MAINTENANCE_FREQUENCY
): ScheduledMaintenanceWindow[] {
  if (frequency === 'phase1-hourly') {
    const hour = Math.floor(at / 3_600_000) * 3_600_000;
    // Enumerate real epoch hours: both repeated Chicago fall-back hours are
    // distinct cycles, and the nonexistent spring-forward hour is not invented.
    return [-1, 0, 1, 2].map((offset) => {
      const startsAt = hour + offset * 3_600_000;
      return { announcedAt: startsAt - 120_000, startsAt, endsAt: startsAt + 300_000 };
    });
  }
  const midnight = Math.floor(at / DAY_MS) * DAY_MS;
  const windows: ScheduledMaintenanceWindow[] = [];
  for (let day = -1; day <= 2; day++) {
    // Chicago is UTC-5 or UTC-6. Validate with IANA rules, never the host TZ.
    for (const utcHour of [9, 10]) {
      const startsAt = midnight + day * DAY_MS + utcHour * 60 * 60 * 1000;
      if (Number(chicago.format(startsAt)) !== MAINTENANCE_START_HOUR) continue;
      windows.push({
        announcedAt: startsAt - 2 * 60 * 1000,
        startsAt,
        endsAt: startsAt + 5 * 60 * 1000,
      });
    }
  }
  return windows.sort((a, b) => a.startsAt - b.startsAt);
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
