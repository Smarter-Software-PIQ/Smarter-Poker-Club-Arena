/**
 * PUBLIC-ONLY BET SIZE (PLO Strategy lane, 2026-11-16; option
 * omahaBetSizeByPublicState, default OFF, read `=== true`).
 *
 * The owner, 2026-11-15: "HE GETS THEM TO FOLD WHEN HE WANTS A FOLD, AND GETS
 * A CALL WHEN HE WANTS A CALL"; the lane's finding: "Horse bet size and timing
 * are tells". Measured on every human-seated PLO4/PLO5 cash hand of
 * 2026-11-10 21:30Z to 2026-11-15 17:33Z (4,573 hands, 3,241 Horse postflop
 * bets and raises with the Horse's cards; sizing-20261116/MEASURE.md): inside
 * the same public spot (street, spot, heads-up or not, position, board
 * texture, stack-to-pot band) the size the Horse chose carried 0.13 bits of
 * its 2.1-bit hand class beyond chance (permutation p = 0.003; 0.15 bits
 * across all spots). A flop bet of 71-90% of the pot was weak or a draw
 * 47-66% of the time while 31-70% was nut-class 39-61% of the time; a
 * river bet of 91% or more was the nuts 90% of the time. Each strategy branch
 * of HorseLogic (value, thin value, semi-bluff, bluff, monster, the river nut
 * rules) carries its own fraction of the pot, so the size names the branch.
 *
 * This module is the one producer of the size when the option is on: the size
 * is chosen from a small menu by what the table can see (street, board
 * texture class, pot, the seat's chips, the legal bounds, how many opponents,
 * position, the heads-up opponent's MEASURED fold-to-bet read, which is the
 * same for every hand the Horse holds) and a random draw from a stream of its
 * own. Whether to bet is still the engine's private-hand decision; every hand
 * the engine decides to bet in a public spot gets the same size distribution.
 *
 * It takes no hole card, no hand class, no equity, no strategy stream and no
 * receipt of which rule decided (aBetSizeIsPublicInformationOnly.law.test.ts
 * reads this file). Every constant below is a builder's choice, NOT MEASURED.
 * Pure apart from the dedicated random stream. No I/O.
 */
import { randomBytes } from 'node:crypto';
import type { Card } from '../types.js';

export type HorsePublicBetStreet = 'flop' | 'turn' | 'river';
/** dry, wet (two-tone or a straight possible), flush (three or more of a suit), paired. */
export type HorsePublicBoardClass = 'dry' | 'wet' | 'flush' | 'paired';

export interface HorsePublicBetSizeSpot {
  street: HorsePublicBetStreet;
  /** 'bet': nothing to call; 'raise': facing a wager. */
  kind: 'bet' | 'raise';
  /** The board as dealt so far. */
  board: readonly Card[];
  /** The pot-limit pot: every chip in the middle, this street's wagers included. */
  pot: number;
  /** The street's highest wager. */
  currentBet: number;
  /** The seat's own chips already in on this street. */
  seatBet: number;
  /** The seat's chips behind. */
  seatStack: number;
  /** The table's legal raise-to bounds for the seat. */
  minTo: number;
  maxTo: number;
  /** Opponents still contesting the pot. */
  opponents: number;
  /** The seat acts after every opponent who can still act. */
  inPosition: boolean;
  /** Heads-up only: the opponent's measured fold-to-bet read ('high' folds
   *  more than the envelope, 'low' less); null when unmeasured or multiway. */
  opponentFoldToBet: 'high' | 'low' | null;
}

// ── the dedicated size stream ───────────────────────────────────────────────
// xorshift32, seeded from the operating system at load. It is never seeded
// from a hand, a card or the strategy stream, and only this module advances it.
let sizeState = (randomBytes(4).readUInt32LE(0) || 0x6d2b79f5) >>> 0;

/** Pin the size stream (tests and replays only). */
export function seedHorseBetSizeRandom(seed: number): void {
  let h = (seed >>> 0) ^ 0x6d2b79f5;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  sizeState = (h ^ (h >>> 16)) >>> 0 || 1;
}

/** The size stream's position, and putting it back (a side ask that must not move the decision's own draws). */
export function saveHorseBetSizeRandom(): number {
  return sizeState;
}
export function restoreHorseBetSizeRandom(state: number): void {
  sizeState = state >>> 0 || 1;
}

export function horseBetSizeRandom(): number {
  sizeState ^= sizeState << 13;
  sizeState ^= sizeState >>> 17;
  sizeState ^= sizeState << 5;
  sizeState >>>= 0;
  return sizeState / 4294967296;
}

const RANK: Readonly<Record<string, number>> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

