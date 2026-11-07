/**
 * THE 2026-11-06 TWENTY-BIGGEST-LOSSES REVIEW, PINNED (2026-11-07)
 *
 * Every fixture below is the stored horse_hand_reviews row: hole cards, board
 * and the hero's own actions copied from the database.
 *
 *  1. 3359671 was reported as "trip queens, not a full house". It is a full
 *     house: Qs 3c with Qd Qc 3d on the turn is queens full of threes, and
 *     Q-A or A-A beat it. plo_underfull_stackoff is correct and is pinned.
 *  2. 3363822 was reported as "aces full of sevens, beaten only by quads".
 *     The hero held Kh Ac Kd 3s, so its boat is aces full of THREES and
 *     Ad 7x makes aces full of sevens. The tag is correct and is pinned.
 *     The rule the review asked for was nevertheless broken:
 *     omahaBoatIsNut counted a possible QUADS as a bigger boat, so the top
 *     full house on a paired board was tagged an under-full. A boat that
 *     loses only to quads or a straight flush is a cooler.
 *  3. 3370600, bottom set five-betting the turn on 2h Ts 9h 3s and losing
 *     595bb when the Ks brought three spades, carried no tag at all:
 *     plo_set_stackoff reads the threats on the commit-street board, and that
 *     turn board shows two of each suit and no three-rank straight window.
 *     set_on_wet_board_stackoff is the new name for this shape.
 */

import { describe, it, expect } from 'vitest';
import { detectLeaks, omahaBoatIsNut, boardAsOf, commitStreet } from './HorseHandReview.js';
import { omahaNutStatus } from '../engine/HorseEval.js';
import type { Card } from '../types.js';

const suitMap: Record<string, Card['suit']> = {
  h: 'hearts',
  d: 'diamonds',
  c: 'clubs',
  s: 'spades',
};
const c = (spec: string): Card =>
  ({ rank: spec[0] as Card['rank'], suit: suitMap[spec[1]] }) as Card;
const cards = (s: string): Card[] => s.split(' ').map(c);

type A = { action: string; stage: string; amount?: number; isFullRaise?: boolean };
const acts = (list: Array<[string, string, number]>): A[] =>
  list.map(([action, stage, amount]) => ({ action, stage, amount }));
const sum = (a: A[]): number => a.reduce((s, x) => s + (x.amount ?? 0), 0);

// ── stored rows ─────────────────────────────────────────────────────────────
const H3359671 = {
  hole: cards('3c 6d Qs 6c 4s 8s'),
  board: cards('3d Qd Qc As Kc'),
  actions: acts([
    ['call', 'preflop', 50],
    ['raise', 'flop', 296],
    ['bet', 'turn', 742],
    ['raise', 'turn', 5143],
    ['all_in', 'turn', 29629],
  ]),
};
const H3363822 = {
  hole: cards('Kh Ac Kd 3s'),
  board: cards('As Ah 7d 7c 3d'),
  actions: acts([
    ['sb', 'preflop', 0.25],
    ['call', 'preflop', 2],
    ['check', 'flop', 0],
    ['call', 'flop', 7.75],
    ['check', 'turn', 0],
    ['call', 'turn', 23.25],
    ['check', 'river', 0],
    ['all_in', 'river', 179.25],
  ]),
};
const H3370600 = {
  hole: cards('5d 2s 2c Ac'),
  board: cards('2h Ts 9h 3s Ks'),
  actions: acts([
    ['bb', 'preflop', 0.5],
    ['ante', 'preflop', 0.5],
    ['call', 'preflop', 1.34],
    ['call', 'flop', 3.43],
    ['raise', 'turn', 27.38],
    ['raise', 'turn', 173.03],
    ['all_in', 'turn', 291.85],
  ]),
};
const H3364887 = {
  hole: cards('Kd Qs Js Jc'),
  board: cards('Jh Ah 7s 8h Th'),
  actions: acts([
    ['bb', 'preflop', 0.5],
    ['ante', 'preflop', 0.5],
    ['raise', 'preflop', 9.75],
    ['bet', 'flop', 10.92],
    ['call', 'flop', 51.74],
    ['check', 'turn', 0],
    ['all_in', 'turn', 145.69],
  ]),
};
const H3370281 = {
  hole: cards('Qh Ah 6s Qd'),
  board: cards('Th 6d Jd Qc 3c'),
  actions: acts([
    ['raise', 'preflop', 2.25],
    ['bet', 'flop', 2.37],
    ['bet', 'turn', 4.76],
    ['raise', 'turn', 47.69],
    ['all_in', 'turn', 222.84],
  ]),
};

const plo4 = (
  h: { hole: Card[]; board: Card[]; actions: A[] },
  netBB: number,
  bigBlind = 0.5,
  variant = 'plo4'
): string[] =>
  detectLeaks({
    netBB,
    invested: sum(h.actions),
    bigBlind,
    variant,
    holeCards: h.hole,
    board: h.board,
    heroActions: h.actions,
    wentToShowdown: true,
  });

