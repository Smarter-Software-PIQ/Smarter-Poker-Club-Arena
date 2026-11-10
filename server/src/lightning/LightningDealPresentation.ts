/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A LIGHTNING TURN CLOCK STARTS WHEN THE DEAL HAS BEEN SHOWN (2026-10-26)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Dan 2026-08-23: "before any single hand is started there MUST BE a deal
 * animation ... Only after all cards are dealt out does the action start."
 * The client keeps that promise by holding the action panel from HAND_STARTED
 * until its deal has played (TablePage beginDealHold -> DealAnimation
 * onComplete, with a 2600 ms ceiling): first the dealer button's glide
 * (HAND_COMPLETION.BUTTON_MOVE_MS), then two cards to every dealt seat.
 *
 * The Lightning host started the first actor's clock 400 ms after the deal
 * (the physical turn settle), so the first player to act lost the rest of
 * that presentation - about 1.5 s of a 15 s clock - to buttons they could not
 * press. By the client's own arithmetic a 6-max hand is 700 ms of button and
 * 1300 ms of deal (12 cards, 80 ms apart, a 320 ms flight, 100 ms rest).
 *
 * This is the presentation's length on the ENGINE clock, computed from the
 * same numbers the client uses (DealAnimation.tsx at animation speed 1,
 * desktop flight; a phone's flight is shorter, so this never cuts one short),
 * and bounded by the client's own ceiling. A law test reads the client source
 * and fails if either side moves without the other.
 *
 * Every dealt seat counts, horse or human, and every player's clock waits the
 * same: a horse's decision is scheduled from its turn, so it waits too
 * (CLAUDE.md 10.5: timing is part of the treatment).
 */
import { HAND_COMPLETION } from '../config/handCompletionSpec.js';

/** DealAnimation.tsx CARD_STAGGER_MS: the gap between two dealt cards. */
export const LIGHTNING_DEAL_CARD_STAGGER_MS = 80;
/** DealAnimation.tsx MIN_CARD_STAGGER_MS: the stagger never compresses below this. */
export const LIGHTNING_DEAL_MIN_CARD_STAGGER_MS = 60;
/** DealAnimation.tsx flightDurationMs() desktop base: one card's flight. */
export const LIGHTNING_DEAL_FLIGHT_MS = 320;
/** DealAnimation.tsx SETTLE_BUFFER_MS: the rest after the last card lands. */
export const LIGHTNING_DEAL_SETTLE_MS = 100;
/** DealAnimation.tsx MAX_DEAL_MS: the deal is compressed to fit inside this. */
export const LIGHTNING_DEAL_MAX_MS = 1500;
/** TablePage beginDealHold: the action panel is released by this at the latest. */
export const LIGHTNING_DEAL_HOLD_CEILING_MS = 2600;
/** DealAnimation deals two cards to every dealt seat, whatever the variant. */
export const LIGHTNING_DEAL_CARDS_PER_SEAT = 2;

/**
 * How long after HAND_STARTED the client's action panel stays held for the
 * deal: the button's glide, then the deal, at animation speed 1, never past
 * the client's ceiling.
 */
export function lightningDealPresentationMs(dealtSeats: number): number {
  const seats = Math.max(1, Math.floor(Number(dealtSeats) || 0));
  const cards = seats * LIGHTNING_DEAL_CARDS_PER_SEAT;
  const room = Math.max(
    0,
    LIGHTNING_DEAL_MAX_MS - LIGHTNING_DEAL_FLIGHT_MS - LIGHTNING_DEAL_SETTLE_MS
  );
  const fit = cards > 1 ? Math.floor(room / (cards - 1)) : LIGHTNING_DEAL_CARD_STAGGER_MS;
  const stagger = Math.max(
    LIGHTNING_DEAL_MIN_CARD_STAGGER_MS,
    Math.min(LIGHTNING_DEAL_CARD_STAGGER_MS, fit)
  );
  const deal = (cards - 1) * stagger + LIGHTNING_DEAL_FLIGHT_MS + LIGHTNING_DEAL_SETTLE_MS;
  return Math.min(LIGHTNING_DEAL_HOLD_CEILING_MS, HAND_COMPLETION.BUTTON_TO_DEAL_MS + deal);
}

/*
 * ═══════════════════════════════════════════════════════════
 *  THE NEW TABLE'S PLAYERS ARRIVE BEFORE ITS CARDS (2026-11-10)
 * ═══════════════════════════════════════════════════════════
 *
 * Dan, after the 2026-11-09 transition shipped: "the transition to the next
 * game feels fake, you are just sitting there, and then all at once all the
 * players appear and cards are dealt, instead of showing all players as they
 * arrive."
 *
 * The matcher forms a Lightning hand in one step: every player at the new
 * table is known at the same instant, and nothing about the forming table
 * reaches a waiting player before it. So there is no earlier arrival to show.
 * What was wrong is the order: the opponents faded in over 160 ms while the
 * first cards were already flying, so the table and its deal landed as one
 * event. Here the new table's opponents arrive one after another FIRST, and
 * the deal starts once they are all seated.
 *
 * That window is engine time, not a client delay: the first actor's clock
 * (dealShownAtMs) waits for it as it waits for the deal, so nobody - horse or
 * human - loses any of their clock to it (CLAUDE.md 10.5). The engine sends
 * the window it waited (`lightning_arrival_ms` on hand_started, `arrival_ms`
 * in the Lightning block) and the client spaces the arrivals inside it. An
 * older client ignores both and deals at once, inside the same clock.
 */

/** SeatSlot.tsx arrival fade at animation speed 1 (`duration: 180 * speed`). */
export const LIGHTNING_ARRIVAL_FADE_MS = 180;
/** The gap between two opponents arriving at a new Lightning table. */
export const LIGHTNING_ARRIVAL_STEP_MS = 120;

/**
 * How long the new table's opponents take to arrive before its deal: one step
 * per opponent after the first, then the last one's fade. Bounded so arrival
 * plus deal still fits the client's deal-hold ceiling.
 */
export function lightningArrivalMs(dealtSeats: number): number {
  const seats = Math.max(1, Math.floor(Number(dealtSeats) || 0));
  if (seats < 2) return 0;
  const want = (seats - 2) * LIGHTNING_ARRIVAL_STEP_MS + LIGHTNING_ARRIVAL_FADE_MS;
  const room = LIGHTNING_DEAL_HOLD_CEILING_MS - lightningDealPresentationMs(seats);
  return Math.max(0, Math.min(want, room));
}

/** The whole presentation the first turn clock waits for: arrivals, then the deal. */
export function lightningHandPresentationMs(dealtSeats: number): number {
  return lightningArrivalMs(dealtSeats) + lightningDealPresentationMs(dealtSeats);
}