/** The board's public texture class. */
export function horsePublicBoardClass(board: readonly Card[]): HorsePublicBoardClass {
  const suits = new Map<string, number>();
  const ranks = new Map<number, number>();
  for (const c of board) {
    suits.set(c.suit, (suits.get(c.suit) ?? 0) + 1);
    const r = RANK[c.rank] ?? 0;
    ranks.set(r, (ranks.get(r) ?? 0) + 1);
  }
  if (Math.max(0, ...suits.values()) >= 3) return 'flush';
  if (Math.max(0, ...ranks.values()) >= 2) return 'paired';
  const distinct = [...ranks.keys()];
  if (distinct.includes(14)) distinct.push(1);
  distinct.sort((a, b) => a - b);
  // A straight is possible when three distinct ranks fit in a five-rank window.
  let straight = false;
  for (let i = 0; i + 2 < distinct.length; i++)
    if (distinct[i + 2] - distinct[i] <= 4 && !(distinct[i] === 1 && distinct[i + 2] === 14)) {
      straight = true;
      break;
    }
  if (straight || Math.max(0, ...suits.values()) === 2) return 'wet';
  return 'dry';
}

/** Share of the pot for a bet, by street and board class (builder's choice). */
export const HORSE_PUBLIC_BET_FRACTION: Readonly<
  Record<HorsePublicBetStreet, Readonly<Record<HorsePublicBoardClass, number>>>
> = Object.freeze({
  flop: Object.freeze({ dry: 0.4, wet: 0.6, flush: 0.55, paired: 0.4 }),
  turn: Object.freeze({ dry: 0.55, wet: 0.7, flush: 0.66, paired: 0.55 }),
  river: Object.freeze({ dry: 0.66, wet: 0.75, flush: 0.75, paired: 0.66 }),
});
/** A raise adds this share of the pot after the call (1 = the pot-limit raise). */
export const HORSE_PUBLIC_RAISE_FRACTION: Readonly<Record<HorsePublicBetStreet, number>> =
  Object.freeze({ flop: 0.8, turn: 1, river: 1 });
/** The fixed mix: 20% of bets a quarter smaller, 15% 30% larger, the rest the base size. */
export const HORSE_PUBLIC_BET_MIX = Object.freeze({
  smallShare: 0.2,
  smallScale: 0.75,
  largeShare: 0.15,
  largeScale: 1.3,
});
/** A size that would put this share of the seat's chips in is a commitment:
 *  there every betting hand wagers the largest legal amount (the pot-limit
 *  cap or every chip), so a low stack-to-pot spot has one size too. */
export const HORSE_PUBLIC_COMMITMENT_SHARE = 0.6;

/**
 * The share of the pot (a bet) or of the pot after the call (a raise) for this
 * public spot and one uniform draw in [0, 1). Pure.
 */
export function horsePublicBetFraction(spot: HorsePublicBetSizeSpot, unit: number): number {
  if (spot.kind === 'raise') return HORSE_PUBLIC_RAISE_FRACTION[spot.street];
  let f = HORSE_PUBLIC_BET_FRACTION[spot.street][horsePublicBoardClass(spot.board)];
  if (spot.opponents >= 2) f *= 1.15;
  if (!spot.inPosition) f *= 0.95;
  // The read moves the size of the whole betting range: a measured station
  // pays a larger size, a measured folder folds to a smaller one.
  if (spot.opponents === 1 && spot.opponentFoldToBet === 'low') f *= 1.15;
  if (spot.opponents === 1 && spot.opponentFoldToBet === 'high') f *= 0.85;
  const u = Number.isFinite(unit) ? unit : 0.5;
  if (u < HORSE_PUBLIC_BET_MIX.smallShare) f *= HORSE_PUBLIC_BET_MIX.smallScale;
  else if (u >= 1 - HORSE_PUBLIC_BET_MIX.largeShare) f *= HORSE_PUBLIC_BET_MIX.largeScale;
  return Math.max(0.25, Math.min(1, f));
}

/**
 * The raise-to amount for this public spot, one draw from the size stream,
 * rounded to the cent and inside the legal bounds. Where that size would
 * commit 60% or more of the seat's chips it is the largest legal amount
 * instead (the pot-limit cap, or every chip when that is less). null only
 * where the bounds are unusable (the engine's own decision stands there).
 * Exactly one draw per call.
 */
export function horsePublicBetSizeTo(
  spot: HorsePublicBetSizeSpot,
  random: () => number = horseBetSizeRandom
): number | null {
  const unit = random();
  const nums = [spot.pot, spot.currentBet, spot.seatBet, spot.seatStack, spot.minTo, spot.maxTo];
  if (!nums.every((n) => Number.isFinite(n) && n >= 0)) return null;
  if (!(spot.pot > 0) || !(spot.maxTo >= spot.minTo) || !(spot.seatStack > 0)) return null;
  const f = horsePublicBetFraction(spot, unit);
  const toCall = Math.max(0, spot.currentBet - spot.seatBet);
  const raw =
    spot.kind === 'bet' ? spot.seatBet + f * spot.pot : spot.currentBet + f * (spot.pot + toCall);
  const to = Math.min(spot.maxTo, Math.max(spot.minTo, Math.round(raw * 100) / 100));
  const allIn = spot.seatBet + spot.seatStack;
  if (to >= allIn - 0.005 || to - spot.seatBet >= HORSE_PUBLIC_COMMITMENT_SHARE * spot.seatStack)
    return Math.min(spot.maxTo, Math.floor(allIn * 100) / 100);
  return to;
}
