import { describe, expect, it } from 'vitest';
import { countdownPlacementError } from '../e2e/support/countdownFeltGeometry';

const rect = (left: number, top: number, right: number, bottom: number) => ({
  left,
  top,
  right,
  bottom,
});
const felt = rect(50, 100, 350, 700);
const hand = rect(175, 440, 225, 452);
const hero = rect(140, 685, 260, 740);
const pill = rect(150, 455, 250, 480);

describe('visible countdown position', () => {
  it('accepts the readout under the hand number', () => {
    expect(countdownPlacementError(pill, felt, hand, [hero])).toBeNull();
  });
  it('rejects a displacement beside the player with unchanged DOM ancestry', () => {
    expect(countdownPlacementError(rect(55, 650, 145, 680), felt, hand, [hero])).toBeTruthy();
  });
  it('rejects rail corners inside the bounding rectangle', () => {
    expect(
      countdownPlacementError(rect(51, 101, 251, 120), felt, rect(90, 80, 130, 100), [])
    ).toMatch(/outside/);
  });
  it('rejects overlap with the hand label or hero panel', () => {
    expect(countdownPlacementError(rect(150, 440, 250, 480), felt, hand, [hero])).toMatch(
      /hand number/
    );
    expect(countdownPlacementError(pill, felt, hand, [rect(120, 460, 160, 490)])).toMatch(/hero/);
  });
});
