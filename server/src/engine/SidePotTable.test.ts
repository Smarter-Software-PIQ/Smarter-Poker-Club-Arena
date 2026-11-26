/**
 * SIDE POTS, ONE TABLE OF CASES (2026-11-26).
 *
 * calculatePots is covered by the chip-conservation property test, the
 * dead-money tests and the odd-chip tests, each from one angle. This file is
 * the single readable table: given what each seat put in and who folded, the
 * exact pots and who can win each, plus the one invariant every case must
 * keep - the pots add up to every chip in the middle.
 */
import { describe, expect, it } from 'vitest';
import { calculatePots } from './PokerEngine.js';
import type { SeatPlayer } from '../types.js';

type In = { seat: number; put: number; folded?: boolean; dead?: number };
type Out = { amount: number; eligible: number[] };

const seat = ({ seat, put, folded, dead }: In): SeatPlayer =>
  ({
    seat,
    user_id: `u${seat}`,
    username: `P${seat}`,
    stack: 0,
    bet: 0,
    cards: [],
    totalInvested: put,
    deadInvested: dead ?? 0,
    is_folded: folded ?? false,
    is_all_in: false,
    is_sitting_out: false,
  }) as SeatPlayer;

const CASES: Array<{ name: string; seats: In[]; pots: Out[] }> = [
  {
    name: 'everyone matched: one pot',
    seats: [
      { seat: 1, put: 100 },
      { seat: 2, put: 100 },
      { seat: 3, put: 100 },
    ],
    pots: [{ amount: 300, eligible: [1, 2, 3] }],
  },
  {
    name: 'one short all-in: main pot and one side pot',
    seats: [
      { seat: 1, put: 50 },
      { seat: 2, put: 200 },
      { seat: 3, put: 200 },
    ],
    pots: [
      { amount: 150, eligible: [1, 2, 3] },
      { amount: 300, eligible: [2, 3] },
    ],
  },
  {
    name: 'three different all-ins: main pot and two side pots',
    seats: [
      { seat: 1, put: 25 },
      { seat: 2, put: 75 },
      { seat: 3, put: 150 },
      { seat: 4, put: 150 },
    ],
    pots: [
      { amount: 100, eligible: [1, 2, 3, 4] },
      { amount: 150, eligible: [2, 3, 4] },
      { amount: 150, eligible: [3, 4] },
    ],
  },
  {
    name: 'a folded seat pays into the pots it reached and wins none',
    seats: [
      { seat: 1, put: 40 },
      { seat: 2, put: 120, folded: true },
      { seat: 3, put: 120 },
      { seat: 4, put: 120 },
    ],
    pots: [
      { amount: 160, eligible: [1, 3, 4] },
      { amount: 240, eligible: [3, 4] },
    ],
  },
  {
    name: 'the only callers above a level folded: their chips join the main pot',
    seats: [
      { seat: 1, put: 50 },
      { seat: 2, put: 50 },
      { seat: 3, put: 90, folded: true },
      { seat: 4, put: 90, folded: true },
    ],
    pots: [{ amount: 280, eligible: [1, 2] }],
  },
  {
    name: 'cents: a 0.01 difference still makes its own pot',
    seats: [
      { seat: 1, put: 10.0 },
      { seat: 2, put: 10.01 },
      { seat: 3, put: 10.01 },
    ],
    pots: [
      { amount: 30, eligible: [1, 2, 3] },
      { amount: 0.02, eligible: [2, 3] },
    ],
  },
  {
    name: 'an ante-only all-in can contest the dead money only',
    seats: [
      { seat: 1, put: 100 },
      { seat: 2, put: 100 },
      { seat: 3, put: 5, dead: 5 },
    ],
    pots: [
      { amount: 5, eligible: [1, 2, 3] },
      { amount: 200, eligible: [1, 2] },
    ],
  },
];

const cents = (n: number) => Math.round(n * 100) / 100;

describe('side pots, one table of cases', () => {
  for (const c of CASES) {
    it(c.name, () => {
      const pots = calculatePots(c.seats.map(seat));
      expect(
        pots.map((p) => ({
          amount: cents(p.amount),
          eligible: p.eligiblePlayers.map((u) => Number(u.slice(1))).sort((a, b) => a - b),
        }))
      ).toEqual(c.pots);
      const inMiddle = cents(c.seats.reduce((s, x) => s + x.put, 0));
      expect(cents(pots.reduce((s, p) => s + p.amount, 0))).toBe(inMiddle);
    });
  }
});
