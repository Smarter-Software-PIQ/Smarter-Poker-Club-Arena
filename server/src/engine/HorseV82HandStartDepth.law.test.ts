/**
 * LAW (2026-11-08): the V82 short-handed facing-open zone reads the stack the
 * hand started with (chips behind plus chips already in this street), and
 * jam-or-fold is strictly below 15bb of it. A big blind that began the hand
 * with exactly 15.00bb is in the V82 flat band, not in push/fold.
 *
 * Before: `effStackBB <= 15` on the chips BEHIND, so a 15.00-16.00bb big
 * blind (14-15bb behind after posting) jammed or folded. On 40bc2467 the
 * three-handed BB 15-18bb cell continued 12.7% (n 370, mostly 15.00bb);
 * replayed, hands 84dd1c83, 64d4e91b, 76089692, 5263c30c (3-handed) and
 * 5ea10c41 (heads-up) all reached the push/fold node.
 *
 * The states below are those hands' own stacks and open sizes (seat order
 * HU: SB, BB; 3-handed: BTN, SB, BB), answered through HorseLogic.decide over
 * the 169 classes. A tournament push/fold node never flat-calls, so "some
 * calls" means the V82 zone owns the spot and "no calls" means jam-or-fold.
 */
import { describe, expect, it } from 'vitest';
import { bbShares, type V82Spot } from './HorseV82BbFacingOpenFixture.js';

const REPRODUCED: Array<[string, V82Spot]> = [
  [
    '84dd1c83 (3-handed, BB 15.00bb, open 2.25bb)',
    { dealt: 3, mode: 'tournament', stacksBB: [16, 14, 15], openToBB: 2.25 },
  ],
  [
    '76089692 (3-handed, BB 15.00bb, open 2.15bb)',
    { dealt: 3, mode: 'tournament', stacksBB: [15.5, 14.5, 15], openToBB: 2.15 },
  ],
  [
    '64d4e91b (3-handed, BB 15.55bb, open 2.15bb)',
    { dealt: 3, mode: 'tournament', stacksBB: [16.45, 13, 15.55], openToBB: 2.15 },
  ],
  [
    '5ea10c41 (heads-up, BB 15.58bb, open 2.1bb)',
    { dealt: 2, mode: 'tournament', stacksBB: [24.42, 15.58], openToBB: 2.1 },
  ],
];

const shorter = (s: V82Spot, by: number): V82Spot => ({
  ...s,
  stacksBB: s.stacksBB.map((v, i) => (i === s.stacksBB.length - 1 ? v - by : v)),
});

describe('V82 depth is the hand-start stack; jam-or-fold is below 15bb of it', () => {
  it.each(REPRODUCED)('%s: the V82 zone owns the big blind', (_n, spot) => {
    expect(bbShares(spot).call).toBeGreaterThan(0);
  });

  it.each(REPRODUCED)('%s: the same big blind at 14.50bb or less stays jam-or-fold', (_n, spot) => {
    const bbStart = spot.stacksBB[spot.stacksBB.length - 1];
    expect(bbShares(shorter(spot, bbStart - 14.5)).call).toBe(0);
  });

  it.each(REPRODUCED)('%s: v70FacingOpenZone false keeps the legacy gate', (_n, spot) => {
    expect(bbShares(spot, { v70FacingOpenZone: false }).call).toBe(0);
  });

  it('22.00bb is inside the band too, heads-up and three-handed', () => {
    expect(
      bbShares({ dealt: 2, mode: 'tournament', stacksBB: [22, 22], openToBB: 2.2 }).call
    ).toBeGreaterThan(0);
    expect(
      bbShares({ dealt: 3, mode: 'tournament', stacksBB: [22, 22, 22], openToBB: 2.2 }).call
    ).toBeGreaterThan(0);
  });
});
