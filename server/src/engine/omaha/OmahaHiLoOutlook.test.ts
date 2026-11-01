import { describe, expect, it } from 'vitest';
import type { Card } from '../../types.js';
import {
  evaluateBoardLowSurface,
  evaluateOmahaHiLoRunout,
  evaluateOmahaLowWithWitness,
} from './OmahaHiLoOutlook.js';

const c = (shorthand: string): Card => {
  const rank = shorthand.slice(0, -1) as Card['rank'];
  const suitMap: Record<string, Card['suit']> = {
    s: 'spades',
    h: 'hearts',
    d: 'diamonds',
    c: 'clubs',
  };
  return { rank, suit: suitMap[shorthand.slice(-1)]! };
};
const cs = (...cards: string[]): Card[] => cards.map(c);

describe('Omaha Hi-Lo (PLO8 / FLO8) runout & settlement outlook qualification', () => {
  it('Case 1: A2/no-low+348 completes nut 8-4-3-2-A low on turn 8 with exact 2-hole/3-board witnesses', () => {
    const hero = cs('As', '2s', 'Kh', 'Qd');
    const flop = cs('3c', '4d', 'Jc');
    const turn = c('8h');

    const res = evaluateOmahaHiLoRunout(hero, flop, turn);
    expect(res.beforeLow).toBeNull();
    expect(res.beforeBoardSurface.lowPossible).toBe(false);
    expect(res.afterBoardSurface).toEqual({
      lowPossible: true,
      nutLowRanks: [8, 4, 3, 2, 1],
    });
    expect(res.afterLow).toEqual({
      lowRanks: [8, 4, 3, 2, 1],
      holeIndices: [0, 1],
      boardIndices: [0, 1, 3],
      description: 'Low: 8-4-3-2-1',
    });
    expect(res.heroHasNutLowBefore).toBe(false);
    expect(res.heroHasNutLowAfter).toBe(true);
    expect(res.witnessCardDuplicatedOnBoard).toBe(false);
    expect(res.transition).toBe('made_low_from_none');
  });

  it('Case 2: unprotected A2+348/A — Ace turn counterfeits hero nut low while opponent 25 makes the wheel', () => {
    const hero = cs('As', '2s', 'Kh', 'Qd');
    const opp = cs('2h', '5h', 'Tc', '9d');
    const flop = cs('3c', '4d', '8s');
    const turn = c('Ah');

    const res = evaluateOmahaHiLoRunout(hero, flop, turn, opp);
    expect(res.beforeLow?.lowRanks).toEqual([8, 4, 3, 2, 1]);
    expect(res.heroHasNutLowBefore).toBe(true);
    // On 3-4-8-A, hero with A-2-K-Q must still use A+2 from hole and 3-4-8 from board -> 8-4-3-2-1,
    // whereas board nut low is now 5-4-3-2-1 (using 2-5 hole with 3-4-A board).
    expect(res.afterLow?.lowRanks).toEqual([8, 4, 3, 2, 1]);
    expect(res.afterBoardSurface.nutLowRanks).toEqual([5, 4, 3, 2, 1]);
    expect(res.heroHasNutLowAfter).toBe(false);
    expect(res.witnessCardDuplicatedOnBoard).toBe(true);
    expect(res.transition).toBe('counterfeited_lose_nut');
    expect(res.headToHeadAfter?.opponentLow).toEqual({
      lowRanks: [5, 4, 3, 2, 1],
      holeIndices: [0, 1],
      boardIndices: [0, 1, 3],
      description: 'Low: 5-4-3-2-1',
    });
    expect(res.headToHeadAfter?.lowOutcome).toBe('opponent');
  });

  it('Case 3: unprotected A2+348/2 — Deuce turn counterfeits hero nut low while opponent A5 makes the wheel', () => {
    const hero = cs('As', '2s', 'Kh', 'Qd');
    const opp = cs('Ah', '5h', 'Tc', '9d');
    const flop = cs('3c', '4d', '8s');
    const turn = c('2d');

    const res = evaluateOmahaHiLoRunout(hero, flop, turn, opp);
    expect(res.beforeLow?.lowRanks).toEqual([8, 4, 3, 2, 1]);
    expect(res.heroHasNutLowBefore).toBe(true);
    expect(res.afterLow?.lowRanks).toEqual([8, 4, 3, 2, 1]);
    expect(res.afterBoardSurface.nutLowRanks).toEqual([5, 4, 3, 2, 1]);
    expect(res.heroHasNutLowAfter).toBe(false);
    expect(res.witnessCardDuplicatedOnBoard).toBe(true);
    expect(res.transition).toBe('counterfeited_lose_nut');
    expect(res.headToHeadAfter?.opponentLow).toEqual({
      lowRanks: [5, 4, 3, 2, 1],
      holeIndices: [0, 1],
      boardIndices: [0, 1, 3],
      description: 'Low: 5-4-3-2-1',
    });
    expect(res.headToHeadAfter?.lowOutcome).toBe('opponent');
  });

  it('Case 4: protected A25+348/A — backup 2-5 hole indices [1,2] + board [0,1,3] switch to the 5-4-3-2-A wheel', () => {
    const hero = cs('As', '2s', '5s', 'Kh');
    const flop = cs('3c', '4d', '8s');
    const turn = c('Ah');

    const res = evaluateOmahaHiLoRunout(hero, flop, turn);
    expect(res.beforeLow).toEqual({
      lowRanks: [8, 4, 3, 2, 1],
      holeIndices: [0, 1],
      boardIndices: [0, 1, 2],
      description: 'Low: 8-4-3-2-1',
    });
    expect(res.afterLow).toEqual({
      lowRanks: [5, 4, 3, 2, 1],
      holeIndices: [1, 2],
      boardIndices: [0, 1, 3],
      description: 'Low: 5-4-3-2-1',
    });
    expect(res.heroHasNutLowBefore).toBe(true);
    expect(res.heroHasNutLowAfter).toBe(true);
    expect(res.witnessCardDuplicatedOnBoard).toBe(true);
    expect(res.transition).toBe('improved_low');
  });

  it('Case 5: A25K/3489/5 vs QQJT — river 5 gives hero both the wheel high straight and nut wheel low for a full scoop', () => {
    const hero = cs('As', '2s', '5d', 'Kh');
    const opp = cs('Qh', 'Qd', 'Jc', 'Ts');
    const turnBoard = cs('3c', '4d', '8s', '9h');
    const river = c('5c');

    const res = evaluateOmahaHiLoRunout(hero, turnBoard, river, opp, 200);
    expect(res.afterLow).toEqual({
      lowRanks: [5, 4, 3, 2, 1],
      holeIndices: [0, 1],
      boardIndices: [0, 1, 4],
      description: 'Low: 5-4-3-2-1',
    });
    expect(res.headToHeadAfter).toEqual({
      opponentLow: null,
      highOutcome: 'hero',
      lowOutcome: 'hero',
      potShareHero: 1,
      potShareOpponent: 0,
      settlementClass: 'hero_scoop',
    });
  });

  it('Case 6: A2KQ/3489/K vs A299 — tied 8-4-3-2-A nut low and opponent set of nines quarters hero (0.25 vs 0.75)', () => {
    const hero = cs('As', '2s', 'Kh', 'Qd');
    const opp = cs('Ah', '2d', '9s', '9c');
    const turnBoard = cs('3c', '4d', '8s', '9h');
    const river = c('Kc');

    const res = evaluateOmahaHiLoRunout(hero, turnBoard, river, opp, 200);
    expect(res.afterLow?.lowRanks).toEqual([8, 4, 3, 2, 1]);
    expect(res.headToHeadAfter?.opponentLow?.lowRanks).toEqual([8, 4, 3, 2, 1]);
    expect(res.headToHeadAfter?.highOutcome).toBe('opponent');
    expect(res.headToHeadAfter?.lowOutcome).toBe('tie');
    expect(res.headToHeadAfter?.potShareHero).toBe(0.25);
    expect(res.headToHeadAfter?.potShareOpponent).toBe(0.75);
    expect(res.headToHeadAfter?.settlementClass).toBe('opponent_three_quarters');
  });

  it('refuses duplicate physical cards across hero hole, board, runout, and opponent hole', () => {
    const hero = cs('As', '2s', 'Kh', 'Qd');
    const flop = cs('3c', '4d', '8s');
    expect(() => evaluateOmahaLowWithWitness(hero, [c('As'), c('3c'), c('4d')])).toThrow(
      /Duplicate physical card refused: A:spades/
    );
    expect(() => evaluateBoardLowSurface([c('3c'), c('3c'), c('4d')])).toThrow(
      /Duplicate physical card refused: 3:clubs/
    );
    expect(() => evaluateOmahaHiLoRunout(hero, flop, c('2s'))).toThrow(
      /Duplicate physical card refused: 2:spades/
    );
  });
});
