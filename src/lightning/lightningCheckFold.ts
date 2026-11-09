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

/**
 * Whether an idle snapshot is the engine folding the armed Check/Fold, so the
 * exit hold shows that fold (cue and muck). The arm must be the one armed in
 * the hand that was last live on this felt: an arm left over from an earlier
 * hand, or an idle snapshot for any other reason (a voided hand), never folds
 * the hero's cards on screen. The arm is only ever set for the bar's Fold
 * choice and is cleared with it, so it needs no second witness.
 */
export function lightningEngineFoldedArm(input: {
  armedHandKey: string | null;
  lastLiveHandKey: string | null;
  heroStatus: string | null | undefined;
}): boolean {
  if (input.armedHandKey === null || input.armedHandKey !== input.lastLiveHandKey) return false;
  return !!input.heroStatus && input.heroStatus !== 'folded';
}

// ─── The arm survives a reload of its own hand ──────────────────────────────

/**
 * A carried Check/Fold lives in the engine for the whole hand. A page that
 * reloads mid-hand used to come back with an unlit bar while the engine went
 * on checking (and would fold) for the player: an arm they could neither see
 * nor cancel. The room remembers which hand it armed, per pool session, and a
 * reload of that same hand lights the toggle again without sending anything.
 * It is this browser's own record, never authority: it names one hand, expires
 * on its own, and is dropped the moment the choice is cleared or spent.
 */
const ARM_STORE_PREFIX = 'ca.lightning.checkFoldArm.v1:';
export const LIGHTNING_CHECK_FOLD_ARM_TTL_MS = 15 * 60 * 1000;

type ArmStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function armStore(): ArmStore | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function rememberLightningCheckFoldArm(
  room: string,
  handKey: string,
  now: number = Date.now(),
  store: ArmStore | null = armStore()
): void {
  try {
    store?.setItem(ARM_STORE_PREFIX + room, JSON.stringify({ k: handKey, t: now }));
  } catch {
    /* Storage is a convenience: a full or blocked store changes nothing. */
  }
}

export function forgetLightningCheckFoldArm(
  room: string,
  store: ArmStore | null = armStore()
): void {
  try {
    store?.removeItem(ARM_STORE_PREFIX + room);
  } catch {
    /* As above. */
  }
}

export function rememberedLightningCheckFoldArm(
  room: string,
  now: number = Date.now(),
  store: ArmStore | null = armStore()
): string | null {
  try {
    const raw = store?.getItem(ARM_STORE_PREFIX + room);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { k?: unknown; t?: unknown } | null;
    if (!parsed || typeof parsed.k !== 'string' || parsed.k === '') return null;
    const at = Number(parsed.t);
    if (!Number.isFinite(at) || now - at > LIGHTNING_CHECK_FOLD_ARM_TTL_MS || at > now + 60_000)
      return null;
    return parsed.k;
  } catch {
    return null;
  }
}

/**
 * Whether a remembered arm is put back on the bar. Only for the very hand it
 * was armed in, while that hand is live with the hero still in it and owing
 * nothing, nothing else armed, off the hero's turn, against an engine that
 * carries the arm.
 */
export function lightningCheckFoldRestoreDue(input: {
  lightningRoom: boolean;
  rememberedHandKey: string | null;
  currentHandKey: string | null;
  preAction: string | null;
  engineCarries: boolean;
  handLive: boolean;
  heroStatus: string | null | undefined;
  callDue: number;
  heroTurn: boolean;
}): boolean {
  if (!input.lightningRoom || !input.engineCarries || !input.handLive) return false;
  if (input.rememberedHandKey === null || input.rememberedHandKey !== input.currentHandKey)
    return false;
  if (input.preAction !== null || input.heroTurn || input.callDue > 0) return false;
  return !!input.heroStatus && input.heroStatus !== 'folded' && input.heroStatus !== 'all_in';
}
