/**
 * LIGHTNING TRANSITION, PHASE 3: SMOOTHER MOTION BETWEEN HANDS.
 *
 * Pure rules the table view applies so the moment between two Lightning hands
 * plays its animations instead of cutting them off. Every rule answers "no
 * change" outside a Lightning pool-session room, so a Classic table never
 * takes a new branch.
 *
 *   - `lightningExitHoldMs`: how long the felt keeps the folded hand on screen
 *     after the engine's idle snapshot, so the hero's cards finish flying to
 *     the muck and the opponents and board fade out rather than vanish.
 *   - `lightningFeltLeaving`: when the felt is marked as leaving, after a fold
 *     and once the hand on it is over, so every table has an exit.
 *   - `lightningHeroSeatFromRoster`: the chair the hero holds in the incoming
 *     roster, adopted in the same update as the roster, so the hero never sits
 *     in the wrong chair for a frame.
 *   - `lightningParkedDealerSeat`: the dealer button stays where it was between
 *     hands, so the next hand's button beat glides it to its new seat.
 *   - `lightningHoldsHeroDealSound`: the hero's card-slide cue waits for the
 *     deal to reach the seats, so the cues play shuffle, chime, deal, slide.
 *   - `lightningEarlyHeroCards*`: hole cards that arrive a moment before the
 *     hero's roster row are kept and applied when the row arrives.
 */

/**
 * The fold window SeatSlot gives a seat's cards to reach the muck (380 ms
 * flight + 55 ms second-card delay, rounded up), at Animation Speed 1.
 * SeatSlot.tsx uses the same 500.
 */
export const LIGHTNING_EXIT_HOLD_BASE_MS = 500;

/**
 * How long the felt keeps the hand the hero just left on screen after the
 * engine's idle snapshot arrives. Zero means apply it at once.
 *
 * The engine answers a Lightning fold with the fold, then the table, then the
 * idle snapshot (stage 'waiting', no players) one macrotask later. Applied
 * verbatim, it removed the hero's cards one frame into their 435 ms flight to
 * the muck and took every opponent off the felt in the same frame. The hold is
 * one fold window, scaled by Animation Speed. A snapshot carrying a hand ends
 * the hold at once, so a fast next deal is never delayed.
 */
export function lightningExitHoldMs(input: {
  lightningRoom: boolean;
  observer: boolean;
  snapshotIdle: boolean;
  /** Occupied chairs on the felt right now. */
  feltPlayers: number;
  /** The player's Animation Speed multiplier. */
  speed: number;
}): number {
  if (!input.lightningRoom || input.observer || !input.snapshotIdle) return 0;
  if (input.feltPlayers <= 0) return 0;
  const speed = Number.isFinite(input.speed) && input.speed > 0 ? input.speed : 1;
  return Math.round(LIGHTNING_EXIT_HOLD_BASE_MS * speed);
}

/**
 * Whether the felt is marked as leaving (`data-lightning-exit`), which fades
 * the opponents, the board and the pot out and keeps them out.
 *
 *   - during the exit hold after a fold (above), and
 *   - 2026-11-09: once the hand on the felt is OVER (the page's hand-bound
 *     completion latch, set only after the full award hold). A player who
 *     stayed to the end had no exit at all: the finished table sat there at
 *     full strength and was swapped for the next one in a single frame. It
 *     now leaves the way a folded hand does, and the next table fades in.
 *
 * Never at a Classic table and never for an observer. The marker ends the
 * moment a new hand is on the felt, so it can never hide a live hand.
 */
export function lightningFeltLeaving(input: {
  lightningRoom: boolean;
  observer: boolean;
  exitHoldMs: number;
  handIsOver: boolean;
}): boolean {
  if (!input.lightningRoom) return false;
  if (input.exitHoldMs > 0) return true;
  return input.handIsOver && !input.observer;
}

/**
 * The hero's chair in the incoming roster, or 0 when it should not be adopted
 * here. In a Lightning room the hero changes chair every hand. The chair
 * layout follows `heroSeat`, which the seat invariant used to adopt only after
 * the new roster had painted, so for one frame an opponent sat in the hero's
 * spot with hero styling and the dealer button set off across the table.
 */
