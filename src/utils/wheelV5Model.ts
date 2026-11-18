import type { WheelPreviousOutcome } from '../services/DiamondWheelService';
import { WHEEL_V4_GAME_BY_ORD, WHEEL_V4_GAME_ORDS } from './wheelV4Model';

/** Contract 5: an earned game occurs with probability 1/4 on each paid spin.
 * Upgrade retains its 1% chance and its 80% Super-game branch. If Upgrade is
 * excluded by the existing no-repeat law, its 0.8% game mass moves to ordinary
 * games. Neither time, streak length, stake nor host changes these chances.
 */
export function wheelV5MainWeights(previous?: WheelPreviousOutcome | null): number[] {
  const prev = previous?.ord;
  if (prev !== undefined && (!Number.isInteger(prev) || prev < 1 || prev > 12))
    throw new Error('The Previous Wheel Outcome Is Invalid');
  const priorSuper = previous?.tier === 'super' ? previous.game : undefined;
  if (priorSuper && !Object.values(WHEEL_V4_GAME_BY_ORD).includes(priorSuper))
    throw new Error('The Previous Super Game Is Invalid');
  const weights = Array<number>(12).fill(0);
  weights[11] = prev === 12 ? 0 : 1000;
  const gameBudget = 25000 - (weights[11] * 4) / 5;
  const games = WHEEL_V4_GAME_ORDS.filter(
    (ord) => ord !== prev && WHEEL_V4_GAME_BY_ORD[ord] !== priorSuper
  );
  games.forEach((ord, i) => {
    weights[ord - 1] =
      Math.floor(gameBudget / games.length) + (i < gameBudget % games.length ? 1 : 0);
  });
  // Preserve relative non-game odds, apart from the existing previous-prize
  // exclusion. Largest remainder makes the integer total exact, ties by ord.
  const base = [0, 29600, 6667, 0, 1200, 6666, 0, 240, 6667, 0, 160, 0];
  if (prev !== undefined) base[prev - 1] = 0;
  const total = base.reduce((sum, weight) => sum + weight, 0);
  const budget = 100000 - gameBudget - weights[11];
  const candidates = base
    .map((weight, index) => ({
      index,
      weight,
      remainder: (weight * budget) % total,
    }))
    .filter(({ weight }) => weight > 0);
  for (const { index, weight } of candidates)
    weights[index] = Math.floor((weight * budget) / total);
  let left = 100000 - weights.reduce((sum, weight) => sum + weight, 0);
  candidates.sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of candidates) {
    if (left-- <= 0) break;
    weights[index]++;
  }
  return weights;
}
export const WHEEL_V5_WEIGHTS: readonly number[] = wheelV5MainWeights(null);
