/**
 * THE BUST REBUY SHEET'S CLOCK (Dan 2026-11-09, 2026-11-11).
 *
 * The engine owns the deadline: bust time plus twenty seconds. It tells the
 * player how much is LEFT in a private `bust_rebuy_window` frame, at the bust
 * and again whenever the open sheet's heartbeat asks, and it names the bust
 * by the deadline on its own clock (`deadline_at_ms`). This decides what one
 * frame does to the clock the sheet shows.
 *
 * - The sheet counts on this device's clock ("time left when told" plus
 *   now), so a wrong device clock cannot skew it. Server deadlines are only
 *   ever compared with each other, never with this device's clock.
 * - Within one bust the clock may come forward, never go back: a resend, a
 *   reconnect or a reload is told what is left, not a fresh twenty.
 * - A later bust replaces the clock. A frame for an EARLIER bust (delivered
 *   late) is ignored, so it can neither shorten nor stretch the current one.
 * - A frame for a seat that has chips is not a bust: ignored, so it cannot
 *   leave a stale deadline behind for the next one.
 */

/** Two busts of one seat are at least a hand apart; resends of one bust,
 *  even across an engine restart, agree to well inside this. */
export const BUST_EPISODE_GAP_MS = 5_000;

export interface BustRebuyClock {
  /** This device's deadline, shown by the sheet. Null = no window. */
  localDeadlineAt: number | null;
  /** The engine's deadline of the bust this clock belongs to. Kept after the
   *  window closes so a late frame of that bust is still recognised. */
  serverDeadlineAt: number | null;
}

export interface BustRebuyFrame {
  remaining_ms?: unknown;
  deadline_at_ms?: unknown;
}

/** The clock after `frame`, or null when the frame changes nothing. */
export function nextBustRebuyClock(
  prev: BustRebuyClock,
  frame: BustRebuyFrame,
  nowLocal: number,
  heroStack: number | null | undefined
): BustRebuyClock | null {
  const remainingMs = Number(frame.remaining_ms);
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return null;
  if (heroStack !== null && heroStack !== undefined && Number(heroStack) > 0) return null;
  const told = nowLocal + remainingMs;
  const server = Number(frame.deadline_at_ms);
  if (!Number.isFinite(server) || server <= 0) {
    // An engine that does not name the bust: one deadline, never pushed back.
    const local = prev.localDeadlineAt === null ? told : Math.min(prev.localDeadlineAt, told);
    return { localDeadlineAt: local, serverDeadlineAt: prev.serverDeadlineAt };
  }
  const known = prev.serverDeadlineAt;
  if (known !== null && server < known - BUST_EPISODE_GAP_MS) return null; // an earlier bust
  if (known === null || server > known + BUST_EPISODE_GAP_MS) {
    return { localDeadlineAt: told, serverDeadlineAt: server }; // a new bust
  }
  // The same bust: forward only.
  const local = prev.localDeadlineAt === null ? told : Math.min(prev.localDeadlineAt, told);
  return { localDeadlineAt: local, serverDeadlineAt: Math.min(known, server) };
}
