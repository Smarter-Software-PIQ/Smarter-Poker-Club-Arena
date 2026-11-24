/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE SEAT-FIRST WAITING LADDER (Dan, 2026-11-08, binding)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Dan, verbatim: "WE SHOULD ONLY HAVE ONE HORSE SITTING AT HAND FULL OF
 * EVENTS, WE ARE AUTO RUNNING WAY TOO MANY. ... SIT ONE HORSE AT LIKE 11
 * DIFFERENT SPINS AND LIKE 6 SIT N GO'S. SPINS AND SIT N GO'S WAIT FOR HUMANS
 * TO JOIN, AFTER 1 HOURS TO 1:20 MINUTES WITH NO HUMANS A SECOND HORSE SITS
 * FOR SPINS, AND THEN WITHIN THE NEXT 30-60 MIN A 3RD HORSE WILL SIT TO PLAY,
 * THE IDEA BEING THAT WE AREN'T JUST RUNNING ALL DAY EVERY DAY FOR NO REASON.
 * FOR SIT N GOES, HORSE WAITS UP TO 4 HOURS FOR A HUMAN TO JOIN, ANYTIME AFTER
 * 3 HOURS AND 4 HOURS A HORSE CAN JOIN TO PLAY, THEN A NEW HORSE WAITS AT A
 * NEW SIT N GO AFTER THAT STARTS. IF A HUMAN JOINS ANY SIT N GO, IT STARTS. IF
 * A HUMAN SITS AT AN EMPTY TABLE, OTHERS SHOULD JOIN THE SIT N GO WITHIN 3-7
 * MIN."
 *
 * ── WHAT THIS REPLACES, AND THE MEASUREMENT BEHIND IT ──────────────────────
 *
 * The previous rule opened every board with seats-1 horses and held the LAST
 * seat for a randomised 90-350 SECONDS. A Spin therefore opened at 2/3 and
 * filled itself inside six minutes, for ever, on every price point.
 *
 * Measured on production for the seven days to 2026-11-07: 29,593 Spins and
 * 26,405 Heads-Up games completed - an average of 4,228 and 3,772 a day, and
 * 11,539 a day over the three days after the engine changeover. SEVEN of those
 * 55,998 games had a human in them. The fleet was playing itself roughly eight
 * thousand times a day to produce seven games anybody watched.
 *
 * A 350-second door is not a door a person walks through; it is a formality
 * before a horse takes the seat. So the wait becomes HOURS, the opening field
 * becomes ONE horse, and the seats fill one rung at a time:
 *
 *   Spin (3 seats)      1 horse opens -> 60-80 min -> 2nd horse
 *                                     -> +30-60 min -> 3rd horse, it deals
 *   Heads-Up (2 seats)  1 horse opens -> 3-4 hours  -> 2nd horse, it deals
 *
 * Every rung is randomised per game for the reason the old window was: a
 * constant delay makes the whole board tick over in lockstep, so every table
 * matures at the same instant and the room reads as a machine.
 *
 * ── A HUMAN OVERTAKES THE LADDER ───────────────────────────────────────────
 *
 * The ladder describes a board NOBODY has sat at. The moment a person buys a
 * seat the board is committed and the rest of the field arrives in 3-7
 * minutes - Dan's sentence above, and the reason the partner hold still runs
 * first so two people can meet at one table.
 *
 * ── WHY THIS IS NOT A CAP, A CLOCK OR A THROTTLE ───────────────────────────
 *
 * Dan 2026-11-05, on the identical question for Lightning cash games: "THERE
 * IS NO CAP OR CLOCK THAT SHOULD BE WATCHING THIS, JUST HAVE AND LAUNCH FEWER
 * GAMES." Nothing here counts games played or refuses a launch. The board is
 * narrower and each board waits longer; the games themselves run at exactly
 * the speed and in exactly the style they always did.
 */

/**
 * How many horses OPEN a seat-first board: one, whatever the seat count.
 *
 * Was `seats - 1` - two on a Spin, one on a Heads-Up - which is why a Spin was
 * one seat from dealing from the instant it appeared.
 */
