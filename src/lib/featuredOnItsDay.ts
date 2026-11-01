/**
 * Only today's host-selected top events float above the normal schedule.
 * Owner update October 31, 2026 supersedes the old weekly/single-instance
 * exception. Future editions remain visible as ordinary rows; started status
 * and the number of editions returned by a filter never grant a pin.
 * "Today" uses the viewer's local calendar, matching the displayed start time.
 * No database flags or tournament records are changed.
 */

export interface PinFacts {
  /** True when the host pinned/featured it (`is_pinned`). */
  pinned: boolean;
  /** True once it has started: running, late registration, bagged overnight. */
  started: boolean;
  /** ISO start time, or null when it has none. */
  startTime: string | null;
  /** The owning club, so two clubs' events of the same name stay separate. */
  clubId: string | null | undefined;
  name: string;
}

/** Same series = same club and same name, ignoring case, spacing and punctuation. */
export function seriesKey(f: Pick<PinFacts, 'clubId' | 'name'>): string {
  const name = (f.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return `${f.clubId ?? ''}|${name}`;
}

/** True when `iso` falls on the same local calendar day as `now`. */
export function startsOnDay(iso: string | null, now: Date): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

/**
 * The rows that should float as FEATURED right now. Rows the host never pinned
 * are never in the set.
 */
export function featuredNow<T>(
  rows: readonly T[],
  read: (row: T) => PinFacts,
  now: Date = new Date()
): Set<T> {
  const keep = new Set<T>();
  for (const row of rows) {
    const facts = read(row);
    if (facts.pinned && startsOnDay(facts.startTime, now)) keep.add(row);
  }
  return keep;
}

/** Tournament statuses (any case) that mean the event is already under way. */
export function hasStarted(status: string | null | undefined): boolean {
  const s = String(status || '').toLowerCase();
  return (
    s === 'running' || s === 'late_reg' || s === 'bagged' || s === 'paused' || s === 'final_table'
  );
}
