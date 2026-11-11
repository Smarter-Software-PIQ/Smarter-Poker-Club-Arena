/**
 * BANK THE WIN (owner direction 2026-11-10).
 *
 * "When horses have 4-6x their starting stack they should be leaving the game
 * and booking a win. I should never see a horse with 800-2000 chips in a 100
 * chip max buy in game. They should NEVER leave after winning a BIG POT the
 * next hand; they should play another orbit, then get up before their next
 * BB."
 *
 * The previous target was 2.5-3.5x the table's MAXIMUM buy-in, keyed off the
 * table rather than the horse, and a separate rotator verdict could rack a
 * horse up on the very next hand after a big pot. This module is the one
 * owner of the cash horse's winning exit:
 *
 *  1. TARGET. Each horse has a stable personal line between 4x and 6x its own
 *     starting stack (the cash session baseline). Without a known starting
 *     stack, the table's maximum buy-in stands in for it.
 *  2. ONE MORE ORBIT. A hand in which the horse netted at least half a
 *     starting stack is a big pot. After one, it plays a full orbit (one hand
 *     per player dealt in) before any voluntary departure.
 *  3. BEFORE ITS BIG BLIND. The departure itself happens at the hand boundary
 *     right before the horse would post its next big blind.
 *
 * Pure arithmetic, no IO, no clock: every rule above is directly testable.
 */

import { horseHash } from './HorseBehavior.js';

export const BANK_THE_WIN_MIN_MULTIPLE = 4;
export const BANK_THE_WIN_MAX_MULTIPLE = 6;
/** A pot that nets at least this share of a starting stack is a big pot. */
export const BIG_POT_SHARE_OF_START = 0.5;

/** Stable per horse, in [4, 6]: the same id always yields the same line. */
export function bankTheWinMultiple(horseId: string): number {
  const frac = (horseHash(`bank-the-win:${horseId}`) % 1001) / 1000;
  return BANK_THE_WIN_MIN_MULTIPLE + frac * (BANK_THE_WIN_MAX_MULTIPLE - BANK_THE_WIN_MIN_MULTIPLE);
}

/**
 * The horse's starting stack: its session baseline, never more than the
 * table's maximum buy-in, else the maximum buy-in.
 *
 * THE CAP (2026-11-11, measured live): a horse that re-enters the same game
 * inside the rejoin window must bring its whole stack back, and a top-up adds
 * to the baseline, so 543 of 856 horse sessions read a baseline above the
 * table maximum (61e113cb: 1,391.85 in a 100 game). Its 4-6x line then ran to
 * thousands and the horse never booked. Nobody starts a session with more
 * than the table lets them buy, so the line never measures from more.
 */
export function startingStackFor(baseline: number | undefined, maxBuyIn: number): number {
  const b = Number(baseline);
  const m = Number(maxBuyIn);
  const hasMax = Number.isFinite(m) && m > 0;
  if (Number.isFinite(b) && b > 0) return hasMax ? Math.min(b, m) : b;
  return hasMax ? m : 0;
}

/** Rule 1: has this stack reached the horse's bank-the-win line? */
export function reachedBankTheWin(horseId: string, stack: number, startingStack: number): boolean {
  if (!(startingStack > 0)) return false;
  return Number(stack) >= bankTheWinMultiple(horseId) * startingStack;
}

/** Rule 2a: did this hand win a big pot? */
export function isBigPot(stackBefore: number, stackAfter: number, startingStack: number): boolean {
  if (!(startingStack > 0)) return false;
  return Number(stackAfter) - Number(stackBefore) >= BIG_POT_SHARE_OF_START * startingStack;
}

/**
 * Rule 2b: hands still to play before the orbit after a big pot is complete.
 * `handsSince` counts hands completed after the big pot hand; an orbit is one
 * hand per player at the table.
 */
export function orbitHandsOwed(handsSince: number | undefined, playersAtTable: number): number {
  if (handsSince === undefined) return 0;
  const orbit = Math.max(2, Math.floor(Number(playersAtTable) || 0));
  return Math.max(0, orbit - Math.max(0, Math.floor(handsSince)));
}

/** Rules 1-3 together: book the win at this boundary? */
export function shouldBankTheWin(opts: {
  horseId: string;
  stack: number;
  startingStack: number;
  handsSinceBigPot: number | undefined;
  playersAtTable: number;
  nextHandIsBigBlind: boolean;
}): boolean {
  if (!opts.nextHandIsBigBlind) return false;
  if (!reachedBankTheWin(opts.horseId, opts.stack, opts.startingStack)) return false;
  return orbitHandsOwed(opts.handsSinceBigPot, opts.playersAtTable) === 0;
}
