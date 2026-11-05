import { describe, expect, it } from 'vitest';
import { aggressionFactorLabel } from '../../src/pages/stats/format';
import { normalizeFull } from '../../src/pages/stats/playerStatsPageModel';

describe('aggressionFactorLabel', () => {
  it('names the postflop basis only when the payload declares it', () => {
    expect(aggressionFactorLabel('postflop')).toBe('Aggression Factor (Postflop)');
    expect(aggressionFactorLabel(undefined)).toBe('Aggression Factor');
    expect(aggressionFactorLabel('all_streets')).toBe('Aggression Factor');
  });

  it('the overall normalizer carries the basis through and never invents one', () => {
    const withBasis = normalizeFull({
      overall: { aggression_factor: 1.5, aggression_factor_basis: 'postflop' },
    } as any);
    expect(withBasis.overall.aggression_factor_basis).toBe('postflop');
    const without = normalizeFull({ overall: { aggression_factor: 1.12 } } as any);
    expect(without.overall.aggression_factor_basis).toBeUndefined();
  });
});
