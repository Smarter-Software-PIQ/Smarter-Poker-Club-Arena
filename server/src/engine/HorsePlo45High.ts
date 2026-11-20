/**
 * PLO SCOPE (owner 2026-11-19 8:26 PM Chicago: the emergency batch is PLO4 and PLO5 only; PLO6 is separate and
 * must stay byte-identical): true for a four- or five-card high-only Omaha game. The batch's shared-code fixes act
 * only where this is true.
 *
 * Its own module (2026-11-19) so the one historical law that replays a frozen pre-batch corpus
 * (HorseOpponentExploitNeutrality.law.test.ts) can hold the batch's shared-code fixes out; production has no opt-out.
 */
import type { VariantInfo } from './HorseEval.js';

export function isPlo45High(vi: Pick<VariantInfo, 'isOmaha' | 'holeCount' | 'isHiLo'>): boolean {
  return vi.isOmaha && !vi.isHiLo && (vi.holeCount === 4 || vi.holeCount === 5);
}
