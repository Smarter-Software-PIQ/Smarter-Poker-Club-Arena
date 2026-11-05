import { describe, expect, it } from 'vitest';
import {
  displayPoolIsGuarantee,
  displayTotalPool,
  guaranteeCollected,
  placeGuarantee,
} from '../../src/utils/tournamentPrizeFunding';
import { effectivePrizePool } from '../../src/components/tournament/details/types';

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

// 2026-11-05 owner rule: a guarantee counts the FULL buy-in. 40 chips paid as
// 26 prize / 10 bounty / 4 rake count 40 toward the guarantee.
describe('a guarantee counts the full buy-in', () => {
  it('ten 40-chip entries against 500: C 400, the guarantee is shown, places floor at 360', () => {
    expect(guaranteeCollected(260, 100, 40)).toBe(400);
    expect(displayPoolIsGuarantee(260, 500, 100, 40)).toBe(true);
    expect(displayTotalPool(260, 500, 100, 40)).toBe(500);
    // The close-out funds 100: places 360 (not 400), bounties 100, rake 40.
    expect(placeGuarantee(500, 100, 40)).toBe(360);
    expect(effectivePrizePool(260, 500, 100, 40)).toBe(360);
  });

  it('thirteen 40-chip entries against 500: C 520 meets it, no overlay, the pools show what is in them', () => {
    expect(guaranteeCollected(338, 130, 52)).toBe(520);
    expect(displayPoolIsGuarantee(338, 500, 130, 52)).toBe(false);
    expect(placeGuarantee(500, 130, 52)).toBe(318);
    expect(effectivePrizePool(338, 500, 130, 52)).toBe(338);
    expect(displayTotalPool(338, 500, 130, 52)).toBe(468);
  });

  it('after a funded close-out the pools read 360 + 100 and the guarantee is met', () => {
    expect(displayPoolIsGuarantee(360, 500, 100, 40)).toBe(false);
    expect(displayTotalPool(360, 500, 100, 40)).toBe(460);
  });
});