export function lightningHeroSeatFromRoster(input: {
  lightningRoom: boolean;
  observer: boolean;
  /** The player has asked to leave this seat; never re-adopt it. */
  leaving: boolean;
  userId: string | null | undefined;
  players: ReadonlyArray<{ id: string } | null | undefined>;
}): number {
  if (!input.lightningRoom || input.observer || input.leaving) return 0;
  if (!input.userId || input.userId === 'guest') return 0;
  const idx = input.players.findIndex((p) => !!p && p.id === input.userId);
  return idx >= 0 ? idx + 1 : 0;
}

/**
 * Where the dealer button sits. The idle snapshot carries dealer seat 0, which
 * hid the button for the whole wait; the next hand then popped it in at its
 * seat, and the 700 ms button beat that opens every deal showed nothing
 * moving. In a Lightning room an idle snapshot keeps the button parked where
 * it was, so the next hand's beat glides it across.
 */
export function lightningParkedDealerSeat(input: {
  lightningRoom: boolean;
  snapshotIdle: boolean;
  incoming: number;
  previous: number;
}): number {
  if (input.lightningRoom && input.snapshotIdle && !(input.incoming > 0) && input.previous > 0) {
    return input.previous;
  }
  return input.incoming;
}

/**
 * Whether the hero's card-slide cue waits for the deal. The hero's hole cards
 * reach the client before the 700 ms button beat ends, so the cue played
 * first, then the shuffle, then the chime, then the deal: the cards were
 * announced before anyone dealt them. In a Lightning room, when the deal of
 * this hand has been scheduled and has not yet landed, the cue is held and
 * played when it lands (it is never dropped; CLAUDE.md 10.6).
 */
export function lightningHoldsHeroDealSound(input: {
  lightningRoom: boolean;
  hand: number;
  /** The last hand whose deal presentation was scheduled. */
  presentedHand: number;
  /** The last hand whose deal animation landed. */
  settledHand: number;
}): boolean {
  if (!input.lightningRoom || !(input.hand > 0)) return false;
  return input.presentedHand === input.hand && input.settledHand !== input.hand;
}

// Compatibility for existing Lightning callers; the delivery buffer is shared
// table presentation, independent of Lightning movement or session rules.
export { earlyHeroCardsReady as lightningEarlyHeroCardsReady } from '../utils/earlyHeroCards';
export type { EarlyHeroCards as LightningEarlyHeroCards } from '../utils/earlyHeroCards';

/*
 * THE NEW TABLE'S PLAYERS ARRIVE BEFORE ITS CARDS (Dan 2026-11-10): "all at
 * once all the players appear and cards are dealt, instead of showing all
 * players as they arrive." An engine that waits for the arrivals sends the
 * window it waited (`lightning_arrival_ms` on hand_started, `arrival_ms` in
 * the Lightning block; server LightningDealPresentation.lightningArrivalMs).
 * The opponents arrive one step apart inside it, and the deal starts after
 * it. The engine's first turn clock already includes the window, so it costs
 * nobody any clock. An engine without the field sends nothing, and the table
 * deals at once exactly as before.
 */

/** The engine's LIGHTNING_ARRIVAL_STEP_MS: the gap between two arriving opponents. */
export const LIGHTNING_ARRIVAL_STEP_MS = 120;
/** The engine's LIGHTNING_ARRIVAL_FADE_MS: SeatSlot's arrival fade at speed 1. */
export const LIGHTNING_ARRIVAL_FADE_MS = 180;

/** The arrival window an engine sent, or 0 when it sent none. Never invented. */
export function lightningArrivalWindowMs(value: unknown): number {
  const ms = typeof value === 'number' ? value : Number.NaN;
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, 2600) : 0;
}

/** How the arrivals are spaced inside that window, or null for the old short ripple. */
export function lightningArrivalSpacing(
  windowMs: number
): { stepMs: number; maxDelayMs: number } | null {
  if (!(windowMs > 0)) return null;
  return {
    stepMs: LIGHTNING_ARRIVAL_STEP_MS,
    maxDelayMs: Math.max(0, windowMs - LIGHTNING_ARRIVAL_FADE_MS),
  };
}
