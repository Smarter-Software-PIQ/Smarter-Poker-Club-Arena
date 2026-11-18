/**
 * The range calibration scorer of the Omaha priced rules: its arithmetic on a
 * small fixture of bets with known holdings (built hands, not recorded ones).
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardRank, CardSuit } from '../types.js';
import {
  omahaCalibrationError,
  omahaCalibrationScores,
  omahaHeldClass,
  omahaHoldingShareAbove,
  omahaShrunkShare,
  omahaWinShareBluffFit,
} from './OmahaPricedRangeCalibration.js';
import { OMAHA_EV_PRIOR_BLUFF, OMAHA_EV_SIZE_READ_PRIOR } from '../engine/HorseOmahaFacingBetEv.js';
import { OMAHA_PRICED_MEASURED_BLUFF } from '../engine/HorseOmahaPricedMode.js';

const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (spec: string): Card[] =>
  (spec.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: SUIT[x[1]] }));

/** bettor, board, the Horse that faced the bet, the value share assumed, what he held */
const FIXTURE: Array<[string, string, string, number, 'value' | 'draw' | 'other']> = [
  ['AhKh2c8s4s', '9dQdJh7h2h', 'QcJd6c6d4h', 0.2, 'value'], // the nut flush on the river
  ['3d3c4c8s5s', '9dQdJh7h2h', 'QcJd6c6d4h', 0.2, 'other'], // a pair of threes
  ['KcTc2s3s4d', '9dQdJh7h', 'QcJd6c6d4h', 0.28, 'value'], // the nut straight on the turn
  ['AhKh5c5s2c', '9dQdJh7h', 'QcJd6c6d4h', 0.28, 'draw'], // the nut flush draw on the turn
  ['2c2s5c4s3d', '9dQdJh7h', 'QcJd6c6d4h', 0.28, 'other'],
];

describe('the range calibration scorer', () => {
  it('places a holding among the holdings the Horse cannot see, the same way every time', () => {
    const [bettor, board, horse] = FIXTURE[0];
    const a = omahaHoldingShareAbove(cards(bettor), cards(board), cards(horse));
    expect(a).toBe(omahaHoldingShareAbove(cards(bettor), cards(board), cards(horse)));
    expect(a).toBe(0);
    const weak = omahaHoldingShareAbove(cards(FIXTURE[1][0]), cards(board), cards(horse));
    expect(weak).toBeGreaterThan(0.6);
  });
  it('classes what was held beside the assumed value region', () => {
    for (const [bettor, board, horse, share, held] of FIXTURE)
      expect(omahaHeldClass(cards(bettor), cards(board), cards(horse), share), bettor).toBe(held);
  });
  it('scores each group and weights the error by its count', () => {
    const rows = [
      { group: 'river|70-110|unpaired', assumedValue: 0.8, held: 'value' as const },
      { group: 'river|70-110|unpaired', assumedValue: 0.8, held: 'other' as const },
      { group: 'turn|40-70|unpaired', assumedValue: 0.6, held: 'value' as const },
      { group: 'turn|40-70|unpaired', assumedValue: 0.6, held: 'draw' as const },
      { group: 'turn|40-70|unpaired', assumedValue: 0.6, held: 'draw' as const },
      { group: 'turn|40-70|unpaired', assumedValue: 0.6, held: 'other' as const },
    ];
    const scores = omahaCalibrationScores(rows);
    expect(scores.map((s) => s.group)).toEqual(['river|70-110|unpaired', 'turn|40-70|unpaired']);
    expect(scores[0]).toMatchObject({ n: 2, observedValue: 0.5, observedOther: 0.5 });
    expect(scores[0].gap).toBeCloseTo(0.3, 12);
    expect(scores[1]).toMatchObject({
      n: 4,
      observedValue: 0.25,
      observedDraw: 0.5,
      observedOther: 0.25,
    });
    expect(omahaCalibrationError(scores)).toBeCloseTo((2 * 0.3 + 4 * 0.35) / 6, 12);
    expect(omahaCalibrationError([])).toBe(0);
  });
  it('fits the bluff share that makes the predicted win share the one won', () => {
    expect(omahaWinShareBluffFit([])).toBeNull();
    expect(omahaWinShareBluffFit([{ actual: 0.3, vsValue: 0.4, vsOther: 0.4 }])).toBeNull();
    // 0.25 x 0.85 + 0.75 x 0.05 = 0.25
    const q = omahaWinShareBluffFit([
      { actual: 0.2, vsValue: 0.05, vsOther: 0.85 },
      { actual: 0.3, vsValue: 0.05, vsOther: 0.85 },
    ])!;
    expect(q).toBeCloseTo(0.25, 12);
    expect(omahaShrunkShare(0.3, 174, 0.19, 8)).toBeCloseTo((0.3 * 174 + 0.19 * 8) / 182, 12);
  });
  it('the measured bluff prior of the continuous range is the 2026-11-17 calibration, shrunk by the stepped prior', () => {
    // q measured, bets: 995 heads-up turn and river bets by persons into Horses, PLO4/PLO5 cash,
    // 2026-11-13 19:40Z to 2026-11-17 19:40Z (archive priced-01BNteGZ/calibration/bluff-fit.json)
    const MEASURED = {
      river: { under40: [0.092, 62], mid: [0.251, 120], big: [0.299, 174], raise: [0.071, 30] },
      turn: { under40: [0.369, 62], mid: [0.434, 132], big: [0.299, 337], raise: [0.315, 78] },
    } as const;
    for (const street of ['river', 'turn'] as const)
      for (const row of ['under40', 'mid', 'big', 'raise'] as const) {
        const [q, n] = MEASURED[street][row];
        const want = omahaShrunkShare(
          q,
          n,
          OMAHA_EV_PRIOR_BLUFF[street][row],
          OMAHA_EV_SIZE_READ_PRIOR
        );
        expect(OMAHA_PRICED_MEASURED_BLUFF[street][row], `${street} ${row}`).toBeCloseTo(want, 2);
      }
    // over 110 percent has no measured row: it reads the 70-110 row
    expect(OMAHA_PRICED_MEASURED_BLUFF.river.over).toBe(OMAHA_PRICED_MEASURED_BLUFF.river.big);
    expect(OMAHA_PRICED_MEASURED_BLUFF.turn.over).toBe(OMAHA_PRICED_MEASURED_BLUFF.turn.big);
  });
});
