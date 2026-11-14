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
/** When each standing call was first made, for the answer-time evidence. */
const calledAt = new Map<string, number>();
const answerMs: number[] = [];
let callsMade = 0;
let callsAnswered = 0;
let callsLapsed = 0;

/** Ask these horses to free one cash seat for an event that is short. */
export function callHorsesFromCash(ids: Iterable<string>, nowMs: number = Date.now()): number {
  let called = 0;
  for (const id of ids) {
    if (!id) continue;
    if (!calls.has(id)) {
      calledAt.set(id, nowMs);
      callsMade++;
    }
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
    calledAt.delete(id);
    callsLapsed++;
    return false;
  }
  return true;
}

/** The horse left a cash seat (or entered the event): the call is answered. */
export function overlayCallAnswered(id: string, nowMs: number = Date.now()): void {
  const since = calledAt.get(id);
  if (calls.delete(id) && since !== undefined) {
    callsAnswered++;
    answerMs.push(Math.max(0, nowMs - since));
    if (answerMs.length > 500) answerMs.shift();
  }
  calledAt.delete(id);
}

/** Test seam. */
export function resetOverlayCalls(): void {
  calls.clear();
  calledAt.clear();
  answerMs.length = 0;
  callsMade = callsAnswered = callsLapsed = 0;
  shortEvents.clear();
  lastCover.clear();
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

/* ── A SHORT GUARANTEE IS KNOWN TO THE WHOLE ENGINE ─────────────────────────
   The guard reads net coverage every cycle (fn_ca_guarantee_funding) and
   records which running events are still short. The tournament manager reads
   it when a horse decides a rebuy or an add-on: an entrant already in a short
   event buying again is cover that needs no free horse (owner 2026-11-13,
   "FULLY BUILD ... ALL OF THESE": rebuys and add-ons as cover). A mark lapses
   on its own, so a guard that stops running cannot leave horses rebuying at
   the cover rate for ever. */
export const SHORT_MARK_TTL_MS = 5 * 60_000;
const shortEvents = new Map<string, { missing: number; until: number }>();

/** The guard's reading for one event this cycle. Zero or less clears it. */
export function markGuaranteeShort(
  tournamentId: string,
  missingEntries: number,
  nowMs: number = Date.now()
): void {
  if (!tournamentId) return;
  const missing = Math.floor(Number(missingEntries) || 0);
  if (missing > 0) shortEvents.set(tournamentId, { missing, until: nowMs + SHORT_MARK_TTL_MS });
  else shortEvents.delete(tournamentId);
}

/** Is this event's guarantee still uncovered, by the guard's latest reading? */
export function guaranteeShortNow(
  tournamentId: string | null | undefined,
  nowMs: number = Date.now()
): boolean {
  if (!tournamentId) return false;
  const mark = shortEvents.get(tournamentId);
  if (!mark) return false;
  if (mark.until <= nowMs) {
    shortEvents.delete(tournamentId);
    return false;
  }
  return true;
}

/**
 * Pure: entries to add THIS cycle so cover keeps pace with the registration
 * window instead of arriving in one burst at the end (a field that jumps by
 * two hundred in its last minutes reads as staged). At progress p the event
 * should hold p of the entries its guarantee needs; the step is bounded so the
 * catch-up is a stream, and the final twenty minutes still ask for the rest.
 */
export const COVER_PACE_MAX_STEP = 12;
export function coveragePaceEntries(p: {
  neededEntries: number;
  missingEntries: number;
  progress: number | null;
}): number {
  const needed = Math.floor(Number(p.neededEntries) || 0);
  const missing = Math.floor(Number(p.missingEntries) || 0);
  const progress = Number(p.progress);
  if (needed <= 0 || missing <= 0 || !Number.isFinite(progress) || progress <= 0) return 0;
  const covered = Math.max(0, needed - missing);
  const due = Math.ceil(needed * Math.min(1, progress));
  return Math.max(0, Math.min(COVER_PACE_MAX_STEP, due - covered, missing));
}

/* ── EVIDENCE, read by /health ──────────────────────────────────────────────
   Counts only. `lastCover` is what the registration pool looked like the last
   time each event asked for cover, so a short event can be explained from the
   outside without engine logs - the 2026-11-13 overlay could not be. */
export interface OverlayCoverPool {
  asked: number;
  free: number;
  atLimit: number;
  cannotPay: number;
  at: string;
}
const lastCover = new Map<string, OverlayCoverPool>();

export function recordOverlayCoverPool(
  tournamentId: string,
  pool: Omit<OverlayCoverPool, 'at'>,
  nowMs: number = Date.now()
): void {
  lastCover.set(tournamentId, { ...pool, at: new Date(nowMs).toISOString() });
  if (lastCover.size > 50) lastCover.delete(lastCover.keys().next().value as string);
}

export function overlayCoverPoolFor(tournamentId: string): OverlayCoverPool | undefined {
  return lastCover.get(tournamentId);
}

export function overlayCoverEvidence(nowMs: number = Date.now()) {
  const sorted = [...answerMs].sort((a, b) => a - b);
  const median = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : null;
  const worst = sorted.length > 0 ? sorted[sorted.length - 1] : null;
  return {
    shortEvents: [...shortEvents.entries()]
      .filter(([, mark]) => mark.until > nowMs)
      .map(([id, mark]) => ({ tournament: id.slice(0, 8), missingEntries: mark.missing })),
    cashCalls: {
      made: callsMade,
      answered: callsAnswered,
      lapsed: callsLapsed,
      standing: calls.size,
      medianAnswerMs: median,
      slowestAnswerMs: worst,
    },
    lastCover: [...lastCover.entries()].map(([id, pool]) => ({
      tournament: id.slice(0, 8),
      ...pool,
    })),
  };
}
