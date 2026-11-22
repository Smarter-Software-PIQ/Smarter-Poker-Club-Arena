/**
 * SPARRING LEAGUE HI-LO RUNOUT EQUITY (2026-11-21).
 *
 * SparringLeague.runoutEquity previously scored only high hands (scoreOmahaHi),
 * ignoring variantInfo(variant).isHiLo. On a qualifying 8-or-better low board
 * in plo8 / flo8, an A2 nut-low hand against a nut-high hand got 0.0 instead of
 * 0.5, misclassifying hi-lo value wagers in tell collection.
 *
 * These tests pin exact hi-lo split equity (split, scoop, quartering, 3/4 pot,
 * no-qualifying-low scoop, turn/flop runouts, and parity with determineWinners)
 * for plo8 and flo8 while keeping high-only variants unchanged.
 */
import { describe, expect, it } from 'vitest';
import { runoutEquity } from './SparringLeague.js';
import { calculatePots, determineWinners, evaluateOmahaLowHand } from '../engine/PokerEngine.js';
import type { Card, SeatPlayer } from '../types.js';

const c = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });

function engineShare(hands: Card[][], board: Card[], variant: string): number[] {
  const stake = 1200; // divisible by 2, 3, 4, 6, 8 so exact fractions avoid odd-cent drift
  const players: SeatPlayer[] = hands.map((cards, idx) => ({
    seat: idx + 1,
    user_id: `p-${idx}`,
    username: `P${idx}`,
    stack: 0,
    bet: 0,
    totalInvested: stake,
    cards,
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
    is_horse: true,
  }));
  const total = stake * hands.length;
  const winners = determineWinners(
    players,
    board,
    calculatePots(players),
    variant,
    1,
    undefined,
    undefined,
    0.01
  );
  return players.map(
    (p) => winners.filter((w) => w.userId === p.user_id).reduce((s, w) => s + w.amount, 0) / total
  );
}

// K K 7 4 3 rainbow-ish: 7-4-3 qualifies low with two distinct low hole cards.
const lowBoard = [
  c('K', 'clubs'),
  c('K', 'diamonds'),
  c('7', 'hearts'),
  c('4', 'spades'),
  c('3', 'clubs'),
];

// K K Q J 9: fewer than three cards 8 or lower, so no low can qualify.
const noLowBoard = [
  c('K', 'clubs'),
  c('K', 'diamonds'),
  c('Q', 'hearts'),
  c('J', 'spades'),
  c('9', 'clubs'),
];

// Quads Kings, zero low cards.
const nutHighHand = [c('K', 'hearts'), c('K', 'spades'), c('Q', 'diamonds'), c('J', 'diamonds')];
// A-2 nut low (7-4-3-2-A), only pair of Kings for high.
const nutLowHand = [c('A', 'spades'), c('2', 'diamonds'), c('T', 'clubs'), c('9', 'hearts')];
// Ties A-2 nut low (7-4-3-2-A), only pair of Kings for high.
const tiedLowHand = [c('A', 'hearts'), c('2', 'clubs'), c('J', 'clubs'), c('8', 'spades')];
// High-only opponent with no qualifying low on lowBoard (only one card <= 8).
const noLowOpp = [c('Q', 'clubs'), c('Q', 'spades'), c('J', 'hearts'), c('8', 'diamonds')];

