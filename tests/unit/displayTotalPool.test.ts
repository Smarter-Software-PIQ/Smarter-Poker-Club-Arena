import { describe, expect, it } from 'vitest';
import { displayTotalPool, placeGuarantee } from '../../src/utils/tournamentPrizeFunding';

// 2026-11-04: a guarantee is a FLOOR over places + bounties together, never
// the start-time overlay stacked on late entries.
describe('displayTotalPool', () => {
  it('a non-bounty event below its guarantee prints the guarantee', () => {
    // Wednesday Feature: 1,350 in from players against 1,500 guaranteed.
    expect(displayTotalPool(1350, 1500, 0)).toBe(1500);
  });

  it('a non-bounty event above its guarantee prints the money in', () => {
    expect(displayTotalPool(1620, 1500, 0)).toBe(1620);
  });

  it('a PKO prints prize + bounties against the guarantee, not the prize half', () => {
    // Late Night PKO: 370 prize, 380 bounties, 750 guaranteed.
    expect(displayTotalPool(370, 750, 380)).toBe(750);
    expect(placeGuarantee(750, 380)).toBe(370);
  });

  it('a bounty event above its guarantee prints the whole pool', () => {
    expect(displayTotalPool(14050, 5000, 6375)).toBe(20425);
  });

  it('no guarantee prints prize + bounties as they stand', () => {
    expect(displayTotalPool(40, 0, 10)).toBe(50);
    expect(displayTotalPool(null, null, null)).toBe(0);
  });
});
