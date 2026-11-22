/**
 * Lane CORE-POOLED-6 (2026-11-21). The PLO5 flop realization factors are measured numbers with a declared
 * provenance. This law pins them: a change of any factor, count, street list, version or provenance fails here
 * and must come with its own declared measurement (criteria file + sha256 before the computation).
 *
 * Source of the pinned values: the rule of lane CORE-POOLED-4's CRITERIA-CORE-POOLED-4-REALIZATION-AMENDMENT
 * (sha256 d7fbd6c89e29110d1407a444e599500fa642d11a5a7ef74ab0e58f28b97c1c79) applied ONCE to the full window by
 * CRITERIA-CORE-POOLED-4-REALIZATION-CONFIRMATION (sha256 0eb833be8125834c92e639391d64bce9ed41f24f95da5e18cc0a3fd850b50d44;
 * lanes CORE-POOLED-5/6/7, Nov 21 2026): every PLO5 cash hand with a flop Oct 16 06:00Z - Nov 17 06:00Z (274,929
 * hands, 571,358 decisions), check Nov 18-21 by serving era (54,086 decisions). Rule: ONE factor for every action
 * unless a pair of actions differs at |z| >= 2 with n >= 100 in both sets (same sign); check vs call, bet and raise
 * qualify, so check, call and bet carry their own fit value; raise fails pooled stability (check-set z 2.08) and
 * takes the pooled R1. Verdict ADOPT.
 *
 * The call facing a raise of the hero's own flop wager (cell 'plo5|flop|call|raised_own'): lane CORE-POOLED-7,
 * CRITERIA-CORE-POOLED-7-PLO5-FLOP-RAISED-CALL-REALIZATION (sha256
 * ae1fcd668445f382b82d594846a8bca7b99f3f8c49e674fc8996c55f74fa1418), same rows: fit 0.8116 +- 0.0284 (n 9,365,
 * 747 players, top 1.3%), check 0.8665 +- 0.0697 (n 874, z 0.73): ADOPT, r = (n x 0.8116 + 100 x 0.8979) / (n + 100).
 */
import { describe, expect, it } from 'vitest';
import {
  OMAHA_MATH_CORE_REALIZATION_CALIBRATION as C,
  applyRealizationCalibration,
  facesRaiseOfOwnWager,
  realizationCalibrationCell,
  type CoreActionEv,
} from './OmahaMathCore.js';
import { OMAHA_MATH_CORE_ALLOWED_PROVENANCE } from './OmahaMathCoreTables.js';

const PLO5_FLOP = {
  'plo5|flop': { r: 0.8184, n: 571358 },
  'plo5|flop|bet': { r: 0.9075, n: 125091 },
  'plo5|flop|call': { r: 0.8979, n: 120127 },
  'plo5|flop|call|raised_own': { r: 0.8125, n: 9365 },
  'plo5|flop|check': { r: 0.6263, n: 313637 },
  'plo5|flop|raise': { r: 0.8184, n: 12503 },
};

