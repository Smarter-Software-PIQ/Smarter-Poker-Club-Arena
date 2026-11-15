/**
 * Test support for the 2026-11-15 long participation window (HorseOpponentExploit EXPLOIT_LONG_FIELDS).
 *
 * Since that window exists, every counter row the learner store builds carries it, so a view snapshot of learned rows
 * is written as horse-decision-reads-v15. A test that pins an older frame version is pinning a historical view, and a
 * historical view had no long window: `withoutLongParticipation` gives that view (fresh rows, the input untouched).
 * `asLearned` is the row the learner store builds from one hand's increments on an empty store: the increments and the
 * long window they start (each long field equal to that hand's hands, vpip and pfr).
 */
import {
  EXPLOIT_LONG_FIELDS,
  EXPLOIT_LONG_SOURCE,
  type ExploitCounters,
  type ExploitCountersWithLong,
} from './HorseOpponentExploit.js';
import type { HorseMindSandbox } from './HorseMind.js';

export function withoutLongParticipation<T extends Pick<HorseMindSandbox, 'exploit'>>(view: T): T {
  return {
    ...view,
    exploit: new Map(
      [...view.exploit].map(([key, row]) => {
        const copy: ExploitCountersWithLong = { ...row };
        for (const f of EXPLOIT_LONG_FIELDS) delete copy[f];
        return [key, copy];
      })
    ),
  };
}

export function asLearned(
  increments: ExploitCounters | undefined
): ExploitCountersWithLong | undefined {
  if (!increments) return increments;
  const out: ExploitCountersWithLong = { ...increments };
  for (const f of EXPLOIT_LONG_FIELDS) out[f] = increments[EXPLOIT_LONG_SOURCE[f]];
  return out;
}