describe('the PLO under-full is a full house that a bigger full house beats', () => {
  it('review 3359671: Qs 3c on Qd Qc 3d As is queens full of threes, not trips', () => {
    const turn = boardAsOf(H3359671.board, commitStreet(H3359671.actions, sum(H3359671.actions)));
    expect(turn).toEqual(cards('3d Qd Qc As'));
    expect(omahaNutStatus(H3359671.hole, turn).category).toBe(7);
    // Q-A makes queens full of aces and A-A makes aces full of queens.
    expect(omahaBoatIsNut(H3359671.hole, turn)).toBe(false);
    expect(plo4(H3359671, -1199, 50, 'plo6')).toContain('plo_underfull_stackoff');
  });

  it('review 3363822: Kh Ac Kd 3s is aces full of threes, and Ad 7x is aces full of sevens', () => {
    expect(omahaNutStatus(H3363822.hole, H3363822.board).category).toBe(7);
    expect(omahaBoatIsNut(H3363822.hole, H3363822.board)).toBe(false);
    const tags = plo4(H3363822, -425);
    expect(tags).toContain('plo_underfull_stackoff');
    // Small blind flat of a 4.5bb raise, then 425bb lost: the definition of
    // coldcall_stackoff, recorded as a measurement of the entry.
    expect(tags).toContain('coldcall_stackoff');
  });

  it('the top full house that only quads beat is not an under-full (same board shape as 3363822)', () => {
    // Ac Ah with As 7h 7d is aces full of sevens. The only better hand is
    // 7s 7c for quad sevens: no two unseen cards make a bigger full house.
    const hole = cards('Ac Ah Kh 9c');
    const board = cards('As 7h 7d 3d Kc');
    expect(omahaBoatIsNut(hole, board)).toBe(true);
    const tags = plo4({ ...H3363822, hole, board }, -425);
    expect(tags).not.toContain('plo_underfull_stackoff');
  });

  it('the top full house that only quads or a straight flush beat is not an under-full', () => {
    // 9h 9d with 9s 6h 6c is nines full of sixes on 9s 6h 6c 7h 8h: the
    // 6c is the board pair and no unseen pair beats nines full, but 6d 6s
    // make quad sixes and 5h 4h or Th Jh make a straight flush.
    const hole = cards('9h 9d 2c 3s');
    const board = cards('9s 6h 6c 7h 8h');
    expect(omahaNutStatus(hole, board).category).toBe(7);
    expect(omahaBoatIsNut(hole, board)).toBe(true);
  });
});

describe('set_on_wet_board_stackoff', () => {
  it('review 3370600: bottom set five-bets the 2-T-9-3 turn and the river brings three spades', () => {
    const tags = plo4(H3370600, -595.24);
    expect(tags).toContain('set_on_wet_board_stackoff');
    // the commit-street tag still does not claim it: the turn board had no
    // three-flush and no three-rank straight window
    expect(tags).not.toContain('plo_set_stackoff');
  });

  it('records the win side under the _won name', () => {
    const tags = plo4(H3370600, 595.24);
    expect(tags).toContain('set_on_wet_board_stackoff_won');
    expect(tags).not.toContain('set_on_wet_board_stackoff');
  });

  it('review 3364887: middle set with no heart on a three-heart turn is the same shape', () => {
    // The river Th gave hero A-K-Q-J-T, which still lost to the flush. The
    // decision was made with a set, so only a fill-up takes the tag away.
    const tags = plo4(H3364887, -437.2);
    expect(tags).toContain('set_on_wet_board_stackoff');
    expect(tags).toContain('plo_set_stackoff');
  });

  it('review 3370281: top set on a T-6-J-Q turn (three to a straight) is the same shape', () => {
    const tags = plo4(H3370281, -454.92);
    expect(tags).toContain('set_on_wet_board_stackoff');
    expect(tags).toContain('plo_set_stackoff');
  });

  it('a set with the nut flush draw on the turn has a redraw and is not tagged', () => {
    // 3370600 with the hero's clubs changed to spades: Ac 5s with Ts 3s is
    // the nut flush draw when the money went in.
    const tags = plo4(
      { ...H3370600, hole: cards('5s 2s 2c As'), board: cards('2h Ts 9h 3s Kd') },
      -595
    );
    expect(tags).not.toContain('set_on_wet_board_stackoff');
  });

  it('a set that fills up by the river is a full house, not this tag', () => {
    const tags = plo4({ ...H3370600, board: cards('2h Ts 9h 3s 3h') }, -595);
    expect(tags).not.toContain('set_on_wet_board_stackoff');
  });

  it('a set on a board that stays dry is not tagged', () => {
    const tags = plo4({ ...H3370600, board: cards('2h Kc 7d 4s 9c') }, -595);
    expect(tags).not.toContain('set_on_wet_board_stackoff');
  });

  it('a flop commit is not this tag (the turn and river carry it)', () => {
    const actions = acts([
      ['call', 'preflop', 1.34],
      ['raise', 'flop', 27.38],
      ['all_in', 'flop', 291.85],
    ]);
    const tags = plo4({ ...H3370600, actions }, -320);
    expect(tags).not.toContain('set_on_wet_board_stackoff');
  });

  it('does not fire below the 100bb bar', () => {
    const actions = acts([
      ['call', 'preflop', 1.34],
      ['raise', 'turn', 20],
    ]);
    const tags = plo4({ ...H3370600, actions }, -40);
    expect(tags).not.toContain('set_on_wet_board_stackoff');
  });
});