describe('SparringLeague.runoutEquity hi-lo split equity', () => {
  for (const variant of ['plo8', 'flo8'] as const) {
    it(`${variant}: A2 nut-low vs nut-high splits 0.5 / 0.5 on a qualifying low board`, () => {
      const shares = engineShare([nutLowHand, nutHighHand], lowBoard, variant);
      expect(shares).toEqual([0.5, 0.5]);
      expect(runoutEquity(nutLowHand, [nutHighHand], lowBoard, variant)).toBe(0.5);
      expect(runoutEquity(nutHighHand, [nutLowHand], lowBoard, variant)).toBe(0.5);
    });

    it(`${variant}: high hand scoops 1.0 when board has no qualifying low`, () => {
      const highOnNoLow = [
        c('K', 'hearts'),
        c('K', 'spades'),
        c('T', 'hearts'),
        c('T', 'diamonds'),
      ];
      const lowAttempt = [c('A', 'spades'), c('2', 'diamonds'), c('8', 'clubs'), c('7', 'hearts')];
      expect(evaluateOmahaLowHand(lowAttempt, noLowBoard)).toBeNull();
      const shares = engineShare([highOnNoLow, lowAttempt], noLowBoard, variant);
      expect(shares).toEqual([1, 0]);
      expect(runoutEquity(highOnNoLow, [lowAttempt], noLowBoard, variant)).toBe(1);
      expect(runoutEquity(lowAttempt, [highOnNoLow], noLowBoard, variant)).toBe(0);
    });

    it(`${variant}: high hand scoops 1.0 on a low board when no player holds a qualifying low`, () => {
      expect(evaluateOmahaLowHand(nutHighHand, lowBoard)).toBeNull();
      expect(evaluateOmahaLowHand(noLowOpp, lowBoard)).toBeNull();
      const shares = engineShare([nutHighHand, noLowOpp], lowBoard, variant);
      expect(shares).toEqual([1, 0]);
      expect(runoutEquity(nutHighHand, [noLowOpp], lowBoard, variant)).toBe(1);
      expect(runoutEquity(noLowOpp, [nutHighHand], lowBoard, variant)).toBe(0);
    });

    it(`${variant}: tied nut low quarters each low hand to 0.25 and gives high 0.5`, () => {
      const shares = engineShare([nutLowHand, nutHighHand, tiedLowHand], lowBoard, variant);
      expect(shares).toEqual([0.25, 0.5, 0.25]);
      expect(runoutEquity(nutLowHand, [nutHighHand, tiedLowHand], lowBoard, variant)).toBe(0.25);
      expect(runoutEquity(tiedLowHand, [nutHighHand, nutLowHand], lowBoard, variant)).toBe(0.25);
      expect(runoutEquity(nutHighHand, [nutLowHand, tiedLowHand], lowBoard, variant)).toBe(0.5);
    });

    it(`${variant}: winning high and tying low yields 0.75 (3/4 pot)`, () => {
      const threeQuarterHand = [
        c('A', 'spades'),
        c('2', 'diamonds'),
        c('7', 'spades'),
        c('7', 'clubs'),
      ];
      const quarteredHand = [c('A', 'hearts'), c('2', 'clubs'), c('Q', 'clubs'), c('J', 'spades')];
      const shares = engineShare([threeQuarterHand, quarteredHand], lowBoard, variant);
      expect(shares).toEqual([0.75, 0.25]);
      expect(runoutEquity(threeQuarterHand, [quarteredHand], lowBoard, variant)).toBe(0.75);
      expect(runoutEquity(quarteredHand, [threeQuarterHand], lowBoard, variant)).toBe(0.25);
    });

    it(`${variant}: winning both high and low scoops 1.0`, () => {
      const scoopBoard = [
        c('8', 'clubs'),
        c('7', 'diamonds'),
        c('4', 'hearts'),
        c('3', 'spades'),
        c('K', 'clubs'),
      ];
      const scooper = [c('A', 'spades'), c('2', 'diamonds'), c('6', 'clubs'), c('5', 'hearts')];
      const trips = [c('K', 'hearts'), c('K', 'spades'), c('Q', 'clubs'), c('J', 'spades')];
      const shares = engineShare([scooper, trips], scoopBoard, variant);
      expect(shares).toEqual([1, 0]);
      expect(runoutEquity(scooper, [trips], scoopBoard, variant)).toBe(1);
      expect(runoutEquity(trips, [scooper], scoopBoard, variant)).toBe(0);
    });

    it(`${variant}: tied high with sole low yields 0.75 / 0.25 and strictly worse low yields 0.0`, () => {
      // Board K K 7 4 3: both hands tie high with K-K-A-Q-7, only one has A-2 low (beats A-5 low).
      const hiTieNutLow = [c('A', 'spades'), c('2', 'diamonds'), c('Q', 'hearts'), c('J', 'clubs')];
      const hiTieWorseLow = [
        c('A', 'hearts'),
        c('5', 'clubs'),
        c('Q', 'diamonds'),
        c('T', 'spades'),
      ];
      const shares = engineShare([hiTieNutLow, hiTieWorseLow], lowBoard, variant);
      expect(shares).toEqual([0.75, 0.25]);
      expect(runoutEquity(hiTieNutLow, [hiTieWorseLow], lowBoard, variant)).toBe(0.75);
      expect(runoutEquity(hiTieWorseLow, [hiTieNutLow], lowBoard, variant)).toBe(0.25);

      // Strictly worse qualifying low (7-5-4-3-A) against nut low (7-4-3-2-A) and quad Kings gets 0.0.
      const worseLow = [c('A', 'hearts'), c('5', 'clubs'), c('T', 'spades'), c('9', 'diamonds')];
      const threeWay = engineShare([worseLow, nutLowHand, nutHighHand], lowBoard, variant);
      expect(threeWay).toEqual([0, 0.5, 0.5]);
      expect(runoutEquity(worseLow, [nutLowHand, nutHighHand], lowBoard, variant)).toBe(0);
    });

    it(`${variant}: turn runout averages exact split equity across all 40 remaining rivers`, () => {
      // Turn: K K 7 4. nutLowHand (A 2 T 9) loses high on every river against quad Kings,
      // and makes a qualifying low on the 16 rivers in {3, 5, 6, 8} (4 ranks x 4 suits).
      // Exact equity: 16 * 0.5 / 40 = 0.2 for nutLowHand, 0.8 for nutHighHand.
      const turnBoard = lowBoard.slice(0, 4);
      expect(runoutEquity(nutLowHand, [nutHighHand], turnBoard, variant)).toBeCloseTo(0.2, 10);
      expect(runoutEquity(nutHighHand, [nutLowHand], turnBoard, variant)).toBeCloseTo(0.8, 10);
    });

    it(`${variant}: flop runout gives nut-low positive split equity and sums to 1.0`, () => {
      const flopBoard = lowBoard.slice(0, 3);
      const loEq = runoutEquity(nutLowHand, [nutHighHand], flopBoard, variant);
      const hiEq = runoutEquity(nutHighHand, [nutLowHand], flopBoard, variant);
      expect(loEq).toBeGreaterThan(0);
      expect(loEq).toBeLessThan(0.5);
      expect(loEq + hiEq).toBeCloseTo(1, 10);
    });
  }

  it('high-only variants remain unchanged (high hand gets 1.0, low hand gets 0.0)', () => {
    for (const variant of ['plo4', 'plo5', 'plo6', 'nlh', 'flh', 'short_deck'] as const) {
      expect(runoutEquity(nutLowHand, [nutHighHand], lowBoard, variant)).toBe(0);
      expect(runoutEquity(nutHighHand, [nutLowHand], lowBoard, variant)).toBe(1);
    }
    // Omitting variant defaults to high-only.
    expect(runoutEquity(nutLowHand, [nutHighHand], lowBoard)).toBe(0);
    expect(runoutEquity(nutHighHand, [nutLowHand], lowBoard)).toBe(1);
  });
});
