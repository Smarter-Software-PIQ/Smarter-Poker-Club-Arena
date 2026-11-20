import { describe, expect, it } from 'vitest';
import { omahaPricedSampledCandidates } from './HorseOmahaPricedRules.js';

/**
 * A PRICED RAISE IS NEVER BELOW THE MINIMUM UNLESS IT IS THE ALL-IN (2026-11-19, review N2 of
 * cd08c4d5315). omahaPricedSampledCandidates lists the raise-to amounts the sampled raise prices and
 * the receipt validator re-derives. When the deepest opponent cannot cover a full minimum raise, the
 * proposed size used to be clipped to that cover: a raise below the minimum that is not the Horse's
 * whole stack, which the rules refuse. Every candidate must be either at or above the minimum raise
 * or the Horse's whole stack.
 */
describe('a priced raise is never below the minimum unless it is the all-in', () => {
  const legal = (tos: number[], minTo: number, total: number) =>
    tos.every((t) => t >= minTo - 0.005 || t >= total - 0.005);

  it('a short cover never turns the proposed size into a below-minimum raise', () => {
    const tos = omahaPricedSampledCandidates(
      { stack: 100, heroBet: 0, currentBet: 10, opponents: [{ stack: 5, bet: 10 }], to: 20 },
      { minTo: 20, maxTo: 100 }
    );
    expect(tos).toEqual([]);
  });

  it('with a short cover the all-in itself is still priced when it is the proposed size', () => {
    const tos = omahaPricedSampledCandidates(
      { stack: 12, heroBet: 0, currentBet: 10, opponents: [{ stack: 50, bet: 10 }], to: 12 },
      { minTo: 20, maxTo: 12 }
    );
    expect(tos).toEqual([12]);
  });

  it('every candidate over a grid of stacks, covers and proposals is legal', () => {
    let checked = 0;
    for (const stack of [8, 15, 30, 60, 120])
      for (const cover of [2, 6, 12, 25, 80, 200])
        for (const to of [12, 20, 35, 70, 140]) {
          const total = stack;
          const minTo = 20;
          const tos = omahaPricedSampledCandidates(
            { stack, heroBet: 0, currentBet: 10, opponents: [{ stack: cover, bet: 10 }], to },
            { minTo, maxTo: total }
          );
          expect(legal(tos, minTo, total)).toBe(true);
          checked += tos.length;
        }
    expect(checked).toBeGreaterThan(0);
  });
});
