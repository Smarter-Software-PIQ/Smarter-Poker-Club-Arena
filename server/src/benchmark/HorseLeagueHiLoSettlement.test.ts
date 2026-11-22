/**
 * THE LEAGUE PAYS A HI-LO POT AS THE ENGINE DOES (2026-11-21).
 *
 * Until this date the league's showdown (playHand) paid every pot to the best
 * HIGH hand, so a plo8 pot with a qualifying low went whole to the high hand
 * and every PLO8 league card measured a high-only game. settleLeagueShowdown
 * now pays a hi-lo pot through the engine's own determineWinners, the
 * function HandController.completeHand pays real pots with. These cases pin
 * that the league's award equals the engine's award (low half, scoop, side
 * pots, quartering, odd cent), and that a dealt plo8 hand settles that way.
 */
import { describe, it, expect } from 'vitest';
import { settleLeagueShowdown, playHand } from './HorseLeague.js';
import { calculatePots, determineWinners, evaluateOmahaLowHand } from '../engine/PokerEngine.js';
import type { Card, SeatPlayer } from '../types.js';

const c = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });

function seat(n: number, cards: Card[], contributed: number, folded = false) {
  return {
    contributed,
    player: {
      seat: n,
      user_id: `league-${n}`,
      username: `League${n}`,
      stack: 0,
      bet: 0,
      totalInvested: contributed,
      cards,
      is_folded: folded,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: true,
    } as SeatPlayer,
  };
}

/** What HandController.completeHand pays these seats: calculatePots, then
 *  determineWinners in the cash unit, summed per seat. */
function engineAward(
  seats: ReturnType<typeof seat>[],
  board: Card[],
  variant: string,
  dealerSeat: number
): number[] {
  const players = seats.map((s) => s.player);
  const winners = determineWinners(
    players,
    board,
    calculatePots(players),
    variant,
    dealerSeat,
    undefined,
    undefined,
    0.01
  );
  return seats.map((s) =>
    winners.filter((w) => w.userId === s.player.user_id).reduce((t, w) => t + w.amount, 0)
  );
}

const pot = (seats: ReturnType<typeof seat>[]) => seats.reduce((t, s) => t + s.contributed, 0);
const cents = (xs: number[]) => xs.map((x) => Math.round(x * 100));

// K K 7 3 2: a low is possible (7-3-2 plus two low hole cards).
const lowBoard = [
  c('K', 'clubs'),
  c('K', 'diamonds'),
  c('7', 'hearts'),
  c('3', 'spades'),
  c('2', 'clubs'),
];
// K K Q J 9: no low can qualify.
const noLowBoard = [
  c('K', 'clubs'),
  c('K', 'diamonds'),
  c('Q', 'hearts'),
  c('J', 'spades'),
  c('9', 'clubs'),
];
const highHand = [c('K', 'hearts'), c('Q', 'hearts'), c('J', 'hearts'), c('9', 'diamonds')];
const lowHand = [c('A', 'spades'), c('4', 'diamonds'), c('5', 'clubs'), c('6', 'hearts')];
const sameLow = [c('A', 'hearts'), c('4', 'clubs'), c('T', 'clubs'), c('T', 'hearts')];