export const SEAT_FIRST_OPENING_HORSES = 1;

/** A rung: the randomised delay before the NEXT horse may take a seat. */
export type LadderRung = { minMs: number; maxMs: number };

const MIN = 60 * 1000;

/**
 * Spin ladder. Two rungs because a Spin has three seats and one horse opens
 * it: rung 1 seats the second horse, rung 2 seats the third and it deals.
 */
export const SPIN_LADDER: LadderRung[] = [
  { minMs: 60 * MIN, maxMs: 80 * MIN },
  { minMs: 30 * MIN, maxMs: 60 * MIN },
];

/**
 * Heads-Up ladder. One rung: the horse waits up to four hours for a person,
 * and any time after the third hour the second horse may sit and it deals.
 */
export const SNG_LADDER: LadderRung[] = [{ minMs: 180 * MIN, maxMs: 240 * MIN }];

/**
 * A person has sat down: the rest of the field arrives in 3-7 minutes. This is
 * the ONLY path that fills a board quickly, and it is the one Dan asked to be
 * quick.
 */
export const HUMAN_ARRIVAL_MIN_MS = 3 * MIN;
export const HUMAN_ARRIVAL_MAX_MS = 7 * MIN;

/**
 * Which ladder a board climbs. Keyed on the seat count rather than the word
 * "spin", so a format that changes its seats cannot silently keep the wrong
 * ladder: a three-seat seat-first board is a Spin by definition (SPIN_SEATS)
 * and a two-seat one is a Heads-Up.
 */
export function ladderForSeats(seats: number): LadderRung[] {
  return seats >= 3 ? SPIN_LADDER : SNG_LADDER;
}

/**
 * The delay before the next horse may sit, given how many seats are already
 * paid for. `paid` counts every occupant, human or horse (CLAUDE.md 10.5 - a
 * horse occupies a seat exactly as a person does).
 *
 * Returns null when the board is full, or when the ladder has no rung left -
 * the caller then leaves the board alone rather than inventing a delay.
 *
 * `rand` takes an inclusive span and returns a value inside it. Callers pass
 * the cryptographic generator their file already uses; this module stays free
 * of a generator import so both the engine and the recurring service can share
 * it without arguing about which one is banned where.
 */
export function nextRungMs(
  seats: number,
  paid: number,
  rand: (spanInclusive: number) => number
): number | null {
  if (!Number.isFinite(seats) || !Number.isFinite(paid)) return null;
  if (paid >= seats) return null;
  const ladder = ladderForSeats(seats);
  // One horse opens the board, so the board sitting at `paid` seats is waiting
  // on rung index `paid - 1`. A board with nothing in it waits on rung 0.
  const index = Math.max(0, paid - SEAT_FIRST_OPENING_HORSES);
  const rung = ladder[Math.min(index, ladder.length - 1)];
  if (!rung) return null;
  return rung.minMs + rand(rung.maxMs - rung.minMs);
}

/** The opening wait: how long the board holds every seat for a person. */
export function openingRungMs(seats: number, rand: (spanInclusive: number) => number): number {
  const rung = ladderForSeats(seats)[0];
  return rung.minMs + rand(rung.maxMs - rung.minMs);
}

