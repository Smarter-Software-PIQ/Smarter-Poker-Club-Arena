/* ═══════════════════════════════════════════════════════════════════════════
   WHO IS HOLDING THE HERO'S CARDS, AND FOR WHICH HAND (2026-11-09)
   ═══════════════════════════════════════════════════════════════════════════

   Mongo, Lightning NLH hand 58167350: "Had a hand where I never saw my cards.
   Waited till the time bank showed up and never saw them." He sat on the
   button in hand 58167227, won it, and was dealt into 58167350 in the small
   blind: a different seat, as every Lightning hand is.

   The hero's cards reach the felt once, as a private frame, and are then
   carried from one engine frame to the next by TablePage. Three decisions in
   that custody were each keyed on something that is not the hand:

     1. THE SNAPSHOT HOLD LOOKED FOR THE HERO BY SEAT INDEX. A public snapshot
        never carries the hero's cards, so the previous row's cards are copied
        forward - from `prev.players[i]`. At a physical table the hero's index
        never changes. In a Lightning pool the seat changes every hand, so
        cards written onto the hero's previous seat were not found at the new
        one and the hold returned a hero holding nothing.
     2. HAND_STARTED KEPT "ALREADY DEALT" CARDS ONLY IF THE DEAL SOUND HAD
        PLAYED. The test was the hand number of the last card-slide cue, which
        is written only when the cue is audible or held. Cards delivered ahead
        of HAND_STARTED with the table muted were cleared by it.
     4. A DELIVERY THAT ARRIVED BEFORE THE PAGE KNEW ITS PLAYER WAS DISCARDED.
        `userId` boots as 'guest' and is filled in after the session is read;
        the socket does not wait for it. The door compared the row's player
        with 'guest', found them different and dropped the hero's own cards
        (measured in the browser suite, 2026-11-09: two deliveries discarded
        200 ms before the id arrived). A page opened or reloaded into a live
        hand therefore started blind.
     3. A LIGHTNING ROOM HAD NO WAY TO ASK AGAIN. The bounded recovery read is
        switched off there (a pool session has no `table_hole_cards` row under
        its own id), so `heroCardFetchRef` was null and every "re-fetch the
        hero's cards" call on the page did nothing. One lost frame was the
        whole hand.

   The decisions live here so each is one function with a test, and so the
   page cannot quietly go back to asking the seat or the speaker. */

export interface HeroCustodyRow {
  id?: unknown;
  isHero?: boolean;
  status?: unknown;
  holeCards?: ReadonlyArray<unknown> | null;
}

/**
 * The hero's row in the previous state, found by IDENTITY. The row at the same
 * index is preferred (a physical table, and the cheap case); when the hero has
 * changed seats between frames, the row carrying the hero's id is returned
 * wherever it sits. Null when the previous state holds no hero row.
 */
export function previousHeroRow<T extends HeroCustodyRow>(
  prevPlayers: ReadonlyArray<T | null | undefined> | null | undefined,
  index: number,
  heroId: unknown
): T | null {
  if (!prevPlayers || typeof heroId !== 'string' || heroId === '') return null;
  const same = prevPlayers[index];
  if (same && same.isHero && same.id === heroId) return same;
  for (const row of prevPlayers) {
    if (row && row.isHero && row.id === heroId) return row;
  }
  return null;
}

/**
 * Does the page not yet know who is signed in? The engine socket authenticates
 * from the stored session and can deliver the hero's cards before the page's
 * own `userId` has left its boot value, so "not mine" and "cannot tell yet"
 * are different answers and only the first may discard a delivery.
 */
export function heroIdentityUnknown(userId: unknown): boolean {
  return typeof userId !== 'string' || userId === '' || userId === 'guest';
}

/**
 * May a snapshot that carries no hero cards keep the ones already held?
 *
 * The existing rule is unchanged and still fails OPEN: an unknown hand number
 * on either side keeps the cards, because the hero seeing nothing is the worse
 * bug. What is added is a positive identification: cards the private frame
 * delivered FOR the incoming hand belong to it even when the previous state
 * was still on the hand before (the private frame is dispatched on arrival,
 * ahead of the queued snapshot). `heldCardsHand` only ever extends the hold;
 * it is never a reason to drop.
 */
export function heroCardHoldAllowed(input: {
  nextHand: number;
  prevHand: number;
  heldCardsHand: number;
}): boolean {
  const next = Number.isFinite(input.nextHand) ? input.nextHand : 0;
  const prev = Number.isFinite(input.prevHand) ? input.prevHand : 0;
  if (next <= 0 || prev <= 0 || next === prev) return true;
  const held = Number.isFinite(input.heldCardsHand) ? input.heldCardsHand : 0;
  return held > 0 && held === next;
}

/**
 * Has the hero's holding for the hand that is starting already been delivered?
 * Then HAND_STARTED must not clear it. Either witness is enough: the hand the
 * delivered cards were stamped with, or the hand whose deal cue was owed.
 */
