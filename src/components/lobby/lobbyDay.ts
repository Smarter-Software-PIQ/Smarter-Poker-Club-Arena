/**
 * THE LOBBY DAY (Dan 2026-11-11): "lobby info refreshed at 4 AM daily".
 *
 * Lobby statistics belong to the current maintenance day, which starts at the
 * daily 04:00 America/Chicago maintenance (server/src/maintenance/dailyWindow.ts
 * DAILY_WINDOW.windowStart; tests/unit/lobbyDay.test.ts pins the two equal).
 * Every lobby statistic that is an average over history is read only from
 * this boundary forward, so at 4 AM it resets and, while games are still
 * running, fills again from the hands dealt after 4 AM. Nothing is stored or
 * swept: the boundary is the reset, which is why a 442-hour-old figure can no
 * longer stand in for today's.
 */
export const LOBBY_DAY = { timeZone: 'America/Chicago', resetHour: 4 } as const;

const wallClock = new Intl.DateTimeFormat('en-US', {
  timeZone: LOBBY_DAY.timeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function chicagoParts(ms: number): {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
  s: number;
} {
  const parts = Object.fromEntries(
    wallClock.formatToParts(new Date(ms)).map((p) => [p.type, p.value])
  );
  return {
    y: Number(parts.year),
    m: Number(parts.month),
    d: Number(parts.day),
    h: Number(parts.hour),
    mi: Number(parts.minute),
    s: Number(parts.second),
  };
}

/** The UTC instant of a Chicago wall-clock time (04:00 is never in a DST gap). */
function chicagoInstant(y: number, m: number, d: number, h: number): number {
  const target = Date.UTC(y, m - 1, d, h);
  let at = target;
  // The offset is read at the estimate itself, twice, so a DST change between
  // the naive UTC guess and the real instant cannot leave it an hour off.
  for (let i = 0; i < 2; i++) {
    const p = chicagoParts(at);
    const wall = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
    at += target - wall;
  }
  return at;
}

/** The start of the lobby day containing `now`: the latest 04:00 Chicago at or before it. */
export function lobbyDayStart(now: Date): Date {
  const ms = now.getTime();
  const p = chicagoParts(ms);
  let start = chicagoInstant(p.y, p.m, p.d, LOBBY_DAY.resetHour);
  if (start > ms) {
    const prev = new Date(Date.UTC(p.y, p.m - 1, p.d) - 86_400_000);
    start = chicagoInstant(
      prev.getUTCFullYear(),
      prev.getUTCMonth() + 1,
      prev.getUTCDate(),
      LOBBY_DAY.resetHour
    );
  }
  return new Date(start);
}
