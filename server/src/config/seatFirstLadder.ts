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
 *  HOW WIDE THE BOARD IS (Dan, 2026-11-08, binding)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Dan: "SIT ONE HORSE AT LIKE 11 DIFFERENT SPINS AND LIKE 6 SIT N GO'S."
 *
 * These are PLATFORM-WIDE counts of boards a player can join, not per club and
 * not per price point. Before this, every price point was permanently open on
 * every activated board: 64 Spin configs and 32 Heads-Up configs, times the
 * house board and each activated owner's. Measured 2026-11-08: 134 open
 * seat-first boards across two owners, each one cycling about every six
 * minutes.
 *
 * The catalogue is unchanged - every price point still exists and is still
 * reachable. What changed is how many of them are open AT ONCE, and which ones
 * is drawn fresh each tick (see the shuffle in ensureBoardOpen) so the board
 * moves around the ladder over a day instead of pinning the cheapest eleven.
 */
export const SPIN_BOARD_OPEN_TARGET = 11;
export const SNG_BOARD_OPEN_TARGET = 6;

export function boardOpenTarget(variant: 'spin' | 'sng'): number {
  return variant === 'spin' ? SPIN_BOARD_OPEN_TARGET : SNG_BOARD_OPEN_TARGET;
}