/** A person has sat: how long before the rest of the field arrives. */
export function humanArrivalMs(rand: (spanInclusive: number) => number): number {
  return HUMAN_ARRIVAL_MIN_MS + rand(HUMAN_ARRIVAL_MAX_MS - HUMAN_ARRIVAL_MIN_MS);
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A SATELLITE FEEDER DOES NOT CLIMB THIS LADDER (2026-11-09)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A REGRESSION THIS LADDER INTRODUCED, and the reason it is fixed here rather
 * than worked around at the call site.
 *
 * A heads-up satellite feeder is two seats, so `ladderForSeats` called it a
 * Heads-Up and handed it the 3-to-4-hour rung. Before the ladder,
 * `createSatelliteHeadsUp` opened with the old 90-350 second window and the
 * feeder filled, played and handed its seat over in minutes.
 *
 * Two things make that wrong rather than merely slow:
 *
 *  1. The ladder exists to stop the room running ITSELF all day - "SIT ONE
 *     HORSE AT LIKE 11 DIFFERENT SPINS AND LIKE 6 SIT N GO'S". A feeder is
 *     not one of those eleven or six: `seatFirstBoardRoom` deliberately
 *     excludes every row with a satellite target from the count. So a feeder
 *     was being paced by a quota it is explicitly not part of, which is this
 *     change disagreeing with itself.
 *  2. A feeder exists to deliver a seat into ONE event. Waiting 3-4 hours
 *     means its target can start first, and then it can never award what it
 *     sold. The existing authority on that is
 *     `fn_ca_expire_empty_fixed_sng_satellite`, which cancels an EMPTY
 *     REGISTERING feeder once its target's `start_time` has passed - and the
 *     ladder seats one horse immediately, so the feeder is no longer empty
 *     and that reaper answers `not_empty_registering` and leaves it there.
 *     The ladder did not just slow the feeder down; it put it out of reach of
 *     the thing that was meant to clean it up.
 *
 * So a feeder keeps the short window AND is bounded by its target's own
 * admission clock. The bound reuses the lead the platform already requires
 * for this format (`SATELLITE_HU_TARGET_LEAD_MS`, passed in as
 * `requiredLeadMs` so this module stays free of service imports) rather than
 * inventing a second number for the same thing. Capping at the target's start
 * would be too late: the feeder still has to PLAY and hand the seat over.
 *
 * `null` means this feeder cannot deliver, so it must not be opened and must
 * not keep waiting. An unknown or non-finite target clock is also `null`:
 * not knowing is never permission, which is the same answer
 * `fn_ca_expire_empty_fixed_sng_satellite` gives as `target_clock_unknown`.
 */
export const FEEDER_OPENING_MIN_MS = 90 * 1000;
export const FEEDER_OPENING_MAX_MS = 350 * 1000;

/** The short window a feeder opens with when its target's clock is unknown. */
export function feederOpeningMs(rand: (spanInclusive: number) => number): number {
  return FEEDER_OPENING_MIN_MS + rand(FEEDER_OPENING_MAX_MS - FEEDER_OPENING_MIN_MS);
}

export function feederWaitMs(
  nowMs: number,
  targetStartMs: number,
  requiredLeadMs: number,
  rand: (spanInclusive: number) => number
): number | null {
  if (!Number.isFinite(nowMs) || !Number.isFinite(targetStartMs)) return null;
  if (!Number.isFinite(requiredLeadMs) || requiredLeadMs < 0) return null;
  /* Re-derived from the target's CURRENT start_time by every caller, so a
     rescheduled target moves this bound instead of leaving a feeder waiting
     against a clock that no longer exists. */
  const available = targetStartMs - requiredLeadMs - nowMs;
  if (available <= 0) return null;
  const span = FEEDER_OPENING_MAX_MS - FEEDER_OPENING_MIN_MS;
  const drawn = FEEDER_OPENING_MIN_MS + rand(span);
  return Math.min(drawn, available);
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  HORSE-SEEDED OCCUPANCY TARGETS & FULL EMPTY AVAILABILITY
 *  (Dan, 2026-11-08 & 2026-11-22, binding)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Dan 2026-11-08: "SIT ONE HORSE AT LIKE 11 DIFFERENT SPINS AND LIKE 6 SIT N
 * GO'S ... THE IDEA BEING THAT WE AREN'T JUST RUNNING ALL DAY EVERY DAY FOR
 * NO REASON."
 *
 * Dan 2026-11-22 (superseding the capped-catalogue & 6-HU parts):
 * "NOT EVERY SPIN 'AVAILABLE' SHOULD HAVE 2 OF 3 PLAYERS. SOME SHOULD ONLY
 * HAVE 1 OF 3 PLAYERS. SOME SHOULD BE 'EMPTY' FOR A HUMAN TO SIT DOWN AND
 * START. CURRENTLY THERE IS 11 SITTING WITH 2 OF 3. AND NONE WITH 0 OF 3.
 * THERE SHOULD BE EVERY OPTION OF SPIN AVAILABLE AS 0 OF 3 FOR HUMANS TO SIT
 * DOWN AND PLAY. SAME THING FOR HEADS UP SIT N GO'S. THERE SHOULD BE ONLY A
 * COUPLE OF 1 OF 2'S AVAILABLE AND MAJORITY 0 OF 2 FOR HUMAN PLAYERS TO SIT
 * DOWN AT AND PLAY."
 *
 * These are PLATFORM-WIDE counts of HORSE-SEEDED boards (holding at least one
 * live seat), NOT caps on how many empty `0/3` or `0/2` options exist:
 *   - Every Spin option in SPIN_CONFIGS (and owner's maxStake slice) stays
 *     open as a joinable REGISTERING board; at most SPIN_BOARD_OPEN_TARGET
 *     (11) carry a horse (with at most SPIN_MAX_TWO_OF_THREE = 5 at 2/3, so
 *     there is always a genuine mix of 1/3 and 2/3), and every remaining Spin
 *     option stays open at 0/3 for humans to sit down and start.
 *   - Every Heads-Up option in SNG_CONFIGS (and owner's maxStake slice) stays
 *     open as a joinable REGISTERING board; at most SNG_BOARD_OPEN_TARGET (2,
 *     "only a couple") carry a horse at 1/2, and the vast majority stay open
 *     at 0/2 for humans to sit down and play.
 */
export const SPIN_BOARD_OPEN_TARGET = 11;
export const SNG_BOARD_OPEN_TARGET = 2;

export function boardOpenTarget(variant: 'spin' | 'sng'): number {
  return variant === 'spin' ? SPIN_BOARD_OPEN_TARGET : SNG_BOARD_OPEN_TARGET;
}

/**
 * Maximum number of horse-only Spins simultaneously at 2/3 platform-wide
 * (Dan, 2026-11-22). Out of SPIN_BOARD_OPEN_TARGET (11) horse-seeded Spins,
 * capping 2/3 at 5 keeps at least 6 waiting at 1/3 instead of letting all 11
 * drift into 2/3 together. A human sitting in a 1/3 Spin always overtakes
 * this cap and fills immediately after the 3-7 minute partner hold.
 */
export const SPIN_MAX_TWO_OF_THREE = 5;

/**
 * Staggered Spin horse-seeding (Dan, 2026-11-22). Opening all 11 Spins in one
 * 30-second tick at 6:00 AM CST put every board on the same 60-80 minute
 * first rung, so by 7:20 AM (before the earliest 60+30 = 90 minute finish) all
 * 11 were mathematically guaranteed to sit at 2/3 simultaneously with 0 at 1/3.
 *
 * Seeding the first SPIN_IMMEDIATE_SEED_FLOOR (3) immediately gives players
 * open 1/3 Spins right at 6:00 AM, and spacing each additional horse-seeded
 * Spin by SPIN_SEED_SPACING_MS (8 minutes) spreads the 11 across ~64 minutes
 * (the length of rung 1) so the cohort naturally stays mixed across 1/3 and
 * 2/3 all day instead of marching in lockstep.
 */
export const SPIN_IMMEDIATE_SEED_FLOOR = 3;
export const SPIN_SEED_SPACING_MS = 8 * MIN;

/** How many Spins may receive an opening horse on this tick. Pure & durable. */
export function spinSeedsAllowedThisTick(
  openedCount: number,
  mostRecentSeatAtMs: number | null,
  nowMs: number,
  maxPerTick: number
): number {
  if (!Number.isFinite(openedCount) || !Number.isFinite(maxPerTick) || maxPerTick <= 0) return 0;
  const opened = Math.max(0, Math.floor(openedCount));
  const room = Math.max(0, SPIN_BOARD_OPEN_TARGET - opened);
  if (room <= 0) return 0;
  if (opened < SPIN_IMMEDIATE_SEED_FLOOR) {
    return Math.min(room, SPIN_IMMEDIATE_SEED_FLOOR - opened, Math.floor(maxPerTick));
  }
  if (
    mostRecentSeatAtMs !== null &&
    Number.isFinite(mostRecentSeatAtMs) &&
    Number.isFinite(nowMs) &&
    nowMs - mostRecentSeatAtMs < SPIN_SEED_SPACING_MS
  ) {
    return 0;
  }
  return Math.min(1, room, Math.floor(maxPerTick));
}

/** How many seat-first boards of `variant` may receive an opening horse this tick. */
export function seatFirstSeedsAllowedThisTick(
  variant: 'spin' | 'sng',
  openedCount: number,
  mostRecentSeatAtMs: number | null,
  nowMs: number,
  maxPerTick: number
): number {
  if (variant === 'spin') {
    return spinSeedsAllowedThisTick(openedCount, mostRecentSeatAtMs, nowMs, maxPerTick);
  }
  if (!Number.isFinite(openedCount) || !Number.isFinite(maxPerTick) || maxPerTick <= 0) return 0;
  const room = Math.max(0, SNG_BOARD_OPEN_TARGET - Math.max(0, Math.floor(openedCount)));
  return Math.min(room, Math.floor(maxPerTick));
}

/** Total maximum duration of SPIN_LADDER (140 min) and safety cushion below alerts/expiry. */
export const SPIN_LADDER_MAX_TOTAL_MS = SPIN_LADDER.reduce((total, rung) => total + rung.maxMs, 0);
export const SPIN_ENVELOPE_SAFETY_MARGIN_MS = 10 * MIN;
export const SPIN_TWO_OF_THREE_DEFER_MIN_MS = 5 * MIN;
export const SPIN_TWO_OF_THREE_DEFER_MAX_MS = 10 * MIN;

/**
 * When a horse-only 1/3 Spin finishes rung 1 while at least SPIN_MAX_TWO_OF_THREE
 * Spins are already sitting at 2/3, defer its promotion to 2/3 by 5-10 minutes
 * (writing the new start_time so SpinUnfilledBacklog never trips), ONLY while
 * enough headroom remains inside the SPIN_LADDER envelope (minus the 10-minute
 * safety margin and rung 2's minimum 30-minute wait) so the board can never
 * exceed SPIN_LADDER_FULL_ENVELOPE_SECONDS or fn_spin_expire_unfilled.
 *
 * Returns null when the board should advance to 2/3 immediately.
 */
export function spinTwoOfThreeDeferMs(params: {
  twoOfThreeCount: number;
  oldestSeatAtMs: number;
  nowMs: number;
  rand: (spanInclusive: number) => number;
}): number | null {
  const { twoOfThreeCount, oldestSeatAtMs, nowMs, rand } = params;
  if (!Number.isFinite(twoOfThreeCount) || twoOfThreeCount < SPIN_MAX_TWO_OF_THREE) return null;
  if (!Number.isFinite(oldestSeatAtMs) || !Number.isFinite(nowMs)) return null;
  const rung2MinMs = SPIN_LADDER[1]?.minMs ?? 0;
  const safeCeilingMs = oldestSeatAtMs + SPIN_LADDER_MAX_TOTAL_MS - SPIN_ENVELOPE_SAFETY_MARGIN_MS;
  const maxDeferRoom = safeCeilingMs - rung2MinMs - nowMs;
  if (maxDeferRoom < SPIN_TWO_OF_THREE_DEFER_MIN_MS) return null;
  const upper = Math.min(SPIN_TWO_OF_THREE_DEFER_MAX_MS, Math.floor(maxDeferRoom));
  const span = Math.max(0, upper - SPIN_TWO_OF_THREE_DEFER_MIN_MS);
  return SPIN_TWO_OF_THREE_DEFER_MIN_MS + rand(span);
}

/**
 * Clamp a Spin's rung-2 wait so a board that was deferred at 1/3 still deals
 * strictly inside SPIN_LADDER_MAX_TOTAL_MS - SPIN_ENVELOPE_SAFETY_MARGIN_MS
 * from its oldest live seat (preventing SpinFleetProducingNothing & expiry).
 */
export function clampSpinRungWaitMs(waitMs: number, oldestSeatAtMs: number, nowMs: number): number {
  if (!Number.isFinite(waitMs) || waitMs <= 0) return 0;
  if (!Number.isFinite(oldestSeatAtMs) || !Number.isFinite(nowMs)) return waitMs;
  const safeCeilingMs = oldestSeatAtMs + SPIN_LADDER_MAX_TOTAL_MS - SPIN_ENVELOPE_SAFETY_MARGIN_MS;
  const remaining = Math.max(0, safeCeilingMs - nowMs);
  return Math.min(waitMs, remaining);
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A LATE RUNG IS ASKED AT LEAST ONCE A MINUTE (2026-11-19)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Production Alerts incident `spin-ladder-rung-overshoot`: six
 * SpinFleetProducingNothing criticals in seven days, each an all-horse Spin
 * that dealt past the ladder's 140-minute envelope. Read from table_seats and
 * tournaments.start_time on 2026-11-19, board 2db5ea97 ("20 Chip Spin PLO6"):
 * its rung-2 window closed at 08:13:48Z and the third horse sat at 08:46:19Z,
 * 32.5 minutes late. In those 32 minutes three other Spins took a horse within
 * seconds of asking (bd6eb0e8 08:14:33, 84725155 08:20:29, and the openers).
 *
 * The lateness was the backoff, not the pool. A horse-only board that came
 * back short used to be re-asked after 12 s, 24 s ... capped at TEN MINUTES -
 * a rule written on 2026-09-02 for 96 boards that had been unfillable for 2.5
 * to 25 hours. Under the ladder the pool is not empty for hours, it is busy
 * for minutes, and a free horse goes to whichever board asks first after it
 * stands up. The backoff therefore made the board that had waited LONGEST ask
 * LEAST often: 2db5ea97's asks fell at +0, 24, 72, 168, 360, 744, 1344 and
 * 1944 s, and it was seated 1951 s after its window (08:46:19Z), one fast-lane
 * pass after that last ask, while boards whose windows had just closed asked
 * every 12-24 s and won every horse in between. 84725155 shows the same shape:
 * window 08:07:58Z, seated 751 s later at 08:20:29Z, one pass after its 744 s
 * ask.
 *
 * So a horse-only board still backs off - doubling from 12 s - but never past
 * SEAT_FIRST_LADDER_BACKOFF_MAX_MS. One minute is small against the 20-30
 * minute randomised span of every rung, so a late rung is late by the pool,
 * never by the ask. The cost the 2026-09-02 backoff bought back is still
 * bought back: the ladder keeps about eleven Spins and six Heads-Up boards
 * open (CLAUDE.md, Dan 2026-11-08), so at most ~17 window-closed boards ask
 * once a minute each, against the ~7 calls a second the 96 hammered boards
 * cost before any backoff existed.
 */
export const SEAT_FIRST_LADDER_BACKOFF_BASE_MS = 12_000;
export const SEAT_FIRST_LADDER_BACKOFF_MAX_MS = 60_000;

/**
 * How long a horse-only seat-first board waits before its next fill ask,
 * given how many asks in a row came back short. A board with a person seated
 * never backs off (the caller passes 0 misses for it).
 */
export function seatFirstLadderBackoffMs(misses: number): number {
  const n = Number.isFinite(misses) && misses > 0 ? Math.floor(misses) : 0;
  return Math.min(
    SEAT_FIRST_LADDER_BACKOFF_BASE_MS * 2 ** Math.min(n, 6),
    SEAT_FIRST_LADDER_BACKOFF_MAX_MS
  );
}
