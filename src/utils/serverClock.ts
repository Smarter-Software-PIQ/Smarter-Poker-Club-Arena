/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  serverClock — translate between this device's clock and the engine's
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * WHY
 *
 * Dan, 2026-08-18: "make sure the yellow countdown actually takes 15 seconds."
 *
 * The engine was never wrong about the duration. Every table has
 * action_time_seconds = 15, and it publishes an absolute deadline
 * (turn_deadline_ms) computed from it. The client then worked out how much of
 * the turn had already elapsed as:
 *
 *     elapsedMs = Date.now() - turn_start_time_ms
 *
 * which subtracts a SERVER timestamp from a CLIENT one. Those are two different
 * clocks. A device running three seconds fast reports three seconds elapsed the
 * instant the turn begins, so the ring starts part-drained and empties in
 * twelve; a device running slow overruns. Phones drift, VMs suspend, and a
 * hand-set clock can be off by minutes.
 *
 * The DURATION was always safe, because `turn_deadline_ms - turn_start_time_ms`
 * subtracts two server timestamps and the offset cancels. Only the elapsed
 * calculation was cross-clock.
 *
 * HOW
 *
 * The engine now stamps every state broadcast with its own `server_time_ms`.
 * On arrival we compare it to the local clock; the difference is the offset,
 * plus a little network latency.
 *
 * ── LATENCY SIGN CORRECTION 2026-08-28 ──
 *
 * This block used to claim that latency "always errs the safe way ... so the
 * ring never claims time the player does not have". The arithmetic does the
 * OPPOSITE, and on the action clock that is the expensive direction. Writing
 * it out, with L = one-way latency and D = the true offset (client ahead of
 * server):
 *
 *     sample      = Date.now() - server_time_ms = D + L
 *     serverNow() = Date.now() - offset         = trueServerNow - L
 *     remaining   = deadline - serverNow()      = trueRemaining + L
 *
 * So the countdown ran one latency BEHIND the engine and displayed time that
 * did not exist. A player acting on the last instant the ring showed them
 * could be folded by a deadline that had already passed.
 *
 * Every one-way sample overstates the offset by its own latency, so no amount
 * of smoothing removes it — averaging just bakes in the AVERAGE latency, and
 * jitter makes that worse than the best sample. The estimator now takes the
 * MINIMUM latency sample (Cristian's algorithm): the smallest
 * latency observed is the closest a one-way sample can get to the true offset.
 * That shrinks the residual from average-plus-jitter to one best-case
 * latency, and it is the tightest correction available without a round trip.
 *
 * A proven minimum must not expire into a delayed packet. The former
 * sixty-second reset turned an eight-second frame backlog into seven seconds
 * of extra add-on countdown (2026-11-06). Preserve the minimum, translating it
 * only by independently observed wall-clock movement relative to monotonic
 * time. Adopt a better sample immediately rather than smoothing away its proof.
 *
 * Apply that translation only when a server sample arrives. performance.now
 * can pause during OS sleep on some platforms: reads must keep advancing by
 * wall time, and the fresh advancing server sample after wake selects the
 * smaller current offset instead of retaining the apparent wall-clock jump.
 * Before the first sample, serverNow() remains the device clock.
 */

/** Ignore absurd samples (bad payload, or a clock caught mid-adjustment). */
const MAX_PLAUSIBLE_OFFSET_MS = 24 * 60 * 60 * 1000;

let offsetMs = 0;
let haveSample = false;
let lastWallMs = 0;
let lastMonotonicMs = 0;

/**
 * Feed the `server_time_ms` from a state snapshot.
 * Safe to call on every snapshot: cheap, allocation-free, ignores junk.
 */
export function recordServerTime(serverTimeMs: number | undefined | null): void {
  if (typeof serverTimeMs !== 'number' || !Number.isFinite(serverTimeMs) || serverTimeMs <= 0) {
    return;
  }
  const now = Date.now();
  const sample = now - serverTimeMs;
  if (Math.abs(sample) > MAX_PLAUSIBLE_OFFSET_MS) return;
  const monotonic = performance.now();
  if (!haveSample) {
    offsetMs = sample;
    haveSample = true;
  } else {
    // Network latency cannot explain a wall/monotonic clock difference. A
    // genuine device correction moves the old baseline and the new sample
    // together; a sleep-paused monotonic clock is resolved by the fresh sample.
    const wallShift = now - lastWallMs - (monotonic - lastMonotonicMs);
    offsetMs = Math.min(offsetMs + wallShift, sample);
  }
  lastWallMs = now;
  lastMonotonicMs = monotonic;
}

/**
 * ═══ ONE CLOCK (Realtime Phase 5, 2026-09-06) ══════════════════════════════
 *
 * `noteServerTime` is the same estimator under the name `lib/serverClock` used
 * before it was folded in here, and it exists because for one day this app had
 * TWO functions called `serverNow()` with OPPOSITE SIGNS:
 *
 *   utils/serverClock (2026-08-18)  offset = Date.now() - serverTime
 *                                   serverNow() = Date.now() - offset
 *   lib/serverClock   (2026-09-05)  offset = serverTime - Date.now()
 *                                   serverNow() = Date.now() + offset
 *
 * Same name, same meaning, inverted arithmetic. Whichever module a file
 * happened to import decided which clock it got, both compiled, and both
 * returned a plausible number - so one wrong import path would have turned a
 * three-second-fast phone into a three-second-SLOW one and doubled the error
 * on a turn clock, silently.
 *
 * The two also had different quality and, worse, the wrong one had the better
 * feed. `utils` is latency-corrected (Cristian's algorithm, see the header
 * above) and was fed only by SNAPSHOTS; `lib` ignored latency on purpose and
 * was fed by every EVENT and PING frame. So the accurate estimator got the
 * fewest samples and drove the TURN RING, while the rough one got a sample
 * every twenty-five seconds and drove the jackpot freshness gate.
 *
 * Folding them together keeps the better estimator and gives it the better
 * feed. `lib/serverClock.ts` is deleted; a law pins that exactly one
 * `serverNow` exists.
 *
 * The one thing that does NOT carry over is "latency is ignored on purpose".
 * That reasoning was written for a ninety-second freshness gate and is wrong
 * for a fifteen-second turn: the 2026-08-28 note above is about a countdown
 * that showed time the player did not have.
 */
export function noteServerTime(serverTimeMs: unknown): void {
  if (typeof serverTimeMs !== 'number') return;
  recordServerTime(serverTimeMs);
}

/** Current time on the ENGINE's clock, in epoch ms. */
export function serverNow(): number {
  return Date.now() - offsetMs;
}

/** How far this device's clock is ahead of the engine's, in ms. Positive = ahead. */
export function clockOffsetMs(): number {
  return haveSample ? offsetMs : 0;
}

/** Test seam. */
export function __resetServerClock(): void {
  offsetMs = 0;
  haveSample = false;
  lastWallMs = 0;
  lastMonotonicMs = 0;
}
