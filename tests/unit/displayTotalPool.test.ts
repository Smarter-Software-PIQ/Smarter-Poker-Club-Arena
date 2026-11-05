import { describe, expect, it } from 'vitest';
import {
  displayTotalPool,
  guaranteeShortfall,
  placeGuarantee,
} from '../../src/utils/tournamentPrizeFunding';

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

// 2026-11-05 (Dan): the WHOLE player payment counts toward a buy-in
// guarantee - places + bounties + rake - and the house owes only
// max(0, guarantee - gross).
describe('a buy-in guarantee counts the whole payment', () => {
  it('thirteen 40-chip entries (26 / 10 / 4) meet a 500 guarantee: zero house funding', () => {
    expect(guaranteeShortfall(500, 13 * 26, 13 * 10, 13 * 4)).toBe(0);
    expect(displayTotalPool(338, 500, 130, 52)).toBe(468);
  });

  it('ten such entries owe exactly 100, shown once on top of what they paid', () => {
    expect(guaranteeShortfall(500, 260, 100, 40)).toBe(100);
    expect(displayTotalPool(260, 500, 100, 40)).toBe(460);
  });

  it('the owner screenshot: 41 payments of 30 (27 + 3) against 1,500 owe 270, never 2,445', () => {
    expect(guaranteeShortfall(1500, 41 * 27, 0, 41 * 3)).toBe(270);
    expect(displayTotalPool(41 * 27, 1500, 0, 41 * 3)).toBe(1377);
  });

  it('a finalized pool already holds its house share', () => {
    expect(displayTotalPool(1377, 1500, 0, 123, true)).toBe(1377);
    expect(displayTotalPool(1500, 1500, 0, 160, true)).toBe(1500);
  });
});
