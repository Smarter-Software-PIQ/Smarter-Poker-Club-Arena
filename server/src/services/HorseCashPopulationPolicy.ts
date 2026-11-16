import { createHash } from 'node:crypto';
import { occupancyTargetForHost, hostSeatCeiling } from './StableHand.js';
import { cashActivityScaleAt, horseCashGameAllowed } from './HorseCashSchedule.js';

const cache = new Map<string, number>();

/**
 * Immutable admission semantics, not observed seats or hand throughput.
 * The same SQL arrival pacing can serve a different engine occupancy curve.
 * Sample every minute of the policy's own daily curve at a fixed reference
 * population, so clock time, actual occupancy and strategy releases do not
 * create new cohorts. A changed curve or seat ceiling does.
 */
export function horseCashPopulationPolicyFingerprint(nowMs = Date.now()): number {
  const scale = cashActivityScaleAt(nowMs);
  const admission = [
    'nlh',
    'plo4',
    'plo5',
    'plo6',
    'plo8',
    'short_deck',
    'pineapple',
    'flh',
    'flo8',
  ].map((game_variant) => [
    game_variant,
    ...[0.1, 0.5, 1, 2, 5, 10].map((big_blind) =>
      horseCashGameAllowed({ game_variant, small_blind: big_blind / 2, big_blind }, nowMs)
    ),
  ]);
  const key = JSON.stringify([scale, admission]);
  const prior = cache.get(key);
  if (prior !== undefined) return prior;
  const curve = Array.from({ length: 24 * 60 }, (_, minute) => {
    const hour = Math.floor(minute / 60);
    const at = minute % 60;
    const { target, min, max } = occupancyTargetForHost(10_000, hour, at, scale);
    return [target, min, max, hostSeatCeiling(max, hour, at)];
  });
  // 52 bits are exactly representable in a Prometheus float64.
  const fingerprint = Number.parseInt(
    createHash('sha256')
      .update(JSON.stringify([key, curve]))
      .digest('hex')
      .slice(0, 13),
    16
  );
  cache.set(key, fingerprint);
  return fingerprint;
}
