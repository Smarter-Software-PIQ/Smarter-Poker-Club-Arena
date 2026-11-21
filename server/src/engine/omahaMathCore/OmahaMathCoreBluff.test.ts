import { describe, expect, it } from 'vitest';

import {
  bluffSelectionReceipt,
  xrBluffCtx,
  xrBluffInScope,
  blockerShiftOf,
} from './OmahaMathCoreBluff.js';

describe('omahaMathCore XR-BLUFF component (pure parts)', () => {
  it('scope is PLO4 and PLO5 only: PLO6 never gets a bluff context (owner 8:27 PM)', () => {
    expect(xrBluffInScope('plo4', 4)).toBe(true);
    expect(xrBluffInScope('plo5', 5)).toBe(true);
    expect(xrBluffInScope('plo6', 6)).toBe(false);
    expect(xrBluffInScope('plo5', 6)).toBe(false);
    expect(xrBluffInScope('plo8', 4)).toBe(false);
    const ctx = xrBluffCtx({
      variant: 'plo6',
      holeCount: 6,
      blockers: null,
    });
    expect(ctx).toBeNull();
    const never = () => {
      throw new Error('PLO6 must not evaluate');
    };
    expect(
      blockerShiftOf({
        variant: 'plo6',
        hero: [0, 1, 2, 3, 4, 5],
        board: [10, 20, 30],
        best: never,
        rng: Math.random,
      })
    ).toBeNull();
  });

  it('the bluff receipt names the reason but never decides', () => {
    const r = bluffSelectionReceipt({
      features: {
        outs: 17,
        nutOuts: 12,
        made: 'high',
        fd: 'nfd',
        wrapSize: 9,
        comboDraw: true,
        pairPlusDraw: false,
      },
      blockers: null,
      equityCalled: 0.41,
      fold: 0.45,
    });
    expect(r.kind).toBe('semi_bluff_combo');
    expect(r.note).toMatch(/receipt only/);
    expect(
      bluffSelectionReceipt({ features: null, blockers: null, equityCalled: 0.7, fold: 0.2 }).kind
    ).toBe('value');
  });
});
