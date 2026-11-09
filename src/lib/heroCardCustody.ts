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
 * folded hero is not waiting on cards, and neither is a felt with no hand on
 * it.
 */
export function heroIsBlindInLiveHand(input: {
  hero: HeroCustodyRow | null | undefined;
  isHandInProgress: boolean;
}): boolean {
  const hero = input.hero;
  if (!hero || !input.isHandInProgress) return false;
  if (hero.status === 'sitting_out' || hero.status === 'away' || hero.status === 'folded') {
    return false;
  }
  return !(hero.holeCards && hero.holeCards.length > 0);
}

/**
 * When a Lightning room re-asks the engine for the hero's cards. The engine
 * re-sends them on every RESYNC, which is the only recovery a pool session
 * has. The first ask waits for the ordinary delivery; the ladder then matches
 * the physical table's recovery read and continues for as long as the hero is
 * blind.
 */
export const LIGHTNING_HERO_CARD_RETRY_MS: readonly number[] = [600, 1200, 2000];
export const LIGHTNING_HERO_CARD_RETRY_EVERY_MS = 5000;
