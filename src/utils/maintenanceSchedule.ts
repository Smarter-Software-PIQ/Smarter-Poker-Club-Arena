/** Heads-up only. The engine's actual maintenance event owns freeze/release. */
export const PHASE1_MAINTENANCE_POLICY_ID = 'phase1-hourly-01a1944f';
export type RoutineMaintenanceSchedule = 'daily' | 'phase1-hourly' | 'unknown';

/** Validate the serving protocol, never the desired source policy's active/off flag. */
export function observedMaintenanceSchedule(value: unknown): RoutineMaintenanceSchedule {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'unknown';
  const schedule = value as Record<string, unknown>;
  if (
    schedule.timeZone !== 'America/Chicago' ||
    schedule.startMinute !== 0 ||
    schedule.durationMs !== 300000 ||
    typeof schedule.nextAnnouncementAt !== 'number' ||
    !Number.isFinite(schedule.nextAnnouncementAt) ||
    schedule.nextAnnouncementAt <= 0
  )
    return 'unknown';
  const legacy = schedule.frequency === undefined && schedule.policyId === undefined;
  const known = schedule.policyId === PHASE1_MAINTENANCE_POLICY_ID;
  if (
    (legacy || (known && schedule.frequency === 'daily')) &&
    schedule.startHour === 4 &&
    schedule.hourlyCashFreeze === false
  )
    return 'daily';
  if (
    known &&
    schedule.frequency === 'phase1-hourly' &&
    schedule.startHour === null &&
    schedule.hourlyCashFreeze === true
  )
    return 'phase1-hourly';
  return 'unknown';
}

const chicagoClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
export function isRoutineMaintenanceUpcoming(
  at: number,
  schedule: RoutineMaintenanceSchedule = 'daily'
): boolean {
  if (!Number.isFinite(at) || schedule === 'unknown') return false;
  const parts = chicagoClock.formatToParts(at);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value);
  return (schedule === 'phase1-hourly' || hour === 3) && minute >= 55 && minute < 58;
}