export function heroCardsAlreadyDealtFor(input: {
  startedHand: number;
  heldCardsHand: number;
  dealCueHand: number;
}): boolean {
  if (!(input.startedHand > 0)) return false;
  return input.heldCardsHand === input.startedHand || input.dealCueHand === input.startedHand;
}

/**
 * Is the hero dealt into a live hand and holding nothing? A sat-out, away or
 * folded hero is not waiting on cards, neither is a felt with no hand on it,
 * and a player who has asked to leave is never shown cards again.
 */
export function heroIsBlindInLiveHand(input: {
  hero: HeroCustodyRow | null | undefined;
  isHandInProgress: boolean;
  leaving?: boolean;
}): boolean {
  const hero = input.hero;
  if (!hero || !input.isHandInProgress || input.leaving === true) return false;
  if (hero.status === 'sitting_out' || hero.status === 'away' || hero.status === 'folded') {
    return false;
  }
  return !(hero.holeCards && hero.holeCards.length > 0);
}

/**
 * The waits before each ask, in order. The asks land 0.6 s, 1.2 s, 2 s, 5 s
 * and 10 s after the hand is first watched: the first three inside the opening
 * of the action clock, the last two inside the time bank. Five per hand is the
 * whole budget. This is a bounded retry of one delivery for one hand, never a
 * standing poll.
 */
export const HERO_CARD_REREQUEST_WAITS_MS: readonly number[] = [600, 600, 800, 3000, 5000];

export interface HeroCardRerequestDeps {
  /** The hand on the felt now; 0 when unknown. */
  currentHand: () => number;
  /** The hero is dealt into that hand, has not left, and holds nothing. */
  isBlind: () => boolean;
  /** Ask the engine once to send the hero's cards again. */
  ask: (hand: number, attempt: number) => void;
  /** Every ask for `hand` is spent and the hero is still blind. */
  onExhausted?: (hand: number) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  waitsMs?: readonly number[];
}

export interface HeroCardRerequest {
  /** Watch the hand on the felt. Safe to call any number of times. */
  arm: () => void;
  /** Unmount, leave, or a change of table or player: nothing fires again. */
  dispose: () => void;
  /** Asks spent for the hand being watched (for tests and telemetry). */
  asksFor: (hand: number) => number;
}

/**
 * ONE BOUNDED RE-REQUEST PER HAND (2026-11-09).
 *
 * The rules, each of which a caller can no longer get wrong:
 *
 *   - one timer at most, ever: arming while a watch is running for the same
 *     hand does nothing, so HAND_STARTED, a refused push, a reconnect and the
 *     hand-number effect arming together cannot multiply the asks;
 *   - a budget per hand that re-arming does not refill;
 *   - every tick re-reads the truth: a hand that has changed, cards that have
 *     arrived, a hero who folded, sat out or left - each ends the watch
 *     without asking;
 *   - a new hand drops the old hand's watch before starting its own;
 *   - dispose is final.
 *
 * It asks for nothing but a re-send. What comes back is judged by the same
 * door as every other delivery (player, table, hand and board), so a late
 * answer for an earlier hand is refused there, not trusted here.
 */
export function createHeroCardRerequest(deps: HeroCardRerequestDeps): HeroCardRerequest {
  const waits = deps.waitsMs ?? HERO_CARD_REREQUEST_WAITS_MS;
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer =
    deps.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let disposed = false;
  let watchedHand = 0;
  let asks = 0;
  let exhaustedReported = false;
  let timer: unknown = null;

  const cancel = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  const schedule = () => {
    if (disposed || timer !== null || asks >= waits.length) return;
    const hand = watchedHand;
    timer = setTimer(() => {
      timer = null;
      if (disposed || hand !== watchedHand || deps.currentHand() !== hand) return;
      if (!deps.isBlind()) return;
      asks += 1;
      deps.ask(hand, asks);
      if (asks < waits.length) {
        schedule();
      } else if (!exhaustedReported) {
        exhaustedReported = true;
        // Read once more after the last answer has had its wait.
        timer = setTimer(
          () => {
            timer = null;
            if (disposed || hand !== watchedHand || deps.currentHand() !== hand) return;
            if (deps.isBlind()) deps.onExhausted?.(hand);
          },
          waits[waits.length - 1]
        );
      }
    }, waits[asks]);
  };

  return {
    arm() {
      if (disposed) return;
      const hand = deps.currentHand();
      if (!(hand > 0)) return;
      if (hand !== watchedHand) {
        cancel();
        watchedHand = hand;
        asks = 0;
        exhaustedReported = false;
      }
      schedule();
    },
    dispose() {
      disposed = true;
      cancel();
    },
    asksFor(hand) {
      return hand === watchedHand ? asks : 0;
    },
  };
}
