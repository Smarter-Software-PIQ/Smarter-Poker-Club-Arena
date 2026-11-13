/**
 * A HEADS-UP-ONLY RULE FIRES IN A HEADS-UP HAND AND NOWHERE ELSE (2026-11-13,
 * heads-up lane, Phase 2).
 *
 * "Heads-up" is three different things: two players dealt in (a real
 * heads-up hand, whatever the table's capacity), a multiway hand that has
 * come down to two, and two active players with a third all in. A rule
 * written for the first must say what it does in the other two.
 *
 *  - huBbDefendsToPrice (default OFF) is a PREFLOP RANGE rule: its equity
 *    table is the heads-up small blind's open range. It fires only with
 *    exactly two dealt in. Two dealt at a six-seat table is that hand and
 *    fires; a three-handed hand where the button folded and the small blind
 *    opens is blind against blind, a different opening range, and does not.
 *  - commitUnderPot (default OFF) is a PRICE rule on the flop or turn: one
 *    other player still in the hand. A third player who is all in is still
 *    in the hand (there is a main pot to lose to them), so it stands aside;
 *    a third player who folded is not, so it fires.
 *
 * Decided through the real HorseLogic.decide for the preflop rule, and at
 * commitUnderPotCall for the rule that runs after every other layer.
 */
import { describe, expect, it } from 'vitest';
import { HorseLogic, commitUnderPotCall, type HorseGameStateV2 } from './HorseLogic.js';
import { seedFastRandom } from './HorseEval.js';
import { HAND_CLASSES } from './HorseGtoOpeningRanges.js';
import { HORSE_HYBRID_PROFILES } from './HorseHybridProfile.js';
import type { ActionRecord, Card, SeatPlayer } from '../types.js';

const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'] as const;
const RANKS = 'AKQJT98765432'.split('');
const BB = 2;

type Spot = {
  stackBB: number;
  openBB: number;
  mode?: 'cash' | 'tournament';
  /** Seats 3..6 present at the table but sitting out and not dealt in. */
  emptyChairs?: boolean;
  /** Seat 3 was dealt in on the button and folded before the small blind opened. */
  buttonFolded?: boolean;
};

function holeFor(cls: string): Card[] {
  const suited = cls.length === 3 && cls[2] === 's';
  return [
    { rank: cls[0], suit: 'spades' } as Card,
    { rank: cls[1], suit: suited ? 'spades' : 'hearts' } as Card,
  ];
}

/** Seat 1 is the small blind and opens; seat 2, the hero, is the big blind. */
function stateFor(spot: Spot, hole: Card[]): { hero: SeatPlayer; gs: HorseGameStateV2 } {
  const used = new Set(hole.map((h) => h.rank + h.suit));
  const deck: Card[] = [];
  for (const r of RANKS)
    for (const su of SUITS) if (!used.has(r + su)) deck.push({ rank: r, suit: su } as Card);
  const openTo = spot.openBB * BB;
  const seat = (n: number, bet: number, over: Partial<SeatPlayer> = {}): SeatPlayer =>
    ({
      seat: n,
      user_id: `scope-${n}`,
      username: `Scope${n}`,
      stack: spot.stackBB * BB - bet,
      bet,
      totalInvested: bet,
      cards: n === 2 ? hole : [deck[n * 2], deck[n * 2 + 1]],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: true,
      ...over,
    }) as SeatPlayer;
  const players: SeatPlayer[] = [seat(1, openTo), seat(2, BB)];
  const history: ActionRecord[] = [];
  let ts = 100;
  let dealt = [1, 2];
  let dealerSeat = 1;
  if (spot.buttonFolded) {
    players.push(seat(3, 0, { is_folded: true }));
    history.push({
      seat: 3,
      userId: 'scope-3',
      action: 'fold',
      amount: 0,
      timestamp: ts++,
      stage: 'preflop',
    } as ActionRecord);
    dealt = [1, 2, 3];
    dealerSeat = 3;
  }
  if (spot.emptyChairs)
    for (let n = 3; n <= 6; n++) players.push(seat(n, 0, { is_sitting_out: true, cards: [] }));
  history.push({
    seat: 1,
    userId: 'scope-1',
    action: 'raise',
    amount: openTo,
    timestamp: ts++,
    stage: 'preflop',
    isFullRaise: true,
  } as ActionRecord);
  const mode = spot.mode ?? 'cash';
  const gs = {
    players,
    communityCards: [],
    pot: openTo + BB,
    currentBet: openTo,
    minRaise: openTo - BB,
    lastRaise: openTo - BB,
    stage: 'preflop',
    gameVariant: 'nlh',
    bigBlind: BB,
    dealerSeat,
    actionHistory: history,
    gameMode: mode,
    ante: 0,
    format: mode === 'cash' ? 'cash' : 'mtt',
    dealtSeatIds: dealt,
  } as unknown as HorseGameStateV2;
  return { hero: players[1], gs };
}

