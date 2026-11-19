import { expect, test } from 'vitest';
import { applyDynamicWeighting } from '../engine/WeightingService.js';

test('Dynamic Weighting Engine applies neutralization factor for blind play', () => {
  const blindHand = { position: 'BB', variant: 'NLH', weight: 1.0 };
  const lateHand = { position: 'BTN', variant: 'NLH', weight: 1.0 };

  const balancedWeights = applyDynamicWeighting([blindHand, lateHand]);

  // Assert blind weight neutralization (reduction)
  expect(balancedWeights[0].weight).toBeLessThan(1.0);
  // Assert BTN weight increase
  expect(balancedWeights[1].weight).toBeGreaterThan(1.0);
  
  // Verify 1.35x neutralization factor trend
  const ratio = balancedWeights[1].weight / balancedWeights[0].weight;
  expect(ratio).toBeGreaterThan(1.3);
});