describe('the PLO5 flop realization factors are the measured ones (pinned with their provenance)', () => {
  it('cells and counts, applied streets, version and provenance equal the declared result', () => {
    const flop = Object.fromEntries(
      Object.entries(C.cells).filter(([k]) => k.startsWith('plo5|flop'))
    );
    expect(flop).toEqual(PLO5_FLOP);
    expect(C.streets).toEqual({ plo4: ['flop'], plo5: ['flop'] });
    expect(C.version).toBe('core-pooled5-realization-v3-full-window+core-extend-plo4');
    // PLO4 flop (lane CORE-EXTEND, criteria sha e8793e34): one factor for every action; a call facing a raise of the
    // hero's own wager (lane CORE-EXTEND-4 criteria sha ad98efdc, ADOPT): shrunk n/(n+100) to that factor
    const plo4 = Object.fromEntries(
      Object.entries(C.cells).filter(([k]) => k.startsWith('plo4|flop'))
    );
    expect(plo4).toEqual({
      'plo4|flop': { r: 0.7984, n: 13773 },
      'plo4|flop|bet': { r: 0.7984, n: 3119 },
      'plo4|flop|call': { r: 0.7984, n: 2809 },
      'plo4|flop|check': { r: 0.7984, n: 7535 },
      'plo4|flop|raise': { r: 0.7984, n: 310 },
      'plo4|flop|call|raised_own': { r: 0.6762, n: 226 },
    });
    expect(C.source).toContain('criteria sha e8793e34');
    expect(C.provenance).toBe('population_all_cards_capped');
    expect(OMAHA_MATH_CORE_ALLOWED_PROVENANCE.has(C.provenance)).toBe(true);
    expect(C.source).toContain('amendment sha d7fbd6c8');
    expect(C.source).toContain('confirmation sha 0eb833be');
    expect(C.source).toContain('sha ae1fcd66');
  });

  it('the declared rule holds on the pinned numbers: check, call and bet carry their own factor, raise the pooled one', () => {
    const pooled = PLO5_FLOP['plo5|flop'].r;
    expect(PLO5_FLOP['plo5|flop|raise'].r).toBe(pooled);
    expect(PLO5_FLOP['plo5|flop|check'].r).toBeLessThan(pooled);
    expect(PLO5_FLOP['plo5|flop|call'].r).toBeGreaterThan(pooled);
    expect(PLO5_FLOP['plo5|flop|bet'].r).toBeGreaterThan(pooled);
    // the raised-own call cell is the declared shrinkage n/(n+k), k = 100, toward the call cell
    const xr = PLO5_FLOP['plo5|flop|call|raised_own'];
    expect(xr.r).toBeCloseTo(
      (xr.n * 0.8116 + 100 * PLO5_FLOP['plo5|flop|call'].r) / (xr.n + 100),
      4
    );
    expect(xr.n).toBeLessThan(PLO5_FLOP['plo5|flop|call'].n);
    // the per-action counts are parts of the pooled count
    const parts = ['bet', 'call', 'check', 'raise'].reduce(
      (a, k) => a + PLO5_FLOP[`plo5|flop|${k}` as keyof typeof PLO5_FLOP].n,
      0
    );
    expect(parts).toBe(PLO5_FLOP['plo5|flop'].n);
  });

  it('what a candidate reads: its own cell, the pooled cell for an all-in, nothing for a fold or another street or game', () => {
    expect(realizationCalibrationCell('plo5', 'flop', 'check')?.r).toBe(0.6263);
    expect(realizationCalibrationCell('plo5', 'flop', 'call')?.r).toBe(0.8979);
    expect(realizationCalibrationCell('plo5', 'flop', 'bet')?.r).toBe(0.9075);
    expect(realizationCalibrationCell('plo5', 'flop', 'raise')?.r).toBe(0.8184);
    expect(realizationCalibrationCell('plo5', 'flop', 'all_in')?.r).toBe(0.8184);
    expect(realizationCalibrationCell('plo5', 'flop', 'fold')).toBeNull();
    for (const [game, street] of [
      ['plo5', 'preflop'],
      ['plo5', 'turn'],
      ['plo5', 'river'],
      ['plo4', 'turn'],
      ['plo6', 'flop'],
    ])
      for (const a of ['check', 'call', 'bet', 'raise', 'all_in'])
        expect(realizationCalibrationCell(game, street, a), `${game} ${street} ${a}`).toBeNull();
  });
});