describe('settleLeagueShowdown pays a plo8 pot exactly as the engine does', () => {
  it('a qualifying low takes half the pot (the high-only league paid it nothing)', () => {
    const seats = [seat(1, highHand, 50), seat(2, lowHand, 50)];
    const paid = settleLeagueShowdown(seats, lowBoard, 'plo8', 1, pot(seats));
    expect(cents(paid)).toEqual(cents(engineAward(seats, lowBoard, 'plo8', 1)));
    expect(paid).toEqual([50, 50]);
  });

  it('with no qualifying low the high hand scoops', () => {
    const seats = [seat(1, highHand, 50), seat(2, lowHand, 50)];
    const paid = settleLeagueShowdown(seats, noLowBoard, 'plo8', 1, pot(seats));
    expect(evaluateOmahaLowHand(lowHand, noLowBoard)).toBeNull();
    expect(cents(paid)).toEqual(cents(engineAward(seats, noLowBoard, 'plo8', 1)));
    expect(paid).toEqual([100, 0]);
  });

  it('a tied low is quartered, a short all-in plays only its side pot, and the odd cent goes high', () => {
    // seat 3 is all in for less; seats 1 and 2 build a side pot over it.
    for (const dealer of [1, 2, 3]) {
      const seats = [seat(1, highHand, 100.03), seat(2, lowHand, 100.03), seat(3, sameLow, 40.01)];
      const paid = settleLeagueShowdown(seats, lowBoard, 'plo8', dealer, pot(seats));
      expect(cents(paid)).toEqual(cents(engineAward(seats, lowBoard, 'plo8', dealer)));
      expect(Math.round(paid.reduce((t, x) => t + x, 0) * 100)).toBe(Math.round(pot(seats) * 100));
    }
  });

  it('a folded contributor is paid nothing and its chips stay in the pot', () => {
    const seats = [seat(1, highHand, 30), seat(2, lowHand, 30), seat(3, sameLow, 12, true)];
    const paid = settleLeagueShowdown(seats, lowBoard, 'plo8', 2, pot(seats));
    expect(cents(paid)).toEqual(cents(engineAward(seats, lowBoard, 'plo8', 2)));
    expect(paid[2]).toBe(0);
  });

  it('a folded blind merges into the main pot before splitting an odd-cent tie (flo8 parity with calculatePots)', () => {
    // Folded SB contributed 1; three live seats contributed 3 each (total pot 10).
    // Without merging identical eligible sets, layers of 4 and 6 would round a
    // 3-way tie separately and diverge from HandController's calculatePots by 1 cent.
    const lowTieA = [c('A', 'spades'), c('4', 'diamonds'), c('Q', 'clubs'), c('J', 'clubs')];
    const lowTieB = [c('A', 'hearts'), c('4', 'clubs'), c('T', 'clubs'), c('T', 'hearts')];
    const lowTieC = [c('A', 'diamonds'), c('4', 'hearts'), c('9', 'clubs'), c('9', 'spades')];
    for (const dealer of [1, 2, 3, 4]) {
      const seats = [
        seat(1, highHand, 1, true),
        seat(2, lowTieA, 3),
        seat(3, lowTieB, 3),
        seat(4, lowTieC, 3),
      ];
      const paid = settleLeagueShowdown(seats, lowBoard, 'flo8', dealer, pot(seats));
      expect(cents(paid)).toEqual(cents(engineAward(seats, lowBoard, 'flo8', dealer)));
      expect(Math.round(paid.reduce((t, x) => t + x, 0) * 100)).toBe(Math.round(pot(seats) * 100));
    }
  });

  it('a high-only variant keeps the league settlement unchanged', () => {
    const seats = [seat(1, highHand, 50), seat(2, lowHand, 50)];
    expect(settleLeagueShowdown(seats, lowBoard, 'plo4', 1, pot(seats))).toEqual([100, 0]);
  });
});

describe('a dealt plo8 league hand settles its low half', () => {
  it('heads-up showdowns split high and low the way the engine pays them', () => {
    let splitShowdowns = 0;
    let scoopShowdowns = 0;
    for (let seed = 1; seed <= 400 && splitShowdowns < 3; seed++) {
      let end: { endedByFolds: boolean; cards: Card[][]; board: Card[]; net: number[] } | undefined;
      const net = playHand(
        20261121 + seed,
        1,
        () => ({}),
        undefined,
        undefined,
        'plo8',
        2,
        100,
        undefined,
        undefined,
        undefined,
        undefined,
        false,
        { onEnd: (e) => (end = e) }
      );
      if (!end || end.endedByFolds) continue;
      // Heads-up at equal stacks both live seats paid the same amount, so
      // the pot is 2x and each seat's award is net + x.
      const lows = end.cards.map((h) => evaluateOmahaLowHand(h, end!.board));
      const players = end.cards.map((cards, i) => seat(i + 1, cards, 1).player);
      const unit = determineWinners(
        players,
        end.board,
        [{ amount: 2, eligiblePlayers: players.map((p) => p.user_id) }],
        'plo8',
        1,
        undefined,
        undefined,
        0.01
      );
      const shareOfTwo = players.map((p) =>
        unit.filter((w) => w.userId === p.user_id).reduce((t, w) => t + w.amount, 0)
      );
      if (lows.some((l) => l !== null) && shareOfTwo[0] === 1 && shareOfTwo[1] === 1) {
        // One seat high, the other low (or both tie both): each is paid back exactly.
        expect(net.map((x) => Math.round(x * 100))).toEqual([0, 0]);
        splitShowdowns++;
      } else if (lows.every((l) => l === null) && shareOfTwo[0] !== shareOfTwo[1]) {
        expect(net[shareOfTwo[0] > shareOfTwo[1] ? 0 : 1]).toBeGreaterThan(0);
        scoopShowdowns++;
      }
    }
    expect(splitShowdowns).toBeGreaterThan(0);
    expect(scoopShowdowns + splitShowdowns).toBeGreaterThan(0);
  }, 120_000);
});
