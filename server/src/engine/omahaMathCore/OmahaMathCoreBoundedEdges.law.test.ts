// Laws for the bounded edge widths facing a wager (lane CORE-POOLED-10, criteria CRITERIA-CORE-POOLED-10-BLUR sha d851afb1).
import { describe, expect, it } from 'vitest';
import { boundedEdges, pInEdges } from './OmahaMathCoreRangeTrack.js';

describe('bounded edges facing a wager', () => {
  it('an edge is never wider than the measured region it bounds', () => {
    expect(boundedEdges(0.12, 0.13, 0.0098)).toEqual({ eV: 0.12, eB: 0.0098 });
    expect(boundedEdges(0.3, 0.13, 0.0098)).toEqual({ eV: 0.13, eB: 0.0098 });
  });
  it('a strength error inside both regions is kept bit for bit (the old likelihood)', () => {
    expect(boundedEdges(0.005, 0.13, 0.0098)).toEqual({ eV: 0.005, eB: 0.005 });
  });
  it('equal widths at both edges give the one-width band share', () => {
    const a = pInEdges(0.4, 0.2, 0.07, 0.6, 0.07);
    expect(a).toBeGreaterThan(0.99);
    expect(pInEdges(0.4, 0.2, 0.07, 0.6, 0.07)).toBe(a);
  });
  it('a weak holding far from a 1%-wide bluff region gets almost no bluff-raise weight once the edge is bounded', () => {
    const q = 0.85; // his weakest sixth, not in the bottom 1%
    const blurred = pInEdges(q, 0.99, 0.12, 2, 0.12);
    const eB = boundedEdges(0.12, 0.13, 0.0098).eB;
    const bounded = pInEdges(q, 0.99, eB, 2, eB);
    expect(blurred).toBeGreaterThan(0.1);
    expect(bounded).toBeLessThan(1e-6);
  });
});
