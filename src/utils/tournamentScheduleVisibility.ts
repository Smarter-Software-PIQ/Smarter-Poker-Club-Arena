/** Active schedule only. History, receipts and direct tournament routes stay intact. */
export interface ScheduleVisibilityRow {
  status?: string | null;
  start_time?: string | null;
  started_at?: string | null;
}
const chicagoDay = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
/** Future scheduled events, or events whose actual play began today. */
export function isCurrentMttScheduleEvent(row: ScheduleVisibilityRow, now = Date.now()): boolean {
  if (!Number.isFinite(now)) return false;
  const status = String(row.status ?? '').toUpperCase();
  if (['COMPLETED', 'CANCELLED', 'CANCELED', 'COMPLETING'].includes(status)) return false;
  const started = Date.parse(row.started_at ?? '');
  const running = [
    'RUNNING',
    'IN_PROGRESS',
    'LATE_REG',
    'LATE_REGISTRATION',
    'BREAK',
    'BAGGED',
  ].includes(status);
  // Launch completion seats the field before dealing and persists its
  // advertised start while already RUNNING. Keep that future scheduled
  // event visible through preparation, including across Chicago midnight.
  const scheduled = Date.parse(row.start_time ?? '');
  if (running && Number.isFinite(started) && started > now && started === scheduled) return true;
  if (Number.isFinite(started) || running) {
    const actualStart = Number.isFinite(started) ? started : Date.parse(row.start_time ?? '');
    return (
      Number.isFinite(actualStart) &&
      actualStart <= now &&
      chicagoDay.format(actualStart) === chicagoDay.format(now)
    );
  }
  return Number.isFinite(scheduled) && scheduled >= now;
}
