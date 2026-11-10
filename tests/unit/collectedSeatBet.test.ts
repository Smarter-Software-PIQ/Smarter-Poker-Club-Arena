import { describe, expect, it } from 'vitest';
import { collectedSeatBet } from '../../src/utils/mapEngineSnapshot';
describe('seat changes while blind chips are being collected', () => {
  it('shows zero when KingFish takes the seat of the previous blind', () => {
    expect(collectedSeatBet(0, 400, true, true, 'prior-player', 'KingFish')).toBe(0);
  });
  it('clears a blind from a prior hand for the same occupant', () => {
    expect(collectedSeatBet(0, 400, true, false, 'KingFish', 'KingFish')).toBe(0);
  });
  it('finishes the sweep for the same player in the same hand', () => {
    expect(collectedSeatBet(0, 400, true, true, 'KingFish', 'KingFish')).toBe(400);
  });
});
