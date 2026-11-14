/**
 * ── HORSES RUN IT TWICE ONLY SOMETIMES (Dan 2026-11-13) ──────────────────
 *
 * "Why are Horses always agreeing to run it twice or 3 times. A Horse with
 * bottom set should not be agreeing to run it 3 times with one out. Horses
 * should only be running it multiple times SOMETIMES, not all the time."
 *
 * The answer a Horse gives to a run-it-twice offer, as a pure function of
 * what is on the felt at that moment. At an all-in runout every all-in hand
 * is already face up and its equity is already on the screen (all_in_equity),
 * so a Horse reads the same number a person watching the table reads. It is
 * not private card access.
 *
 * Rules, in order:
 *   1. Equity unknown (not yet public, or the worker pool did not answer):
 *      run once. A Horse never agrees blind.
 *   2. Lopsided all-in (equity <= 0.25 or >= 0.75): run once. This is the
 *      bottom-set-against-one-out case and its mirror, the big favourite.
 *   3. prefersRunItTwice (the stable persona preference, pot size and
 *      closeness) says no: run once.
 *   4. A deterministic per-(horse, hand) gate: yes on 5 hands in 10 only.
 *   5. Otherwise 2 boards; 3 only when the table allows 3, the spot is a
 *      near coin flip (0.42..0.58), and a second bucket (1 hand in 4) says so.
 * Never more than maxRuns. Deterministic: no Math.random and no engine random
 * stream, so a replay of a hand answers the same way.
 */
import { prefersRunItTwice } from './HorsePersona.js';

export interface HorseRunItTwiceInput {
  horseId: string;
  handNumber: number;
  /** The pot at the offer in big blinds of the hand. */
  potBB: number;
  /** This Horse's public all-in equity in [0, 1], or null when unknown. */
  equity: number | null;
  /** The table's ceiling for this offer. */
  maxRuns: 1 | 2 | 3;
}

export const HORSE_RIT_LOPSIDED_LOW = 0.25;
export const HORSE_RIT_LOPSIDED_HIGH = 0.75;
export const HORSE_RIT_YES_IN_TEN = 5;
export const HORSE_RIT_THREE_RUN_BAND: readonly [number, number] = [0.42, 0.58];

/** FNV-1a over the horse id and hand number, with a salt per question. */
function bucket(horseId: string, handNumber: number, salt: string): number {
  const text = `${salt}|${horseId}|${handNumber}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function horseRunItTwiceRuns(input: HorseRunItTwiceInput): 1 | 2 | 3 {
  const { horseId, handNumber, potBB, equity } = input;
  const maxRuns = Math.max(1, Math.min(3, Math.floor(Number(input.maxRuns) || 1))) as 1 | 2 | 3;
  if (maxRuns < 2) return 1;
  if (equity === null || typeof equity !== 'number' || !Number.isFinite(equity)) return 1;
  if (equity <= HORSE_RIT_LOPSIDED_LOW || equity >= HORSE_RIT_LOPSIDED_HIGH) return 1;
  if (!prefersRunItTwice(horseId, potBB, equity)) return 1;
  if (bucket(horseId, handNumber, 'rit-yes') % 10 >= HORSE_RIT_YES_IN_TEN) return 1;
  if (
    maxRuns === 3 &&
    equity >= HORSE_RIT_THREE_RUN_BAND[0] &&
    equity <= HORSE_RIT_THREE_RUN_BAND[1] &&
    bucket(horseId, handNumber, 'rit-three') % 4 === 0
  ) {
    return 3;
  }
  return 2;
}
