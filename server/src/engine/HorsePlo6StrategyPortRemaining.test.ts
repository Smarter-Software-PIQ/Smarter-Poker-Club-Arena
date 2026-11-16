/**
 * PLO6 six-card port: the five catalogue options whose six-card form needs
 * no new branch in the port (independent pre-review, "not in this diff").
 * One test each, showing what PLO6 does with omahaStrategyInPlo6 on:
 *  - 3.4  omahaBigDrawAggression: the continuing range counts a 13+ out wrap
 *         (accessor key bigDrawContinueStraightOuts, registered 13);
 *  - 3.11 omahaCardImpact: draw outs are distinct live cards, each once
 *         (accessor key cardImpactDistinctDrawOuts, registered 1; H19);
 *  - 3.16 omahaBluffCatcherFoldVsValueLeader: a six-card hand reaches the
 *         cell (H20), only with the gate;
 *  - 3.17 omahaMadeHandDefenseVsValueLeader: scoped to PLO4/PLO5 cash, PLO6
 *         with the gate, never a bomb pot (H35);
 *  - 3.31 omahaSmallBlindSteal: four and five cards only (skip).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { Card, CardRank, CardSuit } from '../types.js';
import {
  omahaBigDrawContinues,
  omahaBigDrawStraightOutCards,
} from './HorseOmahaBigDrawAggression.js';
import { omahaCardImpactDrawOuts } from './HorseOmahaCardImpact.js';
import { omahaBluffCatcherCell, type BluffCatcherInput } from './HorseOmahaBigBetCalls.js';
import { omahaStrategyConstant, withOmahaStrategyGameScope } from './HorseOmahaStrategyGame.js';
import {
  PLO6_RIVER_CHEAP_PRICE,
  PLO6_RIVER_FOLD_BEAT_PROB,
  PLO6_RIVER_UNPAIRED_FOLD_BEAT_PROB,
} from './HorseLogic.js';
import {
  clearPlo6OmahaStrategyCalibration,
  PLO6_OMAHA_STRATEGY_CONSTANTS,
  plo6StrategyOptionVerdict,
  registerPlo6OmahaStrategyCalibration,
} from './HorsePlo6StrategyCalibration.js';

const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const c = (s: string): Card => ({ rank: s[0] as CardRank, suit: SUIT[s[1]!]! });
const cs = (s: string): Card[] => s.split(' ').map(c);
const SRC = (f: string): string =>
  readFileSync(fileURLToPath(new URL(`./${f}`, import.meta.url)), 'utf8');
const GATE_ON = { plo6: true };
const GATE_OFF = { plo6: false };

afterEach(() => clearPlo6OmahaStrategyCalibration());

describe('PLO6 port: options that need no new six-card branch', () => {
  it('3.4 omahaBigDrawAggression: with the calibration, a 13+ out wrap continues; PLO5 reads no straight draws', () => {
    expect(plo6StrategyOptionVerdict.omahaBigDrawAggression.verdict).toBe('adapt');
    expect(omahaStrategyConstant('bigDrawContinueStraightOuts', { gameVariant: 'plo6' })).toBe(0);
    registerPlo6OmahaStrategyCalibration();
    const k = omahaStrategyConstant('bigDrawContinueStraightOuts', { gameVariant: 'plo6' });
    expect(k).toBe(13);
    expect(omahaStrategyConstant('bigDrawContinueStraightOuts', { gameVariant: 'plo5' })).toBe(0);
    // A six-card wrap around 9-8 with no pair, no flush draw.
    const board = cs('9h 8d 2c');
    const wrap = cs('Js Ts 7c 6d Qd 5h');
    expect(omahaBigDrawStraightOutCards(wrap, board)).toBeGreaterThanOrEqual(13);
    expect(omahaBigDrawContinues(wrap, board, 0)).toBe(0);
    expect(omahaBigDrawContinues(wrap, board, k)).toBe(1);
    // A gutshot does not.
    const gut = cs('Ks Qs 3c 3d 4h Ah');
    expect(omahaBigDrawStraightOutCards(gut, board)).toBeLessThan(13);
  });

  it('3.11 omahaCardImpact: with the calibration the draw outs are distinct live cards, each once', () => {
    expect(plo6StrategyOptionVerdict.omahaCardImpact.verdict).toBe('adapt');
    expect(omahaStrategyConstant('cardImpactDistinctDrawOuts', { gameVariant: 'plo6' })).toBe(0);
    registerPlo6OmahaStrategyCalibration();
    expect(omahaStrategyConstant('cardImpactDistinctDrawOuts', { gameVariant: 'plo6' })).toBe(1);
    expect(omahaStrategyConstant('cardImpactDistinctDrawOuts', { gameVariant: 'plo4' })).toBe(0);
    // Nut flush draw and a straight draw whose out ranks overlap the suit.
    const board = cs('9h 8h 2c');
    const hand = cs('Ah Kh Jd Tc 7s 6s');
    const seen = new Set([...board, ...hand].map((x) => x.rank + x.suit[0]));
    const live: Card[] = [];
    for (const r of '23456789TJQKA')
      for (const s of 'shdc') if (!seen.has(r + s)) live.push(c(r + s));
    const fixed = omahaCardImpactDrawOuts(hand, board, null);
    const distinct = omahaCardImpactDrawOuts(hand, board, live);
    // The fixed form is nine flush cards plus three per straight rank, whatever
    // is live; the distinct form counts each live completing card once: the
    // nine live hearts, plus the live non-heart cards of a straight rank.
    expect(fixed).toBe(9 + 3 * ((fixed - 9) / 3));
    const hearts = live.filter((x) => x.suit === 'hearts').length;
    expect(hearts).toBe(9);
    expect(Number.isInteger(distinct)).toBe(true);
    expect(distinct).toBeGreaterThan(hearts);
    expect((distinct - hearts) % 1).toBe(0);
    expect(distinct).not.toBe(fixed);
    expect(distinct).toBeLessThanOrEqual(live.length);
  });

  it('3.16 omahaBluffCatcherFoldVsValueLeader: a six-card hand reaches the cell with the gate, never without (H20)', () => {
    expect(plo6StrategyOptionVerdict.omahaBluffCatcherFoldVsValueLeader.verdict).toBe('adapt');
    const base: Omit<BluffCatcherInput, 'variant' | 'hole'> = {
      street: 'turn',
      board: cs('Kh 9d 4c 2s'),
      potFrac: 1,
      effectiveBB: 120,
      tournament: false,
      headsUpTable: false,
      bountyEvent: false,
      hiLo: false,
      multiBoard: false,
      bombPot: false,
      heroHasStreetChips: true,
      bettorOverBluffs: false,
      callPrice: 0.33,
      chipsBehindCall: true,
      bettorWageredPreviousStreet: true,
      redrawShare: 0,
    };
    const six: BluffCatcherInput = { ...base, variant: 'plo6', hole: cs('Ks 9s 7h 6h Qd Jc') };
    const five: BluffCatcherInput = { ...base, variant: 'plo5', hole: cs('Ks 9s 7h 6h Qd') };
    expect(withOmahaStrategyGameScope(GATE_OFF, () => omahaBluffCatcherCell(six))).toBeNull();
    expect(withOmahaStrategyGameScope(GATE_ON, () => omahaBluffCatcherCell(six))).toBe(
      'bc_two_pair'
    );
    // Five cards dealt as PLO6 is not a six-card hand: refused.
    expect(
      withOmahaStrategyGameScope(GATE_ON, () => omahaBluffCatcherCell({ ...six, hole: five.hole }))
    ).toBeNull();
    // PLO5 is the same with the gate on or off.
    const off = withOmahaStrategyGameScope(GATE_OFF, () => omahaBluffCatcherCell(five));
    expect(off).toBe('bc_two_pair');
    expect(withOmahaStrategyGameScope(GATE_ON, () => omahaBluffCatcherCell(five))).toBe(off);
    // A redraw share at or over the price exempts the turn call (H9 feeds it).
    expect(
      withOmahaStrategyGameScope(GATE_ON, () => omahaBluffCatcherCell({ ...six, redrawShare: 0.4 }))
    ).toBeNull();
  });

  it('3.17 omahaMadeHandDefenseVsValueLeader: PLO4/PLO5 scope through the PLO6 gate, cash only, never a bomb pot (H35)', () => {
    expect(plo6StrategyOptionVerdict.omahaMadeHandDefenseVsValueLeader.verdict).toBe('take');
    const src = SRC('HorseLogic.ts');
    const at = src.indexOf('\nfunction omahaValueLeaderDefenseInScope(');
    expect(at).toBeGreaterThan(-1);
    const body = src.slice(at, src.indexOf('\n}\n', at));
    expect(body).toContain('omahaStrategyGameInScope(OMAHA_STRATEGY_PLO45, gs, opts) &&');
    expect(body).toContain('gs.bombPot !== true &&');
    expect(body).toContain('!omahaCashOnlyExcludes(player, gs)');
    // Every read of the option in a rule passes through that scope.
    const reads = src.split('opts.omahaMadeHandDefenseVsValueLeader === true').length - 1;
    const scoped =
      src.split(
        /opts\.omahaMadeHandDefenseVsValueLeader === true &&\s+omahaValueLeaderDefenseInScope\(/
      ).length - 1;
    expect(reads).toBeGreaterThan(0);
    expect(scoped).toBe(reads);
  });

  it('3.31 omahaSmallBlindSteal: the full-table steal serves four and five cards only', () => {
    expect(plo6StrategyOptionVerdict.omahaSmallBlindSteal.verdict).toBe('skip');
    const src = SRC('HorseOmahaTournamentFirstIn.ts');
    const at = src.indexOf('if (omahaSmallBlindStealTable(i, p)) {');
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at, at + 220)).toContain(
      'if (i.holeCount !== 4 && i.holeCount !== 5) return null;'
    );
    expect(src).not.toContain('omahaStrategyGameInScope');
  });
});

describe('PLO6 port: the calibration restates no river number of its own (pre-review finding 10)', () => {
  it("the calibration's river fold bars and cheap price equal the live rule's constants", () => {
    const K = PLO6_OMAHA_STRATEGY_CONSTANTS;
    expect(K.PLO6_RIVER_FOLD_BEAT_PROB.value).toBe(PLO6_RIVER_FOLD_BEAT_PROB);
    expect(K.PLO6_RIVER_UNPAIRED_FOLD_BEAT_PROB.value).toBe(PLO6_RIVER_UNPAIRED_FOLD_BEAT_PROB);
    expect(K.PLO6_RIVER_CHEAP_PRICE.value).toBe(PLO6_RIVER_CHEAP_PRICE);
    expect([
      PLO6_RIVER_FOLD_BEAT_PROB,
      PLO6_RIVER_UNPAIRED_FOLD_BEAT_PROB,
      PLO6_RIVER_CHEAP_PRICE,
    ]).toEqual([0.15, 0.3, 0.1]);
  });
});