/** Classes whose answer the flag changes (always fold -> continue). */
function changedByFlag(spot: Spot): number {
  const hybrid = HORSE_HYBRID_PROFILES[spot.mode === 'tournament' ? 'tournament' : 'cash'];
  let changed = 0;
  for (const h of HAND_CLASSES) {
    const act = (on: boolean) => {
      const { hero, gs } = stateFor(spot, holeFor(h.cls));
      seedFastRandom(7 + h.cls.charCodeAt(0) * 31 + h.cls.charCodeAt(1));
      return HorseLogic.decide(
        hero,
        gs,
        hybrid.style,
        { ...hybrid.mods },
        {
          mind: false,
          decisionTimeMs: Date.UTC(2026, 10, 13, 12, 0, 0),
          ...(on ? { huBbDefendsToPrice: true } : {}),
        }
      ).action;
    };
    if (act(true) !== act(false)) changed++;
  }
  return changed;
}

describe('huBbDefendsToPrice fires with exactly two dealt in', () => {
  const base: Spot = { stackBB: 40, openBB: 2.5 };

  it('fires at a two-seat table', () => {
    expect(changedByFlag(base)).toBeGreaterThan(20);
  });

  it('fires the same when the two are dealt at a six-seat table with empty chairs', () => {
    expect(changedByFlag({ ...base, emptyChairs: true })).toBe(changedByFlag(base));
  });

  it('does not fire blind against blind after a dealt-in button folded', () => {
    expect(changedByFlag({ ...base, buttonFolded: true })).toBe(0);
  });

  it('does not fire in a tournament, below 20bb, or against an open above 6bb', () => {
    expect(changedByFlag({ ...base, mode: 'tournament' })).toBe(0);
    expect(changedByFlag({ ...base, stackBB: 15 })).toBe(0);
    expect(changedByFlag({ ...base, openBB: 7 })).toBe(0);
  });
});

describe('commitUnderPot counts every player still in the hand', () => {
  const spot = (third: Partial<SeatPlayer> | null) => {
    const hero = { seat: 1, user_id: 'h', stack: 40, bet: 0, is_folded: false } as SeatPlayer;
    const villain = { seat: 2, user_id: 'v', stack: 60, bet: 30, is_folded: false } as SeatPlayer;
    const players = [hero, villain];
    if (third)
      players.push({
        seat: 3,
        user_id: 't',
        stack: 0,
        bet: 0,
        is_folded: false,
        ...third,
      } as SeatPlayer);
    const gs = {
      players,
      communityCards: [],
      pot: 100,
      currentBet: 30,
      stage: 'flop',
      gameVariant: 'nlh',
      bigBlind: 2,
    } as unknown as HorseGameStateV2;
    return { hero, gs };
  };
  const fold = { action: 'fold' as const, thinkTime: 1 };
  const ON = { commitUnderPot: true };

  it('fires heads-up and after a third player folded', () => {
    for (const third of [null, { is_folded: true, stack: 60 }]) {
      const { hero, gs } = spot(third);
      expect(commitUnderPotCall(fold, hero, gs, ON).action).toBe('call');
    }
  });

  it('stands aside when a third player is all in for a main pot', () => {
    const { hero, gs } = spot({ is_all_in: true });
    expect(commitUnderPotCall(fold, hero, gs, ON)).toBe(fold);
  });
});
