import { describe, expect, it } from 'vitest';
import {
  indifferenceBluffShare,
  indifferenceFold,
  preflopAnswerToReraise,
  reraiseSizeOf,
} from './HorsePreflopIndifferenceAnchor.js';

describe('preflop indifference anchors', () => {
  it('fold = s/(1+s) and bluff share = s/(1+2s)', () => {
    expect(indifferenceFold(1)).toBeCloseTo(0.5, 12);
    expect(indifferenceFold(0.5)).toBeCloseTo(1 / 3, 12);
    expect(indifferenceBluffShare(1)).toBeCloseTo(1 / 3, 12);
    expect(indifferenceBluffShare(0.5)).toBeCloseTo(0.25, 12);
    expect(indifferenceFold(-1)).toBe(0);
    expect(indifferenceFold(Number.NaN)).toBe(0);
  });

  it('a pot-limit pot 3-bet and a pot 4-bet are size 2 (risk twice what they win)', () => {
    // blinds 1/2 + big-blind ante 2, open to 9 (pot 14), the big blind pot 3-bets to 30 having 2 in
    expect(reraiseSizeOf(14, 30, 2)).toBeCloseTo(2, 12);
    // the opener pot 4-bets to 93 having 9 in, into the 42 before it (hand a6f9206d: break-even 66.7%)
    expect(reraiseSizeOf(42, 93, 9)).toBeCloseTo(2, 12);
    expect(indifferenceFold(reraiseSizeOf(42, 93, 9))).toBeCloseTo(2 / 3, 12);
  });

  it('the answer to a pot re-raise: two thirds fold, the value plus its bluffs re-raise, the rest calls', () => {
    const a = preflopAnswerToReraise(2, 0.4, 0.08, 2);
    expect(a.fold).toBeCloseTo(2 / 3, 12);
    expect(a.raise).toBeCloseTo(0.1 / (1 - 0.4), 12);
    expect(a.call).toBeCloseTo(1 / 3 - 0.1 / 0.6, 12);
    expect(a.fold + a.call + a.raise).toBeCloseTo(1, 12);
  });

  it('a narrow band against a wide re-raiser re-raises everything it continues with, never more', () => {
    const a = preflopAnswerToReraise(2, 0.05, 0.5, 2);
    expect(a.raise).toBeCloseTo(1 / 3, 12);
    expect(a.call).toBe(0);
  });
});
