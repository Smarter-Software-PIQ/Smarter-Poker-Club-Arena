import { describe, expect, it } from 'vitest';

import {
  OurWagerResponseTracker,
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
      opponent: 'u',
      measured: () => ({ fold: 0.5, raise: 0.1 }),
      priorWeight: 10,
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

  it('exploit-back: no observations leaves the measured cell unchanged', () => {
    const t = new OurWagerResponseTracker();
    const e = t.exploitBack('opp', 'check_raise', { fold: 0.5, raise: 0.1 }, 12);
    expect(e.foldMult).toBe(1);
    expect(e.raiseMult).toBe(1);
  });

  it('exploit-back: an opponent who keeps calling our check-raises is folded less often by the posterior', () => {
    const t = new OurWagerResponseTracker();
    for (let i = 0; i < 12; i++) t.record('opp', 'check_raise', 'call');
    const e = t.exploitBack('opp', 'check_raise', { fold: 0.5, raise: 0.1 }, 12);
    // posterior fold = (0 + 12 x 0.5) / (12 + 12) = 0.25 -> multiplier 0.5
    expect(e.foldMult).toBeCloseTo(0.5, 6);
    // posterior raise = (0 + 1.2) / 24 = 0.05 -> 0.5
    expect(e.raiseMult).toBeCloseTo(0.5, 6);
    // lines are separate: his answers to our bets are untouched
    expect(t.exploitBack('opp', 'bet', { fold: 0.5, raise: 0.1 }, 12).foldMult).toBe(1);
  });

  it('exploit-back: an opponent who re-raises our raises raises the re-raise rate', () => {
    const t = new OurWagerResponseTracker();
    for (let i = 0; i < 6; i++) t.record('opp', 'raise', 'raise');
    const e = t.exploitBack('opp', 'raise', { fold: 0.4, raise: 0.1 }, 12);
    // (6 + 1.2) / 18 = 0.4 -> x4
    expect(e.raiseMult).toBeCloseTo(4, 6);
    expect(e.foldMult).toBeCloseTo((0 + 12 * 0.4) / 18 / 0.4, 6);
  });

  it('the tracker stays bounded', () => {
    const t = new OurWagerResponseTracker(10);
    for (let i = 0; i < 200; i++) t.record(`u${i}`, 'bet', 'fold');
    expect(t.counts('u0', 'bet').n).toBe(0);
    expect(t.counts('u199', 'bet').n).toBe(1);
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
