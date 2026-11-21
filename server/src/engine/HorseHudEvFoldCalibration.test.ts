/**
 * OPPONENT HUD: the measured calibration of the lifetime-fed EV fold model (HUD_EV_FOLD_CALIBRATION) is applied only
 * to hero's first bet of a street, by size, after the model's own clamps; absent it changes nothing.
 */
import { describe, expect, it } from 'vitest';
import { hudCalibratedFold, mdfFold } from './HorseEvEngine.js';
import { HorseMind, HUD_EV_FOLD_CALIBRATION } from './HorseMind.js';

describe('hudCalibratedFold', () => {
  const river = HUD_EV_FOLD_CALIBRATION.river;
  it('no calibration, or a wager facing a bet, is the model unchanged', () => {
    const f = mdfFold(100, 50, 1.2);
    expect(hudCalibratedFold(f, undefined, false, 100, 50, 1000)).toBe(f);
    expect(hudCalibratedFold(f, river, true, 100, 50, 1000)).toBe(f);
  });
  it('a first bet takes the cell of its size: small up to 0.7 pot, big above it or all-in', () => {
    const f = 0.3;
    expect(hudCalibratedFold(f, river, false, 100, 70, 1000)).toBeCloseTo(f * river.sm, 12);
    expect(hudCalibratedFold(f, river, false, 100, 71, 1000)).toBeCloseTo(f * river.bg, 12);
    expect(hudCalibratedFold(f, river, false, 100, 40, 40)).toBeCloseTo(f * river.bg, 12);
  });
  it('stays inside the fold model bounds', () => {
    expect(hudCalibratedFold(0.9, river, false, 100, 50, 1000)).toBe(0.92);
  });
  it('the flop small cell was not adopted (factor 1) and outside a decision there is no calibration', () => {
    expect(HUD_EV_FOLD_CALIBRATION.flop.sm).toBe(1);
    expect(HorseMind.evFoldCalibrationOf('river')).toBeNull();
  });
});
