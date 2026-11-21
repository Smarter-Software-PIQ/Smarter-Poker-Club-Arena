/**
 * Lane CORE-POOLED-6 (2026-11-21). The PLO5 flop realization factors are measured numbers with a declared
 * provenance. This law pins them: a change of any factor, count, street list, version or provenance fails here
 * and must come with its own declared measurement (criteria file + sha256 before the computation).
 *
 * Source of the pinned values: lane CORE-POOLED-4, CRITERIA-CORE-POOLED-4-REALIZATION-AMENDMENT (sha256
 * d7fbd6c89e29110d1407a444e599500fa642d11a5a7ef74ab0e58f28b97c1c79), hand_history population rows, fit
 * Oct 16 - Nov 16 2026 (8,973 decisions), check Nov 18-20 by serving era; reproduced by the checker lane.
 * Rule of that file: ONE factor for every action unless a pair of actions differs at |z| >= 2 with n >= 100 in
 * both sets; only check vs raise qualified, so check and raise carry their own fit value and call and bet the
 * pooled one. The raise cell is the least certain (0.847 +- 0.097 on the newer hands): the full-window
 * confirmation (CRITERIA-CORE-POOLED-4-REALIZATION-CONFIRMATION, sha256 0eb833be...) replaces these numbers
 * once, and this law is updated in the same commit.
 */
import { describe, expect, it } from 'vitest';
import {
  OMAHA_MATH_CORE_REALIZATION_CALIBRATION as C,
  realizationCalibrationCell,
} from './OmahaMathCore.js';
import { OMAHA_MATH_CORE_ALLOWED_PROVENANCE } from './OmahaMathCoreTables.js';

const PLO5_FLOP = {
  'plo5|flop': { r: 0.8091, n: 8973 },
  'plo5|flop|bet': { r: 0.8091, n: 1996 },
  'plo5|flop|call': { r: 0.8091, n: 1898 },
  'plo5|flop|check': { r: 0.6768, n: 4847 },
  'plo5|flop|raise': { r: 1.0342, n: 232 },
};

describe('the PLO5 flop realization factors are the measured ones (pinned with their provenance)', () => {
  it('cells and counts, applied streets, version and provenance equal the declared result', () => {
    const flop = Object.fromEntries(
      Object.entries(C.cells).filter(([k]) => k.startsWith('plo5|flop'))
    );
    expect(flop).toEqual(PLO5_FLOP);
    expect(C.streets).toEqual({ plo4: [], plo5: ['flop'] });
    expect(C.version).toBe('core-pooled4-realization-v2');
    expect(C.provenance).toBe('population_all_cards_capped');
    expect(OMAHA_MATH_CORE_ALLOWED_PROVENANCE.has(C.provenance)).toBe(true);
    expect(C.source).toContain('amendment sha d7fbd6c8');
  });

  it('the declared rule holds on the pinned numbers: call and bet carry the pooled factor, check and raise their own', () => {
    const pooled = PLO5_FLOP['plo5|flop'].r;
    expect(PLO5_FLOP['plo5|flop|call'].r).toBe(pooled);
    expect(PLO5_FLOP['plo5|flop|bet'].r).toBe(pooled);
    expect(PLO5_FLOP['plo5|flop|check'].r).toBeLessThan(pooled);
    expect(PLO5_FLOP['plo5|flop|raise'].r).toBeGreaterThan(pooled);
    // the per-action counts are parts of the pooled count
    const parts = ['bet', 'call', 'check', 'raise'].reduce(
      (a, k) => a + PLO5_FLOP[`plo5|flop|${k}` as keyof typeof PLO5_FLOP].n,
      0
    );
    expect(parts).toBe(PLO5_FLOP['plo5|flop'].n);
  });

  it('what a candidate reads: its own cell, the pooled cell for an all-in, nothing for a fold or another street or game', () => {
    expect(realizationCalibrationCell('plo5', 'flop', 'check')?.r).toBe(0.6768);
    expect(realizationCalibrationCell('plo5', 'flop', 'call')?.r).toBe(0.8091);
    expect(realizationCalibrationCell('plo5', 'flop', 'bet')?.r).toBe(0.8091);
    expect(realizationCalibrationCell('plo5', 'flop', 'raise')?.r).toBe(1.0342);
    expect(realizationCalibrationCell('plo5', 'flop', 'all_in')?.r).toBe(0.8091);
    expect(realizationCalibrationCell('plo5', 'flop', 'fold')).toBeNull();
    for (const [game, street] of [
      ['plo5', 'preflop'],
      ['plo5', 'turn'],
      ['plo5', 'river'],
      ['plo4', 'flop'],
      ['plo4', 'turn'],
      ['plo6', 'flop'],
    ])
      for (const a of ['check', 'call', 'bet', 'raise', 'all_in'])
        expect(realizationCalibrationCell(game, street, a), `${game} ${street} ${a}`).toBeNull();
  });
});
