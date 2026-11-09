/**
 * LIGHTNING CHECK/FOLD (Dan 2026-11-09, Lightning games only).
 *
 * Dan, verbatim: "when your in the sb or bb you should still be able to 'fast
 * fold' when you hit the 'check/fold' button. it should 'fold you in that
 * hand' right away, even though the action and avatar doesn't change or remove
 * until the action is on you. if you aren't folded pre, or on any other
 * street, the 'check/fold' stays active for all streets until someone bets, or
 * the player reaches showdown. they do not have to stay at the table or re
 * select check/fold on any other streets. (this applies only to lightning
 * games)"
 *
 * Two rules, both pure, both answering "no change" outside a Lightning room:
 *
 *   - `lightningCheckFoldSurvives`: an armed Check/Fold is NOT spent by a new
 *     street or by the hero's own free check. It lives for the hand it was
 *     armed in and for nothing else. Only an engine that carries the arm
 *     itself (`check_fold_carries`) keeps the toggle lit, so the bar never
 *     claims an arm the engine has already spent.
 *   - `lightningCheckFoldReleaseDue`: the moment a bet prices an armed
 *     Check/Fold, the player has already answered. An engine that carries the
 *     arm releases them itself; against an engine that does not, the room
 *     sends the existing Lightning Fold request at once instead of waiting for
 *     the turn.
 */
import type { LightningSnapshotFields } from './lightningHand';

/** Does this engine carry an armed Check/Fold across streets and release it on a bet? */
export function lightningCheckFoldCarries(
  snapshot: LightningSnapshotFields | null | undefined
): boolean {
  return (
    (snapshot?.lightning as { check_fold_carries?: unknown } | null | undefined)
      ?.check_fold_carries === true
  );
}

/**
 * Whether the armed Check/Fold outlives a street change or the hero's own
 * free check. `armedHandKey` is the hand the free Check/Fold was armed in
 * (null when nothing of the kind is armed).
 */
export function lightningCheckFoldSurvives(input: {
  lightningRoom: boolean;
  armedHandKey: string | null;
  currentHandKey: string | null;
  handInProgress: boolean;
  engineCarries: boolean;
}): boolean {
  if (!input.lightningRoom || !input.engineCarries || !input.handInProgress) return false;
  return input.armedHandKey !== null && input.armedHandKey === input.currentHandKey;
}

/**
 * Whether the room itself sends Lightning Fold for an armed Check/Fold that a
 * bet has just priced. Never on the hero's own turn (the engine's pre-action
 * folds there), never without a live hand, and never when the engine releases
 * the arm itself or cannot release a priced fold before its turn.
 */
export function lightningCheckFoldReleaseDue(input: {
  lightningRoom: boolean;
  /** The bar's armed choice. */
  preAction: string | null;
  /** The armed choice was the free Check/Fold of the hand on the felt. */
  armedForThisHand: boolean;
  /** Chips the hero would have to add to call right now. */
  callDue: number;
  heroTurn: boolean;
  handLive: boolean;
  /** The engine offers Lightning Fold to this player right now. */
  fastFoldOffered: boolean;
  /** The engine releases a priced off-turn fold privately (`fold_on_turn`). */
  engineReleasesPricedFold: boolean;
  engineCarries: boolean;
}): boolean {
  if (!input.lightningRoom || input.preAction !== 'fold' || !input.armedForThisHand) return false;
  if (input.engineCarries || !input.engineReleasesPricedFold) return false;
  if (!input.handLive || input.heroTurn || !input.fastFoldOffered) return false;
  return input.callDue > 0;
}
