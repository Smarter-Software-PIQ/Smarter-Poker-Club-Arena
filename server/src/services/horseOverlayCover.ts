/**
 * OVERLAY COVER HAS FIRST CLAIM ON EVERY HORSE (owner 2026-11-13).
 *
 * Dan, after the Nightly 20K paid a 7,295 overlay with 195 entries: "ANY AND
 * ALL HORSES SHOULD BE ACTIVATED AT ALL TIMES, REGUARDLESS OF TIME OFF OR DAY
 * OFF IF THERE IS EVER AN OVERLAY THAT NEEDS TO BE FILLED! HORSES MUST JUMP IN
 * WITHIN THE LAST 20 MINUTES", and "HORSES ARE SUPPOSED TO PLAY 2 CASH GAMES
 * AND 2 TOURNAMENTS. NOT 4 CASH GAMES. HORSES MUST LEAVE A CASH GAME AND PLAY
 * A TOURNAMENT IF A OVERLAY IS POSSIBLE!"
 *
 * Measured that night: the guard asked for 40 horses a cycle in the final ten
 * minutes and was given 2 or 3. It drew only from horses inside their activity
 * window and not on a rest day (about 510 of 1,000); the Free Buy (440), a
 * cash floor that had grown from 33 seats to 477 (165 horses, most at three or
 * four tables) and nine other events held those at the four-game limit, while
 * about 480 off-shift and rest-day horses held nothing.
 *
 * A horse this module calls gives up ONE cash seat through the ordinary leave
 * door, which frees a game for the registration the next cycle makes. The
 * four-game limit itself is the database's and is the same for every player.
 */

/** How long a call stands: a few rotator cycles, well inside the 20 minutes. */
export const OVERLAY_CALL_TTL_MS = 6 * 60_000;

const calls = new Map<string, number>();

/** Ask these horses to free one cash seat for an event that is short. */
export function callHorsesFromCash(ids: Iterable<string>, nowMs: number = Date.now()): number {
  let called = 0;
  for (const id of ids) {
    if (!id) continue;
    calls.set(id, nowMs + OVERLAY_CALL_TTL_MS);
    called++;
  }
  return called;
}

/** Is this horse asked to leave a cash seat right now? Expired calls lapse. */
export function overlayCalled(id: string, nowMs: number = Date.now()): boolean {
  const until = calls.get(id);
  if (until === undefined) return false;
  if (until <= nowMs) {
    calls.delete(id);
    return false;
  }
  return true;
}

/** The horse left a cash seat (or entered the event): the call is answered. */
export function overlayCallAnswered(id: string): void {
  calls.delete(id);
}

/** Test seam. */
export function resetOverlayCalls(): void {
  calls.clear();
}

/**
 * Pure: who to call. Horses at the game limit that are not in the event, in
 * the caller's order, twice the seats still missing (not every call frees a
 * seat: some hold no cash seat, some owe hands before they may leave).
 */
export function overlayCashCallList(
  atLimitNotEntered: readonly string[],
  stillMissing: number
): string[] {
  const want = Math.max(0, Math.floor(stillMissing)) * 2;
  return atLimitNotEntered.slice(0, want);
}