describe("a call facing a raise of the hero's own flop wager realizes its own measured share (CORE-EXTEND-4 / CORE-POOLED-7)", () => {
  const h = (
    seat: number,
    action: 'check' | 'bet' | 'call' | 'raise' | 'fold',
    street = 'flop'
  ) => ({
    street,
    seat,
    action,
  });
  it('the public line decides it: he bet or raised earlier on this street and a wager is in front of him again', () => {
    const base = { street: 'flop', toCall: 12, heroSeat: 3 };
    // bet, check-raised: yes
    expect(
      facesRaiseOfOwnWager({ ...base, history: [h(1, 'check'), h(3, 'bet'), h(1, 'raise')] })
    ).toBe(true);
    // raised, re-raised: yes
    expect(
      facesRaiseOfOwnWager({ ...base, history: [h(1, 'bet'), h(3, 'raise'), h(1, 'raise')] })
    ).toBe(true);
    // called a bet, then a raise behind him: no (not his own wager)
    expect(
      facesRaiseOfOwnWager({ ...base, history: [h(1, 'bet'), h(3, 'call'), h(5, 'raise')] })
    ).toBe(false);
    // first wager in front of him: no
    expect(facesRaiseOfOwnWager({ ...base, history: [h(1, 'bet')] })).toBe(false);
    // his wager was on an earlier street: no
    expect(
      facesRaiseOfOwnWager({
        ...base,
        history: [h(3, 'bet', 'flop'), h(1, 'call', 'flop'), h(1, 'bet', 'turn')],
        street: 'turn',
      })
    ).toBe(false);
    // nothing to call, or no public history: no
    expect(
      facesRaiseOfOwnWager({ ...base, toCall: 0, history: [h(3, 'bet'), h(1, 'raise')] })
    ).toBe(false);
    expect(facesRaiseOfOwnWager({ ...base })).toBe(false);
  });

  it('only a call reads the raised-own cell; every other action and every other call is unchanged', () => {
    expect(realizationCalibrationCell('plo5', 'flop', 'call', true)?.r).toBe(0.8125);
    expect(realizationCalibrationCell('plo5', 'flop', 'call', true)?.cell).toContain(
      'plo5|flop|call|raised_own'
    );
    expect(realizationCalibrationCell('plo5', 'flop', 'call', false)?.r).toBe(0.8979);
    for (const a of ['check', 'bet', 'raise', 'all_in'])
      expect(realizationCalibrationCell('plo5', 'flop', a, true)?.r).toBe(
        realizationCalibrationCell('plo5', 'flop', a, false)?.r
      );
    expect(realizationCalibrationCell('plo5', 'flop', 'fold', true)).toBeNull();
    // no cell, no street: the lookup falls through exactly as before
    expect(realizationCalibrationCell('plo5', 'turn', 'call', true)).toBeNull();
    // PLO4 flop has its own raised-own cell (lane CORE-EXTEND-4, criteria sha ad98efdc); a bet never reads it
    expect(realizationCalibrationCell('plo4', 'flop', 'call', true)?.r).toBe(0.6762);
    expect(realizationCalibrationCell('plo4', 'flop', 'bet', true)?.r).toBe(0.7984);
    expect(realizationCalibrationCell('plo4', 'turn', 'call', true)).toBeNull();
  });

  it('the priced call of a check-raise carries the raised-own factor on its showdown term only', () => {
    const mk = (): CoreActionEv[] =>
      [
        {
          action: 'fold',
          amount: null,
          adds: 0,
          ev: 0,
          equity: null,
          se: null,
          foldProb: 0,
          foldSource: null,
          range: null,
        },
        {
          action: 'call',
          amount: 30,
          adds: 24,
          ev: 20,
          equity: 0.5,
          se: 4,
          foldProb: 0,
          foldSource: null,
          range: null,
          sd: 60,
        },
      ] as CoreActionEv[];
    const raised = mk();
    const first = mk();
    applyRealizationCalibration(raised, 'plo5', 'flop', true);
    applyRealizationCalibration(first, 'plo5', 'flop');
    expect(raised[1].ev).toBeCloseTo(20 - (1 - 0.8125) * 60, 9);
    expect(first[1].ev).toBeCloseTo(20 - (1 - 0.8979) * 60, 9);
    expect(raised[1].calibration!.cell).toContain('raised_own');
    expect(raised[0].ev).toBe(0);
  });
});
