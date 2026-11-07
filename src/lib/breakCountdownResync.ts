/**
 * A BREAK'S COUNTDOWN STARTS ON A CLEAN FELT (Dan 2026-11-06).
 *
 * "ANY AND ALL SCHEDULED BREAKS OR MAINTENANCE BREAKS MUST FINISH THE CURRENT
 * HAND THEY ARE ON, BEFORE THE BREAK STARTS."
 *
 * A tournament break's countdown begins only once every table of the
 * tournament has finished its hand and parked, and the engine parks a table
 * only after its hand-free broadcast (ServerTableEngineDealing). A client that
 * missed that broadcast - a socket replaced between the hand's last action
 * and the park, a background tab, a spectator joining as the hand settled -
 * would otherwise keep the hand's last action on the felt for the whole break
 * (bets in front, ALL IN, an unpushed pot), which reads as a break that
 * started in the middle of the hand.
 *
 * So the moment a countdown is first known on this client, it asks the engine
 * for one authoritative snapshot. The answer is the parked table: no hand in
 * progress, stacks credited. Exactly one request per countdown: the key is the
 * countdown's end instant, so a re-render, a repeated broadcast or a recovery
 * read of the same break never asks twice, and a later break asks again.
 * The maintenance break's countdown is handled the same way.
 */
export interface BreakCountdownView {
  active: boolean;
  phase?: string;
  breakEndsAtMs?: number | null;
}

/** The identity of a running countdown, or null when none is running. */
export function breakCountdownKey(view: BreakCountdownView | null | undefined): number | null {
  if (!view || !view.active || view.phase !== 'counting_down') return null;
  const end = view.breakEndsAtMs;
  return typeof end === 'number' && Number.isFinite(end) && end > 0 ? end : null;
}

/**
 * True when `next` is a countdown this client has not yet resynchronised for.
 * `lastKey` is the key of the countdown last resynchronised (or null).
 */
export function shouldResyncAtBreakCountdown(
  lastKey: number | null,
  next: BreakCountdownView | null | undefined
): boolean {
  const key = breakCountdownKey(next);
  return key !== null && key !== lastKey;
}
